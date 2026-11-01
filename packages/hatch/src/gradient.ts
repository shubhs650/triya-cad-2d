// Gradient fills (M1-16 part 2, ARCHITECTURE.md §10): where a gradient HATCH's colours go,
// as a linear or radial ramp in a frame fitted to the boundary.
//
// What AutoCAD documents (Hatch and Gradient dialog, Gradient tab; GFANG, GFSHIFT, GFCLRLUM):
// nine fixed patterns ("linear sweep, spherical, and parabolic"), an angle relative to the
// UCS, and Centered: "a symmetrical gradient configuration. If this option is not selected, the
// gradient fill is shifted up and to the left, creating the illusion of a light source to the
// left of the object". DXF 461 blends the centred (0) and shifted (1) versions.
//
// It does not document the ramps, so these encode what the dialog's swatches show and drafters
// expect, to be checked against AutoCAD plots in the M1-16 acceptance (M1-24 with M1-26):
// - The ramp is fitted to the boundary's extents in the gradient's frame (turned by the angle).
// - LINEAR runs colour 1 → colour 2 left to right; CYLINDER is colour 1 at both sides and
//   colour 2 along the middle; SPHERICAL is colour 2 at the centre fading to colour 1 at the
//   extents' corners; HEMISPHERICAL is the same about the middle of the bottom edge; CURVED is
//   colour 2 along the bottom edge curving (parabolically) to colour 1 at the top. The INV
//   versions swap the two colours.
// - Shifting moves the ramp a quarter of the extents left (and up, for the radial and
//   bottom-anchored ramps), in the gradient's frame.

import type { HatchGeometry, HatchLoop } from '@triya/engine';
import { loopSegments } from './boundary';

/** A 2D affine map: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export interface GradientFrame {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface GradientRamp {
  /**
   * `linear`: the ramp runs along x from 0 to 1 of the unit frame; `radial`: from the unit
   * frame's origin (0) out to radius 1.
   */
  readonly kind: 'linear' | 'radial';
  /** Unit frame → drawing coordinates. */
  readonly frame: GradientFrame;
  /** [offset along the ramp, weight of colour 2], offsets ascending from 0 to 1. */
  readonly stops: readonly (readonly [offset: number, mix: number])[];
}

export interface GradientInput {
  readonly loops: readonly HatchLoop[];
  readonly gradient: NonNullable<HatchGeometry['gradient']>;
}

/** CURVED's parabolic ramp, sampled finely enough that the linear steps between stops blend. */
const CURVE_STOPS = 8;
const curve = (inverse: boolean): [number, number][] =>
  Array.from({ length: CURVE_STOPS + 1 }, (_, i) => {
    const t = i / CURVE_STOPS;
    const mix = 1 - t * t;
    return [t, inverse ? 1 - mix : mix];
  });

/** The ramp of a gradient hatch, or undefined when its boundary has no area to fill. */
export function gradientRamp(g: GradientInput): GradientRamp | undefined {
  const angle = g.gradient.angle;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Extents in the gradient's frame: u along the angle, v across it.
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const loop of g.loops) {
    const s = loopSegments(loop);
    for (let i = 0; i < s.length; i += 2) {
      const u = s[i]! * cos + s[i + 1]! * sin;
      const v = -s[i]! * sin + s[i + 1]! * cos;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  }
  const w = u1 - u0;
  const h = v1 - v0;
  if (!(w > 0 && h > 0)) return undefined;
  const shift = Math.min(Math.max(g.gradient.shift, 0), 1);
  const left = (shift * w) / 4;
  const up = (shift * h) / 4;

  // The frame in (u, v), then turned back by the angle.
  const name = g.gradient.name.toUpperCase().replace(/^GR_/, '');
  const inverse = name.startsWith('INV');
  const shape = inverse ? name.slice(3) : name;
  const swap = (stops: [number, number][]) =>
    inverse ? stops.map(([t, m]): [number, number] => [t, 1 - m]) : stops;
  let kind: GradientRamp['kind'];
  let local: GradientFrame;
  let stops: [number, number][];
  switch (shape) {
    case 'SPHERICAL': {
      const r = Math.hypot(w, h) / 2;
      kind = 'radial';
      local = { a: r, b: 0, c: 0, d: r, e: u0 + w / 2 - left, f: v0 + h / 2 + up };
      stops = swap([
        [0, 1],
        [1, 0],
      ]);
      break;
    }
    case 'HEMISPHERICAL': {
      const r = Math.hypot(w / 2, h);
      kind = 'radial';
      local = { a: r, b: 0, c: 0, d: r, e: u0 + w / 2 - left, f: v0 + up };
      stops = swap([
        [0, 1],
        [1, 0],
      ]);
      break;
    }
    case 'CURVED':
      // Along v, bottom to top: unit x → the height, unit y → the width.
      kind = 'linear';
      local = { a: 0, b: h, c: w, d: 0, e: u0, f: v0 + up };
      stops = curve(inverse);
      break;
    case 'CYLINDER':
      kind = 'linear';
      local = { a: w, b: 0, c: 0, d: h, e: u0 - left, f: v0 };
      stops = swap([
        [0, 0],
        [0.5, 1],
        [1, 0],
      ]);
      break;
    default:
      // LINEAR, and a name AutoCAD does not define, which it would not have saved.
      kind = 'linear';
      local = { a: w, b: 0, c: 0, d: h, e: u0 - left, f: v0 };
      stops = swap([
        [0, 0],
        [1, 1],
      ]);
  }
  // (u, v) → (x, y) = (u·cos − v·sin, u·sin + v·cos), after `local`.
  const frame: GradientFrame = {
    a: cos * local.a - sin * local.b,
    b: sin * local.a + cos * local.b,
    c: cos * local.c - sin * local.d,
    d: sin * local.c + cos * local.d,
    e: cos * local.e - sin * local.f,
    f: sin * local.e + cos * local.f,
  };
  return { kind, frame, stops };
}
