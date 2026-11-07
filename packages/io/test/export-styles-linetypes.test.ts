// TriyaToAcad for STYLE and LTYPE records (M1-75 part 8). The drawing is authored in memory with
// acad-ts and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  CadDocument,
  FontFlags,
  Layer,
  LineType,
  LineTypeSegment,
  TextStyle,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type LinetypeRecord,
  type ObjectCommon,
  type TextStyleRecord,
} from '@triya/engine';
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
 * Text styles Standard, NOTES (romans.shx), BOLD (arial.ttf, bold) and the shape file
 * ltypeshp.shx (nameless); linetypes Continuous and DASHED (0.5 dash, 0.25 gap).
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const notes = new TextStyle('NOTES');
  notes.filename = 'romans.shx';
  doc.textStyles!.add(notes);
  if (version > ACadVersion.AC1009) {
    const bold = new TextStyle('BOLD');
    bold.filename = 'arial.ttf';
    bold.trueType = FontFlags.Bold;
    doc.textStyles!.add(bold);
    // AutoCAD names a shape file's STYLE record with an empty string.
    const shapes = new TextStyle();
    shapes.flags = 1 as never;
    shapes.filename = 'ltypeshp.shx';
    doc.textStyles!.add(shapes);
  }
  const dashed = new LineType('DASHED');
  dashed.description = '__ __ __';
  for (const length of [0.5, -0.25]) {
    const s = new LineTypeSegment();
    s.length = length;
    dashed.addSegment(s);
  }
  doc.lineTypes!.add(dashed);
  const walls = new Layer('WALLS');
  walls.lineType = dashed;
  doc.layers!.add(walls);
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const styleNamed = (model: DocumentModel, name: string): TextStyleRecord =>
  [...model.tables.textStyles.values()].find((s) => s.name === name)!;
const linetypeNamed = (model: DocumentModel, name: string): LinetypeRecord =>
  [...model.tables.linetypes.values()].find((l) => l.name.toUpperCase() === name.toUpperCase())!;

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat) {
  return documentInit(readCadDocument(exportDocument(readCadDocument(bytes), model, { format })));
}

/** A record as it maps back, without the reader's link and the xdata the writer keeps. */
function comparable<T extends ObjectCommon>(r: T | undefined) {
  if (!r) return r;
  const { raw: _raw, xdata: _xdata, ...rest } = r;
  return rest;
}

/** A new record from an existing one, without its handle and links. */
function like<T extends ObjectCommon>(r: T): Omit<T, 'handle' | 'raw' | 'xdata'> {
  const { handle: _h, raw: _raw, xdata: _xdata, ...rest } = r;
  return rest;
}

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

