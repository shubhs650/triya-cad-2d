// M4-01: a linear or aligned dimension's jog line, read from AutoCAD's xdata layout (comments in
// src/annotation/linear-jog.ts), and carried with the dimension by MOVE, ROTATE, SCALE, MIRROR
// and COPY.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  jogHeightFactor,
  linearJog,
  linearJogXdata,
  withLinearJog,
  type DimStyleRecord,
  type DimensionGeometry,
  type HeaderValue,
  type Xdata,
} from '../../src/index';
import { carriedDimensionXdata } from '../../src/edit/transform';
import { mirrorIn, moveBy, scaleAbout, turnAbout } from '../../src/edit/similarity';
import { blockRecord, LAYER_0, layer, linetype, MODEL_SPACE } from '../model/fixtures';

const STD = '27';
const ACAD = '12';
const JOG = '13';
const JAG = '14';

function model(style: Partial<DimStyleRecord> = {}): DocumentModel {
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0')],
      linetypes: [linetype('14A', 'Continuous')],
      appIds: [
        { handle: ACAD, name: 'ACAD' },
        { handle: JOG, name: 'ACAD_DSTYLE_DIMJAG_POSITION' },
        { handle: JAG, name: 'ACAD_DSTYLE_DIMJAG' },
      ],
      dimStyles: [{ handle: STD, name: 'Standard', vars: {}, ...style }],
      blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space')],
    },
    blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [],
  });
}

/** AutoCAD's layout of a DIMSTYLE's (or a dimension's) Jog Height Factor. */
const factorXdata = (factor: number): Xdata => [
  {
    appId: JAG,
    values: [
      { code: 1070, value: 388 },
      { code: 1040, value: factor },
    ],
  },
];

const linear: DimensionGeometry = {
  kind: 'DIMENSION',
  dimType: 'linear',
  style: STD,
  first: { x: 0, y: 0 },
  second: { x: 100, y: 0 },
  definitionPoint: { x: 100, y: 20 },
  textPosition: { x: 50, y: 21.875 },
  rotation: 0,
  textUserPositioned: false,
  text: '',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
};

describe('the jog line of a linear dimension (M4-01)', () => {
  it('reads the point after 389 whatever 387 holds, and nothing without the xdata', () => {
    const m = model();
    expect(linearJog([linearJogXdata(JOG, { x: 30, y: 20 })], m)).toEqual({ x: 30, y: 20 });
    const other: Xdata = [
      {
        appId: JOG,
        values: [
          { code: 1070, value: 387 },
          { code: 1070, value: 3 },
          { code: 1070, value: 389 },
          { code: 1010, value: { x: 1, y: 2, z: 0 } },
        ],
      },
    ];
    expect(linearJog(other, m)).toEqual({ x: 1, y: 2 });
    expect(linearJog(undefined, m)).toBeUndefined();
    // Another application's list, or no point after 389.
    expect(linearJog([{ ...linearJogXdata(JOG, { x: 1, y: 2 }), appId: ACAD }], m)).toBeUndefined();
    const noPoint: Xdata = [
      {
        appId: JOG,
        values: [
          { code: 1070, value: 389 },
          { code: 1040, value: 2 },
        ],
      },
    ];
    expect(linearJog(noPoint, m)).toBeUndefined();
  });

  it("takes the dimension's Jog Height Factor, else its style's, else 1.5", () => {
    expect(jogHeightFactor(STD, undefined, model())).toBe(1.5);
    const styled = model({ xdata: factorXdata(2) });
    expect(jogHeightFactor(STD, undefined, styled)).toBe(2);
    expect(jogHeightFactor(STD, factorXdata(3), styled)).toBe(3);
    // A factor that is not a positive real is no factor.
    expect(jogHeightFactor(STD, factorXdata(0), styled)).toBe(2);
  });

  it('replaces the jog entry in place, or adds it after the others', () => {
    const acad: Xdata = [{ appId: ACAD, values: [{ code: 1000, value: 'DSTYLE' }] }];
    const added = withLinearJog(acad, JOG, { x: 5, y: 6 });
    expect(added.map((a) => a.appId)).toEqual([ACAD, JOG]);
    const moved = withLinearJog(added, JOG, { x: 7, y: 8 });
    expect(moved.map((a) => a.appId)).toEqual([ACAD, JOG]);
    expect(linearJog(moved, model())).toEqual({ x: 7, y: 8 });
  });

  it('MOVE, ROTATE, SCALE and MIRROR carry the jog with the dimension', () => {
    const m = model();
    const e = { geom: linear, xdata: [linearJogXdata(JOG, { x: 30, y: 20 })] };
    const at = (t: Parameters<typeof carriedDimensionXdata>[1]) =>
      linearJog(carriedDimensionXdata(e, t, m)!.xdata, m)!;
    expect(at(moveBy({ x: 10, y: -5 }))).toEqual({ x: 40, y: 15 });
    const turned = at(turnAbout({ x: 0, y: 0 }, Math.PI / 2));
    expect(turned.x).toBeCloseTo(-20, 12);
    expect(turned.y).toBeCloseTo(30, 12);
    expect(at(scaleAbout({ x: 0, y: 0 }, 2))).toEqual({ x: 60, y: 40 });
    const mirrored = at(mirrorIn({ x: 50, y: 0 }, { x: 50, y: 1 }));
    expect(mirrored.x).toBeCloseTo(70, 12);
    expect(mirrored.y).toBeCloseTo(20, 12);
    // Nothing to carry without a jog.
    expect(carriedDimensionXdata({ geom: linear }, moveBy({ x: 1, y: 0 }), m)).toBeUndefined();
  });
});

describe('moving a jog keeps the list as read (M4-01)', () => {
  it('replaces only the point after 389', () => {
    const read: Xdata = [
      {
        appId: JOG,
        values: [
          { code: 1070, value: 387 },
          { code: 1070, value: 3 },
          { code: 1070, value: 389 },
          { code: 1010, value: { x: 1, y: 2, z: 0 } },
        ],
      },
    ];
    expect(withLinearJog(read, JOG, { x: 4, y: 5 })[0]!.values).toEqual([
      { code: 1070, value: 387 },
      { code: 1070, value: 3 },
      { code: 1070, value: 389 },
      { code: 1010, value: { x: 4, y: 5, z: 0 } },
    ]);
  });
});
