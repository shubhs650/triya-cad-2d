// EXPLODE's edits (M3-02 part 4), as AutoCAD 2024 explodes (AutoCAD Help, "EXPLODE (Command)"):
//
// - A 2D polyline becomes its lines and arcs, along its centre line, losing its widths (AutoCAD
//   warns of that) and its fit; a 3D polyline becomes lines. Each piece keeps the polyline's
//   properties, elevation and thickness.
// - A block reference becomes copies of what its block holds, carried as the reference places
//   them, one level at a time (a nested reference stays a reference). The copies keep their own
//   properties, as AutoCAD's do ("the color, linetype and lineweight of any exploded object might
//   change": what was on layer 0 or ByBlock shows as it is). The reference's attributes go and
//   the block's attribute definitions show. External references, MINSERT arrays and blocks
//   whose definition is not explodable are not exploded; nor, yet, are references scaled
//   differently in X and Y (AutoCAD turns their circles into ellipses).
// - A dimension becomes the lines, text, solids and points of the block it was last drawn as.
//   AutoCAD's help does not say which layer and colours the pieces take; they are given the
//   dimension's wherever they were layer 0 or ByBlock, so that the drawing looks the same, the
//   common drafter expectation.
//
// Everything else is left alone ("N objects could not be exploded").
import { compose, rotation, scaling, translation } from '../geom/transform';
import { explodePolyline } from '../geom/eval';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Entity, EntityGeometry } from '../model/types';
import { AnonymousNames, copyObjects, copyProblem, eraseObjects, reshapeObject } from './edit';
import { normalizeAngle } from '../geom/angle';
import { cleanPolyline } from './offset';
import { similarity, type Similarity } from './similarity';

export interface ExplodeReport {
  /** The objects the explodes made. */
  readonly made: EntityId[];
  /** How many objects were exploded. */
  readonly exploded: number;
  /** Why the others were not, with how many. */
  readonly refused: Map<string, number>;
  /** A polyline with widths was exploded (AutoCAD's warning). */
  readonly lostWidth: boolean;
}

const count = (m: Map<string, number>, why: string) => m.set(why, (m.get(why) ?? 0) + 1);

/** EXPLODE: each of `ids` broken into what it is made of. */
export function explodeObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
): ExplodeReport {
  const made: EntityId[] = [];
  const refused = new Map<string, number>();
  let exploded = 0;
  let lostWidth = false;
  // The `*D` blocks of dimensions copied out of blocks are named afresh across the whole edit.
  const names = new AnonymousNames(model);
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    const g = e.geom;
    switch (g.kind) {
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pieces = polylinePieces(g);
        if (pieces.length === 0) {
          count(refused, 'the polyline has no segments');
          continue;
        }
        if (hasWidth(g)) lostWidth = true;
        made.push(...reshapeObject(b, model, id, pieces));
        exploded++;
        continue;
      }
      case 'INSERT': {
        const problem = insertProblem(b, g);
        if (typeof problem === 'string') {
          count(refused, problem);
          continue;
        }
        const contents = b.blockEntities(g.block);
        const stuck = contents.map((c) => b.entity(c)!).find((c) => copyProblem(c, problem));
        if (stuck) {
          count(refused, `the block holds ${article(stuck.type)} that cannot be exploded`);
          continue;
        }
        const r = copyObjects(
          b,
          model,
          contents,
          problem,
          { mirrorText: true, mirrorHatch: true },
          e.owner,
          names,
        );
        made.push(...r.ids);
        eraseObjects(b, model, [id]);
        exploded++;
        continue;
      }
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION': {
        if (g.block === undefined || !b.block(g.block)) {
          count(refused, 'the dimension has no block to explode');
          continue;
        }
        const contents = b.blockEntities(g.block);
        const identity = similarity(translation(0, 0));
        const r = copyObjects(b, model, contents, identity, {}, e.owner, names);
        for (const c of r.ids) asDrawnBy(b, model, c, e);
        made.push(...r.ids);
        eraseObjects(b, model, [id]);
        exploded++;
        continue;
      }
      default:
        count(refused, `${article(g.kind)} cannot be exploded`);
    }
  }
  return { made, exploded, refused, lostWidth };
}

