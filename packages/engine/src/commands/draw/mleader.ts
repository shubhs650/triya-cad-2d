// MLEADER, MLEADEREDIT, AIMLEADEREDITADD and AIMLEADEREDITREMOVE (M2-09), with AutoCAD 2024's
// prompts ("MLEADER (Command)", "MLEADEREDIT (Command)", AutoCAD 2024 Help):
//   Specify leader arrowhead location or [leader Landing first/Content first/Options] <Options>:
//   Specify leader landing location:          (Specify next point: first, with Maxpoints > 2)
// then the content: MTEXT's in-place editor, or the block's attribute values. The mode chosen
// (arrowhead, landing or content first) and the Options stay for the next MLEADER of the
// drawing, as in AutoCAD, until the current style changes. A multileader takes the current
// MLEADERSTYLE (CMLEADERSTYLE); a drawing without one gets AutoCAD's Standard style.
// The geometry, and the readings taken where AutoCAD is silent, are in edit/mleader.ts.
import type { Box } from '../../geom/bounds';
import type { Vec2 } from '../../geom/types';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type {
  AttdefGeometry,
  MLeaderStyleRecord,
  MTextGeometry,
  MultiLeaderAttribute,
  MultiLeaderGeometry,
  TextStyleRecord,
} from '../../model/types';
import type { ChangeSetBuilder } from '../../model/builder';
import {
  MLEADER_BLOCK,
  MLEADER_MTEXT,
  addLeaderLine,
  attachmentRow,
  blockAnchor,
  blockContentBox,
  blockExtentsOf,
  blockScaleOf,
  constrainSegment,
  currentMLeaderStyle,
  landingAt,
  multiLeaderMText,
  landingTo,
  newMultiLeader,
  removeLeaderLine,
  settingsOf,
  standardLinetype,
  standardMLeaderStyle,
  textAnchor,
  type Landing,
  type MLeaderSettings,
  type NewMultiLeader,
} from '../../edit/mleader';
import {
  BUILTIN_MLEADER_BLOCKS,
  addBuiltinMLeaderBlock,
  builtinMLeaderBlock,
  builtinMLeaderBlockName,
  type BuiltinMLeaderBlock,
} from '../../edit/mleader-blocks';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { currentProps } from '../../properties/current';
import { currentTextStyle } from './text';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The keyword a prompt with a keyword default answered. */
const keyword = (a: PromptAnswer): string => (a as { readonly keyword: string }).keyword;
type Mode = 'arrow' | 'landing' | 'content';

const MODE_OPTION: Readonly<Record<Mode, string>> = {
  arrow: 'leader arrowHead first',
  landing: 'leader Landing first',
  content: 'Content first',
};

const OPTIONS = [
  'Leader type',
  'leader lAnding',
  'Content type',
  'Maxpoints',
  'First angle',
  'Second angle',
  'eXit options',
];
const PATH_TYPES = ['None', 'Straight', 'sPline'];
const CONTENT_TYPES = ['None', 'Block', 'Mtext'];

/** The blocks a drafter may name: not model or paper space, not anonymous. */
function namedBlock(model: DocumentModel, name: string): Handle | undefined {
  const n = name.trim().toUpperCase();
  for (const [h, b] of model.blocks) {
    if (b.name.startsWith('*')) continue;
    if (b.name.toUpperCase() === n) return h;
  }
  return undefined;
}

/** A multileader as MLEADER builds it, with the built-in block to author for it, if any. */
type Made = Omit<NewMultiLeader, 'style' | 'settings' | 'scale'> & {
  readonly builtin?: BuiltinMLeaderBlock;
};

/** A block content: one of the drawing's, or a built-in one (M2-25) the drawing lacks. */
type BlockChoice = { readonly handle: Handle } | { readonly builtin: string };

/**
 * "Enter block name or [?]": a block of the drawing, or one of AutoCAD's built-in content
 * blocks the drawing lacks (authored with the multileader); undefined when the command ends.
 */
