// M9-05 part 2: where the constraint bars go. AutoCAD 2024 Help, "About Displaying and Verifying
// Geometric Constraints": a bar per constrained object showing an icon per geometric constraint
// on it, Coincident constraints "as small, blue squares"; a bar's default place is near the
// object's midpoint.
import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_BAR_ALL,
  CONSTRAINT_BAR_BITS,
  DocumentModel,
  constrainedObjects,
  constraintBars,
  type ConstraintRef,
  type EntityGeometry,
  type GeometricConstraintObject,
} from '../../src/index';
import { circleGeom, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const gc = (
  handle: string,
  kind: GeometricConstraintObject['kind'],
  refs: ConstraintRef[],
): GeometricConstraintObject => ({ handle, type: 'TRIYA_GEOMCONSTRAINT', owner: 'C', kind, refs });

/**
 * Line 50 (0,0)-(10,0), vertical line 51 (0,0)-(0,5), circle 53 at (20,0) r 3, arc 54 at (40,0)
 * r 2 from 0° to 90°, polyline 55 (0,-10)-(6,-10) bulging to (6,-4), a cubic spline 56 from
 * (20,-20) to (29,-17).
 */
function model(constraints: GeometricConstraintObject[]): DocumentModel {
  const init = sampleInit();
  return DocumentModel.create({
    ...init,
    objects: [...(init.objects ?? []), ...constraints],
    entities: [
      ...(init.entities ?? []),
      entityInit('50', lineGeom(0, 0, 10, 0)),
      entityInit('51', lineGeom(0, 0, 0, 5)),
      entityInit('53', circleGeom(20, 0, 3)),
      entityInit('54', {
        kind: 'ARC',
        center: { x: 40, y: 0 },
        radius: 2,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
      entityInit('55', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: -10, bulge: 0 },
          { x: 6, y: -10, bulge: 1 },
          { x: 6, y: -4, bulge: 0 },
        ],
      } as EntityGeometry),
      entityInit('56', {
        kind: 'SPLINE',
        degree: 3,
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
        controlPoints: [
          { x: 20, y: -20 },
          { x: 23, y: -17 },
          { x: 26, y: -20 },
          { x: 29, y: -17 },
        ],
        closed: false,
        periodic: false,
      } as EntityGeometry),
    ],
  });
}

const close = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x, 9);
  expect(a.y).toBeCloseTo(y, 9);
};

describe('constraint bars (M9-05 part 2)', () => {
  it("gives each constrained object a bar of its constraints' icons, in the order applied", () => {
    const m = model([
      gc('E1', 'horizontal', [{ entity: '50' }]),
      gc('E2', 'perpendicular', [{ entity: '50' }, { entity: '51' }]),
      gc('E3', 'fix', [{ entity: '51', point: 'end' }]),
    ]);
    const { bars, marks } = constraintBars(m);
    expect(marks).toEqual([]);
    expect(bars.map((b) => [b.entity, b.icons.map((i) => i.handle)])).toEqual([
      ['50', ['E1', 'E2']],
      ['51', ['E2', 'E3']],
    ]);
    expect(bars[0]!.icons[1]).toEqual({
      handle: 'E2',
      kind: 'perpendicular',
      entities: ['50', '51'],
    });
    // A line's bar from its midpoint, below it; a vertical line's to its right.
    close(bars[0]!.anchor, 5, 0);
    close(bars[0]!.side, 0, -1);
    close(bars[1]!.anchor, 0, 2.5);
    close(bars[1]!.side, 1, 0);
  });

  it('places a circle’s below it, an arc’s outside its middle, a segment’s by the segment', () => {
    const m = model([
      gc('E1', 'concentric', [{ entity: '53' }, { entity: '54' }]),
      gc('E2', 'equal', [
        { entity: '55', segment: 0 },
        { entity: '55', segment: 1 },
      ]),
    ]);
    const { bars } = constraintBars(m);
    expect(bars.map((b) => [b.entity, b.segment])).toEqual([
      ['53', undefined],
      ['54', undefined],
      ['55', 0],
      ['55', 1],
    ]);
    close(bars[0]!.anchor, 20, -3);
    close(bars[1]!.anchor, 40 + Math.SQRT2, Math.SQRT2);
    close(bars[1]!.side, Math.SQRT1_2, Math.SQRT1_2);
    close(bars[2]!.anchor, 3, -10);
    // The bulge-1 half circle from (6,-10) to (6,-4) about (6,-7): its middle at (9,-7).
    close(bars[3]!.anchor, 9, -7);
    close(bars[3]!.side, 1, 0);
  });

  it("places a spline's at its middle, below it (M9-02 part 2)", () => {
    const m = model([
      gc('E1', 'smooth', [
        { entity: '56', point: 'start' },
        { entity: '50', point: 'end' },
      ]),
    ]);
    const { bars } = constraintBars(m);
    expect(bars.map((b) => b.entity)).toEqual(['56', '50']);
    // At u = 0.5 the cubic is at (C0 + 3 C1 + 3 C2 + C3) / 8, running along X.
    close(bars[0]!.anchor, 24.5, -18.5);
    close(bars[0]!.side, 0, -1);
  });

  it('shows Coincident as a square at the point instead of an icon', () => {
    const m = model([
      gc('E1', 'coincident', [
        { entity: '50', point: 'start' },
        { entity: '51', point: 'start' },
      ]),
    ]);
    const { bars, marks } = constraintBars(m);
    expect(bars).toEqual([]);
    expect(marks).toEqual([{ handle: 'E1', at: { x: 0, y: 0 }, entities: ['50', '51'] }]);
  });

  it('leaves out a constraint whose object is gone', () => {
    const m = model([gc('E1', 'parallel', [{ entity: '50' }, { entity: '99' }])]);
    expect(constraintBars(m).bars).toEqual([]);
  });

  it('lists the constrained objects once each', () => {
    const m = model([
      gc('E1', 'horizontal', [{ entity: '50' }]),
      gc('E2', 'perpendicular', [{ entity: '50' }, { entity: '51' }]),
    ]);
    expect(constrainedObjects(m)).toEqual(['50', '51']);
  });

  it("CONSTRAINTBARMODE's bits sum to its initial 4095", () => {
    expect(Object.values(CONSTRAINT_BAR_BITS).reduce((a, b) => a + b, 0)).toBe(CONSTRAINT_BAR_ALL);
    expect(CONSTRAINT_BAR_BITS.parallel + CONSTRAINT_BAR_BITS.perpendicular).toBe(12);
  });
});
