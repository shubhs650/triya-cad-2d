// M1-66: pieces of a wide polyline segment, so a linetype can be drawn on it. A dash on a wide
// segment is the part of the segment's (tapered, mitred) outline between two distances along
// its centre line; a dot is the cut across the segment at one distance.
import { describe, expect, it } from 'vitest';
import {
  wideCross,
  wideOutlines,
  widePiece,
  wideSegments,
  type Vec2,
  type WideVertex,
} from '../../src/index';

const wv = (x: number, y: number, w = 0, bulge = 0, endWidth = w): WideVertex => ({
  x,
  y,
  bulge,
  startWidth: w,
  endWidth,
});

function expectPolygon(actual: readonly Vec2[] | undefined, expected: readonly Vec2[]): void {
  expect(actual).toBeDefined();
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

describe('wideSegments', () => {
  it('lists every segment in order with its centre line and length', () => {
    const s = wideSegments([wv(0, 0, 2), wv(10, 0, 0), wv(10, 5, 0), wv(10, 5)], false);
    expect(s.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(s.map((x) => x.length)).toEqual([10, 5, 0]);
    expect(s[0]!.wide).toBe(true);
    // Zero width at both ends: the thin line. Zero length: nothing to draw.
    expect(s[1]!.wide).toBe(false);
    expect(s[2]!.wide).toBe(false);
    expect(s[1]!.centre).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it('closes back to the first vertex', () => {
    const s = wideSegments([wv(0, 0, 1), wv(4, 0, 1), wv(4, 3, 1)], true);
    expect(s.map((x) => x.length)).toEqual([4, 3, 5]);
  });

  it('flattens a bulge arc into a centre line as long as its chords', () => {
    const [s] = wideSegments([wv(0, 0, 2, 1), wv(10, 0)], false);
    expect(s!.centre.length).toBeGreaterThan(50);
    // Chords run inside the arc, within 1e-4 of the radius.
    expect(Math.abs(s!.length - 5 * Math.PI)).toBeLessThan(5e-4 * 5 * Math.PI);
  });
});

describe('widePiece', () => {
  it('gives the whole outline from 0 to the segment length, as wideOutlines does', () => {
    const vs = [wv(0, 0, 2), wv(10, 0, 2, 0.5), wv(10, 10, 1, 0, 3), wv(0, 10)];
    const segments = wideSegments(vs, true);
    const { fills } = wideOutlines(vs, true);
    const pieces = segments.filter((s) => s.wide).map((s) => widePiece(s, 0, s.length));
    expect(pieces).toEqual(fills);
  });

  it('cuts a constant-width line square across', () => {
    const [s] = wideSegments([wv(0, 0, 2), wv(10, 0, 2)], false);
    expectPolygon(widePiece(s!, 2, 5), [
      { x: 2, y: -1 },
      { x: 5, y: -1 },
      { x: 5, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('follows the taper', () => {
    const [s] = wideSegments([wv(0, 0, 0, 0, 4), wv(10, 0)], false);
    expectPolygon(widePiece(s!, 5, 10), [
      { x: 5, y: -1 },
      { x: 10, y: -2 },
      { x: 10, y: 2 },
      { x: 5, y: 1 },
    ]);
  });

  it('keeps the mitre on a piece that reaches the vertex, and cuts square short of it', () => {
    // An L of width 2: the outer edge meets at (11,-1), the inner at (9,1).
    const [s] = wideSegments([wv(0, 0, 2), wv(10, 0, 2), wv(10, 10, 2)], false);
    expectPolygon(widePiece(s!, 8, 10), [
      { x: 8, y: -1 },
      { x: 11, y: -1 },
      { x: 9, y: 1 },
      { x: 8, y: 1 },
    ]);
    expectPolygon(widePiece(s!, 0, 3), [
      { x: 0, y: -1 },
      { x: 3, y: -1 },
      { x: 3, y: 1 },
      { x: 0, y: 1 },
    ]);
  });

  it('cuts a bulge arc along its radius, with the arc samples in between', () => {
    // Bulge 1 from (0,0) to (10,0): a half circle about (5,0) through (5,-5).
    const [s] = wideSegments([wv(0, 0, 2, 1), wv(10, 0, 2)], false);
    const half = s!.length / 2;
    const p = widePiece(s!, half, s!.length);
    // From the cut at the bottom of the arc to the end at (10,0), each edge at radius 4 or 6.
    for (const q of p) {
      const r = Math.hypot(q.x - 5, q.y);
      expect(Math.min(Math.abs(r - 4), Math.abs(r - 6))).toBeLessThan(1e-3);
      expect(q.x).toBeGreaterThan(5 - 1e-9);
    }
    expect(p.some((q) => Math.abs(q.x - 11) < 1e-9 && Math.abs(q.y) < 1e-9)).toBe(true);
    expect(p.some((q) => Math.abs(q.x - 5) < 1e-6 && Math.abs(q.y + 6) < 1e-6)).toBe(true);
  });

  it('is counter-clockwise on a clockwise segment', () => {
    const [s] = wideSegments([wv(10, 0, 2), wv(0, 0, 2)], false);
    const p = widePiece(s!, 1, 4);
    let a = 0;
    p.forEach((q, i) => {
      const r = p[(i + 1) % p.length]!;
      a += q.x * r.y - r.x * q.y;
    });
    expect(a / 2).toBeCloseTo(6, 9);
  });

  it('clamps distances to the segment', () => {
    const [s] = wideSegments([wv(0, 0, 2), wv(10, 0, 2)], false);
    expect(widePiece(s!, -1, 20)).toEqual(widePiece(s!, 0, 10));
  });

  it('has no piece on a thin segment', () => {
    const [s] = wideSegments([wv(0, 0), wv(10, 0)], false);
    expect(widePiece(s!, 0, 5)).toEqual([]);
  });
});

describe('wideCross', () => {
  it('is the cut across the segment at a distance, at the width there', () => {
    const [s] = wideSegments([wv(0, 0, 0, 0, 4), wv(10, 0)], false);
    const c = wideCross(s!, 5)!;
    expect(c[0].x).toBeCloseTo(5, 12);
    expect(c[1].x).toBeCloseTo(5, 12);
    expect(Math.abs(c[0].y - c[1].y)).toBeCloseTo(2, 12);
  });

  it('is undefined on a thin segment', () => {
    const [s] = wideSegments([wv(0, 0), wv(10, 0)], false);
    expect(wideCross(s!, 5)).toBeUndefined();
  });
});
