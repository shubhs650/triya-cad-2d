// M9-03 part 9: the dimensional constraint a dimension converts to (DCCONVERT; AutoCAD 2024 Help,
// "DCCONVERT (Command)": "Converts associative dimensions to dimensional constraints"). Linear
// dimensions become Horizontal or Vertical, aligned ones Aligned, angular ones Angular and radius
// and diameter ones Radius and Diameter, on the constraint points or objects the dimension
// measures: those its DIMASSOC names, or (Triya's own dimensions are not associative) the objects
// its definition points lie on.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  dimensionConstraintOf,
  toleranceForSize,
  type DimAssoc,
  type DimAssocPoint,
  type DimensionGeometry,
  type EntityGeometry,
  type Vec2,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';

const FIELDS = {
  style: '27',
  textUserPositioned: false,
  text: '',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
};

const linear = (first: Vec2, second: Vec2, at: Vec2, rotation?: number) =>
  ({
    kind: 'DIMENSION',
    ...FIELDS,
    dimType: rotation === undefined ? 'aligned' : 'linear',
    first,
    second,
    definitionPoint: at,
    textPosition: at,
    ...(rotation !== undefined && { rotation }),
  }) as DimensionGeometry;

const radial = (kind: 'radius' | 'diameter', definitionPoint: Vec2, chordPoint: Vec2, at: Vec2) =>
  ({
    kind: 'DIMENSION',
    ...FIELDS,
    dimType: kind,
    definitionPoint,
    chordPoint,
    leaderLength: 0,
    textPosition: at,
  }) as DimensionGeometry;

const assocPoint = (entity: string, point: Vec2): DimAssocPoint => ({
  osnap: 1,
  geometry: [entity],
  subentType: 1,
  gsMarker: 0,
  xrefPaths: [],
  parameter: 0,
  point: { ...point, z: 0 },
});

/**
 * Line 30 (0,0)-(10,0), line 31 (10,0)-(10,8), circle 32 at (20,0) r 2, polyline 33
 * (30,0)-(40,0) then a half circle to (40,10) (centre (40,5), r 5), arc 34 at (60,0) r 5 from
 * 0° to 90°, and line 35 over line 30. Dimension D0 is the one converted.
 */
function drawing(dim: DimensionGeometry, assoc?: DimAssoc['points']) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', lineGeom(10, 0, 10, 8)),
      entityInit('32', { kind: 'CIRCLE', center: { x: 20, y: 0 }, radius: 2 }),
      entityInit('33', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 30, y: 0, bulge: 0 },
          { x: 40, y: 0, bulge: 1 },
          { x: 40, y: 10, bulge: 0 },
        ],
      } as EntityGeometry),
      entityInit('34', {
        kind: 'ARC',
        center: { x: 60, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
      entityInit('35', lineGeom(0, 0, 10, 0)),
      entityInit('D0', dim as EntityGeometry),
    ],
    objects: [
      ...(init.objects ?? []),
      ...(assoc
        ? [
            {
              handle: 'A0',
              type: 'DIMASSOC',
              owner: 'C',
              dimension: 'D0',
              transSpace: false,
              rotatedType: 0,
              points: assoc,
            } as DimAssoc,
          ]
        : []),
    ],
  });
  return dimensionConstraintOf(model, model.entityByHandle('D0')!, toleranceForSize(100));
}

