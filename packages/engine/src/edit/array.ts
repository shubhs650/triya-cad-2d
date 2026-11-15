// Where ARRAY puts its items (M3-03): the similarity that carries the source objects onto each
// item of a rectangular, polar or path array, item 0 first. The commands
// (`commands/modify/array.ts`) copy the objects by these; the geometry lives here so it is
// tested apart from the prompts.
//
// AutoCAD 2024 Help: "ARRAYRECT (Command)", "ARRAYPOLAR (Command)", "ARRAYPATH (Command)".
import { arcLengthTable, frameAtLength, type ArcLengthTable } from '../geom/arclength';
import type { BoundedCurve, Polyline } from '../geom/curves';
import { domain } from '../geom/eval';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, perp, scale, sub } from '../geom/vec';
import { splineCurve } from '../model/spline';
import type { EntityGeometry } from '../model/types';
import { followedBy, moveBy, turnAbout, type Similarity } from './similarity';

/**
 * AutoCAD keeps an array to 100,000 items (its MaxArray registry setting): more would
 * swamp the drawing, and a slip of the keyboard (1000 by 1000) should not hang the app.
 */
export const MAX_ARRAY_ITEMS = 100_000;

// ── Rectangular ─────────────────────────────────────────────────────────────────────────────

export interface RectangularArray {
  readonly columns: number;
  readonly rows: number;
  /** From one column to the next along +X; negative runs the columns to the left. */
  readonly columnSpacing: number;
  /** From one row to the next along +Y; negative runs the rows down. */
  readonly rowSpacing: number;
}

/** Row by row from the source (row 0, column 0), along the X and Y axes. */
export function rectangularItems(a: RectangularArray): Similarity[] {
  const out: Similarity[] = [];
  for (let r = 0; r < a.rows; r++) {
    for (let c = 0; c < a.columns; c++) {
      out.push(moveBy({ x: c * a.columnSpacing, y: r * a.rowSpacing }));
    }
  }
  return out;
}

// ── Polar ───────────────────────────────────────────────────────────────────────────────────

export interface PolarArray {
  readonly center: Vec2;
  /** The point of the source that is carried round when items are not rotated. */
  readonly base: Vec2;
  readonly items: number;
  /** Radians, + counterclockwise; ±2π fills the circle. */
  readonly fillAngle: number;
  readonly rows: number;
  /** From one ring to the next, outward from the centre. */
  readonly rowSpacing: number;
  readonly rotateItems: boolean;
}

const FULL_TURN = 2 * Math.PI;
const isFullTurn = (a: number) => Math.abs(Math.abs(a) - FULL_TURN) <= 1e-9;

/**
 * The angle from one item to the next: a full circle shares it among all the items, a part
 * circle puts the first and last items at its ends.
 */
export function polarAngleBetween(items: number, fillAngle: number): number {
  if (items < 2) return 0;
  return isFullTurn(fillAngle) ? fillAngle / items : fillAngle / (items - 1);
}

/**
 * Item i of ring r is turned i × the angle between items about the centre (or, when items are
 * not rotated, moved so its base point lands where the turn would put it), then moved outward
 * r × the row spacing along the line from the centre through its base point.
 */
export function polarItems(a: PolarArray): Similarity[] {
  const step = polarAngleBetween(a.items, a.fillAngle);
  const out: Similarity[] = [];
  const radius = distance(a.base, a.center);
  const baseDir = angleOf(sub(a.base, a.center));
  for (let r = 0; r < a.rows; r++) {
    for (let i = 0; i < a.items; i++) {
      const angle = i * step;
      const dir = baseDir + angle;
      // A base point on the centre has no outward direction: rings then grow along +X turned.
      const unit = { x: Math.cos(radius > 0 ? dir : angle), y: Math.sin(radius > 0 ? dir : angle) };
      const outward = scale(unit, r * a.rowSpacing);
      let t: Similarity;
      if (a.rotateItems) {
        t = angle === 0 ? moveBy({ x: 0, y: 0 }) : turnAbout(a.center, angle);
      } else {
        const turned = add(a.center, scale({ x: Math.cos(dir), y: Math.sin(dir) }, radius));
        t = moveBy(sub(turned, a.base));
      }
      out.push(r === 0 ? t : followedBy(t, moveBy(outward)));
    }
  }
  return out;
}

// ── Path ────────────────────────────────────────────────────────────────────────────────────

/** A path curve ARRAYPATH can follow, measured from the end it starts at. */
export interface ArrayPath {
  readonly table: ArcLengthTable;
  /** Items run from the curve's end point back to its start. */
  readonly reversed: boolean;
  readonly closed: boolean;
}

