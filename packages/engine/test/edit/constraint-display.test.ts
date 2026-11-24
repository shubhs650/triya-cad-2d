// M9-03 part 4: how dimensional constraints show on the drawing (their dimension lines, arcs
// and leaders through the location DIMCONSTRAINT placed them at) and their text as
// CONSTRAINTNAMEFORMAT says.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  constraintDisplays,
  constraintLabel,
  drawingUnits,
  type ConstraintShape,
  type DimensionalConstraintObject,
  type EntityGeometry,
  type HeaderValue,
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

/**
 * Line 50 (0,0)-(10,0), line 51 (0,0)-(0,5), line 52 (0,4)-(8,4) parallel to 50, circle 53 at
 * (20,0) r 3, arc 54 at (40,0) r 2 from 0° to 90°, polyline 55 (0,-10)-(6,-10) bulging to
 * (6,-4), and the constraints given.
 */
function model(
  dims: readonly DimensionalConstraintObject[],
  header: readonly [string, HeaderValue][] = [],
): DocumentModel {
  const init = sampleInit();
  return DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ...header]),
    objects: [...(init.objects ?? []), ...dims],
    entities: [
      ...(init.entities ?? []),
      entityInit('50', lineGeom(0, 0, 10, 0)),
      entityInit('51', lineGeom(0, 0, 0, 5)),
      entityInit('52', lineGeom(0, 4, 8, 4)),
      entityInit('53', circleGeom(20, 0, 3)),
      entityInit('54', arcGeom(40, 0, 2, 0, 90)),
      entityInit('55', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: -10, bulge: 0 },
          { x: 6, y: -10, bulge: 1 },
          { x: 6, y: -4, bulge: 0 },
        ],
      } as EntityGeometry),
    ],
  });
}

const shape = (m: DocumentModel, handle: string): ConstraintShape | undefined =>
  constraintDisplays(m, 2).find((d) => d.handle === handle)?.shape;

const close = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x, 9);
  expect(a.y).toBeCloseTo(y, 9);
};

