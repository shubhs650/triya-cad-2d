// DIMBREAK and DIMINSPECT (M4-02 part 4), with AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "DIMBREAK (Command)", "DIMINSPECT (Command)", "-DIMINSPECT (Command)"):
//   DIMBREAK     Select dimension to add/remove break or [Multiple]:
//                Select object to break dimension or [Auto/Manual/Remove] <Auto>:
//                  (an object picked: Select object to break dimension: until Enter)
//                  Manual: Specify first break point: / Specify second break point:
//                Multiple: Select dimensions: / Enter an option [Break/Remove] <Break>:
//   DIMINSPECT   the Inspection Dimension dialog (Select dimensions, Remove Inspection, Shape,
//                Label, Inspection rate)
//   -DIMINSPECT  Add inspection data or [Remove] <Add>:
//                Select dimensions:
//                Enter shape option [Round/Angular/None] <Round>:
//                Enter label value or [None] <None>:
//                Enter inspection rate or [None] <100%>:
// Breaks and inspection data are saved as DEC-064's `TRIYA_DIMBREAK` and `TRIYA_DIMINSPECT`
// records (edit/dimension-records.ts); the dimension engine draws them. Each command is one undo
// step, the records and the regenerated graphics together. DIMBREAK on multileaders and leaders,
// which AutoCAD also breaks, is roadmap M4-15.
import type { Curve } from '../../geom/curves';
import { closestPoint } from '../../geom/closest';
import { toleranceForSize } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { add, dot, length, normalize, scale, sub } from '../../geom/vec';
import type { DimBreak, DimInspect, DimensionGeometry, Entity } from '../../model/types';
import {
  crossingObjects,
  dimBreakOf,
  dimInspectOf,
  setDimensionRecord,
} from '../../edit/dimension-records';
import { objectEdgeCurves } from '../../edit/trim-edges';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { InspectionSettings, Prompt, PromptAnswer } from '../prompt';
import { regenerateDimensions } from './dimensions';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
type Dimension = Entity & { geom: DimensionGeometry };
type BreakFields = Pick<DimBreak, 'objects' | 'manual'>;

const isDimension = (e: Entity | undefined): e is Dimension =>
  e !== undefined &&
  (e.geom.kind === 'DIMENSION' ||
    e.geom.kind === 'ARC_DIMENSION' ||
    e.geom.kind === 'LARGE_RADIAL_DIMENSION');

/** The drawing's tolerance for the dimension's size. */
function tolOf(e: Dimension) {
  const g = e.geom as { readonly definitionPoint: Vec2; readonly textPosition: Vec2 };
  const p = g.definitionPoint;
  const q = g.textPosition;
  return toleranceForSize(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(q.x), Math.abs(q.y)));
}

const modified = (ctx: CommandContext, n: number): void =>
  ctx.message(`${n} object${n === 1 ? '' : 's'} modified`);

/** Writes the dimensions' break records (`undefined` takes one off) and draws them again. */
async function setBreaks(
  ctx: CommandContext,
  changes: readonly [Dimension, BreakFields | undefined][],
): Promise<void> {
  ctx.edit((b) => {
    for (const [e, fields] of changes) {
      const now = b.entity(e.id);
      if (!now) continue;
      const empty = fields && fields.objects.length === 0 && fields.manual.length === 0;
      setDimensionRecord<DimBreak>(b, now, 'TRIYA_DIMBREAK', empty ? undefined : fields);
    }
  });
  await regenerateDimensions(
    ctx,
    changes.map(([e]) => e.id),
  );
}

/** The dimension's breaks so far, as fields to add to. */
function breaksOf(ctx: CommandContext, e: Dimension): BreakFields {
  const r = dimBreakOf(ctx.model, ctx.model.entity(e.id) ?? e);
  return { objects: r?.objects ?? [], manual: r?.manual ?? [] };
}

const withObjects = (f: BreakFields, add: readonly string[]): BreakFields => ({
  ...f,
  objects: [...f.objects, ...add.filter((h) => !f.objects.includes(h))],
});

/** Auto: the objects crossing the dimension now, added to its breaks. */
function autoBreaks(ctx: CommandContext, e: Dimension): BreakFields {
  return withObjects(breaksOf(ctx, e), crossingObjects(ctx.model, e, tolOf(e)));
}

