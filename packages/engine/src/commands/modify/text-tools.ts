// SCALETEXT and JUSTIFYTEXT (M4-09 part 1), with AutoCAD 2024's prompts ("SCALETEXT (Command)",
// "JUSTIFYTEXT (Command)", AutoCAD 2024 Help):
//   Select objects:
//   Enter a base point option for scaling
//     [Existing/Left/Center/Middle/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <Existing>:
//   Specify new model height or [Paper height/Match object/Scale factor] <2.5000>:
//     Specify new paper height <2.5000>:                         (Paper height)
//     Select a text object with desired height:                  (Match object)
//     Specify scale factor or [Reference] <2.0000>:              (Scale factor)
//       Specify reference length <1.0000>: / Specify new length: (Reference)
// and
//   Select objects:
//   Enter a justification option
//     [Left/Align/Fit/Center/Middle/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <Left>:
//
// Both take single-line text, MTEXT, attribute definitions and the attributes of the block
// references selected, each change as one undo step. SCALETEXT scales each object about its own
// base point (its insertion point, or the point the option names, which it keeps as its
// justification); JUSTIFYTEXT changes each one's justification point "without changing their
// locations" (edit/text-justify.ts reads the points off the text as the canvas draws it). Where
// the help is silent: Paper height is the model height at the current annotation scale
// (CANNOSCALEVALUE) for every object, annotative or not, since Triya makes no annotative text
// (DEC-058); the defaults offered are the last ones given, starting at TEXTSIZE, a factor of 2
// and Left.
import type { Vec2 } from '../../geom/types';
import type { ChangeSetBuilder } from '../../model/builder';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type {
  AttdefGeometry,
  InsertAttribute,
  InsertGeometry,
  MTextGeometry,
  MultiLeaderGeometry,
  TextFields,
  TextGeometry,
} from '../../model/types';
import { transformObjects } from '../../edit/edit';
import { moveBy, scaleAbout } from '../../edit/similarity';
import { transformAttribute, transformGeometry } from '../../edit/transform';
import {
  TEXTALIGN_MODES,
  TEXTALIGN_SET_SPACING,
  textAlignJustification,
  textAlignTargets,
  type AlignedText,
  type TextAlignLine,
} from '../../edit/text-align';
import { reshapePreview } from '../command-preview';
import { optionVariable, setOptionVariable } from './option-variables';
import {
  TEXT_JUSTIFICATIONS,
  attachmentFor,
  justifiedInPlace,
  mtextAttachmentPoint,
  mtextJustifiedInPlace,
  textJustificationPoint,
  type Justification,
  type TextFrame,
} from '../../edit/text-justify';
import { insertionPoint } from './attributes';
import { MLEADER_MTEXT, multiLeaderMText } from '../../edit/mleader';
import { MLEADER_TEXT_OVERRIDES, columnOf } from '../../properties/multileader';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { textSize } from '../draw/text';
import type { TextOutline } from '../view/host';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

// A prompt with a default always answers: Enter gives the default, and none of these takes Esc.
const keywordOf = (a: PromptAnswer) => (a as Extract<PromptAnswer, { kind: 'keyword' }>).keyword;
const valueOf = (a: PromptAnswer) => (a as Extract<PromptAnswer, { kind: 'distance' }>).value;

/** A text either command changes: an object of the drawing, or an attribute of a reference. */
type Target =
  | { readonly kind: 'text'; readonly id: EntityId; readonly geom: TextGeometry | AttdefGeometry }
  | { readonly kind: 'mtext'; readonly id: EntityId; readonly geom: MTextGeometry }
  | { readonly kind: 'attribute'; readonly id: EntityId; readonly attr: InsertAttribute };

/** A multileader of text, whose text JUSTIFYTEXT justifies (M4-09 part 3). */
interface LeaderTarget {
  readonly id: EntityId;
  readonly geom: MultiLeaderGeometry & { readonly text: NonNullable<MultiLeaderGeometry['text']> };
}

/** What the canvas draws for a target: an attribute definition shows its tag. */
function drawn(t: Target): TextGeometry | MTextGeometry {
  if (t.kind === 'mtext') return t.geom;
  if (t.kind === 'attribute') return t.attr.mtext ?? { ...t.attr, kind: 'TEXT' };
  return t.geom.kind === 'ATTDEF' ? { ...t.geom, kind: 'TEXT', value: t.geom.tag } : t.geom;
}

