// Gradient hatches (M1-16 part 2): each of AutoCAD's nine gradient names as a linear or radial
// ramp fitted to the boundary's extents in the gradient's frame, turned by its angle and
// shifted up and to the left when not centred.
import type { HatchGeometry, HatchLoop } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { gradientRamp, type GradientFrame } from '../src/index';

const box = (x0: number, y0: number, x1: number, y1: number): HatchLoop => ({
  flags: 2,
  polyline: {
    closed: true,
    vertices: [
      { x: x0, y: y0, bulge: 0 },
      { x: x1, y: y0, bulge: 0 },
      { x: x1, y: y1, bulge: 0 },
      { x: x0, y: y1, bulge: 0 },
    ],
  },
});
type Gradient = NonNullable<HatchGeometry['gradient']>;
const gradient = (name: string, extra: Partial<Gradient> = {}): Gradient => ({
  name,
  angle: 0,
  shift: 0,
  singleColor: false,
  tint: 0,
  colors: [
    { value: 0, color: { kind: 'rgb', r: 0, g: 0, b: 255 } },
    { value: 1, color: { kind: 'rgb', r: 255, g: 255, b: 0 } },
  ],
  ...extra,
});
/** The 0 × 4 by 0 × 2 box of most tests. */
const ramp = (name: string, extra: Partial<Gradient> = {}, loops = [box(0, 0, 4, 2)]) =>
  gradientRamp({ loops, gradient: gradient(name, extra) })!;
const at = (m: GradientFrame, x: number, y: number) => [
  Math.round((m.a * x + m.c * y + m.e) * 1e9) / 1e9 + 0,
  Math.round((m.b * x + m.d * y + m.f) * 1e9) / 1e9 + 0,
];

describe('gradientRamp', () => {
  it('runs LINEAR from colour 1 at the left of the extents to colour 2 at the right', () => {
    const r = ramp('LINEAR');
    expect(r.kind).toBe('linear');
    expect(at(r.frame, 0, 0)).toEqual([0, 0]);
    expect(at(r.frame, 1, 0)).toEqual([4, 0]);
    expect(r.stops).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('turns the ramp by the gradient angle, fitted to the extents in that frame', () => {
    // 90°: the ramp runs up the box, from the bottom edge to the top.
    const r = ramp('LINEAR', { angle: Math.PI / 2 });
    expect(at(r.frame, 0, 0)[1]).toBe(0);
    expect(at(r.frame, 1, 0)[1]).toBe(2);
    expect(at(r.frame, 1, 0)[0]).toBe(at(r.frame, 0, 0)[0]);
  });

  it('puts colour 2 along the middle of CYLINDER and colour 1 there for INVCYLINDER', () => {
    expect(ramp('CYLINDER').stops).toEqual([
      [0, 0],
      [0.5, 1],
      [1, 0],
    ]);
    expect(ramp('INVCYLINDER').stops).toEqual([
      [0, 1],
      [0.5, 0],
      [1, 1],
    ]);
  });

  it('centres SPHERICAL on the extents, reaching colour 1 at their corners', () => {
    const r = ramp('SPHERICAL');
    expect(r.kind).toBe('radial');
    expect(at(r.frame, 0, 0)).toEqual([2, 1]);
    expect(Math.hypot(r.frame.a, r.frame.b)).toBeCloseTo(Math.sqrt(5), 12);
    expect(r.stops).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(ramp('INVSPHERICAL').stops).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('anchors HEMISPHERICAL at the middle of the bottom edge', () => {
    const r = ramp('HEMISPHERICAL');
    expect(r.kind).toBe('radial');
    expect(at(r.frame, 0, 0)).toEqual([2, 0]);
    expect(Math.hypot(r.frame.a, r.frame.b)).toBeCloseTo(Math.hypot(2, 2), 12);
    expect(ramp('INVHEMISPHERICAL').stops[0]).toEqual([0, 0]);
  });

  it('curves CURVED from colour 2 at the bottom to colour 1 at the top', () => {
    const r = ramp('CURVED');
    expect(r.kind).toBe('linear');
    expect(at(r.frame, 0, 0)).toEqual([0, 0]);
    expect(at(r.frame, 1, 0)).toEqual([0, 2]);
    expect(r.stops[0]).toEqual([0, 1]);
    expect(r.stops.at(-1)).toEqual([1, 0]);
    // Parabolic: halfway up, three quarters of colour 2 remain.
    expect(r.stops.find(([t]) => t === 0.5)).toEqual([0.5, 0.75]);
    expect(ramp('INVCURVED').stops.find(([t]) => t === 0.5)).toEqual([0.5, 0.25]);
  });

  it('shifts a ramp that is not centred up and to the left by a quarter of the extents', () => {
    expect(at(ramp('SPHERICAL', { shift: 1 }).frame, 0, 0)).toEqual([1, 1.5]);
    expect(at(ramp('LINEAR', { shift: 1 }).frame, 0, 0)).toEqual([-1, 0]);
    expect(at(ramp('HEMISPHERICAL', { shift: 0.5 }).frame, 0, 0)).toEqual([1.5, 0.25]);
  });

  it('accepts the GR_ names and draws an unknown name as LINEAR', () => {
    expect(ramp('GR_SPHERICAL').kind).toBe('radial');
    expect(ramp('SOMETHING').stops).toEqual(ramp('LINEAR').stops);
  });

  it('gives no ramp for a boundary with no area', () => {
    expect(gradientRamp({ loops: [], gradient: gradient('LINEAR') })).toBeUndefined();
    expect(
      gradientRamp({ loops: [box(0, 0, 4, 0)], gradient: gradient('LINEAR') }),
    ).toBeUndefined();
  });
});
