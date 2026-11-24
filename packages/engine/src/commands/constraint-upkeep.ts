// Constraints kept in step with the edits commands make (M9-06, PRD FR-X4, ARCHITECTURE.md §11's
// `ConstraintAwareness`): as a command ends, the bus hands this its change sets, and each
// geometric or dimensional constraint on an object the command changed is kept, dropped or
// re-solved.
//
// - An object erased (ERASE, or removed by any command) takes its constraints with it, as AutoCAD
//   deletes them; U brings both back, the removal being part of the command's undo step.
// - TRIM, EXTEND, FILLET, CHAMFER, BREAK, BREAKATPOINT, EXPLODE and JOIN drop the constraints on
//   the objects they change, with a notification (FR-X4; AutoCAD 2024 Help, "About Constraining
//   Objects": "TRIM, EXTEND, BREAK, and JOIN commands can remove constraints"), as does any edit
//   that changes an object's type or a polyline's vertices, which the constraint's points name.
// - Any other edit (MOVE, ROTATE, SCALE, MIRROR, STRETCH, LENGTHEN, grips, the Properties
//   palette) is re-solved: what the edit placed is held and the geometry constrained to it
//   follows. A modify command places its objects whole; a grip drag or a palette edit only the
//   values it changed, the rest of the object following its constraints. Constraints wholly
//   within the objects moved together still hold, so nothing else moves. Dimensional
//   constraints hold their values; a reference one measures the geometry again. An edit the constraints cannot take (moving a Fixed object, turning a Horizontal line)
//   is refused with the solver's reason and the command's changes are taken back: AutoCAD keeps
//   the constraint and the geometry does not turn. Its Help does not say what ROTATE does to a
//   Horizontal line; drafters report that the line will not rotate, which this follows.
//
// Copies carry the constraints among the objects copied (COPY, MIRROR, ROTATE and SCALE's Copy:
// `carryConstraints`, made with the copies), so nothing here handles them.
import {
  constraintPointsOf,
  dimensionalConstraints,
  geometricConstraints,
  userParameters,
} from '../edit/constraints';
import type { Tolerance } from '../geom/tolerance';
import type { ChangeSet, Replacement } from '../model/changeset';
import type { Handle } from '../model/handle';
import {
  isGeometricConstraint,
  type ConstraintRef,
  type DimensionalConstraintObject,
  type Entity,
  type EntityGeometry,
  type GeometricConstraintObject,
} from '../model/types';
import type { CommandContext } from './command';
import { setExpressions } from './constraints';
import { toleranceFor } from './modify/offset';

/** The commands whose changes drop the constraints on what they change (FR-X4). */
export const DROPS_CONSTRAINTS: ReadonlySet<string> = new Set([
  'BREAK',
  'BREAKATPOINT',
  'CHAMFER',
  'EXPLODE',
  'EXTEND',
  'FILLET',
  'JOIN',
  'TRIM',
]);

/**
 * The edits that move only what they changed, the rest of the object free to follow its
 * constraints: grip drags and the Properties palette's coordinates (AutoCAD: dragging a grip of a
 * Horizontal line moves the whole line up). Every other command places its objects whole: a line
 * ROTATE turns about its start keeps that start where it is.
 */
export const MOVES_CHANGED_VALUES: ReadonlySet<string> = new Set(['GRIP', 'PROPERTIES']);

/** What a command's change sets did to the drawing's entities, taken together. */
export interface NetEntityChanges {
  /** Entities there before and after, changed: their first `before` and last `after`. */
  readonly updated: ReadonlyMap<Handle, Replacement<Entity>>;
  /** Entities there before and gone after. */
  readonly removed: ReadonlySet<Handle>;
}

/** The entities `changes` changed overall: one added and removed again counts as neither. */
export function netEntityChanges(changes: readonly ChangeSet[]): NetEntityChanges {
  // undefined: not yet seen; null: absent at that point.
  const first = new Map<Handle, Entity | null>();
  const last = new Map<Handle, Entity | null>();
  const see = (h: Handle, before: Entity | null, after: Entity | null) => {
    if (!first.has(h)) first.set(h, before);
    last.set(h, after);
  };
  for (const cs of changes) {
    const e = cs.entities;
    if (!e) continue;
    for (const r of e.removed ?? []) see(r.entity.handle, r.entity, null);
    for (const u of e.updated ?? []) see(u.after.handle, u.before, u.after);
    for (const a of e.added ?? []) see(a.entity.handle, null, a.entity);
  }
  const updated = new Map<Handle, Replacement<Entity>>();
  const removed = new Set<Handle>();
  for (const [h, before] of first) {
    if (!before) continue;
    const after = last.get(h)!;
    if (!after) removed.add(h);
    else if (after.geom !== before.geom) updated.set(h, { before, after });
  }
  return { updated, removed };
}

/**
 * Whether a constraint's references still name the same points of `after`: the same type and,
 * for a polyline, the same vertices and closure (a reference names a vertex or segment by index).
 */
function sameShape(before: EntityGeometry, after: EntityGeometry): boolean {
  if (before.kind !== after.kind) return false;
  if (before.kind === 'LWPOLYLINE' && after.kind === 'LWPOLYLINE') {
    return before.vertices.length === after.vertices.length && before.closed === after.closed;
  }
  return true;
}