/**
 * The texts among the objects selected, and how many objects were not text; with `leaders`,
 * the multileaders of text go there.
 */
function targetsOf(
  ctx: CommandContext,
  ids: readonly EntityId[],
  leaders?: LeaderTarget[],
): Target[] {
  const out: Target[] = [];
  let other = 0;
  for (const id of ids) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind === 'TEXT' || g?.kind === 'ATTDEF') out.push({ kind: 'text', id, geom: g });
    else if (leaders && g?.kind === 'MULTILEADER' && g.contentType === MLEADER_MTEXT && g.text) {
      leaders.push({ id, geom: { ...g, text: g.text } });
    } else if (g?.kind === 'MTEXT') out.push({ kind: 'mtext', id, geom: g });
    else if (g?.kind === 'INSERT' && g.attributes.length > 0) {
      for (const attr of g.attributes) out.push({ kind: 'attribute', id, attr });
    } else other++;
  }
  if (other > 0) ctx.message(`${other} ${other === 1 ? 'object was' : 'objects were'} not text.`);
  return out;
}

async function* selectTexts(ctx: CommandContext, leaders?: LeaderTarget[]): Sub<Target[]> {
  const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
  const ids = (a as { readonly ids?: readonly EntityId[] }).ids ?? [];
  return targetsOf(ctx, ids, leaders);
}

/**
 * Measures the targets as the canvas draws them: a single-line text's box, an MTEXT's frame
 * (null where no loaded font draws one).
 */
async function measure(
  ctx: CommandContext,
  targets: readonly Target[],
): Promise<(TextOutline | TextFrame | null)[]> {
  const texts = targets.map(drawn);
  const lines = texts.flatMap((t) => (t.kind === 'TEXT' ? [t] : []));
  const blocks = texts.flatMap((t) => (t.kind === 'MTEXT' ? [t] : []));
  const r1 = await ctx.view.request({ op: 'textOutlines', texts: lines });
  const r2 = await ctx.view.request({ op: 'textFrames', texts: blocks });
  const outlines = (r1.ok && r1.outlines) || [];
  const frames = (r2.ok && r2.frames) || [];
  let i = 0;
  let j = 0;
  return texts.map((t) => (t.kind === 'TEXT' ? outlines[i++] : frames[j++]) ?? null);
}

/** Puts `next` for its attribute of reference `id`. */
function put(
  attrs: Map<EntityId, Map<Handle, InsertAttribute>>,
  id: EntityId,
  next: InsertAttribute,
): void {
  const byHandle = attrs.get(id) ?? new Map<Handle, InsertAttribute>();
  attrs.set(id, byHandle.set(next.handle, next));
}

function unmeasured(ctx: CommandContext, n: number): void {
  if (n === 0) return;
  ctx.message(
    n === 1
      ? '1 text cannot be measured: no loaded font draws it.'
      : `${n} texts cannot be measured: no loaded font draws them.`,
  );
}

/** Replaces attributes of references, all of one reference's at once. */
function replaceAttributes(
  b: ChangeSetBuilder,
  changed: ReadonlyMap<EntityId, ReadonlyMap<Handle, InsertAttribute>>,
): void {
  for (const [id, byHandle] of changed) {
    const g = b.entity(id)!.geom as InsertGeometry;
    const attributes = g.attributes.map((a) => byHandle.get(a.handle) ?? a);
    b.updateEntity(id, { geom: { ...g, attributes } });
  }
}

const JUSTIFY_NAMES = Object.keys(TEXT_JUSTIFICATIONS);

// ── JUSTIFYTEXT ─────────────────────────────────────────────────────────────────────────────

