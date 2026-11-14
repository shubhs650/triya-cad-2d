// TEXT (DTEXT) and MTEXT (M2-07), with AutoCAD 2024's prompts ("TEXT (Command)", "MTEXT
// (Command)"). Both hand the typing to an in-place editor where the front-end has one: the
// prompt for the text carries `editor`, saying where it opens. TEXT's editor gives one line per
// answer, as the command line does; MTEXT's gives the whole contents, written with format codes
// (`writeMText` in @triya/text), at once.
//
// Where AutoCAD's documentation is silent this follows the common reading, noted in place: the
// next TEXT line starts 5/3 of the height below the last (MTEXT's single line spacing), and an
// MTEXT box may be dragged from any corner: its insertion point is the box's point that the
// justification names.
import type { Vec2 } from '../../geom/types';
import type { DocumentModel } from '../../model/document';
import type { Handle } from '../../model/handle';
import type { EntityId } from '../../model/entity-ids';
import type {
  AttdefGeometry,
  DimensionGeometry,
  Entity,
  MTextGeometry,
  MultiLeaderGeometry,
  TextGeometry,
  TextStyleRecord,
} from '../../model/types';
import { dimensionTextHeight, type NewDimension } from '../../edit/dimension';
import { MLEADER_BLOCK, MLEADER_MTEXT, multiLeaderMText } from '../../edit/mleader';
import { multiLeaderBackground } from '../../annotation/multileader';
import { editMultiLeaderAttributes } from '../modify/attributes';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import { regenerateDimensions } from '../modify/dimensions';
import {
  formatNumber,
  type Prompt,
  type PromptAnswer,
  type TextEditorBackground,
  type TextEditorColumns,
  type TextEditorRequest,
} from '../prompt';
import { currentProps } from '../../properties/current';

/** AutoCAD's single line spacing: 5/3 of the text height (DXF 44 = 1 for MTEXT). */
const LINE_PITCH = 5 / 3;

/** The style TEXTSTYLE names, else Standard, else the first; undefined in a drawing with none. */
export function currentTextStyle(model: DocumentModel): TextStyleRecord | undefined {
  const name = model.header.get('$TEXTSTYLE');
  const styles = [...model.tables.textStyles.values()];
  const named = (n: string) => styles.find((s) => s.name.toUpperCase() === n.toUpperCase());
  return (typeof name === 'string' ? named(name) : undefined) ?? named('Standard') ?? styles[0];
}

/** TEXTSIZE, else the default of AutoCAD's templates: 2.5 metric (acadiso), 0.2 imperial. */
export function textSize(model: DocumentModel): number {
  const v = model.header.get('$TEXTSIZE');
  if (typeof v === 'number' && v > 0) return v;
  return model.meta.measurement === 'imperial' ? 0.2 : 2.5;
}

function precision(model: DocumentModel): number {
  const v = model.header.get('$LUPREC');
  return typeof v === 'number' && v >= 0 && v <= 8 ? v : 4;
}

/**
 * "Enter style name or [?]": a style of the drawing (any case), `?` lists them. Returns the
 * style, or undefined when the command was ended.
 */
async function* askStyle(
  ctx: CommandContext,
  current: TextStyleRecord,
): AsyncGenerator<Prompt, TextStyleRecord | undefined, PromptAnswer> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter style name or',
      options: ['?'],
      default: { kind: 'string', value: current.name },
    });
    if (a.kind === 'keyword') {
      ctx.message('Text styles:');
      const names = [...ctx.model.tables.textStyles.values()].map((s) => s.name).sort();
      for (const n of names) ctx.message(`  ${n}`);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    const name = a.value.trim();
    const style = [...ctx.model.tables.textStyles.values()].find(
      (s) => s.name.toUpperCase() === name.toUpperCase(),
    );
    if (style) return style;
    ctx.message(`Cannot find text style "${name}".`);
  }
}

const add = (p: Vec2, d: Vec2, k: number): Vec2 => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/** TEXT justifications: DXF 72 and 73, and how AutoCAD asks for the point. */
const JUSTIFY: Readonly<
  Record<string, { readonly h: number; readonly v: number; readonly ask: string }>
> = {
  Left: { h: 0, v: 0, ask: 'Specify start point of text' },
  Center: { h: 1, v: 0, ask: 'Specify center point of text' },
  Right: { h: 2, v: 0, ask: 'Specify right endpoint of text baseline' },
  Align: { h: 3, v: 0, ask: 'Specify first endpoint of text baseline' },
  Middle: { h: 4, v: 0, ask: 'Specify middle point of text' },
  Fit: { h: 5, v: 0, ask: 'Specify first endpoint of text baseline' },
  TL: { h: 0, v: 3, ask: 'Specify top-left point of text' },
  TC: { h: 1, v: 3, ask: 'Specify top-center point of text' },
  TR: { h: 2, v: 3, ask: 'Specify top-right point of text' },
  ML: { h: 0, v: 2, ask: 'Specify middle-left point of text' },
  MC: { h: 1, v: 2, ask: 'Specify middle point of text' },
  MR: { h: 2, v: 2, ask: 'Specify middle-right point of text' },
  BL: { h: 0, v: 1, ask: 'Specify bottom-left point of text' },
  BC: { h: 1, v: 1, ask: 'Specify bottom-center point of text' },
  BR: { h: 2, v: 1, ask: 'Specify bottom-right point of text' },
};
const JUSTIFY_NAMES = Object.keys(JUSTIFY);

