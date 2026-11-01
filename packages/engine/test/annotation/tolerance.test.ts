// M1-52 part 4: a TOLERANCE as its compartment frames and their text, sized by the injected
// text measure and styled by its DIMSTYLE and DSTYLE overrides.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  entityBounds,
  toleranceParts,
  toleranceForSize,
  type HeaderValue,
  type LwPolylineGeometry,
  type MTextGeometry,
  type TextMeasure,
  type ToleranceGeometry,
  type Xdata,
} from '../../src/index';
import { blockRecord, LAYER_0, layer, linetype, MODEL_SPACE } from '../model/fixtures';

const STD = '27';
const ACAD = '12';
const ROMANS = '11';

function model(): DocumentModel {
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
          handle: STD,
          name: 'Standard',
          vars: { DIMTXT: 2, DIMGAP: 0.5, DIMSCALE: 1, DIMTXSTY: ROMANS, DIMCLRD: 1, DIMCLRT: 3 },
        },
      ],
      blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space')],
    },
    blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [],
  });
}

/** Each visible character one text height wide; font switches take no room. */
const measure: TextMeasure = (t) => t.contents.replace(/\\[Ff][^;]*;|[{}]/g, '').length * t.height;

/** The corpus frame: position, diameter; profile; projected zone height; datum identifier. */
function fcf(extra: Partial<ToleranceGeometry> = {}): ToleranceGeometry {
  return {
    kind: 'TOLERANCE',
    style: STD,
    position: { x: 10, y: 20 },
    rotation: 0,
    text: '{\\Fgdt;j}%%v{\\Fgdt;n}0.1%%v%%vA%%v%%v\n{\\Fgdt;d}%%v%%v%%v%%v%%v\n.5',
    ...extra,
  };
}

const frames = (parts: ReturnType<typeof toleranceParts>) =>
  parts!.filter((p) => p.geom.kind === 'LWPOLYLINE').map((p) => p.geom as LwPolylineGeometry);
const texts = (parts: ReturnType<typeof toleranceParts>) =>
  parts!.filter((p) => p.geom.kind === 'MTEXT').map((p) => p.geom as MTextGeometry);

describe('toleranceParts', () => {
  it('draws one frame per non-empty compartment, rows a text height and two gaps high', () => {
    const parts = toleranceParts(fcf(), undefined, model(), measure);
    // Row 1: j | n0.1 | A; row 2: d; row 3: .5.
    expect(texts(parts).map((t) => t.contents)).toEqual([
      '{\\Fgdt;j}',
      '{\\Fgdt;n}0.1',
      'A',
      '{\\Fgdt;d}',
      '.5',
    ]);
    const boxes = frames(parts).map((f) => {
      const xs = f.vertices.map((v) => v.x);
      const ys = f.vertices.map((v) => v.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    });
    // Text 2 high, gap 0.5: rows 3 high, centred on the insertion point's y for the first.
    // Widths: 1 char → 2 + 1; 4 chars → 8 + 1; 1 char → 3.
    expect(boxes).toEqual([
      [10, 18.5, 13, 21.5],
      [13, 18.5, 22, 21.5],
      [22, 18.5, 25, 21.5],
      [10, 15.5, 13, 18.5],
      [10, 12.5, 15, 15.5],
    ]);
    expect(frames(parts).every((f) => f.closed)).toBe(true);
    // Text middle-left, a gap in from the frame, in DIMTXSTY.
    const first = texts(parts)[0]!;
    expect(first).toMatchObject({ attachment: 4, height: 2, style: ROMANS });
    expect(first.position).toEqual({ x: 10.5, y: 20 });
    // Frames in DIMCLRD, text in DIMCLRT.
    expect(parts![0]!.color).toEqual({ kind: 'aci', index: 1 });
    expect(parts![1]!.color).toEqual({ kind: 'aci', index: 3 });
  });

  it('rotates with the entity, flips under a −Z extrusion, and takes DSTYLE overrides', () => {
    const turned = frames(
      toleranceParts(fcf({ rotation: Math.PI / 2, text: 'A' }), undefined, model(), measure),
    )[0]!;
    const close = (v: { x: number; y: number }) => [+v.x.toFixed(9), +v.y.toFixed(9)];
    // Along +Y from the insertion point, the row's top on the −X side.
    expect(turned.vertices.map(close)).toEqual([
      [8.5, 20],
      [8.5, 23],
      [11.5, 23],
      [11.5, 20],
    ]);
    const flipped = frames(
      toleranceParts(fcf({ upsideDown: true, text: 'A' }), undefined, model(), measure),
    )[0]!;
    expect(flipped.vertices.map(close)[0]).toEqual([10, 18.5]);
    // DIMTXT (140) 4 and DIMGAP (147) 1 by override: rows 6 high.
    const dstyle: Xdata = [
      {
        appId: ACAD,
        values: [
          { code: 1000, value: 'DSTYLE' },
          { code: 1002, value: '{' },
          { code: 1070, value: 140 },
          { code: 1040, value: 4 },
          { code: 1070, value: 147 },
          { code: 1040, value: 1 },
          { code: 1002, value: '}' },
        ],
      },
    ];
    const big = frames(toleranceParts(fcf({ text: 'A' }), dstyle, model(), measure))[0]!;
    expect(big.vertices.map(close)).toEqual([
      [10, 23],
      [16, 23],
      [16, 17],
      [10, 17],
    ]);
  });

  it('has no parts while text cannot be measured, and none for an empty frame', () => {
    expect(toleranceParts(fcf(), undefined, model(), () => undefined)).toBeUndefined();
    expect(toleranceParts(fcf({ text: '' }), undefined, model(), measure)).toEqual([]);
    expect(toleranceParts(fcf({ text: '{\\Fgdt;}%%v' }), undefined, model(), measure)).toEqual([]);
  });

  it('bounds a TOLERANCE by its frames and text, and is unknown without a measure', () => {
    const m = model();
    const ctx = {
      tol: toleranceForSize(1000),
      tables: m,
      blockExtents: () => undefined,
      annotationBounds: (g: { kind?: string; position?: { x: number; y: number } }) =>
        g.kind === 'MTEXT' && g.position
          ? { minX: g.position.x, minY: g.position.y, maxX: g.position.x, maxY: g.position.y }
          : undefined,
    };
    const b = entityBounds(fcf(), { ...ctx, measureText: measure });
    expect(b).toEqual({ kind: 'box', box: { minX: 10, minY: 12.5, maxX: 25, maxY: 21.5 } });
    expect(entityBounds(fcf(), ctx).kind).toBe('unknown');
    expect(entityBounds(fcf({ text: '' }), { ...ctx, measureText: measure }).kind).toBe('empty');
  });
});
