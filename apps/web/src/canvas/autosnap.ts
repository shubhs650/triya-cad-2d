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

/** The marker on the dark model canvas and on a layout's white paper. */
export const MARKER_COLOR = { dark: '#ffd400', light: '#b06d00' } as const;
export const TRACK_COLOR = { dark: '#7fd7ff', light: '#1060c0' } as const;

const LABEL = new Map(OSNAP_MODES.map((m) => [m.mode, m.label]));

/** The tooltip AutoSnap shows: the mode's name ("Endpoint"). */
export const snapLabel = (mode: OsnapMode): string => LABEL.get(mode) ?? mode;

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

export function markerPrimitives(
  mode: OsnapMode,
  p: Vec2,
  px: number,
  dark: boolean,
): RenderPrimitive[] {
  const color = dark ? MARKER_COLOR.dark : MARKER_COLOR.light;
  // The second outline a pixel inside the first (a hair larger for the open shapes).
  const inner = markerPath(mode, p, px * (1 - 1 / MARKER_PX));
  return [
    { kind: 'stroke', color, path: markerPath(mode, p, px) },
    { kind: 'stroke', color, path: inner },
  ];
}

/** Polar tracking's path: dashes from `base` along `angle`, `length` world units long. */
export function trackingPrimitives(
  base: Vec2,
  angle: number,
  length: number,
  px: number,
  dark: boolean,
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
  return [{ kind: 'stroke', color: dark ? TRACK_COLOR.dark : TRACK_COLOR.light, path }];
}

/** Acquired tracking points: AutoCAD's small cross at each (M2-04 part 2). */
export function acquiredPrimitives(
  points: readonly Vec2[],
  px: number,
  dark: boolean,
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
  return [{ kind: 'stroke', color: dark ? TRACK_COLOR.dark : TRACK_COLOR.light, path }];
}
