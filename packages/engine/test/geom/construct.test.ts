// M3-01: the circle and arc constructions CIRCLE and ARC draw with (geom/construct.ts), checked
// against AutoCAD 2024's rules for each method ("To Draw Arcs"): which way the arc runs, which
// of the two arcs a signed chord, radius or angle gives, and where a drawn arc ends.
import { describe, expect, it } from 'vitest';
import {
  arcEnd,
  arcStartCenterAngle,
  arcStartCenterChord,
  arcStartCenterEnd,
  arcStartDirectionEnd,
  arcStartEndAngle,
  arcStartEndCenter,
  arcStartEndRadius,
  arcThrough3,
  circleTanTanRadius,
  circleThrough3,
  dxfArc,
  tangentCircleCenters,
  tangentPointOn,
  toleranceForSize,
  type BulgeArc,
  type TangentTarget,
  type Vec2,
} from '../../src/geom/index';

const tol = toleranceForSize(100);
const deg = (d: number) => (d * Math.PI) / 180;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];
const arc = (a: BulgeArc | undefined) =>
  a && {
    center: pt(a.center),
    radius: r6(a.radius),
    start: r6((((a.startAngle * 180) / Math.PI) % 360) + 360) % 360,
    sweep: r6((a.sweep * 180) / Math.PI),
  };
const end = (a: BulgeArc) => pt(arcEnd(a).point);

