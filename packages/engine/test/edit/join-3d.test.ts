// M3-18: JOIN of lines, straight 2D polylines and curves onto 3D polylines, as AutoCAD 2024 joins
// them (AutoCAD Help, "JOIN (Command)", 3D Polyline: "All linear or curved objects can be joined
// to a source 3D polyline. Selected objects must be contiguous but can be noncoplanar. The
// resulting object is a single 3D polyline if joining linear objects, or a single spline if
// joining curved objects"; Multiple objects: "joins multiple noncoplanar linear objects into a 3D
// polyline"). A sloped line's end heights ride along in the model (DEC-063); a curve makes a
// spline only with a 3D polyline at height 0, since a 3D spline is out of scope (PRD non-goal 1).
import { describe, expect, it } from 'vitest';
import {
  joinObjects,
  toleranceForSize,
  type EntityGeometry,
  type EntityId,
  type LineGeometry,
  type PolylineGeometry,
  type SplineGeometry,
} from '../../src/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1) as unknown as EntityId[];
const join = (gs: EntityGeometry[], source?: number, opts?: { curves?: boolean }) =>
  joinObjects(
    gs.map((geom, i) => ({ id: ids(gs.length)[i]!, geom })),
    source as EntityId | undefined,
    tol,
    opts,
  );

/** A line from (x1, y1, z1) to (x2, y2, z2): level ones at their elevation, sloped ones with heights. */
const line3 = (
  [x1, y1, z1]: [number, number, number],
  [x2, y2, z2]: [number, number, number],
): LineGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  ...(z1 !== z2 ? { heights: [z1, z2] as const } : z1 !== 0 ? { elevation: z1 } : {}),
});
const p3 = (pts: [number, number, number][], extra: Partial<PolylineGeometry> = {}) =>
  ({
    kind: 'POLYLINE',
    is3d: true,
    closed: false,
    vertices: pts.map(([x, y, z]) => ({ x, y, bulge: 0, ...(z !== 0 && { z }) })),
    ...extra,
  }) as PolylineGeometry;
const xyz = (g: EntityGeometry) =>
  (g as PolylineGeometry).vertices.map((v) => [r6(v.x), r6(v.y), r6(v.z ?? 0)]);

describe('JOIN onto a source 3D polyline (M3-18)', () => {
  it('takes sloped and level lines and straight 2D polylines meeting it in plan and height', () => {
    const r = join(
      [
        line3([10, 0, 5], [20, 0, 9]),
        p3([
          [0, 0, 0],
          [10, 0, 5],
        ]),
        // Level, at the height the chain has reached.
        line3([20, 0, 9], [20, 10, 9]),
        {
          kind: 'LWPOLYLINE',
          closed: false,
          elevation: 3,
          vertices: [
            { x: 0, y: 10, bulge: 0 },
            { x: -5, y: 10, bulge: 0 },
            { x: -5, y: 0, bulge: 0 },
          ],
        },
        line3([0, 0, 0], [0, 10, 3]),
      ],
      2,
    );
    expect(r.discarded).toBe(0);
    expect(r.joined).toHaveLength(1);
    expect(r.joined[0]).toMatchObject({ keep: 2, parts: [2, 1, 3, 4, 5], made: 'polyline' });
    const g = r.joined[0]!.geom as PolylineGeometry;
    expect(g).toMatchObject({ kind: 'POLYLINE', is3d: true, closed: false });
    expect(xyz(g)).toEqual([
      [-5, 0, 3],
      [-5, 10, 3],
      [0, 10, 3],
      [0, 0, 0],
      [10, 0, 5],
      [20, 0, 9],
      [20, 10, 9],
    ]);
  });

  it('leaves out lines meeting it in plan at another height, and closes back at its start', () => {
    const r = join(
      [
        p3([
          [0, 0, 0],
          [10, 0, 5],
        ]),
        line3([10, 0, 6], [20, 0, 6]),
        line3([10, 0, 5], [10, 10, 2]),
        line3([10, 10, 2], [0, 0, 0]),
      ],
      1,
    );
    expect(r.discarded).toBe(1);
    expect(r.joined[0]).toMatchObject({ keep: 1, parts: [1, 3, 4] });
    const g = r.joined[0]!.geom as PolylineGeometry;
    expect(g.closed).toBe(true);
    expect(xyz(g)).toEqual([
      [0, 0, 0],
      [10, 0, 5],
      [10, 10, 2],
    ]);
  });

  it('joins a spline-fit 3D polyline as the vertices it draws, its fit and frame gone', () => {
    const fitted = p3(
      [
        [0, 0, 0],
        [5, 2, 1],
        [10, 0, 2],
      ],
      {
        fit: 'cubic',
        frame: [
          { x: 0, y: 0 },
          { x: 5, y: 4, z: 1 },
          { x: 10, y: 0, z: 2 },
        ],
      },
    );
    const r = join([fitted, line3([10, 0, 2], [15, 0, 4])], 1);
    expect(r.joined).toHaveLength(1);
    const g = r.joined[0]!.geom as PolylineGeometry;
    expect(g.fit).toBeUndefined();
    expect(g.frame).toBeUndefined();
    expect(xyz(g)).toEqual([
      [0, 0, 0],
      [5, 2, 1],
      [10, 0, 2],
      [15, 0, 4],
    ]);
  });

  it('makes a spline of a 3D polyline at height 0 and the curves meeting it', () => {
    const r = join(
      [
        p3([
          [0, 0, 0],
          [10, 0, 0],
        ]),
        {
          kind: 'ARC',
          center: { x: 15, y: 0 },
          radius: 5,
          startAngle: Math.PI,
          endAngle: 0,
        },
        line3([20, 0, 0], [20, -5, 0]),
      ],
      1,
    );
    expect(r.discarded).toBe(0);
    expect(r.joined[0]).toMatchObject({ keep: 1, parts: [1, 2, 3], made: 'spline' });
    const s = r.joined[0]!.geom as SplineGeometry;
    expect(s.kind).toBe('SPLINE');
    const cv = s.controlPoints;
    expect([cv[0], cv.at(-1)].map((p) => [r6(p!.x), r6(p!.y)])).toEqual([
      [0, 0],
      [20, -5],
    ]);
  });

  it('leaves out curves meeting a 3D polyline that has heights: a 3D spline is out of scope', () => {
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 15, y: 0 },
      radius: 5,
      startAngle: Math.PI,
      endAngle: 0,
    };
    const r = join(
      [
        p3([
          [10, 0, 0],
          [10, 5, 4],
        ]),
        arc,
        line3([10, 5, 4], [0, 5, 4]),
      ],
      1,
    );
    expect(r.discarded).toBe(1);
    expect(r.joined[0]).toMatchObject({ parts: [1, 3], made: 'polyline' });
    // Nor does a level 3D polyline at a height other than 0: a spline has no elevation.
    const high = join(
      [
        p3([
          [0, 0, 2],
          [10, 0, 2],
        ]),
        { ...arc, elevation: 2 },
      ],
      1,
    );
    expect(high).toEqual({ joined: [], discarded: 2 });
  });

  it('takes no curves when asked for linear objects only (PEDIT Join)', () => {
    const r = join(
      [
        p3([
          [0, 0, 0],
          [10, 0, 0],
        ]),
        { kind: 'ARC', center: { x: 15, y: 0 }, radius: 5, startAngle: Math.PI, endAngle: 0 },
        line3([0, 0, 0], [0, 5, 0]),
      ],
      1,
      { curves: false },
    );
    expect(r.joined[0]).toMatchObject({ parts: [1, 3], made: 'polyline' });
    expect(r.discarded).toBe(1);
  });
});

