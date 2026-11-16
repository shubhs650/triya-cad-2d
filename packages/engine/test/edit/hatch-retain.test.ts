// M4-07 part 2: HATCH's Retain boundary keeps each loop a pick point found as objects: a loop of
// lines and arcs as one closed polyline, a loop with elliptical or spline edges edge by edge.
import { describe, expect, it } from 'vitest';
import { retainedBoundary, type LwPolylineGeometry } from '../../src/index';

const p = (x: number, y: number) => ({ x, y });

describe('retainedBoundary (M4-07)', () => {
  it('keeps a loop of lines and arcs as a closed polyline, walked as the loop is', () => {
    // A slot: bottom line, a half circle on the right walked counter-clockwise, top line back,
    // and a half circle on the left walked clockwise (stored negated, DXF 73 = 0).
    const [g] = retainedBoundary({
      flags: 1,
      edges: [
        { type: 'line', start: p(0, 0), end: p(10, 0) },
        {
          type: 'arc',
          center: p(10, 5),
          radius: 5,
          startAngle: -Math.PI / 2,
          endAngle: Math.PI / 2,
          ccw: true,
        },
        { type: 'line', start: p(10, 10), end: p(0, 10) },
        {
          type: 'arc',
          center: p(0, 5),
          radius: 5,
          startAngle: (3 * Math.PI) / 2,
          endAngle: Math.PI / 2 + 2 * Math.PI,
          ccw: false,
        },
      ],
    });
    const poly = g as LwPolylineGeometry;
    expect(poly).toMatchObject({ kind: 'LWPOLYLINE', closed: true });
    const v = poly.vertices;
    expect(v).toHaveLength(4);
    expect(v[1]!.x).toBeCloseTo(10, 12);
    expect(v[1]!.y).toBeCloseTo(0, 12);
    expect(v[1]!.bulge).toBeCloseTo(1, 12);
    expect(v[3]!.x).toBeCloseTo(0, 12);
    expect(v[3]!.y).toBeCloseTo(10, 12);
    expect(v[3]!.bulge).toBeCloseTo(-1, 12);
  });

  it('keeps a whole circle as two half circles, either way round', () => {
    for (const ccw of [true, false]) {
      const [g] = retainedBoundary({
        flags: 16,
        edges: [
          { type: 'arc', center: p(0, 0), radius: 2, startAngle: 0, endAngle: 2 * Math.PI, ccw },
        ],
      });
      const v = (g as LwPolylineGeometry).vertices;
      expect(v.map((x) => x.bulge)).toEqual(ccw ? [1, 1] : [-1, -1]);
      expect(v[1]!.x).toBeCloseTo(-2, 12);
    }
  });

  it('keeps a polyline loop as it is, and a loop with spline or ellipse edges edge by edge', () => {
    const vertices = [
      { x: 0, y: 0, bulge: 0 },
      { x: 4, y: 0, bulge: 0.5 },
      { x: 0, y: 4, bulge: 0 },
    ];
    expect(retainedBoundary({ flags: 3, polyline: { vertices, closed: true } })).toEqual([
      { kind: 'LWPOLYLINE', closed: true, vertices },
    ]);
    const kept = retainedBoundary({
      flags: 1,
      edges: [
        {
          type: 'spline',
          degree: 1,
          knots: [0, 0, 1, 1],
          controlPoints: [p(0, 0), p(10, 0)],
          periodic: false,
        },
        {
          type: 'ellipse',
          center: p(5, 0),
          majorAxis: p(5, 0),
          ratio: 0.5,
          startAngle: 0,
          endAngle: Math.PI,
          ccw: true,
        },
        { type: 'line', start: p(0, 0), end: p(0, 0) },
      ],
    });
    expect(kept.map((g) => g.kind)).toEqual(['SPLINE', 'ELLIPSE']);
    expect(kept[0]).toMatchObject({ closed: false, periodic: false });
    expect(retainedBoundary({ flags: 1, edges: [] })).toEqual([]);
  });
});
