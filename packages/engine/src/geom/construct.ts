// Circle and arc constructions for CIRCLE and ARC (M3-01): the circle or arc that given points,
// angles, lengths or tangencies define, as AutoCAD 2024's commands construct them (AutoCAD 2024
// Help, "CIRCLE (Command)", "ARC (Command)", "To Draw Arcs"). An arc is returned as drawn: from
// its start point with a signed sweep (positive counter-clockwise), the `BulgeArc` shape, since
// ARC draws some arcs clockwise and what follows (Enter continuing it with LINE or ARC) needs
// the end it was drawn to. `dxfArc` turns one into the DXF ARC, which always runs CCW.
//
// Undefined means the construction has no answer (collinear points, a chord longer than the
// diameter, a zero radius): the command says so and asks again.
import { ccwSweep, normalizeAngle, TAU } from './angle';
import type { Arc, Circle } from './curves';
import type { BulgeArc } from './eval';
import type { Tolerance } from './tolerance';
import type { Vec2 } from './types';
import {
  add,
  angleOf,
  cross,
  distance,
  dot,
  fromAngle,
  midpoint,
  normalize,
  perp,
  scale,
  sub,
} from './vec';

/** The DXF ARC (counter-clockwise) a drawn arc covers. */
export function dxfArc(a: BulgeArc): Arc {
  const s0 = a.sweep >= 0 ? a.startAngle : a.startAngle + a.sweep;
  const start = normalizeAngle(s0);
  return {
    kind: 'ARC',
    center: a.center,
    radius: a.radius,
    startAngle: start,
    endAngle: normalizeAngle(start + Math.abs(a.sweep)),
  };
}

/** Where a drawn arc ends, and the direction it travels there (unit). */
export function arcEnd(a: BulgeArc): { point: Vec2; direction: Vec2 } {
  const end = a.startAngle + a.sweep;
  const radial = fromAngle(end);
  return {
    point: add(a.center, scale(radial, a.radius)),
    direction: a.sweep >= 0 ? perp(radial) : scale(perp(radial), -1),
  };
}

/** The circle through three points; undefined when they are collinear (or two coincide). */
export function circleThrough3(a: Vec2, b: Vec2, c: Vec2, tol: Tolerance): Circle | undefined {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const d = 2 * cross(ab, ac);
  // |ab × ac| is twice the triangle's area: no circle when it is nil next to the side lengths.
  const size = Math.max(distance(a, b), distance(a, c), distance(b, c));
  if (Math.abs(d) <= tol.linear * size) return undefined;
  const ab2 = dot(ab, ab);
  const ac2 = dot(ac, ac);
  const center = add(a, {
    x: (ac.y * ab2 - ab.y * ac2) / d,
    y: (ab.x * ac2 - ac.x * ab2) / d,
  });
  return { kind: 'CIRCLE', center, radius: distance(center, a) };
}

/** ARC 3P: from `a` through `b` to `c`. */
export function arcThrough3(a: Vec2, b: Vec2, c: Vec2, tol: Tolerance): BulgeArc | undefined {
  const circle = circleThrough3(a, b, c, tol);
  if (!circle) return undefined;
  const start = angleOf(sub(a, circle.center));
  const end = angleOf(sub(c, circle.center));
  // a → b → c turning left is a counter-clockwise arc.
  const sweep = cross(sub(b, a), sub(c, b)) > 0 ? ccwSweep(start, end) : -ccwSweep(end, start);
  return { center: circle.center, radius: circle.radius, startAngle: start, sweep };
}

/**
 * Start, Center and an included angle (SCA, CSA): positive counter-clockwise, negative
 * clockwise. A turn or more is not an arc.
 */
export function arcStartCenterAngle(
  start: Vec2,
  center: Vec2,
  included: number,
  tol: Tolerance,
): BulgeArc | undefined {
  const radius = distance(start, center);
  if (radius <= tol.linear || Math.abs(included) <= tol.angular) return undefined;
  if (Math.abs(included) >= TAU - tol.angular) return undefined;
  return { center, radius, startAngle: angleOf(sub(start, center)), sweep: included };
}

/** Start, Center, End (SCE, CSE): counter-clockwise from the start to the end's direction. */
export function arcStartCenterEnd(
  start: Vec2,
  center: Vec2,
  end: Vec2,
  tol: Tolerance,
): BulgeArc | undefined {
  if (distance(end, center) <= tol.linear) return undefined;
  const a0 = angleOf(sub(start, center));
  return arcStartCenterAngle(start, center, ccwSweep(a0, angleOf(sub(end, center))), tol);
}

