// M4-07 part 4: a hatch's loops as the areas it fills (HATCHEDIT's separate Hatches), and the
// points on its loops an object of its boundary passes through.
import { describe, expect, it } from 'vitest';
import {
  hatchAreas,
  loopCurves,
  loopSamples,
  passesThrough,
  type HatchGeometry,
  type HatchLoop,
} from '../../src/index';

const p = (x: number, y: number) => ({ x, y });

/** A square loop of line edges. */
const square = (x: number, y: number, s: number, flags = 1): HatchLoop => ({
  flags,
  edges: [
    { type: 'line', start: p(x, y), end: p(x + s, y) },
    { type: 'line', start: p(x + s, y), end: p(x + s, y + s) },
    { type: 'line', start: p(x + s, y + s), end: p(x, y + s) },
    { type: 'line', start: p(x, y + s), end: p(x, y) },
  ],
});

/** A square polyline loop, one corner a bulge. */
const rounded = (x: number, y: number, s: number): HatchLoop => ({
  flags: 3,
  polyline: {
    closed: true,
    vertices: [
      { x, y, bulge: 0 },
      { x: x + s, y, bulge: 0.4 },
      { x: x + s, y: y + s, bulge: 0 },
      { x, y: y + s, bulge: 0 },
    ],
  },
});

const hatch = (loops: HatchLoop[], style = 0, seeds = [p(1, 1)]): HatchGeometry => ({
  kind: 'HATCH',
  pattern: 'SOLID',
  solid: true,
  associative: false,
  style,
  patternType: 1,
  patternAngle: 0,
  patternScale: 0,
  double: false,
  loops,
  patternLines: [],
  seedPoints: seeds,
});

describe('hatchAreas (M4-07 part 4)', () => {
  // A square with an island, an island in that, and a square beside them.
  const nested = [
    square(0, 0, 30),
    square(10, 10, 10, 16),
    square(13, 13, 4, 16),
    rounded(40, 0, 10),
  ];
  const seeds = [p(1, 1), p(15, 15), p(45, 5), p(100, 100)];

  it('makes an area of each outer loop and the islands directly in it (Normal)', () => {
    expect(hatchAreas(hatch(nested, 0, seeds))).toEqual([
      { loops: [0, 1], seeds: [0] },
      { loops: [2], seeds: [1] },
      { loops: [3], seeds: [2] },
    ]);
  });

  it('keeps everything inside an outermost loop in its area (Outer, Ignore)', () => {
    for (const style of [1, 2]) {
      expect(hatchAreas(hatch(nested, style, seeds))).toEqual([
        { loops: [0, 1, 2], seeds: [0, 1] },
        { loops: [3], seeds: [2] },
      ]);
    }
  });

  it('takes an island sharing an edge with its outer loop as inside it', () => {
    expect(hatchAreas(hatch([square(0, 0, 30), square(0, 0, 10, 16)]))).toEqual([
      { loops: [0, 1], seeds: [0] },
    ]);
  });

  it('has no areas without loops', () => {
    expect(hatchAreas(hatch([{ flags: 1, edges: [] }]))).toEqual([]);
  });
});

describe('loopSamples and passesThrough (M4-07 part 4)', () => {
  it('samples the middle of each edge and finds the curves through them', () => {
    const samples = loopSamples(square(0, 0, 10));
    expect(samples).toEqual([p(5, 0), p(10, 5), p(5, 10), p(0, 5)]);
    const tol = { linear: 1e-9, angular: 1e-9 };
    const through = { kind: 'LINE', start: p(-5, 0), end: p(20, 0) } as const;
    const across = { kind: 'LINE', start: p(0, 0), end: p(10, 10) } as const;
    expect(passesThrough([through], samples, tol)).toBe(true);
    expect(passesThrough([across], samples, tol)).toBe(false);
    // A curve with no geometry passes through nothing.
    expect(passesThrough([{ kind: 'LWPOLYLINE', closed: false, vertices: [] }], samples, tol)).toBe(
      false,
    );
  });

  it('gives a polyline loop whole, and none of a polyline without two vertices', () => {
    expect(loopCurves(rounded(0, 0, 1))).toHaveLength(1);
    expect(loopCurves({ flags: 2, polyline: { closed: true, vertices: [] } })).toEqual([]);
  });
});
