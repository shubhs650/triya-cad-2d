// M3-03: where ARRAYRECT, ARRAYPOLAR and ARRAYPATH put their items (AutoCAD 2024 Help,
// "ARRAYRECT (Command)", "ARRAYPOLAR (Command)", "ARRAYPATH (Command)").
import { describe, expect, it } from 'vitest';
import {
  applyPoint,
  arrayPath,
  measureMaxItems,
  pathCurveOf,
  pathItems,
  pathStart,
  pathStations,
  polarAngleBetween,
  polarItems,
  rectangularItems,
  type BoundedCurve,
  type EntityGeometry,
  type PathArray,
  type Similarity,
  type Vec2,
} from '../../src/index';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const at = (t: Similarity, p: Vec2) => {
  const q = applyPoint(t.m, p);
  return [r6(q.x), r6(q.y)];
};
/** The turn in degrees, in (−180, 180]. */
const turn = (t: Similarity) => {
  const d = r6((t.angle * 180) / Math.PI);
  return d > 180 ? d - 360 : d;
};

describe('rectangular arrays', () => {
  it('runs row by row from the source along X and Y', () => {
    const items = rectangularItems({ columns: 3, rows: 2, columnSpacing: 5, rowSpacing: -2 });
    expect(items.map((t) => at(t, { x: 0, y: 0 }))).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [0, -2],
      [5, -2],
      [10, -2],
    ]);
  });
});

describe('polar arrays', () => {
  it('shares a full circle among the items, and puts a part circle between the first and last', () => {
    expect(r6(polarAngleBetween(6, 2 * Math.PI))).toBe(r6(Math.PI / 3));
    expect(r6(polarAngleBetween(5, Math.PI))).toBe(r6(Math.PI / 4));
    expect(r6(polarAngleBetween(4, -Math.PI / 2))).toBe(r6(-Math.PI / 6));
    expect(polarAngleBetween(1, Math.PI)).toBe(0);
  });

  const base = {
    center: { x: 0, y: 0 },
    base: { x: 10, y: 0 },
    items: 4,
    fillAngle: 2 * Math.PI,
    rows: 1,
    rowSpacing: 3,
    rotateItems: true,
  };

  it('turns each item about the centre', () => {
    const items = polarItems(base);
    expect(items.map((t) => at(t, { x: 10, y: 1 }))).toEqual([
      [10, 1],
      [-1, 10],
      [-10, -1],
      [1, -10],
    ]);
    expect(items.map(turn)).toEqual([0, 90, 180, -90]);
  });

  it('moves items without turning them when ROTate items is No', () => {
    const items = polarItems({ ...base, rotateItems: false, fillAngle: -Math.PI, items: 3 });
    expect(items.map((t) => at(t, { x: 10, y: 1 }))).toEqual([
      [10, 1],
      [0, -9],
      [-10, 1],
    ]);
    expect(items.map(turn)).toEqual([0, 0, 0]);
  });

  it('puts rows on rings outward from the centre', () => {
    const items = polarItems({ ...base, rows: 2 });
    expect(items).toHaveLength(8);
    expect(at(items[4]!, { x: 10, y: 0 })).toEqual([13, 0]);
    expect(at(items[5]!, { x: 10, y: 0 })).toEqual([0, 13]);
    // A base point on the centre has no outward direction: rings grow along each item's turn.
    const centred = polarItems({ ...base, base: { x: 0, y: 0 }, rows: 2, rotateItems: false });
    expect(at(centred[5]!, { x: 0, y: 0 })).toEqual([0, 3]);
  });
});