describe('JOIN of several objects at once with sloped lines (M3-18)', () => {
  it('joins noncoplanar lines meeting end to end into a 3D polyline', () => {
    const r = join([
      line3([0, 0, 0], [10, 0, 0]),
      line3([10, 0, 0], [10, 10, 4]),
      line3([10, 10, 4], [0, 10, 4]),
    ]);
    expect(r.joined).toHaveLength(1);
    expect(r.joined[0]).toMatchObject({ keep: 1, parts: [1, 2, 3], made: 'polyline' });
    const g = r.joined[0]!.geom as PolylineGeometry;
    expect(g).toMatchObject({ kind: 'POLYLINE', is3d: true });
    expect(xyz(g)).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 4],
      [0, 10, 4],
    ]);
  });

  it('joins lines and 3D polylines meeting a 3D polyline into it, the first 3D polyline kept', () => {
    const r = join([
      line3([0, 0, 0], [0, 10, 0]),
      p3([
        [0, 0, 0],
        [10, 0, 5],
      ]),
      line3([10, 0, 5], [20, 0, 5]),
    ]);
    expect(r.joined).toHaveLength(1);
    expect(r.joined[0]).toMatchObject({ keep: 2, parts: [1, 2, 3] });
    expect(xyz(r.joined[0]!.geom)).toEqual([
      [0, 10, 0],
      [0, 0, 0],
      [10, 0, 5],
      [20, 0, 5],
    ]);
  });

  it('still joins level lines at one elevation into a 2D polyline', () => {
    const r = join([line3([0, 0, 2], [10, 0, 2]), line3([10, 0, 2], [10, 10, 2])]);
    expect(r.joined[0]!.geom).toMatchObject({ kind: 'LWPOLYLINE', elevation: 2 });
  });

  it('joins sloped lines on one 3D line into one sloped line over their extremes', () => {
    const r = join([line3([0, 0, 0], [10, 0, 5]), line3([14, 0, 7], [20, 0, 10])]);
    expect(r.joined).toHaveLength(1);
    expect(r.joined[0]).toMatchObject({ keep: 1, parts: [1, 2], made: 'line' });
    const l = r.joined[0]!.geom as LineGeometry;
    expect([l.start, l.end].map((p) => [r6(p.x), r6(p.y)])).toEqual([
      [0, 0],
      [20, 0],
    ]);
    expect(l.heights).toEqual([0, 10]);
    // Collinear in plan only, at another slope, they stay apart; so do a sloped and a level one.
    expect(join([line3([0, 0, 0], [10, 0, 5]), line3([14, 0, 0], [20, 0, 10])]).joined).toEqual([]);
    expect(join([line3([0, 0, 0], [10, 0, 5]), line3([14, 0, 0], [20, 0, 0])]).joined).toEqual([]);
  });

  it('leaves sloped lines out of 2D polylines and splines', () => {
    const r = join([
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 0 },
        ],
      },
      line3([10, 0, 0], [10, 10, 3]),
    ]);
    // With no 3D polyline among them, the sloped line still makes the chain a 3D one.
    expect(r.joined[0]).toMatchObject({ keep: 2, made: 'polyline' });
    expect(r.joined[0]!.geom).toMatchObject({ kind: 'POLYLINE', is3d: true });
    const s = join(
      [
        {
          kind: 'SPLINE',
          degree: 2,
          knots: [0, 0, 0, 1, 1, 1],
          controlPoints: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 0 },
          ],
          closed: false,
          periodic: false,
        },
        line3([10, 0, 0], [20, 0, 3]),
      ],
      1,
    );
    expect(s).toEqual({ joined: [], discarded: 2 });
  });
});