/**
 * The curve an object is as a path: lines, arcs, circles, ellipses, polylines (2D and 3D, as
 * drawn, flattened onto XY) and splines; undefined for anything else, or a curve of no length.
 */
export function pathCurveOf(
  g: EntityGeometry,
): { curve: BoundedCurve; closed: boolean } | undefined {
  let found: { curve: BoundedCurve; closed: boolean } | undefined;
  switch (g.kind) {
    case 'LINE':
      found = { curve: g, closed: false };
      break;
    case 'ARC':
      found = { curve: g, closed: false };
      break;
    case 'CIRCLE':
      found = { curve: g, closed: true };
      break;
    case 'ELLIPSE': {
      const d = domain(g);
      found = { curve: g, closed: isFullTurn(d.end - d.start) };
      break;
    }
    case 'LWPOLYLINE':
      found = { curve: g, closed: g.closed };
      break;
    case 'POLYLINE': {
      const p: Polyline = {
        kind: 'LWPOLYLINE',
        closed: g.closed,
        vertices: g.vertices.map((v) => ({ x: v.x, y: v.y, bulge: g.is3d ? 0 : v.bulge })),
      };
      if (p.vertices.length >= 2) found = { curve: p, closed: g.closed };
      break;
    }
    case 'SPLINE': {
      const curve = splineCurve(g);
      if (curve) found = { curve, closed: g.closed || g.periodic };
      break;
    }
    default:
      break;
  }
  if (found && found.curve.kind === 'LWPOLYLINE' && found.curve.vertices.length < 2)
    return undefined;
  return found;
}

export function arrayPath(curve: BoundedCurve, closed: boolean, reversed: boolean): ArrayPath {
  return { table: arcLengthTable(curve), reversed, closed };
}

export const pathLength = (p: ArrayPath): number => p.table.length;

/** The point and direction of travel `s` along the path from the end it starts at. */
export function pathFrame(p: ArrayPath, s: number): { point: Vec2; direction: Vec2 } {
  if (!p.reversed) return frameAtLength(p.table, s);
  const f = frameAtLength(p.table, p.table.length - s);
  return { point: f.point, direction: scale(f.direction, -1) };
}

/** The start of the path (ARRAYPATH's default base point, "end of path curve"). */
export const pathStart = (p: ArrayPath): Vec2 => pathFrame(p, 0).point;

/**
 * Measure's most items at `spacing`: as many as fit from the start to the end, one fewer on a
 * closed path, whose end is its start.
 */
export function measureMaxItems(p: ArrayPath, spacing: number): number {
  if (!(spacing > 0)) return 1;
  const fits = Math.floor(pathLength(p) / spacing + 1e-9);
  return Math.max(1, p.closed ? fits : fits + 1);
}

export interface PathArray {
  readonly path: ArrayPath;
  /** The point of the source that is carried onto the path. */
  readonly base: Vec2;
  /** Measure: `spacing` apart from the start. Divide: spread evenly along the whole path. */
  readonly method: 'measure' | 'divide';
  readonly spacing: number;
  readonly items: number;
  readonly rows: number;
  /** From one row to the next, to the left of the path's direction of travel. */
  readonly rowSpacing: number;
  /** Items are turned with the path's direction (Align items). */
  readonly align: boolean;
  /**
   * The direction of the source that runs along the path (Tangent direction); the path's own
   * direction at its start when not given, so the first item keeps its direction.
   */
  readonly tangent?: Vec2;
}

/** The distances along the path the items sit at. */
export function pathStations(a: PathArray): number[] {
  const n = a.items;
  const length = pathLength(a.path);
  let step = a.spacing;
  if (a.method === 'divide') step = n < 2 ? 0 : length / (a.path.closed ? n : n - 1);
  return Array.from({ length: n }, (_, i) => i * step);
}

/**
 * Item i of row r: the source moved so its base point lands at the item's station (shifted r ×
 * the row spacing to the left of the path), then, when aligned, turned about that point from
 * the tangent direction to the path's direction there.
 */
export function pathItems(a: PathArray): Similarity[] {
  const stations = pathStations(a);
  const reference = angleOf(a.tangent ?? pathFrame(a.path, 0).direction);
  const out: Similarity[] = [];
  for (let r = 0; r < a.rows; r++) {
    for (const s of stations) {
      const f = pathFrame(a.path, s);
      const at = add(f.point, scale(perp(f.direction), r * a.rowSpacing));
      const move = moveBy(sub(at, a.base));
      const turn = angleOf(f.direction) - reference;
      out.push(a.align && Math.abs(turn) > 1e-12 ? followedBy(move, turnAbout(at, turn)) : move);
    }
  }
  return out;
}
