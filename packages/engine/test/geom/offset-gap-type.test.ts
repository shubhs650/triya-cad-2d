// M3-12: OFFSETGAPTYPE (AutoCAD 2024 Help, "OFFSETGAPTYPE"): where a polyline's segments part
// on the outside of a corner, 0 extends them to meet, 1 fills the gap with an arc of the offset
// distance round the vertex (a fillet), 2 with a straight segment as far from the vertex as the
// offset distance (a chamfer), the segments extended to it. The inside of a corner is trimmed
// as with 0.
import { describe, expect, it } from 'vitest';
import { closestPoint, offsetPolylineTraced, type Polyline, type Vec2 } from '../../src/geom/index';
import { TOL } from './arbitraries';

const r = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const xy = (v: { x: number; y: number }) => [r(v.x), r(v.y)];

/** The CCW square (0,0)-(10,10): left is inside, a negative distance goes outside. */
const SQUARE: Polyline = {
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: [
    { x: 0, y: 0, bulge: 0 },
    { x: 10, y: 0, bulge: 0 },
    { x: 10, y: 10, bulge: 0 },
    { x: 0, y: 10, bulge: 0 },
  ],
};

const Q = r(Math.tan(Math.PI / 8));
const S = Math.SQRT2 - 1;

describe('OFFSETGAPTYPE', () => {
  it('0 extends the segments to their corner', () => {
    const o = offsetPolylineTraced(SQUARE, -1, TOL, 0)!;
    expect(o.polyline.vertices.map(xy)).toEqual([
      [-1, -1],
      [11, -1],
      [11, 11],
      [-1, 11],
    ]);
  });

  it('1 fills each outside corner with an arc of the distance round the vertex', () => {
    const o = offsetPolylineTraced(SQUARE, -1, TOL, 1)!;
    expect(o.polyline.closed).toBe(true);
    expect(o.polyline.vertices.map((v) => [...xy(v), r(v.bulge)])).toEqual([
      [0, -1, 0],
      [10, -1, Q],
      [11, 0, 0],
      [11, 10, Q],
      [10, 11, 0],
      [0, 11, Q],
      [-1, 10, 0],
      [-1, 0, Q],
    ]);
    // The arcs bridge gaps: no source segment of their own.
    expect(o.from).toEqual([0, -1, 1, -1, 2, -1, 3, -1]);
  });

  it('2 fills each outside corner with a chamfer square to the bisector', () => {
    const o = offsetPolylineTraced(SQUARE, -1, TOL, 2)!;
    expect(o.polyline.vertices.map((v) => [...xy(v), v.bulge])).toEqual([
      [r(-S), -1, 0],
      [r(10 + S), -1, 0],
      [11, r(-S), 0],
      [11, r(10 + S), 0],
      [r(10 + S), 11, 0],
      [r(-S), 11, 0],
      [-1, r(10 + S), 0],
      [-1, r(-S), 0],
    ]);
    // Each chamfer is the offset distance from its vertex.
    const chamfer = { kind: 'LINE' as const, start: P(10 + S, -1), end: P(11, -S) };
    expect(r(closestPoint(chamfer, P(10, 0), TOL).distance)).toBe(1);
  });

  it('trims the inside of a corner as 0 does', () => {
    for (const gap of [1, 2] as const) {
      const o = offsetPolylineTraced(SQUARE, 1, TOL, gap)!;
      expect(o.polyline.vertices.map(xy)).toEqual([
        [1, 1],
        [9, 1],
        [9, 9],
        [1, 9],
      ]);
    }
  });

  it('fillets the corners between arcs and lines, and goes round a half turn', () => {
    // An open polyline: a line east, a CCW half circle up (bulge 1) turning back west, then a
    // line south. Offset outward (right, −1): the line–arc join is tangent (no gap); the arc to
    // the southward line turns left, its outside on the right.
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 1 },
        { x: 10, y: 4, bulge: 0 },
        { x: 8, y: 4, bulge: 0 },
        { x: 8, y: 0, bulge: 0 },
      ],
    };
    const o = offsetPolylineTraced(p, -1, TOL, 1)!;
    expect(o.from).toEqual([0, 1, 2, -1, 3]);
    const corner = o.polyline.vertices[3]!;
    // The fillet round (8,4): from the westward line's end (8,5) to the southward line's start
    // (7,4), a quarter turn CCW.
    expect([...xy(corner), r(corner.bulge)]).toEqual([8, 5, Q]);
    expect(xy(o.polyline.vertices[4]!)).toEqual([7, 4]);
    // A line straight back on itself: the fillet is a half circle round the turning point.
    const back: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 0, y: 0, bulge: 0 },
      ],
    };
    const b = offsetPolylineTraced(back, 1, TOL, 1)!;
    expect(b.polyline.vertices.map((v) => [...xy(v), r(v.bulge)])).toEqual([
      [0, 1, 0],
      [10, 1, -1],
      [10, -1, 0],
      [0, -1, 0],
    ]);
    // A chamfer has no bisector there: the segments are bridged straight, as with 0.
    const c = offsetPolylineTraced(back, 1, TOL, 2)!;
    expect(c.polyline.vertices.map(xy)).toEqual([
      [0, 1],
      [10, 1],
      [10, -1],
      [0, -1],
    ]);
  });
});

function P(x: number, y: number): Vec2 {
  return { x, y };
}
