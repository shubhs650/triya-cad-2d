// M3-01 part 2: what deferred TANgent and PERpendicular picks solve to (geom/deferred.ts): LINE
// tangent or perpendicular at either end or both (AutoCAD's "line tangent to two circles"), and
// CIRCLE 3P with tangents (the ribbon's Tan, Tan, Tan), the one nearest the picks winning.
import { describe, expect, it } from 'vitest';
import {
  circleThrough3,
  circleThroughItems,
  lineBetween,
  toleranceForSize,
  type DeferredPick,
  type TangentTarget,
  type Vec2,
} from '../../src/geom/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];
const seg = (s: { start: Vec2; end: Vec2 } | undefined) => s && [pt(s.start), pt(s.end)];
const circ = (c: { center: Vec2; radius: number } | undefined) =>
  c && [r6(c.center.x), r6(c.center.y), r6(c.radius)];

const circle = (x: number, y: number, radius: number): TangentTarget => ({
  kind: 'circle',
  center: { x, y },
  radius,
});
const line = (x: number, y: number, dx: number, dy: number): TangentTarget => ({
  kind: 'line',
  point: { x, y },
  direction: { x: dx, y: dy },
});
const tan = (target: TangentTarget, x: number, y: number): DeferredPick => ({
  mode: 'TAN',
  target,
  pick: { x, y },
});
const per = (target: TangentTarget, x: number, y: number): DeferredPick => ({
  mode: 'PER',
  target,
  pick: { x, y },
});

/** The line from `s` to `e` touches the circle at `s` (the radius there is square to it). */
const tangentAt = (c: TangentTarget, p: Vec2, d: Vec2) =>
  c.kind === 'circle' &&
  Math.abs(Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius) < 1e-9 &&
  Math.abs((p.x - c.center.x) * d.x + (p.y - c.center.y) * d.y) < 1e-9 * Math.hypot(d.x, d.y);