export function justifyTextCommand(): CommandDef {
  let last = 'Left';
  return {
    name: 'JUSTIFYTEXT',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const leaders: LeaderTarget[] = [];
      const targets: Target[] = yield* selectTexts(ctx, leaders);
      if (targets.length === 0 && leaders.length === 0) return;
      const k = yield ctx.prompt.keyword({
        message: 'Enter a justification option',
        options: JUSTIFY_NAMES,
        default: { kind: 'keyword', keyword: last },
      });
      last = keywordOf(k);
      const j = TEXT_JUSTIFICATIONS[last]!;
      const measured = await measure(ctx, targets);
      const r = await ctx.view.request({
        op: 'textFrames',
        texts: leaders.map((l) => multiLeaderMText(l.geom.text)),
      });
      const frames = leaders.map((_, i) => (r.ok && r.frames?.[i]) || null);
      unmeasured(ctx, [...measured, ...frames].filter((m) => !m).length);
      const attrs = new Map<EntityId, Map<Handle, InsertAttribute>>();
      const entities = new Map<EntityId, TextGeometry | AttdefGeometry | MTextGeometry>();
      targets.forEach((t, i) => {
        const m = measured[i];
        if (!m) return;
        const a = attachmentFor(j);
        if (t.kind === 'text') {
          entities.set(t.id, { ...t.geom, ...justifiedInPlace(t.geom, j, m as TextOutline) });
        } else if (t.kind === 'mtext') {
          entities.set(t.id, mtextJustifiedInPlace(t.geom, a, m as TextFrame));
        } else {
          const at = t.attr;
          const mtext = at.mtext && mtextJustifiedInPlace(at.mtext, a, m as TextFrame);
          put(
            attrs,
            t.id,
            mtext ? { ...at, mtext } : { ...at, ...justifiedInPlace(at, j, m as TextOutline) },
          );
        }
      });
      const leadersMoved = new Map<EntityId, MultiLeaderGeometry>();
      leaders.forEach((l, i) => {
        const f = frames[i];
        if (!f) return;
        const moved = justifiedLeader(l.geom, attachmentFor(j), f);
        if (moved !== l.geom) leadersMoved.set(l.id, moved);
      });
      if (entities.size === 0 && attrs.size === 0 && leadersMoved.size === 0) return;
      ctx.edit((b) => {
        for (const [id, geom] of entities) b.updateEntity(id, { geom });
        for (const [id, geom] of leadersMoved) b.updateEntity(id, { geom });
        replaceAttributes(b, attrs);
      });
    },
  };
}

/**
 * A multileader's text given attachment `a` where it lies in its frame `f` (JUSTIFYTEXT on
 * "leader text objects", AutoCAD 2024 Help): its text moves in its frame as an MTEXT's does,
 * so it stays on its landing, and its alignment (DXF 175) follows the attachment's column as
 * the Properties palette's Justify sets it, overriding the style's.
 */
function justifiedLeader(g: LeaderTarget['geom'], a: number, f: TextFrame): MultiLeaderGeometry {
  const t = g.text;
  if (t.attachment === a) return g;
  const { position } = mtextJustifiedInPlace(multiLeaderMText(t), a, f);
  return {
    ...g,
    overrideFlags: g.overrideFlags | MLEADER_TEXT_OVERRIDES.textAlignment,
    textAlignment: columnOf(a),
    text: { ...t, attachment: a, position },
  };
}

// ── SCALETEXT ───────────────────────────────────────────────────────────────────────────────

const BASE_NAMES = ['Existing', ...JUSTIFY_NAMES.filter((n) => n !== 'Align' && n !== 'Fit')];

/** The height a target is drawn at. */
function heightOf(t: Target): number {
  if (t.kind === 'attribute') return t.attr.mtext?.height ?? t.attr.height;
  return t.geom.height;
}

/** The point a target scales about: its insertion point, or justification `j` as drawn. */
function baseOf(
  t: Target,
  j: Justification | undefined,
  m: TextOutline | TextFrame | null,
): Vec2 | undefined {
  const block = t.kind === 'mtext' ? t.geom : t.kind === 'attribute' ? t.attr.mtext : undefined;
  const line: TextFields = t.kind === 'attribute' ? t.attr : (t.geom as TextFields);
  if (!j) return block ? block.position : insertionPoint(line);
  if (!m) return undefined;
  if (block) return mtextAttachmentPoint(block, m as TextFrame, attachmentFor(j));
  return textJustificationPoint(line, m as TextOutline, j);
}

const positive = (ctx: CommandContext, v: number): boolean => {
  if (v > 0 && Number.isFinite(v)) return true;
  ctx.message('Value must be positive and nonzero.');
  return false;
};

/** How SCALETEXT sizes each target: to one height, or by one factor. */
type Sizing = { readonly height: number } | { readonly factor: number };