describe('text styles', () => {
  it.each(formats)('writes edited and new styles (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const standard = styleNamed(model, 'Standard');
    const notes = styleNamed(model, 'NOTES');
    let added: TextStyleRecord | undefined;
    edit(model, (b) => {
      b.updateTableRecord('textStyles', standard.handle, {
        height: 2.5,
        widthFactor: 0.8,
        obliqueAngle: (15 * Math.PI) / 180,
        lastHeight: 3,
        generation: 6,
      });
      b.updateTableRecord('textStyles', notes.handle, {
        name: 'ANNOTATION',
        font: 'simplex.shx',
        bigFont: 'bigfont.shx',
      });
      added = b.addTableRecord('textStyles', {
        ...like(notes),
        name: 'TITLE',
        font: 'times.ttf',
        trueTypeFlags: 3,
      });
    });

    const back = new Map(saved(bytes, model, format).tables?.textStyles?.map((s) => [s.handle, s]));
    for (const h of [standard.handle, notes.handle, added!.handle]) {
      expect(comparable(back.get(h)), h).toEqual(comparable(model.tables.textStyles.get(h)));
    }
  });

  it.each(formats)('keeps a TrueType style’s face name and flags with its font (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const cases: [Partial<TextStyleRecord>, string | undefined][] = [
      // Made regular: the 1071 bold bit goes too, or the style reads back bold.
      [{ trueTypeFlags: 0 }, 'arial'],
      [{ trueTypeFlags: 1 }, 'arial'],
      // Another font: the face name follows it, as AutoCAD draws the face it names.
      [{ font: 'times.ttf' }, 'times'],
      [{ font: 'times.ttf', trueTypeFlags: 0 }, 'times'],
      // An SHX font has no face, so the pair goes.
      [{ font: 'romans.shx', trueTypeFlags: 0 }, undefined],
    ];
    for (const [change, face] of cases) {
      const model = open(bytes);
      const bold = styleNamed(model, 'BOLD');
      edit(model, (b) => b.updateTableRecord('textStyles', bold.handle, change));

      const back = saved(bytes, model, format).tables?.textStyles?.find(
        (s) => s.handle === bold.handle,
      );
      const name = JSON.stringify(change);
      expect(comparable(back), name).toEqual(comparable(model.tables.textStyles.get(bold.handle)));
      // The ACAD pair is the style's only xdata here: 1000 face name, 1071 flags.
      const faceName = back?.xdata?.[0]?.values.find((v) => v.code === 1000)?.value;
      expect(faceName, name).toBe(face);
    }
  });

  it('writes $TEXTSTYLE naming a style the same save adds', () => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, (b) => {
      b.addTableRecord('textStyles', { ...like(styleNamed(model, 'NOTES')), name: 'NEW' });
      b.setHeader('$TEXTSTYLE', 'NEW');
    });

    expect(new Map(saved(bytes, model, 'dxf').header).get('$TEXTSTYLE')).toBe('NEW');
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const update =
      (name: string, change: Partial<TextStyleRecord>) => (b: ChangeSetBuilder, m: DocumentModel) =>
        b.updateTableRecord('textStyles', styleNamed(m, name).handle, change);
    const cases: [(b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [
        (b, m) => b.removeTableRecord('textStyles', styleNamed(m, 'Standard').handle),
        /Standard cannot be purged/,
      ],
      [update('Standard', { name: 'MAIN' }), /Standard cannot be renamed/],
      [update('NOTES', { name: 'bold' }), /another text style is named bold/],
      [update('NOTES', { name: 'A<B' }), /not a valid text style name/],
      [update('NOTES', { name: '' }), /only a shape file/],
      [update('NOTES', { font: '' }), /needs a font file/],
      [update('NOTES', { widthFactor: 0 }), /width factor/],
      [update('NOTES', { height: -1 }), /height/],
      [update('NOTES', { obliqueAngle: Math.PI / 2 }), /oblique angle/],
      [update('NOTES', { generation: 1 }), /generation flags/],
      [update('NOTES', { trueTypeFlags: 2 }), /need a TrueType font/],
      [update('BOLD', { trueTypeFlags: 8 }), /TrueType flags 8/],
      [update('NOTES', { flags: 1 }), /shape file/],
      [update('NOTES', { flags: 16 }), /xref-dependent/],
      [update('NOTES', { xdata: [] }), /xdata changes/],
    ];
    for (const [f, message] of cases) {
      const bytes = drawing();
      const model = open(bytes);
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(bytes);
      const before = documentInit(doc);

      expect(() => triyaToAcad(doc, model), String(message)).toThrow(message);
      expect(() => triyaToAcad(readCadDocument(bytes), model)).toThrow(UnsupportedChangeError);
      expect(documentInit(doc)).toEqual(before);
    }
  });

  it('writes an R12 style and refuses TrueType bold there', () => {
    const bytes = drawing(ACadVersion.AC1009);
    const model = open(bytes);
    const notes = styleNamed(model, 'NOTES');
    edit(model, (b) =>
      b.updateTableRecord('textStyles', notes.handle, { widthFactor: 0.75, font: 'txt.shx' }),
    );
    const back = saved(bytes, model, 'dxf').tables?.textStyles?.find((s) => s.name === 'NOTES');
    expect(back).toMatchObject({ widthFactor: 0.75, font: 'txt.shx' });

    edit(model, (b) =>
      b.updateTableRecord('textStyles', notes.handle, { font: 'arial.ttf', trueTypeFlags: 2 }),
    );
    expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf')).toThrow(
      /an R12 style has no TrueType bold or italic/,
    );
  });
});