/** The attachment number (1–9, top-left to bottom-right) a TEXT justification is closest to. */
function attachmentOf(h: number, v: number): number {
  const col = h === 1 || h === 4 ? 1 : h === 2 ? 2 : 0;
  const row = v === 3 ? 0 : v === 2 || h === 4 ? 1 : 2;
  return row * 3 + col + 1;
}

/** Where the last TEXT line went, for Enter at the start point (continue below it). */
interface LastText {
  readonly style: Handle;
  readonly justify: string;
  readonly at: Vec2;
  readonly second?: Vec2;
  readonly height: number;
  readonly rotation: number;
}

/**
 * TEXT for one document. AutoCAD's prompts:
 *   Current text style: "Standard" Text height: 2.5000 Annotative: No Justify: Left
 *   Specify start point of text or [Justify/Style]:   Enter continues below the last text
 *   Specify height <2.5000>:                          not for a fixed-height style, nor Align
 *   Specify rotation angle of text <0>:               not for Align or Fit
 *   then one line of text after another; an empty line ends.
 */
export function textCommand(): CommandDef {
  let last: LastText | undefined;
  let justify = 'Left';
  let rotation = 0;
  return {
    name: 'TEXT',
    aliases: ['DTEXT'],
    async *run(ctx): CommandGenerator {
      const initial = currentTextStyle(ctx.model);
      if (!initial) {
        ctx.message('The drawing has no text style.');
        return;
      }
      let style: TextStyleRecord = initial;
      const prec = precision(ctx.model);
      ctx.message(
        `Current text style:  "${style.name}"  Text height:  ${formatNumber(
          style.height > 0 ? style.height : textSize(ctx.model),
          prec,
        )}  Annotative:  No  Justify:  ${justify}`,
      );

      let at: Vec2 | undefined;
      let second: Vec2 | undefined;
      let height: number | undefined;
      let angle: number | undefined;
      // Once a justification is chosen its point is asked without the options, as AutoCAD does.
      let chosen = false;
      while (!at) {
        const j = JUSTIFY[justify]!;
        const a = yield ctx.prompt.point(
          chosen ? { message: j.ask } : { message: `${j.ask} or`, options: ['Justify', 'Style'] },
        );
        if (a.kind === 'point') at = a.point;
        else if (a.kind === 'enter' && last) {
          // Continue below the last text, as AutoCAD's Enter at the start point does.
          const down = { x: Math.sin(last.rotation), y: -Math.cos(last.rotation) };
          const step = last.height * LINE_PITCH;
          style = ctx.model.tables.textStyles.get(last.style) ?? style;
          justify = last.justify;
          at = add(last.at, down, step);
          if (last.second) second = add(last.second, down, step);
          height = last.height;
          angle = last.rotation;
        } else if (a.kind === 'enter') {
          ctx.message('No text to continue.');
        } else if (a.kind === 'keyword' && a.keyword === 'Style') {
          const s: TextStyleRecord | undefined = yield* askStyle(ctx, style);
          if (!s) return;
          style = s;
        } else if (a.kind === 'keyword' && a.keyword === 'Justify') {
          const k = yield ctx.prompt.keyword({
            message: 'Enter an option',
            options: JUSTIFY_NAMES,
          });
          if (k.kind !== 'keyword') return;
          justify = k.keyword;
          chosen = true;
        } else return;
      }

      const j = JUSTIFY[justify]!;
      const twoPoints = j.h === 3 || j.h === 5;
      if (twoPoints && !second) {
        const a = yield ctx.prompt.point({
          message: 'Specify second endpoint of text baseline',
          rubberBand: { from: at },
        });
        if (a.kind !== 'point') return;
        second = a.point;
      }
      if (height === undefined) {
        if (style.height > 0) height = style.height;
        else if (j.h === 3) height = textSize(ctx.model);
        else {
          const a = yield ctx.prompt.distance({
            message: 'Specify height',
            base: at,
            default: { kind: 'distance', value: textSize(ctx.model) },
          });
          if (a.kind !== 'distance' || a.value <= 0) return;
          height = a.value;
        }
      }
      if (angle === undefined) {
        if (twoPoints) angle = Math.atan2(second!.y - at.y, second!.x - at.x);
        else {
          const a = yield ctx.prompt.angle({
            message: 'Specify rotation angle of text',
            base: at,
            default: { kind: 'angle', value: rotation },
          });
          if (a.kind !== 'angle') return;
          angle = a.value;
          rotation = angle;
        }
      }
      if (style.height <= 0 && j.h !== 3) {
        const h = height;
        ctx.edit((b) => b.setHeader('$TEXTSIZE', h));
      }

      // One TEXT per line, placed as soon as it is entered, so Esc keeps the lines already
      // placed (as AutoCAD's TEXT does).
      const down = { x: Math.sin(angle), y: -Math.cos(angle) };
      const step = height * LINE_PITCH;
      const props = currentProps(ctx.model);
      let line: Vec2 = at;
      for (;;) {
        const a: PromptAnswer = yield ctx.prompt.string({
          message: 'Enter text',
          spaces: true,
          pick: true,
          editor: {
            kind: 'text',
            position: line,
            rotation: angle,
            height,
            width: 0,
            attachment: attachmentOf(j.h, j.v),
            style: style.handle,
            fontFile: style.font,
            trueTypeFlags: style.trueTypeFlags,
          },
        });
        if (a.kind === 'point') {
          // A click elsewhere: the next line starts there, as in AutoCAD's in-place TEXT
          // editor. A second point (Align, Fit) moves with it.
          if (second) second = add(second, { x: a.point.x - line.x, y: a.point.y - line.y }, 1);
          line = a.point;
          continue;
        }
        if (a.kind !== 'string' || a.value === '') return;
        const geom: TextGeometry = {
          kind: 'TEXT',
          value: a.value,
          style: style.handle,
          position: line,
          ...((j.h !== 0 || j.v !== 0) && { alignmentPoint: second ?? line }),
          height,
          rotation: angle,
          widthFactor: style.widthFactor,
          oblique: style.obliqueAngle,
          halign: j.h,
          valign: j.v,
          backward: (style.generation & 2) !== 0,
          upsideDown: (style.generation & 4) !== 0,
        };
        ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom }));
        last = {
          style: style.handle,
          justify,
          at: line,
          ...(second && { second }),
          height,
          rotation: angle,
        };
        line = add(line, down, step);
        if (second) second = add(second, down, step);
      }
    },
  };
}

