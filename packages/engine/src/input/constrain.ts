// ORTHO, POLAR and SNAP (M2-04, ARCHITECTURE.md §5.3 `OrthoPolar`): what becomes of the cursor
// before it is a point. AutoCAD 2024 Help, "ORTHOMODE", "Use Polar Tracking and PolarSnap"
// and "SNAPMODE": SNAP rounds the cursor to the snap spacing; with a base point, ORTHO keeps
// the horizontal or vertical the cursor is nearer to, and POLAR locks onto an increment angle
// (or an additional angle) the cursor passes near, showing "Polar: distance < angle". ORTHO
// and POLAR cannot both be on (the front-end turns one off when the other goes on). An object
// snap point wins over all three (applied by the front-end after these); typed coordinates
// are never constrained.
//
// M3-06 part 3: PolarSnap (SNAPTYPE 1, POLARDIST): instead of the grid, the cursor snaps along
// a tracking path to whole multiples of the polar distance from where the path starts ("the
// cursor snaps from the first point specified to distances of 0, 4, 8, 12, 16, and so on");
// off every path it is free. And polar angles relative to the last segment (POLARMODE 1).
//
// M3-06 part 7: the UCS and SNAPANG. AutoCAD 2024 Help, "SNAPANG": the snap and grid turn by
// it "relative to the current UCS", and ORTHO "restricts cursor movement to the horizontal or
// vertical directions, relative to the UCS", turned with the snap angle; polar tracking's
// angles and object snap tracking's horizontal and vertical paths count from the UCS's X axis
// ("Polar angle measurement: Absolute: Bases polar tracking angles on the current user
// coordinate system"). `ucs` is the UCS X axis's world angle, `snapAngle` SNAPANG on top of it.
// Isometric snap is PRD non-goal 7 (DEC-060).
import type { Vec2 } from '../geom/types';
import { unitAt } from './ucs';
import {
  orthoTrack,
  polarAngles,
  shownAngle,
  trackCursor,
  type Acquired,
  type TrackLock,
  type TrackPath,
} from './track';

/**
 * ORTHO: the horizontal or vertical from `base`, whichever the cursor is nearer to; with `angle`
 * (the UCS and snap angle), the axes turned by it.
 */
export function orthoPoint(base: Vec2, p: Vec2, angle = 0): Vec2 {
  if (angle === 0)
    return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y)
      ? { x: p.x, y: base.y }
      : { x: base.x, y: p.y };
  const u = unitAt(angle);
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  const along = dx * u.x + dy * u.y;
  const across = -dx * u.y + dy * u.x;
  const keep = (v: number) => +v.toPrecision(15);
  return Math.abs(along) >= Math.abs(across)
    ? { x: keep(base.x + along * u.x), y: keep(base.y + along * u.y) }
    : { x: keep(base.x - across * u.y), y: keep(base.y + across * u.x) };
}

export interface PolarSettings {
  /** POLARANG, radians: tracking at every multiple of it. AutoCAD's initial value is 90°. */
  readonly increment: number;
  /** POLARADDANG, radians (used when POLARMODE bit 4 is set). */
  readonly additional?: readonly number[];
  /**
   * POLARMODE bit 1 with a last segment ending at the base point: that segment's angle,
   * radians, which the polar angles count from.
   */
  readonly relative?: number;
  /**
   * The UCS X axis's world angle (M3-06 part 7), which the polar angles count from when they
   * are not relative to the last segment, and which the tooltip's angles are measured from.
   */
  readonly zero?: number;
}

export interface PolarLock {
  /** The cursor moved onto the tracking path. */
  readonly point: Vec2;
  /** The path's angle, radians in [0, 2π). */
  readonly angle: number;
  /** From the base point to `point`. */
  readonly distance: number;
  /** The last segment's angle the path's angle counts from (POLARMODE 1). */
  readonly relative?: number;
  /** The UCS X axis's angle the tooltip counts an absolute path's angle from. */
  readonly zero?: number;
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
  const angles = polarAngles(s);
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
      ...(s.relative !== undefined && { relative: s.relative }),
    };
  }
  return best;
}

/**
 * The polar tracking tooltip: `Polar: 14.3543 < 45°` (distance in LUPREC places), or
 * `Relative Polar: 10.0000 < 90°` with the angle from the last segment (POLARMODE 1).
 */
