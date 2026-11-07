// TriyaToAcad for header variables and LAYER records (M1-75 part 6). The drawing is authored in
// memory with acad-ts and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts and every variable of every corpus format
// is checked by export-header.corpus.test.ts.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Color,
  DictionaryVariable,
  Layer,
  Line,
  LineType,
  TextStyle,
  XYZ,
} from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type HeaderValue, type LayerRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/**
 * Layers 0, WALLS (red, DASHED, 0.35 mm) and NOTES, linetypes Continuous and DASHED, text
 * styles Standard and NOTES, one LINE on WALLS, and the DICTIONARYVAR CMLEADERSTYLE.
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const dashed = new LineType('DASHED');
  doc.lineTypes!.add(dashed);
  const walls = new Layer('WALLS');
  walls.color = new Color(1);
  walls.lineType = dashed;
  walls.lineWeight = 35;
  doc.layers!.add(walls);
  doc.layers!.add(new Layer('NOTES'));
  doc.textStyles!.add(new TextStyle('NOTES'));
  const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  line.layer = walls;
  doc.entities!.add(line);
  const vars = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.variableDictionary);
  if (vars && !vars.containsKey(DictionaryVariable.currentMultiLeaderStyle)) {
    const v = new DictionaryVariable();
    v.name = DictionaryVariable.currentMultiLeaderStyle;
    v.value = 'Standard';
    vars.add(v);
  }
  return writeCadDocument(doc, { format });
}

function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  return { model };
}

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const layerNamed = (model: DocumentModel, name: string): LayerRecord =>
  [...model.tables.layers.values()].find((l) => l.name === name)!;

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat) {
  return documentInit(readCadDocument(exportDocument(readCadDocument(bytes), model, { format })));
}

/** A layer record as it maps back: `raw` is the reader's link, and DXF 70 holds frozen/locked. */
function comparable(l: LayerRecord | undefined) {
  if (!l) return l;
  const { raw: _raw, flags, ...rest } = l;
  const others = (flags ?? 0) & ~5;
  return { ...rest, ...(others ? { flags: others } : {}) };
}

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

