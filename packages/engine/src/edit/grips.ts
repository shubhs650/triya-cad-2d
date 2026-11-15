// Standard grips (M2-06 part 2): where an object shows its grips and what dragging one does in
// the STRETCH grip mode, as AutoCAD 2024 documents them ("Grips Reference", "To Use Grips to
// Stretch Objects"):
//
// - a line's ends stretch and its midpoint moves it;
// - an arc's ends stretch (keeping its chord height, as STRETCH does), its midpoint reshapes it
//   through its ends, its centre moves it;
// - a circle's centre moves it and its quadrants set its radius;
// - polyline vertices stretch, a straight segment's midpoint moves the segment, and an arc
//   segment's midpoint reshapes it through its ends (M3-05);
// - spline control (or fit) points, solid and face corners and leader vertices stretch;
// - an object placed by one point (text, a block reference, a point, an ellipse's centre, a
//   table, an image…) has that one grip, which moves it.
// - a dimension's definition points and its text stretch, and the dimension is regenerated
//   (M2-11; AutoCAD 2024's grips on a non-associative dimension, DIMASSOC 1): a linear or
//   aligned dimension shows its extension line origins, its dimension line's two ends (either
//   moves the dimension line, as AutoCAD's dimension line grips do) and its text, which then
//   stays where it is put (DXF 70 bit 128); the other kinds show each definition point.
// - a revision cloud (M2-24, REVCLOUDGRIPS on, AutoCAD's default) shows its corners, not every
//   arc's ends, and dragging one cuts the sides on either side into arcs afresh
//   (`moveCloudCorner`). With REVCLOUDGRIPS 0 (M2-42) it shows a polyline's grips, a grip at
//   every arc's end, as before AutoCAD 2021 (`revcloudOf` gives no cloud).
// - an MTEXT set in columns (M2-26 part 2) shows, besides its insertion point, a column width
//   grip, a gutter grip and a column height grip (one under each column for dynamic columns of
//   manual height): `mtext-grips.ts`.
// - an associative array Triya made (M3-11 part 3) shows its array grips (`array-grips.ts`) in
//   place of its block reference's insertion point.
// - an ellipse's axis ends, an elliptical arc's ends, a hatch's control grip and a layout
//   viewport's corners (M3-05 part 3): `shape-grips.ts`.
// - a multiline's vertices, a multileader's leader vertices, landing and content, a region's
//   centre and a non-associative hatch's boundary vertices (M3-05 part 6): `object-grips.ts`.
import { ccwSweep } from '../geom/angle';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, fromAngle, midpoint, sub } from '../geom/vec';
import type { DimensionGeometry, EntityGeometry, LwPolylineGeometry } from '../model/types';
import { dimensionArcOf, dimensionLineEnds, isArcDimension, withArcRadius } from './dimension';
import { columnGrips, moveColumnGrip } from './mtext-grips';
import type { ArrayGripRole, GripInfo } from './array-grips';
import { cloudCorners, isCloudShaped, moveCloudCorner, type CloudInfo } from './revcloud';
import {
  ellipseGrips,
  hatchGripPoint,
  moveEllipseAxis,
  moveEllipseEnd,
  moveViewportCorner,
  viewportCorners,
} from './shape-grips';
import { stretchGeometry, type StretchResult } from './stretch';
import {
  hatchBoundaryGrips,
  mlineGrips,
  moveHatchVertex,
  moveLanding,
  moveLeaderVertex,
  moveMlineVertex,
  multileaderGrips,
  regionGripPoint,
} from './object-grips';