export function polarLabel(t: PolarLock, precision = 4): string {
  const deg = (shownAngle(t) * 180) / Math.PI;
  const shown =
    Math.abs(deg - Math.round(deg)) < 1e-6 ? String(Math.round(deg) % 360) : deg.toFixed(2);
  const name = t.relative === undefined ? 'Polar' : 'Relative Polar';
  return `${name}: ${t.distance.toFixed(precision)} < ${shown}°`;
}

/**
 * SNAP: the nearest snap point, `spacing` apart from `base` (SNAPUNIT, SNAPBASE), along axes
 * turned by `angle` (the UCS and SNAPANG) about the base.
 */
export function snapToGrid(p: Vec2, spacing: Vec2, base: Vec2 = { x: 0, y: 0 }, angle = 0): Vec2 {
  const round = (v: number, o: number, s: number) =>
    s > 0 ? +(o + Math.round((v - o) / s) * s).toPrecision(15) : v;
  if (angle === 0) return { x: round(p.x, base.x, spacing.x), y: round(p.y, base.y, spacing.y) };
  const u = unitAt(angle);
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  const i = round(dx * u.x + dy * u.y, 0, spacing.x);
  const j = round(-dx * u.y + dy * u.x, 0, spacing.y);
  const keep = (v: number) => +v.toPrecision(15);
  return { x: keep(base.x + i * u.x - j * u.y), y: keep(base.y + i * u.y + j * u.x) };
}

export interface ConstrainOptions {
  /** The point the cursor is measured from (a rubber band's start); none: SNAP only. */
  readonly base?: Vec2;
  /** SNAPUNIT when SNAP is on with grid snap (SNAPTYPE 0). */
  readonly snap?: Vec2;
  /**
   * The PolarSnap distance when SNAP is on with PolarSnap (SNAPTYPE 1): POLARDIST, or the snap X
   * spacing while POLARDIST is 0. Grid snap does not apply with it ("PolarSnap and grid snap
   * cannot be turned on at the same time").
   */
  readonly polarSnap?: number;
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
  /** The UCS X axis's world angle, radians (M3-06 part 7). */
  readonly ucs?: number;
  /** SNAPANG: the snap, grid and ORTHO axes turned from the UCS's, radians. */
  readonly snapAngle?: number;
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
  const polarSnap = o.polarSnap !== undefined && o.polarSnap > 0 ? o.polarSnap : undefined;
  const zero = o.ucs ?? 0;
  const axes = zero + (o.snapAngle ?? 0);
  const snapped = o.snap && !polarSnap ? snapToGrid(p, o.snap, o.snapBase, axes) : p;
  const acquired = o.acquired ?? [];
  const tolerance = o.tolerance ?? 0;
  if (o.base && o.ortho) {
    const point = orthoPoint(o.base, snapped, axes);
    const axis = Math.atan2(point.y - o.base.y, point.x - o.base.x);
    const lock =
      acquired.length > 0 && (point.x !== o.base.x || point.y !== o.base.y)
        ? orthoTrack(o.base, axis, p, acquired, tolerance, zero)
        : undefined;
    return lock ? { point: lock.point, track: lock } : { point };
  }
  const polar = o.base ? o.polar : undefined;
  if (polar || acquired.length > 0) {
    const found = trackCursor(p, {
      ...(o.base && { base: o.base }),
      ...(o.polar && { polar: zero ? { ...o.polar, zero } : o.polar }),
      acquired,
      ...(o.trackPolar && { trackPolar: true }),
      ...(zero && { zero }),
      tolerance,
    });
    const only = found?.paths.length === 1 ? found.paths[0]! : undefined;
    const lock =
      found && only && polarSnap
        ? { ...found, point: alongBy(only, found.point, polarSnap) }
        : found;
    if (lock && only?.polar) {
      const distance = Math.hypot(lock.point.x - only.from.x, lock.point.y - only.from.y);
      return {
        point: lock.point,
        polar: {
          point: lock.point,
          angle: only.angle,
          distance,
          ...(only.relative !== undefined && { relative: only.relative }),
          ...(only.zero !== undefined && { zero: only.zero }),
        },
      };
    }
    if (lock) return { point: lock.point, track: lock };
  }
  return { point: snapped };
}

/** PolarSnap: `point` on `path` moved to the nearest whole multiple of `step` from its start. */
function alongBy(path: TrackPath, point: Vec2, step: number): Vec2 {
  const along = Math.hypot(point.x - path.from.x, point.y - path.from.y);
  const d = Math.round(along / step) * step;
  const t = along === 0 ? 0 : d / along;
  const at = (o: number, v: number) => +(o + (v - o) * t).toPrecision(15);
  return { x: at(path.from.x, point.x), y: at(path.from.y, point.y) };
}