/**
 * Start, Center, chord Length (SCL, CSL): counter-clockwise; a positive length draws the minor
 * arc, a negative one the major arc (AutoCAD 2024 Help, "To Draw Arcs").
 */
export function arcStartCenterChord(
  start: Vec2,
  center: Vec2,
  chord: number,
  tol: Tolerance,
): BulgeArc | undefined {
  const radius = distance(start, center);
  if (radius <= tol.linear || Math.abs(chord) > 2 * radius + tol.linear) return undefined;
  const minor = 2 * Math.asin(Math.min(1, Math.abs(chord) / (2 * radius)));
  return arcStartCenterAngle(start, center, chord > 0 ? minor : TAU - minor, tol);
}

/**
 * Start, End and an included angle (SEA): positive counter-clockwise from the start to the
 * end, negative clockwise.
 */
export function arcStartEndAngle(
  start: Vec2,
  end: Vec2,
  included: number,
  tol: Tolerance,
): BulgeArc | undefined {
  const chord = distance(start, end);
  if (chord <= tol.linear || Math.abs(included) <= tol.angular) return undefined;
  if (Math.abs(included) >= TAU - tol.angular) return undefined;
  // The centre is on the chord's perpendicular bisector, (chord/2)·cot(θ/2) left of start→end
  // (as a polyline bulge's, `bulgeArc`).
  const h = chord / 2 / Math.tan(included / 2);
  const center = add(midpoint(start, end), scale(perp(normalize(sub(end, start))), h));
  return {
    center,
    radius: distance(center, start),
    startAngle: angleOf(sub(start, center)),
    sweep: included,
  };
}

/**
 * Start, End, Radius (SER): counter-clockwise from the start to the end; a positive radius
 * draws the minor arc, a negative one the major arc.
 */
export function arcStartEndRadius(
  start: Vec2,
  end: Vec2,
  radius: number,
  tol: Tolerance,
): BulgeArc | undefined {
  const chord = distance(start, end);
  if (chord <= tol.linear || Math.abs(radius) * 2 < chord - tol.linear) return undefined;
  const minor = 2 * Math.asin(Math.min(1, chord / (2 * Math.abs(radius))));
  return arcStartEndAngle(start, end, radius > 0 ? minor : TAU - minor, tol);
}

/** Start, End, Center (SEC): counter-clockwise from the start to the end's direction. */
export function arcStartEndCenter(
  start: Vec2,
  end: Vec2,
  center: Vec2,
  tol: Tolerance,
): BulgeArc | undefined {
  return arcStartCenterEnd(start, center, end, tol);
}

/**
 * Start, tangent Direction, End (SED, and ARC continuing tangent from the last line or arc):
 * the arc leaving `start` along `direction` that reaches `end`. None when the end is on the
 * tangent line.
 */
export function arcStartDirectionEnd(
  start: Vec2,
  direction: Vec2,
  end: Vec2,
  tol: Tolerance,
): BulgeArc | undefined {
  const chord = sub(end, start);
  const d = Math.hypot(direction.x, direction.y);
  if (d <= tol.linear || Math.hypot(chord.x, chord.y) <= tol.linear) return undefined;
  const n = perp(scale(direction, 1 / d));
  // The centre is on the normal at the start, as far from the start as from the end:
  // |start + k·n − end|² = k²  ⇒  k = |chord|² / (2 n·chord).
  const along = dot(n, chord);
  if (Math.abs(along) <= tol.linear) return undefined;
  const k = dot(chord, chord) / (2 * along);
  const center = add(start, scale(n, k));
  const a0 = angleOf(sub(start, center));
  const a1 = angleOf(sub(end, center));
  // The centre on the left of the direction turns the arc counter-clockwise.
  const sweep = k > 0 ? ccwSweep(a0, a1) : -ccwSweep(a1, a0);
  return { center, radius: Math.abs(k), startAngle: a0, sweep };
}

// ── Tangent circles (CIRCLE Ttr) ───────────────────────────────────────────────────────────

/** What a circle can be drawn tangent to: an unbounded line, or a circle (an arc's too). */
export type TangentTarget =
  | { readonly kind: 'line'; readonly point: Vec2; readonly direction: Vec2 }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number };

/** Where a circle centred at `center` touches `t`. */
export function tangentPointOn(t: TangentTarget, center: Vec2): Vec2 {
  if (t.kind === 'line') {
    const u = normalize(t.direction);
    return add(t.point, scale(u, dot(sub(center, t.point), u)));
  }
  const toward = sub(center, t.center);
  const len = Math.hypot(toward.x, toward.y);
  // A circle concentric with the target touches it nowhere in particular; its start will do.
  return len === 0
    ? add(t.center, { x: t.radius, y: 0 })
    : add(t.center, scale(toward, t.radius / len));
}

