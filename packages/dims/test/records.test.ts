// M4-02 part 4 (DEC-064): what DIMBREAK's and DIMINSPECT's records add to a dimension's
// drawing: gaps of the Break size where an object crosses its lines or between a manual break's
// points, and the inspection label, rate and frame (src/records.ts).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  type DimBreak,
  type DimInspect,
  type DimStyleRecord,
  type DimensionGeometry,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type HeaderValue,
  type NonGraphicalObject,
  type TextMeasure,
  type Xdata,
} from '@triya/engine';
import { dimensionParts, regenerateDimension, type DimPart } from '../src/index';

const STYLE = '27';
const MODEL_SPACE = '1F';
const DIM = '80';
const DICT = '81';
const CROSSING = '82';

const ISO: DimStyleRecord['vars'] = {
  DIMSCALE: 1,
  DIMASZ: 2.5,
  DIMEXO: 0.625,
  DIMEXE: 1.25,
  DIMGAP: 0.625,
  DIMTXT: 2.5,
  DIMTAD: 1,
  DIMTIH: false,
  DIMTOH: false,
  DIMDEC: 2,
  DIMZIN: 8,
  DIMDSEP: '.',
  DIMTOFL: true,
  DIMATFIT: 3,
};

const props = {
  owner: MODEL_SPACE,
  layer: '10',
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
} as const;

/** A linear dimension from (0,0) to (100,0), its line at y = 20; text above it unless DIMTAD 0. */
function linear(tad = 1): DimensionGeometry {
  return {
    kind: 'DIMENSION',
    style: STYLE,
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    dimType: 'linear',
    first: { x: 0, y: 0 },
    second: { x: 100, y: 0 },
    definitionPoint: { x: 100, y: 20 },
    textPosition: tad === 1 ? { x: 50, y: 21.875 } : { x: 50, y: 20 },
    rotation: 0,
  };
}

function drawing(
  o: {
    objects?: NonGraphicalObject[];
    crossing?: EntityGeometry;
    vars?: DimStyleRecord['vars'];
    styleXdata?: Xdata;
    tad?: number;
  } = {},
): DocumentModel {
  const entities: EntityInit[] = [
    { ...props, handle: DIM, type: 'DIMENSION', extDict: DICT, geom: linear(o.tad) },
    {
      ...props,
      handle: CROSSING,
      type: 'LINE',
      geom: o.crossing ?? { kind: 'LINE', start: { x: 30, y: -10 }, end: { x: 30, y: 30 } },
    },
  ];
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [
        {
          handle: '10',
          name: '0',
          color: { kind: 'aci', index: 7 },
          linetype: '14',
          lineweight: 'Default',
          transparency: { alpha: 255 },
          plot: true,
          on: true,
          frozen: false,
          locked: false,
        },
      ],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
      ],
      appIds: [
        { handle: '12', name: 'ACAD' },
        { handle: '13', name: 'ACAD_DSTYLE_DIMBREAK' },
      ],
      dimStyles: [
        {
          handle: STYLE,
          name: 'ISO-25',
          vars: { ...ISO, ...o.vars },
          ...(o.styleXdata && { xdata: o.styleXdata }),
        },
      ],
      blockRecords: [
        { handle: MODEL_SPACE, name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    objects: o.objects ?? [],
    entities,
  });
}

const breaks = (fields: Partial<DimBreak> = {}): DimBreak => ({
  type: 'TRIYA_DIMBREAK',
  handle: '90',
  owner: DICT,
  dimension: DIM,
  objects: [CROSSING],
  manual: [],
  ...fields,
});

const inspection = (fields: Partial<DimInspect> = {}): DimInspect => ({
  type: 'TRIYA_DIMINSPECT',
  handle: '91',
  owner: DICT,
  dimension: DIM,
  shape: 'round',
  label: 'A',
  rate: '100%',
  ...fields,
});