describe('circleThrough3', () => {
  it('finds the circumcircle', () => {
    const c = circleThrough3({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, tol)!;
    expect([...pt(c.center), r6(c.radius)]).toEqual([0, 0, 10]);
  });
  it('has none through collinear or coincident points', () => {
    expect(circleThrough3({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, tol)).toBeUndefined();
    expect(circleThrough3({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 2 }, tol)).toBeUndefined();
  });
});

describe('arcThrough3', () => {
  it('runs counter-clockwise when the points turn left', () => {
    const a = arcThrough3({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, tol)!;
    expect(arc(a)).toEqual({ center: [0, 0], radius: 10, start: 0, sweep: 180 });
    expect(dxfArc(a)).toMatchObject({ startAngle: 0, endAngle: Math.PI });
    expect(end(a)).toEqual([-10, 0]);
  });
  it('runs clockwise when they turn right, and the DXF arc still runs counter-clockwise', () => {
    const a = arcThrough3({ x: -10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }, tol)!;
    expect(arc(a)).toEqual({ center: [0, 0], radius: 10, start: 180, sweep: -180 });
    const d = dxfArc(a);
    expect([r6(d.startAngle), r6(d.endAngle)]).toEqual([0, r6(Math.PI)]);
    expect(end(a)).toEqual([10, 0]);
    // Travelling clockwise at (10, 0) is heading down.
    expect(pt(arcEnd(a).direction)).toEqual([0, -1]);
  });
  it('has none through collinear points', () => {
    expect(arcThrough3({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, tol)).toBeUndefined();
  });
});

describe('start, center', () => {
  const s = { x: 10, y: 0 };
  const c = { x: 0, y: 0 };
  it('SCE runs counter-clockwise to the end direction, at the start radius', () => {
    expect(arc(arcStartCenterEnd(s, c, { x: 0, y: 3 }, tol))).toEqual({
      center: [0, 0],
      radius: 10,
      start: 0,
      sweep: 90,
    });
    expect(arc(arcStartCenterEnd(s, c, { x: 0, y: -3 }, tol))!.sweep).toBe(270);
    expect(arcStartCenterEnd(s, c, c, tol)).toBeUndefined();
    // An end in the start's direction would be a whole circle, which is not an arc.
    expect(arcStartCenterEnd(s, c, { x: 5, y: 0 }, tol)).toBeUndefined();
    expect(arcStartCenterEnd(c, c, { x: 5, y: 0 }, tol)).toBeUndefined();
  });
  it('SCA: a positive angle counter-clockwise, a negative one clockwise', () => {
    expect(arc(arcStartCenterAngle(s, c, deg(45), tol))!.sweep).toBe(45);
    const cw = arcStartCenterAngle(s, c, deg(-90), tol)!;
    expect(end(cw)).toEqual([0, -10]);
    expect(dxfArc(cw)).toMatchObject({ startAngle: deg(270), endAngle: 0 });
    expect(arcStartCenterAngle(s, c, 0, tol)).toBeUndefined();
    expect(arcStartCenterAngle(s, c, deg(360), tol)).toBeUndefined();
  });
  it('SCL: a positive chord draws the minor arc, a negative one the major arc', () => {
    const chord = 10 * Math.SQRT2;
    expect(arc(arcStartCenterChord(s, c, chord, tol))!.sweep).toBe(90);
    expect(arc(arcStartCenterChord(s, c, -chord, tol))!.sweep).toBe(270);
    expect(arc(arcStartCenterChord(s, c, 20, tol))!.sweep).toBe(180);
    expect(arcStartCenterChord(s, c, 21, tol)).toBeUndefined();
    expect(arcStartCenterChord(c, c, 1, tol)).toBeUndefined();
  });
});

describe('start, end', () => {
  const s = { x: 10, y: 0 };
  const e = { x: 0, y: 10 };
  it('SEC is SCE with the points the other way round', () => {
    expect(arc(arcStartEndCenter(s, e, { x: 0, y: 0 }, tol))).toEqual({
      center: [0, 0],
      radius: 10,
      start: 0,
      sweep: 90,
    });
  });
  it('SEA: the centre from the included angle, either way', () => {
    expect(arc(arcStartEndAngle(s, e, deg(90), tol))).toEqual({
      center: [0, 0],
      radius: 10,
      start: 0,
      sweep: 90,
    });
    // Clockwise from (10, 0) to (0, 10) through 90° is about (10, 10).
    expect(arc(arcStartEndAngle(s, e, deg(-90), tol))).toEqual({
      center: [10, 10],
      radius: 10,
      start: 270,
      sweep: -90,
    });
    expect(arc(arcStartEndAngle(s, e, deg(270), tol))).toMatchObject({ center: [10, 10] });
    expect(arcStartEndAngle(s, s, deg(90), tol)).toBeUndefined();
    expect(arcStartEndAngle(s, e, 0, tol)).toBeUndefined();
    expect(arcStartEndAngle(s, e, deg(-360), tol)).toBeUndefined();
  });
  it('SER: counter-clockwise, a positive radius the minor arc and a negative the major', () => {
    expect(arc(arcStartEndRadius(s, e, 10, tol))).toEqual({
      center: [0, 0],
      radius: 10,
      start: 0,
      sweep: 90,
    });
    expect(arc(arcStartEndRadius(s, e, -10, tol))).toEqual({
      center: [10, 10],
      radius: 10,
      start: 270,
      sweep: 270,
    });
    expect(arcStartEndRadius(s, e, 7, tol)).toBeUndefined();
    expect(arcStartEndRadius(s, s, 7, tol)).toBeUndefined();
  });
  it('SED: leaves the start along the direction', () => {
    // Heading up from (10, 0) to (0, 10) turns left about the origin.
    expect(arc(arcStartDirectionEnd(s, { x: 0, y: 5 }, e, tol))).toEqual({
      center: [0, 0],
      radius: 10,
      start: 0,
      sweep: 90,
    });
    // Heading left from (10, 0) to (0, 10) turns right about (10, 10).
    const cw = arcStartDirectionEnd(s, { x: -1, y: 0 }, e, tol)!;
    expect(arc(cw)).toEqual({ center: [10, 10], radius: 10, start: 270, sweep: -90 });
    expect(pt(arcEnd(cw).direction)).toEqual([0, 1]);
    expect(arcStartDirectionEnd(s, { x: -1, y: 1 }, e, tol)).toBeUndefined();
    expect(arcStartDirectionEnd(s, { x: 0, y: 0 }, e, tol)).toBeUndefined();
    expect(arcStartDirectionEnd(s, { x: 0, y: 1 }, s, tol)).toBeUndefined();
  });
});

describe('tangent circles (Ttr)', () => {
  const xAxis: TangentTarget = { kind: 'line', point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
  const yAxis: TangentTarget = { kind: 'line', point: { x: 0, y: 0 }, direction: { x: 0, y: 2 } };
  const ring: TangentTarget = { kind: 'circle', center: { x: 20, y: 0 }, radius: 5 };

  it('two lines: four centres, the one by the picks drawn', () => {
    const centers = tangentCircleCenters(xAxis, yAxis, 3, tol).map(pt);
    expect(centers).toHaveLength(4);
    expect(centers).toContainEqual([3, 3]);
    expect(centers).toContainEqual([-3, -3]);
    const c = circleTanTanRadius(xAxis, { x: 5, y: 0 }, yAxis, { x: 0, y: 5 }, 3, tol)!;
    expect([...pt(c.center), c.radius]).toEqual([3, 3, 3]);
    const d = circleTanTanRadius(xAxis, { x: -5, y: 0 }, yAxis, { x: 0, y: 5 }, 3, tol)!;
    expect(pt(d.center)).toEqual([-3, 3]);
  });
  it('parallel lines have none unless the radius spans them', () => {
    const top: TangentTarget = { kind: 'line', point: { x: 0, y: 6 }, direction: { x: 1, y: 0 } };
    expect(tangentCircleCenters(xAxis, top, 2, tol)).toEqual([]);
    expect(circleTanTanRadius(xAxis, { x: 0, y: 0 }, top, { x: 0, y: 6 }, 2, tol)).toBeUndefined();
  });
  it('a line and a circle: outside and around it', () => {
    const c = circleTanTanRadius(xAxis, { x: 27, y: 0 }, ring, { x: 24, y: 3 }, 2, tol)!;
    // Above the axis, touching the ring from outside: centre 7 from (20, 0) and 2 above y = 0.
    expect(pt(c.center)).toEqual([r6(20 + Math.sqrt(45)), 2]);
    // Picked nearer the middle, the circle inside the ring is closer: centre 5 − 2 from it.
    const inner = circleTanTanRadius(xAxis, { x: 22, y: 0 }, ring, { x: 23, y: 4 }, 2, tol)!;
    expect(pt(inner.center)).toEqual([r6(20 + Math.sqrt(5)), 2]);
    expect(pt(tangentPointOn(ring, c.center))).toEqual(
      pt({ x: 20 + (5 * (c.center.x - 20)) / 7, y: (5 * c.center.y) / 7 }),
    );
    // The order of the two objects does not matter.
    const back = circleTanTanRadius(ring, { x: 24, y: 3 }, xAxis, { x: 27, y: 0 }, 2, tol)!;
    expect(pt(back.center)).toEqual(pt(c.center));
    // A line that misses every offset circle gives none.
    const far: TangentTarget = { kind: 'line', point: { x: 0, y: 50 }, direction: { x: 1, y: 0 } };
    expect(tangentCircleCenters(far, ring, 2, tol)).toEqual([]);
  });
  it('a line touching an offset circle gives one centre there', () => {
    const touch: TangentTarget = { kind: 'line', point: { x: 0, y: 9 }, direction: { x: 1, y: 0 } };
    // r = 2: the line's offset y = 7 touches the ring's R + r = 7 circle at (20, 7).
    expect(tangentCircleCenters(touch, ring, 2, tol).map(pt)).toContainEqual([20, 7]);
  });
  it('two circles: outside both, inside the larger', () => {
    const left: TangentTarget = { kind: 'circle', center: { x: 0, y: 0 }, radius: 5 };
    const c = circleTanTanRadius(left, { x: 5, y: 3 }, ring, { x: 15, y: 3 }, 6, tol)!;
    expect(pt(c.center)).toEqual([10, r6(Math.sqrt(121 - 100))]);
    const big: TangentTarget = { kind: 'circle', center: { x: 0, y: 0 }, radius: 20 };
    const small: TangentTarget = { kind: 'circle', center: { x: 10, y: 0 }, radius: 2 };
    const inside = circleTanTanRadius(big, { x: 0, y: 20 }, small, { x: 10, y: 2 }, 5, tol)!;
    expect(r6(Math.hypot(inside.center.x, inside.center.y))).toBe(15);
    expect(r6(Math.hypot(inside.center.x - 10, inside.center.y))).toBe(7);
    // Circles touching give their one centre; concentric and far-apart circles give none.
    const touching = tangentCircleCenters(left, { ...ring, center: { x: 14, y: 0 } }, 2, tol);
    expect(touching.map(pt)).toContainEqual([7, 0]);
    expect(tangentCircleCenters(left, { ...left, radius: 1 }, 1, tol)).toEqual([]);
    expect(tangentCircleCenters(left, { ...ring, center: { x: 99, y: 0 } }, 1, tol)).toEqual([]);
  });
  it('a radius equal to a circle’s gives its centre as the inner offset', () => {
    const left: TangentTarget = { kind: 'circle', center: { x: 0, y: 0 }, radius: 5 };
    const through: TangentTarget = {
      kind: 'line',
      point: { x: 0, y: 5 },
      direction: { x: 1, y: 0 },
    };
    expect(tangentCircleCenters(left, through, 5, tol).map(pt)).toContainEqual([0, 0]);
    expect(pt(tangentPointOn(left, { x: 0, y: 0 }))).toEqual([5, 0]);
  });
  it('no circle of zero radius', () => {
    expect(
      circleTanTanRadius(xAxis, { x: 0, y: 0 }, yAxis, { x: 0, y: 0 }, 0, tol),
    ).toBeUndefined();
  });
});