/** MTEXT justifications as AutoCAD names them, in attachment order 1–9. */
const ATTACH = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'];

/** A line-spacing factor (`1.5x`) or distance (`4`), as a DXF 44 factor of single spacing. */
function spacingFactor(text: string, height: number): number | undefined {
  const t = text.trim();
  const m = /^([+]?(\d+\.?\d*|\.\d+))([xX]?)$/.exec(t);
  if (!m) return undefined;
  const v = Number(m[1]);
  if (!(v > 0)) return undefined;
  return m[3] ? v : v / (height * LINE_PITCH);
}

/**
 * MTEXT for one document. AutoCAD's prompts:
 *   Current text style: "Standard" Text height: 2.5 Annotative: No
 *   Specify first corner:
 *   Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:
 * then the in-place editor. Columns are not offered yet (roadmap M2-07 leftovers). On the
 * command line, lines are entered one by one and an empty one ends, as in -MTEXT; what is typed
 * is contents as written, format codes included.
 */
export function mtextCommand(): CommandDef {
  let height: number | undefined;
  let rotation = 0;
  let attachment = 1;
  let spacing = { style: 1, factor: 1 };
  /** The last column settings given, the next defaults (AutoCAD keeps them in MTEXTCOLUMN). */
  let lastColumns: TextEditorColumns | undefined;
  return {
    name: 'MTEXT',
    dashVariant: true,
    async *run(ctx): CommandGenerator {
      const initial = currentTextStyle(ctx.model);
      if (!initial) {
        ctx.message('The drawing has no text style.');
        return;
      }
      let style: TextStyleRecord = initial;
      const prec = precision(ctx.model);
      const shownHeight = () =>
        style!.height > 0 ? style!.height : (height ?? textSize(ctx.model));
      ctx.message(
        `Current text style:  "${style.name}"  Text height:  ${formatNumber(
          shownHeight(),
          prec,
        )}  Annotative:  No`,
      );
      const a0 = yield ctx.prompt.point({ message: 'Specify first corner' });
      if (a0.kind !== 'point') return;
      const first = a0.point;

      let width: number | undefined;
      let opposite: Vec2 | undefined;
      let columns: TextEditorColumns | undefined;
      while (width === undefined) {
        const a = yield ctx.prompt.point({
          message: 'Specify opposite corner or',
          options: ['Height', 'Justify', 'Line spacing', 'Rotation', 'Style', 'Width', 'Columns'],
          rubberBand: { from: first, box: true },
        });
        if (a.kind === 'point') {
          opposite = a.point;
          const d = { x: a.point.x - first.x, y: a.point.y - first.y };
          width = Math.abs(d.x * Math.cos(rotation) + d.y * Math.sin(rotation));
          break;
        }
        if (a.kind !== 'keyword') return;
        switch (a.keyword) {
          case 'Height': {
            const h = yield ctx.prompt.distance({
              message: 'Specify height',
              base: first,
              default: { kind: 'distance', value: shownHeight() },
            });
            if (h.kind !== 'distance' || h.value <= 0) return;
            height = h.value;
            break;
          }
          case 'Justify': {
            const k = yield ctx.prompt.keyword({
              message: 'Enter justification',
              options: ATTACH,
              default: { kind: 'keyword', keyword: ATTACH[attachment - 1]! },
            });
            if (k.kind !== 'keyword') return;
            attachment = ATTACH.indexOf(k.keyword) + 1;
            break;
          }
          case 'Line spacing': {
            const k = yield ctx.prompt.keyword({
              message: 'Enter line spacing type',
              options: ['At least', 'Exactly'],
              default: {
                kind: 'keyword',
                keyword: spacing.style === 2 ? 'Exactly' : 'At least',
              },
            });
            if (k.kind !== 'keyword') return;
            const kind = k.keyword === 'Exactly' ? 2 : 1;
            for (;;) {
              const f = yield ctx.prompt.string({
                message: 'Enter line spacing factor or distance',
                default: { kind: 'string', value: `${spacing.factor}x` },
              });
              if (f.kind !== 'string') return;
              const factor = spacingFactor(f.value, shownHeight());
              if (factor !== undefined) {
                spacing = { style: kind, factor };
                break;
              }
              ctx.message('Requires a positive number or a factor such as 1.5x.');
            }
            break;
          }
          case 'Rotation': {
            const r = yield ctx.prompt.angle({
              message: 'Specify rotation angle',
              base: first,
              default: { kind: 'angle', value: rotation },
            });
            if (r.kind !== 'angle') return;
            rotation = r.value;
            break;
          }
          case 'Style': {
            const s: TextStyleRecord | undefined = yield* askStyle(ctx, style);
            if (!s) return;
            style = s;
            break;
          }
          case 'Width': {
            const w = yield ctx.prompt.distance({ message: 'Specify width', base: first });
            if (w.kind !== 'distance' || w.value < 0) return;
            width = w.value;
            break;
          }
          case 'Columns': {
            const c: TextEditorColumns | null | undefined = yield* askColumns(
              ctx,
              lastColumns,
              shownHeight(),
            );
            if (c === undefined) return;
            // With columns the box is set: its width is the column width, as Width sets it.
            if (c) {
              lastColumns = c;
              columns = c;
              width = c.width;
            }
            break;
          }
        }
      }

      // The insertion point: the box's point the attachment names. In the text's frame
      // (x along the rotation, y up), the box spans the two corners; with Width there is one
      // corner, which is the insertion point.
      const ux = { x: Math.cos(rotation), y: Math.sin(rotation) };
      const uy = { x: -Math.sin(rotation), y: Math.cos(rotation) };
      let position = first;
      if (opposite) {
        const d = { x: opposite.x - first.x, y: opposite.y - first.y };
        const lx = d.x * ux.x + d.y * ux.y;
        const ly = d.x * uy.x + d.y * uy.y;
        const col = (attachment - 1) % 3;
        const row = Math.floor((attachment - 1) / 3);
        const x = col === 0 ? Math.min(0, lx) : col === 1 ? lx / 2 : Math.max(0, lx);
        const y = row === 0 ? Math.max(0, ly) : row === 1 ? ly / 2 : Math.min(0, ly);
        position = add(add(first, ux, x), uy, y);
      }
      const h = style.height > 0 ? style.height : (height ?? textSize(ctx.model));

      let contents = '';
      const lines: string[] = [];
      for (;;) {
        const a = yield ctx.prompt.string({
          message: 'Enter text',
          spaces: true,
          ...(lines.length === 0 &&
            !ctx.dash && {
              editor: {
                kind: 'mtext' as const,
                position,
                rotation,
                height: h,
                width,
                attachment,
                style: style.handle,
                fontFile: style.font,
                trueTypeFlags: style.trueTypeFlags,
                widthFactor: style.widthFactor,
                obliqueAngle: style.obliqueAngle,
                lineSpacingStyle: spacing.style,
                lineSpacing: spacing.factor,
                ...(columns && { columns }),
              },
            }),
        });
        if (a.kind === 'string' && a.editor) {
          contents = a.value;
          if (a.columns !== undefined) columns = a.columns ?? undefined;
          break;
        }
        if (a.kind !== 'string' || a.value === '') {
          contents = lines.join('\\P');
          break;
        }
        lines.push(a.value);
      }
      if (contents === '') return;
      const props = currentProps(ctx.model);
      const s = style;
      const geom: MTextGeometry = {
        kind: 'MTEXT',
        contents,
        style: s.handle,
        position,
        height: h,
        width,
        rotation,
        attachment,
        direction: 1,
        lineSpacingStyle: spacing.style,
        lineSpacing: spacing.factor,
      };
      ctx.edit((b) => {
        b.addEntity({
          owner: ctx.space,
          ...props,
          geom: columns ? withColumns(geom, typedCount(columns, contents)) : geom,
        });
        if (s.height <= 0 && height !== undefined) b.setHeader('$TEXTSIZE', height);
      });
    },
  };
}