async function* askBlock(
  ctx: CommandContext,
  current: string | undefined,
): Sub<BlockChoice | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter block name or',
      options: ['?'],
      ...(current !== undefined && { default: { kind: 'string', value: current } }),
    });
    if (a.kind === 'keyword') {
      ctx.message('Defined blocks:');
      const names = [...ctx.model.blocks.values()]
        .map((b) => b.name)
        .filter((n) => !n.startsWith('*'))
        .sort();
      for (const n of names) ctx.message(`  ${n}`);
      ctx.message('Built-in blocks:');
      for (const n of BUILTIN_MLEADER_BLOCKS) ctx.message(`  ${n}`);
      continue;
    }
    // Enter without a default ends the command; otherwise the answer is the name.
    const typed = (a as { readonly value?: string }).value;
    if (typed === undefined) return undefined;
    const h = namedBlock(ctx.model, typed);
    if (h !== undefined) return { handle: h };
    const builtin = builtinMLeaderBlockName(typed);
    if (builtin !== undefined) return { builtin };
    ctx.message(`Block "${typed.trim()}" not found.`);
  }
}

/** The name the settings' block content goes by, for the block name prompt's default. */
function blockNameOf(model: DocumentModel, o: MLeaderSettings): string | undefined {
  if (o.builtinBlock !== undefined) return o.builtinBlock;
  return o.block === undefined ? undefined : model.blocks.get(o.block)?.name;
}

/** Settings whose block content is `choice`. */
function withBlock(o: MLeaderSettings, choice: BlockChoice): MLeaderSettings {
  const { block: _b, builtinBlock: _n, ...rest } = o;
  return 'handle' in choice
    ? { ...rest, block: choice.handle }
    : { ...rest, builtinBlock: choice.builtin };
}

/**
 * The block content as the multileader is built: a block of the drawing, or a built-in block
 * to author with it (its extents and attribute definitions known before it is in the drawing).
 */
interface ContentBlock {
  readonly handle?: Handle;
  readonly builtin?: BuiltinMLeaderBlock;
}

/** The block content of settings `o`, or undefined when its block is not in the drawing. */
function contentBlockOf(
  model: DocumentModel,
  style: MLeaderStyleRecord,
  o: MLeaderSettings,
  choice?: BlockChoice,
): ContentBlock | undefined {
  const c: BlockChoice | undefined =
    choice ??
    (o.builtinBlock !== undefined
      ? { builtin: o.builtinBlock }
      : o.block !== undefined && model.blocks.has(o.block)
        ? { handle: o.block }
        : undefined);
  if (!c) return undefined;
  if ('handle' in c) return { handle: c.handle };
  // Added since it was chosen (by an earlier multileader): the drawing's own is used.
  const there = namedBlock(model, c.builtin);
  if (there !== undefined) return { handle: there };
  const h =
    style.textHeight > 0 ? style.textHeight : model.meta.measurement === 'imperial' ? 0.18 : 4;
  const ts = textStyleFor(model, style);
  if (!ts) return undefined;
  const builtin = builtinMLeaderBlock(c.builtin, h, ts.handle);
  return builtin && { builtin };
}

/** The block content of settings `o`; asks for another block when the style's is missing. */
async function* askContentBlock(
  ctx: CommandContext,
  style: MLeaderStyleRecord,
  o: MLeaderSettings,
): Sub<ContentBlock | undefined> {
  const known = contentBlockOf(ctx.model, style, o);
  if (known) return known;
  ctx.message('The style’s block is not in the drawing.');
  const choice: BlockChoice | undefined = yield* askBlock(ctx, undefined);
  if (choice === undefined) return undefined;
  return contentBlockOf(ctx.model, style, o, choice);
}

/** A block content's extents about its base point. */
const extentsOf = (model: DocumentModel, b: ContentBlock): Box | undefined =>
  b.builtin ? b.builtin.extents : blockExtentsOf(model, b.handle!);

