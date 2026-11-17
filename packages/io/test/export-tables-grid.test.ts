// TriyaToAcad for ACAD_TABLE rows and columns inserted and deleted (M1-75 part 34), as AutoCAD's
// Table Cell ribbon's Insert Above / Below, Insert Left / Right, Delete Rows and Delete Columns
// change a table. Rows and cells have no identity in the file, so the edited table states where
// each row and column came from (`rowOrigins`, `columnOrigins`, DEC-046), and the save moves
// each one's acad-ts row, column and cells, with what Triya does not map, to its new place.
// The drawing (table-drawing.ts) is a 3 × 2 table: a title over both columns, a header row
// (Tag, Mark) and a data row (N1, block MARK). Corpus-wide edits:
// packages/testkit/src/export/export-table-grid.corpus.test.ts.
import { ACadVersion, TableEntity } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type TableCell,
  type TableGeometry,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  roundTripTableContent,
  UnsupportedChangeError,
  type CadFormat,
} from '../src/index';
import { drawing } from './table-drawing';

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const table = (model: DocumentModel): Entity & { geom: TableGeometry } =>
  [...model.entities()].find((e) => e.type === 'ACAD_TABLE') as Entity & { geom: TableGeometry };

const blockNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.blockRecords.values()].find((b) => b.name === name)!.handle;

function edit(model: DocumentModel, geom: TableGeometry): void {
  const b = new ChangeSetBuilder(model);
  b.updateEntity(table(model).id, { geom });
  model.apply(b.build());
}

/** Saves `model` over a fresh read of `bytes` and reads the file back. */
const save = (bytes: Uint8Array, model: DocumentModel, format: CadFormat) =>
  readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));

const mapped = (doc: ReturnType<typeof readCadDocument>): TableGeometry =>
  documentInit(doc).entities!.find((e) => e.type === 'ACAD_TABLE')!.geom as TableGeometry;

const acadTable = (doc: ReturnType<typeof readCadDocument>): TableEntity =>
  [...doc.entities!].find((e) => e instanceof TableEntity) as TableEntity;