/**
 * MTEXT's Columns option, with the prompts of the "MTEXT (Command)" Columns option:
 *   Enter column type [Dynamic/Static/No columns] <Dynamic>:
 *   Static:  Specify total width / number of columns / gutter width / column height
 *   Dynamic: Specify column width / gutter width / column height
 * AutoCAD documents the values each asks for, not their defaults beyond the gutter's (five
 * times the text height, "Column Settings Dialog Box"); ours are the last values given, else a
 * column 6 heights wide and 25 high (our reading). Dynamic columns get auto height, all one
 * height; their count is what the text needs (`count` 1 until the editor or the contents say).
 * Null: No columns. Undefined: the command was ended.
 */
async function* askColumns(
  ctx: CommandContext,
  last: TextEditorColumns | undefined,
  height: number,
): AsyncGenerator<Prompt, TextEditorColumns | null | undefined, PromptAnswer> {
  const k = yield ctx.prompt.keyword({
    message: 'Enter column type',
    options: ['Dynamic', 'Static', 'No columns'],
    default: { kind: 'keyword', keyword: last?.type === 1 ? 'Static' : 'Dynamic' },
  });
  if (k.kind !== 'keyword') return undefined;
  if (k.keyword === 'No columns') return null;
  const staticCols = k.keyword === 'Static';
  const columnWidth = last?.width ?? 6 * height;
  const gutterWidth = last?.gutter ?? 5 * height;
  const columnCount = last?.type === 1 ? last.count : 2;
  const distance = async function* (
    message: string,
    value: number,
  ): AsyncGenerator<Prompt, number | undefined, PromptAnswer> {
    const a = yield ctx.prompt.distance({ message, default: { kind: 'distance', value } });
    return a.kind === 'distance' && a.value > 0 ? a.value : undefined;
  };
  let total: number | undefined;
  let count = 1;
  if (staticCols) {
    total = yield* distance(
      'Specify total width',
      columnCount * columnWidth + (columnCount - 1) * gutterWidth,
    );
    if (total === undefined) return undefined;
    const n = yield ctx.prompt.integer({
      message: 'Specify number of columns',
      default: { kind: 'number', value: columnCount },
    });
    if (n.kind !== 'number' || n.value < 1) return undefined;
    count = n.value;
  }
  const width = staticCols ? undefined : yield* distance('Specify column width', columnWidth);
  if (!staticCols && width === undefined) return undefined;
  let gutter: number | undefined;
  for (;;) {
    gutter = yield* distance('Specify gutter width', gutterWidth);
    if (gutter === undefined) return undefined;
    if (total === undefined || total - (count - 1) * gutter > 0) break;
    ctx.message('The gutters leave no room for the columns.');
  }
  const columnHeight = yield* distance('Specify column height', last?.height ?? 25 * height);
  if (columnHeight === undefined) return undefined;
  return {
    type: staticCols ? 1 : 2,
    count,
    width: total === undefined ? width! : (total - (count - 1) * gutter) / count,
    gutter,
    height: columnHeight,
  };
}