describe('header variables', () => {
  it.each(formats)('writes edited variables (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const { model } = open(bytes);
    const values: Record<string, HeaderValue> = {
      $LTSCALE: 2.5,
      $TEXTSIZE: 3.5,
      $INSBASE: { x: 1, y: 2, z: 3 },
      $LIMMAX: { x: 420, y: 297 },
      $CLAYER: 'WALLS',
      $CELTYPE: 'DASHED',
      $TEXTSTYLE: 'NOTES',
      $CECOLOR: 3,
      $PDMODE: 34,
      $LUNITS: 4,
      $ORTHOMODE: true,
      $DIMSCALE: 50,
      $MEASUREMENT: 0,
      CMLEADERSTYLE: 'Annotative',
    };
    edit(model, (b) => {
      for (const [name, value] of Object.entries(values)) b.setHeader(name, value);
    });

    const back = new Map(saved(bytes, model, format).header);
    for (const [name, value] of Object.entries(values)) {
      expect(back.get(name), name).toEqual(value);
    }
  });

  it('writes $CLAYER naming a layer the same save adds', () => {
    const bytes = drawing();
    const { model } = open(bytes);
    edit(model, (b) => {
      const zero = layerNamed(model, '0');
      const { handle: _h, raw: _raw, ...init } = zero;
      b.addTableRecord('layers', { ...init, name: 'NEW' });
      b.setHeader('$CLAYER', 'NEW');
    });

    expect(new Map(saved(bytes, model, 'dxf').header).get('$CLAYER')).toBe('NEW');
  });

  it('refuses what a save cannot keep and leaves the original as it was', () => {
    const cases: [string, HeaderValue | undefined, CadFormat?][] = [
      ['$ACADVER', 'AC1015'],
      ['$HANDSEED', 'FFFFFF'],
      ['$LASTSAVEDBY', 'someone'],
      ['$CLAYER', 'MISSING'],
      // Names are matched as the record spells them, which is how they map back.
      ['$CLAYER', 'walls'],
      ['$UCSNAME', 'FRONT'],
      ['$LTSCALE', 'big'],
      ['$LTSCALE', undefined],
      ['$NOSUCHVAR', 1],
      ['NOSUCHDICTIONARYVAR', 'x'],
      ['CMLEADERSTYLE', 3],
      ['CANNOSCALEVALUE', 0.5],
      // AutoCAD 2000 moved OSMODE to the registry; DWG does not store it.
      ['$OSMODE', 0, 'dwg'],
      // No DWG header has it (an R13 DXF variable).
      ['$SAVEIMAGES', 1, 'dwg'],
      // AutoCAD takes 1 to 30, and acad-ts's DWG reader drops anything else.
      ['$STEPSPERSEC', 0],
    ];
    for (const [name, value, format] of cases) {
      const bytes = drawing();
      const { model } = open(bytes);
      edit(model, (b) => b.setHeader(name, value));
      const doc = readCadDocument(bytes);
      const before = documentInit(doc);

      expect(() => triyaToAcad(doc, model, format), name).toThrow(UnsupportedChangeError);
      expect(documentInit(doc)).toEqual(before);
    }
  });

  it('writes the DWG dimension linetypes and the DXF text fill colour (M1-87)', () => {
    const bytes = drawing();
    const { model } = open(bytes);
    edit(model, (b) => {
      b.setHeader('$DIMLTYPE', 'DASHED');
      b.setHeader('$DIMLTEX1', 'DASHED');
      b.setHeader('$DIMTFILLCLR', 3);
    });

    const dwg = new Map(saved(bytes, model, 'dwg').header);
    expect(dwg.get('$DIMLTYPE')).toBe('DASHED');
    expect(dwg.get('$DIMLTEX1')).toBe('DASHED');
    expect(new Map(saved(bytes, model, 'dxf').header).get('$DIMTFILLCLR')).toBe(3);
  });

  it('refuses on an R2004 DWG the dimension linetypes it does not store', () => {
    const bytes = drawing(ACadVersion.AC1018, 'dwg');
    const { model } = open(bytes);
    edit(model, (b) => b.setHeader('$DIMLTYPE', 'DASHED'));

    expect(() => triyaToAcad(readCadDocument(bytes), model, 'dwg')).toThrow(
      /\$DIMLTYPE: DWG before R2007 does not store it/,
    );
  });

  it('writes on DXF what a DWG save refuses', () => {
    const bytes = drawing();
    const { model } = open(bytes);
    edit(model, (b) => {
      b.setHeader('$OSMODE', 0);
      b.setHeader('$SAVEIMAGES', 1);
    });

    const back = new Map(saved(bytes, model, 'dxf').header);
    expect(back.get('$OSMODE')).toBe(0);
    expect(back.get('$SAVEIMAGES')).toBe(1);
  });

  it('refuses an R12 save of a variable R12 does not have', () => {
    const bytes = drawing(ACadVersion.AC1009);
    const { model } = open(bytes);
    edit(model, (b) => b.setHeader('$CELTSCALE', 2));

    expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf')).toThrow(
      /\$CELTSCALE: an R12 DXF does not store it/,
    );
  });
});

