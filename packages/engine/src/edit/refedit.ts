// In-place reference editing (M5-02 part 3), the geometry side of REFEDIT, REFSET and REFCLOSE as
// AutoCAD 2024 has them (AutoCAD Help, "REFEDIT (Command)", "Reference Edit Dialog Box",
// "REFSET (Command)", "REFCLOSE (Command)"):
//
// - the working set, the objects of the block chosen that are edited, is carried out of the
//   definition into the space the reference is in, placed where the reference draws them (the
//   references' placements from the one picked inward), so the drafter edits them in place with
//   every command and object snap;
// - saving carries the working set back into the definition by the inverse placement, objects
//   drawn meanwhile included, so every reference to the block shows the edits.
//
// The objects keep their handles both ways (`moveEntity`), with their xdata, reactors and
// extension dictionaries. An object no command touched while it was out is put back exactly as it
// was (no rounding from carrying it out and back), with what was carried along with it (a
// dimension's block, its associations' points).
//
// A reference scaled differently in X and Y (M5-02 part 8) carries its objects by that scale, as
// EXPLODE carries them (`carriedGeometry`: lines, polylines without arcs or widths, ellipses,
// splines, points, solids, text whose frame stays square, references whose axes do). The scale
// draws a circle or an arc as an ellipse, which an object cannot become under its own handle: an
// ellipse stands in for it while it is edited, and on the way back it is the circle or arc again,
// under its own handle, while it is still round (AutoCAD does not document how its REFEDIT carries
// objects of a nonuniformly scaled reference; this keeps every object the drafter did not make
// out of round what it was, the common drafter expectation). What the scale cannot carry stays in
// the block; what the inverse scale cannot carry back (a polyline given an arc meanwhile, say)
// stays in the drawing.
import type { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { AttdefGeometry, Entity, EntityGeometry, InsertGeometry } from '../model/types';
import { normalizeAngle, TAU } from '../geom/angle';
import { compose, invert, rotation, scaling, translation, type Matrix2D } from '../geom/transform';
import { toleranceForSize } from '../geom/tolerance';
import { isXrefDependent, isXrefRecord, xrefBringing } from '../model/xref';
import { ATTRIBUTE_CONSTANT } from './blocks';
import { copiedProps, patchBack, transformObjects } from './edit';
import { carriedGeometry } from './explode';
import { asSimilarity, similarity, type Similarity } from './similarity';
import { transformProblem } from './transform';

/**
 * How a reference carries its block's contents into the space: a similarity, or for a reference
 * scaled differently in X and Y (or nested in one) the affine map (M5-02 part 8).
 */
export type Placement = Similarity | { readonly affine: Matrix2D };

/** The matrix of a placement. */
export const placementMatrix = (t: Placement): Matrix2D => ('affine' in t ? t.affine : t.m);

const placementOf = (m: Matrix2D): Placement => asSimilarity(m) ?? { affine: m };

/**
 * How the block reference `g` carries its block's contents into the space it is in (base point
 * to the insertion point, scaled, then turned), or why it cannot be edited in place.
 */
export function referencePlacement(model: DocumentModel, g: InsertGeometry): Placement | string {
  const def = model.blocks.get(g.block);
  const record = model.tables.blockRecords.get(g.block);
  if (!def || !record) return 'the block is missing';
  // An xref is edited in place and saved to its own file (M5-02 part 6), once loaded.
  if (isXrefRecord(record) && !def.xrefLoaded) return 'the external reference is not loaded';
  // A block an xref brought in (`xref|name`) is edited in place and saved to the xref's file
  // (M5-02 part 7), while that xref is loaded.
  if (isXrefDependent(record) && !isXrefRecord(record) && !xrefBringing(model, g.block))
    return 'the external reference that brought the block in is not loaded';
  if (record.name.startsWith('*')) return 'an anonymous or dynamic block cannot be edited in place';
  if (g.array && (g.array.columns > 1 || g.array.rows > 1))
    return 'a MINSERT cannot be edited in place';
  if (g.normal && (g.normal.x !== 0 || g.normal.y !== 0 || g.normal.z <= 0))
    return 'the block reference is not in plan';
  const sx = g.scale.x;
  const sy = g.scale.y;
  if (sx === 0 || sy === 0) return 'the block reference has a zero scale';
  return placementOf(
    compose(
      translation(-def.basePoint.x, -def.basePoint.y),
      scaling(sx, sy),
      rotation(g.rotation),
      translation(g.position.x, g.position.y),
    ),
  );
}

/**
 * The placement of the innermost of `path` (references, the first in the space shown, each next
 * one in the block of the one before): the block of the last is carried by it into the space.
 */
export function pathPlacement(model: DocumentModel, path: readonly EntityId[]): Placement | string {
  let t: Placement | undefined;
  for (const id of path) {
    const g = model.entity(id)?.geom;
    if (g?.kind !== 'INSERT') return 'the object is not a block reference';
    const own = referencePlacement(model, g);
    if (typeof own === 'string') return own;
    t = t ? placementOf(compose(placementMatrix(own), placementMatrix(t))) : own;
  }
  return t ?? 'no block reference was selected';
}

/**
 * The objects of `block` REFEDIT's "Automatically select all nested objects" takes: all of them,
 * but the variable attribute definitions unless they are shown for editing ("Display attribute
 * definitions for editing"; constant ones are drawn by every reference, so they are geometry).
 */
export function wholeWorkingSet(
  model: DocumentModel,
  block: Handle,
  attributes: boolean,
): EntityId[] {
  return model.blockEntities(block).filter((id) => {
    const g = model.entity(id)!.geom;
    return (
      attributes || g.kind !== 'ATTDEF' || ((g as AttdefGeometry).flags & ATTRIBUTE_CONSTANT) !== 0
    );
  });
}

/** What carrying a working set out made, for carrying it back. */
export interface Extraction {
  /**
   * The objects carried out (by their ids in the space), as the definition held them. An ellipse
   * standing in for a circle or an arc (`Placement` affine) maps to the circle or arc.
   */
  readonly originals: ReadonlyMap<EntityId, Entity>;
  /** Objects that cannot be carried (an OLE object, a proxy), left in the definition. */
  readonly refused: number;
  /** How many circles and arcs an ellipse stands in for. */
  readonly standIns: number;
}

/**
 * Carries `ids` (objects of a block's definition, in its order) into `space` by `t`, keeping
 * their handles. What `t` cannot carry stays in the definition.
 */
export function extractWorkingSet(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  t: Placement,
  space: Handle,
): Extraction {
  if ('affine' in t) return extractAffine(b, ids, t.affine, space);
  const originals = new Map<EntityId, Entity>();
  let refused = 0;
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    if (transformProblem(e.geom, t)) {
      refused += 1;
      continue;
    }
    originals.set(id, e);
    b.moveEntity(id, space);
  }
  // Text and hatch patterns are carried mirrored when the reference is: the reference draws them
  // so, and the way back must find them as the definition holds them.
  transformObjects(b, model, [...originals.keys()], t, {
    mirrorText: true,
    mirrorHatch: true,
    locked: true,
  });
  return { originals, refused, standIns: 0 };
}

