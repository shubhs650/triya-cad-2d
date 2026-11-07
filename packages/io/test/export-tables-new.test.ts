// TriyaToAcad for a new ACAD_TABLE (M1-75 part 32): what the TABLE command and COPY add, a table
// with an anonymous `*T` block of its own that the same save adds. Every format a table can be
// saved to takes the grid, cell text and blocks, merges and cell rotation; DXF and DWG before
// R2010 also take cell formats (the cell override flag word) and the table-wide overrides (DXF 93
// and the values after it); a DWG from R2010 takes cell formats in each cell's cell style (part 36). The drawing is authored in memory with acad-ts and saved once
// (table-drawing.ts); the corpus-wide copies are in export-tables-new.corpus.test.ts in testkit.
import type { TableEntity } from '@node-projects/acad-ts';
import {
  ACadVersion,
  CadDocument,
  CellType,
  type CadDocument as Doc,
} from '@node-projects/acad-ts';
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
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';
import { drawing } from './table-drawing';

type Table = Entity & { geom: TableGeometry };

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const tables = (model: DocumentModel): Table[] =>
  [...model.entities()].filter((e) => e.type === 'ACAD_TABLE') as Table[];

const blockNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.blockRecords.values()].find((b) => b.name === name)!.handle;

const styleNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.tableStyles.values()].find((s) => s.name.toUpperCase() === name)!.handle;

const textStyleNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.textStyles.values()].find((s) => s.name.toUpperCase() === name)!.handle;

