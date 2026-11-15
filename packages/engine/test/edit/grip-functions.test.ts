// M3-05 part 1: multi-functional grips (AutoCAD 2024 Help, "To Modify Polylines With Grips";
// "The Stretch and Lengthen Commands": a line's or arc's end grip offers Stretch and Lengthen,
// which behaves as LENGTHEN's Dynamic method). What each grip offers and what each function does.
import { describe, expect, it } from 'vitest';
import {
  gripFunctionEdit,
  gripFunctionsOf,
  moveGripBy,
  toleranceForSize,
  type ArcGeometry,
  type EntityGeometry,
  type LwPolylineGeometry,
  type PolylineGeometry,
  type PolylineVertex,
} from '../../src/index';
import { lineGeom } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const tol = toleranceForSize(100);
const P = (x: number, y: number) => ({ x, y });

const lw = (vertices: readonly PolylineVertex[], closed = false): LwPolylineGeometry => ({
  kind: 'LWPOLYLINE',
  closed,
  vertices,
});
const v = (x: number, y: number, bulge = 0, w?: [number, number]): PolylineVertex => ({
  x,
  y,
  bulge,
  ...(w && { startWidth: w[0], endWidth: w[1] }),
});
/** An open L: (0,0) (10,0) (10,10). */
const ell = lw([v(0, 0), v(10, 0), v(10, 10)]);
const verts = (g: EntityGeometry | string) => {
  if (typeof g === 'string') throw new Error(g);
  const p = g as LwPolylineGeometry;
  return p.vertices.map((x) => [r6(x.x), r6(x.y), r6(x.bulge)]);
};
const arc: ArcGeometry = {
  kind: 'ARC',
  center: P(0, 0),
  radius: 10,
  startAngle: 0,
  endAngle: Math.PI / 2,
};

describe('gripFunctionsOf', () => {
  it('a line: Stretch and Lengthen at its ends; its midpoint has one function', () => {
    const l = lineGeom(0, 0, 10, 0);
    expect(gripFunctionsOf(l, P(0, 0))).toEqual(['Stretch', 'Lengthen']);
    expect(gripFunctionsOf(l, P(10, 0))).toEqual(['Stretch', 'Lengthen']);
    expect(gripFunctionsOf(l, P(5, 0))).toEqual([]);
    expect(gripFunctionsOf(l, P(3, 3))).toEqual([]);
  });

  it('an arc: Stretch and Lengthen at its ends, Stretch and Radius at its midpoint', () => {
    expect(gripFunctionsOf(arc, P(10, 0))).toEqual(['Stretch', 'Lengthen']);
    expect(gripFunctionsOf(arc, P(0, 10))).toEqual(['Stretch', 'Lengthen']);
    const mid = P(10 * Math.SQRT1_2, 10 * Math.SQRT1_2);
    expect(gripFunctionsOf(arc, mid)).toEqual(['Stretch', 'Radius']);
    expect(gripFunctionsOf(arc, P(0, 0))).toEqual([]);
  });

  it('a polyline: vertex, end vertex and segment midpoint functions', () => {
    expect(gripFunctionsOf(ell, P(10, 0))).toEqual([
      'Stretch Vertex',
      'Add Vertex',
      'Remove Vertex',
    ]);
    expect(gripFunctionsOf(ell, P(0, 0))).toEqual([
      'Stretch Vertex',
      'Add Vertex',
      'Remove Vertex',
      'Extend Vertex',
    ]);
    expect(gripFunctionsOf(ell, P(10, 10))).toContain('Extend Vertex');
    expect(gripFunctionsOf(ell, P(5, 0))).toEqual(['Stretch', 'Add Vertex', 'Convert to Arc']);
    // A closed polyline has no ends to extend.
    expect(gripFunctionsOf(lw(ell.vertices, true), P(0, 0))).not.toContain('Extend Vertex');
  });

  it('an arc segment shows its midpoint grip, which converts it to a line', () => {
    const g = lw([v(0, 0, 1), v(10, 0)]);
    // Bulge 1 from (0,0) to (10,0): a half circle counterclockwise, below the chord.
    expect(gripFunctionsOf(g, P(5, -5))).toEqual(['Stretch', 'Add Vertex', 'Convert to Line']);
  });

  it('heavy 2D polylines have them; 3D and fitted ones do not', () => {
    const heavy: PolylineGeometry = {
      kind: 'POLYLINE',
      vertices: ell.vertices,
      closed: false,
      is3d: false,
    };
    expect(gripFunctionsOf(heavy, P(10, 0))).toEqual([
      'Stretch Vertex',
      'Add Vertex',
      'Remove Vertex',
    ]);
    expect(gripFunctionsOf({ ...heavy, is3d: true }, P(10, 0))).toEqual([]);
    expect(gripFunctionsOf({ ...heavy, fit: 'curve' }, P(10, 0))).toEqual([]);
  });

  it('objects without multi-functional grips', () => {
    expect(gripFunctionsOf({ kind: 'CIRCLE', center: P(0, 0), radius: 2 }, P(2, 0))).toEqual([]);
  });
});

