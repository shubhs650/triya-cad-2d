// A dimension's breaks and inspection data (DIMBREAK and DIMINSPECT, M4-02 part 4, DEC-064):
// `TRIYA_DIMBREAK` and `TRIYA_DIMINSPECT` records in the dimension's extension dictionary. The
// dimension engine (`@triya/dims`) reads them when it draws the dimension; the commands write
// them and have the dimension drawn again; a command that moves a breaking object has the
// dimensions it breaks drawn again as it ends (`restyledDimensions`).
import type { Curve } from '../geom/curves';
import { boxesOverlap, curveBounds, unionBox, EMPTY_BOX, type Box } from '../geom/bounds';
import { intersect } from '../geom/intersect';
import type { Tolerance } from '../geom/tolerance';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { RecordPatch } from '../model/update';
import {
  isDimBreak,
  isDimInspect,
  type DimBreak,
  type DimInspect,
  type Entity,
  type NonGraphicalObject,
} from '../model/types';
import { point, type Similarity } from './similarity';
import { objectEdgeCurves } from './trim-edges';

/** What finding a dimension's records reads of the drawing. */
export type DimensionRecordSource = {
  readonly objects: ReadonlyMap<Handle, NonGraphicalObject>;
};

type Holder = Pick<Entity, 'handle' | 'extDict'>;

function recordOf<T extends NonGraphicalObject & { readonly dimension: Handle }>(
  model: DimensionRecordSource,
  e: Holder,
  is: (o: NonGraphicalObject) => o is T,
): T | undefined {
  // Only a dimension with an extension dictionary can hold one: most have none.
  if (e.extDict === undefined) return undefined;
  for (const o of model.objects.values()) {
    if (is(o) && o.dimension === e.handle && o.owner === e.extDict) return o;
  }
  return undefined;
}

/** The dimension's breaks, when it has any. */
export const dimBreakOf = (model: DimensionRecordSource, e: Holder): DimBreak | undefined =>
  recordOf(model, e, isDimBreak);

/** The dimension's inspection data, when it is an inspection dimension. */
export const dimInspectOf = (model: DimensionRecordSource, e: Holder): DimInspect | undefined =>
  recordOf(model, e, isDimInspect);

const EDGES = { extend: false, hatches: false } as const;

/**
 * The curves the objects of `record` break dimension `dim` with, in the dimension's space: each
 * object's lines and arcs (what a block, dimension or leader draws). An object that is gone, in
 * another space or the dimension itself breaks nothing.
 */
export function breakingCurves(
  model: DocumentModel,
  dim: Pick<Entity, 'handle' | 'owner'>,
  record: Pick<DimBreak, 'objects'>,
  tol: Tolerance,
): Curve[] {
  const out: Curve[] = [];
  for (const h of record.objects) {
    const e = model.entityByHandle(h);
    if (!e || e.handle === dim.handle || e.owner !== dim.owner) continue;
    out.push(...objectEdgeCurves({ model, tol }, e, EDGES));
  }
  return out;
}

const boundsOf = (curves: readonly Curve[], tol: Tolerance): Box =>
  curves.reduce((b, c) => unionBox(b, curveBounds(c, tol)), EMPTY_BOX);

/**
 * DIMBREAK's Auto: the objects of the dimension's space that cross what it draws now ("places
 * dimension breaks automatically at all the intersection points of the objects that intersect
 * the selected dimension", AutoCAD 2024 Help, DIMBREAK), in drawing order.
 */
export function crossingObjects(model: DocumentModel, dim: Entity, tol: Tolerance): Handle[] {
  const own = objectEdgeCurves({ model, tol }, dim, EDGES);
  if (own.length === 0) return [];
  const box = boundsOf(own, tol);
  const out: Handle[] = [];
  for (const id of model.blockEntities(dim.owner)) {
    const e = model.entity(id);
    if (!e || e.handle === dim.handle) continue;
    const layer = model.tables.layers.get(e.layer);
    if (layer && (!layer.on || layer.frozen)) continue;
    const curves = breakingCurves(model, dim, { objects: [e.handle] }, tol);
    if (curves.length === 0 || !boxesOverlap(boundsOf(curves, tol), box, tol.linear)) continue;
    if (curves.some((c) => own.some((d) => intersect(c, d, tol).length > 0))) out.push(e.handle);
  }
  return out;
}

