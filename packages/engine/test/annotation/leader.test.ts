// M1-52 part 2: a LEADER as its path and arrowhead, styled by its DIMSTYLE and DSTYLE overrides.
import { describe, expect, it } from 'vitest';
import {
  dimTrueColors,
  dimVars,
  DocumentModel,
  entityBounds,
  leaderParts,
  toleranceForSize,
  type DimStyleRecord,
  type HeaderValue,
  type LeaderGeometry,
  type LwPolylineGeometry,
  type SolidGeometry,
  type Xdata,
} from '../../src/index';
import { blockRecord, LAYER_0, layer, linetype, MODEL_SPACE } from '../model/fixtures';

const ISO = '50';
const ACAD = '12';
const DOT = '30';

function model(style: Partial<DimStyleRecord> = {}): DocumentModel {
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0')],
      linetypes: [linetype('14', 'Continuous')],
      appIds: [{ handle: ACAD, name: 'ACAD' }],
      dimStyles: [
        {
          handle: ISO,
          name: 'ISO-25',
          vars: { DIMASZ: 2.5, DIMSCALE: 1, DIMTAD: 1, DIMGAP: 0.625, DIMCLRD: 0 },
          ...style,
        },
      ],
      blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space'), blockRecord(DOT, '_Dot')],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: DOT, name: '_Dot', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [],
  });
}

/** The corpus leader's shape: up, down, and a 2.5 hook line to the right; text 16 wide. */
function leader(extra: Partial<LeaderGeometry> = {}): LeaderGeometry {
  return {
    kind: 'LEADER',
    style: ISO,
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 40 },
      { x: 20, y: 10 },
      { x: 22.5, y: 10 },
    ],
    arrowhead: true,
    spline: false,
    creationType: 0,
    hookline: { sameDirection: false },
    textHeight: 2,
    textWidth: 16,
    horizontalDirection: { x: 1, y: 0 },
    blockOffset: { x: 0, y: 0 },
    annotationOffset: { x: 0, y: 0 },
    ...extra,
  };
}

/** The leader without a hook line. */
function noHook(): LeaderGeometry {
  const { hookline: _hookline, ...rest } = leader();
  return rest;
}

/** ACAD xdata overriding DIMASZ (41) to 5 and DIMCLRD (176) to red. */
const dstyle: Xdata = [
  {
    appId: ACAD,
    values: [
      { code: 1000, value: 'DSTYLE' },
      { code: 1002, value: '{' },
      { code: 1070, value: 41 },
      { code: 1040, value: 5 },
      { code: 1070, value: 176 },
      { code: 1070, value: 1 },
      { code: 1002, value: '}' },
    ],
  },
];

describe('dimVars', () => {
  it('applies DSTYLE overrides on top of the style', () => {
    const m = model();
    expect(dimVars(ISO, undefined, m)).toMatchObject({ DIMASZ: 2.5, DIMCLRD: 0 });
    expect(dimVars(ISO, dstyle, m)).toMatchObject({ DIMASZ: 5, DIMCLRD: 1, DIMGAP: 0.625 });
  });
});

describe('dimTrueColors', () => {
  const green = { kind: 'rgb', r: 44, g: 136, b: 27 } as const;
  const blue = { kind: 'rgb', r: 80, g: 179, b: 255 } as const;

  it("gives the style's true colours unless DSTYLE overrides them", () => {
    const t = model({
      vars: { DIMASZ: 2.5, DIMCLRD: 86, DIMCLRT: 151 },
      trueColors: { DIMCLRD: green, DIMCLRT: blue },
    });
    expect(dimTrueColors(ISO, undefined, t)).toEqual({ DIMCLRD: green, DIMCLRT: blue });
    // The DSTYLE list sets DIMCLRD to ACI 1, which then wins over the style's true colour.
    expect(dimTrueColors(ISO, dstyle, t)).toEqual({ DIMCLRT: blue });
    expect(dimTrueColors(ISO, undefined, model())).toEqual({});
  });

  it('draws a leader in its style true colour', () => {
    const t = model({
      vars: { DIMASZ: 2.5, DIMTAD: 1, DIMGAP: 0.625, DIMCLRD: 86 },
      trueColors: { DIMCLRD: green },
    });
    expect(leaderParts(leader(), undefined, t).map((p) => p.color)).toEqual([green, green]);
    expect(leaderParts(leader(), dstyle, t)[0]!.color).toEqual({ kind: 'aci', index: 1 });
  });
});

