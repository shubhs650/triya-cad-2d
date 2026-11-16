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
  TextFields,
  TextGeometry,
} from '../../model/types';
import { transformObjects } from '../../edit/edit';
import { scaleAbout } from '../../edit/similarity';
import { transformAttribute } from '../../edit/transform';
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

/** What the canvas draws for a target: an attribute definition shows its tag. */
function drawn(t: Target): TextGeometry | MTextGeometry {
  if (t.kind === 'mtext') return t.geom;
  if (t.kind === 'attribute') return t.attr.mtext ?? { ...t.attr, kind: 'TEXT' };
  return t.geom.kind === 'ATTDEF' ? { ...t.geom, kind: 'TEXT', value: t.geom.tag } : t.geom;
}

/** The texts among the objects selected, and how many objects were not text. */
function targetsOf(ctx: CommandContext, ids: readonly EntityId[]): Target[] {
  const out: Target[] = [];
  let other = 0;
  for (const id of ids) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind === 'TEXT' || g?.kind === 'ATTDEF') out.push({ kind: 'text', id, geom: g });
    else if (g?.kind === 'MTEXT') out.push({ kind: 'mtext', id, geom: g });
    else if (g?.kind === 'INSERT' && g.attributes.length > 0) {
      for (const attr of g.attributes) out.push({ kind: 'attribute', id, attr });
    } else other++;
  }
  if (other > 0) ctx.message(`${other} ${other === 1 ? 'object was' : 'objects were'} not text.`);
  return out;
}

async function* selectTexts(ctx: CommandContext): Sub<Target[]> {
  const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
  const ids = (a as { readonly ids?: readonly EntityId[] }).ids ?? [];
  return targetsOf(ctx, ids);
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
      const targets: Target[] = yield* selectTexts(ctx);
      if (targets.length === 0) return;
      const k = yield ctx.prompt.keyword({
        message: 'Enter a justification option',
        options: JUSTIFY_NAMES,
        default: { kind: 'keyword', keyword: last },
      });
      last = keywordOf(k);
      const j = TEXT_JUSTIFICATIONS[last]!;
      const measured = await measure(ctx, targets);
      unmeasured(ctx, measured.filter((m) => !m).length);
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
      if (entities.size === 0 && attrs.size === 0) return;
      ctx.edit((b) => {
        for (const [id, geom] of entities) b.updateEntity(id, { geom });
        replaceAttributes(b, attrs);
      });
    },
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

export const TEXT_TOOL_COMMANDS: readonly (() => CommandDef)[] = [
  justifyTextCommand,
  scaleTextCommand,
];