describe('lineBetween', () => {
  it('draws a plain line between two points', () => {
    expect(seg(lineBetween({ x: 0, y: 0 }, { x: 3, y: 4 }, tol))).toEqual([
      [0, 0],
      [3, 4],
    ]);
  });

  it('starts tangent to a circle at the touching point nearer the pick', () => {
    const c = circle(0, 0, 5);
    expect(seg(lineBetween(tan(c, 2, 5), { x: 10, y: 0 }, tol))).toEqual([
      [2.5, 4.330127],
      [10, 0],
    ]);
    expect(seg(lineBetween(tan(c, 2, -5), { x: 10, y: 0 }, tol))).toEqual([
      [2.5, -4.330127],
      [10, 0],
    ]);
    // A deferred end second: the line from the point ends tangent.
    expect(seg(lineBetween({ x: 10, y: 0 }, tan(c, 2, 5), tol))).toEqual([
      [10, 0],
      [2.5, 4.330127],
    ]);
  });

  it('finds no tangent from inside the circle, and none to a line', () => {
    expect(lineBetween(tan(circle(0, 0, 5), 5, 0), { x: 1, y: 1 }, tol)).toBeUndefined();
    expect(lineBetween(tan(line(0, 0, 1, 0), 2, 0), { x: 1, y: 1 }, tol)).toBeUndefined();
  });

  it('starts perpendicular to a line (its extension too) or a circle', () => {
    expect(seg(lineBetween(per(line(0, 0, 1, 0), 1, 0), { x: 3, y: 4 }, tol))).toEqual([
      [3, 0],
      [3, 4],
    ]);
    expect(seg(lineBetween(per(line(0, 0, 1, 0), 1, 0), { x: -3, y: 4 }, tol))).toEqual([
      [-3, 0],
      [-3, 4],
    ]);
    // On a circle: the near or the far side of the line through its centre, by the pick.
    expect(seg(lineBetween(per(circle(0, 0, 5), -5, 0.1), { x: 10, y: 0 }, tol))).toEqual([
      [-5, 0],
      [10, 0],
    ]);
    expect(seg(lineBetween(per(circle(0, 0, 5), 5, 0.1), { x: 10, y: 0 }, tol))).toEqual([
      [5, 0],
      [10, 0],
    ]);
  });

  it('draws the outer or crossing tangent to two circles by where they were picked', () => {
    const a = circle(0, 0, 2);
    const b = circle(10, 0, 2);
    expect(seg(lineBetween(tan(a, 0, 2.1), tan(b, 10, 2.1), tol))).toEqual([
      [0, 2],
      [10, 2],
    ]);
    expect(seg(lineBetween(tan(a, 0.1, -2), tan(b, 9.9, -2), tol))).toEqual([
      [0, -2],
      [10, -2],
    ]);
    const cross = lineBetween(tan(a, 0.8, 1.8), tan(b, 9.2, -1.8), tol)!;
    const d = { x: cross.end.x - cross.start.x, y: cross.end.y - cross.start.y };
    expect(tangentAt(a, cross.start, d)).toBe(true);
    expect(tangentAt(b, cross.end, d)).toBe(true);
    // It crosses the line of centres between them, at the midpoint for equal circles.
    const t = -cross.start.y / d.y;
    expect(r6(cross.start.x + t * d.x)).toBe(5);
    expect(cross.start.y).toBeGreaterThan(0);
    expect(cross.end.y).toBeLessThan(0);
  });

  it('has no crossing tangent between overlapping circles, nor any for concentric ones', () => {
    const a = circle(0, 0, 3);
    const b = circle(4, 0, 3);
    const s = lineBetween(tan(a, 0, -3), tan(b, 4, 3), tol)!;
    // Only the outer tangents exist: the nearer one to the picks is drawn.
    expect(Math.abs(s.start.y)).toBeCloseTo(3, 9);
    expect(lineBetween(tan(circle(0, 0, 1), 1, 0), tan(circle(0, 0, 2), 2, 0), tol)).toBe(
      undefined,
    );
  });

  it('draws tangent to a circle and perpendicular to a line or circle', () => {
    expect(
      seg(lineBetween(tan(circle(0, 0, 1), 0, 1.1), per(line(5, 0, 0, 1), 5, 3), tol)),
    ).toEqual([
      [0, 1],
      [5, 1],
    ]);
    // Either order.
    expect(
      seg(lineBetween(per(line(5, 0, 0, 1), 5, 3), tan(circle(0, 0, 1), 0, 1.1), tol)),
    ).toEqual([
      [5, 1],
      [0, 1],
    ]);
    const a = circle(0, 0, 1);
    const s = lineBetween(tan(a, 0.1, 1), per(circle(10, 0, 2), 8, 0.5), tol)!;
    const d = { x: s.end.x - s.start.x, y: s.end.y - s.start.y };
    expect(tangentAt(a, s.start, d)).toBe(true);
    // Perpendicular to a circle: on the line through its centre.
    expect(r6(Math.hypot(s.end.x - 10, s.end.y))).toBe(2);
    expect(r6((10 - s.start.x) * d.y - (0 - s.start.y) * d.x)).toBe(0);
    expect(s.end.x).toBeLessThan(10);
  });

  it('draws perpendicular to two objects where a common perpendicular exists', () => {
    expect(
      seg(lineBetween(per(line(0, 0, 1, 0), 3, 0.1), per(line(0, 5, -1, 0), 0, 5), tol)),
    ).toEqual([
      [3, 0],
      [3, 5],
    ]);
    expect(lineBetween(per(line(0, 0, 1, 0), 3, 0), per(line(0, 5, 1, 1), 0, 5), tol)).toBe(
      undefined,
    );
    expect(
      seg(lineBetween(per(line(0, 0, 1, 0), 3, 0), per(circle(4, 6, 2), 4, 3.9), tol)),
    ).toEqual([
      [4, 0],
      [4, 4],
    ]);
    expect(
      seg(lineBetween(per(circle(4, 6, 2), 4, 3.9), per(line(0, 0, 1, 0), 3, 0), tol)),
    ).toEqual([
      [4, 4],
      [4, 0],
    ]);
    expect(seg(lineBetween(per(circle(0, 0, 1), 1, 0), per(circle(10, 0, 2), 8, 0), tol))).toEqual([
      [1, 0],
      [8, 0],
    ]);
    expect(
      seg(lineBetween(per(circle(0, 0, 1), -1, 0), per(circle(10, 0, 2), 12, 0), tol)),
    ).toEqual([
      [-1, 0],
      [12, 0],
    ]);
  });
});