/** Where a built-in block is not in the drawing yet: a stand-in for its handle until it is. */
const UNAUTHORED: Handle = '';

/**
 * Authors the multileader's built-in block, if it has one, and points its content and attribute
 * values at it. Returns the multileader as it is to be added.
 */
function authorBlock(b: ChangeSetBuilder, model: DocumentModel, made: Made): Omit<Made, 'builtin'> {
  const { builtin, ...rest } = made;
  if (!rest.block || !builtin) return rest;
  const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
  const authored = addBuiltinMLeaderBlock(b, builtin, zero);
  return {
    ...rest,
    block: {
      ...rest.block,
      block: authored.block,
      attributes: rest.block.attributes.map((a) => ({
        ...a,
        definition: authored.attdefs[a.index]!,
      })),
    },
  };
}

/** The ATTDEFs a block's content asks values for: all but the constant ones, in order. */
function attributeDefinitions(model: DocumentModel, block: ContentBlock) {
  const out: { handle: Handle; geom: AttdefGeometry }[] = [];
  if (block.builtin) {
    for (const geom of block.builtin.attdefs) out.push({ handle: UNAUTHORED, geom });
    return out;
  }
  for (const id of model.blockEntities(block.handle!)) {
    const e = model.entity(id)!;
    if (e.geom.kind === 'ATTDEF' && (e.geom.flags & 2) === 0)
      out.push({ handle: e.handle, geom: e.geom });
  }
  return out;
}

/** "Enter attribute values", one prompt per attribute, the definition's value the default. */
async function* askAttributes(
  ctx: CommandContext,
  block: ContentBlock,
): Sub<MultiLeaderAttribute[]> {
  const defs = attributeDefinitions(ctx.model, block);
  if (defs.length > 0) ctx.message('Enter attribute values');
  const out: MultiLeaderAttribute[] = [];
  for (const [i, d] of defs.entries()) {
    const a = yield ctx.prompt.string({
      message: d.geom.prompt || d.geom.tag,
      spaces: true,
      default: { kind: 'string', value: d.geom.value },
    });
    // The prompt has a default, so the answer is text. DXF 44 "attribute width": ezdxf, which
    // writes these, states 1.
    const value = (a as { readonly value: string }).value;
    out.push({ definition: d.handle, index: i, width: 1, value });
  }
  return out;
}

/** The text style multileader text takes: the style's, else the drawing's current one. */
function textStyleFor(
  model: DocumentModel,
  style: MLeaderStyleRecord,
): TextStyleRecord | undefined {
  const own =
    style.textStyle === undefined ? undefined : model.tables.textStyles.get(style.textStyle);
  return own ?? currentTextStyle(model);
}

/** The box the renderer measures an MTEXT to fill; undefined without a canvas or fonts. */
async function measured(ctx: CommandContext, text: MTextGeometry): Promise<Box | undefined> {
  const r = await ctx.view.request({ op: 'textBox', text });
  return r.ok ? r.box : undefined;
}

/** The text's contents: from the in-place editor at once, or line by line on the command line. */
async function* askContents(
  ctx: CommandContext,
  request: {
    position: Vec2;
    height: number;
    width: number;
    attachment: number;
    style: TextStyleRecord;
  },
): Sub<string | undefined> {
  const lines: string[] = [];
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter text',
      spaces: true,
      ...(lines.length === 0 && {
        editor: {
          kind: 'mtext' as const,
          position: request.position,
          rotation: 0,
          height: request.height,
          width: request.width,
          attachment: request.attachment,
          style: request.style.handle,
          fontFile: request.style.font,
          trueTypeFlags: request.style.trueTypeFlags,
        },
      }),
    });
    // Esc ends the command; the answer is text, or Enter, which ends the text as an empty line.
    const t = a as { readonly value?: string; readonly editor?: true };
    if (t.editor) return t.value;
    if (!t.value) return lines.join('\\P');
    lines.push(t.value);
  }
}

