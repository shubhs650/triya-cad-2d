// M1-46: wide polyline segments as the filled outlines AutoCAD draws: start and end widths
// tapering along each segment (lines and bulge arcs), mitred where two wide segments meet.
import { describe, expect, it } from 'vitest';
import { wideOutlines, type Vec2, type WideVertex } from '../../src/index';

const wv = (x: number, y: number, w = 0, bulge = 0, endWidth = w): WideVertex => ({
  x,
  y,
  bulge,
  startWidth: w,
  endWidth,
});

function expectPolygon(actual: readonly Vec2[] | undefined, expected: readonly Vec2[]): void {
  expect(actual).toBeDefined();
  // Outlines are oriented counter-clockwise; compare as a cycle from the expected start.
  const start = actual!.findIndex(
    (p) => Math.abs(p.x - expected[0]!.x) < 1e-9 && Math.abs(p.y - expected[0]!.y) < 1e-9,
  );
  expect(
    start,
    `${JSON.stringify(expected[0])} in ${JSON.stringify(actual)}`,
  ).toBeGreaterThanOrEqual(0);
  const turned = [...actual!.slice(start), ...actual!.slice(0, start)];
  expect(turned).toHaveLength(expected.length);
  turned.forEach((p, i) => {
    expect(p.x, `x of ${i}`).toBeCloseTo(expected[i]!.x, 9);
    expect(p.y, `y of ${i}`).toBeCloseTo(expected[i]!.y, 9);
  });
}

const area = (pts: readonly Vec2[]): number => {
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  });
  return a / 2;
};

describe('wideOutlines', () => {
  it('mitres two wide line segments at their shared vertex', () => {
    // Width 2 along +x then +y: the outer corner at (11, −1), the inner one at (9, 1).
    const o = wideOutlines([wv(0, 0, 2), wv(10, 0, 2), wv(10, 10, 2)], false);
    expect(o.thin).toEqual([]);
    expect(o.fills).toHaveLength(2);
    expectPolygon(o.fills[0], [
      { x: 0, y: -1 },
      { x: 11, y: -1 },
      { x: 9, y: 1 },
      { x: 0, y: 1 },
    ]);
    expectPolygon(o.fills[1], [
      { x: 11, y: -1 },
      { x: 11, y: 10 },
      { x: 9, y: 10 },
      { x: 9, y: 1 },
    ]);
  });

  it('tapers a segment from its start width to its end width', () => {
    const o = wideOutlines([wv(0, 0, 4, 0, 0), wv(10, 0)], false);
    expectPolygon(o.fills[0], [
      { x: 0, y: -2 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 2 },
    ]);
  });

  it('leaves zero-width segments to the thin line, with square ends where they meet', () => {
    // An arrow: a thin shaft, then a head 2 wide tapering to its point.
    const o = wideOutlines([wv(0, 0), wv(10, 0, 2, 0, 0), wv(12, 0)], false);
    expect(o.thin).toEqual([0]);
    expect(o.fills).toHaveLength(1);
    expectPolygon(o.fills[0], [
      { x: 10, y: -1 },
      { x: 12, y: 0 },
      { x: 12, y: 0 },
      { x: 10, y: 1 },
    ]);
  });

  it('mitres every corner of a closed polyline, the last to the first too', () => {
    const o = wideOutlines([wv(0, 0, 2), wv(10, 0, 2), wv(10, 10, 2), wv(0, 10, 2)], true);
    expect(o.fills).toHaveLength(4);
    expectPolygon(o.fills[0], [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 9, y: 1 },
      { x: 1, y: 1 },
    ]);
    // The four outlines cover the square ring exactly: 12² − 8².
    const total = o.fills.reduce((s, f) => s + area(f), 0);
    expect(total).toBeCloseTo(144 - 64, 9);
  });

  it('draws a wide bulge arc between its inner and outer radii', () => {
    // A half circle of radius 5 about (5, 0), counter-clockwise (bulge 1), width 2.
    const o = wideOutlines([wv(0, 0, 2, 1), wv(10, 0)], false);
    const f = o.fills[0]!;
    for (const p of f) {
      const r = Math.hypot(p.x - 5, p.y);
      expect(r).toBeGreaterThanOrEqual(4 - 1e-9);
      expect(r).toBeLessThanOrEqual(6 + 1e-9);
    }
    // Half the annulus between 4 and 6, to within the flattening.
    expect(area(f)).toBeCloseTo((Math.PI * (36 - 16)) / 2, 2);
    expect(area(f)).toBeGreaterThan(0);
  });

  it('tapers along an arc by its angle', () => {
    // Bulge 1: counter-clockwise from (0, 0) to (10, 0), the lower half circle; width 4 → 0.
    const o = wideOutlines([wv(0, 0, 4, 1, 0), wv(10, 0)], false);
    for (const p of o.fills[0]!) {
      // Fraction of the way round from the start (angle π) to the end (2π).
      const angle = Math.atan2(p.y, p.x - 5);
      const t = (angle < 0 ? angle + 2 * Math.PI : angle) / Math.PI - 1;
      const along = p.x === 10 && p.y === 0 ? 1 : Math.min(Math.max(t, 0), 1);
      expect(Math.abs(Math.hypot(p.x - 5, p.y) - 5)).toBeCloseTo(2 * (1 - along), 9);
    }
  });

  it('mitres segments of different widths along their edges', () => {
    const o = wideOutlines([wv(0, 0, 2), wv(10, 0, 4), wv(10, 10, 4)], false);
    // Edge y = −1 of the first meets edge x = 12 of the second; y = 1 meets x = 8.
    expect(o.fills[0]).toContainEqual({ x: 12, y: -1 });
    expect(o.fills[0]).toContainEqual({ x: 8, y: 1 });
  });

  it('squares off a segment that doubles straight back, instead of a spike to infinity', () => {
    const o = wideOutlines([wv(0, 0, 2), wv(10, 0, 2), wv(0, 0, 2)], false);
    for (const f of o.fills)
      for (const p of f) {
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-9);
        expect(p.x).toBeLessThanOrEqual(10 + 1e-9);
      }
  });

  it('skips segments between coincident vertices', () => {
    const o = wideOutlines([wv(0, 0, 2), wv(0, 0, 2), wv(10, 0, 2)], false);
    expect(o.fills).toHaveLength(1);
    expect(o.thin).toEqual([]);
  });

  it('orients every outline counter-clockwise', () => {
    const o = wideOutlines([wv(0, 0, 2, -0.5), wv(10, 0, 2), wv(10, -10, 2), wv(0, 0, 2)], false);
    for (const f of o.fills) expect(area(f)).toBeGreaterThan(0);
  });
});
