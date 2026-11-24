// M9-03 part 11: a selected dimensional constraint's grips (AutoCAD 2024 Help, "To Change the
// Value of a Dimensional Constraint": "Select the constraint and click a triangular grip …
// drag it to a new location"; "About Applying Dimensional Constraints": the square grip moves
// the constraint's text and dimension line). Triangular grips sit where the dimension line or
// arc ends (or where a radius meets its curve), pointing outward; the square one at the text.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  constraintGripAt,
  constraintGripValue,
  constraintGripsOf,
  movedConstraintLocation,
  type DimensionalConstraintObject,
  type EntityGeometry,
} from '../../src/index';
import { circleGeom, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const dim = (
  handle: string,
  o: Partial<DimensionalConstraintObject> &
    Pick<DimensionalConstraintObject, 'dimension' | 'refs' | 'location'>,
): DimensionalConstraintObject => ({
  handle,
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  parameter: 'd1',
  expression: '10',
  form: 'dynamic',
  ...o,
});

const arcGeom = (x: number, y: number, r: number, a0: number, a1: number): EntityGeometry => ({
  kind: 'ARC',
  center: { x, y },
  radius: r,
  startAngle: (a0 * Math.PI) / 180,
  endAngle: (a1 * Math.PI) / 180,
});

/** Line 50 (0,0)-(10,0), line 51 (0,0)-(0,5), circle 53 at (20,0) r 3, arc 54 at (40,0) r 2 0°-90°. */
function model(dims: readonly DimensionalConstraintObject[]): DocumentModel {
  const init = sampleInit();
  return DocumentModel.create({
    ...init,
    objects: [...(init.objects ?? []), ...dims],
    entities: [
      ...(init.entities ?? []),
      entityInit('50', lineGeom(0, 0, 10, 0)),
      entityInit('51', lineGeom(0, 0, 0, 5)),
      entityInit('53', circleGeom(20, 0, 3)),
      entityInit('54', arcGeom(40, 0, 2, 0, 90)),
    ],
  });
}

const close = (a: { x: number; y: number } | undefined, x: number, y: number) => {
  expect(a).toBeDefined();
  expect(a!.x).toBeCloseTo(x, 9);
  expect(a!.y).toBeCloseTo(y, 9);
};

const HORIZONTAL = dim('D1', {
  dimension: 'horizontal',
  refs: [
    { entity: '50', point: 'start' },
    { entity: '50', point: 'end' },
  ],
  location: { x: 3, y: 2 },
});

describe('where a dimensional constraint shows its grips', () => {
  it('a distance: triangles at the dimension line ends pointing out, a square at the text', () => {
    const m = model([HORIZONTAL]);
    const grips = constraintGripsOf(m, 'D1');
    expect(grips.map((g) => g.role)).toEqual(['first', 'second', 'location']);
    close(grips[0]!.point, 0, 2);
    close(grips[0]!.towards, -1, 0);
    close(grips[1]!.point, 10, 2);
    close(grips[1]!.towards, 1, 0);
    close(grips[2]!.point, 5, 2);
    expect(grips[2]!.towards).toBeUndefined();
  });

  it('an angle: triangles at the arc ends along it, the start on the first line', () => {
    const m = model([
      dim('D2', {
        dimension: 'angular',
        refs: [{ entity: '50' }, { entity: '51' }],
        location: { x: 3, y: 3 },
        expression: '90',
      }),
    ]);
    const grips = constraintGripsOf(m, 'D2');
    const r = Math.hypot(3, 3);
    expect(grips.map((g) => g.role)).toEqual(['first', 'second', 'location']);
    close(grips[0]!.point, r, 0);
    close(grips[0]!.towards, 0, -1);
    close(grips[1]!.point, 0, r);
    close(grips[1]!.towards, -1, 0);
    close(grips[2]!.point, r * Math.SQRT1_2, r * Math.SQRT1_2);
  });

  it('the second line counter-clockwise of the first puts the arc start on the second', () => {
    const m = model([
      dim('D2', {
        dimension: 'angular',
        refs: [{ entity: '51' }, { entity: '50' }],
        location: { x: 3, y: 3 },
        expression: '90',
      }),
    ]);
    const grips = constraintGripsOf(m, 'D2');
    expect(grips.map((g) => g.role)).toEqual(['second', 'first', 'location']);
  });

  it('a radius: one triangle where its leader meets the circle; a diameter one at each end', () => {
    const m = model([
      dim('D3', {
        dimension: 'radial',
        refs: [{ entity: '53' }],
        location: { x: 30, y: 0 },
        parameter: 'rad1',
        expression: '3',
      }),
      dim('D4', {
        dimension: 'diameter',
        refs: [{ entity: '53' }],
        location: { x: 20, y: 1 },
        parameter: 'dia1',
        expression: '6',
      }),
    ]);
    const radius = constraintGripsOf(m, 'D3');
    expect(radius.map((g) => g.role)).toEqual(['second', 'location']);
    close(radius[0]!.point, 23, 0);
    close(radius[0]!.towards, 1, 0);
    close(radius[1]!.point, 30, 0);
    const diameter = constraintGripsOf(m, 'D4');
    expect(diameter.map((g) => g.role)).toEqual(['second', 'second', 'location']);
    close(diameter[0]!.point, 20, 3);
    close(diameter[1]!.point, 20, -3);
    close(diameter[1]!.towards, 0, -1);
  });

  it('a reference constraint or one whose expression names parameters shows only the square', () => {
    const m = model([
      { ...HORIZONTAL, reference: true },
      { ...HORIZONTAL, handle: 'D5', parameter: 'd2', expression: 'd1*2' },
    ]);
    expect(constraintGripsOf(m, 'D1').map((g) => g.role)).toEqual(['location']);
    expect(constraintGripsOf(m, 'D5').map((g) => g.role)).toEqual(['location']);
    expect(constraintGripsOf(m, 'NOPE')).toEqual([]);
  });

  it('finds the grip of the constraints given nearest a point, within reach', () => {
    const m = model([HORIZONTAL]);
    expect(constraintGripAt(m, ['D1'], { x: 10.1, y: 2 }, 0.5)).toMatchObject({
      handle: 'D1',
      grip: { role: 'second' },
    });
    expect(constraintGripAt(m, ['D1'], { x: 5, y: 2.2 }, 0.5)?.grip.role).toBe('location');
    expect(constraintGripAt(m, ['D1'], { x: 7, y: 2 }, 0.5)).toBeUndefined();
    expect(constraintGripAt(m, [], { x: 10, y: 2 }, 0.5)).toBeUndefined();
  });
});

describe('what dragging a grip sets', () => {
  it('a distance: the point projected on the dimension line, from the other end', () => {
    const m = model([HORIZONTAL]);
    const [first, second] = constraintGripsOf(m, 'D1');
    expect(constraintGripValue(m, 'D1', second!, { x: 12.5, y: 7 })).toBeCloseTo(12.5, 9);
    expect(constraintGripValue(m, 'D1', first!, { x: -3, y: 1 })).toBeCloseTo(13, 9);
    // Past the other end: no positive distance.
    expect(constraintGripValue(m, 'D1', second!, { x: -1, y: 2 })).toBeCloseTo(-1, 9);
  });

  it('an angle: from the other end of the arc counter-clockwise, degrees', () => {
    const m = model([
      dim('D2', {
        dimension: 'angular',
        refs: [{ entity: '50' }, { entity: '51' }],
        location: { x: 3, y: 3 },
        expression: '90',
      }),
    ]);
    const [first, second] = constraintGripsOf(m, 'D2');
    const at = (deg: number) => ({
      x: Math.cos((deg * Math.PI) / 180),
      y: Math.sin((deg * Math.PI) / 180),
    });
    expect(constraintGripValue(m, 'D2', second!, at(60))).toBeCloseTo(60, 9);
    expect(constraintGripValue(m, 'D2', first!, at(30))).toBeCloseTo(60, 9);
    expect(constraintGripValue(m, 'D2', first!, at(-30))).toBeCloseTo(120, 9);
  });

  it('a radius or diameter: the distance from the centre (twice it)', () => {
    const m = model([
      dim('D3', { dimension: 'radial', refs: [{ entity: '54' }], location: { x: 45, y: 0 } }),
      dim('D4', { dimension: 'diameter', refs: [{ entity: '53' }], location: { x: 20, y: 1 } }),
    ]);
    const [r] = constraintGripsOf(m, 'D3');
    expect(constraintGripValue(m, 'D3', r!, { x: 40, y: 5 })).toBeCloseTo(5, 9);
    const [d] = constraintGripsOf(m, 'D4');
    expect(constraintGripValue(m, 'D4', d!, { x: 24, y: 0 })).toBeCloseTo(8, 9);
  });

  it('the square grip moves the location by the drag', () => {
    const m = model([HORIZONTAL]);
    const square = constraintGripsOf(m, 'D1')[2]!;
    close(movedConstraintLocation(m, 'D1', square, { x: 6, y: 5 }), 4, 5);
  });
});
