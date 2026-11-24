// GEOMCONSTRAINT and the GC* commands (M9-05 part 1): AutoCAD's geometric constraints applied
// to the drawing, solved by the constraint service the app gives the engine (`@triya/constraints`'
// PlaneGCS model). The second object adjusts to the first; a constraint the geometry cannot take
// is refused with the solver's reason and nothing changes.
//
// Prompts from AutoCAD 2024 Help ("GEOMCONSTRAINT (Command)", "GCHORIZONTAL", "GCVERTICAL",
// "GCPERPENDICULAR", "GCPARALLEL", "GCTANGENT", "GCCOINCIDENT", "GCCONCENTRIC", "GCCOLLINEAR",
// "GCSYMMETRIC", "GCEQUAL", "GCFIX"). A point pick takes the constraint point of the object under
// the cursor nearest the pick (endpoint, midpoint, center, vertex); an object pick takes a line,
// circle or arc whole, or the polyline segment picked.
//
// Left out here: GCSMOOTH (Smooth needs splines in the solver, M9-02 part 2; GEOMCONSTRAINT's
// SMooth says so), GCCOINCIDENT's Autoconstrain (AUTOCONSTRAIN is not built), the constraint bars
// that show a constraint once applied, and Infer (later parts of M9-05).
import { toleranceFor } from './modify/offset';
import type { CommandContext, CommandDef, CommandGenerator } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import {
  constraintCurveAt,
  constraintPointAt,
  constraintPointsOf,
  parameterObjects,
  geometricConstraints,
  type ExpressionChange,
} from '../edit/constraints';
import type { ChangeSetBuilder } from '../model/builder';
import type { RecordPatch } from '../model/update';
import type { Vec2 } from '../geom/types';
import type { Tolerance } from '../geom/tolerance';
import {
  GEOMETRIC_CONSTRAINT_KINDS,
  type ConstraintCurveRef,
  type ConstraintPointRef,
  type ConstraintRef,
  type Entity,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type NonGraphicalObject,
} from '../model/types';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

export const INVALID_OBJECT = 'Invalid selection. Select a line, circle, arc or polyline segment.';
const INVALID_POINT = 'Invalid selection. Select a line, circle, arc, point or polyline.';
export const LOCKED = 'The object is on a locked layer.';

/** The object of the current space under a pick that a constraint can take, nearest first. */
export async function entityAt(ctx: CommandContext, p: Vec2): Promise<Entity | undefined> {
  const r = await ctx.view.request({ op: 'pick', point: p });
  const hits = (r.ok ? (r.ids ?? []) : [])
    .map((id) => ctx.model.entity(id))
    .filter((e): e is Entity => e !== undefined && e.owner === ctx.space);
  return hits.find((e) => constraintPointsOf(e).length > 0) ?? hits[0];
}

export const locked = (ctx: CommandContext, e: Entity): boolean =>
  ctx.model.tables.layers.get(e.layer)?.locked === true;

