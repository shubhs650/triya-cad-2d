// Isometric drafting (M3-06 part 2): isometric snap (SNAPSTYL 1), the isoplanes (SNAPISOPAIR,
// ISOPLANE, F5) and the isocircle. AutoCAD 2024 Help, "Set Isometric Grid and Snap", "ISOPLANE
// (Command)", "SNAPSTYL", "SNAPISOPAIR": the snap points lie at 30, 90 and 150 degrees from each
// other, the Y snap spacing apart; ORTHO keeps to the current isoplane's two axes (Left 90° and
// 150°, Top 30° and 150°, Right 30° and 90°); an isocircle is the circle of that plane seen in
// isometric, an ellipse whose radius along both axes is the one given.
import type { Vec2 } from '../geom/types';

/** SNAPISOPAIR's values: 0 Left, 1 Top, 2 Right. */
export type Isoplane = 0 | 1 | 2;

export const ISOPLANE_NAMES: readonly ['Left', 'Top', 'Right'] = ['Left', 'Top', 'Right'];

const DEG = Math.PI / 180;

/** The isoplane's two axis angles, radians. */
const AXES: Readonly<Record<Isoplane, readonly [number, number]>> = {
  0: [90 * DEG, 150 * DEG],
  1: [30 * DEG, 150 * DEG],
  2: [30 * DEG, 90 * DEG],
};

/** The isoplane's axis directions, unit vectors. */
export function isoplaneAxes(plane: Isoplane): readonly [Vec2, Vec2] {
  const [a, b] = AXES[plane];
  return [unit(a), unit(b)];
}

/** The isoplane after `plane`, as Enter at ISOPLANE and F5 step them: Left, Top, Right. */
export const nextIsoplane = (plane: Isoplane): Isoplane => ((plane + 1) % 3) as Isoplane;

/** A stored SNAPISOPAIR as an isoplane: anything else is Left, AutoCAD's initial value. */
export const isoplaneOf = (v: unknown): Isoplane => (v === 1 || v === 2 ? v : 0);

const COS30 = Math.cos(30 * DEG);

/**
 * Isometric SNAP: the nearest snap point to `p`, the snap points being `base` plus whole steps
 * of `spacing` along 90° and 30° (and so 150°): a triangular lattice with sides `spacing` long.
 */
export function isoSnap(p: Vec2, spacing: number, base: Vec2 = { x: 0, y: 0 }): Vec2 {
  if (!(spacing > 0)) return p;
  // p − base = a·(cos 30°, sin 30°)·s + b·(0, 1)·s
  const a = (p.x - base.x) / (COS30 * spacing);
  const b = (p.y - base.y) / spacing - a / 2;
  let best = p;
  let bestD = Infinity;
  // The lattice's cells have 60° corners, so the nearest point is one of the cell's four.
  for (const i of [Math.floor(a), Math.ceil(a)])
    for (const j of [Math.floor(b), Math.ceil(b)]) {
      const q = {
        x: +(base.x + i * COS30 * spacing).toPrecision(15),
        y: +(base.y + (i / 2 + j) * spacing).toPrecision(15),
      };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
  return best;
}

/** Isometric ORTHO: along the isoplane's axis the cursor is nearer to, from `base`. */
export function isoOrthoPoint(base: Vec2, p: Vec2, plane: Isoplane): Vec2 {
  const d = { x: p.x - base.x, y: p.y - base.y };
  let best: Vec2 = base;
  let bestAlong = -1;
  for (const u of isoplaneAxes(plane)) {
    const along = d.x * u.x + d.y * u.y;
    if (Math.abs(along) <= bestAlong) continue;
    bestAlong = Math.abs(along);
    best = { x: base.x + along * u.x, y: base.y + along * u.y };
  }
  return best;
}

/**
 * The isocircle of `radius` about `center` on `plane`: the plane's circle drawn along its two
 * axes, an ellipse with semi-axes √(3/2)·r and √(1/2)·r, the major one at 0° on Top, 120° on
 * Left and 60° on Right (the bisector of the axes' obtuse angle). `axis` is the major semi-axis
 * and `other` the minor one's length, as `EllipseAxes` takes them.
 */
export function isocircleAxes(
  center: Vec2,
  radius: number,
  plane: Isoplane,
): { center: Vec2; axis: Vec2; other: number } {
  const major = ([120, 0, 60] as const)[plane] * DEG;
  const u = unit(major);
  const a = radius * Math.sqrt(1.5);
  return { center, axis: { x: a * u.x, y: a * u.y }, other: radius * Math.sqrt(0.5) };
}

function unit(angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Exact zeros on the axes, so 90° gives (0, 1) and a snapped point no stray 1e-17.
  return { x: Math.abs(c) < 1e-15 ? 0 : c, y: Math.abs(s) < 1e-15 ? 0 : s };
}
