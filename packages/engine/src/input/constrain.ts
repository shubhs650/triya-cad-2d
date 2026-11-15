// ORTHO, POLAR and SNAP (M2-04, ARCHITECTURE.md §5.3 `OrthoPolar`): what becomes of the cursor
// before it is a point. AutoCAD 2024 Help, "ORTHOMODE", "Use Polar Tracking and PolarSnap"
// and "SNAPMODE": SNAP rounds the cursor to the snap spacing; with a base point, ORTHO keeps
// the horizontal or vertical the cursor is nearer to, and POLAR locks onto an increment angle
// (or an additional angle) the cursor passes near, showing "Polar: distance < angle". ORTHO
// and POLAR cannot both be on (the front-end turns one off when the other goes on). An object
// snap point wins over all three (applied by the front-end after these); typed coordinates
// are never constrained.
//
// Not in this version (M3-06): SNAPANG and isometric snap, PolarSnap distances, polar angles
// relative to the last segment (POLARMODE bit 1), UCS.
import type { Vec2 } from '../geom/types';
import { orthoTrack, trackCursor, type Acquired, type TrackLock } from './track';

/** ORTHO: the horizontal or vertical from `base`, whichever the cursor is nearer to. */
export function orthoPoint(base: Vec2, p: Vec2): Vec2 {
  return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y)
    ? { x: p.x, y: base.y }
    : { x: base.x, y: p.y };
}

export interface PolarSettings {
  /** POLARANG, radians: tracking at every multiple of it. AutoCAD's initial value is 90°. */
  readonly increment: number;
  /** POLARADDANG, radians (used when POLARMODE bit 4 is set). */
  readonly additional?: readonly number[];
}

export interface PolarLock {
  /** The cursor moved onto the tracking path. */
  readonly point: Vec2;
  /** The path's angle, radians in [0, 2π). */
  readonly angle: number;
  /** From the base point to `point`. */
  readonly distance: number;
}

const TAU = 2 * Math.PI;

/**
 * POLAR: the tracking path from `base` the cursor is within `tolerance` (drawing units: the
 * tracking aperture over the view's scale) of, with the cursor moved onto it; undefined away
 * from every path.
 */
export function polarTrack(
  base: Vec2,
  p: Vec2,
  s: PolarSettings,
  tolerance: number,
): PolarLock | undefined {
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  if (dx === 0 && dy === 0) return undefined;
  const angles: number[] = [];
  if (s.increment > 1e-9) {
    const n = Math.min(Math.round(TAU / s.increment), 3600);
    for (let k = 0; k < n; k++) angles.push(k * s.increment);
  }
  for (const a of s.additional ?? []) angles.push(((a % TAU) + TAU) % TAU);
  let best: PolarLock | undefined;
  let bestOff = Infinity;
  for (const a of angles) {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const along = dx * ux + dy * uy;
    if (along <= 0) continue;
    const off = Math.abs(dx * uy - dy * ux);
    if (off > tolerance || off >= bestOff) continue;
    bestOff = off;
    // Exactly on the axes for 0°, 90°, … so a tracked point has no stray 1e-16.
    const cx = Math.abs(ux) < 1e-12 ? 0 : ux;
    const cy = Math.abs(uy) < 1e-12 ? 0 : uy;
    best = {
      point: { x: base.x + cx * along, y: base.y + cy * along },
      angle: ((a % TAU) + TAU) % TAU,
      distance: along,
    };
  }
  return best;
}

/** The polar tracking tooltip: `Polar: 14.3543 < 45°` (distance in LUPREC places). */
export function polarLabel(t: PolarLock, precision = 4): string {
  const deg = (t.angle * 180) / Math.PI;
  const shown =
    Math.abs(deg - Math.round(deg)) < 1e-6 ? String(Math.round(deg) % 360) : deg.toFixed(2);
  return `Polar: ${t.distance.toFixed(precision)} < ${shown}°`;
}

/** SNAP: the nearest snap point, `spacing` apart from `base` (SNAPUNIT, SNAPBASE). */
export function snapToGrid(p: Vec2, spacing: Vec2, base: Vec2 = { x: 0, y: 0 }): Vec2 {
  const round = (v: number, o: number, s: number) =>
    s > 0 ? +(o + Math.round((v - o) / s) * s).toPrecision(15) : v;
  return { x: round(p.x, base.x, spacing.x), y: round(p.y, base.y, spacing.y) };
}

export interface ConstrainOptions {
  /** The point the cursor is measured from (a rubber band's start); none: SNAP only. */
  readonly base?: Vec2;
  /** SNAPUNIT when SNAP is on. */
  readonly snap?: Vec2;
  readonly snapBase?: Vec2;
  readonly ortho?: boolean;
  /** Polar tracking settings when POLAR is on. */
  readonly polar?: PolarSettings;
  /** Polar and object snap tracking's reach, drawing units. */
  readonly tolerance?: number;
  /** Points acquired for OTRACK, EXTension and PARallel (M2-04 part 2, `track.ts`). */
  readonly acquired?: readonly Acquired[];
  /** POLARMODE bit 2: OTRACK follows the polar angles. */
  readonly trackPolar?: boolean;
}

export interface Constrained {
  readonly point: Vec2;
  /** The polar tracking path from the base the cursor locked onto, alone. */
  readonly polar?: PolarLock;
  /** The tracking paths otherwise: from acquired points, or two crossing. */
  readonly track?: TrackLock;
}

/**
 * The cursor after SNAP, then ORTHO or tracking (POLAR, OTRACK, EXT, PAR); `polar` or `track`
 * says which paths it locked onto. ORTHO keeps it on its axis, where an acquired point's path
 * may say how far along; tracking otherwise takes it onto the nearest path, or two crossing.
 */
export function constrainCursor(p: Vec2, o: ConstrainOptions): Constrained {
  const snapped = o.snap ? snapToGrid(p, o.snap, o.snapBase) : p;
  const acquired = o.acquired ?? [];
  const tolerance = o.tolerance ?? 0;
  if (o.base && o.ortho) {
    const point = orthoPoint(o.base, snapped);
    const axis = Math.atan2(point.y - o.base.y, point.x - o.base.x);
    const lock =
      acquired.length > 0 && (point.x !== o.base.x || point.y !== o.base.y)
        ? orthoTrack(o.base, axis, p, acquired, tolerance)
        : undefined;
    return lock ? { point: lock.point, track: lock } : { point };
  }
  const polar = o.base ? o.polar : undefined;
  if (polar || acquired.length > 0) {
    const lock = trackCursor(p, {
      ...(o.base && { base: o.base }),
      ...(o.polar && { polar: o.polar }),
      acquired,
      ...(o.trackPolar && { trackPolar: true }),
      tolerance,
    });
    const only = lock?.paths.length === 1 ? lock.paths[0]! : undefined;
    if (lock && only?.label === 'Polar') {
      const distance = Math.hypot(lock.point.x - only.from.x, lock.point.y - only.from.y);
      return { point: lock.point, polar: { point: lock.point, angle: only.angle, distance } };
    }
    if (lock) return { point: lock.point, track: lock };
  }
  return { point: snapped };
}
