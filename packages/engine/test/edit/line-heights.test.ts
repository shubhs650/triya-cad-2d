// M3-18 (DEC-063): a sloped LINE carries its end heights in the model. A command that cuts or
// lengthens it along itself (BREAK, TRIM, EXTEND, LENGTHEN, FILLET, CHAMFER) gives a new end the
// height of the 3D line at that point; REVERSE swaps them; a level line keeps its elevation.
import { describe, expect, it } from 'vitest';
import {
  breakCurveOf,
  breakGeometry,
  closestPoint,
  cutLeg,
  extendGeometry,
  lengthenGeometry,
  reverseGeometry,
  toleranceForSize,
  type Curve,
  type EntityGeometry,
  type LineGeometry,
  type Vec2,
} from '../../src/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** From (0, 0) at height 0 to (10, 0) at height 5. */
const sloped: LineGeometry = {
  kind: 'LINE',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  heights: [0, 5],
};
const level: LineGeometry = {
  kind: 'LINE',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  elevation: 3,
};

/** A line's plan ends and heights, rounded. */
const shape = (g: EntityGeometry | string | undefined) => {
  const l = g as LineGeometry;
  return {
    ends: [l.start, l.end].map((p) => [r6(p.x), r6(p.y)]),
    heights: l.heights?.map(r6),
    elevation: l.elevation,
  };
};

function broken(g: EntityGeometry, p1: Vec2, p2: Vec2) {
  const c = breakCurveOf(g)!;
  return breakGeometry(g, c, closestPoint(c, p1, tol).t, closestPoint(c, p2, tol).t, tol) as
    EntityGeometry[] | undefined;
}

describe('a sloped line edited along itself (DEC-063)', () => {
  it('gives BREAK’s pieces the heights of the 3D line where it was broken', () => {
    expect(broken(sloped, { x: 2, y: 0 }, { x: 6, y: 0 })!.map(shape)).toEqual([
      {
        ends: [
          [0, 0],
          [2, 0],
        ],
        heights: [0, 1],
        elevation: undefined,
      },
      {
        ends: [
          [6, 0],
          [10, 0],
        ],
        heights: [3, 5],
        elevation: undefined,
      },
    ]);
    // A level line keeps its elevation and has no heights.
    expect(broken(level, { x: 2, y: 0 }, { x: 6, y: 0 })!.map(shape)[0]).toEqual({
      ends: [
        [0, 0],
        [2, 0],
      ],
      heights: undefined,
      elevation: 3,
    });
  });

  it('carries LENGTHEN’s new end on along the 3D line, either way', () => {
    const c = breakCurveOf(sloped)!;
    expect(shape(lengthenGeometry(sloped, c, true, 12, tol))).toMatchObject({
      ends: [
        [0, 0],
        [12, 0],
      ],
      heights: [0, 6],
    });
    expect(shape(lengthenGeometry(sloped, c, false, 4, tol))).toMatchObject({
      ends: [
        [6, 0],
        [10, 0],
      ],
      heights: [3, 5],
    });
  });

  it('takes EXTEND’s end to the edge at the line’s height there', () => {
    const edge: Curve = { kind: 'LINE', start: { x: 14, y: -5 }, end: { x: 14, y: 5 } };
    const c = breakCurveOf(sloped)!;
    expect(shape(extendGeometry(sloped, c, [edge], 0.9, tol))).toMatchObject({
      ends: [
        [0, 0],
        [14, 0],
      ],
      heights: [0, 7],
    });
  });

  it('cuts a FILLET or CHAMFER leg at the corner at the height there', () => {
    // Kept towards the end: the start moves to x = 4, height 2; then on past the start, x = -2.
    expect(shape(cutLeg(sloped, { x: 4, y: 0 }, { x: 1, y: 0 }, tol))).toMatchObject({
      ends: [
        [4, 0],
        [10, 0],
      ],
      heights: [2, 5],
    });
    expect(shape(cutLeg(sloped, { x: -2, y: 0 }, { x: 1, y: 0 }, tol))).toMatchObject({
      ends: [
        [-2, 0],
        [10, 0],
      ],
      heights: [-1, 5],
    });
  });

  it('swaps the heights when REVERSE turns the line round', () => {
    expect(shape(reverseGeometry(sloped))).toMatchObject({
      ends: [
        [10, 0],
        [0, 0],
      ],
      heights: [5, 0],
    });
  });
});