/** A constraint as the upkeep sees it: the objects it names. */
type Constrains = { readonly handle: Handle; readonly refs: readonly ConstraintRef[] };

/** What a command's changes mean for the drawing's constraints. */
export interface UpkeepPlan<C extends Constrains = GeometricConstraintObject> {
  /** Constraints on an object removed, reshaped, or changed by a command that drops them. */
  readonly dropped: readonly C[];
  /** The others. */
  readonly kept: readonly C[];
  /** The changes to objects the kept constraints name: what a re-solve holds. */
  readonly edits: readonly Replacement<Entity>[];
}

/** Which of `constraints` `command`'s changes (`net`) drop, and what the rest re-solve. */
export function planUpkeep<C extends Constrains>(
  command: string,
  net: NetEntityChanges,
  constraints: readonly C[],
): UpkeepPlan<C> {
  const drops = DROPS_CONSTRAINTS.has(command);
  const lost = (h: Handle): boolean => {
    if (net.removed.has(h)) return true;
    const u = net.updated.get(h);
    return u !== undefined && (drops || !sameShape(u.before.geom, u.after.geom));
  };
  const dropped: C[] = [];
  const kept: C[] = [];
  for (const c of constraints) (c.refs.some((r) => lost(r.entity)) ? dropped : kept).push(c);
  const constrained = new Set(kept.flatMap((c) => c.refs.map((r) => r.entity)));
  const edits = [...net.updated.values()].filter((u) => constrained.has(u.after.handle));
  return { dropped, kept, edits };
}

/** The tolerance a re-solve works to: the drawing's, over the points the edit moved. */
function toleranceOf(ctx: CommandContext, edits: readonly Replacement<Entity>[]): Tolerance {
  const pts = edits.flatMap((e) => [
    ...constraintPointsOf(e.before).map((c) => c.at),
    ...constraintPointsOf(e.after).map((c) => c.at),
  ]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return toleranceFor(ctx.model, {
    kind: 'LINE',
    start: { x: Math.min(0, ...xs), y: Math.min(0, ...ys) },
    end: { x: Math.max(1, ...xs), y: Math.max(1, ...ys) },
  });
}

const sentence = (s: string): string =>
  `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`;

/**
 * Keeps the drawing's constraints in step with what `command` changed (`changes`, its undo
 * step so far), adding its own edits to the step. False when the constraints refuse the edit:
 * the caller takes the command's changes back.
 */
export async function keepConstraints(
  ctx: CommandContext,
  command: string,
  changes: readonly ChangeSet[],
): Promise<boolean> {
  const net = netEntityChanges(changes);
  if (net.updated.size === 0 && net.removed.size === 0) return true;
  const all: (GeometricConstraintObject | DimensionalConstraintObject)[] = [
    ...geometricConstraints(ctx.model),
    ...dimensionalConstraints(ctx.model),
  ];
  if (all.length === 0) return true;
  const { dropped, kept, edits } = planUpkeep(command, net, all);
  if (dropped.length > 0) {
    ctx.edit((b) => dropped.forEach((c) => b.removeObject(c.handle)));
    const geometric = dropped.filter((c) => isGeometricConstraint(c)).length;
    const dimensional = dropped.length - geometric;
    const removed = (n: number, kind: string) =>
      n > 0 && ctx.message(`${n} ${kind} constraint${n === 1 ? '' : 's'} removed.`);
    removed(geometric, 'geometric');
    removed(dimensional, 'dimensional');
  }
  if (edits.length === 0) return true;
  let solver;
  try {
    solver = await ctx.constraints?.();
  } catch (e) {
    ctx.message(`The constraint solver could not load: ${e instanceof Error ? e.message : e}`);
    return true;
  }
  // Without a solver (scripts, tests that give none) the constraints are left as they are.
  if (!solver) return true;
  const before = new Map(edits.map((u) => [u.after.handle, u.before]));
  const r = solver.solveEdit(
    kept.filter(isGeometricConstraint),
    edits,
    (h) => before.get(h) ?? ctx.model.entityByHandle(h),
    toleranceOf(ctx, edits),
    !MOVES_CHANGED_VALUES.has(command),
    // The user parameters too, which the constraints' expressions may name (M9-03 part 6).
    [
      ...kept.filter((c): c is DimensionalConstraintObject => !isGeometricConstraint(c)),
      ...userParameters(ctx.model),
    ],
  );
  if (!r.ok) {
    ctx.message(sentence(r.message));
    return false;
  }
  const moved: [Entity, EntityGeometry][] = [];
  for (const u of r.updated) {
    const now = ctx.model.entityByHandle(u.after.handle);
    if (now && now !== u.after && now.geom !== u.after.geom) moved.push([now, u.after.geom]);
  }
  const expressions = r.expressions ?? [];
  if (moved.length > 0 || expressions.length > 0) {
    ctx.edit((b) => {
      for (const [e, geom] of moved) b.updateEntity(e.id, { geom });
      setExpressions(ctx, b, expressions);
    });
  }
  return true;
}