export type GripKind =
  /** Stretches the point (and any of the object's points on it). */
  | 'stretch'
  /** Moves the whole object. */
  | 'move'
  /** A circle's quadrant: the radius. */
  | 'radius'
  /** An arc's midpoint: the arc through its ends and the new point. */
  | 'arc'
  /** A straight polyline segment's midpoint: both its ends move. */
  | 'segment'
  /** An arc polyline segment's midpoint: the arc through its ends and the new point (M3-05). */
  | 'arcSegment'
  /** A linear or aligned dimension's dimension line end: the dimension line moves. */
  | 'dimline'
  /** A revision cloud's corner: the sides on either side are cut into arcs afresh. */
  | 'cloud'
  /** A columned MTEXT's column width (M2-26 part 2). */
  | 'columnWidth'
  /** A columned MTEXT's gutter. */
  | 'columnGutter'
  /** A columned MTEXT's column height (one column's, with manual heights). */
  | 'columnHeight'
  /** An associative array's grip that sizes it (`array` says how): the grip command edits it. */
  | 'array'
  /** An ellipse's axis end: that axis's length (M3-05 part 3). */
  | 'axis'
  /** An elliptical arc's end: it moves along the ellipse. */
  | 'ellipseEnd'
  /** A layout viewport's corner: the viewport is resized about the opposite one. */
  | 'viewport'
  /** A multiline's vertex: its segments turn (M3-05 part 6). */
  | 'mlineVertex'
  /** A multileader's leader line vertex (its arrowhead too): it moves alone. */
  | 'leaderVertex'
  /** A multileader's landing end or content: the landings and the content move together. */
  | 'landing'
  /** A non-associative hatch's boundary vertex: the boundary stretches. */
  | 'boundary';

export interface Grip {
  readonly point: Vec2;
  readonly kind: GripKind;
  /**
   * The way an arrow grip points, a unit vector: AutoCAD draws grips that size something in one
   * direction (an MTEXT's column width and height) as triangles. Square grips have none.
   */
  readonly towards?: Vec2;
  /** An `array` grip's role (M3-11 part 3). */
  readonly array?: ArrayGripRole;
}

const g = (point: Vec2, kind: GripKind): Grip => ({ point, kind });
const stretchAll = (points: readonly Vec2[]): Grip[] => points.map((p) => g(p, 'stretch'));

const isDimension = (g: EntityGeometry): g is DimensionGeometry =>
  g.kind === 'DIMENSION' || g.kind === 'ARC_DIMENSION' || g.kind === 'LARGE_RADIAL_DIMENSION';

/** A dimension's grips: its definition points and its text. */
function dimensionGrips(dim: DimensionGeometry): Grip[] {
  if (dim.kind === 'DIMENSION' && (dim.dimType === 'linear' || dim.dimType === 'aligned')) {
    const [a, b] = dimensionLineEnds(dim);
    return [
      g(dim.first, 'stretch'),
      g(dim.second, 'stretch'),
      g(a, 'dimline'),
      g(b, 'dimline'),
      g(dim.textPosition, 'stretch'),
    ].filter((x, i, all) => all.findIndex((y) => sameGrip(x.point, y.point)) === i);
  }
  // An angular or arc length dimension's arc ends, where its arrowheads are (M3-05 part 7):
  // dimension line grips, which move the arc in or out; first, so that a definition point on
  // one is theirs.
  const arc = isArcDimension(dim) ? dimensionArcOf(dim) : undefined;
  const out: Grip[] = arc ? arc.ends.map((p) => g(p, 'dimline')) : [];
  for (const [k, v] of Object.entries(dim)) {
    if (!v || typeof v !== 'object' || !('x' in v) || !('y' in v) || 'z' in v) continue;
    const p = v as Vec2;
    if (k !== 'textPosition' && out.some((x) => sameGrip(x.point, p))) continue;
    out.push(g(p, 'stretch'));
  }
  // The text last: where it sits on a definition point, the point's grip is found first.
  const text = out.findIndex((x) => x.point === dim.textPosition);
  if (text >= 0) out.push(...out.splice(text, 1));
  return out;
}

/** `info` as a cloud's (`revcloudOf`), not an array's. */
const cloudOf = (info: GripInfo | undefined): CloudInfo | undefined =>
  info && 'arc' in info ? info : undefined;

/**
 * The grips an object shows, none for kinds without standard grips yet. `info` (`gripInfoOf`):
 * the object is a revision cloud, which shows its corners, or an associative array, which shows
 * its array grips.
 */