describe('path curves', () => {
  it('takes curves and refuses the rest', () => {
    const kinds: EntityGeometry[] = [
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: 'ARC', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: 1 },
      { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 },
      {
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 2, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: Math.PI,
      },
      {
        kind: 'POLYLINE',
        closed: true,
        is3d: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 1, y: 0, bulge: 0.5 },
        ],
      },
      {
        kind: 'SPLINE',
        degree: 1,
        knots: [0, 0, 1, 1],
        controlPoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        closed: false,
        periodic: false,
      },
    ];
    expect(kinds.map((g) => pathCurveOf(g)?.closed)).toEqual([
      false,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(pathCurveOf({ kind: 'POINT', position: { x: 0, y: 0 } })).toBeUndefined();
    expect(
      pathCurveOf({ kind: 'LWPOLYLINE', closed: false, vertices: [{ x: 0, y: 0, bulge: 0 }] }),
    ).toBeUndefined();
    // A 3D polyline is followed as drawn on XY, its segments straight.
    const p3 = pathCurveOf({
      kind: 'POLYLINE',
      closed: false,
      is3d: true,
      vertices: [
        { x: 0, y: 0, bulge: 0.5 },
        { x: 1, y: 0, bulge: 0 },
      ],
    });
    expect(p3?.curve.kind === 'LWPOLYLINE' && p3.curve.vertices[0]!.bulge).toBe(0);
  });

  it('fits as many items as the spacing allows, one fewer round a closed path', () => {
    const open = arrayPath(
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      false,
      false,
    );
    expect(measureMaxItems(open, 2.5)).toBe(5);
    expect(measureMaxItems(open, 3)).toBe(4);
    expect(measureMaxItems(open, 0)).toBe(1);
    const ring = arrayPath({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, true, false);
    expect(measureMaxItems(ring, Math.PI / 2)).toBe(4);
  });
});

describe('path arrays', () => {
  // An L: 10 along +X, then 10 up.
  const ell: BoundedCurve = {
    kind: 'LWPOLYLINE',
    closed: false,
    vertices: [
      { x: 0, y: 0, bulge: 0 },
      { x: 10, y: 0, bulge: 0 },
      { x: 10, y: 10, bulge: 0 },
    ],
  };
  const path = arrayPath(ell, false, false);
  const a: PathArray = {
    path,
    base: pathStart(path),
    method: 'measure',
    spacing: 5,
    items: 5,
    rows: 1,
    rowSpacing: 2,
    align: true,
  };

  it('spaces items by distance along the path, or divides it evenly', () => {
    expect(pathStations(a)).toEqual([0, 5, 10, 15, 20]);
    expect(pathStations({ ...a, method: 'divide', items: 3 })).toEqual([0, 10, 20]);
    expect(pathStations({ ...a, method: 'divide', items: 1 })).toEqual([0]);
    const ring = arrayPath({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, true, false);
    expect(pathStations({ ...a, path: ring, method: 'divide', items: 4 }).map(r6)).toEqual(
      [0, 0.5, 1, 1.5].map((k) => r6(k * Math.PI)),
    );
  });

  it('carries the base point to each station and turns items with the path', () => {
    const items = pathItems(a);
    expect(items.map((t) => at(t, { x: 0, y: 1 }))).toEqual([
      [0, 1],
      [5, 1],
      [9, 0],
      [9, 5],
      [9, 10],
    ]);
    expect(items.map(turn)).toEqual([0, 0, 90, 90, 90]);
  });

  it('keeps items upright when not aligned, and offsets rows to the left', () => {
    const items = pathItems({ ...a, align: false, items: 3, rows: 2 });
    expect(items.map((t) => at(t, { x: 0, y: 0 }))).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [0, 2],
      [5, 2],
      [8, 0],
    ]);
  });

  it('runs from the other end when reversed, and turns by the tangent vector given', () => {
    const back = arrayPath(ell, false, true);
    expect(pathStart(back)).toEqual({ x: 10, y: 10 });
    const items = pathItems({ ...a, path: back, base: { x: 10, y: 10 }, items: 2, spacing: 15 });
    expect(items.map((t) => at(t, { x: 10, y: 10 }))).toEqual([
      [10, 10],
      [5, 0],
    ]);
    // Travelling down, then left: a quarter turn clockwise.
    expect(items.map(turn)).toEqual([0, -90]);
    // A tangent vector along +Y turns even the first item to the path (down: 180°).
    const tangent = pathItems({
      ...a,
      path: back,
      base: { x: 10, y: 10 },
      items: 1,
      tangent: { x: 0, y: 1 },
    });
    expect(tangent.map(turn)).toEqual([180]);
  });
});