/**
 * `base`, or `base` followed by the first number that makes it free (Standard1, Standard2, …),
 * when the drawing keeps an entry of that name it does not map (`keptEntryNames`, M2-29) or has
 * a style of that name. Names are compared without regard to case, as AutoCAD's.
 */
function freeStyleName(model: DocumentModel, base: string): string {
  const taken = new Set(
    [
      ...(model.meta.keptEntryNames?.mleaderStyles ?? []),
      ...[...model.tables.mleaderStyles.values()].map((s) => s.name),
    ].map((n) => n.toUpperCase()),
  );
  if (!taken.has(base.toUpperCase())) return base;
  for (let i = 1; ; i++) if (!taken.has(`${base}${i}`.toUpperCase())) return `${base}${i}`;
}

/**
 * MLEADER for one document. Content first places the content before the leader: the text in a
 * box dragged as MTEXT's (its width wraps the text), or the block at a point; the arrowhead then
 * says which side of it the landing goes.
 */
export function mleaderCommand(): CommandDef {
  let mode: Mode = 'arrow';
  let settings: MLeaderSettings | undefined;
  let settingsFor: Handle | undefined;

  return {
    name: 'MLEADER',
    async *run(ctx): CommandGenerator {
      const model = ctx.model;
      const existing = currentMLeaderStyle(model);
      const text = currentTextStyle(model);
      // A multileader style names a text style, and the save writes none without one (an R1 or
      // R2.5 drawing has no text styles; AutoCAD's always have STANDARD, so it never says this).
      if (!existing && !text) {
        ctx.message('The drawing has no text style, which a multileader style needs.');
        return;
      }
      // A drawing without multileader styles gets AutoCAD's Standard when the leader is made.
      const style: MLeaderStyleRecord = existing ?? {
        handle: '',
        ...standardMLeaderStyle(
          model.meta.measurement !== 'imperial',
          text?.handle,
          standardLinetype(model),
        ),
        name: freeStyleName(model, 'Standard'),
      };
      if (!settings || settingsFor !== style.handle) {
        settings = settingsOf(style);
        settingsFor = style.handle;
      }
      const scale = style.scale > 0 ? style.scale : 1;
      if (style.annotative) {
        ctx.message('Annotative multileaders are not made yet: this one takes the style’s scale.');
      }

      for (;;) {
        const o: MLeaderSettings = settings;
        const contentFirst = mode === 'content' && o.contentType !== 0;
        const message = contentFirst
          ? o.contentType === MLEADER_MTEXT
            ? 'Specify first corner of text'
            : 'Specify location of block'
          : mode === 'landing'
            ? 'Specify leader landing location'
            : 'Specify leader arrowhead location';
        const shown: Mode = contentFirst ? 'content' : mode === 'content' ? 'arrow' : mode;
        const others = (['arrow', 'landing', 'content'] as const)
          .filter((m) => m !== shown)
          .map((m) => MODE_OPTION[m]);
        const a = yield ctx.prompt.point({
          message: `${message} or`,
          options: [...others, 'Options'],
          default: { kind: 'keyword', keyword: 'Options' },
        });
        if (a.kind === 'keyword') {
          if (a.keyword === 'Options') {
            const next: MLeaderSettings | undefined = yield* options(ctx, o);
            if (!next) return;
            settings = next;
            continue;
          }
          mode = (Object.keys(MODE_OPTION) as Mode[]).find((m) => MODE_OPTION[m] === a.keyword)!;
          continue;
        }
        // The prompt's default is Options, so anything else is a point.
        const at = (a as { readonly point: Vec2 }).point;
        let made: Made | undefined;
        if (contentFirst) made = yield* contentFirstLeader(ctx, style, o, scale, at);
        else made = yield* leaderFirst(ctx, style, o, scale, mode === 'landing', at);
        if (!made) return;
        const props = currentProps(model);
        const content = made;
        let authored: Handle | undefined;
        ctx.edit((b) => {
          const { handle: _none, ...standard } = style;
          const s = existing ?? b.addTableRecord('mleaderStyles', standard);
          const leader = authorBlock(b, model, content);
          if (content.builtin) authored = leader.block?.block;
          const geom = newMultiLeader({
            ...leader,
            style: { ...style, handle: s.handle },
            settings: o,
            scale,
          });
          b.addEntity({ owner: ctx.space, ...props, geom });
        });
        // The next multileader takes the block now in the drawing.
        if (authored !== undefined && o.builtinBlock !== undefined) {
          settings = withBlock(o, { handle: authored });
        }
        return;
      }
    },
  };
}