export function gripsOf(geom: EntityGeometry, info?: GripInfo): Grip[] {
  if (info && 'grips' in info && geom.kind === 'INSERT') return [...info.grips];
  const cloud = cloudOf(info);
  if (isDimension(geom)) return dimensionGrips(geom);
  if (cloud && isCloudShaped(geom)) {
    return cloudCorners(geom).map((i) => g(geom.vertices[i]!, 'cloud'));
  }
  switch (geom.kind) {
    case 'LINE':
      return [
        g(geom.start, 'stretch'),
        g(midpoint(geom.start, geom.end), 'move'),
        g(geom.end, 'stretch'),
      ];
    case 'ARC': {
      const sweep = ccwSweep(geom.startAngle, geom.endAngle);
      const at = (a: number) => add(geom.center, fromAngle(a, geom.radius));
      return [
        g(at(geom.startAngle), 'stretch'),
        g(at(geom.startAngle + sweep / 2), 'arc'),
        g(at(geom.endAngle), 'stretch'),
        g(geom.center, 'move'),
      ];
    }
    case 'CIRCLE':
      return [
        g(geom.center, 'move'),
        ...[0, 1, 2, 3].map((i) =>
          g(add(geom.center, fromAngle((i * Math.PI) / 2, geom.radius)), 'radius'),
        ),
      ];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (geom.kind === 'POLYLINE' && geom.fit) return [];
      const v = geom.vertices;
      const out = stretchAll(v);
      const n = geom.closed ? v.length : v.length - 1;
      for (let i = 0; i < n && v.length > 1; i++) {
        const a = v[i]!;
        const b = v[(i + 1) % v.length]!;
        if (a.bulge === 0) out.push(g(midpoint(a, b), 'segment'));
        else out.push(g(bulgeMidpoint(a, b, a.bulge), 'arcSegment'));
      }
      return out;
    }
    case 'SPLINE':
      return stretchAll(
        geom.controlPoints.length === 0 && geom.fitPoints ? geom.fitPoints : geom.controlPoints,
      );
    case 'SOLID':
    case 'TRACE':
    case '3DFACE':
      return stretchAll(geom.corners);
    case 'LEADER':
      return stretchAll(geom.vertices);
    case 'ELLIPSE':
      return [
        g(geom.center, 'move'),
        ...ellipseGrips(geom).map((x) => g(x.point, x.end ? 'ellipseEnd' : 'axis')),
      ];
    case 'HATCH': {
      const at = hatchGripPoint(geom);
      if (!at) return [];
      return [g(at, 'move'), ...hatchBoundaryGrips(geom).map((p) => g(p, 'boundary'))];
    }
    case 'MLINE':
      return mlineGrips(geom).map((p) => g(p, 'mlineVertex'));
    case 'MULTILEADER': {
      const m = multileaderGrips(geom);
      const out = m.vertices.map((p) => g(p, 'leaderVertex'));
      for (const p of m.landing) {
        if (!out.some((x) => sameGrip(x.point, p))) out.push(g(p, 'landing'));
      }
      return out;
    }
    case 'REGION': {
      const at = regionGripPoint(geom);
      return at ? [g(at, 'move')] : [];
    }
    case 'VIEWPORT':
      return viewportCorners(geom).map((p) => g(p, 'viewport'));
    case 'POINT':
      return [g(geom.position, 'move')];
    case 'XLINE':
    case 'RAY':
      return [g(geom.base, 'move')];
    case 'TEXT':
    case 'ATTDEF':
      return [
        g(
          (geom.halign !== 0 || geom.valign !== 0) && geom.alignmentPoint
            ? geom.alignmentPoint
            : geom.position,
          'move',
        ),
      ];
    case 'MTEXT':
      return [g(geom.position, 'move'), ...columnGrips(geom)];
    case 'INSERT':
    case 'TOLERANCE':
    case 'ACAD_TABLE':
    case 'IMAGE':
    case 'WIPEOUT':
    case 'PDFUNDERLAY':
      return [g(geom.position, 'move')];
    default:
      return [];
  }
}

/**
 * What Dynamic Input's dimension fields measure while a grip is stretched (M3-06 part 8; AutoCAD
 * 2024 Help, "DYNDIGRIP"): `grip` where the grip was; `anchor` the point a resulting length and
 * angle count from (a line's other end, a polyline's vertex before the grip, else after it);
 * `center` the centre an arc radius counts from (a circle's quadrant grips).
 */
export interface GripDimensions {
  readonly grip: Vec2;
  readonly anchor?: Vec2;
  readonly center?: Vec2;
}

