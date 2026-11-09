// Standard grips (M2-06 part 2): where an object shows its grips and what dragging one does in
// the STRETCH grip mode, as AutoCAD 2024 documents them ("Grips Reference", "To Use Grips to
// Stretch Objects"):
//
// - a line's ends stretch and its midpoint moves it;
// - an arc's ends stretch (keeping its chord height, as STRETCH does), its midpoint reshapes it
//   through its ends, its centre moves it;
// - a circle's centre moves it and its quadrants set its radius;
// - polyline vertices stretch, and a straight segment's midpoint moves the segment;
// - spline control (or fit) points, solid and face corners and leader vertices stretch;
// - an object placed by one point (text, a block reference, a point, an ellipse's centre, a
//   table, an image…) has that one grip, which moves it.
// Dimensions, hatches, multileaders, multilines, regions and viewports have no grips yet: their
// grips (dimension text, defpoints, hatch origin, viewport corners) need the regeneration of
// M2-10/M2-11 and FR-D4's multi-functional grips.
import { ccwSweep } from '../geom/angle';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, fromAngle, midpoint, sub } from '../geom/vec';
import type { EntityGeometry } from '../model/types';
import { stretchGeometry, type StretchResult } from './stretch';

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
  | 'segment';

export interface Grip {
  readonly point: Vec2;
  readonly kind: GripKind;
}

const g = (point: Vec2, kind: GripKind): Grip => ({ point, kind });
const stretchAll = (points: readonly Vec2[]): Grip[] => points.map((p) => g(p, 'stretch'));

/** The grips an object shows, none for kinds without standard grips yet. */
export function gripsOf(geom: EntityGeometry): Grip[] {
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
      return [g(geom.center, 'move')];
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

/** Two grip points are one: the point a grip was found at is read from the same geometry. */
export const sameGrip = (a: Vec2, b: Vec2): boolean =>
  distance(a, b) <= 1e-9 * Math.max(1, Math.abs(a.x), Math.abs(a.y));

/** The arc through three points, as centre, radius and CCW angles from `a` to `c`. */
function arcThrough(a: Vec2, b: Vec2, c: Vec2) {
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
export function moveGrip(geom: EntityGeometry, grip: Vec2, to: Vec2): StretchResult {
  const found = gripsOf(geom).find((x) => sameGrip(x.point, grip));
  if (!found) return { kind: 'none' };
  const d = sub(to, grip);
  switch (found.kind) {
    case 'move':
      return { kind: 'move' };
    case 'stretch':
      return stretchGeometry(geom, (p) => sameGrip(p, grip), d);
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
