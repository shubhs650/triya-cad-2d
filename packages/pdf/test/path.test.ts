import { describe, expect, it } from 'vitest';
import { ContentStream } from '../src/content';
import {
  IDENTITY,
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  emitSegments,
  pathSegments,
  subpathLength,
  subpaths,
  sweepOf,
  type Segment,
} from '../src/path';

const TAU = 2 * Math.PI;

/** A point of a cubic at t. */
function bez(x0: number, y0: number, s: Extract<Segment, { op: 'C' }>, t: number) {
  const u = 1 - t;
  return {
    x: u * u * u * x0 + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x,
    y: u * u * u * y0 + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y,
  };
}

/** The largest distance from `r` of the curves' points around (cx, cy). */
function radialError(segs: readonly Segment[], cx: number, cy: number, r: number): number {
  let worst = 0;
  let x = 0;
  let y = 0;
  for (const s of segs) {
    if (s.op === 'C') {
      for (let k = 0; k <= 20; k++) {
        const p = bez(x, y, s, k / 20);
        worst = Math.max(worst, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
      }
    }
    if (s.op !== 'Z') {
      x = s.x;
      y = s.y;
    }
  }
  return worst;
}

describe('sweepOf', () => {
  it('follows the canvas: wrapped into a turn, a whole turn when a turn apart', () => {
    expect(sweepOf(0, Math.PI / 2, true)).toBeCloseTo(Math.PI / 2);
    expect(sweepOf(Math.PI / 2, 0, true)).toBeCloseTo((3 * Math.PI) / 2);
    expect(sweepOf(0, TAU, true)).toBe(TAU);
    expect(sweepOf(0, 0, true)).toBe(0);
    expect(sweepOf(0, Math.PI / 2, false)).toBeCloseTo((-3 * Math.PI) / 2);
    expect(sweepOf(Math.PI / 2, 0, false)).toBeCloseTo(-Math.PI / 2);
    expect(sweepOf(TAU, 0, false)).toBe(-TAU);
  });
});

describe('pathSegments', () => {
  it('turns a full circle into four cubics within 3e-4 of the radius', () => {
    const segs = pathSegments([PATH_A, 10, 20, 5, 0, TAU, 1], IDENTITY);
    expect(segs.map((s) => s.op)).toEqual(['M', 'C', 'C', 'C', 'C']);
    expect(segs[0]).toEqual({ op: 'M', x: 15, y: 20 });
    const last = segs[4] as Extract<Segment, { op: 'C' }>;
    expect(last.x).toBeCloseTo(15, 12);
    expect(last.y).toBeCloseTo(20, 12);
    expect(radialError(segs, 10, 20, 5)).toBeLessThan(5 * 3e-4);
  });

  it('runs a clockwise arc (flag 0) the short way down', () => {
    const segs = pathSegments([PATH_A, 0, 0, 1, Math.PI / 2, 0, 0], IDENTITY);
    expect(segs).toHaveLength(2);
    const c = segs[1] as Extract<Segment, { op: 'C' }>;
    expect(c.x).toBeCloseTo(1);
    expect(c.y).toBeCloseTo(0);
    // Through the first quadrant, not the other three.
    expect(bez(0, 1, c, 0.5).x).toBeGreaterThan(0.6);
  });

  it('joins an arc to the current point with a line, as the canvas does', () => {
    const segs = pathSegments([PATH_M, 0, 0, PATH_A, 5, 0, 1, Math.PI, 0, 0], IDENTITY);
    expect(segs[1]!.op).toBe('L');
    expect((segs[1] as { x: number }).x).toBeCloseTo(4);
    expect((segs[1] as { y: number }).y).toBeCloseTo(0);
  });

  it('places an elliptical arc by its parameters and rotation', () => {
    const rot = Math.PI / 6;
    const segs = pathSegments([PATH_E, 1, 2, 4, 2, rot, 0, Math.PI, 1], IDENTITY);
    expect(segs.map((s) => s.op)).toEqual(['M', 'C', 'C']);
    const m = segs[0] as { x: number; y: number };
    expect(m.x).toBeCloseTo(1 + 4 * Math.cos(rot));
    expect(m.y).toBeCloseTo(2 + 4 * Math.sin(rot));
    const end = segs[2] as Extract<Segment, { op: 'C' }>;
    expect(end.x).toBeCloseTo(1 - 4 * Math.cos(rot));
    expect(end.y).toBeCloseTo(2 - 4 * Math.sin(rot));
    // The curve's middle is the minor axis' end: (−2 sin rot, 2 cos rot) from the centre.
    const mid = bez(m.x, m.y, segs[1] as Extract<Segment, { op: 'C' }>, 1);
    expect(mid.x).toBeCloseTo(1 - 2 * Math.sin(rot));
    expect(mid.y).toBeCloseTo(2 + 2 * Math.cos(rot));
  });

  it('raises quadratics to cubics exactly and keeps cubics', () => {
    const segs = pathSegments(
      [PATH_M, 0, 0, PATH_Q, 3, 3, 6, 0, PATH_C, 7, 1, 8, 1, 9, 0],
      IDENTITY,
    );
    expect(segs[1]).toEqual({ op: 'C', x1: 2, y1: 2, x2: 4, y2: 2, x: 6, y: 0 });
    expect(segs[2]).toEqual({ op: 'C', x1: 7, y1: 1, x2: 8, y2: 1, x: 9, y: 0 });
  });

  it('starts a subpath at a line or curve with no current point, and closes only open ones', () => {
    const segs = pathSegments([PATH_Z, PATH_L, 1, 1, PATH_L, 2, 1, PATH_Z], IDENTITY);
    expect(segs.map((s) => s.op)).toEqual(['M', 'L', 'Z']);
    expect(pathSegments([PATH_Q, 1, 1, 2, 0], IDENTITY)[0]).toEqual({ op: 'M', x: 1, y: 1 });
    expect(pathSegments([PATH_C, 1, 1, 2, 2, 3, 0], IDENTITY)[0]).toEqual({ op: 'M', x: 1, y: 1 });
    expect(() => pathSegments([99], IDENTITY)).toThrow('unknown path opcode');
  });

  it('maps every point, control points included, through the affine', () => {
    const m = { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 };
    const segs = pathSegments([PATH_M, 1, 1, PATH_C, 1, 2, 3, 4, 5, 6], m);
    expect(segs).toEqual([
      { op: 'M', x: 12, y: 23 },
      { op: 'C', x1: 12, y1: 26, x2: 16, y2: 32, x: 20, y: 38 },
    ]);
  });
});

describe('subpaths and lengths', () => {
  it('splits at moves and measures lines, closes and curves; after a close the canvas starts anew', () => {
    const segs = pathSegments(
      [PATH_M, 0, 0, PATH_L, 3, 0, PATH_L, 3, 4, PATH_Z, PATH_A, 10, 0, 1, 0, TAU, 1],
      IDENTITY,
    );
    const subs = subpaths(segs);
    expect(subs).toHaveLength(2);
    expect(subpathLength(subs[0]!)).toBeCloseTo(12);
    // The arc joins the closed subpath's start, (0, 0), with a line to (11, 0).
    expect(subs[1]![0]).toEqual({ op: 'M', x: 0, y: 0 });
    expect(subpathLength(subs[1]!)).toBeCloseTo(11 + TAU, 2);
  });

  it('writes segments as m, l, c and h', () => {
    const cs = new ContentStream();
    emitSegments(
      cs,
      pathSegments([PATH_M, 0, 0, PATH_L, 1, 0, PATH_Q, 2, 0, 2, 1, PATH_Z], IDENTITY),
    );
    expect(cs.toString()).toBe('0 0 m\n1 0 l\n1.6667 0 2 0.3333 2 1 c\nh\n');
  });
});