/**
 * Gives dimension `dim` (as the change being built sees it) the record `fields` describe, in its
 * extension dictionary, which is made when it has none; an existing record of the same type is
 * rewritten. `undefined` takes the record off.
 */
export function setDimensionRecord<T extends DimBreak | DimInspect>(
  b: ChangeSetBuilder,
  dim: Entity,
  type: T['type'],
  fields: Omit<T, 'handle' | 'owner' | 'type' | 'dimension'> | undefined,
): void {
  const objects = new Map([...b.objects()].map((o) => [o.handle, o]));
  const now = recordOf({ objects }, dim, (o): o is T => o.type === type);
  if (!fields) {
    if (now) b.removeObject(now.handle);
    return;
  }
  if (now) {
    // Every field the record had and `fields` leaves out goes (a label turned off).
    const gone = Object.fromEntries(Object.keys(now).map((k) => [k, undefined]));
    const { handle: _h, owner: _o, type: _t, dimension: _d, ...cleared } = gone;
    b.updateObject(now.handle, { ...cleared, ...fields } as RecordPatch<NonGraphicalObject>);
    return;
  }
  let owner = dim.extDict;
  if (owner === undefined) {
    owner = b.allocateHandle();
    b.updateEntity(dim.id, { extDict: owner });
  }
  b.addObject({ ...fields, type, owner, dimension: dim.handle } as Omit<T, 'handle'>);
}

/** The records of dimensions in `handles`, as the change being built sees the drawing. */
function recordsOf(b: ChangeSetBuilder, handles: ReadonlySet<Handle>): (DimBreak | DimInspect)[] {
  const out: (DimBreak | DimInspect)[] = [];
  for (const o of b.objects()) {
    if ((isDimBreak(o) || isDimInspect(o)) && handles.has(o.dimension)) out.push(o);
  }
  return out;
}

const carriedManual = (r: DimBreak, t: Similarity): DimBreak['manual'] =>
  r.manual.map(([p, q]) => [point(t, p), point(t, q)] as const);

/**
 * MOVE, ROTATE, SCALE and MIRROR carry the manual breaks of the dimensions they carry, which
 * stay where they were put on the dimension; a break by an object follows the object.
 */
export function carryDimensionRecords(
  b: ChangeSetBuilder,
  moved: readonly Pick<Entity, 'handle'>[],
  t: Similarity,
): void {
  for (const r of recordsOf(b, new Set(moved.map((e) => e.handle)))) {
    if (isDimBreak(r) && r.manual.length > 0) {
      b.updateObject(r.handle, { manual: carriedManual(r, t) } as RecordPatch<NonGraphicalObject>);
    }
  }
}

/**
 * COPY gives each copy of a dimension its breaks and inspection data (`copies`: original handle
 * → copy), in an extension dictionary of its own; manual breaks carried with it.
 */
export function copyDimensionRecords(
  b: ChangeSetBuilder,
  copies: ReadonlyMap<Handle, Entity>,
  t: Similarity,
): void {
  for (const r of recordsOf(b, new Set(copies.keys()))) {
    const copy = b.entity(copies.get(r.dimension)!.id);
    if (!copy) continue;
    const { handle: _h, owner: _o, dimension: _d, type, ...fields } = r;
    if (isDimBreak(r)) {
      setDimensionRecord<DimBreak>(b, copy, type as DimBreak['type'], {
        ...(fields as Omit<DimBreak, 'handle' | 'owner' | 'type' | 'dimension'>),
        manual: carriedManual(r, t),
      });
    } else {
      setDimensionRecord<DimInspect>(
        b,
        copy,
        type as DimInspect['type'],
        fields as Omit<DimInspect, 'handle' | 'owner' | 'type' | 'dimension'>,
      );
    }
  }
}
