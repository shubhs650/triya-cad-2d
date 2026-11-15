// Multi-functional grips (M3-05 part 1; FR-D4): the functions AutoCAD 2024 offers at a grip, in
// the menu shown as the cursor rests on it and in the order Ctrl cycles through once it is hot.
//
// - a line's or arc's end: Stretch, Lengthen ("The Stretch and Lengthen Commands": the grip's
//   Lengthen behaves as LENGTHEN's Dynamic method, the end carried along the line or round the
//   circle to the cursor);
// - an arc's midpoint: Stretch, Radius (the radius changes about the centre, the angles kept);
// - a 2D polyline's vertex: Stretch Vertex, Add Vertex, Remove Vertex, and at an open polyline's
//   ends Extend Vertex; a straight segment's midpoint: Stretch, Add Vertex, Convert to Arc; an
//   arc segment's: Stretch, Add Vertex, Convert to Line ("To Modify Polylines With Grips").
//
// AutoCAD's help leaves some of what these do unsaid; the choices made here are the ones a
// drafter would expect:
// - Add Vertex at a vertex puts the new vertex after it (between it and the next), at an open
//   polyline's last vertex before it, as nothing follows;
// - Add Vertex on an arc segment keeps both halves round, on the circle through the segment's
//   ends and the new vertex (a vertex added on the arc leaves its shape as it was);
// - Remove Vertex joins its neighbours with a straight segment, one arc when both segments were
//   arcs of one circle turning the same way; the joined segment starts as the one before did and
//   ends as the one after did;
// - Convert to Arc makes the arc through the segment's ends and the point given.
//
// A patterned hatch's control grip (M3-05 part 3, "To Modify Hatch Objects Using Grips"):
// Stretch (it moves the hatch), Origin Point, Hatch Angle, Hatch Scale. The help gives the
// prompts but not what a picked point means: here the origin goes to it, the angle is the
// grip's direction to it and the scale its distance from the grip, as a typed number is the
// angle or scale itself; the lines are laid out again about the origin, as the Properties
// palette's Angle and Scale rows do (a user-defined hatch's Scale is its spacing).
//
// A linear or aligned dimension (M3-05 part 4; "About Modifying Dimension Geometry", "About
// Modifying Dimension Text"): its dimension line grips offer Stretch, Continue Dimension,
// Baseline Dimension and Flip Arrow, its text grip Stretch, Move with Dim Line, Move Text Only,
// Move with Leader, Above Dim Line, Center Vertically and Reset Text Position. AutoCAD keeps
// the text choices as the dimension's own DIMVAR overrides (DIMTMOVE 0, 2 and 1; DIMTAD 1, and
// DIMTAD 0 with DIMTVP 0: `dimensionGripOverrides`). Its help does not say where Above Dim Line
// and Center Vertically leave text the drafter moved; here the text goes home, where the style
// places it, as Reset Text Position does. Move with Dim Line moves the dimension line across by
// as much as the text moves across it. Continue and Baseline Dimension run DIMCONTINUE and
// DIMBASELINE from the extension line at the grip's end (the grip command does that).
import { ccwSweep, normalizeAngle, TAU } from '../geom/angle';
import { toleranceForSize, type Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, dot, scale, sub } from '../geom/vec';
import type {
  ArcGeometry,
  DimensionGeometry,
  EntityGeometry,
  HatchGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  PolylineVertex,
} from '../model/types';
import type { GripInfo } from './array-grips';
import { breakCurveOf, lengthenGeometry, lengthTo } from './break';
import { dimensionDirection, dimensionLineEnds } from './dimension';
import { relaidLines } from './hatch-lines';
import { arcThrough, bulgeMidpoint, bulgeThrough, gripsOf, moveGrip, sameGrip } from './grips';
import type { StretchResult } from './stretch';

export type GripFunction =
  | 'Stretch'
  | 'Stretch Vertex'
  | 'Lengthen'
  | 'Radius'
  | 'Add Vertex'
  | 'Remove Vertex'
  | 'Extend Vertex'
  | 'Convert to Arc'
  | 'Convert to Line'
  | 'Origin Point'
  | 'Hatch Angle'
  | 'Hatch Scale'
  | 'Continue Dimension'
  | 'Baseline Dimension'
  | 'Flip Arrow'
  | 'Move with Dim Line'
  | 'Move Text Only'
  | 'Move with Leader'
  | 'Above Dim Line'
  | 'Center Vertically'
  | 'Reset Text Position';

