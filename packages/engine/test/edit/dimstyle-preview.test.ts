// M4-03 part 3: the Dimension Style Manager's preview image is a small drawing of its own, a
// plate dimensioned in the style, sized from the style's text height; the manager shows a style
// of the drawing with its sub-styles, the style dialogs the DIMVARs they hold.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  dialogVars,
  dimStylePreviewModel,
  dimStyleXdataVars,
  drawnDimStyle,
  setField,
  type DimStyleRecord,
  type DimStyleUse,
  type DimensionGeometry,
  type Entity,
} from '../../src/index';
import { entityInit, lineGeom, linetype, sampleInit } from '../model/fixtures';

const STANDARD = '27';
const ISO = '28';
const ISO_ANGULAR = '29';
const TEXT = '32';
const BIG_TEXT = '33';
const DOT_BLOCK = '50';
const DOT_RECORD = '51';
const CENTER = '17';

const style = (handle: string, name: string, vars: DimStyleRecord['vars']): DimStyleRecord => ({
  handle,
  name,
  vars,
});

function drawing(layer0: Partial<{ on: boolean; frozen: boolean; color: number }> = {}) {
  const base = sampleInit();
  const layers = (base.tables?.layers ?? []).map((l) =>
    l.name === '0'
      ? {
          ...l,
          on: layer0.on ?? true,
          frozen: layer0.frozen ?? false,
          color: { kind: 'aci' as const, index: layer0.color ?? 7 },
          linetype: CENTER,
        }
      : l,
  );
  return DocumentModel.create({
    ...base,
    tables: {
      ...base.tables,
      layers,
      linetypes: [...(base.tables?.linetypes ?? []), linetype(CENTER, 'CENTER')],
      textStyles: [
        { handle: TEXT, name: 'Standard', height: 0, widthFactor: 1 } as never,
        { handle: BIG_TEXT, name: 'Fixed', height: 5, widthFactor: 1 } as never,
      ],
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        { handle: DOT_RECORD, name: '_DOT', units: 0, explodable: true, scalable: true },
      ],
      dimStyles: [
        style(STANDARD, 'Standard', { DIMTXT: 0.18, DIMASZ: 0.18, DIMTXSTY: TEXT }),
        style(ISO, 'ISO-25', {
          DIMTXT: 2.5,
          DIMASZ: 2.5,
          DIMTXSTY: TEXT,
          DIMBLK: DOT_RECORD,
        }),
        style(ISO_ANGULAR, 'ISO-25$2', { DIMTXT: 2.5, DIMASZ: 5, DIMTXSTY: TEXT }),
      ],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: DOT_RECORD, name: '_DOT', basePoint: { x: 0, y: 0 } },
    ],
    entities: [
      ...(base.entities ?? []),
      entityInit(
        DOT_BLOCK,
        { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 0.5 },
        {
          owner: DOT_RECORD,
        },
      ),
      entityInit('60', lineGeom(100, 100, 200, 200)),
    ],
  });
}

const modelSpaceOf = (m: DocumentModel) =>
  [...m.tables.blockRecords.values()].find((r) => r.name === '*Model_Space')!.handle;
const shown = (m: DocumentModel): Entity[] =>
  m.blockEntities(modelSpaceOf(m)).map((id) => m.entity(id)!);
const dims = (m: DocumentModel) =>
  shown(m)
    .map((e) => e.geom)
    .filter((g): g is DimensionGeometry => g.kind === 'DIMENSION');

