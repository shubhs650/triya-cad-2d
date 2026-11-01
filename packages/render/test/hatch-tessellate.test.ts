// Pattern hatches in the renderer (M1-16 part 1): the hatch's stored pattern lines clipped to
// its boundary (`@triya/hatch`), drawn as one stroke of dash segments and dots in the hatch's
// colour; a pattern denser than HPMAXLINES fills its area instead.
import type { HatchGeometry } from '@triya/engine';
import { gradientRamp } from '@triya/hatch';
import { describe, expect, it } from 'vitest';
import { PATH_L, PATH_M, tessellate, type RenderPrimitive } from '../src/index';

const hatch = (extra: Partial<HatchGeometry> = {}): HatchGeometry => ({
  kind: 'HATCH',
  pattern: 'ANSI31',
  solid: false,
  associative: false,
  style: 0,
  patternType: 1,
  patternAngle: 0,
  patternScale: 1,
  double: false,
  seedPoints: [],
  loops: [
    {
      flags: 1,
      edges: [
        { type: 'line', start: { x: 0, y: 0.5 }, end: { x: 4, y: 0.5 } },
        { type: 'line', start: { x: 4, y: 0.5 }, end: { x: 4, y: 3.5 } },
        { type: 'line', start: { x: 4, y: 3.5 }, end: { x: 0, y: 3.5 } },
        { type: 'line', start: { x: 0, y: 3.5 }, end: { x: 0, y: 0.5 } },
      ],
    },
  ],
  patternLines: [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 1 }, dashes: [] }],
  ...extra,
});
const path = (p: RenderPrimitive | undefined): readonly number[] =>
  p && 'path' in p ? p.path : [];

describe('pattern hatches', () => {
  it('draws the clipped pattern lines as one stroke in the hatch colour', () => {
    const prims = tessellate(hatch(), { color: '#ff0000', lineweight: 0.25 });
    expect(prims).toHaveLength(1);
    expect(prims[0]).toMatchObject({ kind: 'stroke', color: '#ff0000', lineweight: 0.25 });
    expect(path(prims[0])).toEqual([
      PATH_M,
      0,
      1,
      PATH_L,
      4,
      1,
      PATH_M,
      0,
      2,
      PATH_L,
      4,
      2,
      PATH_M,
      0,
      3,
      PATH_L,
      4,
      3,
    ]);
  });

  it('draws dots as zero-length segments', () => {
    const dotted = hatch({
      patternLines: [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 1 }, dashes: [0, -2] }],
    });
    const p = path(tessellate(dotted, { color: 'foreground' })[0]);
    expect(p.slice(0, 6)).toEqual([PATH_M, 0, 1, PATH_L, 0, 1]);
  });

  it('keeps its own dashes: the hatch linetype does not dash the pattern', () => {
    // AutoCAD draws hatch pattern lines from the pattern definition; the HATCH's linetype
    // property does not apply to them.
    const dashed = tessellate(hatch(), {
      color: 'foreground',
      linetype: { pattern: { elements: [{ length: 0.5 }, { length: -0.25 }] } as never, scale: 1 },
    });
    expect(dashed).toHaveLength(1);
    expect(path(dashed[0])).toHaveLength(18);
    expect(dashed[0]).not.toHaveProperty('continuous');
  });

  it('fills the area of a pattern denser than HPMAXLINES', () => {
    const dense = hatch({
      patternLines: [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 1e-7 }, dashes: [] }],
    });
    expect(tessellate(dense, { color: '#00ff00' })[0]).toMatchObject({
      kind: 'fill',
      color: '#00ff00',
      evenOdd: true,
    });
  });

  it('draws each pattern family as its own stroke, with what its sub-pixel tint needs', () => {
    // Part 2: once a family's lines are under a pixel apart the renderer fills the area with
    // the family's average ink instead, so each stroke carries the area, spacing and dashes.
    const two = hatch({
      patternLines: [
        { angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 1 }, dashes: [1, -9] },
        { angle: Math.PI / 2, base: { x: 0, y: 0 }, offset: { x: -0.5, y: 0 }, dashes: [] },
      ],
    });
    const prims = tessellate(two, { color: '#ff0000' });
    expect(prims).toHaveLength(2);
    const area = tessellate(hatch({ solid: true }), { color: '#ff0000' })[0]!;
    expect(prims[0]).toMatchObject({
      kind: 'stroke',
      hatch: { spacing: 1, period: 10, dashLength: 1, marks: 1, evenOdd: true },
    });
    expect(prims[1]).toMatchObject({
      kind: 'stroke',
      hatch: { spacing: 0.5, period: 0, dashLength: 0, marks: 0 },
    });
    for (const p of prims) expect('hatch' in p && p.hatch?.area).toEqual(path(area));
  });
});

describe('gradient hatches', () => {
  type Gradient = NonNullable<HatchGeometry['gradient']>;
  const blue = { kind: 'rgb', r: 0, g: 0, b: 255 } as const;
  const gradient = (extra: Partial<Gradient> = {}): HatchGeometry =>
    hatch({
      solid: true,
      pattern: 'SOLID',
      gradient: {
        name: 'SPHERICAL',
        angle: 0,
        shift: 0,
        singleColor: false,
        tint: 0,
        colors: [
          { value: 0, color: blue },
          { value: 1, color: { kind: 'aci', index: 2 } },
        ],
        ...extra,
      },
    });

  it('fills the boundary with the ramp in the gradient’s own two colours', () => {
    const g = gradient();
    const [p, ...rest] = tessellate(g, { color: '#ff0000' });
    expect(rest).toEqual([]);
    const solid = tessellate(hatch({ solid: true }), { color: '#ff0000' })[0]!;
    // The hatch's own colour does not show; colour 1 also stands for the fill in the LOD dot.
    expect(p).toMatchObject({ kind: 'fill', color: '#0000ff', evenOdd: true, path: path(solid) });
    expect(p).toHaveProperty('gradient', {
      ...gradientRamp({ loops: g.loops, gradient: g.gradient! }),
      colors: ['#0000ff', '#ffff00'],
    });
  });

  it('keeps ACI 7 as the foreground, and a one-colour gradient’s tint', () => {
    const one = gradient({
      singleColor: true,
      tint: 0.25,
      colors: [{ value: 0, color: { kind: 'aci', index: 7 } }],
    });
    expect(tessellate(one, { color: '#ff0000' })[0]).toMatchObject({
      gradient: { colors: ['foreground', 'foreground'], tint: 0.25 },
    });
  });

  it('draws nothing for a gradient whose boundary has no area', () => {
    expect(tessellate({ ...gradient(), loops: [] }, { color: '#ff0000' })).toEqual([]);
  });
});