/**
 * Dynamic columns typed on the command line: at least one column per column break (`\N`), the
 * one count known without laying the text out. The editor answers the count it laid out.
 */
function typedCount(c: TextEditorColumns, contents: string): TextEditorColumns {
  if (c.type !== 2) return c;
  const breaks = contents.match(/\\\\|\\N/g)?.filter((m) => m === '\\N').length ?? 0;
  return { ...c, count: Math.max(c.count, breaks + 1) };
}

/**
 * An MTEXT with the editor's columns: its width is the column width, DXF 46 their height.
 * Manual heights (M2-26) give one height per column: a column the text added takes the last
 * one's (our reading: AutoCAD's editor starts a new column as tall as the one before it).
 */
function withColumns(g: MTextGeometry, c: TextEditorColumns | null): MTextGeometry {
  const { columns: old, ...rest } = g;
  if (!c) return rest;
  const manual = c.type === 2 && c.heights !== undefined && c.heights.length > 0;
  const heights = manual
    ? Array.from({ length: c.count }, (_, i) => c.heights![Math.min(i, c.heights!.length - 1)]!)
    : [];
  return {
    ...rest,
    width: c.width,
    definedHeight: manual ? Math.max(...heights) : c.height,
    columns: {
      type: c.type,
      count: c.count,
      flowReversed: c.flowReversed ?? old?.flowReversed ?? false,
      autoHeight: c.type === 2 && !manual,
      width: c.width,
      gutter: c.gutter,
      heights,
    },
  };
}

/** An MTEXT's columns as the editor shows them; undefined without columns. */
function editorColumns(g: MTextGeometry): TextEditorColumns | undefined {
  const c = g.columns;
  if (!c || (c.type !== 1 && c.type !== 2) || c.count < 1) return undefined;
  const manual = c.type === 2 && !c.autoHeight && c.heights.length > 0;
  return {
    type: c.type,
    count: c.count,
    width: c.width,
    gutter: c.gutter,
    height: g.definedHeight ?? (c.heights.length > 0 ? Math.max(...c.heights) : 0),
    ...(manual && { heights: [...c.heights] }),
    ...(c.flowReversed && { flowReversed: true }),
  };
}

const sameColumns = (a: TextEditorColumns | undefined, b: TextEditorColumns | null): boolean =>
  (!a && !b) ||
  (!!a &&
    !!b &&
    a.type === b.type &&
    a.count === b.count &&
    a.width === b.width &&
    a.gutter === b.gutter &&
    a.height === b.height &&
    (a.flowReversed ?? false) === (b.flowReversed ?? false) &&
    JSON.stringify(a.heights ?? []) === JSON.stringify(b.heights ?? []));

/**
 * The MTEXT editor opened on an MTEXT (TEXTEDIT, M2-07 part 2) or on a multiline attribute's
 * embedded MTEXT (EATTEDIT, M2-12): holding its contents, where and as it is drawn.
 */
export function mtextEditorRequest(model: DocumentModel, g: MTextGeometry): TextEditorRequest {
  const style = model.tables.textStyles.get(g.style);
  const cols = editorColumns(g);
  const background = editorBackground(g);
  return {
    kind: 'mtext',
    position: g.position,
    rotation: g.rotation,
    height: g.height,
    width: g.width,
    attachment: g.attachment,
    style: g.style,
    fontFile: style?.font ?? '',
    trueTypeFlags: style?.trueTypeFlags ?? 0,
    widthFactor: style?.widthFactor ?? 1,
    obliqueAngle: style?.obliqueAngle ?? 0,
    value: g.contents,
    lineSpacingStyle: g.lineSpacingStyle,
    lineSpacing: g.lineSpacing,
    ...(cols && { columns: cols }),
    ...(background && { background }),
  };
}

