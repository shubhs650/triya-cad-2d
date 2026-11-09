// Object snap tracking and the EXTension and PARallel snaps (M2-04 part 2, ARCHITECTURE.md
// §5.3): paths followed from points the drafter acquires by pausing the cursor over them.
// AutoCAD 2024 Help, "Use Object Snap Tracking", "Object Snaps" (Extension, Parallel) and
// "POLARMODE":
// - OTRACK: from each acquired object snap point, paths horizontal and vertical (POLARMODE bit
//   2 off, AutoCAD's initial value) or along the polar angles (bit 2 on).
// - EXTension: from a line's acquired end, on along the line (not back over it).
// - PARallel: from the base point, both ways parallel to an acquired line.
// - Polar tracking's paths from the base point take part too, so a path from an acquired point
//   crosses a polar path ("Endpoint: < 90°, Polar: < 0°").
// The cursor goes onto the path it is within `tolerance` of; where two paths that cross are
// both that near, onto their crossing. What is acquired and when is the front-end's: AutoCAD
// acquires a point the cursor pauses over and drops it when the cursor pauses over it again,
// keeping at most seven.
import type { Vec2 } from '../geom/types';
import { OSNAP_MODES, type OsnapMode } from './osnap';
import type { PolarSettings } from './constrain';

export type Acquired =
  /** An object snap point acquired for OTRACK. */
  | { readonly kind: 'point'; readonly point: Vec2; readonly mode: OsnapMode }
  /** A line's end acquired for EXTension; `direction` points out of the line. */
  | { readonly kind: 'extension'; readonly point: Vec2; readonly direction: Vec2 }
  /** A line acquired for PARallel where the cursor paused on it. */
  | { readonly kind: 'parallel'; readonly point: Vec2; readonly direction: Vec2 };

/** AutoCAD's limit on acquired tracking points. */
export const MAX_ACQUIRED = 7;

export interface TrackPath {
  readonly from: Vec2;
  /** Radians in [0, 2π). */
  readonly angle: number;
  /** What the tooltip calls it: "Polar", "Ortho", the acquired point's mode, "Extension"… */
  readonly label: string;
}

export interface TrackLock {
  readonly point: Vec2;
  /** The path the point is on, or the two crossing there, nearest first. */
  readonly paths: readonly TrackPath[];
}

export interface TrackOptions {
  /** The rubber band's start: polar and parallel paths run from it. */
  readonly base?: Vec2;
  /** POLAR on: its paths from the base, and (with `trackPolar`) the angles OTRACK follows. */
  readonly polar?: PolarSettings;
  readonly acquired?: readonly Acquired[];
  /** POLARMODE bit 2: OTRACK follows the polar angles rather than horizontal and vertical. */
  readonly trackPolar?: boolean;
  /** How near the cursor must pass a path, drawing units. */
  readonly tolerance: number;
}

const TAU = 2 * Math.PI;
const LABEL = new Map(OSNAP_MODES.map((m) => [m.mode, m.label]));
const ORTHOGONAL = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

const norm = (a: number): number => ((a % TAU) + TAU) % TAU;

function polarAngles(s: PolarSettings): number[] {
  const out: number[] = [];
  if (s.increment > 1e-9) {
    const n = Math.min(Math.round(TAU / s.increment), 3600);
    for (let k = 0; k < n; k++) out.push(k * s.increment);
  }
  for (const a of s.additional ?? []) out.push(norm(a));
  return out;
}

/** Every path the options give, before looking at the cursor. */
export function trackPaths(o: Omit<TrackOptions, 'tolerance'>): TrackPath[] {
  const paths: TrackPath[] = [];
  const { base, polar } = o;
  if (base && polar) {
    for (const a of polarAngles(polar)) paths.push({ from: base, angle: a, label: 'Polar' });
  }
  const otrack = o.trackPolar && polar ? polarAngles(polar) : ORTHOGONAL;
  for (const q of o.acquired ?? []) {
    if (q.kind === 'point') {
      const label = LABEL.get(q.mode) ?? q.mode;
      for (const a of otrack) paths.push({ from: q.point, angle: a, label });
    } else if (q.kind === 'extension') {
      const a = norm(Math.atan2(q.direction.y, q.direction.x));
      paths.push({ from: q.point, angle: a, label: 'Extension' });
    } else if (base) {
      const a = norm(Math.atan2(q.direction.y, q.direction.x));
      paths.push({ from: base, angle: a, label: 'Parallel' });
      paths.push({ from: base, angle: norm(a + Math.PI), label: 'Parallel' });
    }
  }
  return paths;
}