describe('circleThroughItems', () => {
  // The 3-4-5 triangle with its right angle at the origin.
  const base = line(0, 0, 1, 0);
  const side = line(0, 0, 0, 1);
  const hypotenuse = line(4, 0, -4, 3);

  it('is CIRCLE 3P when all three are points', () => {
    const [a, b, c] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ];
    expect(circ(circleThroughItems([a, b, c], tol))).toEqual(circ(circleThrough3(a, b, c, tol)));
  });

  it('draws Tan, Tan, Tan in a triangle: the inscribed circle', () => {
    const c = circleThroughItems(
      [tan(base, 2, 0), tan(side, 0, 1.5), tan(hypotenuse, 2, 1.5)],
      tol,
    );
    expect(circ(c)).toEqual([1, 1, 1]);
  });

  it('draws the escribed circle when the picks are where it touches', () => {
    const c = circleThroughItems(
      [tan(base, 6, 0), tan(side, 0, 6), tan(hypotenuse, 2.4, 1.2)],
      tol,
    );
    expect(circ(c)).toEqual([6, 6, 6]);
  });

  it('keeps its precision far from the origin', () => {
    const o = 1e6;
    const c = circleThroughItems(
      [
        tan(line(o, o, 1, 0), o + 2, o),
        tan(line(o, o, 0, 1), o, o + 1.5),
        tan(line(o + 4, o, -4, 3), o + 2, o + 1.5),
      ],
      toleranceForSize(2e6),
    )!;
    expect(c.center.x - o).toBeCloseTo(1, 6);
    expect(c.center.y - o).toBeCloseTo(1, 6);
    expect(c.radius).toBeCloseTo(1, 6);
  });

  it('draws Tan, Tan, Tan to three circles: inside them all, or around them all', () => {
    const h = 2 * Math.sqrt(3);
    const a = circle(0, 0, 1);
    const b = circle(4, 0, 1);
    const c = circle(2, h, 1);
    const toCentre = 4 / Math.sqrt(3);
    // Picked on the sides facing each other: the small circle between them.
    const inner = circleThroughItems([tan(a, 0.9, 0.5), tan(b, 3.1, 0.5), tan(c, 2, h - 1)], tol)!;
    expect(r6(inner.center.x)).toBe(2);
    expect(r6(inner.center.y)).toBe(r6(h / 3));
    expect(r6(inner.radius)).toBe(r6(toCentre - 1));
    // Picked on the outer sides: the circle holding all three.
    const outer = circleThroughItems(
      [tan(a, -0.9, -0.5), tan(b, 4.9, -0.5), tan(c, 2, h + 1)],
      tol,
    )!;
    expect(r6(outer.center.y)).toBe(r6(h / 3));
    expect(r6(outer.radius)).toBe(r6(toCentre + 1));
  });

  it('mixes points and tangents', () => {
    // Through (−2, 2) and (2, 2), tangent to the x axis.
    expect(
      circ(circleThroughItems([{ x: -2, y: 2 }, { x: 2, y: 2 }, tan(base, 0, 0)], tol)),
    ).toEqual([0, 2, 2]);
    // Through a point, tangent to a circle and a line: whichever it is, it meets all three.
    const p = { x: 0, y: 5 };
    const c = circleThroughItems(
      [p, tan(circle(5, 0, 1), 4, 0.5), tan(line(0, -3, 1, 0), 2, -3)],
      tol,
    )!;
    expect(c).toBeDefined();
    expect(Math.hypot(c.center.x - p.x, c.center.y - p.y)).toBeCloseTo(c.radius, 9);
    expect(c.center.y + 3).toBeCloseTo(c.radius, 9);
    const d = Math.hypot(c.center.x - 5, c.center.y);
    expect(
      Math.min(Math.abs(d - (c.radius + 1)), Math.abs(d - Math.abs(c.radius - 1))),
    ).toBeLessThan(1e-9);
  });

  it('finds none where no circle can touch them all', () => {
    expect(
      circleThroughItems(
        [tan(line(0, 0, 1, 0), 0, 0), tan(line(0, 1, 1, 0), 0, 1), tan(line(0, 2, 1, 0), 0, 2)],
        tol,
      ),
    ).toBeUndefined();
    // A point inside a circle and one outside it: no circle through both touches it.
    expect(
      circleThroughItems([{ x: 0, y: 0 }, { x: 0, y: 10 }, tan(circle(0, 0, 3), 3, 0)], tol),
    ).toBeUndefined();
    expect(
      circleThroughItems([{ x: 0, y: 0 }, { x: 0, y: 10 }, per(circle(0, 0, 3), 3, 0)], tol),
    ).toBeUndefined();
  });
});