/**
 * The background mask and frame the MTEXT editor shows (M2-44), as the renderer draws them:
 * DXF 90 bit 1 fills in the colour, bit 2 in the drawing window colour (no colour here), bit 16
 * frames; each (scale − 1) × height beyond the text box, a scale under 1 taken as 1.
 */
function editorBackground(g: MTextGeometry): TextEditorBackground | undefined {
  const bg = g.background;
  if (!bg) return undefined;
  const pad = (scale: number) => (Math.max(1, scale) - 1) * g.height;
  const mask = (bg.flags & 3) !== 0;
  const frame = (bg.flags & 16) !== 0;
  if (!mask && !frame) return undefined;
  const color = (bg.flags & 2) === 0 ? bg.color : undefined;
  return {
    ...(mask && { mask: { ...(color && { color }), pad: pad(bg.scale) } }),
    ...(frame && { frame: { pad: pad(bg.frameScale ?? bg.scale) } }),
  };
}

/** An edit TEXTEDIT made, for its Undo: the object as it was. */
interface TextEdit {
  readonly id: EntityId;
  readonly before: Entity;
  readonly erased: boolean;
}

/**
 * TEXTEDIT (DDEDIT, ED) for one document, as AutoCAD 2024's "TEXTEDIT (Command)":
 *   Current settings: Edit mode = Multiple
 *   Select an annotation object or [Undo/Mode]:
 * A TEXT opens the in-place line editor holding its value, an MTEXT the MTEXT editor holding
 * its contents (`TextEditorRequest.value`); the editor answers with the whole new text. Mode is
 * TEXTEDITMODE: Multiple (AutoCAD's default) asks for the next object until Enter, Single ends
 * after one. Undo takes back the command's last edit. A double click on a text runs it too
 * (`DOUBLE_CLICK`, with the text as the pre-selection).
 *
 * Where AutoCAD's documentation is silent: a TEXT left empty is erased, as an emptied MTEXT is
 * (the common drafter expectation; a TEXT with no characters can be neither seen nor picked).
 * An ATTDEF opens the Edit Attribute Definition dialog (M2-12); dimension and table text are
 * edited by their own tasks (M2-11, M4).
 */
export function textEditCommand(): CommandDef {
  let multiple = true;
  return {
    name: 'TEXTEDIT',
    aliases: ['DDEDIT'],
    usesSelection: 'before',
    async *run(ctx): CommandGenerator {
      ctx.message(`Current settings: Edit mode = ${multiple ? 'Multiple' : 'Single'}`);
      const done: TextEdit[] = [];
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select an annotation object or',
          options: ['Undo', 'Mode'],
          editable: true,
          single: true,
          pickfirst: true,
        });
        if (a.kind === 'keyword' && a.keyword === 'Undo') {
          const last = done.pop();
          if (!last) {
            ctx.message('Everything has been undone.');
            continue;
          }
          ctx.edit((b) => {
            if (last.erased) b.restoreEntity(last.before);
            else b.updateEntity(last.id, { geom: last.before.geom });
          });
          // A dimension is drawn again with its old text.
          if ('dimType' in last.before.geom) await regenerateDimensions(ctx, [last.id]);
          continue;
        }
        if (a.kind === 'keyword' && a.keyword === 'Mode') {
          const m = yield ctx.prompt.keyword({
            message: 'Enter a text edit mode option',
            options: ['Single', 'Multiple'],
            default: { kind: 'keyword', keyword: multiple ? 'Multiple' : 'Single' },
          });
          if (m.kind !== 'keyword') return;
          multiple = m.keyword === 'Multiple';
          continue;
        }
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        const entity = a.ids.map((id) => ctx.model.entity(id)).find((e) => e && textEdited(e));
        if (!entity) {
          ctx.message(
            'The object selected is not text, multiline text, a multileader or a dimension.',
          );
          continue;
        }
        const edited =
          entity.geom.kind === 'ATTDEF'
            ? yield* editAttdef(ctx, entity)
            : entity.geom.kind === 'MULTILEADER'
              ? yield* editMultiLeader(ctx, entity)
              : 'dimType' in entity.geom
                ? yield* editDimension(ctx, entity)
                : yield* editText(ctx, entity);
        if (edited === undefined) return;
        if (edited) done.push(edited);
        if (!multiple) return;
      }
    },
  };
}

/**
 * What TEXTEDIT edits: text, multiline text, attribute definitions (M2-12), the text of
 * dimensions (M2-11) and of multileaders (M2-25).
 */
const TEXTEDIT_KINDS = new Set([
  'TEXT',
  'MTEXT',
  'ATTDEF',
  'DIMENSION',
  'ARC_DIMENSION',
  'LARGE_RADIAL_DIMENSION',
]);

/**
 * Whether TEXTEDIT edits `e`: a multileader when its content is text, or a block stating
 * attribute values (M2-44: those open the Edit Attributes dialog).
 */
export function textEdited(e: Entity): boolean {
  if (e.geom.kind === 'MULTILEADER') {
    const g = e.geom;
    if (g.contentType === MLEADER_BLOCK)
      return g.block?.attributes?.some((a) => a.definition !== undefined) ?? false;
    return g.contentType === MLEADER_MTEXT && g.text !== undefined;
  }
  return TEXTEDIT_KINDS.has(e.geom.kind);
}