describe('linetypes', () => {
  it.each(formats)('writes edited and new linetypes (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const dashed = linetypeNamed(model, 'DASHED');
    const shapes = styleNamed(model, '');
    const dash = dashed.elements[0]!;
    let style: TextStyleRecord | undefined;
    let added: LinetypeRecord | undefined;
    edit(model, (b) => {
      b.updateTableRecord('linetypes', dashed.handle, {
        name: 'DASHED2',
        description: '____  ____',
        patternLength: 1.5,
        elements: [
          { ...dash, length: 1 },
          { ...dash, length: -0.5 },
        ],
      });
      // A text element naming a style the same save adds, and a shape from the shape file.
      style = b.addTableRecord('textStyles', { ...like(styleNamed(model, 'NOTES')), name: 'LT' });
      added = b.addTableRecord('linetypes', {
        ...like(dashed),
        name: 'GAS_LINE',
        description: 'Gas line ----GAS----',
        patternLength: 1.2,
        elements: [
          { ...dash, length: 0.5 },
          {
            ...dash,
            length: -0.2,
            shapeFlags: 2,
            style: style.handle,
            text: 'GAS',
            offset: { x: -0.1, y: -0.05 },
            scale: 0.1,
          },
          {
            ...dash,
            length: -0.5,
            shapeFlags: 5,
            shapeNumber: 132,
            style: shapes.handle,
            rotation: Math.PI / 2,
            scale: 0.1,
          },
        ],
      });
      b.setHeader('$CELTYPE', 'GAS_LINE');
      b.updateTableRecord(
        'layers',
        [...model.tables.layers.values()].find((l) => l.name === 'WALLS')!.handle,
        {
          linetype: added.handle,
        },
      );
    });

    const init = saved(bytes, model, format);
    const back = new Map(init.tables?.linetypes?.map((l) => [l.handle, l]));
    for (const h of [dashed.handle, added!.handle]) {
      expect(comparable(back.get(h)), h).toEqual(comparable(model.tables.linetypes.get(h)));
    }
    expect(new Map(init.header).get('$CELTYPE')).toBe('GAS_LINE');
    expect(init.tables?.layers?.find((l) => l.name === 'WALLS')?.linetype).toBe(added!.handle);
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const update =
      (name: string, change: (l: LinetypeRecord, m: DocumentModel) => Partial<LinetypeRecord>) =>
      (b: ChangeSetBuilder, m: DocumentModel) => {
        const l = linetypeNamed(m, name);
        b.updateTableRecord('linetypes', l.handle, change(l, m));
      };
    const element = (l: LinetypeRecord, change: object) => [{ ...l.elements[0]!, ...change }];
    const cases: [(b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [
        (b, m) => b.removeTableRecord('linetypes', linetypeNamed(m, 'Continuous').handle),
        /Continuous cannot be purged/,
      ],
      [update('Continuous', () => ({ name: 'SOLID' })), /Continuous cannot be renamed/],
      [update('ByLayer', () => ({ description: 'x' })), /ByLayer is not a linetype to edit/],
      [
        update('Continuous', (l) => ({ elements: element(l, {}), patternLength: 0 })),
        /Continuous has no pattern/,
      ],
      [update('DASHED', () => ({ name: 'continuous' })), /another linetype is named/],
      [update('DASHED', () => ({ alignment: 'B' })), /alignment is always A/],
      [update('DASHED', () => ({ patternLength: 2 })), /pattern length 2 is not/],
      [
        update('DASHED', (l) => ({
          elements: Array.from({ length: 13 }, () => l.elements[0]!),
          patternLength: 6.5,
        })),
        /more than 12 elements/,
      ],
      [
        update('DASHED', (l) => ({ elements: element(l, { shapeFlags: 6 }), patternLength: 0.5 })),
        /text or a shape, not both/,
      ],
      [
        update('DASHED', (l) => ({
          elements: element(l, { shapeFlags: 2, style: 'FFFFF', text: 'X' }),
          patternLength: 0.5,
        })),
        /text style FFFFF does not exist/,
      ],
      [
        update('DASHED', (l, m) => ({
          elements: element(l, { shapeFlags: 4, style: styleNamed(m, 'NOTES').handle }),
          patternLength: 0.5,
        })),
        /a shape needs a shape file/,
      ],
      [
        update('DASHED', (l, m) => ({
          elements: element(l, { shapeFlags: 2, style: styleNamed(m, 'NOTES').handle }),
          patternLength: 0.5,
        })),
        /needs its text/,
      ],
      [update('DASHED', () => ({ flags: 32 })), /xref-dependent/],
    ];
    for (const [f, message] of cases) {
      const bytes = drawing();
      const model = open(bytes);
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(bytes);
      const before = documentInit(doc);

      expect(() => triyaToAcad(doc, model), String(message)).toThrow(message);
      expect(documentInit(doc)).toEqual(before);
    }
  });

  it('writes an R12 linetype’s dashes and refuses text in it', () => {
    const bytes = drawing(ACadVersion.AC1009);
    const model = open(bytes);
    const dashed = linetypeNamed(model, 'DASHED');
    edit(model, (b) =>
      b.updateTableRecord('linetypes', dashed.handle, {
        patternLength: 0.75,
        elements: [
          { ...dashed.elements[0]!, length: 0.25 },
          { ...dashed.elements[1]!, length: -0.5 },
        ],
      }),
    );
    const back = saved(bytes, model, 'dxf').tables?.linetypes?.find((l) => l.name === 'DASHED');
    expect(back?.elements.map((e) => e.length)).toEqual([0.25, -0.5]);

    edit(model, (b) =>
      b.updateTableRecord('linetypes', dashed.handle, {
        elements: [
          {
            ...dashed.elements[0]!,
            shapeFlags: 2,
            style: styleNamed(model, 'NOTES').handle,
            text: 'X',
          },
        ],
        patternLength: 0.5,
      }),
    );
    expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf')).toThrow(
      /an R12 linetype has no text or shapes/,
    );
  });
});