describe('dimensionConstraintOf (M9-03 part 9)', () => {
  it('a horizontal linear dimension of a line is Horizontal on the line', () => {
    expect(drawing(linear({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -3 }, 0))).toEqual({
      dimension: 'horizontal',
      refs: [{ entity: '30' }],
      location: { x: 5, y: -3 },
    });
  });

  it('a vertical linear dimension of a line is Vertical, whichever way the points run', () => {
    expect(drawing(linear({ x: 10, y: 8 }, { x: 10, y: 0 }, { x: 14, y: 4 }, Math.PI / 2))).toEqual(
      { dimension: 'vertical', refs: [{ entity: '31' }], location: { x: 14, y: 4 } },
    );
    expect(
      drawing(linear({ x: 10, y: 8 }, { x: 10, y: 0 }, { x: 14, y: 4 }, -Math.PI / 2)),
    ).toMatchObject({ dimension: 'vertical' });
  });

  it('an aligned dimension between two objects takes their constraint points', () => {
    expect(drawing(linear({ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 3, y: 6 }))).toEqual({
      dimension: 'aligned',
      refs: [
        { entity: '30', point: 'start' },
        { entity: '31', point: 'end' },
      ],
      location: { x: 3, y: 6 },
    });
  });

  it("takes a polyline's vertex and a line segment of it", () => {
    expect(drawing(linear({ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: -5 }, 0))).toMatchObject({
      dimension: 'horizontal',
      refs: [
        { entity: '30', point: 'start' },
        { entity: '33', point: 'vertex', index: 0 },
      ],
    });
    expect(drawing(linear({ x: 40, y: 0 }, { x: 30, y: 0 }, { x: 35, y: -5 }))).toMatchObject({
      dimension: 'aligned',
      refs: [{ entity: '33', segment: 0 }],
    });
  });

  it('a two-line angular dimension is Angular on the two lines', () => {
    const g = {
      kind: 'DIMENSION',
      ...FIELDS,
      dimType: 'angular',
      line1Start: { x: 0, y: 0 },
      line1End: { x: 10, y: 0 },
      line2Start: { x: 10, y: 8 },
      definitionPoint: { x: 10, y: 0 },
      arcPoint: { x: 8, y: 1 },
      textPosition: { x: 7, y: 2 },
    } as DimensionGeometry;
    expect(drawing(g)).toEqual({
      dimension: 'angular',
      refs: [{ entity: '30' }, { entity: '31' }],
      location: { x: 8, y: 1 },
    });
  });

  it('a three-point angular dimension is Angular on the vertex and the two points', () => {
    const g = {
      kind: 'DIMENSION',
      ...FIELDS,
      dimType: 'angular3pt',
      vertex: { x: 60, y: 0 },
      first: { x: 65, y: 0 },
      second: { x: 60, y: 5 },
      definitionPoint: { x: 63, y: 3 },
      textPosition: { x: 64, y: 4 },
    } as DimensionGeometry;
    expect(drawing(g)).toEqual({
      dimension: 'angular',
      refs: [
        { entity: '34', point: 'center' },
        { entity: '34', point: 'start' },
        { entity: '34', point: 'end' },
      ],
      location: { x: 63, y: 3 },
    });
  });

  it('radius and diameter dimensions take the circle, arc or arc segment, placed at the text', () => {
    expect(drawing(radial('radius', { x: 20, y: 0 }, { x: 22, y: 0 }, { x: 25, y: 1 }))).toEqual({
      dimension: 'radial',
      refs: [{ entity: '32' }],
      location: { x: 25, y: 1 },
    });
    expect(
      drawing(radial('diameter', { x: 55, y: 0 }, { x: 65, y: 0 }, { x: 68, y: 0 })),
    ).toMatchObject({ dimension: 'diameter', refs: [{ entity: '34' }] });
    expect(
      drawing(radial('radius', { x: 40, y: 5 }, { x: 45, y: 5 }, { x: 47, y: 5 })),
    ).toMatchObject({ dimension: 'radial', refs: [{ entity: '33', segment: 1 }] });
  });

  it('takes the objects a DIMASSOC names over others at the same points', () => {
    const g = linear({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -3 }, 0);
    expect(drawing(g)).toMatchObject({ refs: [{ entity: '30' }] });
    expect(
      drawing(g, [assocPoint('35', { x: 0, y: 0 }), assocPoint('35', { x: 10, y: 0 }), null, null]),
    ).toMatchObject({ refs: [{ entity: '35' }] });
  });

  it('refuses a dimension it cannot convert, saying why', () => {
    // Off every object.
    expect(drawing(linear({ x: 0, y: 1 }, { x: 10, y: 1 }, { x: 5, y: 4 }, 0))).toEqual({
      problem: 'unattached',
    });
    // Neither horizontal nor vertical: no dimensional constraint measures along a direction.
    expect(drawing(linear({ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 3, y: 6 }, 0.5))).toEqual({
      problem: 'rotated',
    });
    // A circle's radius that is not the circle's.
    expect(drawing(radial('radius', { x: 20, y: 0 }, { x: 23, y: 0 }, { x: 25, y: 1 }))).toEqual({
      problem: 'unattached',
    });
    const ordinate = {
      kind: 'DIMENSION',
      ...FIELDS,
      dimType: 'ordinate',
      axis: 'x',
      feature: { x: 0, y: 0 },
      leaderEnd: { x: 0, y: 5 },
      definitionPoint: { x: 0, y: 0 },
      textPosition: { x: 0, y: 6 },
    } as DimensionGeometry;
    expect(drawing(ordinate)).toEqual({ problem: 'kind' });
  });
});
