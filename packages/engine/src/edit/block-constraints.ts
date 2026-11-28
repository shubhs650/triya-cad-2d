// Constraints that go into a block definition with their objects and come out again (M9-13).
//
// AutoCAD keeps the constraints among a block's objects with the block definition: an
// associative array's source block keeps those of the objects arrayed, BLOCK's Delete and Convert
// keep those of the objects it takes in, and ARRAYEDIT Source and the Block Editor solve them
// while the objects are edited (AutoCAD 2024 Help, "About Constraints in Blocks", "ARRAYEDIT
// (Command)"). Triya's drawing keeps them as objects naming the block's objects (handed, not
// copied: a constraint keeps its handle and its parameter's name), and they act only where their
// objects are drawn (edit/constraints.ts, `heldInBlock`).
//
// A constraint goes with its objects only when every object it names goes, carried by the move
// (a block's coordinates are not the drawing's). Horizontal and Vertical follow `carriedKind`'s
// rule, a dimensional constraint's Horizontal and Vertical too; one a turn cannot keep, or a
// dimensional constraint across a scale (its value would no longer measure), is left to the
// caller, which sets it aside.
import type { ChangeSetBuilder } from '../model/builder';
import type { Handle } from '../model/handle';
import type { RecordPatch } from '../model/update';
import {
  isDimensionalConstraint,
  isGeometricConstraint,
  type Entity,
  type NonGraphicalObject,
} from '../model/types';
import { applyPoint } from '../geom/transform';
import { carriedKind, constraintsAmong, type CarriedConstraint } from './constraint-copy';
import type { Similarity } from './similarity';

const scales = (t: Similarity): boolean => Math.abs(t.scale - 1) > 1e-9;

/**
 * Hands each constraint wholly among the objects `moved` replaced (original handle → the object
 * standing for it now, which `t` carried there) to the new objects, keeping the constraint's
 * handle. Returns the constraints it could not carry, left as they were.
 */
export function handConstraints(
  b: ChangeSetBuilder,
  moved: ReadonlyMap<Handle, Entity>,
  t: Similarity,
): CarriedConstraint[] {
  const left: CarriedConstraint[] = [];
  if (moved.size === 0) return left;
  for (const c of constraintsAmong([...b.objects()], moved)) {
    const refs = c.refs.map((r) => ({ ...r, entity: moved.get(r.entity)!.handle }));
    if (isGeometricConstraint(c)) {
      const kind = carriedKind(c.kind, t);
      if (!kind) left.push(c);
      else b.updateObject(c.handle, { kind, refs } as RecordPatch<NonGraphicalObject>);
      continue;
    }
    const level = c.dimension === 'horizontal' || c.dimension === 'vertical';
    const dimension = level ? carriedKind(c.dimension, t) : c.dimension;
    if (!dimension || scales(t)) {
      left.push(c);
      continue;
    }
    b.updateObject(c.handle, {
      dimension,
      refs,
      location: applyPoint(t.m, c.location),
    } as RecordPatch<NonGraphicalObject>);
  }
  return left;
}

/** Puts constraint `c` back as it was, whether it is still in the drawing or not. */
export function putBack(b: ChangeSetBuilder, c: CarriedConstraint): void {
  const now = b.object(c.handle);
  if (!now) {
    b.restoreObject(c);
    return;
  }
  if (now === c) return;
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(now)) if (!(k in c)) patch[k] = undefined;
  for (const [k, v] of Object.entries(c)) if (k !== 'handle') patch[k] = v;
  b.updateObject(c.handle, patch as RecordPatch<NonGraphicalObject>);
}

/** The constraints of `b`'s drawing wholly among the objects `handles` names. */
export const constraintsOf = (
  b: ChangeSetBuilder,
  handles: ReadonlySet<Handle> | ReadonlyMap<Handle, unknown>,
): CarriedConstraint[] => constraintsAmong([...b.objects()], handles);

/** Whether `o` is a constraint a block's objects can hold. */
export const isCarriedConstraint = (o: NonGraphicalObject | undefined): o is CarriedConstraint =>
  isGeometricConstraint(o) || isDimensionalConstraint(o);