/** What stretching the grip at `grip` of `geom` measures; undefined where nothing is (a move grip). */
export function gripDimensionsOf(geom: EntityGeometry, grip: Vec2): GripDimensions | undefined {
  const at = { x: grip.x, y: grip.y };
  switch (geom.kind) {
    case 'LINE':
      if (sameGrip(geom.start, grip)) return { grip: at, anchor: geom.end };
      if (sameGrip(geom.end, grip)) return { grip: at, anchor: geom.start };
      return undefined;
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (geom.kind === 'POLYLINE' && geom.fit) return undefined;
      const v = geom.vertices;
      const i = v.findIndex((p) => sameGrip(p, grip));
      if (i < 0 || v.length < 2) return undefined;
      const before = i > 0 ? v[i - 1] : geom.closed ? v.at(-1) : undefined;
      const anchor = before ?? v[i + 1]!;
      return { grip: at, anchor: { x: anchor.x, y: anchor.y } };
    }
    case 'CIRCLE':
      return sameGrip(geom.center, grip) ? undefined : { grip: at, center: geom.center };
    default:
      return undefined;
  }
}

/** The midpoint of the arc segment from `a` to `b` with `bulge`. */
export function bulgeMidpoint(a: Vec2, b: Vec2, bulge: number): Vec2 {
  // The sagitta, bulge × half the chord, off the chord's midpoint to its right for a positive
  // (counterclockwise) bulge.
  const m = midpoint(a, b);
  const h = sub(b, a);
  return { x: m.x + (h.y * bulge) / 2, y: m.y - (h.x * bulge) / 2 };
}

/**
 * The bulge of the arc from `a` through `p` to `b`: 0 when they are in line (or `p` is on an
 * end), as the segment is then straight.
 */
export function bulgeThrough(a: Vec2, p: Vec2, b: Vec2): number {
  const arc = arcThrough(a, p, b);
  if (!arc || sameGrip(p, a) || sameGrip(p, b)) return 0;
  const sa = angleOf(sub(a, arc.center));
  const sp = angleOf(sub(p, arc.center));
  const sb = angleOf(sub(b, arc.center));
  // Counterclockwise from a, p before b: the arc runs counterclockwise.
  const sweep = ccwSweep(sa, sp) < ccwSweep(sa, sb) ? ccwSweep(sa, sb) : -ccwSweep(sb, sa);
  return Math.tan(sweep / 4);
}

/** Two grip points are one: the point a grip was found at is read from the same geometry. */
export const sameGrip = (a: Vec2, b: Vec2): boolean =>
  distance(a, b) <= 1e-9 * Math.max(1, Math.abs(a.x), Math.abs(a.y));

