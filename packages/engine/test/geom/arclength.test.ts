// M3-03: lengths along curves, and where a distance along one lands (ARRAYPATH's stations).
import { describe, expect, it } from 'vitest';
import {
  arcLengthTable,
  curveLength,
  derivativeAt,
  integrate,
  frameAtLength,
  paramAtLength,
  pointAt,
  smoothSpans,
  type BoundedCurve,
  type Polyline,
  type Spline,
} from '../../src/index';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

const line: BoundedCurve = { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 3, y: 4 } };
const arc: BoundedCurve = {
  kind: 'ARC',
  center: { x: 0, y: 0 },
  radius: 2,
  startAngle: 0,
  endAngle: Math.PI / 2,
};
// 10 along +X, a half-circle bulge of radius 5 back over the top, then a repeated vertex.
const poly: Polyline = {
  kind: 'LWPOLYLINE',
  closed: false,
  vertices: [
    { x: 0, y: 0, bulge: 0 },
    { x: 10, y: 0, bulge: 1 },
    { x: 0, y: 0, bulge: 0 },
    { x: 0, y: 0, bulge: 0 },
  ],
};

describe('curve lengths', () => {
  it('measures lines, arcs, circles and polylines exactly', () => {
    close(curveLength(line), 5);
    close(curveLength(arc), Math.PI);
    close(curveLength({ kind: 'CIRCLE', center: { x: 1, y: 1 }, radius: 3 }), 6 * Math.PI);
    close(curveLength(poly), 10 + 5 * Math.PI);
  });

  it('measures an ellipse span by span', () => {
    // A circle drawn as an ellipse, and a 2:1 ellipse (Ramanujan's second approximation).
    close(
      curveLength({
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 2, y: 0 },
        ratio: 1,
        startParam: 0,
        endParam: 2 * Math.PI,
      }),
      4 * Math.PI,
      1e-9,
    );
    const a = 2;
    const b = 1;
    const h = (a - b) ** 2 / (a + b) ** 2;
    const ramanujan = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    close(
      curveLength({
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 2, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: 2 * Math.PI,
      }),
      ramanujan,
      1e-6,
    );
  });

  it('cuts a spline at its knots', () => {
    const s: Spline = {
      kind: 'SPLINE',
      degree: 1,
      knots: [0, 0, 1, 2, 2],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ],
    };
    expect(smoothSpans(s)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    close(curveLength(s), 7);
  });
});

describe('distance along a curve', () => {
  it('lands on lines, arcs and polyline segments in one step', () => {
    const t = arcLengthTable(line);
    close(paramAtLength(t, 2.5), 0.5);
    close(paramAtLength(t, -1), 0);
    close(paramAtLength(t, 99), 1);
    close(paramAtLength(arcLengthTable(arc), Math.PI / 2), Math.PI / 4);
    const p = arcLengthTable(poly);
    close(paramAtLength(p, 5), 0.5);
    // Half way round the bulge: the top of the half circle.
    const top = pointAt(poly, paramAtLength(p, 10 + 2.5 * Math.PI));
    close(top.x, 5);
    close(top.y, 5);
    // The repeated vertex adds nothing: the end is the end of the arc.
    const end = pointAt(poly, paramAtLength(p, p.length));
    close(end.x, 0);
    close(end.y, 0);
  });

  it('finds a distance along a spline by Newton steps', () => {
    // A quadratic Bézier: its speed varies, so the station is not the parameter.
    const s: Spline = {
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 5, y: 10 },
        { x: 10, y: 0 },
      ],
    };
    const table = arcLengthTable(s);
    const half = paramAtLength(table, table.length / 2);
    close(half, 0.5, 1e-9);
    const quarter = paramAtLength(table, table.length / 4);
    const speed = (t: number) => Math.hypot(derivativeAt(s, t).x, derivativeAt(s, t).y);
    close(integrate(speed, 0, quarter, 8), table.length / 4, 1e-9);
    // The curve is fast at its ends and slow in the middle, so a quarter of its length comes
    // before a quarter of its parameter.
    expect(quarter).toBeLessThan(0.25);
  });

  it('gives the direction of travel, also where the speed vanishes', () => {
    const f = frameAtLength(arcLengthTable(line), 1);
    close(f.point.x, 0.6);
    close(f.direction.x, 0.6);
    close(f.direction.y, 0.8);
    // A spline whose first two control points coincide has no speed at its start.
    const s: Spline = {
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const g = frameAtLength(arcLengthTable(s), 0);
    close(g.direction.x, 1);
    close(g.direction.y, 0);
    const h = frameAtLength(
      arcLengthTable({ ...s, controlPoints: [...s.controlPoints].reverse() }),
      10,
    );
    close(h.direction.x, -1);
  });
});
