import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arcSweep,
  bulgeArc,
  derivativeAt,
  domain,
  ellipseAxes,
  ellipseSweep,
  endPoint,
  explodePolyline,
  pointAt,
  polylineSegmentCount,
  startPoint,
  type Arc,
  type Curve,
  type Ellipse,
  type Polyline,
} from '../../src/geom/index';
import { at, boundedCurve, expectNear, sizeOf } from './arbitraries';

describe('domain, pointAt and derivativeAt', () => {
  it('LINE runs from start to end over [0, 1]', () => {
    const l: Curve = { kind: 'LINE', start: { x: 1, y: 1 }, end: { x: 5, y: 4 } };
    expect(domain(l)).toEqual({ start: 0, end: 1 });
    expect(pointAt(l, 0.5)).toEqual({ x: 3, y: 2.5 });
    expect(derivativeAt(l, 0.2)).toEqual({ x: 4, y: 3 });
  });

  it('RAY and XLINE are parameterised by distance along the unit direction', () => {
    const r: Curve = { kind: 'RAY', base: { x: 1, y: 0 }, direction: { x: 0, y: 2 } };
    const x: Curve = { kind: 'XLINE', base: { x: 1, y: 0 }, direction: { x: 3, y: 4 } };
    expect(domain(r)).toEqual({ start: 0, end: Infinity });
    expect(domain(x)).toEqual({ start: -Infinity, end: Infinity });
    expectNear(pointAt(r, 3), { x: 1, y: 3 });
    expectNear(pointAt(x, -5), { x: -2, y: -4 });
    expectNear(derivativeAt(x, 7), { x: 0.6, y: 0.8 });
    expectNear(derivativeAt(r, 1), { x: 0, y: 1 });
    expect(() => endPoint(r)).toThrow(/unbounded/);
    expect(startPoint(r)).toEqual({ x: 1, y: 0 });
    expect(() => startPoint(x)).toThrow(/unbounded/);
  });

  it('CIRCLE is parameterised by angle over [0, 2π]', () => {
    const c: Curve = { kind: 'CIRCLE', center: { x: 1, y: 1 }, radius: 2 };
    expect(domain(c)).toEqual({ start: 0, end: 2 * Math.PI });
    expectNear(pointAt(c, Math.PI / 2), { x: 1, y: 3 });
    expectNear(derivativeAt(c, 0), { x: 0, y: 2 });
    expectNear(startPoint(c), endPoint(c));
  });

  it('ARC runs CCW from startAngle without wrapping', () => {
    const a: Arc = { kind: 'ARC', center: { x: 0, y: 0 }, radius: 1, startAngle: 3, endAngle: 1 };
    expect(arcSweep(a)).toBeCloseTo(2 * Math.PI - 2, 15);
    const d = domain(a);
    expect(d.start).toBe(3);
    expect(d.end).toBeCloseTo(1 + 2 * Math.PI, 14);
    expectNear(endPoint(a), { x: Math.cos(1), y: Math.sin(1) });
    expectNear(derivativeAt(a, Math.PI), { x: 0, y: -1 });
  });

  it('ELLIPSE uses eccentric anomaly with the minor axis CCW of the major', () => {
    const e: Ellipse = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 0, y: 2 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    };
    const { major, minor } = ellipseAxes(e);
    expect(major).toEqual({ x: 0, y: 2 });
    expectNear(minor, { x: -1, y: 0 });
    expect(ellipseSweep(e)).toBe(2 * Math.PI);
    expectNear(pointAt(e, 0), { x: 0, y: 2 });
    expectNear(pointAt(e, Math.PI / 2), { x: -1, y: 0 });
    expectNear(derivativeAt(e, 0), { x: -1, y: 0 });
  });

  it('LWPOLYLINE segments are unit parameter intervals, closing segment included', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 2, y: 0, bulge: 1 }, // half circle to (2, 2), bulging to +X: CCW
        { x: 2, y: 2, bulge: 0 },
      ],
    };
    expect(polylineSegmentCount(p)).toBe(3);
    expect(domain(p)).toEqual({ start: 0, end: 3 });
    expectNear(pointAt(p, 0.5), { x: 1, y: 0 });
    expectNear(pointAt(p, 1.5), { x: 3, y: 1 });
    expectNear(pointAt(p, 2.5), { x: 1, y: 1 });
    expectNear(pointAt(p, 3), { x: 0, y: 0 });
    expectNear(derivativeAt(p, 1), { x: Math.PI, y: 0 });
    expect(polylineSegmentCount({ ...p, closed: false })).toBe(2);
    expect(
      polylineSegmentCount({
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [{ x: 0, y: 0, bulge: 0 }],
      }),
    ).toBe(0);
  });

  it('clamps polyline parameters to the domain', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 1, y: 0, bulge: 0 },
      ],
    };
    expectNear(pointAt(p, -1), { x: 0, y: 0 });
    expectNear(pointAt(p, 9), { x: 1, y: 0 });
    expect(() => pointAt({ ...p, vertices: [] }, 0)).toThrow(/no segments/);
  });

  it('start and end points match the domain ends for every bounded curve', () => {
    fc.assert(
      fc.property(boundedCurve, (c) => {
        expectNear(startPoint(c), at(c, 0), 1e-9 * sizeOf(c));
        expectNear(endPoint(c), at(c, 1), 1e-9 * sizeOf(c));
      }),
    );
  });

  it('derivativeAt matches a central finite difference', () => {
    fc.assert(
      fc.property(boundedCurve, fc.double({ min: 0.05, max: 0.95, noNaN: true }), (c, s) => {
        const d = domain(c);
        const t = d.start + s * (d.end - d.start);
        // Stay inside one polyline segment or spline span, where the curve is smooth.
        const h = 1e-6 * (d.end - d.start);
        const lo = pointAt(c, t - h);
        const hi = pointAt(c, t + h);
        const fd = { x: (hi.x - lo.x) / (2 * h), y: (hi.y - lo.y) / (2 * h) };
        const der = derivativeAt(c, t);
        const mag = Math.max(1, Math.hypot(der.x, der.y));
        const smooth = c.kind !== 'LWPOLYLINE' && c.kind !== 'SPLINE';
        if (smooth || Math.hypot(fd.x - der.x, fd.y - der.y) / mag < 1e-2) {
          expectNear(fd, der, 1e-3 * mag);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('bulgeArc and explodePolyline', () => {
  it('turns a bulge of 1 into a half circle with a signed sweep', () => {
    const ccw = bulgeArc({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    expectNear(ccw.center, { x: 1, y: 0 });
    expect(ccw.radius).toBeCloseTo(1, 15);
    expect(ccw.sweep).toBeCloseTo(Math.PI, 15);
    expect(ccw.startAngle).toBeCloseTo(Math.PI, 15);
    const cw = bulgeArc({ x: 0, y: 0 }, { x: 2, y: 0 }, -1);
    expect(cw.sweep).toBeCloseTo(-Math.PI, 15);
  });

  it('a bulge of tan(π/8) is a quarter circle', () => {
    const q = bulgeArc({ x: 1, y: 0 }, { x: 0, y: 1 }, Math.tan(Math.PI / 8));
    expectNear(q.center, { x: 0, y: 0 });
    expect(q.radius).toBeCloseTo(1, 14);
    expect(q.sweep).toBeCloseTo(Math.PI / 2, 14);
  });

  it('explodes into LINEs and CCW ARCs that trace the same points', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 2, y: 0, bulge: -Math.tan(Math.PI / 8) },
        { x: 2, y: 2, bulge: 0.5 },
      ],
    };
    const parts = explodePolyline(p);
    expect(parts.map((s) => s.kind)).toEqual(['LINE', 'ARC', 'ARC']);
    // A CW bulge becomes a CCW arc from the far end back to the near end.
    const cw = parts[1] as Arc;
    expectNear(startPoint(cw), { x: 2, y: 2 });
    expectNear(endPoint(cw), { x: 2, y: 0 });
    const ccw = parts[2] as Arc;
    expectNear(startPoint(ccw), { x: 2, y: 2 });
    expectNear(endPoint(ccw), { x: 0, y: 0 });
  });

  it('exploded pieces cover the polyline: every sampled point lies on a piece', () => {
    fc.assert(
      fc.property(
        boundedCurve.filter((c): c is Polyline => c.kind === 'LWPOLYLINE'),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (p, s) => {
          const parts = explodePolyline(p);
          const t = s * polylineSegmentCount(p);
          const i = Math.min(Math.floor(t), parts.length - 1);
          const piece = parts[i]!;
          const q = pointAt(p, t);
          if (piece.kind === 'LINE') {
            const cr =
              (piece.end.x - piece.start.x) * (q.y - piece.start.y) -
              (piece.end.y - piece.start.y) * (q.x - piece.start.x);
            expect(Math.abs(cr)).toBeLessThan(1e-6 * sizeOf(p) ** 2);
          } else if (piece.kind === 'ARC') {
            const r = Math.hypot(q.x - piece.center.x, q.y - piece.center.y);
            expect(Math.abs(r - piece.radius)).toBeLessThan(
              1e-7 * Math.max(sizeOf(p), piece.radius),
            );
          }
        },
      ),
    );
  });
});