/** What the file maps back as: the table without the origins of its rows and columns. */
function stated(g: TableGeometry): TableGeometry {
  const { rowOrigins: _r, columnOrigins: _c, ...rest } = g;
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

const text = (t: string, more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text: t,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

/** Row N2 (text, block FLAG) inserted below the data row. */
function rowInserted(g: TableGeometry, model: DocumentModel): TableGeometry {
  return {
    ...g,
    rowHeights: [...g.rowHeights, 1.25],
    cells: [
      ...g.cells,
      [
        text('N2'),
        {
          ...text(''),
          type: 'block',
          block: blockNamed(model, 'FLAG'),
          blockScale: 1,
          autoFit: true,
        },
      ],
    ],
    rowOrigins: [0, 1, 2, null],
  };
}

/** Column Size inserted between the two, the title merge widened over it. */
function columnInserted(g: TableGeometry): TableGeometry {
  const [title, header, data] = g.cells as [TableCell[], TableCell[], TableCell[]];
  return {
    ...g,
    columnWidths: [3, 2, 4],
    cells: [
      [{ ...title[0]!, columnSpan: 3 }, text('', { merged: true }), { ...title[1]!, merged: true }],
      [header[0]!, text('Size'), header[1]!],
      [data[0]!, text(''), data[1]!],
    ],
    columnOrigins: [0, null, 1],
  };
}

const SAVES: [string, ACadVersion, CadFormat][] = [
  ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
  ['R2010 DXF', ACadVersion.AC1024, 'dxf'],
  ['R2007 DXF', ACadVersion.AC1021, 'dxf'],
  ['R2004 DXF', ACadVersion.AC1018, 'dxf'],
  ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
  ['R2007 DWG', ACadVersion.AC1021, 'dwg'],
  ['R2004 DWG', ACadVersion.AC1018, 'dwg'],
];

describe('ACAD_TABLE rows and columns', () => {
  it.each(SAVES)('saves a row inserted at the end to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    edit(model, rowInserted(table(model).geom, model));
    expect(mapped(save(bytes, model, format))).toEqual(stated(table(model).geom));
  });

  it.each(SAVES)('saves a column inserted in the middle to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    edit(model, columnInserted(table(model).geom));
    expect(mapped(save(bytes, model, format))).toEqual(stated(table(model).geom));
  });

  it.each(SAVES)('saves a row and a column inserted together to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const g = rowInserted(columnInserted(table(model).geom), model);
    const [n2, flag] = g.cells[3]!;
    edit(model, {
      ...g,
      cells: [...g.cells.slice(0, 3), [n2!, text('7'), flag!]],
    });
    expect(mapped(save(bytes, model, format))).toEqual(stated(table(model).geom));
  });

  it.each(SAVES)('saves the header row deleted from %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const g = table(model).geom;
    edit(model, {
      ...g,
      rowHeights: [g.rowHeights[0]!, g.rowHeights[2]!],
      cells: [g.cells[0]!, g.cells[2]!],
      rowOrigins: [0, 2],
    });
    expect(mapped(save(bytes, model, format))).toEqual(stated(table(model).geom));
  });

  it.each(SAVES)(
    'saves the first column deleted from %s, the title merge with it',
    (_w, version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      const g = table(model).geom;
      edit(model, {
        ...g,
        columnWidths: [g.columnWidths[1]!],
        cells: g.cells.map((row, i) => [i === 0 ? { ...row[1]!, merged: false } : row[1]!]),
        columnOrigins: [1],
      });
      expect(mapped(save(bytes, model, format))).toEqual(stated(table(model).geom));
    },
  );

  it('moves what a cell holds that Triya does not map with its row and column', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    const before = acadTable(readCadDocument(bytes));
    const tip = (t: TableEntity, i: number, j: number) => t.rows[i]!.cells[j]!.toolTip;
    expect(tip(before, 1, 1)).toBe('');
    // A tooltip (DWG only, unmapped) on the header's Mark cell, which moves to (2, 2).
    const doc = readCadDocument(bytes);
    acadTable(doc).rows[1]!.cells[1]!.toolTip = 'kept';
    edit(model, rowInsertedAbove(columnInserted(table(model).geom)));
    const back = acadTable(
      readCadDocument(exportDocument(doc, model, { format: 'dwg' as CadFormat })),
    );
    expect(tip(back, 2, 2)).toBe('kept');
    expect(back.rows.flatMap((r) => r.cells.map((c) => c.toolTip)).filter(Boolean)).toEqual([
      'kept',
    ]);
  });

  it('gives a row inserted into an R2018 DWG the cell style of the row it follows', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    edit(model, rowInserted(table(model).geom, model));
    const back = acadTable(save(bytes, model, 'dwg'));
    expect(back.rows.map((r) => r.styleId)).toEqual([
      ...acadTable(readCadDocument(bytes)).rows.map((r) => r.styleId),
      back.rows[2]!.styleId,
    ]);
  });

  it('saves a new cell with a format, beside one without, to DXF', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dxf', { formatted: true });
    const model = open(bytes);
    const g = rowInserted(table(model).geom, model);
    const format = g.cells[1]![0]!.format!;
    expect(format).toBeDefined();
    edit(model, {
      ...g,
      cells: [...g.cells.slice(0, 3), [{ ...g.cells[3]![0]!, format }, g.cells[3]![1]!]],
    });
    expect(mapped(save(bytes, model, 'dxf'))).toEqual(stated(table(model).geom));
  });

  const refused: [string, (g: TableGeometry) => TableGeometry, RegExp][] = [
    [
      'a row added without saying where the rows came from',
      (g) => ({ ...g, rowHeights: [...g.rowHeights, 1], cells: [...g.cells, g.cells[2]!] }),
      /rows or columns added or removed without rowOrigins/,
    ],
    [
      'row origins that are not one per row',
      (g) => ({ ...g, rowOrigins: [0, 1] }),
      /rowOrigins: 2 for 3 rows/,
    ],
    [
      'a row origin that is not a row of the table',
      (g) => ({ ...g, rowOrigins: [0, 1, 3] }),
      /rowOrigins: 3 is not a row of the table as read/,
    ],
    [
      'rows in another order',
      (g) => ({
        ...g,
        rowHeights: [g.rowHeights[0]!, g.rowHeights[2]!, g.rowHeights[1]!],
        cells: [g.cells[0]!, g.cells[2]!, g.cells[1]!],
        rowOrigins: [0, 2, 1],
      }),
      /rowOrigins: rows in another order/,
    ],
    [
      'column origins that are not whole numbers',
      (g) => ({ ...g, columnOrigins: [0, 0.5] }),
      /columnOrigins: 0.5 is not a column of the table as read/,
    ],
    [
      'every row deleted',
      (g) => ({ ...g, rowHeights: [], cells: [], rowOrigins: [] }),
      /no rows or no columns/,
    ],
    [
      'a new row of the wrong width',
      (g) => ({
        ...g,
        rowHeights: [...g.rowHeights, 1],
        cells: [...g.cells, [text('x')]],
        rowOrigins: [0, 1, 2, null],
      }),
      /a grid that is not rows × columns/,
    ],
  ];

  it.each(refused)('refuses %s', (_what, change, message) => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, change(table(model).geom));
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    expect(problems.join('\n')).toMatch(message);
  });

  it('refuses rows or columns added to a table holding a field', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg', { field: true });
    const model = open(bytes);
    edit(model, rowInserted(table(model).geom, model));
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dwg' }),
    );
    expect(problems.join('\n')).toMatch(/holds a field or formula/);
  });

  it('saves a new cell with a format of its own to an R2018 DWG, in its cell style', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    const g = rowInserted(table(model).geom, model);
    edit(model, {
      ...g,
      cells: [
        ...g.cells.slice(0, 3),
        [{ ...g.cells[3]![0]!, format: { alignment: 5 } }, g.cells[3]![1]!],
      ],
    });
    expect(mapped(save(bytes, model, 'dwg'))).toEqual(stated(table(model).geom));
  });

  it('refuses taking off a new R2018 DWG cell what the row it copies states', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg', { cellStyles: true });
    const model = open(bytes);
    const g = rowInserted(table(model).geom, model);
    const { format: _f, ...plain } = g.cells[3]![0]!;
    edit(model, { ...g, cells: [...g.cells.slice(0, 3), [plain, g.cells[3]![1]!]] });
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dwg' }),
    );
    expect(problems.join('\n')).toMatch(/cell \(3, 0\): alignment is its row's or column's/);
  });
});