/** The arc through three points, as centre, radius and CCW angles from `a` to `c`. */
export function arcThrough(a: Vec2, b: Vec2, c: Vec2) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const scale = Math.max(distance(a, b), distance(b, c), distance(a, c));
  if (!(Math.abs(d) > 1e-12 * scale * scale)) return undefined;
  const sq = (p: Vec2) => p.x * p.x + p.y * p.y;
  const center = {
    x: (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d,
    y: (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d,
  };
  const radius = distance(center, a);
  const sa = angleOf(sub(a, center));
  const sc = angleOf(sub(c, center));
  // d > 0: a → b → c turns counter-clockwise, so the arc runs a to c; otherwise c to a.
  return d > 0
    ? { center, radius, startAngle: sa, endAngle: sc }
    : { center, radius, startAngle: sc, endAngle: sa };
}

/**
 * What dragging the grip at `grip` to `to` does to an object (the STRETCH grip mode): `none`
 * when it has no grip there.
 */
export function moveGrip(
  geom: EntityGeometry,
  grip: Vec2,
  to: Vec2,
  info?: GripInfo,
): StretchResult {
  const found = gripsOf(geom, info).find((x) => sameGrip(x.point, grip));
  const cloud = cloudOf(info);
  if (!found) return { kind: 'none' };
  const d = sub(to, grip);
  switch (found.kind) {
    case 'move':
      return { kind: 'move' };
    case 'array':
      // An array grip edits the array's definition: the grip command does that.
      return { kind: 'none' };
    case 'stretch':
      return stretchGeometry(geom, (p) => sameGrip(p, grip), d, {
        dimensions: isDimension(geom),
      });
    case 'dimline': {
      if (!isDimension(geom)) return { kind: 'none' };
      if (isArcDimension(geom)) {
        // The dimension arc through the point, about its centre.
        const arc = dimensionArcOf(geom);
        const moved = arc && withArcRadius(geom, distance(arc.centre, to));
        return moved ? { kind: 'shape', geom: moved } : { kind: 'none' };
      }
      const definitionPoint = add(geom.definitionPoint, d);
      return { kind: 'shape', geom: { ...geom, definitionPoint } };
    }
    case 'axis':
    case 'ellipseEnd':
    case 'viewport': {
      const shaped =
        geom.kind === 'ELLIPSE'
          ? found.kind === 'axis'
            ? moveEllipseAxis(geom, grip, to)
            : moveEllipseEnd(geom, grip, to)
          : geom.kind === 'VIEWPORT'
            ? moveViewportCorner(
                geom,
                viewportCorners(geom).findIndex((p) => sameGrip(p, grip)),
                to,
              )
            : undefined;
      return shaped ? { kind: 'shape', geom: shaped } : { kind: 'none' };
    }
    case 'mlineVertex': {
      if (geom.kind !== 'MLINE') return { kind: 'none' };
      const i = geom.vertices.findIndex((v) => sameGrip(v.position, grip));
      const shaped = i < 0 ? undefined : moveMlineVertex(geom, i, to);
      return shaped ? { kind: 'shape', geom: shaped } : { kind: 'none' };
    }
    case 'leaderVertex':
      return geom.kind === 'MULTILEADER'
        ? { kind: 'shape', geom: moveLeaderVertex(geom, grip, d) }
        : { kind: 'none' };
    case 'landing':
      return geom.kind === 'MULTILEADER'
        ? { kind: 'shape', geom: moveLanding(geom, d) }
        : { kind: 'none' };
    case 'boundary':
      return geom.kind === 'HATCH'
        ? { kind: 'shape', geom: moveHatchVertex(geom, grip, d) }
        : { kind: 'none' };
    case 'radius': {
      if (geom.kind !== 'CIRCLE') return { kind: 'none' };
      const radius = distance(geom.center, to);
      return radius > 0 ? { kind: 'shape', geom: { ...geom, radius } } : { kind: 'none' };
    }
    case 'arc': {
      if (geom.kind !== 'ARC') return { kind: 'none' };
      const s = add(geom.center, fromAngle(geom.startAngle, geom.radius));
      const e = add(geom.center, fromAngle(geom.endAngle, geom.radius));
      const arc = arcThrough(s, to, e);
      return arc ? { kind: 'shape', geom: { ...geom, ...arc } } : { kind: 'none' };
    }
    case 'cloud': {
      // gripsOf gives cloud grips only to a cloud-shaped LWPOLYLINE with `cloud`.
      const g = geom as LwPolylineGeometry;
      const i = g.vertices.findIndex((v) => sameGrip(v, grip));
      return { kind: 'shape', geom: moveCloudCorner(g, i, to, cloud!.arc) };
    }
    case 'columnWidth':
    case 'columnGutter':
    case 'columnHeight': {
      if (geom.kind !== 'MTEXT') return { kind: 'none' };
      const shaped = moveColumnGrip(geom, grip, d);
      return shaped ? { kind: 'shape', geom: shaped } : { kind: 'none' };
    }
    case 'arcSegment': {
      if (geom.kind !== 'LWPOLYLINE' && geom.kind !== 'POLYLINE') return { kind: 'none' };
      const v = geom.vertices;
      const i = v.findIndex((a, k) => {
        const b = v[(k + 1) % v.length]!;
        return (
          (geom.closed || k < v.length - 1) &&
          a.bulge !== 0 &&
          sameGrip(bulgeMidpoint(a, b, a.bulge), grip)
        );
      });
      if (i < 0) return { kind: 'none' };
      const bulge = bulgeThrough(v[i]!, to, v[(i + 1) % v.length]!);
      const vertices = v.map((p, k) => (k === i ? { ...p, bulge } : p));
      return { kind: 'shape', geom: { ...geom, vertices } };
    }
    case 'segment': {
      if (geom.kind !== 'LWPOLYLINE' && geom.kind !== 'POLYLINE') return { kind: 'none' };
      const v = geom.vertices;
      const i = v.findIndex((a, k) => {
        const b = v[(k + 1) % v.length]!;
        return (geom.closed || k < v.length - 1) && a.bulge === 0 && sameGrip(midpoint(a, b), grip);
      });
      if (i < 0) return { kind: 'none' };
      const ends = new Set([i, (i + 1) % v.length]);
      const vertices = v.map((p, k) => (ends.has(k) ? { ...p, x: p.x + d.x, y: p.y + d.y } : p));
      return { kind: 'shape', geom: { ...geom, vertices } };
    }
  }
}