/**
 * The Options sub-prompt: "Enter an option [Leader type/leader lAnding/Content type/
 * Maxpoints/First angle/Second angle/eXit options] <eXit options>:". Undefined when ended.
 */
async function* options(
  ctx: CommandContext,
  start: MLeaderSettings,
): Sub<MLeaderSettings | undefined> {
  let o = start;
  for (;;) {
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options: OPTIONS,
      default: { kind: 'keyword', keyword: 'eXit options' },
    });
    // Every prompt here but the block name's has a default, so its answer is of its own kind.
    switch ((a as { readonly keyword: string }).keyword) {
      case 'Leader type': {
        const k = yield ctx.prompt.keyword({
          message: 'Select a leader type',
          options: ['Straight', 'sPline', 'None'],
          default: { kind: 'keyword', keyword: PATH_TYPES[o.pathType]! },
        });
        o = { ...o, pathType: PATH_TYPES.indexOf(keyword(k)) };
        break;
      }
      case 'leader lAnding': {
        const k = yield ctx.prompt.keyword({
          message: 'Use landing',
          options: ['Yes', 'No'],
          default: { kind: 'keyword', keyword: o.landing ? 'Yes' : 'No' },
        });
        o = { ...o, landing: keyword(k) === 'Yes' };
        break;
      }
      case 'Content type': {
        const k = yield ctx.prompt.keyword({
          message: 'Select a content type',
          options: ['Block', 'Mtext', 'None'],
          default: { kind: 'keyword', keyword: CONTENT_TYPES[o.contentType]! },
        });
        const type = CONTENT_TYPES.indexOf(keyword(k));
        if (type === MLEADER_BLOCK) {
          const block: BlockChoice | undefined = yield* askBlock(ctx, blockNameOf(ctx.model, o));
          if (block === undefined) return undefined;
          o = { ...withBlock(o, block), contentType: type };
        } else o = { ...o, contentType: type };
        break;
      }
      case 'Maxpoints': {
        for (;;) {
          const n = yield ctx.prompt.integer({
            message: 'Enter the maximum points for leader line',
            default: { kind: 'number', value: o.maxPoints },
          });
          const v = (n as { readonly value: number }).value;
          if (v >= 2) {
            o = { ...o, maxPoints: v };
            break;
          }
          ctx.message('Value must be 2 or greater.');
        }
        break;
      }
      case 'First angle':
      case 'Second angle': {
        const first = keyword(a) === 'First angle';
        const r = yield ctx.prompt.angle({
          message: `Enter ${first ? 'first' : 'second'} angle constraint`,
          default: { kind: 'angle', value: first ? o.firstAngle : o.secondAngle },
        });
        const v = (r as { readonly value: number }).value;
        o = first ? { ...o, firstAngle: v } : { ...o, secondAngle: v };
        break;
      }
      default:
        return o;
    }
  }
}