describe('layers', () => {
  it.each(formats)('writes edited and new layers (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const { model } = open(bytes);
    const walls = layerNamed(model, 'WALLS');
    const notes = layerNamed(model, 'NOTES');
    const continuous = [...model.tables.linetypes.values()].find(
      (l) => l.name.toUpperCase() === 'CONTINUOUS',
    )!;
    let added: LayerRecord | undefined;
    edit(model, (b) => {
      b.updateTableRecord('layers', walls.handle, {
        on: false,
        frozen: true,
        locked: true,
        color: { kind: 'rgb', r: 10, g: 20, b: 30 },
        linetype: continuous.handle,
        lineweight: 50,
        plot: false,
      });
      b.updateTableRecord('layers', notes.handle, {
        name: 'ANNOTATION',
        color: { kind: 'aci', index: 5 },
      });
      added = b.addTableRecord('layers', {
        name: 'HATCH',
        color: { kind: 'aci', index: 8 },
        linetype: walls.linetype,
        lineweight: 'Default',
        transparency: { alpha: 255 },
        plot: true,
        on: true,
        frozen: false,
        locked: true,
      });
    });

    const back = new Map(saved(bytes, model, format).tables?.layers?.map((l) => [l.handle, l]));
    for (const h of [walls.handle, notes.handle, added!.handle]) {
      expect(comparable(back.get(h)), h).toEqual(comparable(model.tables.layers.get(h)));
    }
  });

  it('puts a new entity on a layer the same save adds', () => {
    const bytes = drawing();
    const { model } = open(bytes);
    const line = [...model.entities()].find((e) => e.type === 'LINE')!;
    let layer: LayerRecord | undefined;
    edit(model, (b) => {
      const { handle: _h, raw: _raw, ...init } = layerNamed(model, 'WALLS');
      layer = b.addTableRecord('layers', { ...init, name: 'NEW' });
      b.addEntity({ owner: line.owner, layer: layer.handle, geom: line.geom });
    });

    const back = saved(bytes, model, 'dxf');
    const lines = back.entities?.filter((e) => e.type === 'LINE') ?? [];
    expect(lines.map((e) => e.layer)).toContain(layer!.handle);
  });

  it('refuses what it cannot write yet and leaves the original as it was', () => {
    const cases: ((b: ChangeSetBuilder, m: DocumentModel) => void)[] = [
      (b, m) => b.removeTableRecord('layers', layerNamed(m, 'NOTES').handle),
      (b, m) => b.updateTableRecord('layers', layerNamed(m, '0').handle, { name: 'ZERO' }),
      (b, m) => b.updateTableRecord('layers', layerNamed(m, 'NOTES').handle, { name: 'walls' }),
      (b, m) => b.updateTableRecord('layers', layerNamed(m, 'NOTES').handle, { name: 'A<B' }),
      (b, m) =>
        b.updateTableRecord('layers', layerNamed(m, 'NOTES').handle, {
          transparency: { alpha: 128 },
        }),
      (b, m) =>
        b.updateTableRecord('layers', layerNamed(m, 'NOTES').handle, {
          color: { kind: 'byLayer' },
        }),
      (b, m) => b.updateTableRecord('layers', layerNamed(m, 'NOTES').handle, { linetype: 'FFFFF' }),
      (b, m) =>
        b.updateTableRecord('layers', layerNamed(m, 'NOTES').handle, { lineweight: 'ByBlock' }),
      (b, m) => b.updateTableRecord('layers', layerNamed(m, 'NOTES').handle, { xdata: [] }),
      (b, m) => {
        const { handle: _h, raw: _raw, ...init } = layerNamed(m, 'NOTES');
        b.addTableRecord('layers', { ...init, name: 'SEE-THROUGH', transparency: { alpha: 10 } });
      },
    ];
    for (const f of cases) {
      const bytes = drawing();
      const { model } = open(bytes);
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(bytes);
      const before = documentInit(doc);

      expect(() => triyaToAcad(doc, model), String(cases.indexOf(f))).toThrow(
        UnsupportedChangeError,
      );
      expect(documentInit(doc)).toEqual(before);
    }
  });

  it('refuses an R12 save of what an R12 layer does not store', () => {
    const bytes = drawing(ACadVersion.AC1009);
    const { model } = open(bytes);
    edit(model, (b) =>
      b.updateTableRecord('layers', layerNamed(model, 'WALLS').handle, { lineweight: 50 }),
    );

    expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf')).toThrow(
      /an R12 layer does not store its lineweight/,
    );
  });

  it('writes an R12 layer’s colour, linetype and state', () => {
    const bytes = drawing(ACadVersion.AC1009);
    const { model } = open(bytes);
    const walls = layerNamed(model, 'WALLS');
    edit(model, (b) =>
      b.updateTableRecord('layers', walls.handle, {
        color: { kind: 'aci', index: 4 },
        on: false,
        frozen: true,
      }),
    );

    const back = saved(bytes, model, 'dxf').tables?.layers?.find((l) => l.name === 'WALLS');
    expect(back).toMatchObject({ color: { kind: 'aci', index: 4 }, on: false, frozen: true });
  });
});