/** Row New inserted above the header row. */
function rowInsertedAbove(g: TableGeometry): TableGeometry {
  return {
    ...g,
    rowHeights: [g.rowHeights[0]!, 0.6, g.rowHeights[1]!, g.rowHeights[2]!],
    cells: [
      g.cells[0]!,
      g.columnWidths.map((_, j) => text(j === 0 ? 'New' : '')),
      g.cells[1]!,
      g.cells[2]!,
    ],
    rowOrigins: [0, null, 1, 2],
  };
}

// M4-16 part 5: each row's and cell's cell style. The test drawing's table is title, header,
// data; it comes without AutoCAD 2008 data, which a DXF save then gives it.
describe('ACAD_TABLE rows and cells on cell styles of their own', () => {
  /** The table's header row made a title row, its last data cell on Header of its own. */
  const restyled = (g: TableGeometry): TableGeometry => ({
    ...g,
    rowStyles: ['title', 'title', 'data'],
    cells: g.cells.map((row, i) =>
      i === 2 ? row.map((c, j) => (j === 1 ? { ...c, cellStyle: 'header' as const } : c)) : row,
    ),
  });

  it.each([
    ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
    ['R2007 DXF', ACadVersion.AC1021, 'dxf'],
    ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
    ['R2010 DWG', ACadVersion.AC1024, 'dwg'],
  ] as const)('saves them to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    expect(table(model).geom.rowStyles).toBeUndefined();
    edit(model, restyled(table(model).geom));
    const back = mapped(save(bytes, model, format));
    expect(back.rowStyles).toEqual(['title', 'title', 'data']);
    expect(back.cells.map((r) => r.map((c) => c.cellStyle))).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [undefined, 'header'],
    ]);
    // Opened from that save and put back by their place: nothing stated again.
    const saved = exportDocument(readCadDocument(bytes), model, { format });
    const reopened = open(saved);
    const g = table(reopened).geom;
    expect(g.rowStyles).toEqual(['title', 'title', 'data']);
    const { rowStyles: _, ...placed } = g;
    edit(reopened, {
      ...placed,
      cells: g.cells.map((r) => r.map(({ cellStyle: _own, ...c }) => c)),
    });
    const plain = mapped(save(saved, reopened, format));
    expect(plain.rowStyles).toBeUndefined();
    expect(plain.cells.flat().some((c) => c.cellStyle)).toBe(false);
  });

  it.each([
    ['R2004 DXF', ACadVersion.AC1018, 'dxf'],
    ['R2007 DWG', ACadVersion.AC1021, 'dwg'],
  ] as const)('refuses them in %s, which cannot state them', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    edit(model, restyled(table(model).geom));
    const problems = refusal(() => exportDocument(readCadDocument(bytes), model, { format }));
    expect(problems.join('\n')).toMatch(/cell style other than their place gives them/);
  });
});

