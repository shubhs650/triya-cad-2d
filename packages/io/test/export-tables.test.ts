// TriyaToAcad for ACAD_TABLE (M1-75 part 14): table editing as AutoCAD's table grips and cell
// editor change a table (move, direction, row heights, column widths, cell text and blocks, cell
// rotation, the table style and the `*T` block). The drawing is authored in memory with acad-ts
// and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  CadDocument,
  CadValueType,
  CellContent,
  CellType,
  Line,
  TableCellContentType,
  TableCellStateFlags,
  TableEntity,
  TableEntityCell,
  TableEntityColumn,
  TableEntityRow,
  TableStyle,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type TableGeometry,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

interface Options {
  /** A field in cell (1, 1) instead of its text. */
  readonly field?: boolean;
  /** Cell (1, 1) has its content locked (TableCellStateFlags.ContentLocked). */
  readonly locked?: boolean;
}

/**
 * Table styles Standard and GRID; blocks MARK and FLAG; one table in model space with its `*T`
 * block (a frame line), 3 rows × 2 columns: a title, a header row and a data row whose second
 * cell shows block MARK.
 */
function drawing(
  version = ACadVersion.AC1032,
  format: CadFormat = 'dxf',
  options: Options = {},
): Uint8Array {
  const doc = new CadDocument(version);
  const dict = doc.rootDictionary!.get(CadDictionary.acadTableStyle) as CadDictionary;
  const styles = [TableStyle.defaultName, 'GRID'].map((name) => {
    const s = new TableStyle(name);
    s.cellStyles = [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle];
    dict.add(s);
    return s;
  });
  const blocks = ['MARK', 'FLAG', '*T1'].map((name) => {
    const b = new BlockRecord(name);
    const l = new Line();
    l.endPoint = new XYZ(1, 1, 0);
    b.entities.add(l);
    doc.blockRecords!.add(b);
    return b;
  });
  const t = new TableEntity();
  doc.entities!.add(t);
  t.style = styles[0]!;
  t.block = blocks[2]!;
  t.insertPoint = new XYZ(10, 20, 0);
  t.horizontalDirection = new XYZ(1, 0, 0);
  for (const w of [3, 4]) {
    const c = new TableEntityColumn();
    c.width = w;
    t.columns.push(c);
  }
  const texts = [
    ['Schedule', ''],
    ['Tag', 'Mark'],
    ['N1', null],
  ];
  texts.forEach((row, i) => {
    const r = new TableEntityRow();
    r.height = 0.5 + i * 0.25;
    row.forEach((text, j) => {
      const cell = new TableEntityCell();
      const content = new CellContent();
      if (text === null) {
        cell.type = CellType.Block;
        cell.value = blocks[0]!;
        content.contentType = TableCellContentType.Block;
        content.blockRecord = blocks[0]!;
        cell.blockScale = 1;
      } else {
        content.contentType = TableCellContentType.Value;
        content.cadValue.setValue(text, CadValueType.String);
      }
      cell.contents.push(content);
      // The title spans both columns (DXF 175 / 176), the cell after it is covered by it.
      if (i === 0) {
        cell.borderWidth = j === 0 ? 2 : 0;
        cell.borderHeight = j === 0 ? 1 : 0;
        cell.mergedValue = j === 0 ? 0 : 1;
      } else {
        cell.borderWidth = 1;
        cell.borderHeight = 1;
      }
      r.cells.push(cell);
    });
    t.rows.push(r);
  });
  const special = t.rows[1]!.cells[1]!;
  if (options.locked) special.stateFlags = TableCellStateFlags.ContentLocked;
  if (options.field) special.contents[0]!.contentType = TableCellContentType.Field;
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const table = (model: DocumentModel): Entity & { geom: TableGeometry } =>
  [...model.entities()].find((e) => e.type === 'ACAD_TABLE') as Entity & { geom: TableGeometry };

const blockNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.blockRecords.values()].find((b) => b.name === name)!.handle;

const styleNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.tableStyles.values()].find((s) => s.name === name)!.handle;

function edit(model: DocumentModel, geom: EntityGeometry): void {
  const b = new ChangeSetBuilder(model);
  b.updateEntity(table(model).id, { geom });
  model.apply(b.build());
}