describe('leaderParts', () => {
  it('draws a closed filled arrow at the tip and the path on under the text', () => {
    const parts = leaderParts(leader(), undefined, model());
    expect(parts.map((p) => p.geom.kind)).toEqual(['SOLID', 'LWPOLYLINE']);
    const arrow = parts[0]!.geom as SolidGeometry;
    expect(arrow.corners[0]).toEqual({ x: 0, y: 0 });
    // 2.5 long along the first segment (unit vector (1, 4)/√17).
    const base = { x: 2.5 / Math.sqrt(17), y: 10 / Math.sqrt(17) };
    expect((arrow.corners[1].x + arrow.corners[2].x) / 2).toBeCloseTo(base.x);
    expect((arrow.corners[1].y + arrow.corners[2].y) / 2).toBeCloseTo(base.y);
    const path = (parts[1]!.geom as LwPolylineGeometry).vertices;
    // The line runs to the tip, through the hook line, then DIMGAP + text width further.
    expect(path[0]).toMatchObject({ x: 0, y: 0 });
    expect(path).toHaveLength(5);
    expect(path[4]!.x).toBeCloseTo(22.5 + 0.625 + 16);
    expect(path[4]!.y).toBeCloseTo(10);
    // DIMCLRD 0 is ByBlock: the leader's own colour.
    expect(parts[1]!.color).toEqual({ kind: 'byBlock' });
  });

  it('runs the extension the other way when DXF 74 is 1, and not without text above', () => {
    const back = leaderParts(leader({ hookline: { sameDirection: true } }), undefined, model());
    expect((back[1]!.geom as LwPolylineGeometry).vertices[4]!.x).toBeCloseTo(22.5 - 16.625);
    const m = model();
    const centred = DocumentModel.create({
      meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
      handSeed: '100',
      header: new Map<string, HeaderValue>(),
      tables: {
        layers: [layer(LAYER_0, '0')],
        linetypes: [linetype('14', 'Continuous')],
        dimStyles: [{ ...m.tables.dimStyles.get(ISO)!, vars: { DIMASZ: 2.5, DIMTAD: 0 } }],
        blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space')],
      },
      blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
      layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
      entities: [],
    });
    expect(
      (leaderParts(leader(), undefined, centred)[1]!.geom as LwPolylineGeometry).vertices,
    ).toHaveLength(4);
    expect(
      (leaderParts(noHook(), undefined, m)[1]!.geom as LwPolylineGeometry).vertices,
    ).toHaveLength(4);
  });

  it('takes the overridden size and colour, a DIMLDRBLK block, and no arrowhead when off', () => {
    const m = model();
    const big = leaderParts(leader(), dstyle, m);
    expect(big[1]!.color).toEqual({ kind: 'aci', index: 1 });
    const arrow = big[0]!.geom as SolidGeometry;
    expect(
      Math.hypot(arrow.corners[1].x - arrow.corners[2].x, arrow.corners[1].y - arrow.corners[2].y),
    ).toBeCloseTo(5 / 3);
    const dotStyle = { ...m.tables.dimStyles.get(ISO)!, vars: { DIMASZ: 2, DIMLDRBLK: DOT } };
    const withDot = DocumentModel.create({
      meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
      handSeed: '100',
      header: new Map<string, HeaderValue>(),
      tables: {
        layers: [layer(LAYER_0, '0')],
        linetypes: [linetype('14', 'Continuous')],
        dimStyles: [dotStyle],
        blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space'), blockRecord(DOT, '_Dot')],
      },
      blocks: [
        { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
        { handle: DOT, name: '_Dot', basePoint: { x: 0, y: 0 } },
      ],
      layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
      entities: [],
    });
    const dot = leaderParts(leader(), undefined, withDot);
    expect(dot[0]!.geom).toMatchObject({ kind: 'INSERT', block: DOT, scale: { x: 2, y: 2, z: 2 } });
    expect(leaderParts(leader({ arrowhead: false }), undefined, m).map((p) => p.geom.kind)).toEqual(
      ['LWPOLYLINE'],
    );
  });

  it('bounds a leader by its path and arrowhead', () => {
    const m = model();
    const ctx = { tol: toleranceForSize(1000), tables: m, blockExtents: () => undefined };
    const b = entityBounds(leader(), ctx);
    if (b.kind !== 'box') throw new Error(b.kind);
    expect(b.box.maxX).toBeCloseTo(39.125);
    expect(b.box.maxY).toBeCloseTo(40);
    expect(b.box.minX).toBeCloseTo(0);
    expect(b.box.minY).toBeCloseTo(0);
    expect(entityBounds(leader({ spline: true }), ctx).kind).toBe('unknown');
    expect(entityBounds(leader({ vertices: [{ x: 0, y: 0 }] }), ctx).kind).toBe('empty');
  });
});