describe('ACAD_TABLE rows and cells on cell styles of the drafter’s own (M4-16 part 9)', () => {
  it.each([
    ['R2018 DXF', ACadVersion.AC1032],
    ['R2007 DXF', ACadVersion.AC1021],
  ] as const)('saves them to %s by their ids in the table style', (_w, version) => {
    const bytes = drawing(version, 'dxf');
    const model = open(bytes);
    const g = table(model).geom;
    const style = model.tables.tableStyles.get(g.style!)!;
    const data = style.cellStyles[0]!;
    const b = new ChangeSetBuilder(model);
    b.updateTableRecord('tableStyles', style.handle, {
      userCellStyles: [
        {
          ...data,
          textHeight: 0.18,
          alignment: 1,
          fillColor: { kind: 'aci', index: 7 },
          fillOn: false,
          id: 101,
          name: 'Notes',
        },
        {
          ...data,
          textHeight: 0.18,
          alignment: 1,
          fillColor: { kind: 'aci', index: 7 },
          fillOn: false,
          id: 102,
          name: 'Totals',
        },
      ],
    });
    b.updateEntity(table(model).id, {
      geom: {
        ...g,
        rowStyles: ['title', 'header', 102],
        cells: g.cells.map((row, i) =>
          i === 1 ? row.map((c, j) => (j === 1 ? { ...c, cellStyle: 101 } : c)) : row,
        ),
      },
    });
    model.apply(b.build());
    const saved = exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
    const back = mapped(readCadDocument(saved));
    expect(back.rowStyles).toEqual(['title', 'header', 102]);
    expect(back.cells.map((r) => r.map((c) => c.cellStyle))).toEqual([
      [undefined, undefined],
      [undefined, 101],
      [undefined, undefined],
    ]);
    // The TABLECONTENT names them by id.
    const t = acadTable(readCadDocument(saved));
    const content = roundTripTableContent(t, (h) =>
      readCadDocument(saved).getCadObject(h),
    )!.content!;
    expect(content.rows.map((r) => r.styleId)).toEqual([1, 2, 102]);
    expect(content.rows[1]!.cells[1]!.styleId).toBe(101);
  });
});

describe('ACAD_TABLE cell locks (M4-16 part 6)', () => {
  /** The last data row's first cell locked in content, its second in format and content. */
  const locked = (g: TableGeometry): TableGeometry => ({
    ...g,
    cells: g.cells.map((row, i) =>
      i === 2
        ? row.map((c, j) => ({ ...c, locked: j === 0 ? ('content' as const) : ('both' as const) }))
        : i === 1
          ? row.map((c, j) => (j === 0 ? { ...c, locked: 'format' as const } : c))
          : row,
    ),
  });
  const locks = (g: TableGeometry) => g.cells.map((r) => r.map((c) => c.locked));

  it.each([
    ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
    ['R2007 DXF', ACadVersion.AC1021, 'dxf'],
    ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
    ['R2010 DWG', ACadVersion.AC1024, 'dwg'],
  ] as const)('saves them to %s, and unlocked again', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    expect(
      table(model)
        .geom.cells.flat()
        .some((c) => c.locked),
    ).toBe(false);
    edit(model, locked(table(model).geom));
    const saved = exportDocument(readCadDocument(bytes), model, { format });
    expect(locks(mapped(readCadDocument(saved)))).toEqual([
      [undefined, undefined],
      ['format', undefined],
      ['content', 'both'],
    ]);
    // AutoCAD's state flags: 0x1 content locked, 0x10 format locked.
    const doc = readCadDocument(saved);
    const t = acadTable(doc);
    const content = roundTripTableContent(t, (h) => doc.getCadObject(h))?.content;
    const flags = (format === 'dwg' ? t.rows : (content?.rows ?? []))[2]!.cells.map(
      (c) => c.stateFlags,
    );
    expect(flags).toEqual([0x1, 0x11]);
    // Opened from that save and unlocked: the flags go.
    const reopened = open(saved);
    const g = table(reopened).geom;
    edit(reopened, { ...g, cells: g.cells.map((r) => r.map(({ locked: _, ...c }) => c)) });
    const plain = mapped(save(saved, reopened, format));
    expect(plain.cells.flat().some((c) => c.locked)).toBe(false);
  });

  it.each([
    ['R2004 DXF', ACadVersion.AC1018, 'dxf'],
    ['R2007 DWG', ACadVersion.AC1021, 'dwg'],
  ] as const)('refuses them in %s, which cannot state them', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    edit(model, locked(table(model).geom));
    const problems = refusal(() => exportDocument(readCadDocument(bytes), model, { format }));
    expect(problems.join('\n')).toMatch(/locked cells/);
  });
});