/** Each visible character one text height wide. */
const measure: TextMeasure = (t) =>
  t.contents.replace(/\\[A-Za-z][^;]*;|[{}]/g, '').length * t.height;

const dim = (m: DocumentModel): Entity => m.entityByHandle(DIM)!;
const draw = (m: DocumentModel) => dimensionParts(dim(m), m, measure)!;
type Line = Extract<EntityGeometry, { kind: 'LINE' }>;
type Arc = Extract<EntityGeometry, { kind: 'ARC' }>;
const lines = (ps: DimPart[]) =>
  ps.filter((p) => p.geom.kind === 'LINE').map((p) => p.geom as Line);
/** The pieces of the dimension line (y = 20), as x ranges. */
const dimLine = (ps: DimPart[]) =>
  lines(ps)
    .filter((l) => Math.abs(l.start.y - 20) < 1e-9 && Math.abs(l.end.y - 20) < 1e-9)
    .map((l) => [l.start.x, l.end.x]);
const close = (got: number[][], want: number[][]) => {
  expect(got).toHaveLength(want.length);
  got.forEach((g, i) => g.forEach((v, j) => expect(v).toBeCloseTo(want[i]![j]!, 9)));
};

describe('dimension breaks', () => {
  it('cuts a gap of the Break size (0.125 × DIMSCALE) centred where an object crosses', () => {
    expect(dimLine(draw(drawing()))).toEqual([[2.5, 97.5]]);
    const m = drawing({ objects: [breaks()] });
    close(dimLine(draw(m)), [
      [2.5, 29.9375],
      [30.0625, 97.5],
    ]);
    // Arrowheads, text and the extension lines it does not cross stay whole.
    expect(draw(m).filter((p) => p.geom.kind === 'SOLID')).toHaveLength(2);
    expect(lines(draw(m))).toHaveLength(4);
  });

  it('takes the style’s Break size (ACAD_DSTYLE_DIMBREAK) times DIMSCALE', () => {
    const styleXdata: Xdata = [
      {
        appId: '13',
        values: [
          { code: 1070, value: 391 },
          { code: 1040, value: 2 },
        ],
      },
    ];
    const m = drawing({ objects: [breaks()], styleXdata, vars: { DIMSCALE: 2 } });
    // Everything doubles with DIMSCALE: the gap is 4 wide at x = 30 on the line at y = 20.
    const pieces = dimLine(draw(m));
    expect(pieces[0]![1]).toBeCloseTo(28, 9);
    expect(pieces[1]![0]).toBeCloseTo(32, 9);
  });

  it('follows the object: drawn again after it moves, the gap is where it crosses now', () => {
    const m = drawing({
      objects: [breaks()],
      crossing: { kind: 'LINE', start: { x: 70, y: -10 }, end: { x: 70, y: 30 } },
    });
    close(dimLine(draw(m)), [
      [2.5, 69.9375],
      [70.0625, 97.5],
    ]);
    // An extension line crossed is cut too; an object that is gone breaks nothing.
    const across = drawing({
      objects: [breaks()],
      crossing: { kind: 'LINE', start: { x: -5, y: 10 }, end: { x: 5, y: 10 } },
    });
    const ext = lines(draw(across)).filter((l) => l.start.x === 0 && l.end.x === 0);
    expect(ext.map((l) => [l.start.y, l.end.y])).toEqual([
      [0.625, 9.9375],
      [10.0625, 21.25],
    ]);
    const gone = drawing({ objects: [breaks({ objects: ['FFF'] })] });
    expect(dimLine(draw(gone))).toEqual([[2.5, 97.5]]);
  });

  it('a manual break cuts between its two points on the line both lie on', () => {
    const m = drawing({
      objects: [
        breaks({
          objects: [],
          manual: [
            [
              { x: 70, y: 20 },
              { x: 60, y: 20 },
            ],
          ],
        }),
      ],
    });
    close(dimLine(draw(m)), [
      [2.5, 60],
      [70, 97.5],
    ]);
  });

  it('a record of another dimension, or one outside its dictionary, does nothing', () => {
    expect(dimLine(draw(drawing({ objects: [breaks({ dimension: '99' })] })))).toEqual([
      [2.5, 97.5],
    ]);
    expect(dimLine(draw(drawing({ objects: [breaks({ owner: '98' })] })))).toEqual([[2.5, 97.5]]);
  });

  it('regeneration writes the gaps into the block', () => {
    const m = drawing({ objects: [breaks()] });
    const r = regenerateDimension(dim(m), m, measure)!;
    expect(dimLine(r.parts)).toHaveLength(2);
  });
});