describe('constraint shapes (M9-03 part 4)', () => {
  it('draws Horizontal and Vertical through the location, from the points measured', () => {
    const m = model([
      dim('D1', {
        dimension: 'horizontal',
        refs: [
          { entity: '50', point: 'start' },
          { entity: '50', point: 'end' },
        ],
        location: { x: 3, y: -2 },
      }),
      dim('D2', { dimension: 'vertical', refs: [{ entity: '51' }], location: { x: -3, y: 9 } }),
    ]);
    const h = shape(m, 'D1');
    expect(h?.kind).toBe('linear');
    if (h?.kind !== 'linear') return;
    close(h.a, 0, 0);
    close(h.b, 10, 0);
    close(h.da, 0, -2);
    close(h.db, 10, -2);
    const v = shape(m, 'D2');
    if (v?.kind !== 'linear') throw new Error('vertical is linear');
    close(v.da, -3, 0);
    close(v.db, -3, 5);
    const d2 = constraintDisplays(m, 2).find((d) => d.handle === 'D2')!;
    // Vertical text reads bottom to top, halfway up the dimension line.
    expect(d2.textAngle).toBeCloseTo(Math.PI / 2, 9);
    close(d2.textAt, -3, 2.5);
    expect(d2.entities).toEqual(['51']);
  });

  it('offsets Aligned along its normal: two points, a point and a line, 2Line', () => {
    const m = model([
      dim('D1', {
        dimension: 'aligned',
        refs: [
          { entity: '51', point: 'end' },
          { entity: '50', point: 'end' },
        ],
        location: { x: 10, y: 10 },
      }),
      dim('D2', {
        dimension: 'aligned',
        refs: [{ entity: '52', point: 'end' }, { entity: '50' }],
        location: { x: 12, y: 2 },
      }),
      dim('D3', {
        dimension: 'aligned',
        refs: [{ entity: '50' }, { entity: '52' }],
        location: { x: -1, y: 2 },
      }),
    ]);
    const a = shape(m, 'D1');
    if (a?.kind !== 'linear') throw new Error('aligned is linear');
    // From (0,5) to (10,0), moved along the normal to pass through (10,10).
    const n = { x: 5 / Math.hypot(10, 5), y: 10 / Math.hypot(10, 5) };
    const s = (10 - 0) * n.x + (10 - 5) * n.y;
    close(a.da, s * n.x, 5 + s * n.y);
    close(a.db, 10 + s * n.x, s * n.y);
    const pl = shape(m, 'D2');
    if (pl?.kind !== 'linear') throw new Error('point and line is linear');
    close(pl.a, 8, 4);
    close(pl.b, 8, 0);
    close(pl.da, 12, 4);
    const two = shape(m, 'D3');
    if (two?.kind !== 'linear') throw new Error('2Line is linear');
    close(two.a, 0, 0);
    close(two.b, 0, 4);
    close(two.da, -1, 0);
  });

  it('draws Angular as an arc between lines, an arc or three points', () => {
    const m = model([
      dim('A1', {
        dimension: 'angular',
        parameter: 'ang1',
        expression: '90',
        refs: [{ entity: '50' }, { entity: '51' }],
        location: { x: 12, y: 12 },
      }),
      dim('A2', {
        dimension: 'angular',
        parameter: 'ang2',
        expression: '90',
        refs: [{ entity: '54' }],
        location: { x: 40, y: 1 },
      }),
      dim('A3', {
        dimension: 'angular',
        parameter: 'ang3',
        expression: '90',
        refs: [
          { entity: '50', point: 'start' },
          { entity: '51', point: 'end' },
          { entity: '50', point: 'end' },
        ],
        location: { x: 1, y: 1 },
      }),
    ]);
    const a = shape(m, 'A1');
    if (a?.kind !== 'angular') throw new Error('angular');
    close(a.center, 0, 0);
    expect(a.radius).toBeCloseTo(Math.hypot(12, 12), 9);
    expect(a.start).toBeCloseTo(0, 9);
    expect(a.sweep).toBeCloseTo(Math.PI / 2, 9);
    // Both lines stop short of the arc: extension lines run out to it.
    expect(a.extensions).toHaveLength(2);
    close(a.extensions[0]![0], 10, 0);
    close(a.extensions[0]![1], Math.hypot(12, 12), 0);
    const arc = shape(m, 'A2');
    if (arc?.kind !== 'angular') throw new Error('arc angular');
    close(arc.center, 40, 0);
    expect(arc.radius).toBeCloseTo(1, 9);
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 9);
    const three = shape(m, 'A3');
    if (three?.kind !== 'angular') throw new Error('3Point angular');
    // Clockwise from (0,5) to (10,0): the arc starts at the second ray.
    expect(three.start).toBeCloseTo(0, 9);
    expect(three.sweep).toBeCloseTo(Math.PI / 2, 9);
    expect(three.extensions).toHaveLength(0);
  });

  it('draws Radial and Diameter as leaders toward the location, on polyline arcs too', () => {
    const m = model([
      dim('B1', {
        dimension: 'radial',
        parameter: 'rad1',
        expression: '3',
        refs: [{ entity: '53' }],
        location: { x: 20, y: 7 },
      }),
      dim('B2', {
        dimension: 'diameter',
        parameter: 'dia1',
        expression: '6',
        refs: [{ entity: '53' }],
        location: { x: 21, y: 0 },
      }),
      dim('B3', {
        dimension: 'radial',
        parameter: 'rad2',
        expression: '3',
        refs: [{ entity: '55', segment: 1 }],
        location: { x: 6, y: -7 },
      }),
    ]);
    const r = shape(m, 'B1');
    if (r?.kind !== 'radial') throw new Error('radial');
    expect(r.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(r.reach).toBe(7);
    expect(r.diameter).toBe(false);
    const d = constraintDisplays(m, 2).find((x) => x.handle === 'B2')!;
    if (d.shape.kind !== 'radial') throw new Error('diameter');
    expect(d.shape.diameter).toBe(true);
    expect(d.shape.reach).toBe(3);
    // Inside the circle the text sits halfway along the radius.
    close(d.textAt, 21.5, 0);
    const p = shape(m, 'B3');
    if (p?.kind !== 'radial') throw new Error('polyline arc');
    close(p.center, 6, -7);
    expect(p.radius).toBeCloseTo(3, 9);
  });

  it('leaves out a constraint whose objects are gone or no longer fit', () => {
    const m = model([
      dim('D1', { dimension: 'aligned', refs: [{ entity: '99' }], location: { x: 0, y: 0 } }),
      dim('D2', { dimension: 'radial', refs: [{ entity: '50' }], location: { x: 0, y: 0 } }),
      dim('D3', {
        dimension: 'angular',
        refs: [{ entity: '50' }, { entity: '52' }],
        location: { x: 0, y: 0 },
      }),
    ]);
    expect(constraintDisplays(m, 2)).toEqual([]);
  });
});

describe('constraint text (CONSTRAINTNAMEFORMAT)', () => {
  const u = drawingUnits(new Map<string, HeaderValue>([['$LUPREC', 2]]));
  const c = { dimension: 'aligned', parameter: 'd1', expression: '63.2455532034' } as const;

  it('shows the name, the value, or name=expression (initially 2)', () => {
    expect(constraintLabel(c, 63.2455532034, u, 0)).toBe('d1');
    expect(constraintLabel(c, 63.2455532034, u, 1)).toBe('63.25');
    // A plain number is shown in the drawing's units and precision.
    expect(constraintLabel(c, 63.2455532034, u, 2)).toBe('d1=63.25');
  });

  it('puts fx: before an expression and a reference constraint in parentheses', () => {
    const fx = { ...c, parameter: 'd2', expression: 'd1 * 2' };
    expect(constraintLabel(fx, 126.49, u, 2)).toBe('fx: d2=d1 * 2');
    expect(constraintLabel(fx, 126.49, u, 1)).toBe('fx: 126.49');
    expect(constraintLabel({ ...c, reference: true }, 63.2455532034, u, 2)).toBe('(d1=63.25)');
  });

  it('writes angles in the drawing angular units', () => {
    const a = { dimension: 'angular', parameter: 'ang1', expression: '45' } as const;
    expect(constraintLabel(a, 45, u, 2)).toBe('ang1=45');
    const m = model(
      [
        dim('A1', {
          dimension: 'angular',
          parameter: 'ang1',
          expression: '90',
          refs: [{ entity: '50' }, { entity: '51' }],
          location: { x: 2, y: 2 },
        }),
      ],
      [['$AUPREC', 1]],
    );
    expect(constraintDisplays(m, 1)[0]!.label).toBe('90.0');
  });
});