describe('ACAD_TABLE border linetypes, double lines and hidden borders (M4-16 part 7)', () => {
  const continuous = (model: DocumentModel): string =>
    [...model.tables.linetypes.values()].find((l) => l.name.toUpperCase() === 'CONTINUOUS')!.handle;
  const red = { kind: 'aci' as const, index: 1 };
  /** The data row's first cell framed double in Continuous, its second's left edge hidden. */
  const bordered = (g: TableGeometry, linetype: string): TableGeometry => ({
    ...g,
    cells: g.cells.map((row, i) =>
      i !== 2
        ? row
        : row.map((c, j) =>
            j === 0
              ? {
                  ...c,
                  format: {
                    ...c.format,
                    borders: {
                      top: { color: red, lineweight: 50, linetype, double: true, spacing: 0.05 },
                      bottom: { double: true, spacing: 0.25 },
                    },
                  },
                }
              : { ...c, format: { ...c.format, borders: { left: { hidden: true } } } },
          ),
    ),
  });
  const borders = (g: TableGeometry) => g.cells[2]!.map((c) => c.format?.borders);

  it.each([
    ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
    ['R2007 DXF', ACadVersion.AC1021, 'dxf'],
    ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
    ['R2010 DWG', ACadVersion.AC1024, 'dwg'],
  ] as const)('saves them to %s, and plain again', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const lt = continuous(model);
    edit(model, bordered(table(model).geom, lt));
    const saved = exportDocument(readCadDocument(bytes), model, { format });
    expect(borders(mapped(readCadDocument(saved)))).toEqual(
      borders(bordered(table(model).geom, lt)),
    );
    // The border's type 2 (double), its linetype and spacing, in AutoCAD's border override bits.
    const doc = readCadDocument(saved);
    const t = acadTable(doc);
    const content = roundTripTableContent(t, (h) => doc.getCadObject(h))?.content;
    const top = (format === 'dwg' ? t.rows : (content?.rows ?? []))[2]!.cells[0]!.styleOverride
      .topBorder;
    expect([top.type, top.doubleLineSpacing, top.lineType?.name.toUpperCase()]).toEqual([
      2,
      0.05,
      'CONTINUOUS',
    ]);
    expect(top.propertyOverrideFlags & 0x2d).toBe(0x2d);
    // Opened from that save and the borders taken off: single, ByBlock and shown again.
    const reopened = open(saved);
    const g = table(reopened).geom;
    edit(reopened, {
      ...g,
      cells: g.cells.map((r) => r.map(({ format: _, ...c }) => c)),
    });
    const plain = mapped(save(saved, reopened, format));
    expect(borders(plain)).toEqual([undefined, undefined]);
  });

  it.each([
    ['R2004 DXF', ACadVersion.AC1018, 'dxf', /border linetypes, double lines or hidden borders/],
    ['R2007 DWG', ACadVersion.AC1021, 'dwg', /border linetypes or double lines/],
  ] as const)('refuses them in %s, which cannot state them', (_w, version, format, why) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    edit(model, bordered(table(model).geom, continuous(model)));
    const problems = refusal(() => exportDocument(readCadDocument(bytes), model, { format }));
    expect(problems.join('\n')).toMatch(why);
  });

  it('saves a hidden edge alone to an R2007 DWG, whose cell flags state it', () => {
    const bytes = drawing(ACadVersion.AC1021, 'dwg');
    const model = open(bytes);
    const g = table(model).geom;
    edit(model, {
      ...g,
      cells: g.cells.map((row, i) =>
        i === 2 ? row.map((c) => ({ ...c, format: { borders: { left: { hidden: true } } } })) : row,
      ),
    });
    const back = mapped(save(bytes, model, 'dwg'));
    expect(back.cells[2]!.map((c) => c.format?.borders?.left)).toEqual([
      { hidden: true },
      { hidden: true },
    ]);
  });
});
