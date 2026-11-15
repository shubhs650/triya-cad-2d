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
// - A leader (M3-12 part 3) becomes the lines, spline, solid or block arrowhead it draws; its
//   annotation stays as it is. A multileader becomes its leader lines, landings and arrowheads,
//   and its MTEXT (with the frame and mask as the MTEXT's background) or block reference (with
//   the attribute values as ATTRIBs). AutoCAD Help: "Leaders: Explodes into lines, splines,
//   solids (arrow heads), block inserts (arrow heads, annotation blocks), multiline text, or
//   tolerance objects". Each part keeps the leader's properties where it draws ByBlock.
// - A table becomes what its `*T` block holds, placed in the table's frame, as a dimension does.
// - A region becomes the lines, arcs, circles and ellipses of its loops ("Region: Explodes into
//   lines, arcs, or splines"; Triya reads no spline edges, M1-39).
// - A multiline becomes the lines of its elements and its caps' lines and arcs ("Multiline:
//   Explodes into lines and arcs"), each in its element's colour and linetype, with the joints
//   when its style displays them; the fill goes. Element breaks (MLEDIT's cuts, the parameters
//   after the first) are not read: neither the DXF reference nor AutoCAD's help says how they
//   are measured, so the elements are whole, as ezdxf (MIT) draws them too.
// - A pattern hatch becomes its pattern's lines and dots as `@triya/hatch` clips them (given as
//   `ExplodeServices.hatchLines`); AutoCAD's help does not list hatches, and a solid or
//   gradient fill, which has no lines to become, is left alone (the common drafter
//   expectation: AutoCAD keeps a solid fill a hatch).
// - An associative array becomes copies of its source objects ("Array: Explodes an associative
//   array into copies of the original objects"): the array's items are exploded with it.
//
// Everything else is left alone ("N objects could not be exploded").
import { compose, rotation, scaling, translation } from '../geom/transform';
import { explodePolyline } from '../geom/eval';
import { fitSpline } from '../geom/fit';
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type {
  Entity,
  EntityGeometry,
  HatchGeometry,
  MLineGeometry,
  PlanarProps,
  RegionGeometry,
} from '../model/types';
import { leaderParts } from '../annotation/leader';
import { linetypeRef, multiLeaderParts, type AnnotationPart } from '../annotation/multileader';
import type { TextMeasure } from '../annotation/tolerance';
import { tableAxes } from '../spatial/entity-bounds';
import { assocArrayOf } from './assoc-array';
import {
  AnonymousNames,
  copiedProps,
  copyObjects,
  copyProblem,
  eraseObjects,
  reshapeObject,
} from './edit';
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

/**
 * The lines a pattern hatch draws inside its boundary, flat (x0, y0, x1, y1 per dash; x, y per
 * dot), or undefined when it draws none it can give (an unknown pattern, more lines than
 * HPMAXLINES).
 */
export type HatchLinesOf = (
  g: HatchGeometry,
) => { readonly segments: readonly number[]; readonly dots: readonly number[] } | undefined;

/** What EXPLODE reads from the packages above the engine. */
export interface ExplodeServices {
  /** A pattern hatch's lines (`@triya/hatch`); without it hatches are not exploded. */
  readonly hatchLines?: HatchLinesOf | undefined;
  /** Measures a multileader's text, for its underline or overline (M1-111). */
  readonly measure?: TextMeasure | undefined;
}