/** `p` put on the line through `c` (or on its circle), which a manual break's points lie on. */
function onCurve(c: Curve, p: Vec2): Vec2 {
  if (c.kind === 'LINE') {
    const u = normalize(sub(c.end, c.start));
    return add(c.start, scale(u, dot(sub(p, c.start), u)));
  }
  if (c.kind === 'ARC' || c.kind === 'CIRCLE') {
    const d = sub(p, c.center);
    const r = length(d);
    return r > 0 ? add(c.center, scale(d, c.radius / r)) : p;
  }
  return p;
}

/**
 * Manual: two points on a dimension or extension line (or an arc) of the dimension, put on the
 * line or arc nearest the first, as AutoCAD takes them.
 */
async function* manualBreak(
  ctx: CommandContext,
  e: Dimension,
): Sub<readonly [Vec2, Vec2] | undefined> {
  const a = yield ctx.prompt.point({ message: 'Specify first break point' });
  if (a.kind !== 'point') return undefined;
  const b = yield ctx.prompt.point({ message: 'Specify second break point', lastPoint: a.point });
  if (b.kind !== 'point') return undefined;
  const tol = tolOf(e);
  let best: { c: Curve; d: number } | undefined;
  for (const c of objectEdgeCurves({ model: ctx.model, tol }, e, {
    extend: false,
    hatches: false,
  })) {
    if (c.kind !== 'LINE' && c.kind !== 'ARC') continue;
    const d = closestPoint(c, a.point, tol).distance;
    if (!best || d < best.d) best = { c, d };
  }
  if (!best) return undefined;
  return [onCurve(best.c, a.point), onCurve(best.c, b.point)] as const;
}

/** "Select dimensions": the dimensions among the objects selected. */
async function* selectDimensions(ctx: CommandContext): Sub<Dimension[] | undefined> {
  const a = yield ctx.prompt.selection({ message: 'Select dimensions', editable: true });
  if (a.kind !== 'selection') return undefined;
  return a.ids.map((id) => ctx.model.entity(id)).filter(isDimension);
}

function dimbreakCommand(): CommandDef {
  return {
    name: 'DIMBREAK',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      let dim: Dimension | undefined;
      while (!dim) {
        const a = yield ctx.prompt.selection({
          message: 'Select dimension to add/remove break or',
          single: true,
          options: ['Multiple'],
        });
        if (a.kind === 'keyword' && a.keyword === 'Multiple') {
          const dims = yield* selectDimensions(ctx);
          if (!dims || dims.length === 0) return;
          const o = yield ctx.prompt.keyword({
            message: 'Enter an option',
            options: ['Break', 'Remove'],
            default: { kind: 'keyword', keyword: 'Break' },
          });
          if (o.kind !== 'keyword') return;
          await setBreaks(
            ctx,
            dims.map((e) => [e, o.keyword === 'Remove' ? undefined : autoBreaks(ctx, e)] as const),
          );
          modified(ctx, dims.length);
          return;
        }
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        const e = ctx.model.entity(a.ids[0]!);
        if (isDimension(e)) dim = e;
        else ctx.message('Object selected is not a dimension.');
      }
      const b = yield ctx.prompt.selection({
        message: 'Select object to break dimension or',
        single: true,
        options: ['Auto', 'Manual', 'Remove'],
        defaultLabel: 'Auto',
      });
      if (b.kind === 'keyword' && b.keyword === 'Remove') {
        await setBreaks(ctx, [[dim, undefined]]);
        modified(ctx, 1);
        return;
      }
      if (b.kind === 'keyword' && b.keyword === 'Manual') {
        const pair = yield* manualBreak(ctx, dim);
        if (!pair) return;
        const now = breaksOf(ctx, dim);
        await setBreaks(ctx, [[dim, { ...now, manual: [...now.manual, pair] }]]);
        modified(ctx, 1);
        return;
      }
      if (
        (b.kind === 'keyword' && b.keyword === 'Auto') ||
        (b.kind === 'selection' && b.ids.length === 0)
      ) {
        await setBreaks(ctx, [[dim, autoBreaks(ctx, dim)]]);
        modified(ctx, 1);
        return;
      }
      if (b.kind !== 'selection') return;
      // Objects picked one by one, each breaking the dimension as it is picked, until Enter.
      let ids = b.ids;
      for (;;) {
        const handles = ids
          .map((id) => ctx.model.entity(id))
          .filter((o): o is Entity => o !== undefined && o.id !== dim.id)
          .map((o) => o.handle);
        if (handles.length > 0)
          await setBreaks(ctx, [[dim, withObjects(breaksOf(ctx, dim), handles)]]);
        const next = yield ctx.prompt.selection({
          message: 'Select object to break dimension',
          single: true,
        });
        if (next.kind !== 'selection' || next.ids.length === 0) break;
        ids = next.ids;
      }
      modified(ctx, 1);
    },
  };
}