describe('gripFunctionEdit: lines and arcs', () => {
  it('Lengthen carries a line on along itself to the point square with the cursor', () => {
    const r = gripFunctionEdit(lineGeom(0, 0, 10, 0), P(10, 0), 'Lengthen', P(14, 3), tol);
    expect(r).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 14, y: 0 } });
    const s = gripFunctionEdit(lineGeom(0, 0, 10, 0), P(0, 0), 'Lengthen', P(4, -2), tol);
    expect(s).toMatchObject({ start: { x: 4, y: 0 }, end: { x: 10, y: 0 } });
    // Behind the fixed end there is no length.
    expect(gripFunctionEdit(lineGeom(0, 0, 10, 0), P(10, 0), 'Lengthen', P(-1, 0), tol)).toBe(
      'invalid',
    );
  });

  it('Lengthen carries an arc round its circle', () => {
    const r = gripFunctionEdit(arc, P(0, 10), 'Lengthen', P(-5, 5), tol) as ArcGeometry;
    expect(r6(r.endAngle)).toBe(r6((3 * Math.PI) / 4));
    expect(r.startAngle).toBe(0);
    const s = gripFunctionEdit(arc, P(10, 0), 'Lengthen', P(5, 5), tol) as ArcGeometry;
    expect(r6(s.startAngle)).toBe(r6(Math.PI / 4));
    expect(r6(s.endAngle)).toBe(r6(Math.PI / 2));
  });

  it('Radius keeps the centre and the angles', () => {
    const mid = P(10 * Math.SQRT1_2, 10 * Math.SQRT1_2);
    const r = gripFunctionEdit(arc, mid, 'Radius', P(0, 4), tol) as ArcGeometry;
    expect(r).toMatchObject({ center: { x: 0, y: 0 }, radius: 4, startAngle: 0 });
    expect(gripFunctionEdit(arc, mid, 'Radius', P(0, 0), tol)).toBe('invalid');
  });

  it('a function the grip does not have', () => {
    expect(gripFunctionEdit(lineGeom(0, 0, 10, 0), P(5, 0), 'Lengthen', P(9, 9), tol)).toBe(
      'invalid',
    );
  });
});