const article = (kind: string): string => (/^[AEIOU]/.test(kind) ? `an ${kind}` : `a ${kind}`);

/** A polyline's lines and arcs (3D: lines), with its elevation and thickness. */
function polylinePieces(g: Extract<EntityGeometry, { kind: 'LWPOLYLINE' | 'POLYLINE' }>) {
  const flat = g.kind === 'POLYLINE' && g.is3d;
  const curve = cleanPolyline(
    flat ? { ...g, vertices: g.vertices.map((v) => ({ ...v, bulge: 0 })) } : g,
  ).curve;
  const planar = {
    ...(g.elevation !== undefined && g.elevation !== 0 && !flat && { elevation: g.elevation }),
    ...(g.thickness !== undefined && g.thickness !== 0 && { thickness: g.thickness }),
    ...(g.normal !== undefined && !flat && { normal: g.normal }),
  };
  // Arc angles in [0, 2π), as the file has them.
  return explodePolyline(curve).map((piece): EntityGeometry =>
    piece.kind === 'ARC'
      ? {
          ...piece,
          startAngle: normalizeAngle(piece.startAngle),
          endAngle: normalizeAngle(piece.endAngle),
          ...planar,
        }
      : { ...piece, ...planar },
  );
}

function hasWidth(g: Extract<EntityGeometry, { kind: 'LWPOLYLINE' | 'POLYLINE' }>): boolean {
  if (g.kind === 'LWPOLYLINE' && (g.constantWidth ?? 0) !== 0) return true;
  if (g.kind === 'POLYLINE' && ((g.startWidth ?? 0) !== 0 || (g.endWidth ?? 0) !== 0)) return true;
  return g.vertices.some((v) => (v.startWidth ?? 0) !== 0 || (v.endWidth ?? 0) !== 0);
}

/**
 * How a block reference carries its block's contents to the drawing (base point to the
 * insertion point, scaled, then turned), or why it is not exploded.
 */
function insertProblem(
  b: ChangeSetBuilder,
  g: Extract<EntityGeometry, { kind: 'INSERT' }>,
): Similarity | string {
  const def = b.block(g.block);
  if (!def) return 'the block is missing';
  // DXF 70 bits 4 and 8: an external reference or an overlay.
  if (((def.flags ?? 0) & 12) !== 0) return 'external references cannot be exploded';
  if (b.tableRecord('blockRecords', g.block)?.explodable === false) {
    return 'the block is not explodable';
  }
  if (g.array && (g.array.columns > 1 || g.array.rows > 1)) {
    return 'MINSERT arrays cannot be exploded';
  }
  if (g.normal && (g.normal.x !== 0 || g.normal.y !== 0 || g.normal.z <= 0)) {
    return 'the block reference is not in plan';
  }
  const sx = g.scale.x;
  const sy = g.scale.y;
  if (sx === 0 || sy === 0) return 'the block reference has a zero scale';
  if (Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-12 * Math.max(Math.abs(sx), Math.abs(sy))) {
    return 'nonuniformly scaled block references cannot be exploded yet';
  }
  const m = compose(
    translation(-def.basePoint.x, -def.basePoint.y),
    scaling(sx, sy),
    rotation(g.rotation),
    translation(g.position.x, g.position.y),
  );
  return similarity(m);
}

/** A piece of `dim`'s block, on its layer and in its colours where it was layer 0 or ByBlock. */
function asDrawnBy(b: ChangeSetBuilder, model: DocumentModel, id: EntityId, dim: Entity): void {
  const e = b.entity(id);
  if (!e) return;
  const zero = [...model.tables.layers.values()].find((l) => l.name === '0')?.handle;
  const patch: { -readonly [K in 'layer' | 'color' | 'linetype' | 'lineweight']?: Entity[K] } = {};
  if (e.layer === zero) patch.layer = dim.layer;
  if (e.color.kind === 'byBlock') patch.color = dim.color;
  if (e.linetype === 'ByBlock') patch.linetype = dim.linetype;
  if (e.lineweight === 'ByBlock') patch.lineweight = dim.lineweight;
  if (Object.keys(patch).length > 0) b.updateEntity(id, patch);
}