/** EXPLODE: each of `ids` broken into what it is made of. */
export function explodeObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  services: ExplodeServices = {},
): ExplodeReport {
  const made: EntityId[] = [];
  const refused = new Map<string, number>();
  let exploded = 0;
  let lostWidth = false;
  // The `*D` blocks of dimensions copied out of blocks are named afresh across the whole edit.
  const names = new AnonymousNames(model);
  /** `e` replaced by `parts`, each with `e`'s properties where it draws ByBlock. */
  const replace = (e: Entity, parts: readonly AnnotationPart[]) => {
    for (const p of parts) {
      const geom = p.geom.kind === 'INSERT' ? newAttributes(b, p.geom) : p.geom;
      made.push(
        b.addEntity({
          ...copiedProps(b, e),
          ...(p.color && p.color.kind !== 'byBlock' ? { color: p.color } : {}),
          ...(p.linetype !== undefined && p.linetype !== 'ByBlock' ? { linetype: p.linetype } : {}),
          ...(p.lineweight !== undefined && p.lineweight !== 'ByBlock'
            ? { lineweight: p.lineweight }
            : {}),
          owner: e.owner,
          geom,
        }).id,
      );
    }
    eraseObjects(b, model, [e.id]);
    exploded++;
  };
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
        eraseObjects(b, model, [id]);
        exploded++;
        if (assocArrayOf(model.objects.values(), e)) {
          // The array's items, INSERTs of its source block, go too: copies of the source.
          const items = r.ids.filter((c) => b.entity(c)?.geom.kind === 'INSERT');
          const inner = explodeObjects(b, model, items, services);
          made.push(...r.ids.filter((c) => !items.includes(c)), ...inner.made);
          for (const [why, n] of inner.refused) refused.set(why, (refused.get(why) ?? 0) + n);
        } else {
          made.push(...r.ids);
        }
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
      case 'ACAD_TABLE': {
        if (g.block === undefined || !b.block(g.block)) {
          count(refused, 'the table has no block to explode');
          continue;
        }
        // The `*T` block draws in the table's frame (M1-17): its origin at the insertion point.
        const { x: ax, y: ay } = tableAxes(g);
        const { x: bx, y: by } = b.block(g.block)!.basePoint;
        const frame = similarity({
          a: ax.x,
          b: ax.y,
          c: ay.x,
          d: ay.y,
          e: g.position.x - bx * ax.x - by * ay.x,
          f: g.position.y - bx * ax.y - by * ay.y,
        });
        const contents = b.blockEntities(g.block);
        const r = copyObjects(
          b,
          model,
          contents,
          frame,
          { mirrorText: true, mirrorHatch: true },
          e.owner,
          names,
        );
        for (const c of r.ids) asDrawnBy(b, model, c, e);
        made.push(...r.ids);
        eraseObjects(b, model, [id]);
        exploded++;
        continue;
      }
      case 'LEADER': {
        const parts = leaderParts(g, e.xdata, model).flatMap(asExploded);
        if (parts.length === 0) {
          count(refused, 'the leader draws nothing');
          continue;
        }
        replace(e, parts);
        continue;
      }
      case 'MULTILEADER': {
        const parts = multiLeaderParts(g, model, services.measure).flatMap(asExploded);
        if (parts.length === 0) {
          count(refused, 'the multileader draws nothing');
          continue;
        }
        replace(e, parts);
        continue;
      }
      case 'REGION': {
        const parts = regionPieces(g);
        if (parts.length === 0) {
          count(refused, 'the region has no edges');
          continue;
        }
        replace(e, parts);
        continue;
      }
      case 'MLINE': {
        const parts = mlinePieces(g, model);
        if (typeof parts === 'string') {
          count(refused, parts);
          continue;
        }
        replace(e, parts);
        continue;
      }
      case 'HATCH': {
        if (g.solid || g.gradient) {
          count(refused, 'a solid or gradient fill cannot be exploded');
          continue;
        }
        const lines = services.hatchLines?.(g);
        if (!lines || (lines.segments.length === 0 && lines.dots.length === 0)) {
          count(refused, 'the hatch has no pattern lines to explode');
          continue;
        }
        replace(e, hatchPieces(g, lines));
        continue;
      }
      default:
        count(refused, `${article(g.kind)} cannot be exploded`);
    }
  }
  return { made, exploded, refused, lostWidth };
}

/** An INSERT part's attribute values with handles of their own (they are the ATTDEFs' now). */
function newAttributes(
  b: ChangeSetBuilder,
  g: Extract<EntityGeometry, { kind: 'INSERT' }>,
): EntityGeometry {
  return {
    ...g,
    attributes: g.attributes.map((a) => {
      const {
        handle: _handle,
        raw: _raw,
        reactors: _reactors,
        extDict: _extDict,
        annotative: _annotative,
        xdata: _xdata,
        ...rest
      } = a;
      return { ...rest, handle: b.allocateHandle() };
    }),
  };
}

