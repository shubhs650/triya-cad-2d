// Pattern fitting (M1-13): AutoCAD's A-type alignment, worked out by hand for each case.
import type { Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  dashPath,
  dashPolyline,
  parseLin,
  type DashedPath,
  type LinePattern,
} from '../../src/index';

const pattern = (src: string): LinePattern => {
  const f = parseLin(src);
  expect(f.errors).toEqual([]);
  return f.linetypes[0]!;
};
const DASHED = pattern('*DASHED\nA,.5,-.25');
const DOTS = pattern('*DOTS\nA,0,-.25');

const along = (x: number): Vec2 => ({ x, y: 0 });
/** Each run as [start x, end x] for paths along the x axis. */
const runs = (d: DashedPath) => d.dashes.map((r) => [r[0]!.x, r[r.length - 1]!.x]);
const close = (a: number[][], b: number[][]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(b[i]![j]!, 12)));
};

describe('dashPath on a line', () => {
  it('centres the pattern so half of the first dash starts and ends the line', () => {
    const d = dashPath([along(0), along(3)], DASHED, 1);
    expect(d.solid).toBe(false);
    close(runs(d), [
      [0, 0.25],
      [0.5, 1],
      [1.25, 1.75],
      [2, 2.5],
      [2.75, 3],
    ]);
  });

  it('lengthens the end dashes by half the leftover each', () => {
    const d = dashPath([along(0), along(3.3)], DASHED, 1);
    close(runs(d), [
      [0, 0.4],
      [0.65, 1.15],
      [1.4, 1.9],
      [2.15, 2.65],
      [2.9, 3.3],
    ]);
  });

  it('draws a line shorter than one pattern continuous, and one exactly as long dashed', () => {
    expect(dashPath([along(0), along(0.7)], DASHED, 1)).toMatchObject({ solid: true });
    close(runs(dashPath([along(0), along(0.75)], DASHED, 1)), [
      [0, 0.25],
      [0.5, 0.75],
    ]);
  });

  it('applies the scale to every length', () => {
    const d = dashPath([along(0), along(6)], DASHED, 2);
    close(runs(d), [
      [0, 0.5],
      [1, 2],
      [2.5, 3.5],
      [4, 5],
      [5.5, 6],
    ]);
  });

  it('draws dots, including at both ends when the pattern starts with one', () => {
    const d = dashPath([along(0), along(1)], DOTS, 1);
    expect(d.dashes).toEqual([]);
    d.dots.forEach((p, i) => expect(p.x).toBeCloseTo(i * 0.25, 12));
    expect(d.dots).toHaveLength(5);
  });

  it('draws solid when one pattern is under a pixel (LOD) or there is no pattern', () => {
    expect(dashPath([along(0), along(10)], DASHED, 1, { pixelsPerUnit: 1 }).solid).toBe(true);
    expect(dashPath([along(0), along(10)], DASHED, 1, { pixelsPerUnit: 2 }).solid).toBe(false);
    const continuous: LinePattern = { name: 'CONTINUOUS', description: '', elements: [] };
    expect(dashPath([along(0), along(10)], continuous, 1)).toEqual({
      solid: true,
      dashes: [[along(0), along(10)]],
      dots: [],
      embeds: [],
      spans: [[0, 10]],
      dotsAt: [],
    });
  });
});

