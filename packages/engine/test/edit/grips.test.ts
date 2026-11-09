// M2-06 part 2: where objects show their grips and what the STRETCH grip mode does to each
// (AutoCAD 2024 Help, "Grips Reference").
import { describe, expect, it } from 'vitest';
import { gripsOf, moveGrip, type ArcGeometry, type EntityGeometry } from '../../src/index';
import { circleGeom, lineGeom } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pts = (g: EntityGeometry) => gripsOf(g).map((x) => [r6(x.point.x), r6(x.point.y), x.kind]);
const shape = (g: EntityGeometry, grip: { x: number; y: number }, to: { x: number; y: number }) => {
  const r = moveGrip(g, grip, to);
  if (r.kind !== 'shape') throw new Error(`expected a shape, got ${r.kind}`);
  return r.geom;
};

describe('gripsOf', () => {
  it('a line: its ends stretch, its midpoint moves it', () => {
    expect(pts(lineGeom(0, 0, 10, 0))).toEqual([
      [0, 0, 'stretch'],
      [5, 0, 'move'],
      [10, 0, 'stretch'],
    ]);
  });

  it('a circle: its centre and four quadrants', () => {
    expect(pts(circleGeom(0, 0, 2))).toEqual([
      [0, 0, 'move'],
      [2, 0, 'radius'],
      [0, 2, 'radius'],
      [-2, 0, 'radius'],
      [0, -2, 'radius'],
    ]);
  });

  it('a polyline: its vertices, and the midpoints of its straight segments', () => {
    expect(
      pts({
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 1 },
          { x: 10, y: 10, bulge: 0 },
        ],
      }),
    ).toEqual([
      [0, 0, 'stretch'],
      [10, 0, 'stretch'],
      [10, 10, 'stretch'],
      [5, 0, 'segment'],
    ]);
  });
});

describe('moveGrip', () => {
  it('stretches a line’s end and moves it by its midpoint', () => {
    expect(shape(lineGeom(0, 0, 10, 0), { x: 10, y: 0 }, { x: 10, y: 5 })).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 5 },
    });
    expect(moveGrip(lineGeom(0, 0, 10, 0), { x: 5, y: 0 }, { x: 7, y: 7 }).kind).toBe('move');
    expect(moveGrip(lineGeom(0, 0, 10, 0), { x: 3, y: 0 }, { x: 7, y: 7 }).kind).toBe('none');
  });

  it('sets a circle’s radius by a quadrant', () => {
    expect(shape(circleGeom(0, 0, 2), { x: 2, y: 0 }, { x: 3, y: 4 })).toMatchObject({ radius: 5 });
  });

  it('reshapes an arc through its ends and the dragged midpoint', () => {
    const arc: ArcGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI,
    };
    // The top of a half circle r 1 dragged to (0, 3): the arc through (1,0), (0,3), (−1,0).
    const a = shape(arc, { x: 0, y: 1 }, { x: 0, y: 3 }) as ArcGeometry;
    expect([r6(a.center.x), r6(a.center.y), r6(a.radius)]).toEqual([0, r6(4 / 3), r6(5 / 3)]);
    const end = (t: number) => [
      r6(a.center.x + a.radius * Math.cos(t)),
      r6(a.center.y + a.radius * Math.sin(t)),
    ];
    expect(end(a.startAngle)).toEqual([1, 0]);
    expect(end(a.endAngle)).toEqual([-1, 0]);
    // Dragged below the chord: the arc runs the other way round.
    const b = shape(arc, { x: 0, y: 1 }, { x: 0, y: -0.5 }) as ArcGeometry;
    const endB = (t: number) => [
      r6(b.center.x + b.radius * Math.cos(t)),
      r6(b.center.y + b.radius * Math.sin(t)),
    ];
    expect(endB(b.startAngle)).toEqual([-1, 0]);
    expect(endB(b.endAngle)).toEqual([1, 0]);
  });

  it('moves a straight polyline segment by its midpoint', () => {
    const g = shape(
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 0 },
          { x: 10, y: 10, bulge: 0 },
        ],
      },
      { x: 5, y: 0 },
      { x: 5, y: -2 },
    );
    expect(g.kind === 'LWPOLYLINE' && g.vertices.map((v) => [v.x, v.y])).toEqual([
      [0, -2],
      [10, -2],
      [10, 10],
    ]);
  });
});