/** The functions that take no point: they act at once, and Ctrl passes them by. */
export const IMMEDIATE_FUNCTIONS: ReadonlySet<GripFunction> = new Set<GripFunction>([
  'Remove Vertex',
  'Convert to Line',
  'Flip Arrow',
  'Above Dim Line',
  'Center Vertically',
  'Reset Text Position',
]);

/** The functions that start another command (DIMCONTINUE, DIMBASELINE): Ctrl passes them by. */
export const COMMAND_FUNCTIONS: ReadonlySet<GripFunction> = new Set<GripFunction>([
  'Continue Dimension',
  'Baseline Dimension',
]);

/** A linear or aligned dimension's dimension line grip's functions (M3-05 part 4). */
const DIMENSION_LINE_FUNCTIONS: readonly GripFunction[] = [
  'Stretch',
  'Continue Dimension',
  'Baseline Dimension',
  'Flip Arrow',
];

/** Its text grip's. */
const DIMENSION_TEXT_FUNCTIONS: readonly GripFunction[] = [
  'Stretch',
  'Move with Dim Line',
  'Move Text Only',
  'Move with Leader',
  'Above Dim Line',
  'Center Vertically',
  'Reset Text Position',
];

/** The DIMVAR overrides a dimension's text function sets on the dimension. */
export function dimensionGripOverrides(fn: GripFunction): readonly [string, number][] {
  switch (fn) {
    case 'Move with Dim Line':
      return [['DIMTMOVE', 0]];
    case 'Move with Leader':
      return [['DIMTMOVE', 1]];
    case 'Move Text Only':
      return [['DIMTMOVE', 2]];
    case 'Above Dim Line':
      return [['DIMTAD', 1]];
    case 'Center Vertically':
      return [
        ['DIMTAD', 0],
        ['DIMTVP', 0],
      ];
    default:
      return [];
  }
}

type LinearDimension = Extract<DimensionGeometry, { dimType: 'linear' | 'aligned' }>;

const isLinearDimension = (g: EntityGeometry): g is LinearDimension =>
  g.kind === 'DIMENSION' && (g.dimType === 'linear' || g.dimType === 'aligned');

/**
 * The end of a linear or aligned dimension the grip at `grip` is on: 0 the first extension
 * line's, 1 the second's (its dimension line ends), undefined for another grip.
 */
export function dimensionLineEnd(g: LinearDimension, grip: Vec2): 0 | 1 | undefined {
  const [a, b] = dimensionLineEnds(g);
  if (sameGrip(a, grip)) return 0;
  return sameGrip(b, grip) ? 1 : undefined;
}

/** The hatch grip's functions after Stretch (M3-05 part 3). */
const HATCH_FUNCTIONS: readonly GripFunction[] = [
  'Stretch',
  'Origin Point',
  'Hatch Angle',
  'Hatch Scale',
];

/** A hatch with pattern lines to lay out: not a solid fill or a gradient. */
const patterned = (g: HatchGeometry) => !g.solid && !g.gradient && g.patternLines.length > 0;

/** The functions that are the STRETCH grip mode itself. */
export const isStretchFunction = (fn: GripFunction | undefined): boolean =>
  fn === undefined || fn === 'Stretch' || fn === 'Stretch Vertex';

type Poly = LwPolylineGeometry | PolylineGeometry;

/** A polyline whose grips have functions: lightweight, or heavy 2D and not fitted. */
const functional = (g: EntityGeometry): g is Poly =>
  g.kind === 'LWPOLYLINE' || (g.kind === 'POLYLINE' && !g.is3d && !g.fit);

const segmentCount = (g: Poly) => (g.closed ? g.vertices.length : g.vertices.length - 1);

/** The polyline grip at `grip`: a vertex's index, or a segment's (from its first vertex). */
function polylineGrip(
  g: Poly,
  grip: Vec2,
): { vertex: number } | { segment: number; arc: boolean } | undefined {
  const v = g.vertices;
  const vertex = v.findIndex((p) => sameGrip(p, grip));
  if (vertex >= 0) return { vertex };
  for (let i = 0; i < segmentCount(g) && v.length > 1; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % v.length]!;
    const mid =
      a.bulge === 0 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : bulgeMidpoint(a, b, a.bulge);
    if (sameGrip(mid, grip)) return { segment: i, arc: a.bulge !== 0 };
  }
  return undefined;
}

