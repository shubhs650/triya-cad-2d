// AutoSnap (M2-04): the marker each object snap mode shows at its point, its tooltip, and the
// dashed path polar tracking shows, as transient primitives in world units sized in screen
// pixels. The shapes are AutoCAD's (AutoCAD 2024 Help, "Object Snap Markers"); the sizes are
// AutoCAD's defaults: APERTURE 10 px, a 5 px marker, the polar path within 10 px.
import { OSNAP_MODES, type OsnapMode, type Vec2 } from '@triya/engine';
import { PATH_A, PATH_L, PATH_M, PATH_Z, type RenderPrimitive } from '@triya/render';

/** APERTURE: how near, in CSS pixels, an object must be to the cursor to be snapped to. */
export const APERTURE_PX = 10;
/** Half the marker's size, CSS pixels. */
export const MARKER_PX = 5;
/** How near, in CSS pixels, the cursor must pass a polar angle for tracking to lock on. */
export const TRACK_PX = 10;
/**
 * How long the cursor rests on a point before it is acquired for tracking (M2-04 part 2).
 * AutoCAD says only "pause"; this is about the moment its acquisition marker appears.
 */
export const ACQUIRE_MS = 400;
/** Half the size of an acquired point's cross, CSS pixels. */
const ACQUIRED_PX = 4;
const DASH_PX = 4;

const LABEL = new Map(OSNAP_MODES.map((m) => [m.mode, m.label]));

/**
 * The tooltip AutoSnap shows: the mode's name ("Endpoint"); a TAN or PER the command solves
 * later is AutoCAD's "Deferred Tangent" or "Deferred Perpendicular" (M3-01 part 2).
 */
export const snapLabel = (mode: OsnapMode, deferred = false): string =>
  `${deferred ? 'Deferred ' : ''}${LABEL.get(mode) ?? mode}`;

function square(p: Vec2, s: number): number[] {
  return [
    PATH_M,
    p.x - s,
    p.y - s,
    PATH_L,
    p.x + s,
    p.y - s,
    PATH_L,
    p.x + s,
    p.y + s,
    PATH_L,
    p.x - s,
    p.y + s,
    PATH_Z,
  ];
}

const circle = (p: Vec2, s: number): number[] => [
  PATH_M,
  p.x + s,
  p.y,
  PATH_A,
  p.x,
  p.y,
  s,
  0,
  2 * Math.PI,
  1,
];

const cross = (p: Vec2, s: number): number[] => [
  PATH_M,
  p.x - s,
  p.y - s,
  PATH_L,
  p.x + s,
  p.y + s,
  PATH_M,
  p.x - s,
  p.y + s,
  PATH_L,
  p.x + s,
  p.y - s,
];

/**
 * The marker's outline for a mode at `p`; `px` is one CSS pixel in world units. Drawn twice,
 * a pixel apart, so it reads as AutoCAD's 2 px marker over any drawing.
 */
export function markerPath(mode: OsnapMode, p: Vec2, px: number): number[] {
  const s = MARKER_PX * px;
  switch (mode) {
    case 'END':
      return square(p, s);
    case 'MID':
      return [PATH_M, p.x - s, p.y - s, PATH_L, p.x + s, p.y - s, PATH_L, p.x, p.y + s, PATH_Z];
    case 'CEN':
      return circle(p, s);
    case 'GCE':
      return [...circle(p, s), ...cross(p, s * 0.5)];
    case 'NOD':
      return [...circle(p, s), ...cross(p, s * 0.7)];
    case 'QUA':
      return [
        PATH_M,
        p.x,
        p.y - s,
        PATH_L,
        p.x + s,
        p.y,
        PATH_L,
        p.x,
        p.y + s,
        PATH_L,
        p.x - s,
        p.y,
        PATH_Z,
      ];
    case 'INT':
      return cross(p, s);
    case 'APP':
      return [...square(p, s), ...cross(p, s)];
    case 'INS': {
      // Two squares stepped into each other.
      const h = s / 2;
      return [
        PATH_M,
        p.x - s,
        p.y + s,
        PATH_L,
        p.x + h,
        p.y + s,
        PATH_L,
        p.x + h,
        p.y + h,
        PATH_L,
        p.x + s,
        p.y + h,
        PATH_L,
        p.x + s,
        p.y - s,
        PATH_L,
        p.x - h,
        p.y - s,
        PATH_L,
        p.x - h,
        p.y - h,
        PATH_L,
        p.x - s,
        p.y - h,
        PATH_Z,
      ];
    }
    case 'PER':
      // A right angle on its base, its corner box.
      return [
        PATH_M,
        p.x - s,
        p.y + s,
        PATH_L,
        p.x - s,
        p.y - s,
        PATH_L,
        p.x + s,
        p.y - s,
        PATH_M,
        p.x - s,
        p.y,
        PATH_L,
        p.x,
        p.y,
        PATH_L,
        p.x,
        p.y - s,
      ];
    case 'TAN':
      return [
        ...circle(p, s * 0.8),
        PATH_M,
        p.x - s,
        p.y + s * 0.8,
        PATH_L,
        p.x + s,
        p.y + s * 0.8,
      ];
    case 'NEA':
      // An hourglass.
      return [
        PATH_M,
        p.x - s,
        p.y + s,
        PATH_L,
        p.x + s,
        p.y + s,
        PATH_L,
        p.x - s,
        p.y - s,
        PATH_L,
        p.x + s,
        p.y - s,
        PATH_Z,
      ];
    case 'EXT':
      return [
        PATH_M,
        p.x - s,
        p.y,
        PATH_L,
        p.x - s / 2,
        p.y,
        PATH_M,
        p.x + s / 2,
        p.y,
        PATH_L,
        p.x + s,
        p.y,
      ];
    case 'PAR':
      return [
        PATH_M,
        p.x - s,
        p.y - s,
        PATH_L,
        p.x,
        p.y + s,
        PATH_M,
        p.x,
        p.y - s,
        PATH_L,
        p.x + s,
        p.y + s,
      ];
  }
}