const unit = (a: number): Vec2 => {
  // Exactly on the axes for 0°, 90°, … so a tracked point has no stray 1e-16.
  const x = Math.cos(a);
  const y = Math.sin(a);
  return { x: Math.abs(x) < 1e-12 ? 0 : x, y: Math.abs(y) < 1e-12 ? 0 : y };
};

interface Near {
  readonly path: TrackPath;
  readonly off: number;
  readonly point: Vec2;
}

/** The crossing of two paths, on both (not behind either start); undefined if parallel. */
function crossing(a: TrackPath, b: TrackPath): Vec2 | undefined {
  const u = unit(a.angle);
  const v = unit(b.angle);
  const den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < 1e-9) return undefined;
  const dx = b.from.x - a.from.x;
  const dy = b.from.y - a.from.y;
  const t = (dx * v.y - dy * v.x) / den;
  const s = (dx * u.y - dy * u.x) / den;
  if (t < 0 || s < 0) return undefined;
  return { x: a.from.x + u.x * t, y: a.from.y + u.y * t };
}

/** The cursor on the tracking paths near it, or undefined when it is near none. */
export function trackCursor(p: Vec2, o: TrackOptions): TrackLock | undefined {
  return lockOnto(p, trackPaths(o), o.tolerance);
}

function lockOnto(p: Vec2, paths: readonly TrackPath[], tolerance: number): TrackLock | undefined {
  const near: Near[] = [];
  for (const path of paths) {
    const u = unit(path.angle);
    const dx = p.x - path.from.x;
    const dy = p.y - path.from.y;
    const along = dx * u.x + dy * u.y;
    if (along <= 0) continue;
    const off = Math.abs(dx * u.y - dy * u.x);
    if (off > tolerance) continue;
    near.push({ path, off, point: { x: path.from.x + u.x * along, y: path.from.y + u.y * along } });
  }
  if (near.length === 0) return undefined;
  near.sort((a, b) => a.off - b.off);
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i]!.path;
      const b = near[j]!.path;
      // Two paths from one point cross there, behind the cursor: no crossing to go to.
      if (a.from.x === b.from.x && a.from.y === b.from.y) continue;
      const x = crossing(a, b);
      if (x && Math.hypot(x.x - p.x, x.y - p.y) <= 2 * tolerance) {
        return { point: x, paths: [a, b] };
      }
    }
  }
  const best = near[0]!;
  return { point: best.point, paths: [best.path] };
}

/**
 * The crossing of an acquired point's path with ORTHO's axis from `base`: ORTHO keeps the
 * cursor on the axis, and OTRACK says where along it. Undefined when no path is near.
 */
export function orthoTrack(
  base: Vec2,
  axis: number,
  p: Vec2,
  acquired: readonly Acquired[],
  tolerance: number,
): TrackLock | undefined {
  const lock = lockOnto(p, trackPaths({ acquired }), tolerance);
  if (!lock) return undefined;
  const ortho: TrackPath = { from: base, angle: axis, label: 'Ortho' };
  for (const path of lock.paths) {
    const x = crossing(ortho, path);
    if (x) return { point: x, paths: [ortho, path] };
  }
  return undefined;
}

const degrees = (a: number): string => {
  const d = (a * 180) / Math.PI;
  return Math.abs(d - Math.round(d)) < 1e-6 ? String(Math.round(d) % 360) : d.toFixed(2);
};

/**
 * The tracking tooltip, as AutoCAD words it: "Endpoint: 60.0000 < 90°" along one path (the
 * distance from where it starts), "Endpoint: < 90°, Polar: < 0°" where two cross.
 */
export function trackLabel(lock: TrackLock, precision = 4): string {
  if (lock.paths.length === 1) {
    const path = lock.paths[0]!;
    const d = Math.hypot(lock.point.x - path.from.x, lock.point.y - path.from.y);
    return `${path.label}: ${d.toFixed(precision)} < ${degrees(path.angle)}°`;
  }
  return lock.paths.map((path) => `${path.label}: < ${degrees(path.angle)}°`).join(', ');
}