/**
 * The functions of the grip at `grip`, the first the STRETCH grip mode; none where the grip has
 * only that one (or there is no grip there).
 */
export function gripFunctionsOf(
  geom: EntityGeometry,
  grip: Vec2,
  info?: GripInfo,
): readonly GripFunction[] {
  const found = gripsOf(geom, info).find((x) => sameGrip(x.point, grip));
  if (!found) return [];
  switch (geom.kind) {
    case 'LINE':
      return found.kind === 'stretch' ? ['Stretch', 'Lengthen'] : [];
    case 'ARC':
      if (found.kind === 'stretch') return ['Stretch', 'Lengthen'];
      return found.kind === 'arc' ? ['Stretch', 'Radius'] : [];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (!functional(geom) || found.kind === 'cloud') return [];
      const at = polylineGrip(geom, grip);
      if (!at) return [];
      if ('segment' in at) {
        return ['Stretch', 'Add Vertex', at.arc ? 'Convert to Line' : 'Convert to Arc'];
      }
      const end = !geom.closed && (at.vertex === 0 || at.vertex === geom.vertices.length - 1);
      return [
        'Stretch Vertex',
        'Add Vertex',
        'Remove Vertex',
        ...(end ? (['Extend Vertex'] as const) : []),
      ];
    }
    case 'HATCH':
      return patterned(geom) ? HATCH_FUNCTIONS : [];
    case 'DIMENSION':
      if (!isLinearDimension(geom)) return [];
      if (found.kind === 'dimline') return DIMENSION_LINE_FUNCTIONS;
      // The text's grip (one on a definition point is that point's).
      return found.kind === 'stretch' &&
        sameGrip(geom.textPosition, grip) &&
        !sameGrip(geom.first, grip) &&
        !sameGrip(geom.second, grip)
        ? DIMENSION_TEXT_FUNCTIONS
        : [];
    default:
      return [];
  }
}

export type GripFunctionProblem =
  /** The point gives no shape (behind a line's fixed end, in line with a segment, …). */
  | 'invalid'
  /** A polyline keeps at least two vertices. */
  | 'too few'
  /** An arc would go all the way round. */
  | 'too long';

/** A vertex with the widths given, none where both are absent. */
function widths(v: PolylineVertex, sw: number | undefined, ew: number | undefined): PolylineVertex {
  const { startWidth: _s, endWidth: _e, ...rest } = v;
  return {
    ...rest,
    ...(sw !== undefined && { startWidth: sw }),
    ...(ew !== undefined && { endWidth: ew }),
  };
}

/** The segment from vertex `i` split at `p`: two straight halves, or two arcs of one circle. */
function splitSegment(vs: readonly PolylineVertex[], i: number, p: Vec2): PolylineVertex[] {
  const a = vs[i]!;
  const b = vs[(i + 1) % vs.length]!;
  let first = 0;
  let second = 0;
  const arc = a.bulge !== 0 ? arcThrough(a, p, b) : undefined;
  if (arc && !sameGrip(p, a) && !sameGrip(p, b)) {
    // The arc a → p → b, split at p: each half turns the same way.
    const whole = 4 * Math.atan(bulgeThrough(a, p, b));
    const sa = angleOf(sub(a, arc.center));
    const sp = angleOf(sub(p, arc.center));
    const half = whole > 0 ? ccwSweep(sa, sp) : -ccwSweep(sp, sa);
    first = Math.tan(half / 4);
    second = Math.tan((whole - half) / 4);
  }
  const sw = a.startWidth;
  const ew = a.endWidth;
  const mid = sw === undefined && ew === undefined ? undefined : ((sw ?? 0) + (ew ?? 0)) / 2;
  return [
    ...vs.slice(0, i),
    widths({ ...a, bulge: first }, sw, mid),
    widths({ x: p.x, y: p.y, bulge: second }, mid, mid === undefined ? undefined : ew),
    ...vs.slice(i + 1),
  ];
}