/** Arrowhead first (and its further points) or landing first, then the content. */
async function* leaderFirst(
  ctx: CommandContext,
  style: MLeaderStyleRecord,
  o: MLeaderSettings,
  scale: number,
  landingFirst: boolean,
  start: Vec2,
): Sub<Made | undefined> {
  let points: Vec2[];
  let at: Vec2;
  if (landingFirst) {
    at = start;
    const a = yield ctx.prompt.point({
      message: 'Specify leader arrowhead location',
      rubberBand: { from: at },
    });
    if (a.kind !== 'point') return undefined;
    // The first angle constrains the segment at the arrowhead, whichever end came first.
    points = [constrainSegment(at, a.point, o.firstAngle)];
  } else {
    points = [start];
    let landing: Vec2 | undefined;
    // Further points while the leader has room for them: Enter makes the last the landing.
    while (!landing && points.length < o.maxPoints - 1) {
      const a = yield ctx.prompt.point({
        message: 'Specify next point',
        rubberBand: { from: points.at(-1)! },
      });
      if (a.kind === 'point') points.push(constrained(points, a.point, o));
      else if (points.length >= 2) landing = points.pop();
    }
    if (!landing) {
      const a = yield ctx.prompt.point({
        message: 'Specify leader landing location',
        rubberBand: { from: points.at(-1)! },
      });
      if (a.kind !== 'point') return undefined;
      landing = constrained(points, a.point, o);
    }
    at = landing;
  }
  const landing = landingAt(points.at(-1)!, at, style, o.landing, scale);
  const content = yield* contentAt(ctx, style, o, scale, landing);
  if (content === undefined) return undefined;
  return { vertices: points, landing, ...content };
}

/** A point constrained by the angle of the segment it ends: the first or the second. */
function constrained(points: readonly Vec2[], p: Vec2, o: MLeaderSettings): Vec2 {
  const step = points.length === 1 ? o.firstAngle : points.length === 2 ? o.secondAngle : 0;
  return constrainSegment(points.at(-1)!, p, step);
}

type Content = Pick<Made, 'text' | 'block' | 'builtin'>;

/** The content at the end of a landing: MTEXT from the editor, a block with its values, or none. */
async function* contentAt(
  ctx: CommandContext,
  style: MLeaderStyleRecord,
  o: MLeaderSettings,
  scale: number,
  landing: Landing,
): Sub<Content | undefined> {
  if (o.contentType === MLEADER_MTEXT) {
    const ts = textStyleFor(ctx.model, style);
    if (!ts) {
      ctx.message('The drawing has no text style.');
      return undefined;
    }
    let { position, attachment } = textAnchor(style, landing, scale);
    const height = style.textHeight * scale;
    const content: string | undefined = yield* askContents(ctx, {
      position,
      height,
      width: 0,
      attachment,
      style: ts,
    });
    if (!content) return undefined;
    // Text on the left of its landing is right-aligned, unless the style always left-justifies:
    // then it moves left by its width, which the renderer measures.
    if (style.textAlignAlwaysLeft && attachment % 3 === 0) {
      const box = await measured(ctx, {
        kind: 'MTEXT',
        contents: content,
        style: ts.handle,
        position,
        height,
        width: 0,
        rotation: 0,
        attachment,
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      });
      if (box) {
        position = { x: position.x - (box.maxX - box.minX), y: position.y };
        attachment -= 2;
      }
    }
    return { text: { content, style: ts.handle, position, attachment, width: 0 } };
  }
  if (o.contentType === MLEADER_BLOCK) {
    const block: ContentBlock | undefined = yield* askContentBlock(ctx, style, o);
    if (block === undefined) return undefined;
    const attributes: MultiLeaderAttribute[] = yield* askAttributes(ctx, block);
    const placed = blockScaleOf(style, scale);
    const position = blockAnchor(
      style,
      landing,
      extentsOf(ctx.model, block),
      placed.scale,
      placed.rotation,
    );
    return {
      block: { block: block.handle ?? UNAUTHORED, position, attributes },
      ...(block.builtin && { builtin: block.builtin }),
    };
  }
  return {};
}