/** The settings an inspection record holds. */
const settingsOf = (r: DimInspect | undefined): InspectionSettings =>
  r
    ? {
        shape: r.shape,
        ...(r.label !== undefined && { label: r.label }),
        ...(r.rate !== undefined && { rate: r.rate }),
      }
    : { shape: 'round', rate: '100%' };

/** Gives the dimensions the inspection settings (`undefined` removes them) and draws them again. */
async function setInspection(
  ctx: CommandContext,
  dims: readonly Dimension[],
  s: InspectionSettings | undefined,
): Promise<void> {
  ctx.edit((b) => {
    for (const e of dims) {
      const now = b.entity(e.id);
      if (now) setDimensionRecord<DimInspect>(b, now, 'TRIYA_DIMINSPECT', s && { ...s });
    }
  });
  await regenerateDimensions(
    ctx,
    dims.map((e) => e.id),
  );
}

/** -DIMINSPECT's prompts. */
async function* dashDiminspect(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Add inspection data or',
    options: ['Add', 'Remove'],
    default: { kind: 'keyword', keyword: 'Add' },
  });
  if (a.kind !== 'keyword') return;
  const dims = yield* selectDimensions(ctx);
  if (!dims || dims.length === 0) return;
  if (a.keyword === 'Remove') {
    await setInspection(ctx, dims, undefined);
    return;
  }
  const s = yield ctx.prompt.keyword({
    message: 'Enter shape option',
    options: ['Round', 'Angular', 'None'],
    default: { kind: 'keyword', keyword: 'Round' },
  });
  if (s.kind !== 'keyword') return;
  const label = yield ctx.prompt.string({
    message: 'Enter label value or',
    options: ['None'],
    spaces: true,
    defaultLabel: 'None',
  });
  if (label.kind !== 'string' && label.kind !== 'keyword' && label.kind !== 'enter') return;
  const rate = yield ctx.prompt.string({
    message: 'Enter inspection rate or',
    options: ['None'],
    spaces: true,
    default: { kind: 'string', value: '100%' },
  });
  if (rate.kind !== 'string' && rate.kind !== 'keyword') return;
  await setInspection(ctx, dims, {
    shape: s.keyword.toLowerCase() as InspectionSettings['shape'],
    ...(label.kind === 'string' && label.value !== '' && { label: label.value }),
    ...(rate.kind === 'string' && rate.value !== '' && { rate: rate.value }),
  });
}

function diminspectCommand(): CommandDef {
  return {
    name: 'DIMINSPECT',
    dashVariant: true,
    usesSelection: 'before',
    async *run(ctx): CommandGenerator {
      if (ctx.dash) return yield* dashDiminspect(ctx);
      let dims = ctx.preselected.map((id) => ctx.model.entity(id)).filter(isDimension);
      let settings = settingsOf(dims[0] && dimInspectOf(ctx.model, dims[0]));
      for (;;) {
        const a = yield ctx.prompt.dialog({
          message: 'Inspection Dimension',
          dialog: { type: 'diminspect', settings, selected: dims.length },
        });
        if (a.kind !== 'dialog') return;
        if (a.inspection) settings = a.inspection;
        if (a.action === 'select') {
          const picked = yield* selectDimensions(ctx);
          if (picked === undefined) return;
          dims = picked;
          continue;
        }
        if (dims.length === 0) return;
        await setInspection(ctx, dims, a.action === 'remove' ? undefined : settings);
        return;
      }
    },
  };
}

export function dimensionBreakCommands(): CommandDef[] {
  return [dimbreakCommand(), diminspectCommand()];
}