/**
 * A leader's or multileader's part as EXPLODE leaves it: its polyline path as lines, a spline
 * through fit points given its control points (what a SPLINE entity holds), the rest as drawn.
 */
function asExploded(p: AnnotationPart): AnnotationPart[] {
  const g = p.geom;
  if (g.kind === 'LWPOLYLINE') {
    const out: AnnotationPart[] = [];
    for (let i = 0; i + 1 < g.vertices.length; i++) {
      const a = g.vertices[i]!;
      const c = g.vertices[i + 1]!;
      if (a.x === c.x && a.y === c.y) continue;
      out.push({
        ...p,
        geom: { kind: 'LINE', start: { x: a.x, y: a.y }, end: { x: c.x, y: c.y } },
      });
    }
    return out;
  }
  if (g.kind === 'SPLINE' && g.controlPoints.length === 0 && g.fitPoints) {
    const s = fitSpline({
      fitPoints: g.fitPoints,
      startTangent: g.startTangent,
      endTangent: g.endTangent,
    });
    if (!s) return [];
    return [{ ...p, geom: { ...g, knots: s.knots, controlPoints: s.controlPoints } }];
  }
  return [p];
}

/** The plane an exploded object's pieces keep. */
function planarOf(g: PlanarProps): PlanarProps {
  return {
    ...(g.elevation !== undefined && g.elevation !== 0 && { elevation: g.elevation }),
    ...(g.normal !== undefined && { normal: g.normal }),
  };
}

/** Arc angles in [0, 2π), as the file has them. */
const fileArc = <T extends EntityGeometry>(g: T): T =>
  g.kind === 'ARC'
    ? { ...g, startAngle: normalizeAngle(g.startAngle), endAngle: normalizeAngle(g.endAngle) }
    : g;

/** A region's edges, loop by loop. */
function regionPieces(g: RegionGeometry): AnnotationPart[] {
  const planar = planarOf(g);
  return g.loops.flatMap((l) => l.edges.map((c) => ({ geom: fileArc({ ...c, ...planar }) })));
}

/** A pattern hatch's dashes as lines and its dots as points. */
function hatchPieces(
  g: HatchGeometry,
  lines: { readonly segments: readonly number[]; readonly dots: readonly number[] },
): AnnotationPart[] {
  const planar = planarOf(g);
  const out: AnnotationPart[] = [];
  const s = lines.segments;
  for (let i = 0; i + 3 < s.length; i += 4) {
    out.push({
      geom: {
        kind: 'LINE',
        start: { x: s[i]!, y: s[i + 1]! },
        end: { x: s[i + 2]!, y: s[i + 3]! },
        ...planar,
      },
    });
  }
  const d = lines.dots;
  for (let i = 0; i + 1 < d.length; i += 2) {
    out.push({ geom: { kind: 'POINT', position: { x: d[i]!, y: d[i + 1]! }, ...planar } });
  }
  return out;
}

// MLINESTYLE DXF 70 bits (AutoCAD DXF reference, MLINESTYLE).
const MLS_MITER = 2;
const MLS_START_SQUARE = 16;
const MLS_START_INNER = 32;
const MLS_START_ROUND = 64;
const MLS_END_SQUARE = 256;
const MLS_END_INNER = 512;
const MLS_END_ROUND = 1024;

/**
 * A multiline's lines and arcs (ezdxf's `render/mline.py`, MIT, reads the stored geometry the
 * same way): each element's point at a vertex lies along the vertex's miter at the element's
 * first parameter (scale and justification are already in it), and each element runs from
 * vertex to vertex in its colour and linetype. Square caps and displayed joints are lines from
 * the outermost elements to the middle between them; round caps join the outermost elements
 * with a half circle and inner arcs the next ones in, two quarter circles when the two
 * elements' colours differ.
 */