describe('Dimension style preview (M4-03 part 3)', () => {
  it('shows a style of the drawing on its sample, alone, each kind with its sub-style', () => {
    const source = drawing();
    const m = dimStylePreviewModel(source, { style: 'iso-25' })!;
    expect(m).toBeDefined();
    const all = shown(m);
    // The drawing's own objects stay out: the plate (four lines and an arc) and four dimensions.
    expect(all.map((e) => e.type).sort()).toEqual([
      'ARC',
      'DIMENSION',
      'DIMENSION',
      'DIMENSION',
      'DIMENSION',
      'LINE',
      'LINE',
      'LINE',
      'LINE',
    ]);
    expect(dims(m).map((d) => d.dimType)).toEqual(['linear', 'linear', 'angular', 'radius']);
    expect(dims(m).every((d) => d.style === ISO && d.block === undefined)).toBe(true);
    // The angle is drawn with the angular sub-style, as the drawing would draw it.
    const angle = dims(m).find((d) => d.dimType === 'angular')!;
    expect(drawnDimStyle(m, angle)).toBe(ISO_ANGULAR);
    // The arrowhead block the style uses comes along with what it holds.
    expect(m.blocks.has(DOT_RECORD)).toBe(true);
    expect(m.blockEntities(DOT_RECORD)).toHaveLength(1);
    // The source drawing is untouched.
    expect(source.tables.dimStyles.size).toBe(3);
    expect(source.blockEntities(modelSpaceOf(source))).toHaveLength(4);
  });

  it('sizes the sample from the text height, so metric and imperial styles fill the same box', () => {
    const width = (m: DocumentModel) => {
      const lines = shown(m).filter((e) => e.geom.kind === 'LINE');
      const xs = lines.flatMap((e) =>
        e.geom.kind === 'LINE' ? [e.geom.start.x, e.geom.end.x] : [],
      );
      return Math.max(...xs) - Math.min(...xs);
    };
    const source = drawing();
    const imperial = width(dimStylePreviewModel(source, { style: 'Standard' })!);
    const metric = width(dimStylePreviewModel(source, { style: 'ISO-25' })!);
    expect(imperial).toBeCloseTo(9 * 0.18);
    expect(metric).toBeCloseTo(9 * 2.5);
    // DIMSCALE grows it; a text style's fixed height replaces DIMTXT.
    const scaled = dimStylePreviewModel(source, {
      vars: { ...dialogVars({ DIMTXT: 0.18, DIMTXSTY: TEXT }), DIMSCALE: 10 },
    })!;
    expect(width(scaled)).toBeCloseTo(9 * 1.8);
    const fixed = dimStylePreviewModel(source, { vars: dialogVars({ DIMTXSTY: BIG_TEXT }) })!;
    expect(width(fixed)).toBeCloseTo(9 * 5);
    // A dialog's sample keeps the size it opened with as its text height is changed.
    const sized = dimStylePreviewModel(source, {
      vars: dialogVars({ DIMTXT: 5, DIMTXSTY: TEXT }),
      sizedBy: dialogVars({ DIMTXT: 2.5, DIMTXSTY: TEXT }),
    })!;
    expect(width(sized)).toBeCloseTo(9 * 2.5);
  });

  it('shows the dialog’s DIMVARs on a style of their own, without sub-styles', () => {
    const source = drawing();
    let vars = dialogVars({ DIMTXT: 2.5, DIMASZ: 2.5, DIMTXSTY: TEXT });
    vars = setField(vars, 'DIMBLK1', '_OPEN');
    vars = setField(vars, 'DIMBREAK', 0.25);
    vars = setField(vars, 'DIMLTYPE', CENTER);
    const m = dimStylePreviewModel(source, { vars })!;
    const handle = dims(m)[0]!.style;
    const record = m.tables.dimStyles.get(handle)!;
    expect(record.name).toBe('*PREVIEW');
    expect(record.vars.DIMTXT).toBe(2.5);
    expect(record.vars.DIMLTYPE).toBe(CENTER);
    expect(record.vars.DIMBREAK).toBeUndefined();
    // An arrowhead first chosen in the dialog is added to the preview only.
    const open = m.blocks.get(record.vars.DIMBLK as string)!;
    expect(open.name).toBe('_OPEN');
    expect(source.blocks.has(record.vars.DIMBLK as string)).toBe(false);
    // Its xdata settings are the record's, as a saved style keeps them.
    expect(dimStyleXdataVars(m, record.xdata).DIMBREAK).toBe(0.25);
    // No sub-style applies to it.
    expect(dims(m).every((d) => drawnDimStyle(m, d) === handle)).toBe(true);
    // References the drawing lacks are left out rather than drawn wrong.
    const odd = dimStylePreviewModel(source, {
      vars: { ...vars, DIMTXSTY: 'FFFF', DIMLTEX1: 'FFFF', DIMBLK2: 'not-an-arrow' },
    })!;
    const oddVars = odd.tables.dimStyles.get(dims(odd)[0]!.style)!;
    expect(oddVars.vars.DIMTXSTY).toBeUndefined();
    expect(oddVars.vars.DIMLTEX1).toBeUndefined();
    expect(oddVars.vars.DIMBLK2).toBeUndefined();
  });

  it('shows a sub-style’s own kind alone', () => {
    const source = drawing();
    const kinds = (use: DimStyleUse) =>
      shown(dimStylePreviewModel(source, { style: 'ISO-25', use })!)
        .map((e) => (e.geom.kind === 'DIMENSION' ? e.geom.dimType : e.geom.kind))
        .filter((k) => k !== 'LINE' && k !== 'ARC');
    expect(kinds('linear')).toEqual(['linear', 'linear']);
    expect(kinds('angular')).toEqual(['angular']);
    expect(kinds('radius')).toEqual(['radius']);
    expect(kinds('diameter')).toEqual(['CIRCLE', 'diameter']);
    expect(kinds('ordinate')).toEqual(['ordinate', 'ordinate']);
    expect(kinds('leader')).toEqual(['LEADER']);
  });

  it('draws on a plain layer 0 whatever the drawing makes of it', () => {
    const source = drawing({ on: false, frozen: true, color: 1 });
    const m = dimStylePreviewModel(source, { style: 'Standard' })!;
    const zero = [...m.tables.layers.values()].find((l) => l.name === '0')!;
    expect(zero).toMatchObject({ on: true, frozen: false, color: { kind: 'aci', index: 7 } });
    expect(zero.linetype).toBe('14');
    expect(shown(m).every((e) => e.layer === zero.handle)).toBe(true);
  });

  it('shows nothing for a style the drawing lacks or a drawing without model space', () => {
    const source = drawing();
    expect(dimStylePreviewModel(source, { style: 'Missing' })).toBeUndefined();
    const base = sampleInit();
    const noSpace = DocumentModel.create({
      ...base,
      tables: { ...base.tables, blockRecords: [] },
      blocks: [],
      layouts: [],
      entities: [],
    });
    expect(dimStylePreviewModel(noSpace, { vars: {} })).toBeUndefined();
  });
});