/** Two arc segments' bulges as one, when both are arcs of one circle turning the same way. */
function joinedBulge(
  a: PolylineVertex,
  b: PolylineVertex,
  c: PolylineVertex,
  tol: Tolerance,
): number {
  if (a.bulge === 0 || b.bulge === 0 || Math.sign(a.bulge) !== Math.sign(b.bulge)) return 0;
  const sweep = 4 * Math.atan(a.bulge) + 4 * Math.atan(b.bulge);
  if (Math.abs(sweep) >= TAU - tol.angular) return 0;
  const bulge = Math.tan(sweep / 4);
  // One circle: the joined arc passes through the removed vertex.
  const m = bulgeThrough(a, b, c);
  return Math.abs(m - bulge) <= 1e-9 * Math.max(1, Math.abs(bulge)) ? bulge : 0;
}

function removeVertex(g: Poly, i: number, tol: Tolerance): PolylineVertex[] | GripFunctionProblem {
  const vs = g.vertices;
  const n = vs.length;
  if (n <= 2) return 'too few';
  const before = g.closed ? (i - 1 + n) % n : i - 1;
  if (before < 0 || (!g.closed && i === n - 1)) {
    // An open polyline's end: the next (or previous) vertex is the end now.
    return vs.filter((_, k) => k !== i);
  }
  const p = vs[before]!;
  const after = vs[(i + 1) % n]!;
  const joined = widths(
    { ...p, bulge: joinedBulge(p, vs[i]!, after, tol) },
    p.startWidth,
    vs[i]!.endWidth,
  );
  return vs.map((v, k) => (k === before ? joined : v)).filter((_, k) => k !== i);
}

const withVertices = (g: Poly, vertices: readonly PolylineVertex[]): Poly => ({ ...g, vertices });

/**
 * What the function `fn` of the grip at `grip` does with the point `to` (Convert to Line takes
 * none): the object's new shape, or why there is none. Stretch is `moveGrip`'s.
 */
export function gripFunctionEdit(
  geom: EntityGeometry,
  grip: Vec2,
  fn: GripFunction,
  to: Vec2,
  tol: Tolerance,
  info?: GripInfo,
): EntityGeometry | GripFunctionProblem {
  if (!gripFunctionsOf(geom, grip, info).includes(fn)) return 'invalid';
  switch (fn) {
    case 'Lengthen': {
      const c = breakCurveOf(geom);
      if (!c || (c.kind !== 'LINE' && c.kind !== 'ARC')) return 'invalid';
      const end = c.kind === 'LINE' ? c.end : add(c.center, polar(c.endAngle, c.radius));
      const atEnd = sameGrip(end, grip);
      const length = lengthTo(c, atEnd, to, tol);
      if (length === undefined) return 'invalid';
      const r = lengthenGeometry(geom, c, atEnd, length, tol);
      if (r === 'too long') return 'too long';
      return typeof r === 'string' ? 'invalid' : r;
    }
    case 'Radius':
      return gripFunctionValue(geom, fn, distance((geom as ArcGeometry).center, to), tol);
    case 'Hatch Angle':
      if (distance(grip, to) <= tol.linear) return 'invalid';
      return gripFunctionValue(geom, fn, angleOf(sub(to, grip)), tol);
    case 'Hatch Scale':
      return gripFunctionValue(geom, fn, distance(grip, to), tol);
    case 'Flip Arrow': {
      const d = geom as LinearDimension;
      const end = dimensionLineEnd(d, grip)!;
      const flipArrows: [boolean, boolean] = [...(d.flipArrows ?? [false, false])];
      flipArrows[end] = !flipArrows[end];
      return { ...d, flipArrows };
    }
    case 'Move Text Only':
    case 'Move with Leader':
      return { ...(geom as LinearDimension), textPosition: to, textUserPositioned: true };
    case 'Move with Dim Line': {
      // The dimension line moves across by as much as the text does.
      const d = geom as LinearDimension;
      const u = dimensionDirection(d);
      const moved = sub(to, d.textPosition);
      const across = sub(moved, scale(u, dot(moved, u)));
      return {
        ...d,
        definitionPoint: add(d.definitionPoint, across),
        textPosition: to,
        textUserPositioned: true,
      };
    }
    case 'Above Dim Line':
    case 'Center Vertically':
    case 'Reset Text Position':
      return { ...(geom as LinearDimension), textUserPositioned: false };
    case 'Continue Dimension':
    case 'Baseline Dimension':
      return 'invalid';
    case 'Origin Point': {
      const h = geom as HatchGeometry;
      const d = sub(to, h.patternLines[0]!.base);
      const patternLines = h.patternLines.map((l) => ({ ...l, base: add(l.base, d) }));
      return { ...h, patternLines };
    }
    default:
      break;
  }
  const g = geom as Poly;
  const at = polylineGrip(g, grip)!;
  const vs = g.vertices;
  switch (fn) {
    case 'Add Vertex': {
      const n = vs.length;
      const i = 'segment' in at ? at.segment : !g.closed && at.vertex === n - 1 ? n - 2 : at.vertex;
      return withVertices(g, splitSegment(vs, i, to));
    }
    case 'Remove Vertex': {
      const r = removeVertex(g, (at as { vertex: number }).vertex, tol);
      return typeof r === 'string' ? r : withVertices(g, r);
    }
    case 'Extend Vertex': {
      const i = (at as { vertex: number }).vertex;
      const end = vs[i]!;
      if (i === 0) {
        const added = widths({ x: to.x, y: to.y, bulge: 0 }, end.startWidth, end.startWidth);
        return withVertices(g, [added, ...vs]);
      }
      const added = widths({ x: to.x, y: to.y, bulge: 0 }, end.startWidth, end.endWidth);
      return withVertices(g, [...vs.slice(0, i), { ...end, bulge: 0 }, added]);
    }
    case 'Convert to Arc': {
      const i = (at as { segment: number }).segment;
      const bulge = bulgeThrough(vs[i]!, to, vs[(i + 1) % vs.length]!);
      if (bulge === 0) return 'invalid';
      return withVertices(
        g,
        vs.map((v, k) => (k === i ? { ...v, bulge } : v)),
      );
    }
    case 'Convert to Line': {
      const i = (at as { segment: number }).segment;
      return withVertices(
        g,
        vs.map((v, k) => (k === i ? { ...v, bulge: 0 } : v)),
      );
    }
    default:
      return 'invalid';
  }
}