/** The tolerance a constraint on these points works to: the drawing's, from its extents. */
export function toleranceOf(ctx: CommandContext, refs: readonly ConstraintRef[]): Tolerance {
  const pts = refs.flatMap((r) => {
    const e = ctx.model.entityByHandle(r.entity);
    return e ? constraintPointsOf(e).map((c) => c.at) : [];
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return toleranceFor(ctx.model, {
    kind: 'LINE',
    start: { x: Math.min(0, ...xs), y: Math.min(0, ...ys) },
    end: { x: Math.max(1, ...xs), y: Math.max(1, ...ys) },
  });
}

/**
 * Asks for an object at `message`: the curve picked, a keyword typed, `enter`, or undefined when
 * the command ends (Esc, or an answer it cannot take). A pick on nothing asks again.
 */
export async function* objectPick(
  ctx: CommandContext,
  message: string,
  options?: readonly string[],
  defaultKeyword?: string,
): Sub<ConstraintCurveRef | { keyword: string } | 'enter' | undefined> {
  for (;;) {
    const a = yield ctx.prompt.point({
      message,
      pickbox: true,
      ...(options && { options }),
      ...(defaultKeyword && { default: { kind: 'keyword', keyword: defaultKeyword } }),
    });
    if (a.kind === 'keyword') return { keyword: a.keyword };
    if (a.kind === 'enter') return 'enter';
    if (a.kind !== 'point') return undefined;
    const e = await entityAt(ctx, a.point);
    if (!e) continue;
    const ref = constraintCurveAt(e, a.point, toleranceOf(ctx, [{ entity: e.handle }]));
    if (!ref) ctx.message(INVALID_OBJECT);
    else if (locked(ctx, e)) ctx.message(LOCKED);
    else return ref;
  }
}

/** Asks for a constraint point at `message`, as `objectPick` asks for an object. */
export async function* pointPick(
  ctx: CommandContext,
  message: string,
  options?: readonly string[],
  defaultKeyword?: string,
): Sub<ConstraintPointRef | { keyword: string } | 'enter' | undefined> {
  for (;;) {
    const a = yield ctx.prompt.point({
      message,
      pickbox: true,
      ...(options && { options }),
      ...(defaultKeyword && { default: { kind: 'keyword', keyword: defaultKeyword } }),
    });
    if (a.kind === 'keyword') return { keyword: a.keyword };
    if (a.kind === 'enter') return 'enter';
    if (a.kind !== 'point') return undefined;
    const e = await entityAt(ctx, a.point);
    if (!e) continue;
    const point = constraintPointAt(e, a.point);
    if (!point) ctx.message(INVALID_POINT);
    else if (locked(ctx, e)) ctx.message(LOCKED);
    else return point.ref;
  }
}

/** An object pick that only takes an object: anything else ends the command (undefined). */
async function* object(ctx: CommandContext, message: string): Sub<ConstraintCurveRef | undefined> {
  const r = yield* objectPick(ctx, message);
  return r !== undefined && r !== 'enter' && !('keyword' in r) ? r : undefined;
}

async function* point(ctx: CommandContext, message: string): Sub<ConstraintPointRef | undefined> {
  const r = yield* pointPick(ctx, message);
  return r !== undefined && r !== 'enter' && !('keyword' in r) ? r : undefined;
}

export const isRef = (r: unknown): r is ConstraintRef =>
  typeof r === 'object' && r !== null && 'entity' in r;

export const sentence = (s: string): string =>
  `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`;

/**
 * Applies a constraint: solved with the drawing's others, the entities it moves and the
 * constraint itself one edit. False, with the solver's reason, when it is refused.
 */
async function apply(
  ctx: CommandContext,
  kind: GeometricConstraintKind,
  refs: readonly ConstraintRef[],
): Promise<boolean> {
  let solver;
  try {
    solver = await ctx.constraints?.();
  } catch (e) {
    ctx.message(`The constraint solver could not load: ${e instanceof Error ? e.message : e}`);
    return false;
  }
  if (!solver) {
    ctx.message('Geometric constraints are not available here.');
    return false;
  }
  const owner = ctx.model.meta.rootDictionary ?? '0';
  const constraint: GeometricConstraintObject = {
    // The handle is allocated with the edit; the solver only names it in a refusal.
    handle: '0',
    type: 'TRIYA_GEOMCONSTRAINT',
    owner,
    kind,
    refs,
  };
  const r = solver.add(
    geometricConstraints(ctx.model),
    constraint,
    (h) => ctx.model.entityByHandle(h),
    toleranceOf(ctx, refs),
    parameterObjects(ctx.model),
  );
  if (!r.ok) {
    ctx.message(sentence(r.message));
    return false;
  }
  ctx.edit((b) => {
    for (const u of r.updated) b.updateEntity(u.after.id, { geom: u.after.geom });
    setExpressions(ctx, b, r.expressions ?? []);
    b.addObject({ type: 'TRIYA_GEOMCONSTRAINT', owner, kind, refs } as Omit<
      GeometricConstraintObject,
      'handle'
    >);
  });
  return true;
}

/**
 * Keeps the drawing's dimensional constraints' expressions in step with a solve (M9-03 part 3):
 * a reference constraint measuring geometry that moved, or an expression a Parameters Manager
 * edit rewrote, a user parameter's included (part 6).
 */
export function setExpressions(
  ctx: CommandContext,
  b: ChangeSetBuilder,
  changes: readonly ExpressionChange[],
): void {
  if (!changes.length) return;
  const now = new Map(changes.map((c) => [c.parameter, c.expression]));
  for (const d of parameterObjects(ctx.model)) {
    const expression = now.get(d.parameter);
    if (expression !== undefined && expression !== d.expression) {
      b.updateObject(d.handle, { expression } as RecordPatch<NonGraphicalObject>);
    }
  }
}

// ── Each constraint's prompts ────────────────────────────────────────────────────────────────

/** Two objects: Perpendicular, Parallel, Tangent, Concentric. */
async function* twoObjects(ctx: CommandContext, kind: GeometricConstraintKind): CommandGenerator {
  for (;;) {
    const a = yield* object(ctx, 'Select first object');
    if (!a) return;
    const b = yield* object(ctx, 'Select second object');
    if (!b) return;
    if (await apply(ctx, kind, [a, b])) return;
  }
}

/** Horizontal or Vertical: a line, or two points (2Points, the default). */
async function* horizontalOrVertical(
  ctx: CommandContext,
  kind: 'horizontal' | 'vertical',
): CommandGenerator {
  for (;;) {
    const a = yield* objectPick(ctx, 'Select an object or', ['2Points'], '2Points');
    if (a === undefined) return;
    if (isRef(a)) {
      if (await apply(ctx, kind, [a])) return;
      continue;
    }
    const p = yield* point(ctx, 'Select first point');
    if (!p) return;
    const q = yield* point(ctx, 'Select second point');
    if (!q) return;
    if (await apply(ctx, kind, [p, q])) return;
  }
}

/** Coincident: two points, or (Object, the default) a point on an object. */
async function* coincident(ctx: CommandContext): CommandGenerator {
  for (;;) {
    const a = yield* pointPick(ctx, 'Select first point or', ['Object'], 'Object');
    if (a === undefined) return;
    if (isRef(a)) {
      const b = yield* point(ctx, 'Select second point');
      if (!b) return;
      if (await apply(ctx, 'coincident', [a, b])) return;
      continue;
    }
    const curve = yield* object(ctx, 'Select an object');
    if (!curve) return;
    const p = yield* point(ctx, 'Select a point');
    if (!p) return;
    if (await apply(ctx, 'coincident', [curve, p])) return;
  }
}

/**
 * Collinear or Equal: two objects, or with Multiple each object picked after the first made
 * collinear (equal) to it until Enter.
 */
async function* firstAndOthers(ctx: CommandContext, kind: 'collinear' | 'equal'): CommandGenerator {
  const other =
    kind === 'collinear'
      ? 'Select object to make collinear to the first'
      : 'Select object to make equal to the first';
  for (;;) {
    const a = yield* objectPick(ctx, 'Select first object or', ['Multiple']);
    if (a === undefined || a === 'enter') return;
    if (isRef(a)) {
      const b = yield* object(ctx, 'Select second object');
      if (!b) return;
      if (await apply(ctx, kind, [a, b])) return;
      continue;
    }
    const first = yield* object(ctx, 'Select first object');
    if (!first) return;
    for (;;) {
      const b = yield* object(ctx, other);
      if (!b) return;
      await apply(ctx, kind, [first, b]);
    }
  }
}

/** Symmetric: two objects, or (2Points, the default) two points, then the symmetry line. */
async function* symmetric(ctx: CommandContext): CommandGenerator {
  for (;;) {
    const a = yield* objectPick(ctx, 'Select first object or', ['2Points'], '2Points');
    if (a === undefined) return;
    let pair: readonly ConstraintRef[];
    if (isRef(a)) {
      const b = yield* object(ctx, 'Select second object');
      if (!b) return;
      pair = [a, b];
    } else {
      const p = yield* point(ctx, 'Select first point');
      if (!p) return;
      const q = yield* point(ctx, 'Select second point');
      if (!q) return;
      pair = [p, q];
    }
    const axis = yield* object(ctx, 'Select symmetry line');
    if (!axis) return;
    if (await apply(ctx, 'symmetric', [...pair, axis])) return;
  }
}

/** Fix: a point, or (Object, the default) an object, held where it is. */
async function* fix(ctx: CommandContext): CommandGenerator {
  for (;;) {
    const a = yield* pointPick(ctx, 'Select point or', ['Object'], 'Object');
    if (a === undefined) return;
    if (isRef(a)) {
      if (await apply(ctx, 'fix', [a])) return;
      continue;
    }
    // A POINT object is fixed by its position; any other object as a whole.
    for (;;) {
      const o = yield ctx.prompt.point({ message: 'Select an object', pickbox: true });
      if (o.kind !== 'point') return;
      const e = await entityAt(ctx, o.point);
      if (!e) continue;
      const ref: ConstraintRef | undefined =
        e.geom.kind === 'POINT'
          ? { entity: e.handle, point: 'position' }
          : constraintCurveAt(e, o.point, toleranceOf(ctx, [{ entity: e.handle }]));
      if (!ref) ctx.message(INVALID_OBJECT);
      else if (locked(ctx, e)) ctx.message(LOCKED);
      else if (await apply(ctx, 'fix', [ref])) return;
    }
  }
}

const SMOOTH_UNSUPPORTED = 'Smooth needs a spline, which constraints do not support yet.';

function constraintFlow(
  ctx: CommandContext,
  kind: Exclude<GeometricConstraintKind, 'smooth'>,
): CommandGenerator {
  switch (kind) {
    case 'horizontal':
    case 'vertical':
      return horizontalOrVertical(ctx, kind);
    case 'coincident':
      return coincident(ctx);
    case 'collinear':
    case 'equal':
      return firstAndOthers(ctx, kind);
    case 'symmetric':
      return symmetric(ctx);
    case 'fix':
      return fix(ctx);
    default:
      return twoObjects(ctx, kind);
  }
}

/** GEOMCONSTRAINT's keywords, in its prompt's order, with AutoCAD's capitals. */
const KEYWORDS: Readonly<Record<GeometricConstraintKind, string>> = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  perpendicular: 'Perpendicular',
  parallel: 'PArallel',
  tangent: 'Tangent',
  smooth: 'SMooth',
  coincident: 'Coincident',
  concentric: 'CONcentric',
  collinear: 'COLlinear',
  symmetric: 'Symmetric',
  equal: 'Equal',
  fix: 'Fix',
};

/** GEOMCONSTRAINT (GCON): the constraint type, then its prompts; the last type is the default. */
export function geomconstraintCommand(): CommandDef {
  let last: GeometricConstraintKind = 'horizontal';
  return {
    name: 'GEOMCONSTRAINT',
    solvesConstraints: true,
    async *run(ctx) {
      const options = GEOMETRIC_CONSTRAINT_KINDS.map((k) => KEYWORDS[k]);
      const a = yield ctx.prompt.keyword({
        message: 'Enter constraint type',
        options,
        default: { kind: 'keyword', keyword: KEYWORDS[last] },
      });
      if (a.kind !== 'keyword') return;
      const kind = GEOMETRIC_CONSTRAINT_KINDS.find((k) => KEYWORDS[k] === a.keyword);
      if (!kind) return;
      last = kind;
      if (kind === 'smooth') ctx.message(SMOOTH_UNSUPPORTED);
      else yield* constraintFlow(ctx, kind);
    },
  };
}

/** GCHORIZONTAL … GCFIX: one constraint each. GCSMOOTH waits for splines in the solver. */
export const GEOMETRIC_CONSTRAINT_COMMANDS: readonly CommandDef[] =
  GEOMETRIC_CONSTRAINT_KINDS.filter(
    (k): k is Exclude<GeometricConstraintKind, 'smooth'> => k !== 'smooth',
  ).map((kind) => ({
    name: `GC${kind.toUpperCase()}`,
    solvesConstraints: true,
    run: (ctx: CommandContext) => constraintFlow(ctx, kind),
  }));