describe('inspection dimensions', () => {
  const texts = (ps: DimPart[]) =>
    ps
      .filter((p) => p.geom.kind === 'MTEXT')
      .map((p) => p.geom as Extract<EntityGeometry, { kind: 'MTEXT' }>);

  it('Round: the label left and the rate right of the value, separated and framed with semicircles', () => {
    const ps = draw(drawing({ objects: [inspection()] }));
    // "100" is 7.5 wide at (50, 21.875); DIMGAP 0.625 pads each field.
    expect(texts(ps).map((t) => [t.contents, t.position.x, t.position.y])).toEqual([
      ['100', 50, 21.875],
      ['A', 43.75, 21.875],
      ['100%', 60, 21.875],
    ]);
    const frame = lines(ps).filter((l) => l.start.y > 21 || l.end.y > 21);
    // Top and bottom from x = 41.875 to 65.625, separators at 45.625 and 54.375.
    expect(frame).toContainEqual({
      kind: 'LINE',
      start: { x: 41.875, y: 23.75 },
      end: { x: 65.625, y: 23.75 },
    });
    expect(
      frame
        .filter((l) => l.start.x === l.end.x && l.start.x > 40 && l.start.x < 70)
        .map((l) => l.start.x),
    ).toEqual([45.625, 54.375]);
    const arcs = ps.filter((p) => p.geom.kind === 'ARC').map((p) => p.geom as Arc);
    expect(arcs.map((a) => [a.center.x, a.radius])).toEqual([
      [41.875, 1.875],
      [65.625, 1.875],
    ]);
    // The left semicircle bulges left: from 90° to 270°.
    expect(arcs[0]!.startAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(arcs[0]!.endAngle).toBeCloseTo((3 * Math.PI) / 2, 12);
    // Text above the line: the dimension line stays whole, the frame's bottom on it.
    expect(dimLine(ps)).toEqual([
      [2.5, 97.5],
      [41.875, 65.625],
    ]);
  });

  it('keeps the dimension line out of the frame, its pointed ends included (Angular)', () => {
    const ps = draw(
      drawing({ objects: [inspection({ shape: 'angular' })], tad: 0, vars: { DIMTAD: 0 } }),
    );
    // Frame from 41.875 to 65.625 about y = 20, points 1.875 beyond each end.
    close(dimLine(ps), [
      [2.5, 40],
      [67.5, 97.5],
    ]);
    expect(lines(ps)).toContainEqual({
      kind: 'LINE',
      start: { x: 41.875, y: 21.875 },
      end: { x: 40, y: 20 },
    });
    expect(ps.some((p) => p.geom.kind === 'ARC')).toBe(false);
  });

  it('None draws the fields without a frame or separators; a label off leaves its field out', () => {
    const ps = draw(drawing({ objects: [inspection({ shape: 'none', label: undefined })] }));
    expect(texts(ps).map((t) => t.contents)).toEqual(['100', '100%']);
    expect(lines(ps).filter((l) => l.start.y > 21)).toEqual([]);
    expect(ps.some((p) => p.geom.kind === 'ARC')).toBe(false);
  });

  it('waits for a field’s text to be measured', () => {
    const m = drawing({ objects: [inspection()] });
    const partial: TextMeasure = (t) => (t.contents === 'A' ? undefined : measure(t));
    expect(dimensionParts(dim(m), m, partial)).toBeUndefined();
  });
});