/**
 * The centres of the circles of radius `r` tangent to `a` and `b`: where their offsets by `r`
 * meet (each line's two parallels; each circle's concentric circles of radius R + r and |R − r|).
 */
export function tangentCircleCenters(
  a: TangentTarget,
  b: TangentTarget,
  r: number,
  tol: Tolerance,
): Vec2[] {
  const out: Vec2[] = [];
  for (const oa of offsetsOf(a, r, tol))
    for (const ob of offsetsOf(b, r, tol))
      for (const p of meet(oa, ob, tol))
        if (!out.some((q) => distance(p, q) <= tol.linear)) out.push(p);
  return out;
}

/**
 * CIRCLE Ttr: of the circles of radius `r` tangent to `a` and `b`, the one whose tangent points
 * are closest to where the drafter picked the objects, as AutoCAD chooses.
 */
export function circleTanTanRadius(
  a: TangentTarget,
  pickA: Vec2,
  b: TangentTarget,
  pickB: Vec2,
  r: number,
  tol: Tolerance,
): Circle | undefined {
  if (!(r > tol.linear)) return undefined;
  let best: Circle | undefined;
  let bestD = Infinity;
  for (const center of tangentCircleCenters(a, b, r, tol)) {
    const d =
      distance(tangentPointOn(a, center), pickA) + distance(tangentPointOn(b, center), pickB);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'CIRCLE', center, radius: r };
    }
  }
  return best;
}

function offsetsOf(t: TangentTarget, r: number, tol: Tolerance): TangentTarget[] {
  if (t.kind === 'line') {
    const n = scale(perp(normalize(t.direction)), r);
    return [
      { kind: 'line', point: add(t.point, n), direction: t.direction },
      { kind: 'line', point: sub(t.point, n), direction: t.direction },
    ];
  }
  const out: TangentTarget[] = [{ kind: 'circle', center: t.center, radius: t.radius + r }];
  // R = r leaves the centre itself: an internally tangent circle centred on the target's centre
  // is the target, which is no answer, but its lines through the centre are.
  const inner = Math.abs(t.radius - r);
  out.push({ kind: 'circle', center: t.center, radius: inner > tol.linear ? inner : 0 });
  return out;
}

/** Where two offsets meet (a circle of radius 0 is its centre). */
function meet(a: TangentTarget, b: TangentTarget, tol: Tolerance): Vec2[] {
  if (a.kind === 'line') return b.kind === 'line' ? lineLine(a, b, tol) : lineCircle(a, b, tol);
  return b.kind === 'line' ? lineCircle(b, a, tol) : circleCircle(a, b, tol);
}

type LineT = Extract<TangentTarget, { kind: 'line' }>;
type CircleT = Extract<TangentTarget, { kind: 'circle' }>;

function lineLine(a: LineT, b: LineT, tol: Tolerance): Vec2[] {
  const ua = normalize(a.direction);
  const ub = normalize(b.direction);
  const den = cross(ua, ub);
  if (Math.abs(den) <= tol.angular) return [];
  const t = cross(sub(b.point, a.point), ub) / den;
  return [add(a.point, scale(ua, t))];
}

function lineCircle(l: LineT, c: CircleT, tol: Tolerance): Vec2[] {
  const u = normalize(l.direction);
  const foot = add(l.point, scale(u, dot(sub(c.center, l.point), u)));
  const h = distance(foot, c.center);
  if (h > c.radius + tol.linear) return [];
  const half = Math.sqrt(Math.max(0, c.radius * c.radius - h * h));
  if (half <= tol.linear) return [foot];
  return [add(foot, scale(u, half)), sub(foot, scale(u, half))];
}

function circleCircle(a: CircleT, b: CircleT, tol: Tolerance): Vec2[] {
  const d = distance(a.center, b.center);
  if (d <= tol.linear) return [];
  if (d > a.radius + b.radius + tol.linear || d < Math.abs(a.radius - b.radius) - tol.linear) {
    return [];
  }
  const along = (d * d + a.radius * a.radius - b.radius * b.radius) / (2 * d);
  const u = scale(sub(b.center, a.center), 1 / d);
  const base = add(a.center, scale(u, along));
  const half = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
  if (half <= tol.linear) return [base];
  const n = perp(u);
  return [add(base, scale(n, half)), sub(base, scale(n, half))];
}