/** Content first: the text's box or the block's location, then the arrowhead. */
async function* contentFirstLeader(
  ctx: CommandContext,
  style: MLeaderStyleRecord,
  o: MLeaderSettings,
  scale: number,
  first: Vec2,
): Sub<Made | undefined> {
  const gap = style.landingGap * scale;
  const vertical = style.textAttachmentDirection === 1;
  if (o.contentType === MLEADER_MTEXT) {
    const ts = textStyleFor(ctx.model, style);
    if (!ts) {
      ctx.message('The drawing has no text style.');
      return undefined;
    }
    const c = yield ctx.prompt.point({
      message: 'Specify opposite corner',
      rubberBand: { from: first, box: true },
    });
    if (c.kind !== 'point') return undefined;
    const box = {
      minX: Math.min(first.x, c.point.x),
      minY: Math.min(first.y, c.point.y),
      maxX: Math.max(first.x, c.point.x),
      maxY: Math.max(first.y, c.point.y),
    };
    const width = box.maxX - box.minX;
    const height = style.textHeight * scale;
    const content: string | undefined = yield* askContents(ctx, {
      position: { x: box.minX, y: box.maxY },
      height,
      width,
      attachment: 1,
      style: ts,
    });
    if (!content) return undefined;
    const a = yield ctx.prompt.point({ message: 'Specify leader arrowhead location' });
    if (a.kind !== 'point') return undefined;
    const arrow = a.point;
    const mid = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    let position: Vec2;
    let attachment: number;
    let landing: Landing;
    if (vertical) {
      // The text keeps its box; the leader meets its top or bottom centre a gap out.
      const above = arrow.y < mid.y;
      position = { x: mid.x, y: above ? box.minY : box.maxY };
      attachment = above ? 8 : 2;
      const end = { x: mid.x, y: above ? box.minY - gap : box.maxY + gap };
      landing = landingTo(end, { x: 0, y: above ? 1 : -1 }, style, scale);
    } else {
      // The text sits in the box by the row its attachment names (top, middle or bottom), on
      // the side facing the arrowhead: the landing meets the level the attachment names.
      const right = arrow.x < mid.x;
      const kind = right ? style.textLeftAttachment : style.textRightAttachment;
      const { row, dy } = attachmentRow(kind, height, gap);
      const y = row === 0 ? box.maxY : row === 1 ? mid.y : box.minY;
      position = { x: right ? box.minX : box.maxX, y };
      attachment = row * 3 + (right ? 1 : 3);
      const end = { x: right ? box.minX - gap : box.maxX + gap, y: y - dy };
      landing = landingTo(end, { x: right ? 1 : -1, y: 0 }, style, scale);
    }
    return {
      vertices: [arrow],
      landing,
      text: { content, style: ts.handle, position, attachment, width },
    };
  }
  const chosen: ContentBlock | undefined = yield* askContentBlock(ctx, style, o);
  if (chosen === undefined) return undefined;
  const block = chosen.handle ?? UNAUTHORED;
  const attributes: MultiLeaderAttribute[] = yield* askAttributes(ctx, chosen);
  const a = yield ctx.prompt.point({ message: 'Specify leader arrowhead location' });
  if (a.kind !== 'point') return undefined;
  const arrow = a.point;
  const placed = blockScaleOf(style, scale);
  const content = {
    block,
    position: first,
    scale: { ...placed.scale, z: 1 },
    rotation: placed.rotation,
    color: style.blockColor,
  };
  const box =
    style.blockConnection === 1
      ? undefined
      : blockContentBox(ctx.model, content, chosen.builtin?.extents);
  const b = box ?? { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y };
  const mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  let end: Vec2;
  let d: Vec2;
  if (vertical) {
    const above = arrow.y < mid.y;
    d = { x: 0, y: above ? 1 : -1 };
    end = { x: mid.x, y: above ? b.minY : b.maxY };
  } else {
    const right = arrow.x < mid.x;
    d = { x: right ? 1 : -1, y: 0 };
    end = { x: right ? b.minX : b.maxX, y: mid.y };
  }
  return {
    vertices: [arrow],
    landing: landingTo(end, d, style, scale),
    block: { block, position: first, attributes },
    ...(chosen.builtin && { builtin: chosen.builtin }),
  };
}