/** `extractWorkingSet` by a nonuniform scale `m`: each object carried as `carriedGeometry` has it. */
function extractAffine(
  b: ChangeSetBuilder,
  ids: readonly EntityId[],
  m: Matrix2D,
  space: Handle,
): Extraction {
  const originals = new Map<EntityId, Entity>();
  let refused = 0;
  let standIns = 0;
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    const geom = carriedGeometry(b, e.geom, m);
    if (!geom) {
      refused += 1;
    } else if (geom.kind === e.geom.kind) {
      originals.set(id, e);
      b.moveEntity(id, space);
      b.updateEntity(id, { geom });
    } else {
      // A circle or an arc, drawn as an ellipse: one stands in for it until it goes back.
      b.removeEntity(id);
      const s = b.addEntity({ ...copiedProps(b, e), owner: space, geom });
      originals.set(s.id, e);
      standIns += 1;
    }
  }
  return { originals, refused, standIns };
}

/** What `cs` changed: entity ids and object handles. */
export function changedIn(cs: ChangeSet, into: Set<EntityId | Handle>): void {
  const e = cs.entities;
  for (const a of e?.added ?? []) into.add(a.entity.id);
  for (const u of e?.updated ?? []) into.add(u.before.id);
  for (const r of e?.removed ?? []) into.add(r.entity.id);
  const o = cs.objects;
  for (const a of o?.added ?? []) into.add(a.handle);
  for (const u of o?.updated ?? []) into.add(u.before.handle);
  for (const r of o?.removed ?? []) into.add(r.handle);
}

export interface WorkingSetReturn {
  readonly block: Handle;
  /** The placement the working set was carried out by. */
  readonly t: Placement;
  /** The change that carried it out, and what it carried (`extractWorkingSet`). */
  readonly extraction: ChangeSet;
  readonly originals: ReadonlyMap<EntityId, Entity>;
  /** What changed after the extraction (`changedIn` over the later changes). */
  readonly touched: ReadonlySet<EntityId | Handle>;
}