describe('gripFunctionEdit: polylines', () => {
  it('Add Vertex at a vertex: the new vertex follows it', () => {
    expect(verts(gripFunctionEdit(ell, P(0, 0), 'Add Vertex', P(5, -2), tol))).toEqual([
      [0, 0, 0],
      [5, -2, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    // At the last vertex of an open polyline it goes before it.
    expect(verts(gripFunctionEdit(ell, P(10, 10), 'Add Vertex', P(12, 5), tol))).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [12, 5, 0],
      [10, 10, 0],
    ]);
    // At the last vertex of a closed one it goes on the closing segment.
    const closed = lw(ell.vertices, true);
    expect(verts(gripFunctionEdit(closed, P(10, 10), 'Add Vertex', P(4, 6), tol))).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [4, 6, 0],
    ]);
  });

  it('Add Vertex at a segment midpoint splits that segment', () => {
    expect(verts(gripFunctionEdit(ell, P(10, 5), 'Add Vertex', P(12, 5), tol))).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [12, 5, 0],
      [10, 10, 0],
    ]);
  });

  it('Add Vertex on an arc segment keeps both halves on the circle through the new vertex', () => {
    const g = lw([v(0, 0, 1), v(10, 0)]);
    const out = verts(gripFunctionEdit(g, P(5, -5), 'Add Vertex', P(5, -5), tol));
    const quarter = r6(Math.tan(Math.PI / 8));
    expect(out).toEqual([
      [0, 0, quarter],
      [5, -5, quarter],
      [10, 0, 0],
    ]);
    // A new vertex on the chord's line: both halves straight.
    expect(verts(gripFunctionEdit(g, P(5, -5), 'Add Vertex', P(5, 0), tol))).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
    ]);
  });

  it('Add Vertex shares the split segment’s widths', () => {
    const g = lw([v(0, 0, 0, [2, 4]), v(10, 0)]);
    const r = gripFunctionEdit(g, P(5, 0), 'Add Vertex', P(5, 1), tol) as LwPolylineGeometry;
    expect(r.vertices.map((x) => [x.startWidth, x.endWidth])).toEqual([
      [2, 3],
      [3, 4],
      [undefined, undefined],
    ]);
  });

  it('Remove Vertex joins its neighbours with a straight segment', () => {
    expect(verts(gripFunctionEdit(ell, P(10, 0), 'Remove Vertex', P(0, 0), tol))).toEqual([
      [0, 0, 0],
      [10, 10, 0],
    ]);
    expect(verts(gripFunctionEdit(ell, P(0, 0), 'Remove Vertex', P(0, 0), tol))).toEqual([
      [10, 0, 0],
      [10, 10, 0],
    ]);
    // Closed: the vertex before the first is the last.
    const square = lw([v(0, 0), v(10, 0), v(10, 10), v(0, 10)], true);
    expect(verts(gripFunctionEdit(square, P(0, 0), 'Remove Vertex', P(0, 0), tol))).toEqual([
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ]);
    // Two vertices are the fewest a polyline keeps.
    expect(gripFunctionEdit(lw([v(0, 0), v(10, 0)]), P(0, 0), 'Remove Vertex', P(0, 0), tol)).toBe(
      'too few',
    );
  });

  it('Remove Vertex between two arcs of one circle keeps one arc', () => {
    const t = Math.tan(Math.PI / 8);
    const g = lw([v(0, 0, t), v(5, -5, t), v(10, 0)]);
    expect(verts(gripFunctionEdit(g, P(5, -5), 'Remove Vertex', P(0, 0), tol))).toEqual([
      [0, 0, 1],
      [10, 0, 0],
    ]);
  });

  it('Remove Vertex takes the segment widths from either side', () => {
    const g = lw([v(0, 0, 0, [1, 2]), v(5, 0, 0, [3, 4]), v(10, 0)]);
    const r = gripFunctionEdit(g, P(5, 0), 'Remove Vertex', P(0, 0), tol) as LwPolylineGeometry;
    expect(r.vertices.map((x) => [x.x, x.startWidth, x.endWidth])).toEqual([
      [0, 1, 4],
      [10, undefined, undefined],
    ]);
  });

  it('Extend Vertex adds a straight segment beyond an end', () => {
    expect(verts(gripFunctionEdit(ell, P(10, 10), 'Extend Vertex', P(0, 10), tol))).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ]);
    expect(verts(gripFunctionEdit(ell, P(0, 0), 'Extend Vertex', P(0, -5), tol))).toEqual([
      [0, -5, 0],
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    // An arc that ended the polyline stays an arc; the new segment from it is straight.
    const g = lw([v(0, 0, 1), v(10, 0, 0)]);
    expect(verts(gripFunctionEdit(g, P(10, 0), 'Extend Vertex', P(20, 0), tol))).toEqual([
      [0, 0, 1],
      [10, 0, 0],
      [20, 0, 0],
    ]);
    expect(gripFunctionEdit(ell, P(10, 0), 'Extend Vertex', P(0, 10), tol)).toBe('invalid');
  });

  it('Convert to Arc makes the arc through the segment’s ends and the point', () => {
    expect(verts(gripFunctionEdit(ell, P(5, 0), 'Convert to Arc', P(5, -5), tol))).toEqual([
      [0, 0, 1],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    expect(verts(gripFunctionEdit(ell, P(5, 0), 'Convert to Arc', P(5, 5), tol))).toEqual([
      [0, 0, -1],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    // On the segment's line there is no arc.
    expect(gripFunctionEdit(ell, P(5, 0), 'Convert to Arc', P(7, 0), tol)).toBe('invalid');
  });

  it('Convert to Line straightens an arc segment', () => {
    const g = lw([v(0, 0, 1), v(10, 0)]);
    expect(verts(gripFunctionEdit(g, P(5, -5), 'Convert to Line', P(0, 0), tol))).toEqual([
      [0, 0, 0],
      [10, 0, 0],
    ]);
  });

  it('keeps a constant width and the heavy polyline’s kind', () => {
    const g = { ...ell, constantWidth: 2 };
    const r = gripFunctionEdit(g, P(5, 0), 'Add Vertex', P(5, 1), tol) as LwPolylineGeometry;
    expect(r.constantWidth).toBe(2);
    expect(r.vertices.every((x) => x.startWidth === undefined)).toBe(true);
    const heavy: PolylineGeometry = {
      kind: 'POLYLINE',
      vertices: ell.vertices,
      closed: false,
      is3d: false,
    };
    expect(gripFunctionEdit(heavy, P(10, 0), 'Remove Vertex', P(0, 0), tol)).toMatchObject({
      kind: 'POLYLINE',
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
  });
});

describe('moveGripBy', () => {
  it('Stretch is the STRETCH grip mode; another function reshapes, or does nothing', () => {
    expect(
      moveGripBy(lineGeom(0, 0, 10, 0), P(10, 0), P(10, 5), undefined, 'Stretch'),
    ).toMatchObject({ kind: 'shape', geom: { end: { x: 10, y: 5 } } });
    expect(
      moveGripBy(lineGeom(0, 0, 10, 0), P(10, 0), P(12, 5), undefined, 'Lengthen'),
    ).toMatchObject({ kind: 'shape', geom: { end: { x: 12, y: 0 } } });
    expect(moveGripBy(lineGeom(0, 0, 10, 0), P(10, 0), P(-5, 5), undefined, 'Lengthen')).toEqual({
      kind: 'none',
    });
  });

  it('an arc segment’s midpoint grip stretches the arc through its ends', () => {
    const g = lw([v(0, 0, 1), v(10, 0)]);
    const r = moveGripBy(g, P(5, -5), P(5, 5), undefined, undefined);
    expect(r.kind === 'shape' && verts(r.geom)).toEqual([
      [0, 0, -1],
      [10, 0, 0],
    ]);
  });
});
