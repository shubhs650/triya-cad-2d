// Pattern hatches in the renderer (M1-16 part 1): the hatch's stored pattern lines clipped to
// its boundary (`@triya/hatch`), drawn as one stroke of dash segments and dots in the hatch's
// colour; a pattern denser than HPMAXLINES fills its area instead.
import type { HatchGeometry } from '@triya/engine';
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

  it('leaves gradient fills to part 2', () => {
    const gradient = hatch({
      solid: true,
      gradient: { name: 'LINEAR', angle: 0, shift: 0, singleColor: false, tint: 0, colors: [] },
    });
    expect(tessellate(gradient, { color: 'foreground' })).toEqual([]);
  });
});