/**
 * REFCLOSE's Save: the working set `ids` (objects of the space, those carried out first in the
 * definition's order) carried back into the definition. What no later change touched is put back
 * exactly as it was.
 */
export function returnWorkingSet(
  b: ChangeSetBuilder,
  model: DocumentModel,
  r: WorkingSetReturn,
  ids: readonly EntityId[],
): EntityId[] {
  if ('affine' in r.t) return returnAffine(b, r, r.t.affine, ids);
  for (const id of ids) b.moveEntity(id, r.block);
  transformObjects(b, model, ids, similarity(invert(r.t.m)), {
    mirrorText: true,
    mirrorHatch: true,
    locked: true,
  });
  const same = (id: EntityId | Handle) => !r.touched.has(id);
  for (const id of ids) {
    const was = r.originals.get(id);
    if (was && same(id)) b.updateEntity(id, patchBack(was, b.entity(id)!));
  }
  // A dimension's block and the records carried along with what went out, untouched since.
  for (const u of r.extraction.entities?.updated ?? []) {
    const now = b.entity(u.before.id);
    if (now && same(u.before.id)) b.updateEntity(u.before.id, patchBack(u.before, now));
  }
  for (const u of r.extraction.objects?.updated ?? []) {
    const now = b.object(u.before.handle);
    if (now && same(u.before.handle))
      b.updateObject(u.before.handle, patchBack(u.before, now) as never);
  }
  return [];
}

/** The props of `e` a command may change on the object standing in for it. */
function shownProps(b: ChangeSetBuilder, e: Entity) {
  const { xdata: _xdata, ...props } = copiedProps(b, e);
  return props;
}

/**
 * `returnWorkingSet` by a nonuniform scale `m`; returns the objects the inverse scale cannot
 * carry, which stay in the space.
 */
function returnAffine(
  b: ChangeSetBuilder,
  r: WorkingSetReturn,
  m: Matrix2D,
  ids: readonly EntityId[],
): EntityId[] {
  const back = invert(m);
  const left: EntityId[] = [];
  for (const id of ids) {
    const now = b.entity(id)!;
    const was = r.originals.get(id);
    const touched = r.touched.has(id);
    if (was && was.id !== id) {
      // An ellipse standing in for a circle or an arc.
      b.removeEntity(id);
      b.restoreEntity(was);
      if (!touched) continue;
      const geom = carriedGeometry(b, now.geom, back)!;
      const round = roundAgain(geom, was.geom);
      if (round) {
        b.updateEntity(was.id, { ...shownProps(b, now), geom: round });
      } else {
        // Out of round: an ellipse takes its place in the block.
        b.removeEntity(was.id);
        b.addEntity({ ...copiedProps(b, now), owner: r.block, geom });
      }
      continue;
    }
    if (was && !touched) {
      b.moveEntity(id, r.block);
      b.updateEntity(id, patchBack(was, b.entity(id)!));
      continue;
    }
    const geom = carriedGeometry(b, now.geom, back);
    if (!geom) {
      left.push(id);
    } else if (geom.kind === now.geom.kind) {
      b.moveEntity(id, r.block);
      b.updateEntity(id, { geom });
    } else {
      // A circle or an arc drawn meanwhile is an ellipse in the block.
      b.removeEntity(id);
      b.addEntity({ ...copiedProps(b, now), owner: r.block, geom });
    }
  }
  return left;
}

/**
 * The ellipse `g` as the circle or arc `was` (its kind and the rest of its geometry), when it is
 * still round and, for a circle, whole; undefined otherwise.
 */
function roundAgain(g: EntityGeometry, was: EntityGeometry): EntityGeometry | undefined {
  if (g.kind !== 'ELLIPSE' || (was.kind !== 'CIRCLE' && was.kind !== 'ARC')) return undefined;
  const radius = Math.hypot(g.majorAxis.x, g.majorAxis.y);
  const tol = toleranceForSize(Math.max(Math.abs(g.center.x), Math.abs(g.center.y), radius));
  if (radius * (1 - g.ratio) > tol.linear) return undefined;
  const sweep = g.endParam - g.startParam;
  const whole = Math.abs(sweep - TAU) <= tol.angular * TAU;
  if (was.kind === 'CIRCLE') return whole ? { ...was, center: g.center, radius } : undefined;
  if (whole) return undefined;
  // A round ellipse's parameter is the angle from its major axis.
  const axis = Math.atan2(g.majorAxis.y, g.majorAxis.x);
  return {
    ...was,
    center: g.center,
    radius,
    startAngle: normalizeAngle(axis + g.startParam),
    endAngle: normalizeAngle(axis + g.endParam),
  };
}
