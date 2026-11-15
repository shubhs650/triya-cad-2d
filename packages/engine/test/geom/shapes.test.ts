// M3-01 part 3: the shapes RECTANG and POLYGON draw, and a drawn arc's bulge (geom/shapes.ts).
import { describe, expect, it } from 'vitest';
import {
  bulgeOf,
  cornersArea,
  polygonAbout,
  polygonOnEdge,
  rectangleVertices,
  toleranceForSize,
} from '../../src/index';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const xy = (vs: readonly { x: number; y: number; bulge: number }[]) =>
  vs.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)]);
const tol = toleranceForSize(100);

describe('shapes', () => {
  it('gives a drawn arc the bulge of its sweep, clockwise negative', () => {
    const arc = { center: { x: 0, y: 0 }, radius: 1, startAngle: 0 };
    expect(bulgeOf({ ...arc, sweep: Math.PI })).toBeCloseTo(1);
    expect(bulgeOf({ ...arc, sweep: -Math.PI / 2 })).toBeCloseTo(-Math.tan(Math.PI / 8));
  });

  it('turns a rectangle and cuts its corners clockwise too', () => {
    expect(xy(rectangleVertices({ x: 1, y: 1 }, 4, 2, Math.PI / 2, undefined, tol))).toEqual([
      [1, 1, 0],
      [1, 5, 0],
      [-1, 5, 0],
      [-1, 1, 0],
    ]);
    // Length and width of opposite signs go round clockwise: fillets bulge negative.
    const cw = rectangleVertices({ x: 0, y: 0 }, 10, -5, 0, { kind: 'fillet', radius: 1 }, tol);
    expect(cw.filter((v) => v.bulge !== 0).every((v) => v.bulge < 0)).toBe(true);
    // A chamfer of 0 by 0 leaves the corners square.
    const square = { kind: 'chamfer', first: 0, second: 0 } as const;
    expect(rectangleVertices({ x: 0, y: 0 }, 2, 2, 0, square, tol)).toHaveLength(4);
  });

  it('counts the area corners take: fillets and chamfers', () => {
    expect(cornersArea(undefined)).toBe(0);
    expect(cornersArea({ kind: 'fillet', radius: 1 })).toBeCloseTo(4 - Math.PI);
    expect(cornersArea({ kind: 'chamfer', first: 1, second: 2 })).toBe(4);
  });

  it('places polygons about a centre and on an edge', () => {
    // A typed radius: the bottom edge level, inscribed or circumscribed alike.
    const square = polygonAbout({ x: 0, y: 0 }, 1, 4, false);
    expect(xy(square)).toEqual([
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
    ]);
    // An edge from right to left puts the polygon below it.
    expect(xy(polygonOnEdge({ x: 2, y: 0 }, { x: 0, y: 0 }, 4))).toEqual([
      [2, 0, 0],
      [0, 0, 0],
      [0, -2, 0],
      [2, -2, 0],
    ]);
  });
});