/** "Select a multileader": the multileader picked, or undefined when none was. */
async function* pickMultiLeader(ctx: CommandContext): Sub<EntityId | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: 'Select a multileader',
      single: true,
      editable: true,
    });
    const ids = (a as { readonly ids: readonly EntityId[] }).ids;
    if (ids.length === 0) return undefined;
    const e = ctx.model.entity(ids[0]!)!;
    if (e.geom.kind === 'MULTILEADER') return e.id;
    ctx.message('The object is not a multileader.');
  }
}

/** The box of a multileader's content: its text measured by the renderer, or its block's. */
async function contentBox(ctx: CommandContext, g: MultiLeaderGeometry): Promise<Box | undefined> {
  if (g.contentType === MLEADER_MTEXT && g.text) return measured(ctx, multiLeaderMText(g.text));
  if (g.contentType === MLEADER_BLOCK && g.block) return blockContentBox(ctx.model, g.block);
  return undefined;
}

const geomOf = (ctx: CommandContext, id: EntityId) =>
  ctx.model.entity(id)!.geom as MultiLeaderGeometry;

/** Adds leader lines until Enter; Remove leaders switches to removing. */
async function* addLeaders(ctx: CommandContext, id: EntityId): Sub<void> {
  const box = await contentBox(ctx, geomOf(ctx, id));
  for (;;) {
    const a = yield ctx.prompt.point({
      message: 'Specify leader arrowhead location or',
      options: ['Remove leaders'],
    });
    if (a.kind === 'keyword') {
      yield* removeLeaders(ctx, id);
      return;
    }
    if (a.kind !== 'point') return;
    const r = addLeaderLine(geomOf(ctx, id), a.point, box);
    if (!r.ok) {
      ctx.message(r.message);
      continue;
    }
    ctx.edit((b) => b.updateEntity(id, { geom: r.geom }));
  }
}

/** Removes the leader line nearest each point given, until Enter. */
async function* removeLeaders(ctx: CommandContext, id: EntityId): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.point({ message: 'Specify leaders to remove' });
    if (a.kind !== 'point') return;
    const g = removeLeaderLine(geomOf(ctx, id), a.point);
    if (!g) {
      ctx.message('A multileader keeps at least one leader line.');
      continue;
    }
    ctx.edit((b) => b.updateEntity(id, { geom: g }));
  }
}

/**
 * MLEADEREDIT and the ribbon's Add Leader (AIMLEADEREDITADD): leaders added to a multileader,
 * or with Remove leaders taken away. AutoCAD's help does not say what removing the last leader
 * does; a multileader keeps at least one here, as a drafter expects of a "leader".
 */
export function mleaderEditCommand(name: 'MLEADEREDIT' | 'AIMLEADEREDITADD'): CommandDef {
  return {
    name,
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const id = yield* pickMultiLeader(ctx);
      if (id === undefined) return;
      yield* addLeaders(ctx, id);
    },
  };
}

/** The ribbon's Remove Leader (AIMLEADEREDITREMOVE). */
export function mleaderRemoveCommand(): CommandDef {
  return {
    name: 'AIMLEADEREDITREMOVE',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const id = yield* pickMultiLeader(ctx);
      if (id === undefined) return;
      yield* removeLeaders(ctx, id);
    },
  };
}

export const MLEADER_COMMANDS = [
  mleaderCommand,
  () => mleaderEditCommand('MLEADEREDIT'),
  () => mleaderEditCommand('AIMLEADEREDITADD'),
  mleaderRemoveCommand,
];