/**
 * What a function that takes a value (Radius, Hatch Angle, Hatch Scale) does with the value
 * typed: the arc's radius, the hatch's pattern angle or scale.
 */
export function gripFunctionValue(
  geom: EntityGeometry,
  fn: 'Radius' | 'Hatch Angle' | 'Hatch Scale',
  value: number,
  tol: Tolerance,
): EntityGeometry | GripFunctionProblem {
  if (fn === 'Radius') {
    return value > tol.linear ? { ...(geom as ArcGeometry), radius: value } : 'invalid';
  }
  const h = geom as HatchGeometry;
  const origin = h.patternLines[0]!.base;
  if (fn === 'Hatch Angle') {
    const patternAngle = normalizeAngle(value);
    const patternLines = relaidLines(h.patternLines, origin, patternAngle - h.patternAngle, 1);
    return { ...h, patternAngle, patternLines };
  }
  if (!(value > 0)) return 'invalid';
  // A stored scale of 0 (a file's) lays the lines out as they are, at scale 1.
  const k = value / (h.patternScale > 0 ? h.patternScale : 1);
  return { ...h, patternScale: value, patternLines: relaidLines(h.patternLines, origin, 0, k) };
}

const polar = (theta: number, r: number): Vec2 => ({
  x: r * Math.cos(theta),
  y: r * Math.sin(theta),
});

/** A tolerance from the object's own size, for a drag preview drawn without the drawing's. */
function ownTolerance(geom: EntityGeometry, grip: Vec2): Tolerance {
  const pts = gripsOf(geom).map((x) => x.point);
  let m = Math.max(Math.abs(grip.x), Math.abs(grip.y));
  for (const p of pts) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  return toleranceForSize(m);
}

/**
 * What dragging the grip at `grip` to `to` does with the function `fn` (the STRETCH grip mode
 * when it is a Stretch or not given): the drag preview's and the grip command's.
 */
export function moveGripBy(
  geom: EntityGeometry,
  grip: Vec2,
  to: Vec2,
  info: GripInfo | undefined,
  fn: GripFunction | undefined,
  tol: Tolerance = ownTolerance(geom, grip),
): StretchResult {
  if (isStretchFunction(fn)) return moveGrip(geom, grip, to, info);
  const r = gripFunctionEdit(geom, grip, fn!, to, tol, info);
  return typeof r === 'string' ? { kind: 'none' } : { kind: 'shape', geom: r };
}