describe('dashPath on polylines and closed paths', () => {
  const corner = [along(0), along(1), { x: 1, y: 1 }];

  it('carries the pattern through a vertex with PLINEGEN on', () => {
    const d = dashPolyline([corner.slice(0, 2), corner.slice(1)], DASHED, 1, { plinegen: true });
    expect(d.dashes).toEqual([
      [along(0), along(0.5)],
      [along(0.75), along(1), { x: 1, y: 0.25 }],
      [
        { x: 1, y: 0.5 },
        { x: 1, y: 1 },
      ],
    ]);
  });

  it('starts and ends each segment with a dash with PLINEGEN off', () => {
    const d = dashPolyline([corner.slice(0, 2), corner.slice(1)], DASHED, 1, { plinegen: false });
    expect(d.dashes).toHaveLength(4);
    close(runs({ ...d, dashes: d.dashes.slice(0, 2) }), [
      [0, 0.375],
      [0.625, 1],
    ]);
    expect(d.dashes[2]![0]).toEqual({ x: 1, y: 0 });
    expect(d.dashes[3]![1]).toEqual({ x: 1, y: 1 });
  });

  it('joins the end and start dashes of a closed path into one across the start point', () => {
    const square = [along(0), along(1), { x: 1, y: 1 }, { x: 0, y: 1 }];
    const d = dashPath(square, DASHED, 1, { closed: true });
    // L = 4: five periods with 0.25 left over, so the dash at the start point is 0.75 long.
    expect(d.dashes).toHaveLength(5);
    const joint = d.dashes[0]!;
    expect(joint[0]!.x).toBeCloseTo(0, 12);
    expect(joint[0]!.y).toBeCloseTo(0.375, 12);
    expect(joint[1]).toEqual({ x: 0, y: 0 });
    expect(joint[2]!.x).toBeCloseTo(0.375, 12);
    expect(joint[2]!.y).toBe(0);
  });

  it('dashes a closed polyline continuously with PLINEGEN on', () => {
    const sides = [
      [along(0), along(1)],
      [along(1), { x: 1, y: 1 }],
      [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      [{ x: 0, y: 1 }, along(0)],
    ];
    const d = dashPolyline(sides, DASHED, 1, { plinegen: true, closed: true });
    expect(d.dashes).toHaveLength(5);
  });
});

describe('spans along the path (M1-66)', () => {
  const corner = [along(0), along(1), { x: 1, y: 1 }];

  it('gives each dash as its start and end distance, and each dot as a distance', () => {
    const d = dashPath([along(0), along(3)], DASHED, 1);
    expect(d.spans).toHaveLength(d.dashes.length);
    d.spans.forEach(([a, b], i) => {
      expect(a).toBeCloseTo(d.dashes[i]![0]!.x, 12);
      expect(b).toBeCloseTo(d.dashes[i]!.at(-1)!.x, 12);
    });
    const dots = dashPath([along(0), along(1)], DOTS, 1);
    expect(dots.dotsAt.map((s) => s)).toEqual(dots.dots.map((p) => p.x));
  });

  it('spans a continuous path end to end', () => {
    expect(dashPath([along(0), along(0.5)], DASHED, 1).spans).toEqual([[0, 0.5]]);
    expect(dashPath([along(0), along(0)], DASHED, 1).spans).toEqual([]);
  });

  it('splits the joint dash of a closed path at the start point', () => {
    const square = [along(0), along(1), { x: 1, y: 1 }, { x: 0, y: 1 }];
    const d = dashPath(square, DASHED, 1, { closed: true });
    expect(d.spans).toHaveLength(6);
    expect(d.spans[0]![0]).toBeCloseTo(3.625, 12);
    expect(d.spans[0]![1]).toBeCloseTo(4, 12);
    expect(d.spans[1]![0]).toBe(0);
    expect(d.spans[1]![1]).toBeCloseTo(0.375, 12);
  });

  it('measures PLINEGEN off spans along the whole polyline', () => {
    const d = dashPolyline([corner.slice(0, 2), corner.slice(1)], DASHED, 1, { plinegen: false });
    close(
      d.spans.map((s) => [...s]),
      [
        [0, 0.375],
        [0.625, 1],
        [1, 1.375],
        [1.625, 2],
      ],
    );
    const on = dashPolyline([corner.slice(0, 2), corner.slice(1)], DASHED, 1, { plinegen: true });
    close(
      on.spans.map((s) => [...s]),
      [
        [0, 0.5],
        [0.75, 1.25],
        [1.5, 2],
      ],
    );
  });
});

describe('embedded text and shapes', () => {
  const GAS = pattern('*GAS\nA,.5,-.2,["GAS",STANDARD,S=.1,R=0,X=-0.1,Y=-.05],-.25');

  it('places each at the end of its element, offset along and across the line', () => {
    // P = 0.95 and L = 1.9: two periods; the gaps holding the text end at 0.45 and 1.4.
    const d = dashPath([along(0), along(1.9)], GAS, 1);
    expect(d.embeds.map((e) => [e.at.x, e.at.y, e.angle, e.scale])).toEqual([
      [expect.closeTo(0.35, 12), -0.05, 0, 0.1],
      [expect.closeTo(1.3, 12), -0.05, 0, 0.1],
    ]);
  });

  it('turns relative text with the line, keeps absolute text fixed, and rights upright text', () => {
    const backwards = [along(1.9), along(0)];
    const rel = dashPath(backwards, GAS, 1).embeds[0]!;
    expect(rel.angle).toBeCloseTo(Math.PI, 12);
    // X = -0.1 is along the line, which now runs towards −x; Y = -0.05 is to its right.
    expect(rel.at.x).toBeCloseTo(1.9 - 0.45 + 0.1, 12);
    expect(rel.at.y).toBeCloseTo(0.05, 12);

    const up = pattern('*UP\nA,.5,-.2,["GAS",STANDARD,U=0],-.25');
    expect(dashPath(backwards, up, 1).embeds[0]!.angle).toBeCloseTo(0, 12);
    const abs = pattern('*ABS\nA,.5,-.2,["GAS",STANDARD,A=30],-.25');
    expect(dashPath(backwards, abs, 1).embeds[0]!.angle).toBeCloseTo(Math.PI / 6, 12);
  });

  it('scales the offset and the size by the linetype scale', () => {
    const e = dashPath([along(0), along(3.8)], GAS, 2).embeds[0]!;
    expect(e.at.x).toBeCloseTo(0.9 - 0.2, 12);
    expect(e.at.y).toBeCloseTo(-0.1, 12);
    expect(e.scale).toBeCloseTo(0.2, 12);
  });
});