/** Saves `model` over a fresh read of `bytes` and maps the table back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat): TableGeometry {
  const init = documentInit(
    readCadDocument(exportDocument(readCadDocument(bytes), model, { format })),
  );
  return init.entities!.find((e) => e.type === 'ACAD_TABLE')!.geom as TableGeometry;
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

/** `g` with cell (i, j) changed. */
function cell(g: TableGeometry, i: number, j: number, change: object): TableGeometry {
  return {
    ...g,
    cells: g.cells.map((row, k) =>
      k === i ? row.map((c, l) => (l === j ? { ...c, ...change } : c)) : row,
    ),
  };
}

// An R2007 DWG of a table authored in memory leaves the table out (acad-ts finds no ACAD_TABLE
// class for it), so R2007 DWG tables are covered by the corpus file only.
const SAVES: [string, ACadVersion, CadFormat][] = [
  ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
  ['R2010 DXF', ACadVersion.AC1024, 'dxf'],
  ['R2007 DXF', ACadVersion.AC1021, 'dxf'],
  ['R2004 DXF', ACadVersion.AC1018, 'dxf'],
  ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
  ['R2004 DWG', ACadVersion.AC1018, 'dwg'],
];

describe('ACAD_TABLE', () => {
  it.each(SAVES)('maps the authored table from %s', (_what, version, format) => {
    const g = table(open(drawing(version, format))).geom;
    expect(g.cells.map((r) => r.map((c) => c.text))).toEqual([
      ['Schedule', ''],
      ['Tag', 'Mark'],
      ['N1', ''],
    ]);
    expect(g.cells[2]![1]!.type).toBe('block');
    expect(g.rowHeights).toEqual([0.5, 0.75, 1]);
    expect(g.columnWidths).toEqual([3, 4]);
  });

  it.each(SAVES)('saves a moved and edited table to %s and maps it back', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const g = table(model).geom;
    let next: TableGeometry = {
      ...g,
      position: { x: 12.5, y: -4 },
      direction: { x: 0.6, y: 0.8 },
      rowHeights: [0.6, 0.75, 1.5],
      columnWidths: [3, 5.25],
      style: styleNamed(model, 'GRID'),
      block: blockNamed(model, 'MARK'),
    };
    next = cell(next, 0, 0, { text: 'Nozzle schedule' });
    next = cell(next, 1, 1, { text: '{\\fArial|b1;Mark}' });
    next = cell(next, 2, 0, { text: '' });
    next = cell(next, 2, 1, { block: blockNamed(model, 'FLAG') });
    edit(model, next);
    expect(saved(bytes, model, format)).toEqual(table(model).geom);
  });

  it.each(SAVES.filter(([w]) => !/R2018 DWG/.test(w)))(
    'saves a cell rotation to %s',
    (_w, version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      edit(model, cell(table(model).geom, 1, 0, { rotation: Math.PI / 2 }));
      expect(saved(bytes, model, format).cells[1]![0]!.rotation).toBeCloseTo(Math.PI / 2, 12);
    },
  );

  it('writes text into a cell that had none, and a number cell as the text typed', () => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, cell(cell(table(model).geom, 0, 1, { text: 'x' }), 1, 0, { text: '12.50' }));
    const back = saved(bytes, model, 'dxf');
    expect(back.cells[0]![1]!.text).toBe('x');
    expect(back.cells[1]![0]!.text).toBe('12.50');
  });

  it('leaves the rest of the table as read when one cell changes', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    const before = table(model).geom;
    edit(model, cell(before, 1, 0, { text: 'Item' }));
    const back = saved(bytes, model, 'dwg');
    expect(back).toEqual(cell(before, 1, 0, { text: 'Item' }));
  });

  const refused: [string, (g: TableGeometry, m: DocumentModel) => TableGeometry, RegExp][] = [
    [
      'a row more',
      (g) => ({ ...g, rowHeights: [...g.rowHeights, 1], cells: [...g.cells, g.cells[2]!] }),
      /rows or columns added or removed/,
    ],
    [
      'a column less',
      (g) => ({ ...g, columnWidths: [3], cells: g.cells.map((r) => r.slice(0, 1)) }),
      /rows or columns added or removed/,
    ],
    [
      'a cell less in a row',
      (g) => ({ ...g, cells: [g.cells[0]!, g.cells[1]!.slice(0, 1), g.cells[2]!] }),
      /rows or columns added or removed/,
    ],
    ['a row height of 0', (g) => ({ ...g, rowHeights: [0.5, 0, 1] }), /row height of 0 or less/],
    [
      'a negative column width',
      (g) => ({ ...g, columnWidths: [3, -4] }),
      /column width of 0 or less/,
    ],
    [
      'no horizontal direction',
      (g) => ({ ...g, direction: { x: 0, y: 0 } }),
      /no horizontal direction/,
    ],
    ['a tilted plane', (g) => ({ ...g, normal: { x: 0, y: 1, z: 1 } }), /not ±Z/],
    ['a thickness', (g) => ({ ...g, thickness: 2 }), /thickness/],
    ['no table style', ({ style: _s, ...g }) => g, /without its table style/],
    [
      'a table style that does not exist',
      (g) => ({ ...g, style: 'FFFF' }),
      /table style FFFF does not exist/,
    ],
    ['no block', ({ block: _b, ...g }) => g, /without its block/],
    [
      'model space as its block',
      (g, m) => ({ ...g, block: blockNamed(m, '*Model_Space') }),
      /cannot be a table's block/,
    ],
    ['a merge', (g) => cell(g, 2, 0, { columnSpan: 2 }), /merged cells change/],
    ['an unmerge', (g) => cell(g, 0, 1, { merged: false }), /merged cells change/],
    [
      'a text cell turned into a block cell',
      (g, m) => cell(g, 1, 0, { type: 'block', text: '', block: blockNamed(m, 'MARK') }),
      /between text and block/,
    ],
    ['text in a block cell', (g) => cell(g, 2, 1, { text: 'x' }), /text in a block cell/],
    [
      'a block cell without a block',
      (g) => cell(g, 2, 1, { block: undefined }),
      /block cell without a block/,
    ],
    [
      'a block that cannot be inserted',
      (g, m) => cell(g, 2, 1, { block: blockNamed(m, '*Paper_Space') }),
      /cannot be a cell's block/,
    ],
    ['a cell format', (g) => cell(g, 1, 0, { format: { alignment: 5 } }), /cell formats change/],
    [
      'a table-wide override',
      (g) => ({ ...g, overrides: { margins: { left: 0.2 } } }),
      /table overrides change/,
    ],
  ];
  it.each(refused)('refuses %s', (_what, change, message) => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, change(table(model).geom, model));
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    expect(problems.join('; ')).toMatch(message);
  });

  it('refuses a new table, which needs a *T block of its own', () => {
    const bytes = drawing();
    const model = open(bytes);
    const t = table(model);
    const b = new ChangeSetBuilder(model);
    b.addEntity({ type: 'ACAD_TABLE', owner: t.owner, layer: t.layer, geom: t.geom } as never);
    model.apply(b.build());
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    expect(problems.join('; ')).toMatch(/new tables/);
  });

  it('refuses a text edit of a cell holding a field, and of a locked cell', () => {
    for (const options of [{ field: true }, { locked: true }]) {
      const bytes = drawing(ACadVersion.AC1032, 'dwg', options);
      const model = open(bytes);
      edit(model, cell(table(model).geom, 1, 1, { text: 'changed' }));
      const problems = refusal(() =>
        exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
      );
      expect(problems.join('; ')).toMatch(options.field ? /holds a field/ : /content is locked/);
    }
  });

  it('refuses a cell rotation in a DWG from R2010, which keeps it in the content format', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    edit(model, cell(table(model).geom, 1, 0, { rotation: Math.PI / 2 }));
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dwg' }),
    );
    expect(problems.join('; ')).toMatch(/cell rotation in a DWG from R2010/);
    // The same edit saves to DXF, which states it per cell (145).
    expect(saved(bytes, model, 'dxf').cells[1]![0]!.rotation).toBeCloseTo(Math.PI / 2, 12);
  });
});