export function scaleTextCommand(): CommandDef {
  let lastBase = 'Existing';
  let lastHeight: number | undefined;
  let lastPaper: number | undefined;
  let lastFactor = 2;
  return {
    name: 'SCALETEXT',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const targets: Target[] = yield* selectTexts(ctx);
      if (targets.length === 0) return;
      const k = yield ctx.prompt.keyword({
        message: 'Enter a base point option for scaling',
        options: BASE_NAMES,
        default: { kind: 'keyword', keyword: lastBase },
      });
      lastBase = keywordOf(k);
      const j = lastBase === 'Existing' ? undefined : TEXT_JUSTIFICATIONS[lastBase];
      const sizing: Sizing | undefined = yield* askSizing(ctx);
      if (!sizing) return;

      const measured = j ? await measure(ctx, targets) : targets.map(() => null);
      let missed = 0;
      const attrs = new Map<EntityId, Map<Handle, InsertAttribute>>();
      const moves: { id: EntityId; base: Vec2; factor: number }[] = [];
      for (const [i, t] of targets.entries()) {
        const base = baseOf(t, j, measured[i] ?? null);
        if (!base) {
          missed++;
          continue;
        }
        const h = heightOf(t);
        const factor = 'factor' in sizing ? sizing.factor : sizing.height / h;
        if (!(h > 0) || factor === 1) continue;
        if (t.kind !== 'attribute') {
          moves.push({ id: t.id, base, factor });
          continue;
        }
        put(attrs, t.id, transformAttribute(scaleAbout(base, factor), t.attr));
      }
      unmeasured(ctx, missed);
      if (moves.length === 0 && attrs.size === 0) return;
      ctx.edit((b) => {
        for (const m of moves) transformObjects(b, ctx.model, [m.id], scaleAbout(m.base, m.factor));
        replaceAttributes(b, attrs);
      });
    },
  };

  /** The new height, or the factor, as the second prompt and its options give it. */
  async function* askSizing(ctx: CommandContext): Sub<Sizing | undefined> {
    for (;;) {
      const height = lastHeight ?? textSize(ctx.model);
      const a = yield ctx.prompt.distance({
        message: 'Specify new model height or',
        options: ['Paper height', 'Match object', 'Scale factor'],
        default: { kind: 'distance', value: height },
      });
      if (a.kind === 'distance') {
        if (!positive(ctx, a.value)) continue;
        lastHeight = a.value;
        return { height: a.value };
      }
      const option = keywordOf(a);
      if (option === 'Paper height') {
        const p = yield ctx.prompt.distance({
          message: 'Specify new paper height',
          default: { kind: 'distance', value: lastPaper ?? textSize(ctx.model) },
        });
        const paper = valueOf(p);
        if (!positive(ctx, paper)) continue;
        lastPaper = paper;
        const v = Number(ctx.model.header.get('CANNOSCALEVALUE'));
        return { height: paper / (v > 0 && Number.isFinite(v) ? v : 1) };
      }
      if (option === 'Match object') {
        for (;;) {
          const s = yield ctx.prompt.selection({
            message: 'Select a text object with desired height',
            single: true,
          });
          const ids = (s as { readonly ids?: readonly EntityId[] }).ids ?? [];
          if (ids.length === 0) return undefined;
          const g = ctx.model.entity(ids[0]!)?.geom;
          if (g?.kind === 'TEXT' || g?.kind === 'ATTDEF' || g?.kind === 'MTEXT') {
            return { height: g.height };
          }
          ctx.message('The object is not text.');
        }
      }
      // Scale factor
      for (;;) {
        const f = yield ctx.prompt.distance({
          message: 'Specify scale factor or',
          options: ['Reference'],
          default: { kind: 'distance', value: lastFactor },
        });
        if (f.kind === 'distance') {
          if (!positive(ctx, f.value)) continue;
          lastFactor = f.value;
          return { factor: f.value };
        }
        const r = yield ctx.prompt.distance({
          message: 'Specify reference length',
          default: { kind: 'distance', value: 1 },
        });
        const ref = valueOf(r);
        if (!positive(ctx, ref)) continue;
        const n = yield ctx.prompt.distance({ message: 'Specify new length' });
        if (n.kind !== 'distance') return undefined;
        if (!positive(ctx, n.value)) continue;
        return { factor: n.value / ref };
      }
    }
  }
}

