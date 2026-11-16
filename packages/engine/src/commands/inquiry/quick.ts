// MEASUREGEOM's Quick mode (M3-07 part 2; AutoCAD 2024 Help, "MEASUREGEOM (Command)", Quick):
// "Displays dimensions, distances, and angles within a drawing dynamically as you move your
// mouse over and between objects", and "clicking within a space enclosed by geometric objects
// highlights it in green and displays the calculated values", Shift-click adding (or taking
// away) more spaces, "the perimeters of enclosed islands … also included".
//
// The help shows pictures, not rules; what Triya measures, as a drafter reads those pictures:
// - Across the cursor: the horizontal and the vertical distance between the nearest objects on
//   either side of it (each where both sides have one), measured along the line through the
//   cursor.
// - Over an object (within the aperture): a line's (or a polyline segment's) length, and at each
//   of its ends the angle to every line or arc ending there, an angle of exactly 90° marked by a
//   square; an arc's or a circle's radius, from its centre towards the cursor.
// - A click: the smallest space enclosed by the objects that holds the point, less the islands
//   inside it (closed outlines inside it that do not touch it, nested islands' own spaces not
//   counted twice); its area, and its perimeter with the islands'. Lines that end in the open
//   (dangling) bound nothing. Gaps are not bridged (HPGAPTOL 0, AutoCAD's default).
// "Objects that aren't measured include annotations such as dimensions and hatches", and text.
// Only the objects shown in the view take part (the help: "within a drawing … in a plan view").
import type { Box } from '../../geom/bounds';
import { closestPoint } from '../../geom/closest';
import type { BoundedCurve, Curve } from '../../geom/curves';
import { derivativeAt, domain, pointAt } from '../../geom/eval';
import { intersect } from '../../geom/intersect';
import type { Vec2 } from '../../geom/types';
import { add, angleOf, cross, distance, dot, normalize, scale, sub } from '../../geom/vec';
import { arrangement, faceAround, islandsIn } from '../../edit/faces';
import { curvesIn, type OsnapSource } from '../../input/osnap';
import type { EntityId } from '../../model/entity-ids';
import { drawingUnits, formatAngle, formatDistance } from '../units';

/** What the cursor is over, in the coordinates of the space shown. */
export interface QuickQuery {
  readonly point: Vec2;
  /** The aperture, in drawing units: what counts as over an object. */
  readonly aperture: number;
  /** The view: what is shown, and so measured. */
  readonly view: Box;
}

/** A distance drawn as a dimension line from `from` to `to`, with its value. */
export interface QuickSpan {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly text: string;
}

/** The angle at `vertex` from direction `start` counter-clockwise by `sweep` (radians). */
export interface QuickAngle {
  readonly vertex: Vec2;
  readonly start: number;
  readonly sweep: number;
  readonly text: string;
  /** Exactly 90°: drawn as a square. */
  readonly right: boolean;
}

export interface QuickMeasure {
  readonly spans: readonly QuickSpan[];
  readonly angles: readonly QuickAngle[];
}

/** Annotations, which Quick does not measure (dimensions' blocks included). */
const NOT_MEASURED = new Set([
  'DIMENSION',
  'ARC_DIMENSION',
  'LARGE_RADIAL_DIMENSION',
  'LEADER',
  'MULTILEADER',
  'TOLERANCE',
  'HATCH',
  'TEXT',
  'MTEXT',
  'ATTDEF',
  'ACAD_TABLE',
]);

function measured(src: OsnapSource, point: Vec2, box: Box): { id: EntityId; curve: Curve }[] {
  return curvesIn(src, point, box).filter((c) => {
    const kind = src.model.entity(c.id)?.geom.kind;
    return kind === undefined || !NOT_MEASURED.has(kind);
  });
}

const around = (p: Vec2, r: number): Box => ({
  minX: p.x - r,
  minY: p.y - r,
  maxX: p.x + r,
  maxY: p.y + r,
});

