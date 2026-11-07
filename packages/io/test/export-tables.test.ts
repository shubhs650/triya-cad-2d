// TriyaToAcad for ACAD_TABLE (M1-75 parts 14 and 26): table editing as AutoCAD's table grips,
// cell editor and Table Cell ribbon change a table (move, direction, row heights, column widths,
// cell text and blocks, cell rotation, the table style and the `*T` block; Merge Cells and
// Unmerge Cells; a cell's alignment, text style, height, colours, fill and borders). The drawing is authored in memory with acad-ts
// and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts. New tables: export-tables-new.test.ts.
import { ACadVersion, TableEntity } from '@node-projects/acad-ts';
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
  type CadFormat,
} from '../src/index';
import { drawing } from './table-drawing';

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

const SAVES: [string, ACadVersion, CadFormat][] = [
  ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
  ['R2010 DXF', ACadVersion.AC1024, 'dxf'],
  ['R2007 DXF', ACadVersion.AC1021, 'dxf'],
  ['R2004 DXF', ACadVersion.AC1018, 'dxf'],
  ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
  ['R2007 DWG', ACadVersion.AC1021, 'dwg'],
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
      /a grid that is not rows × columns/,
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
    [
      'a merge running off the table',
      (g) => cell(g, 2, 1, { columnSpan: 2 }),
      /cell \(2, 1\): its merge runs off the table/,
    ],
    [
      'a merge over a cell that is not marked merged',
      (g) => cell(g, 1, 0, { columnSpan: 2 }),
      /cell \(1, 1\) is in the merge of cell \(1, 0\) but not marked merged/,
    ],
    [
      'a merged cell no merge covers',
      (g) => cell(g, 2, 0, { merged: true }),
      /cell \(2, 0\) is marked merged but no merge covers it/,
    ],
    [
      'two merges over one cell',
      (g) =>
        cell(cell(cell(g, 1, 1, { rowSpan: 2 }), 2, 1, { merged: true }), 0, 1, {
          merged: true,
          rowSpan: 2,
        }),
      /cell \(0, 1\)/,
    ],
    [
      'a span that is not a whole number',
      (g) => cell(g, 1, 0, { rowSpan: 1.5 }),
      /cell \(1, 0\): rowSpan 1.5 is not a whole number of 1 or more/,
    ],
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
    [
      'an alignment AutoCAD does not have',
      (g) => cell(g, 1, 0, { format: { alignment: 10 } }),
      /cell \(1, 0\): alignment 10 is not 1 to 9/,
    ],
    [
      'a text height of 0',
      (g) => cell(g, 1, 0, { format: { textHeight: 0 } }),
      /cell \(1, 0\): textHeight 0 is not a number more than 0/,
    ],
    [
      'a text style that does not exist',
      (g) => cell(g, 1, 0, { format: { textStyle: 'FFFF' } }),
      /cell \(1, 0\): text style FFFF does not exist/,
    ],
    [
      'a lineweight AutoCAD does not have',
      (g) => cell(g, 1, 0, { format: { borders: { top: { lineweight: 17 } } } }),
      /cell \(1, 0\): top border lineweight 17 is not a lineweight/,
    ],
    [
      'a true colour in a DXF cell',
      (g) => cell(g, 1, 0, { format: { contentColor: { kind: 'rgb', r: 1, g: 2, b: 3 } } }),
      /cell \(1, 0\): contentColor: a DXF table cell holds ACI colours only/,
    ],
    [
      'a hidden edge in a DXF cell',
      (g) => cell(g, 1, 0, { format: { borders: { left: { hidden: true } } } }),
      /cell \(1, 0\): a hidden left edge, which acad-ts cannot write to DXF \(M1-81\)/,
    ],
    [
      'cell margins outside a DWG from R2010',
      (g) => cell(g, 1, 0, { format: { margins: { left: 0.2 } } }),
      /cell \(1, 0\): cell margins, which only a DWG from R2010 states per cell/,
    ],
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

  // Merge Cells and Unmerge Cells (M1-75 part 26): DXF and DWG before R2010 state a merge per
  // cell (DXF 173 merged, 175 / 176 the head's spans), DWG R2010+ as the table's merged ranges.
  it.each(SAVES)('saves merged and unmerged cells to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    let g = table(model).geom;
    // Unmerge the title (an R2018 DWG authored in memory has no merge: acad-ts writes ranges only).
    g = cell(cell(g, 0, 0, { columnSpan: 1 }), 0, 1, { merged: false });
    // Merge the first column's header and data cells.
    g = cell(cell(g, 1, 0, { rowSpan: 2 }), 2, 0, { merged: true });
    edit(model, g);
    const back = saved(bytes, model, format);
    expect(back.cells).toEqual(table(model).geom.cells);
    expect(back.cells[1]![0]).toMatchObject({ rowSpan: 2, columnSpan: 1, merged: false });
    expect(back.cells[2]![0]).toMatchObject({ rowSpan: 1, columnSpan: 1, merged: true });
  });

  it.each(SAVES.filter(([w]) => !/R2018 DWG/.test(w)))(
    'merges the title again in %s',
    (_w, version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      const g = table(model).geom;
      const unmerged = cell(cell(g, 0, 0, { columnSpan: 1 }), 0, 1, { merged: false });
      edit(model, unmerged);
      const once = exportDocument(readCadDocument(bytes), model, { format });
      const again = open(once);
      edit(again, g);
      expect(saved(once, again, format).cells).toEqual(g.cells);
    },
  );

  it('saves a merge into an R2018 DWG as its merged ranges', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    const g = table(model).geom;
    edit(model, cell(cell(g, 0, 0, { columnSpan: 2 }), 0, 1, { merged: true }));
    const out = readCadDocument(exportDocument(readCadDocument(bytes), model, { format: 'dwg' }));
    const t = [...out.entities!].find((e) => e instanceof TableEntity) as TableEntity;
    expect(t.mergedCellRanges.map((r) => [r.topRowIndex, r.leftColumnIndex])).toEqual([[0, 0]]);
    expect(t.mergedCellRanges.map((r) => [r.bottomRowIndex, r.rightColumnIndex])).toEqual([[0, 1]]);
  });

  // Cell formats (M1-75 part 26), as the Table Cell ribbon sets them on one cell: written into the
  // cell's override flag word, which DXF and DWG before R2010 state.
  const FLAG_SAVES = SAVES.filter(([w]) => !/R2018 DWG/.test(w));

  it.each(FLAG_SAVES)('saves cell formats to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const standard = [...model.tables.textStyles.values()].find(
      (s) => s.name.toUpperCase() === 'STANDARD',
    )!.handle;
    const dwg = format === 'dwg';
    let g = table(model).geom;
    g = cell(g, 1, 0, {
      format: {
        alignment: 5,
        textStyle: standard,
        textHeight: 0.25,
        contentColor: { kind: 'aci', index: 1 },
        background: { kind: 'aci', index: 4 },
        borders: {
          top: { color: { kind: 'aci', index: 2 }, lineweight: 50 },
          right: { lineweight: 35 },
          ...(dwg ? { bottom: { hidden: true } } : {}),
        },
      },
    });
    g = cell(g, 1, 1, {
      format: {
        background: null,
        contentColor: dwg ? { kind: 'rgb', r: 10, g: 20, b: 30 } : { kind: 'byBlock' },
      },
    });
    edit(model, g);
    const back = saved(bytes, model, format);
    expect(back.cells[1]).toEqual(table(model).geom.cells[1]);
    expect(back).toEqual(table(model).geom);
  });

  it.each(FLAG_SAVES)("changes and removes a cell's format in %s", (_w, version, format) => {
    const bytes = drawing(version, format, { formatted: true });
    const model = open(bytes);
    const g = table(model).geom;
    expect(g.cells[1]![0]!.format).toEqual({
      alignment: 5,
      contentColor: { kind: 'aci', index: 3 },
      borders: { top: { lineweight: 50 } },
    });
    // Another alignment, the colour back to the style's, the border kept.
    edit(
      model,
      cell(
        cell(g, 1, 0, { format: { alignment: 7, borders: { top: { lineweight: 50 } } } }),
        0,
        0,
        {
          format: { textHeight: 0.4 },
        },
      ),
    );
    const once = exportDocument(readCadDocument(bytes), model, { format });
    expect(table(open(once)).geom).toEqual(table(model).geom);
    // Then nothing overridden at all.
    const again = open(once);
    const g2 = table(again).geom;
    const { format: _f, ...plain } = g2.cells[1]![0]!;
    edit(again, { ...g2, cells: g2.cells.map((r, i) => (i === 1 ? [plain, r[1]!] : r)) });
    const back = saved(once, again, format);
    expect(back.cells[1]![0]!.format).toBeUndefined();
    expect(back).toEqual(table(again).geom);
  });

  it('refuses a cell format in a DWG from R2010, which states it in cell styles', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    edit(model, cell(table(model).geom, 1, 0, { format: { alignment: 5 } }));
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dwg' }),
    );
    expect(problems.join('; ')).toMatch(/cell \(1, 0\): a cell format in a DWG from R2010/);
  });

  it('saves a true colour into an R2004 DWG cell', () => {
    const bytes = drawing(ACadVersion.AC1018, 'dwg');
    const model = open(bytes);
    edit(
      model,
      cell(table(model).geom, 1, 0, {
        format: { background: { kind: 'rgb', r: 1, g: 2, b: 3 } },
      }),
    );
    expect(saved(bytes, model, 'dwg').cells[1]![0]!.format).toEqual({
      background: { kind: 'rgb', r: 1, g: 2, b: 3 },
    });
  });

  it('refuses a true colour in a DWG cell before R2004, which holds ACI colours only', () => {
    const bytes = drawing(ACadVersion.AC1015, 'dwg');
    const model = open(bytes);
    edit(
      model,
      cell(table(model).geom, 1, 0, {
        format: { contentColor: { kind: 'rgb', r: 1, g: 2, b: 3 } },
      }),
    );
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dwg' }),
    );
    expect(problems.join('; ')).toMatch(
      /cell \(1, 0\): contentColor: a DWG table cell before R2004 holds ACI colours only/,
    );
  });
});