// ── TEXTALIGN ───────────────────────────────────────────────────────────────────────────────

/** TEXTALIGNSPACING's options, by its value. */
const SPACING_NAMES = ['Distribute', 'Set spacing', 'Current vertical', 'current Horizontal'];
const TEXTALIGNMODE = 'TEXTALIGNMODE';
const TEXTALIGNSPACING = 'TEXTALIGNSPACING';

/** The corners of an MTEXT's frame `f`, as drawn. */
const frameCorners = (g: MTextGeometry, f: TextFrame): Vec2[] =>
  [7, 9, 3, 1].map((a) => mtextAttachmentPoint(g, f, a));

const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** A text TEXTALIGN moves, measured: where its alignment point and its box lie. */
interface Measured extends AlignedText {
  readonly id: EntityId;
}

/**
 * TEXTALIGN (M4-09 part 3), with AutoCAD 2024's prompts ("TEXTALIGN (Command)"):
 *   Select text objects to align [alIgnment/Options]:
 *   Select text object to align to [Points]:
 *   Pick second point or [Options]:
 * alIgnment sets TEXTALIGNMODE and Options TEXTALIGNSPACING (both the app's, kept per user as
 * AutoCAD keeps them in the registry); the texts are placed along the line by
 * `edit/text-align.ts`, previewed at the cursor (COMMANDPREVIEW), as one undo step. It takes
 * single-line text, MTEXT and attribute definitions, which it moves whole.
 */
export function textAlignCommand(): CommandDef {
  // Where no app keeps the variables (scripts, tests), the command keeps them for the drawing.
  let mode = 9;
  let spacing = 2;
  let gap: number | undefined;
  return {
    name: 'TEXTALIGN',
    usesSelection: 'before',
    async *run(ctx): CommandGenerator {
      mode = await optionVariable(ctx, TEXTALIGNMODE, mode);
      spacing = await optionVariable(ctx, TEXTALIGNSPACING, spacing);
      let ids: readonly EntityId[] = ctx.preselected;
      while (ids.length === 0) {
        const a = yield ctx.prompt.selection({
          message: 'Select text objects to align',
          options: ['alIgnment', 'Options'],
          editable: true,
        });
        if (a.kind === 'keyword' && a.keyword === 'alIgnment') {
          const k = yield ctx.prompt.keyword({
            message: 'Enter an option',
            options: ALIGN_OPTIONS,
            default: { kind: 'keyword', keyword: TEXTALIGN_MODES[mode] ?? 'Left' },
          });
          mode = TEXTALIGN_MODES.indexOf(keywordOf(k));
          await setOptionVariable(ctx, TEXTALIGNMODE, mode);
          continue;
        }
        if (a.kind === 'keyword') {
          if (!(yield* askSpacing(ctx))) return;
          continue;
        }
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        ids = a.ids;
      }
      const texts = alignable(ctx, ids);
      if (texts.length === 0) return;

      let line: TextAlignLine | undefined;
      let baseId: EntityId | undefined;
      while (!line) {
        const b = yield ctx.prompt.selection({
          message: 'Select text object to align to or',
          options: ['Points'],
          single: true,
        });
        if (b.kind === 'keyword') {
          const p = yield ctx.prompt.point({ message: 'Specify first point' });
          if (p.kind !== 'point') return;
          line = { from: p.point, to: p.point };
          continue;
        }
        if (b.kind !== 'selection' || b.ids.length === 0) return;
        const base = alignable(ctx, b.ids.slice(0, 1))[0];
        if (!base) continue;
        const m = (await measureAligned(ctx, [base], mode))[0];
        if (!m) {
          unmeasured(ctx, 1);
          continue;
        }
        baseId = base.id;
        line = { from: m.at, to: m.at, base: m.corners };
      }
      const moving = texts.filter((t) => t.id !== baseId);
      // Measured once: only the spacing can change while the second point is asked for.
      const measured = await measureAligned(ctx, moving, mode);
      unmeasured(ctx, measured.filter((m) => !m).length);
      const from = line.from;
      const base = line.base;
      for (;;) {
        const placed = measured.flatMap((m) => (m ? [m] : []));
        const moves = (to: Vec2) => {
          const targets = textAlignTargets(
            placed,
            { from, to, ...(base && { base }) },
            {
              mode: spacing,
              gap: gap ?? 0,
            },
          );
          return targets?.map((p, i) => ({ id: placed[i]!.id, by: minus(p, placed[i]!.at) }));
        };
        const p = yield ctx.prompt.point({
          message: 'Pick second point or',
          options: ['Options'],
          rubberBand: { from },
          commandPreview: {
            at: (q) => {
              const m = moves(q.cursor);
              if (!m) return undefined;
              return reshapePreview(
                ctx.model,
                m.map(({ id, by }) => [
                  id,
                  [transformGeometry(ctx.model.entity(id)!.geom, moveBy(by))],
                ]),
              );
            },
          },
        });
        if (p.kind === 'keyword') {
          if (!(yield* askSpacing(ctx))) return;
          continue;
        }
        if (p.kind !== 'point') return;
        const m = moves(p.point);
        if (!m) {
          ctx.message('The second point must differ from the first.');
          continue;
        }
        const changed = m.filter(({ by }) => by.x !== 0 || by.y !== 0);
        if (changed.length === 0) return;
        ctx.edit((b) => {
          for (const { id, by } of changed) transformObjects(b, ctx.model, [id], moveBy(by));
        });
        return;
      }
    },
  };

  /** Options: TEXTALIGNSPACING, and Set spacing's gap. False when the command ends there. */
  async function* askSpacing(ctx: CommandContext): Sub<boolean> {
    const k = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options: SPACING_NAMES,
      default: { kind: 'keyword', keyword: SPACING_NAMES[spacing] ?? 'Current vertical' },
    });
    const next = SPACING_NAMES.indexOf(keywordOf(k));
    if (next === TEXTALIGN_SET_SPACING) {
      for (;;) {
        const d = yield ctx.prompt.distance({
          message: 'Specify spacing',
          ...(gap !== undefined && { default: { kind: 'distance' as const, value: gap } }),
        });
        if (d.kind !== 'distance') return false;
        if (d.value < 0 || !Number.isFinite(d.value)) {
          ctx.message('Value must be positive or zero.');
          continue;
        }
        gap = d.value;
        break;
      }
    }
    spacing = next;
    await setOptionVariable(ctx, TEXTALIGNSPACING, spacing);
    return true;
  }
}

