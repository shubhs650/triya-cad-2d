// TriyaToAcad for TABLESTYLE objects (M1-75 part 12). The drawing is authored in memory with
// acad-ts and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  DictionaryVariable,
  LineType,
  MarginFlags,
  TableEntityBorderType,
  TableStyle,
  TextStyle,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type ObjectCommon,
  type TableCellBorder,
  type TableCellStyle,
  type TableStyleRecord,
  type TextStyleRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { same } from '../src/export/entities';
import {
  cellStyleMapOf,
  documentInit,
  exportDocument,
  mappedCellStyleMap,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/** Table styles Standard and GRID, the text style ROMANS, and CTABLESTYLE = `current`. */
function drawing(
  version = ACadVersion.AC1018,
  format: CadFormat = 'dxf',
  current = TableStyle.defaultName,
  prepare?: (doc: CadDocument) => void,
): Uint8Array {
  const doc = new CadDocument(version);
  prepare?.(doc);
  const romans = new TextStyle('ROMANS');
  romans.filename = 'romans.shx';
  doc.textStyles!.add(romans);
  const dict = doc.rootDictionary!.get(CadDictionary.acadTableStyle) as CadDictionary;
  for (const name of [TableStyle.defaultName, 'GRID']) {
    const s = new TableStyle(name);
    s.cellStyles = [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle];
    for (const c of s.cellStyles) {
      c.textStyle = doc.textStyles!.get('Standard')!;
      c.textHeight = 0.18;
      c.cellAlignment = 2 as never;
    }
    s.titleCellStyle.textHeight = 0.25;
    dict.add(s);
  }
  const vars = doc.rootDictionary!.get(CadDictionary.variableDictionary) as CadDictionary;
  const variable = new DictionaryVariable();
  variable.name = 'CTABLESTYLE';
  variable.value = current;
  vars.add(variable);
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const style = (model: DocumentModel, name: string): TableStyleRecord =>
  [...model.tables.tableStyles.values()].find((s) => s.name === name)!;

const textStyle = (model: DocumentModel, name: string): string =>
  [...model.tables.textStyles.values()].find((s) => s.name === name)!.handle;

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat) {
  return documentInit(readCadDocument(exportDocument(readCadDocument(bytes), model, { format })));
}

/** A record as it maps back, without the reader's link. */
function comparable<T extends ObjectCommon>(r: T | undefined) {
  if (!r) return r;
  const { raw: _raw, ...rest } = r;
  return rest;
}

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

/** `s` with row style `row` (0 data, 1 title, 2 header) changed. */
const row = (s: TableStyleRecord, i: number, change: Partial<TableCellStyle>) => ({
  cellStyles: s.cellStyles.map((c, j) => (j === i ? { ...c, ...change } : c)),
});

/** `s` with border `edge` of row style `i` changed. */
const border = (s: TableStyleRecord, i: number, edge: number, change: Partial<TableCellBorder>) =>
  row(s, i, {
    borders: s.cellStyles[i]!.borders.map((b, k) => (k === edge ? { ...b, ...change } : b)),
  });

/** Every field the mapping carries, set to a value the drawing does not have. */
const FIELD_EDITS: Record<
  string,
  (s: TableStyleRecord, m: DocumentModel) => Partial<TableStyleRecord>
> = {
  description: () => ({ description: 'Parts lists' }),
  flowDirection: () => ({ flowDirection: 1 }),
  styleFlags: () => ({ styleFlags: 1 }),
  horizontalMargin: () => ({ horizontalMargin: 0.1 }),
  verticalMargin: () => ({ verticalMargin: 0 }),
  suppressTitle: () => ({ suppressTitle: true }),
  suppressHeader: () => ({ suppressHeader: true }),
  textStyle: (s, m) => row(s, 1, { textStyle: textStyle(m, 'ROMANS') }),
  textHeight: (s) => row(s, 0, { textHeight: 2.5 }),
  alignment: (s) => row(s, 2, { alignment: 9 }),
  textColor: (s) => row(s, 0, { textColor: { kind: 'aci', index: 1 } }),
  'textColor ByLayer': (s) => row(s, 1, { textColor: { kind: 'byLayer' } }),
  'textColor rgb': (s) => row(s, 2, { textColor: { kind: 'rgb', r: 10, g: 20, b: 30 } }),
  fillColor: (s) => row(s, 1, { fillColor: { kind: 'aci', index: 8 } }),
  'fillColor rgb': (s) => row(s, 0, { fillColor: { kind: 'rgb', r: 200, g: 210, b: 220 } }),
  fillOn: (s) => row(s, 2, { fillOn: true }),
  dataType: (s) => row(s, 0, { dataType: 4 }),
  unitType: (s) => row(s, 0, { unitType: 2 }),
  'border lineweight': (s) => border(s, 0, 2, { lineweight: 35 }),
  'border lineweight ByLayer': (s) => border(s, 1, 5, { lineweight: 'ByLayer' }),
  'border visible': (s) => border(s, 2, 1, { visible: false }),
  'border color': (s) => border(s, 0, 3, { color: { kind: 'aci', index: 5 } }),
  'border color rgb': (s) => border(s, 1, 4, { color: { kind: 'rgb', r: 1, g: 2, b: 3 } }),
};

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dxf'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1021, 'dxf'],
  [ACadVersion.AC1021, 'dwg'],
  [ACadVersion.AC1024, 'dxf'],
  [ACadVersion.AC1024, 'dwg'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

/** Whether the save keeps named cell styles: a DWG from R2010 (M1-96). */
const named = (version: ACadVersion, format: CadFormat): boolean =>
  format === 'dwg' && version >= ACadVersion.AC1024;

/**
 * A true colour is an ACI in DXF and in a DWG before R2004; the data and unit types need R2007.
 * Named cell styles (M1-96) have no place for the style's flags or the suppress settings, and
 * keep no colour for an unfilled row (the fixture's rows are unfilled).
 */
const refused = (version: ACadVersion, format: CadFormat, field: string): boolean =>
  (field.endsWith(' rgb') && (format === 'dxf' || version < ACadVersion.AC1018)) ||
  ((field === 'dataType' || field === 'unitType') && version < ACadVersion.AC1021) ||
  (named(version, format) &&
    ['styleFlags', 'suppressTitle', 'suppressHeader', 'fillColor', 'fillColor rgb'].includes(
      field,
    ));

describe('TABLESTYLE objects', () => {
  it.each(SAVES.filter(([v]) => v >= ACadVersion.AC1021))(
    'writes edited and new styles (%s %s)',
    (version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      const grid = style(model, 'GRID');
      let added = '';
      let notes = '';
      edit(model, (b) => {
        // The text style the new table style names is one the same save adds.
        const standard = [...model.tables.textStyles.values()].find((s) => s.name === 'Standard')!;
        const { handle: _h, raw: _raw, ...text } = standard;
        notes = b.addTableRecord('textStyles', {
          ...(text as Omit<TextStyleRecord, 'handle'>),
          name: 'NOTES',
          font: 'romans.shx',
          height: 0,
          widthFactor: 0.8,
        }).handle;
        b.updateTableRecord('tableStyles', grid.handle, {
          description: 'Parts lists',
          flowDirection: 1,
          horizontalMargin: 0.1,
          ...row(grid, 1, { textHeight: 0.35, fillOn: true, fillColor: { kind: 'aci', index: 8 } }),
        });
        const { handle: _h2, raw: _raw2, ...rest } = grid;
        added = b.addTableRecord('tableStyles', {
          ...rest,
          name: 'Door Schedule',
          // Named cell styles (M1-96) have no suppress settings.
          suppressTitle: !named(version, format),
          cellStyles: rest.cellStyles.map((c, i) => ({
            ...c,
            textStyle: notes,
            textHeight: [0.2, 0.4, 0.3][i]!,
            alignment: [4, 5, 5][i]!,
            dataType: 512,
            borders: c.borders.map((e, k) => ({ ...e, lineweight: k === 0 ? 50 : 25 })),
          })),
        }).handle;
        b.setHeader('CTABLESTYLE', 'Door Schedule');
      });

      const back = saved(bytes, model, format);
      const get = (h: string) => back.tables!.tableStyles!.find((s) => s.handle === h);
      expect(comparable(get(grid.handle))).toEqual(
        comparable(model.tables.tableStyles.get(grid.handle)),
      );
      expect(comparable(get(added))).toEqual(comparable(model.tables.tableStyles.get(added)));
      expect(get(added)?.cellStyles.map((c) => c.textStyle)).toEqual([notes, notes, notes]);
      expect(new Map(back.header).get('CTABLESTYLE')).toBe('Door Schedule');
    },
  );

  it('keeps everything else as it was', () => {
    const bytes = drawing();
    const model = open(bytes);
    const grid = style(model, 'GRID');
    edit(model, (b) =>
      b.updateTableRecord('tableStyles', grid.handle, row(grid, 0, { textHeight: 5 })),
    );
    const original = readCadDocument(bytes);
    const reopened = readCadDocument(
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    const was = documentInit(original);
    const now = documentInit(reopened);
    const others = (i: typeof was) =>
      i.tables!.tableStyles!.filter((s) => s.handle !== grid.handle);
    expect(others(now)).toEqual(others(was));
    expect(now.tables!.textStyles).toEqual(was.tables!.textStyles);
    // The other row styles of the edited style too.
    const edited = now.tables!.tableStyles!.find((s) => s.handle === grid.handle)!;
    expect(edited.cellStyles.slice(1)).toEqual(grid.cellStyles.slice(1));
  });

  it.each(SAVES)(
    'writes every field %s %s, or refuses what the save cannot keep',
    (version, format) => {
      const bytes = drawing(version, format);
      const problems: string[] = [];
      for (const [field, patch] of Object.entries(FIELD_EDITS)) {
        const model = open(bytes);
        const s = style(model, 'GRID');
        edit(model, (b) => b.updateTableRecord('tableStyles', s.handle, patch(s, model)));
        if (refused(version, format, field)) {
          const out = refusal(() => triyaToAcad(readCadDocument(bytes), model, format));
          if (out.length === 0) problems.push(`${field} is not refused`);
          continue;
        }
        const back = saved(bytes, model, format).tables?.tableStyles?.find(
          (x) => x.handle === s.handle,
        );
        if (!same(comparable(back), comparable(model.tables.tableStyles.get(s.handle))))
          problems.push(`${field} is not kept: ${JSON.stringify(comparable(back))}`);
      }
      expect(problems).toEqual([]);
    },
  );

  it.each(SAVES)(
    'renames a style in its dictionary entry, and CTABLESTYLE with it (%s %s, M1-95)',
    (version, format) => {
      const bytes = drawing(version, format, 'GRID');
      const model = open(bytes);
      const grid = style(model, 'GRID');
      edit(model, (b) => {
        b.updateTableRecord('tableStyles', grid.handle, { name: 'Schedule', horizontalMargin: 1 });
        b.setHeader('CTABLESTYLE', 'Schedule');
      });
      const entries = (doc: ReturnType<typeof readCadDocument>) => {
        const dict = doc.rootDictionary!.get(CadDictionary.acadTableStyle) as CadDictionary;
        return { names: dict.entryNames, handles: dict.entryHandles };
      };
      const original = entries(readCadDocument(bytes));
      const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
      expect(entries(reopened)).toEqual({
        names: original.names.map((n) => (n === 'GRID' ? 'Schedule' : n)),
        handles: original.handles,
      });
      const back = documentInit(reopened);
      expect(comparable(back.tables!.tableStyles!.find((s) => s.handle === grid.handle))).toEqual(
        comparable(model.tables.tableStyles.get(grid.handle)),
      );
      expect(new Map(back.header).get('CTABLESTYLE')).toBe('Schedule');
    },
  );

  it('refuses a rename that leaves CTABLESTYLE naming the old name', () => {
    const bytes = drawing(ACadVersion.AC1018, 'dxf', 'GRID');
    const model = open(bytes);
    edit(model, (b) =>
      b.updateTableRecord('tableStyles', style(model, 'GRID').handle, { name: 'LIST' }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(bytes), model, 'dxf'))).toEqual([
      'header variable CTABLESTYLE: it names GRID, which the save renames LIST',
    ]);
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const update =
      (name: string, change: (s: TableStyleRecord) => Partial<TableStyleRecord>) =>
      (b: ChangeSetBuilder, m: DocumentModel) =>
        b.updateTableRecord('tableStyles', style(m, name).handle, change(style(m, name)));
    const add = (change: Partial<TableStyleRecord>) => (b: ChangeSetBuilder, m: DocumentModel) => {
      const { handle: _h, raw: _raw, ...rest } = style(m, 'GRID');
      b.addTableRecord('tableStyles', { ...rest, name: 'NEW', ...change });
    };
    const cases: [(b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [
        (b, m) => b.removeTableRecord('tableStyles', style(m, 'Standard').handle),
        /Standard cannot be purged/,
      ],
      [update('GRID', () => ({ name: 'STANDARD' })), /another table style is named STANDARD/],
      [
        (b, m) => {
          b.updateTableRecord('tableStyles', style(m, 'GRID').handle, { name: 'LIST' });
          b.setHeader('CTABLESTYLE', 'GRID');
        },
        /CTABLESTYLE: no table style named "GRID"/,
      ],
      [update('Standard', () => ({ name: 'Default' })), /Standard cannot be renamed/],
      [add({ name: 'grid' }), /another table style is named grid/],
      [add({ name: 'A<B' }), /is not a valid table style name/],
      [update('GRID', () => ({ flags: 16 })), /has no flags/],
      [update('GRID', () => ({ description: 3 as never })), /description: 3 is not text/],
      [update('GRID', () => ({ flowDirection: 2 })), /flowDirection: 2 is not 0 or 1/],
      [update('GRID', () => ({ styleFlags: 0.5 })), /styleFlags: 0.5 is not a whole number/],
      [update('GRID', () => ({ verticalMargin: -1 })), /verticalMargin: -1 is not a length/],
      [update('GRID', () => ({ suppressTitle: 1 as never })), /suppressTitle: 1 is not true/],
      [
        update('GRID', (s) => ({ cellStyles: s.cellStyles.slice(0, 2) })),
        /cellStyles: a table style has 3 row styles/,
      ],
      [
        update('GRID', (s) => row(s, 1, { textStyle: undefined } as never)),
        /title row textStyle: a row style needs one/,
      ],
      [
        update('GRID', (s) => row(s, 1, { textStyle: 'FFFF' })),
        /title row textStyle: FFFF does not exist/,
      ],
      [update('GRID', (s) => row(s, 0, { textHeight: 0 })), /data row textHeight: 0 is not more/],
      [update('GRID', (s) => row(s, 2, { alignment: 10 })), /header row alignment: 10 is not/],
      [update('GRID', (s) => row(s, 2, { fillOn: 0 as never })), /fillOn: 0 is not true/],
      [
        update('GRID', (s) => row(s, 0, { dataType: 4 })),
        /data row dataType: AC1018 has no place for it \(R2007 introduced it\)/,
      ],
      [
        update('GRID', (s) => row(s, 0, { textColor: { kind: 'aci', index: 256 } })),
        /textColor: ACI 256 is not 1–255/,
      ],
      [
        update('GRID', (s) =>
          row(s, 0, { textColor: { kind: 'rgb', r: 1, g: 2, b: 3, bookName: 'RAL' } }),
        ),
        /textColor: colour-book colours/,
      ],
      [
        update('GRID', (s) => row(s, 0, { fillColor: { kind: 'rgb', r: 1, g: 2, b: 3 } })),
        /data row fillColor: a DXF table style holds ACI colours only/,
      ],
      [
        update('GRID', (s) => row(s, 0, { borders: s.cellStyles[0]!.borders.slice(1) })),
        /data row borders: a row style has 6 borders/,
      ],
      [
        update('GRID', (s) => border(s, 0, 4, { lineweight: 300 })),
        /data row inside vertical border lineweight: 300 is not a lineweight/,
      ],
      [
        update('GRID', (s) => border(s, 2, 0, { visible: 'yes' as never })),
        /header row top border visible: "yes" is not true or false/,
      ],
      [update('GRID', () => ({ xdata: [{ appId: '12', values: [] }] }) as never), /xdata changes/],
      [(b) => b.setHeader('CTABLESTYLE', 'NOPE'), /CTABLESTYLE: no table style named/],
    ];
    const bytes = drawing();
    for (const [change, message] of cases) {
      const model = open(bytes);
      edit(model, (b) => change(b, model));
      const original = readCadDocument(bytes);
      const before = documentInit(original);
      const problems = refusal(() => triyaToAcad(original, model, 'dxf'));
      expect(problems.join('\n'), String(message)).toMatch(message);
      expect(documentInit(original)).toEqual(before);
    }
  });

  it('refuses a new style before R2004', () => {
    const r2000 = drawing(ACadVersion.AC1015, 'dwg');
    const model = open(r2000);
    edit(model, (b) => {
      const { handle: _h, raw: _raw, ...rest } = style(model, 'GRID');
      b.addTableRecord('tableStyles', { ...rest, name: 'NEW' });
    });
    expect(refusal(() => triyaToAcad(readCadDocument(r2000), model, 'dwg')).join()).toMatch(
      /AC1015 has no table styles \(AutoCAD 2005 introduced tables\)/,
    );
    // An R2000 file keeps the styles AutoCAD wrote into it, which can still be edited.
    const m2 = open(r2000);
    edit(m2, (b) =>
      b.updateTableRecord('tableStyles', style(m2, 'GRID').handle, { description: 'Kept' }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(r2000), m2, 'dwg'))).toEqual([]);
  });

  it('refuses what R2010+ named cell styles have no place for (M1-96)', () => {
    const bytes = drawing(ACadVersion.AC1024, 'dwg');
    const cases: [(s: TableStyleRecord) => Partial<TableStyleRecord>, RegExp][] = [
      [() => ({ styleFlags: 1 }), /styleFlags: an R2010\+ DWG table style has no place/],
      [() => ({ suppressHeader: true }), /suppressHeader: an R2010\+ DWG table style has none/],
      [
        (s) => row(s, 1, { fillOn: true, fillColor: { kind: 'byLayer' } }),
        /title row fillColor: an R2010\+ cell style fills with a colour/,
      ],
      [
        (s) => row(s, 2, { fillColor: { kind: 'aci', index: 3 } }),
        /header row fillColor: an unfilled R2010\+ cell style keeps none/,
      ],
    ];
    for (const [change, message] of cases) {
      const model = open(bytes);
      const s = style(model, 'GRID');
      edit(model, (b) => b.updateTableRecord('tableStyles', s.handle, change(s)));
      expect(refusal(() => triyaToAcad(readCadDocument(bytes), model, 'dwg')).join('\n')).toMatch(
        message,
      );
    }
  });

  it('moves the margins of the named cell styles that had the table’s with it (M1-96)', () => {
    const doc = readCadDocument(drawing(ACadVersion.AC1024, 'dwg'));
    // Every cell style overrides the margins, as AutoCAD's do; the title row with its own, the
    // others with the table's.
    const grid = (d: typeof doc) =>
      (d.rootDictionary!.get(CadDictionary.acadTableStyle) as CadDictionary).get(
        'GRID',
      ) as TableStyle;
    const g = grid(doc);
    for (const c of [g.tableCellStyle, g.dataCellStyle, g.titleCellStyle, g.headerCellStyle])
      c.marginOverrideFlags = MarginFlags.Override;
    grid(doc).titleCellStyle.horizontalMargin = 0.5;
    const bytes = writeCadDocument(doc, { format: 'dwg' });
    const model = open(bytes);
    const s = style(model, 'GRID');
    edit(model, (b) =>
      b.updateTableRecord('tableStyles', s.handle, { horizontalMargin: 0.2, verticalMargin: 0.1 }),
    );
    const back = grid(
      readCadDocument(exportDocument(readCadDocument(bytes), model, { format: 'dwg' })),
    );
    const margins = (c: TableStyle['tableCellStyle']) => [c.horizontalMargin, c.verticalMargin];
    expect(
      [back.tableCellStyle, back.dataCellStyle, back.titleCellStyle, back.headerCellStyle].map(
        margins,
      ),
    ).toEqual([
      [0.2, 0.1],
      [0.2, 0.1],
      [0.5, 0.1],
      [0.2, 0.1],
    ]);
  });

  it('adds the ACAD_TABLESTYLE dictionary to a drawing that has none', () => {
    const doc = new CadDocument(ACadVersion.AC1018);
    doc.rootDictionary!.remove(CadDictionary.acadTableStyle);
    const bytes = writeCadDocument(doc, { format: 'dxf' });
    const model = open(bytes);
    expect(model.tables.tableStyles.size).toBe(0);
    const text = textStyle(model, 'Standard');
    const edges = (lineweight: TableCellBorder['lineweight']): TableCellBorder[] =>
      Array.from({ length: 6 }, () => ({ lineweight, visible: true, color: { kind: 'byBlock' } }));
    const cell = (textHeight: number, alignment: number): TableCellStyle => ({
      textStyle: text,
      textHeight,
      alignment,
      textColor: { kind: 'byBlock' },
      fillColor: { kind: 'aci', index: 7 },
      fillOn: false,
      dataType: 0,
      unitType: 0,
      borders: edges('ByBlock'),
    });
    let h = '';
    edit(model, (b) => {
      h = b.addTableRecord('tableStyles', {
        name: 'Standard',
        description: '',
        flowDirection: 0,
        styleFlags: 0,
        horizontalMargin: 0.06,
        verticalMargin: 0.06,
        suppressTitle: false,
        suppressHeader: false,
        cellStyles: [cell(0.18, 2), cell(0.25, 5), cell(0.18, 5)],
      }).handle;
    });
    const back = saved(bytes, model, 'dxf');
    expect(comparable(back.tables!.tableStyles!.find((s) => s.handle === h))).toEqual(
      comparable(model.tables.tableStyles.get(h)),
    );
  });
});

describe('table style border linetypes and double lines (M4-16 part 8)', () => {
  /** The fixture with the linetype DASHED loaded. */
  const dashed = (version: ACadVersion, format: CadFormat) =>
    drawing(version, format, TableStyle.defaultName, (doc) => {
      const l = new LineType('DASHED');
      l.description = '__ __ __';
      doc.lineTypes!.add(l);
    });
  const linetype = (m: DocumentModel, name: string) =>
    [...m.tables.linetypes.values()].find((l) => l.name.toUpperCase() === name)!.handle;
  /** A named cell style's place: a DXF (in its CELLSTYLEMAP) or a DWG from R2010. */
  const placed = SAVES.filter(
    ([v, f]) => v >= ACadVersion.AC1018 && (f === 'dxf' || v >= ACadVersion.AC1024),
  );

  it.each(placed)('writes and reads back edited and new styles’ borders (%s %s)', (v, format) => {
    const bytes = dashed(v, format);
    const model = open(bytes);
    const grid = style(model, 'GRID');
    const dash = linetype(model, 'DASHED');
    const outline = { linetype: dash, double: true as const, spacing: 0.09 };
    let added = '';
    edit(model, (b) => {
      const data = grid.cellStyles[0]!;
      b.updateTableRecord('tableStyles', grid.handle, {
        cellStyles: [
          { ...data, borders: data.borders.map((e, k) => (k === 0 ? { ...e, ...outline } : e)) },
          ...border(grid, 1, 5, { linetype: 'ByLayer' }).cellStyles.slice(1),
        ],
      });
      const { handle: _h, raw: _raw, ...rest } = grid;
      added = b.addTableRecord('tableStyles', {
        ...rest,
        name: 'Door Schedule',
        suppressTitle: false,
        cellStyles: rest.cellStyles.map((c) => ({
          ...c,
          alignment: 5,
          borders: c.borders.map((e) => ({ ...e, double: true as const, spacing: 0.5 })),
        })),
      }).handle;
    });
    const back = saved(bytes, model, format);
    const get = (h: string) => back.tables!.tableStyles!.find((s) => s.handle === h);
    // A DXF style gains the extension dictionary its CELLSTYLEMAP is named in.
    const { extDict: _x, ...gridBack } = comparable(get(grid.handle))!;
    expect(gridBack).toEqual(comparable(model.tables.tableStyles.get(grid.handle)));
    expect(get(grid.handle)!.cellStyles[0]!.borders[0]).toMatchObject(outline);
    expect(get(grid.handle)!.cellStyles[1]!.borders[5]!.linetype).toBe('ByLayer');
    const { extDict: _y, ...addedBack } = comparable(get(added))!;
    expect(addedBack).toEqual(comparable(model.tables.tableStyles.get(added)));
    if (format !== 'dxf') return;
    // A DXF states them in the CELLSTYLEMAP, which the edited style is given (the fixture has
    // none), kept in step with the rows; the rows have no place for them.
    const doc = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
    const acad = doc.getCadObject(Number.parseInt(grid.handle, 16)) as TableStyle;
    const map = cellStyleMapOf(acad)!;
    expect(map.cellStyles.map((c) => [c.id, c.name])).toEqual([
      [1, '_TITLE'],
      [2, '_HEADER'],
      [3, '_DATA'],
    ]);
    const rows = mappedCellStyleMap(acad)!;
    const record = get(grid.handle)!;
    rows.forEach((c, i) => {
      const r = record.cellStyles[i]!;
      expect([c.textStyle, c.textHeight, c.alignment, c.borders]).toEqual([
        r.textStyle,
        r.textHeight,
        r.alignment,
        r.borders,
      ]);
    });
    expect(acad.dataCellStyle.topBorder.type).toBe(TableEntityBorderType.Single);
  });

  it('leaves a DXF style without a CELLSTYLEMAP without one when nothing needs it', () => {
    const bytes = dashed(ACadVersion.AC1032, 'dxf');
    const model = open(bytes);
    const grid = style(model, 'GRID');
    edit(model, (b) =>
      b.updateTableRecord('tableStyles', grid.handle, border(grid, 0, 2, { lineweight: 35 })),
    );
    const doc = readCadDocument(exportDocument(readCadDocument(bytes), model, { format: 'dxf' }));
    expect(cellStyleMapOf(doc.getCadObject(Number.parseInt(grid.handle, 16)) as TableStyle)).toBe(
      undefined,
    );
  });

  it('refuses what the file has no place for and values the dialog does not take', () => {
    const cases: [
      ACadVersion,
      CadFormat,
      (s: TableStyleRecord, m: DocumentModel) => Partial<TableStyleRecord>,
      RegExp,
    ][] = [
      [
        ACadVersion.AC1021,
        'dwg',
        (s, m) => border(s, 0, 0, { linetype: linetype(m, 'DASHED') }),
        /data row top border linetype: a DWG table style before R2010 has no place for it/,
      ],
      [
        ACadVersion.AC1018,
        'dwg',
        (s) => border(s, 2, 1, { double: true, spacing: 0.1 }),
        /header row inside horizontal border double: a DWG table style before R2010 has no place for it/,
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        (s) => border(s, 1, 3, { linetype: 'FFFF' }),
        /title row left border linetype: FFFF does not exist/,
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        (s) => border(s, 1, 3, { linetype: 'ByBlock' }),
        /title row left border linetype: ByBlock is no linetype/,
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        (s) => border(s, 0, 4, { double: true, spacing: 0 }),
        /data row inside vertical border spacing: 0 is not more than 0/,
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        (s) => border(s, 0, 4, { double: true }),
        /data row inside vertical border spacing: undefined is not more than 0/,
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        (s) => border(s, 0, 4, { spacing: 0.2 }),
        /data row inside vertical border spacing: a single line has none/,
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        (s) => border(s, 0, 4, { double: false as never }),
        /data row inside vertical border double: false is not true/,
      ],
    ];
    for (const [version, format, change, message] of cases) {
      const bytes = dashed(version, format);
      const model = open(bytes);
      const s = style(model, 'GRID');
      edit(model, (b) => b.updateTableRecord('tableStyles', s.handle, change(s, model)));
      expect(refusal(() => triyaToAcad(readCadDocument(bytes), model, format)).join('\n')).toMatch(
        message,
      );
    }
  });
});

describe('table style cell styles of the drafter’s own (M4-16 part 9)', () => {
  const DXF = SAVES.filter(([v, f]) => f === 'dxf' && v >= ACadVersion.AC1018);
  /** `s`'s Data cell style as one of the drafter's own, `change` over it. */
  const own = (
    s: TableStyleRecord,
    id: number,
    name: string,
    change: Partial<TableCellStyle> = {},
  ) => ({
    ...s.cellStyles[0]!,
    // Unfilled, as a named cell style reads back (map/styles.ts).
    fillColor: { kind: 'aci' as const, index: 7 },
    id,
    name,
    ...change,
  });

  it.each(DXF)('writes, renames, edits and removes them in the CELLSTYLEMAP (%s %s)', (v) => {
    const bytes = drawing(v, 'dxf');
    const model = open(bytes);
    const grid = style(model, 'GRID');
    let added = '';
    edit(model, (b) => {
      b.updateTableRecord('tableStyles', grid.handle, {
        userCellStyles: [
          own(grid, 101, 'Notes', { textHeight: 0.3, alignment: 5 }),
          own(grid, 102, 'Totals', {
            fillOn: true,
            fillColor: { kind: 'aci', index: 2 },
            borders: grid.cellStyles[0]!.borders.map((e) => ({ ...e, double: true, spacing: 0.1 })),
          }),
        ],
      });
      const { handle: _h, raw: _raw, ...rest } = grid;
      added = b.addTableRecord('tableStyles', {
        ...rest,
        name: 'Door Schedule',
        userCellStyles: [own(grid, 101, 'Remarks')],
      }).handle;
    });
    let back = saved(bytes, model, 'dxf');
    const get = (init: typeof back, h: string) =>
      init.tables!.tableStyles!.find((s) => s.handle === h)!;
    for (const h of [grid.handle, added]) {
      const { extDict: _x, ...b } = comparable(get(back, h))!;
      const { extDict: _y, ...a } = comparable(model.tables.tableStyles.get(h))!;
      expect(b).toEqual(a);
    }
    // In the CELLSTYLEMAP after the three, as AutoCAD lists them, data cell styles.
    const saving = exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
    const doc = readCadDocument(saving);
    const map = cellStyleMapOf(doc.getCadObject(Number.parseInt(grid.handle, 16)) as TableStyle)!;
    expect(map.cellStyles.map((c) => [c.id, c.name, c.styleClass as number])).toEqual([
      [1, '_TITLE', 1],
      [2, '_HEADER', 1],
      [3, '_DATA', 2],
      [101, 'Notes', 2],
      [102, 'Totals', 2],
    ]);

    // Opened again: Notes renamed and edited, Totals removed, Grand added.
    const model2 = open(saving);
    const grid2 = style(model2, 'GRID');
    edit(model2, (b) =>
      b.updateTableRecord('tableStyles', grid2.handle, {
        userCellStyles: [
          { ...grid2.userCellStyles![0]!, name: 'Remarks', textHeight: 0.4 },
          own(grid2, 103, 'Grand'),
        ],
      }),
    );
    back = saved(saving, model2, 'dxf');
    expect(get(back, grid.handle).userCellStyles!.map((c) => [c.id, c.name, c.textHeight])).toEqual(
      [
        [101, 'Remarks', 0.4],
        [103, 'Grand', grid.cellStyles[0]!.textHeight],
      ],
    );
    // All removed: the map keeps the three.
    const saving2 = exportDocument(readCadDocument(saving), model2, { format: 'dxf' });
    const model3 = open(saving2);
    const grid3 = style(model3, 'GRID');
    edit(model3, (b) =>
      b.updateTableRecord('tableStyles', grid3.handle, { userCellStyles: undefined as never }),
    );
    const doc3 = readCadDocument(
      exportDocument(readCadDocument(saving2), model3, { format: 'dxf' }),
    );
    const map3 = cellStyleMapOf(doc3.getCadObject(Number.parseInt(grid.handle, 16)) as TableStyle)!;
    expect(map3.cellStyles.map((c) => c.name)).toEqual(['_TITLE', '_HEADER', '_DATA']);
  });

  it('refuses them in a DWG save and values the dialog does not take', () => {
    const cases: [CadFormat, (s: TableStyleRecord) => Partial<TableStyleRecord>, RegExp][] = [
      [
        'dwg',
        (s) => ({ userCellStyles: [own(s, 101, 'Notes')] }),
        /DWG save does not write cell styles/,
      ],
      [
        'dxf',
        (s) => ({ userCellStyles: [own(s, 3, 'Notes')] }),
        /cell style "Notes": id 3 is not 5 or more/,
      ],
      [
        'dxf',
        (s) => ({ userCellStyles: [own(s, 101, 'Notes'), own(s, 101, 'Other')] }),
        /cell style "Other": id 101 is taken/,
      ],
      [
        'dxf',
        (s) => ({ userCellStyles: [own(s, 101, 'Notes'), own(s, 102, 'NOTES')] }),
        /cell style "NOTES": the name is taken/,
      ],
      [
        'dxf',
        (s) => ({ userCellStyles: [own(s, 101, '_DATA')] }),
        /cell style "_DATA": the name is taken/,
      ],
      ['dxf', (s) => ({ userCellStyles: [own(s, 101, '')] }), /cell style "": not a name/],
      [
        'dxf',
        (s) => ({ userCellStyles: [own(s, 101, 'Notes', { textHeight: 0 })] }),
        /cell style "Notes" textHeight: 0 is not more than 0/,
      ],
    ];
    for (const [format, change, message] of cases) {
      const bytes = drawing(ACadVersion.AC1032, format);
      const model = open(bytes);
      const s = style(model, 'GRID');
      edit(model, (b) => b.updateTableRecord('tableStyles', s.handle, change(s)));
      expect(refusal(() => triyaToAcad(readCadDocument(bytes), model, format)).join('\n')).toMatch(
        message,
      );
    }
  });
});