/**
 * TEXTEDIT on a multileader (M2-25; AutoCAD 2024: a multileader's text opens in the In-Place
 * Text Editor): its text in the MTEXT editor where it draws. The leader keeps its landing; text
 * a style always left-justifies (MLEADERSTYLE "Always left justify") on the left of its landing
 * keeps its right edge there, so it moves by the change in its width, which the renderer
 * measures.
 *
 * Where AutoCAD's documentation is silent: text emptied in the editor is kept as it was (a
 * multileader of text with no text is neither seen nor picked by its text, and erasing it is
 * ERASE's), and the drafter is told so.
 */
async function* editMultiLeader(
  ctx: CommandContext,
  entity: Entity,
): AsyncGenerator<Prompt, TextEdit | false | undefined, PromptAnswer> {
  const g = entity.geom as MultiLeaderGeometry;
  if (g.contentType === MLEADER_BLOCK) {
    const before = yield* editMultiLeaderAttributes(ctx, entity);
    return before ? { id: entity.id, before, erased: false } : before;
  }
  const t = g.text!;
  const background = multiLeaderBackground(g, t);
  const a = yield ctx.prompt.string({
    message: 'Enter text',
    spaces: true,
    editor: mtextEditorRequest(ctx.model, {
      ...multiLeaderMText(t),
      ...(background && { background }),
    }),
  });
  if (a.kind === 'enter') return false;
  if (a.kind !== 'string') return undefined;
  if (a.value === t.content) return false;
  if (a.value === '') {
    ctx.message('A multileader’s text cannot be empty: ERASE removes the multileader.');
    return false;
  }
  let position = t.position;
  const style = g.style === undefined ? undefined : ctx.model.tables.mleaderStyles.get(g.style);
  const leftOfLanding =
    g.branches.length > 0 && g.branches.every((b) => b.direction.x < 0 && b.direction.y === 0);
  if (style?.textAlignAlwaysLeft && leftOfLanding && t.attachment % 3 === 1) {
    const width = async (contents: string) => {
      const r = await ctx.view.request({
        op: 'textBox',
        text: { ...multiLeaderMText(t), contents },
      });
      return r.ok && r.box ? r.box.maxX - r.box.minX : undefined;
    };
    const before = await width(t.content);
    const after = await width(a.value);
    if (before !== undefined && after !== undefined)
      position = { x: position.x - (after - before), y: position.y };
  }
  const geom: MultiLeaderGeometry = { ...g, text: { ...t, content: a.value, position } };
  ctx.edit((b) => b.updateEntity(entity.id, { geom }));
  return { id: entity.id, before: entity, erased: false };
}

/**
 * A dimension's text as the MTEXT editor edits it (M2-11): `contents` with `<>` for the
 * measurement, at `at`, DIMTXT high (times DIMSCALE), in DIMTXSTY's text style.
 */
export function dimensionTextEditor(
  model: DocumentModel,
  dim: Pick<NewDimension, 'style' | 'textRotation' | 'lineSpacingStyle' | 'lineSpacing'>,
  at: Vec2,
  contents: string,
  xdata?: Entity['xdata'],
  measurement?: string,
): TextEditorRequest {
  const vars = model.tables.dimStyles.get(dim.style)?.vars ?? {};
  const own = typeof vars.DIMTXSTY === 'string' ? vars.DIMTXSTY : undefined;
  const style =
    own !== undefined && model.tables.textStyles.has(own)
      ? own
      : (currentTextStyle(model)?.handle ?? '');
  const request = mtextEditorRequest(model, {
    kind: 'MTEXT',
    contents,
    style,
    position: at,
    height: dimensionTextHeight(model, dim, xdata),
    width: 0,
    rotation: dim.textRotation,
    attachment: 5,
    direction: 1,
    lineSpacingStyle: dim.lineSpacingStyle,
    lineSpacing: dim.lineSpacing,
  });
  return measurement === undefined ? request : { ...request, measurement };
}

/**
 * A dimension's text override (DXF 1) from what the MTEXT editor answers: `<>` alone, or
 * nothing, is the measurement alone, stored empty, as AutoCAD restores the measurement when
 * the text is cleared.
 */
export const dimensionOverride = (contents: string): string => {
  const t = contents.trim();
  return t === '<>' || t === '' ? '' : contents;
};

/**
 * TEXTEDIT on a dimension (AutoCAD 2024: "TEXTEDIT (Command)", a dimension's text opens in the
 * In-Place Text Editor): its override with `<>` the measurement. The dimension is drawn again.
 */
async function* editDimension(
  ctx: CommandContext,
  entity: Entity,
): AsyncGenerator<Prompt, TextEdit | false | undefined, PromptAnswer> {
  const g = entity.geom as DimensionGeometry;
  const a = yield ctx.prompt.string({
    message: 'Enter text',
    spaces: true,
    editor: dimensionTextEditor(
      ctx.model,
      g,
      g.textPosition,
      g.text === '' ? '<>' : g.text,
      entity.xdata,
      ctx.dimensions?.(entity, ctx.model, () => 0)?.measurement,
    ),
  });
  if (a.kind === 'enter') return false;
  if (a.kind !== 'string') return undefined;
  const text = dimensionOverride(a.value);
  if (text === g.text) return false;
  ctx.edit((b) => b.updateEntity(entity.id, { geom: { ...g, text } }));
  await regenerateDimensions(ctx, [entity.id]);
  return { id: entity.id, before: entity, erased: false };
}