/** The keywords of TEXTALIGN's alIgnment option, as AutoCAD lists them. */
const ALIGN_OPTIONS = [...TEXTALIGN_MODES.slice(9), ...TEXTALIGN_MODES.slice(0, 9)];

/** The texts TEXTALIGN moves among `ids`: single-line text, MTEXT and attribute definitions. */
function alignable(ctx: CommandContext, ids: readonly EntityId[]): Target[] {
  const out: Target[] = [];
  let other = 0;
  for (const id of ids) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind === 'TEXT' || g?.kind === 'ATTDEF') out.push({ kind: 'text', id, geom: g });
    else if (g?.kind === 'MTEXT') out.push({ kind: 'mtext', id, geom: g });
    else other++;
  }
  if (other > 0) ctx.message(`${other} ${other === 1 ? 'object was' : 'objects were'} not text.`);
  return out;
}

/** Each text's alignment point (TEXTALIGNMODE `mode`) and box as drawn; null unmeasured. */
async function measureAligned(
  ctx: CommandContext,
  targets: readonly Target[],
  mode: number,
): Promise<(Measured | null)[]> {
  const j = textAlignJustification(mode);
  const measured = await measure(ctx, targets);
  return targets.map((t, i) => {
    const m = measured[i];
    if (!m) return null;
    if (t.kind === 'mtext') {
      const f = m as TextFrame;
      return {
        id: t.id,
        at: mtextAttachmentPoint(t.geom, f, attachmentFor(j)),
        corners: frameCorners(t.geom, f),
      };
    }
    const o = m as TextOutline;
    return {
      id: t.id,
      at: textJustificationPoint(drawn(t) as TextFields, o, j),
      corners: o.corners,
    };
  });
}

export const TEXT_TOOL_COMMANDS: readonly (() => CommandDef)[] = [
  justifyTextCommand,
  scaleTextCommand,
  textAlignCommand,
];