function mlinePieces(g: MLineGeometry, model: DocumentModel): AnnotationPart[] | string {
  const style = g.style === undefined ? undefined : model.tables.mlineStyles.get(g.style);
  if (!style || style.elements.length === 0) return 'the multiline has no style';
  const n = style.elements.length;
  if (g.vertices.length < 2) return 'the multiline has fewer than two vertices';
  if (g.vertices.some((v) => v.elements.length !== n)) {
    return 'the multiline does not match its style';
  }
  const planar = planarOf(g);
  const props = (k: number): Omit<AnnotationPart, 'geom'> => {
    const el = style.elements[k]!;
    const linetype = linetypeRef(model, el.linetype);
    return { color: el.color, ...(linetype !== undefined && { linetype }) };
  };
  const at = (v: MLineGeometry['vertices'][number], k: number): Vec2 => {
    const t = v.elements[k]!.parameters[0] ?? 0;
    return { x: v.position.x + v.miter.x * t, y: v.position.y + v.miter.y * t };
  };
  const miters = g.vertices.map((v) => style.elements.map((_, k) => at(v, k)));
  const closed = (g.flags & 2) !== 0;
  if (closed) miters.push(miters[0]!);
  // Elements from the lowest offset (bottom) to the highest (top).
  const order = style.elements
    .map((_, k) => k)
    .sort((i, j) => style.elements[i]!.offset - style.elements[j]!.offset);
  const bottom = order[0]!;
  const top = order[n - 1]!;
  const line = (a: Vec2, c: Vec2, k: number): AnnotationPart[] =>
    a.x === c.x && a.y === c.y
      ? []
      : [{ ...props(k), geom: { kind: 'LINE', start: a, end: c, ...planar } }];
  const joint = (m: readonly Vec2[]): AnnotationPart[] => {
    const mid = { x: (m[top]!.x + m[bottom]!.x) / 2, y: (m[top]!.y + m[bottom]!.y) / 2 };
    return [...line(m[top]!, mid, top), ...line(m[bottom]!, mid, bottom)];
  };
  const caps = (m: readonly Vec2[], from: number, to: number): AnnotationPart[] => {
    const a = m[from]!;
    const c = m[to]!;
    const center = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const radius = Math.hypot(c.x - a.x, c.y - a.y) / 2;
    if (!(radius > 0)) return [];
    const angle = Math.atan2(a.y - center.y, a.x - center.x);
    const arc = (a0: number, a1: number, k: number): AnnotationPart => ({
      ...props(k),
      geom: fileArc({ kind: 'ARC', center, radius, startAngle: a0, endAngle: a1, ...planar }),
    });
    const same = sameColor(style.elements[from]!.color, style.elements[to]!.color);
    return same
      ? [arc(angle, angle + Math.PI, from)]
      : [arc(angle, angle + Math.PI / 2, from), arc(angle + Math.PI / 2, angle + Math.PI, to)];
  };
  const out: AnnotationPart[] = [];
  const flags = style.styleFlags;
  const first = miters[0]!;
  const last = miters[miters.length - 1]!;
  if (!closed) {
    if (flags & MLS_START_SQUARE) out.push(...joint(first));
    if (flags & MLS_START_ROUND) out.push(...caps(first, top, bottom));
    if (flags & MLS_START_INNER && n > 3) out.push(...caps(first, order[n - 2]!, order[1]!));
  }
  for (let i = 1; i < miters.length; i++) {
    for (let k = 0; k < n; k++) out.push(...line(miters[i - 1]![k]!, miters[i]![k]!, k));
  }
  if (flags & MLS_MITER) {
    for (let i = closed ? 0 : 1; i < miters.length - 1; i++) out.push(...joint(miters[i]!));
  }
  if (!closed) {
    if (flags & MLS_END_SQUARE) out.push(...joint(last));
    if (flags & MLS_END_ROUND) out.push(...caps(last, bottom, top));
    if (flags & MLS_END_INNER && n > 3) out.push(...caps(last, order[1]!, order[n - 2]!));
  }
  return out;
}

const sameColor = (a: Entity['color'], c: Entity['color']): boolean =>
  JSON.stringify(a) === JSON.stringify(c);

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