/**
 * An ATTDEF in AutoCAD's Edit Attribute Definition dialog (TEXTEDIT on an attribute definition,
 * M2-12): its tag, prompt and default. A tag is stored in upper case and may hold no spaces, as
 * AutoCAD's ATTDEF takes it; one it refuses shows the dialog again. A multiline definition's
 * default is its MTEXT's contents, also edited in the MTEXT editor from the dialog's `...`.
 */
async function* editAttdef(
  ctx: CommandContext,
  entity: Entity,
): AsyncGenerator<Prompt, TextEdit | false, PromptAnswer> {
  let g = entity.geom as AttdefGeometry;
  for (;;) {
    const d = yield ctx.prompt.dialog({
      message: 'Edit Attribute Definition',
      dialog: {
        type: 'attdef',
        tag: g.tag,
        prompt: g.prompt,
        value: g.mtext ? g.mtext.contents : g.value,
        multiline: g.mtext !== undefined,
      },
    });
    // Enter on the command line closes it unchanged; the dialog answers otherwise.
    if (d.kind !== 'dialog') return false;
    const f = d.attdef;
    if (f) {
      const tag = f.tag.trim().toUpperCase();
      if (tag === '' || /\s/.test(tag)) {
        ctx.message('Invalid attribute tag: it must hold at least one character and no spaces.');
        continue;
      }
      g = {
        ...g,
        tag,
        prompt: f.prompt,
        ...(g.mtext ? { mtext: { ...g.mtext, contents: f.value } } : { value: f.value }),
      };
    }
    if (d.action === 'mtext' && g.mtext) {
      const a = yield ctx.prompt.string({
        message: 'Enter default value',
        spaces: true,
        editor: mtextEditorRequest(ctx.model, g.mtext),
      });
      // The editor answers the contents; Enter on the command line keeps them.
      if (a.kind === 'string') g = { ...g, mtext: { ...g.mtext, contents: a.value } };
      continue;
    }
    break;
  }
  if (JSON.stringify(g) === JSON.stringify(entity.geom)) return false;
  ctx.edit((b) => b.updateEntity(entity.id, { geom: g }));
  return { id: entity.id, before: entity, erased: false };
}

/**
 * Opens the editor on one TEXT or MTEXT and applies what comes back. Returns the edit, false
 * when the text came back unchanged, undefined when the command was ended.
 */
/**
 * The Properties palette's `...` on an MTEXT's Contents (M2-35 part 9) or a multileader's (part
 * 11): the In-Place Text Editor on `entity`, as TEXTEDIT opens it; whether the contents changed.
 */
export async function* editContents(
  ctx: CommandContext,
  entity: Entity,
): AsyncGenerator<Prompt, boolean, PromptAnswer> {
  if (entity.geom.kind === 'MULTILEADER') return Boolean(yield* editMultiLeader(ctx, entity));
  return Boolean(yield* editText(ctx, entity));
}

async function* editText(
  ctx: CommandContext,
  entity: Entity,
): AsyncGenerator<Prompt, TextEdit | false | undefined, PromptAnswer> {
  const g = entity.geom as TextGeometry | MTextGeometry;
  const style = ctx.model.tables.textStyles.get(g.style);
  const font = {
    fontFile: style?.font ?? '',
    trueTypeFlags: style?.trueTypeFlags ?? 0,
    widthFactor: style?.widthFactor ?? 1,
    obliqueAngle: style?.obliqueAngle ?? 0,
  };
  const old = g.kind === 'TEXT' ? g.value : g.contents;
  const cols = g.kind === 'MTEXT' ? editorColumns(g) : undefined;
  const a = yield ctx.prompt.string({
    message: 'Enter text',
    spaces: true,
    editor:
      g.kind === 'TEXT'
        ? {
            kind: 'text',
            // The point the justification names: DXF 10 for left-baseline text, else DXF 11.
            position:
              g.halign === 0 && g.valign === 0 ? g.position : (g.alignmentPoint ?? g.position),
            rotation: g.rotation,
            height: g.height,
            width: 0,
            attachment: attachmentOf(g.halign, g.valign),
            style: g.style,
            ...font,
            value: old,
          }
        : mtextEditorRequest(ctx.model, g),
  });
  if (a.kind === 'enter') return false;
  if (a.kind !== 'string') return undefined;
  // Columns the editor left as they were stay as written (manual heights, flow direction).
  const newColumns =
    g.kind === 'MTEXT' && a.columns !== undefined && !sameColumns(cols, a.columns)
      ? a.columns
      : undefined;
  if (a.value === old && newColumns === undefined) return false;
  if (a.value === '') {
    ctx.edit((b) => b.removeEntity(entity.id));
    return { id: entity.id, before: entity, erased: true };
  }
  const geom =
    g.kind === 'TEXT'
      ? { ...g, value: a.value }
      : newColumns !== undefined
        ? withColumns({ ...g, contents: a.value }, newColumns)
        : { ...g, contents: a.value };
  ctx.edit((b) => b.updateEntity(entity.id, { geom }));
  return { id: entity.id, before: entity, erased: false };
}
