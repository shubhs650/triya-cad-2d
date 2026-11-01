// Pattern hatches (M1-16): the families of parallel lines a HATCH stores (DXF 53/43–46/79/49,
// already scaled and rotated), clipped to its boundary loops by the island style, and dashed
// from each line's own origin.
import type { HatchEdge, HatchLoop, HatchPatternLine, Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { hatchPattern, loopSegments, type HatchInput } from '../src/index';

const square = (x0: number, y0: number, x1: number, y1: number): HatchLoop => ({
  flags: 1,
  edges: [
    { type: 'line', start: { x: x0, y: y0 }, end: { x: x1, y: y0 } },
    { type: 'line', start: { x: x1, y: y0 }, end: { x: x1, y: y1 } },
    { type: 'line', start: { x: x1, y: y1 }, end: { x: x0, y: y1 } },
    { type: 'line', start: { x: x0, y: y1 }, end: { x: x0, y: y0 } },
  ],
});
const polySquare = (x0: number, y0: number, x1: number, y1: number): HatchLoop => ({
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
const horizontal = (dashes: number[] = [], offset: Vec2 = { x: 0, y: 1 }): HatchPatternLine => ({
  angle: 0,
  base: { x: 0, y: 0 },
  offset,
  dashes,
});
const input = (loops: HatchLoop[], patternLines: HatchPatternLine[], style = 0): HatchInput => ({
  loops,
  patternLines,
  style,
});

/** The drawn segments as [x0, y0, x1, y1] rounded, sorted by y then x. */
function segs(r: ReturnType<typeof hatchPattern>): number[][] {
  if (r.kind !== 'lines') throw new Error(`expected lines, got ${r.kind}`);
  const out: number[][] = [];
  for (let i = 0; i < r.segments.length; i += 4)
    out.push([0, 1, 2, 3].map((k) => Math.round(r.segments[i + k]! * 1e9) / 1e9 + 0));
  return out.sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);
}
const onLine = (s: number[][], y: number) => s.filter((q) => q[1] === y).map((q) => [q[0], q[2]]);

describe('hatchPattern', () => {
  it('draws one family of continuous lines across the boundary', () => {
    const s = segs(hatchPattern(input([square(0, 0.5, 10, 10.5)], [horizontal()])));
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual([0, 1, 10, 1]);
    expect(s[9]).toEqual([0, 10, 10, 10]);
  });

  it('reads polyline loops the same as edge loops', () => {
    const a = segs(hatchPattern(input([square(0, 0.5, 10, 10.5)], [horizontal()])));
    const b = segs(hatchPattern(input([polySquare(0, 0.5, 10, 10.5)], [horizontal()])));
    expect(b).toEqual(a);
  });

  it('leaves islands alternately empty and hatched in the normal style', () => {
    const loops = [square(0, 0.5, 10, 10.5), square(2, 2.5, 8, 8.5), square(4, 4.5, 6, 6.5)];
    expect(onLine(segs(hatchPattern(input(loops, [horizontal()], 0))), 5)).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
    ]);
  });

  it('hatches only the outermost level in the outer style', () => {
    const loops = [square(0, 0.5, 10, 10.5), square(2, 2.5, 8, 8.5), square(4, 4.5, 6, 6.5)];
    expect(onLine(segs(hatchPattern(input(loops, [horizontal()], 1))), 5)).toEqual([
      [0, 2],
      [8, 10],
    ]);
  });

  it('hatches through islands in the ignore style', () => {
    const loops = [square(0, 0.5, 10, 10.5), square(2, 2.5, 8, 8.5)];
    expect(onLine(segs(hatchPattern(input(loops, [horizontal()], 2))), 5)).toEqual([[0, 10]]);
  });

  it('dashes each line from its own origin, shifted along the line by the offset', () => {
    // Dash 2, gap 1, measured from each line's origin: the base point plus n offsets, so the
    // line at y = n starts its pattern 0.5·n along (the offset's component along the line).
    const s = segs(
      hatchPattern(input([square(0, 0.5, 10, 2.5)], [horizontal([2, -1], { x: 0.5, y: 1 })])),
    );
    expect(onLine(s, 1)).toEqual([
      [0.5, 2.5],
      [3.5, 5.5],
      [6.5, 8.5],
      [9.5, 10],
    ]);
    expect(onLine(s, 2)).toEqual([
      [1, 3],
      [4, 6],
      [7, 9],
    ]);
  });

  it('places dots for zero-length dashes, inside the boundary only', () => {
    const r = hatchPattern(input([square(0.5, 0.5, 9.5, 1.5)], [horizontal([0, -1])]));
    if (r.kind !== 'lines') throw new Error('expected lines');
    const xs: number[] = [];
    for (let i = 0; i < r.dots.length; i += 2) xs.push(Math.round(r.dots[i]! * 1e9) / 1e9);
    expect(xs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.segments).toHaveLength(0);
  });

  it('turns the family with its angle and spaces it by the offset across the lines', () => {
    // 90°: vertical lines; offset (−1, 0) steps one unit across them.
    const r = hatchPattern(
      input(
        [square(0.5, 0, 3.5, 4)],
        [{ angle: Math.PI / 2, base: { x: 0, y: 0 }, offset: { x: -1, y: 0 }, dashes: [] }],
      ),
    );
    expect(segs(r).map((q) => q[0])).toEqual([1, 2, 3]);
    expect(segs(r)[0]).toEqual([1, 0, 1, 4]);
  });

  it('clips to arc, ellipse and bulge boundaries, either direction', () => {
    const circle = (ccw: boolean): HatchLoop => ({
      flags: 1,
      edges: [
        {
          type: 'arc',
          center: { x: 0, y: 0.25 },
          radius: 5,
          startAngle: 0,
          endAngle: 2 * Math.PI,
          ccw,
        },
      ],
    });
    const ellipse: HatchEdge = {
      type: 'ellipse',
      center: { x: 0, y: 0.25 },
      majorAxis: { x: 5, y: 0 },
      ratio: 0.5,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      ccw: false,
    };
    // A polyline of two half circles of radius 5 about (0, 0.25).
    const disc: HatchLoop = {
      flags: 2,
      polyline: {
        closed: true,
        vertices: [
          { x: -5, y: 0.25, bulge: -1 },
          { x: 5, y: 0.25, bulge: -1 },
        ],
      },
    };
    const lines = [horizontal([], { x: 0, y: 10 })];
    for (const loop of [circle(true), circle(false), disc]) {
      const [seg] = segs(hatchPattern(input([loop], lines)));
      // The chord at y = 0, 0.25 below the centre, flattened within 1e-4 of the radius.
      const half = Math.sqrt(25 - 0.0625);
      expect(seg![0]).toBeCloseTo(-half, 3);
      expect(seg![2]).toBeCloseTo(half, 3);
    }
    const [e] = segs(hatchPattern(input([{ flags: 1, edges: [ellipse] }], lines)));
    expect(e![2]).toBeCloseTo(5 * Math.sqrt(1 - (0.25 / 2.5) ** 2), 3);
  });

  it('gives up on a pattern denser than HPMAXLINES, as AutoCAD does', () => {
    // HPMAXLINES defaults to 1,000,000 lines; this one would need 10,000,000.
    const dense = input([square(0, 0, 10, 10)], [horizontal([], { x: 0, y: 1e-6 })]);
    expect(hatchPattern(dense).kind).toBe('too-dense');
    const ten = input([square(0, 0.5, 10, 10.5)], [horizontal()]);
    expect(hatchPattern(ten, { maxLines: 9 }).kind).toBe('too-dense');
    expect(hatchPattern(ten, { maxLines: 10 }).kind).toBe('lines');
  });

  it('draws nothing for a family with no spacing, or without loops', () => {
    const flat = horizontal([], { x: 1, y: 0 });
    expect(segs(hatchPattern(input([square(0, 0, 10, 10)], [flat])))).toEqual([]);
    expect(segs(hatchPattern(input([], [horizontal()])))).toEqual([]);
  });
});

describe('loopSegments', () => {
  it('closes an open polyline loop', () => {
    const open: HatchLoop = {
      ...polySquare(0, 0, 1, 1),
      polyline: { ...polySquare(0, 0, 1, 1).polyline!, closed: false },
    };
    expect(loopSegments(open).length / 4).toBe(4);
  });
});