/**
 * A mode's marker as an SVG path in a box `2 × half` wide centred on the origin, y down: the
 * Drafting Settings dialog's Object Snap tab shows it beside the mode (M3-06 part 1), as
 * AutoCAD's does. The marker's circles are full circles, drawn as two half arcs.
 */
export function markerSvgPath(mode: OsnapMode, half: number): string {
  const p = markerPath(mode, { x: 0, y: 0 }, half / MARKER_PX);
  const n = (v: number) => +v.toFixed(3);
  const out: string[] = [];
  for (let i = 0; i < p.length;) {
    const op = p[i++];
    if (op === PATH_M || op === PATH_L) {
      out.push(`${op === PATH_M ? 'M' : 'L'}${n(p[i]!)} ${n(-p[i + 1]!)}`);
      i += 2;
    } else if (op === PATH_A) {
      const [cx, cy, r] = [p[i]!, -p[i + 1]!, p[i + 2]!];
      out.push(
        `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}` +
          `A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}`,
      );
      i += 6;
    } else {
      out.push('Z');
    }
  }
  return out.join('');
}

export function markerPrimitives(
  mode: OsnapMode,
  p: Vec2,
  px: number,
  color: string,
  deferred = false,
): RenderPrimitive[] {
  // The second outline a pixel inside the first (a hair larger for the open shapes).
  const inner = markerPath(mode, p, px * (1 - 1 / MARKER_PX));
  return [
    { kind: 'stroke', color, path: markerPath(mode, p, px) },
    { kind: 'stroke', color, path: inner },
    ...(deferred ? [{ kind: 'stroke' as const, color, path: ellipsis(p, px) }] : []),
  ];
}

/**
 * The three dots after a deferred marker (AutoCAD's Deferred Tangent marker is the Tangent
 * marker followed by an ellipsis), along its base line to the right.
 */
function ellipsis(p: Vec2, px: number): number[] {
  const s = MARKER_PX * px;
  const dot = px * 0.75;
  const out: number[] = [];
  for (let k = 0; k < 3; k++)
    out.push(...square({ x: p.x + s + px * (3 + 3 * k), y: p.y - s + dot }, dot));
  return out;
}

/** Polar tracking's path: dashes from `base` along `angle`, `length` world units long. */
export function trackingPrimitives(
  base: Vec2,
  angle: number,
  length: number,
  px: number,
  color: string,
): RenderPrimitive[] {
  const step = DASH_PX * px;
  const n = Math.min(Math.ceil(length / (2 * step)), 2000);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const path: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * i * step;
    const b = a + step;
    path.push(PATH_M, base.x + ux * a, base.y + uy * a, PATH_L, base.x + ux * b, base.y + uy * b);
  }
  return [{ kind: 'stroke', color, path }];
}

/** Acquired tracking points: AutoCAD's small cross at each (M2-04 part 2). */
export function acquiredPrimitives(
  points: readonly Vec2[],
  px: number,
  color: string,
): RenderPrimitive[] {
  if (points.length === 0) return [];
  const s = ACQUIRED_PX * px;
  const path: number[] = [];
  for (const p of points) {
    path.push(
      PATH_M,
      p.x - s,
      p.y,
      PATH_L,
      p.x + s,
      p.y,
      PATH_M,
      p.x,
      p.y - s,
      PATH_L,
      p.x,
      p.y + s,
    );
  }
  return [{ kind: 'stroke', color, path }];
}