/** What Quick shows with the cursor at `q.point`. */
export function quickMeasure(src: OsnapSource, q: QuickQuery): QuickMeasure {
  const u = drawingUnits(src.model.header);
  const d = (v: number) => formatDistance(v, u);
  const spans: QuickSpan[] = [];
  const angles: QuickAngle[] = [];
  const p = q.point;
  const tol = src.tol.linear;

  // Across the cursor, horizontally and vertically.
  const thin = Math.max(q.aperture * 1e-3, tol);
  for (const dir of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]) {
    const strip: Box =
      dir.x !== 0
        ? { minX: q.view.minX, maxX: q.view.maxX, minY: p.y - thin, maxY: p.y + thin }
        : { minX: p.x - thin, maxX: p.x + thin, minY: q.view.minY, maxY: q.view.maxY };
    let before = -Infinity;
    let after = Infinity;
    for (const c of measured(src, p, strip)) {
      for (const hit of intersect({ kind: 'XLINE', base: p, direction: dir }, c.curve, src.tol)) {
        const t = dot(sub(hit.point, p), dir);
        if (t < -tol && t > before) before = t;
        if (t > tol && t < after) after = t;
      }
    }
    if (Number.isFinite(before) && Number.isFinite(after)) {
      spans.push({
        from: add(p, scale(dir, before)),
        to: add(p, scale(dir, after)),
        text: d(after - before),
      });
    }
  }

  // The object under the cursor.
  let over: { curve: Curve; at: Vec2 } | undefined;
  let best = q.aperture;
  for (const c of measured(src, p, around(p, q.aperture))) {
    const cp = closestPoint(c.curve, p, src.tol);
    if (cp.distance <= best) {
      best = cp.distance;
      over = { curve: c.curve, at: cp.point };
    }
  }
  if (over?.curve.kind === 'LINE') {
    const line = over.curve;
    // A distance across the cursor along the line itself is its length: shown once.
    const near = (a: Vec2, b: Vec2) => distance(a, b) <= q.aperture;
    const along = (s: QuickSpan) =>
      (near(s.from, line.start) && near(s.to, line.end)) ||
      (near(s.from, line.end) && near(s.to, line.start));
    for (let i = spans.length - 1; i >= 0; i--) if (along(spans[i]!)) spans.splice(i, 1);
    spans.push({ from: line.start, to: line.end, text: d(distance(line.start, line.end)) });
    for (const [end, other] of [
      [line.start, line.end],
      [line.end, line.start],
    ] as const) {
      angles.push(...anglesAt(src, end, sub(other, end), q.aperture, u));
    }
  } else if (over && (over.curve.kind === 'ARC' || over.curve.kind === 'CIRCLE')) {
    const c = over.curve;
    const toward = distance(p, c.center) > tol ? normalize(sub(p, c.center)) : { x: 1, y: 0 };
    const on = c.kind === 'ARC' ? over.at : add(c.center, scale(toward, c.radius));
    spans.push({ from: c.center, to: on, text: `R${d(c.radius)}` });
  }
  return { spans, angles };
}

/**
 * The angles at `vertex` between a line leaving it along `away` and each line or arc ending
 * there (the smaller side, 0 to 180°); none for one carrying straight on.
 */
function anglesAt(
  src: OsnapSource,
  vertex: Vec2,
  away: Vec2,
  aperture: number,
  u: ReturnType<typeof drawingUnits>,
): QuickAngle[] {
  const tol = src.tol;
  const near = Math.max(tol.linear * 1e3, aperture * 1e-6);
  const out: QuickAngle[] = [];
  for (const c of measured(src, vertex, around(vertex, near))) {
    const dir = leaving(c.curve, vertex, near);
    if (!dir) continue;
    const turn = Math.atan2(cross(away, dir), dot(away, dir));
    const sweep = Math.abs(turn);
    // The line itself (or one lying on it), and one going straight on, make no angle.
    if (sweep <= tol.angular * 1e3 || Math.PI - sweep <= tol.angular * 1e3) continue;
    const text = formatAngle(sweep, u);
    out.push({
      vertex,
      start: turn >= 0 ? angleOf(away) : angleOf(dir),
      sweep,
      text: u.aunits === 0 ? `${text}°` : text,
      right: Math.abs(sweep - Math.PI / 2) <= 1e-9,
    });
  }
  return out;
}

/** The direction a line or arc leaves `vertex` in, when it ends there. */
function leaving(c: Curve, vertex: Vec2, near: number): Vec2 | undefined {
  if (c.kind === 'LINE') {
    if (distance(c.start, vertex) <= near) return sub(c.end, c.start);
    if (distance(c.end, vertex) <= near) return sub(c.start, c.end);
    return undefined;
  }
  if (c.kind === 'ARC') {
    const dm = domain(c);
    if (distance(pointAt(c, dm.start), vertex) <= near) return derivativeAt(c, dm.start);
    if (distance(pointAt(c, dm.end), vertex) <= near) return scale(derivativeAt(c, dm.end), -1);
  }
  return undefined;
}

// --- Enclosed spaces -------------------------------------------------------------------------

/** A space a click measured: its area and perimeter, and its outline and islands to fill. */
export interface EnclosedSpace {
  readonly area: number;
  readonly perimeter: number;
  /** The outline, then each island's, as polygons (filled even-odd). */
  readonly loops: readonly (readonly Vec2[])[];
}

/** The most objects a click looks at; past it, the view is too full to measure (none found). */
const MAX_CURVES = 5000;

/** The space enclosed around `point` by the objects shown in `view`; undefined where none. */
export function enclosedSpace(src: OsnapSource, point: Vec2, view: Box): EnclosedSpace | undefined {
  const curves = measured(src, point, view)
    .map((c) => c.curve)
    .filter((c): c is BoundedCurve => c.kind !== 'XLINE' && c.kind !== 'RAY');
  if (curves.length === 0 || curves.length > MAX_CURVES) return undefined;
  const size = Math.max(view.maxX - view.minX, view.maxY - view.minY, 1);
  const merge = Math.max(src.tol.linear * 100, size * 1e-9);
  const arr = arrangement(curves, src.tol, merge);
  const dev = size * 1e-4;
  const around = faceAround(arr, point, dev);
  if (!around) return undefined;
  // Islands: the other connected parts inside it, and not inside another such part.
  const islands = islandsIn(arr, around.face, around.ring, dev).filter((i) => i.depth === 0);
  return {
    area: around.face.area - islands.reduce((s, i) => s - i.face.area, 0),
    perimeter: around.face.perimeter + islands.reduce((s, i) => s + i.face.perimeter, 0),
    loops: [around.ring, ...islands.map((i) => i.ring)],
  };
}