const text = (t: string, more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text: t,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

/**
 * A 3 × 3 table as the TABLE command leaves it after typing: a title merged over the three
 * columns, a header row and a data row with block MARK in its last cell. `formats` adds cell
 * formats, a rotation and table-wide overrides; a DWG from R2010 does not take the last two yet.
 */
function newTable(model: DocumentModel, block: string, formats: boolean): TableGeometry {
  const standard = textStyleNamed(model, 'STANDARD');
  return {
    kind: 'ACAD_TABLE',
    style: styleNamed(model, 'STANDARD'),
    block,
    position: { x: 40, y: 15 },
    direction: { x: 1, y: 0 },
    rowHeights: [0.9, 0.6, 0.6],
    columnWidths: [2.5, 3, 1.5],
    cells: [
      [
        text('Pipe schedule', { columnSpan: 3 }),
        text('', { merged: true }),
        text('', { merged: true }),
      ],
      [text('Line'), text('Size'), text('Mark')],
      [
        text('L-101', formats ? { rotation: Math.PI / 2 } : {}),
        text(
          '{\\fArial|b1;DN 50}',
          formats
            ? {
                format: {
                  alignment: 5,
                  textStyle: standard,
                  textHeight: 0.2,
                  contentColor: { kind: 'aci', index: 1 },
                  background: { kind: 'aci', index: 4 },
                  borders: { top: { color: { kind: 'aci', index: 2 }, lineweight: 50 } },
                },
              }
            : {},
        ),
        { ...text(''), type: 'block', block: blockNamed(model, 'MARK') },
      ],
    ],
    ...(formats
      ? {
          overrides: {
            margins: { left: 0.1, top: 0.05, right: 0.1, bottom: 0.05 },
            title: { textHeight: 0.35, background: { kind: 'aci', index: 4 } },
            header: { textStyle: standard, contentColor: { kind: 'aci', index: 1 } },
            data: { alignment: 5, textHeight: 0.18, background: null },
          },
        }
      : {}),
  };
}

/** Adds a `*T` block (with one line) and a table on it to model space; returns the table. */
function addTable(
  model: DocumentModel,
  geom: (block: string) => TableGeometry,
  blockName = '*T2',
): Table {
  const b = new ChangeSetBuilder(model);
  const owner = blockNamed(model, '*Model_Space');
  const layer = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
  const block = b.addBlock({ name: blockName, basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
  b.addEntity({
    owner: block,
    layer,
    geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 7, y: -2.1 } },
  });
  const t = b.addEntity({ owner, layer, geom: geom(block) });
  model.apply(b.build());
  return model.entity(t.id) as Table;
}

/** Saves `model` over a fresh read of `bytes`. */
const save = (bytes: Uint8Array, model: DocumentModel, format: CadFormat): Uint8Array =>
  exportDocument(readCadDocument(bytes), model, { format });

/** The saved drawing's table under `handle`, mapped back. */
function savedTable(bytes: Uint8Array, model: DocumentModel, format: CadFormat, handle: string) {
  const init = documentInit(readCadDocument(save(bytes, model, format)));
  return init.entities!.find((e) => e.handle === handle)?.geom as TableGeometry | undefined;
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

const SAVES: [string, ACadVersion, CadFormat][] = [
  ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
  ['R2010 DXF', ACadVersion.AC1024, 'dxf'],
  ['R2007 DXF', ACadVersion.AC1021, 'dxf'],
  ['R2004 DXF', ACadVersion.AC1018, 'dxf'],
  ['R2000 DXF', ACadVersion.AC1015, 'dxf'],
  ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
  ['R2007 DWG', ACadVersion.AC1021, 'dwg'],
  ['R2004 DWG', ACadVersion.AC1018, 'dwg'],
  ['R2000 DWG', ACadVersion.AC1015, 'dwg'],
];

/** A DWG from R2010 keeps cell rotations and table-wide overrides in cell styles (not written yet). */
const dwgFrom2010 = (version: ACadVersion, format: CadFormat) =>
  format === 'dwg' && version >= ACadVersion.AC1024;

describe('new ACAD_TABLE', () => {
  it.each(SAVES)('saves a table the TABLE command adds to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const before = tables(model)[0]!.geom;
    const formats = !dwgFrom2010(version, format);
    const t = addTable(model, (block) => newTable(model, block, formats));
    const back = savedTable(bytes, model, format, t.handle);
    expect(back).toEqual(t.geom);
    // The drawing's own table is left as it was.
    const init = documentInit(readCadDocument(save(bytes, model, format)));
    const others = init.entities!.filter((e) => e.type === 'ACAD_TABLE' && e.handle !== t.handle);
    expect(others.map((e) => e.geom)).toEqual([before]);
  });

  it.each(SAVES)('saves a copy of a table (COPY) to %s', (_w, version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const source = tables(model)[0]!.geom;
    const t = addTable(model, (block) => ({ ...source, block, position: { x: 0, y: -12 } }));
    expect(savedTable(bytes, model, format, t.handle)).toEqual(t.geom);
  });

  it('writes the value flag AutoCAD writes and a block scale of 1 in a block cell', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dxf');
    const model = open(bytes);
    const t = addTable(model, (block) => newTable(model, block, false));
    const doc = readCadDocument(save(bytes, model, 'dxf'));
    const acad = doc.getCadObject(Number.parseInt(t.handle, 16)) as TableEntity;
    expect(acad.valueFlag).toBe(22);
    const cell = acad.rows[2]!.cells[2]!;
    expect(cell.type).toBe(CellType.Block);
    expect(cell.blockScale).toBe(1);
  });

  it('gives each row of a new table in an R2018 DWG its row cell style: title, header, data', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    const t = addTable(model, (block) => ({
      ...newTable(model, block, false),
      rowHeights: [0.9, 0.6, 0.6, 0.6],
      cells: [...newTable(model, block, false).cells, [text('L-102'), text('DN 80'), text('')]],
    }));
    const doc: Doc = readCadDocument(save(bytes, model, 'dwg'));
    const acad = doc.getCadObject(Number.parseInt(t.handle, 16)) as TableEntity;
    const ids = new Map(acad.style!.cellStyles.map((s) => [s.name.toUpperCase(), s.id]));
    expect(acad.rows.map((r) => r.styleId)).toEqual(
      ['_TITLE', '_HEADER', '_DATA', '_DATA'].map((n) => ids.get(n)),
    );
  });

  const refused: [string, (g: TableGeometry, m: DocumentModel) => TableGeometry, RegExp][] = [
    ['no table style', ({ style: _s, ...g }) => g, /without its table style/],
    [
      'a table style that does not exist',
      (g) => ({ ...g, style: 'FFFF' }),
      /table style FFFF does not exist/,
    ],
    ['no block', ({ block: _b, ...g }) => g, /without its block/],
    [
      'a named block',
      (g, m) => ({ ...g, block: blockNamed(m, 'MARK') }),
      /block \w+ is not an anonymous \*T block/,
    ],
    [
      "another table's block",
      (g, m) => ({ ...g, block: blockNamed(m, '*T1') }),
      /block \w+ is already the block of ACAD_TABLE \w+/,
    ],
    ['no rows', (g) => ({ ...g, rowHeights: [], cells: [] }), /no rows or no columns/],
    [
      'a row short of a cell',
      (g) => ({ ...g, cells: [g.cells[0]!, g.cells[1]!.slice(0, 2), g.cells[2]!] }),
      /not rows × columns/,
    ],
    ['a height missing', (g) => ({ ...g, rowHeights: [0.9, 0.6] }), /not rows × columns/],
    ['a row height of 0', (g) => ({ ...g, rowHeights: [0.9, 0, 0.6] }), /row height of 0 or less/],
    [
      'a merge running off the table',
      (g) => ({
        ...g,
        cells: g.cells.map((r, i) =>
          i === 2 ? r.map((c, j) => (j === 2 ? { ...c, rowSpan: 2 } : c)) : r,
        ),
      }),
      /cell \(2, 2\): its merge runs off the table/,
    ],
    [
      'text in a block cell',
      (g) => ({
        ...g,
        cells: g.cells.map((r, i) =>
          i === 2 ? r.map((c, j) => (j === 2 ? { ...c, text: 'x' } : c)) : r,
        ),
      }),
      /cell \(2, 2\): text in a block cell/,
    ],
    [
      'an alignment AutoCAD does not have',
      (g) => ({ ...g, overrides: { data: { alignment: 10 } } }),
      /data rows: alignment 10 is not 1 to 9/,
    ],
    [
      'a text height of 0',
      (g) => ({ ...g, overrides: { title: { textHeight: 0 } } }),
      /title rows: textHeight 0 is not a number more than 0/,
    ],
    [
      'an override text style that does not exist',
      (g) => ({ ...g, overrides: { header: { textStyle: 'FFFF' } } }),
      /header rows: text style FFFF does not exist/,
    ],
    [
      'margins that differ left and right',
      (g) => ({ ...g, overrides: { margins: { left: 0.1, right: 0.2 } } }),
      /table margins: left and right differ/,
    ],
    [
      'a negative margin',
      (g) => ({ ...g, overrides: { margins: { top: -1, bottom: -1 } } }),
      /table margins: top -1 is not a number of 0 or more/,
    ],
    [
      'a true colour in a DXF override',
      (g) => ({ ...g, overrides: { data: { contentColor: { kind: 'rgb', r: 1, g: 2, b: 3 } } } }),
      /data rows: contentColor: a DXF table holds ACI colours only/,
    ],
    [
      'a true colour in a DXF cell',
      (g) => ({
        ...g,
        cells: g.cells.map((r, i) =>
          i === 1
            ? r.map((c, j) =>
                j === 0 ? { ...c, format: { background: { kind: 'rgb', r: 1, g: 2, b: 3 } } } : c,
              )
            : r,
        ),
      }),
      /cell \(1, 0\): background: a DXF table cell holds ACI colours only/,
    ],
  ];
  it.each(refused)('refuses a new table with %s', (_what, change, message) => {
    const bytes = drawing();
    const model = open(bytes);
    addTable(model, (block) => change(newTable(model, block, false), model));
    const problems = refusal(() => save(bytes, model, 'dxf'));
    expect(problems.join('; ')).toMatch(message);
  });

  it("saves the cell formats of a new table to an R2018 DWG in its cells' cell styles", () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    const t = addTable(model, (block) => {
      const { overrides: _o, ...g } = newTable(model, block, true);
      return { ...g, cells: g.cells.map((r) => r.map((c) => ({ ...c, rotation: 0 }))) };
    });
    expect(savedTable(bytes, model, 'dwg', t.handle)).toEqual(t.geom);
  });

  it('refuses rotations and overrides in a new table in an R2018 DWG', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    addTable(model, (block) => newTable(model, block, true));
    const problems = refusal(() => save(bytes, model, 'dwg')).join('; ');
    expect(problems).not.toMatch(/cell format/);
    expect(problems).toMatch(/cell \(2, 0\): a cell rotation in a DWG from R2010/);
    expect(problems).toMatch(/table overrides in a DWG from R2010, which states them in cell/);
  });

  it('refuses a true colour override in a DWG before R2004, which holds ACI colours only', () => {
    const bytes = drawing(ACadVersion.AC1015, 'dwg');
    const model = open(bytes);
    addTable(model, (block) => ({
      ...newTable(model, block, false),
      overrides: { title: { background: { kind: 'rgb', r: 1, g: 2, b: 3 } } },
    }));
    expect(refusal(() => save(bytes, model, 'dwg')).join('; ')).toMatch(
      /title rows: background: a DWG table before R2004 holds ACI colours only/,
    );
  });

  it('refuses a table in an R12 drawing, which has none', () => {
    const doc = new CadDocument(ACadVersion.AC1009);
    const bytes = writeCadDocument(doc, { format: 'dxf' });
    const model = open(bytes);
    const b = new ChangeSetBuilder(model);
    const owner = blockNamed(model, '*Model_Space');
    const layer = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
    const block = b.addBlock({ name: '*T1', basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
    b.addEntity({
      owner,
      layer,
      geom: {
        kind: 'ACAD_TABLE',
        block,
        position: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        rowHeights: [1],
        columnWidths: [1],
        cells: [[text('x')]],
      },
    });
    model.apply(b.build());
    expect(refusal(() => save(bytes, model, 'dxf')).join('; ')).toMatch(/AC1009 holds no tables/);
  });
});
