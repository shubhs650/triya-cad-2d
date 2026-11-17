// M4-16 part 10: a table's break settings. A DXF states them in the table's round-trip XRECORD
// (`ACAD_ROUNDTRIP_2008_TABLE_ENTITY`) as AutoCAD writes it (DEC-071); a save writes them there
// and reads them back, and refuses them where the file cannot state them. A DWG from R2010
// states them in the table, read but not written (DEC-047). The drawing (table-drawing.ts) is a
// title, a header row and a data row in two columns; two more data rows are inserted here.
import type { XRecord } from '@node-projects/acad-ts';
import { ACadVersion, BreakData, BreakHeight, TableEntity, XYZ } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  defaultTableBreaks,
  type Entity,
  type TableBreaks,
  type TableCell,
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
import { recordBreaks } from '../src/map/table-breaks';
import { drawing } from './table-drawing';

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const table = (model: DocumentModel): Entity & { geom: TableGeometry } =>
  [...model.entities()].find((e) => e.type === 'ACAD_TABLE') as Entity & { geom: TableGeometry };

function edit(model: DocumentModel, geom: TableGeometry): void {
  const b = new ChangeSetBuilder(model);
  b.updateEntity(table(model).id, { geom });
  model.apply(b.build());
}

const mapped = (doc: ReturnType<typeof readCadDocument>): TableGeometry =>
  documentInit(doc).entities!.find((e) => e.type === 'ACAD_TABLE')!.geom as TableGeometry;

const acadTable = (doc: ReturnType<typeof readCadDocument>): TableEntity =>
  [...doc.entities!].find((e) => e instanceof TableEntity) as TableEntity;

/** The round-trip record's entries after its 102 and 360, points as [x, y]. */
const tail = (t: TableEntity): unknown[][] => {
  const x = t.xDictionary?.getEntry('ACAD_XREC_ROUNDTRIP') as XRecord;
  return x.entries
    .slice(2)
    .map((e) => [e.code, e.value instanceof XYZ ? [e.value.x, e.value.y] : e.value]);
};

const text = (t: string): TableCell => ({
  type: 'text',
  text: t,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
});

/** Two more data rows, each as high as the first, and `breaks`. */
function broken(g: TableGeometry, breaks: Partial<TableBreaks>): TableGeometry {
  const h = g.rowHeights[2]!;
  const rows: TableGeometry = {
    ...g,
    rowHeights: [...g.rowHeights, h, h],
    cells: [...g.cells, [text('N2'), text('')], [text('N3'), text('')]],
    rowOrigins: [0, 1, 2, null, null],
  };
  const labels = g.rowHeights[0]! + g.rowHeights[1]!;
  return {
    ...rows,
    breaks: {
      ...defaultTableBreaks(rows),
      enabled: true,
      height: labels + h,
      spacing: 0.5,
      ...breaks,
    },
  };
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

describe('table breaks in a DXF table’s round-trip record (M4-16 part 10)', () => {
  it('reads the break data AutoCAD writes (a broken table’s record, DEC-071)', () => {
    // AutoCAD 2007's record of a table broken into four parts, Manual positions and heights on:
    // flags 27, flow right, spacing 0.99, a break height and two parts' own places and heights,
    // four ranges, and the ACAD_TABLEs of the three parts after the first.
    const p = (x: number, y: number) => new XYZ(x, y, 0);
    const codes: [number, unknown][] = [
      [102, 'ACAD_ROUNDTRIP_2008_TABLE_ENTITY'],
      [360, null],
      [70, 1],
      [90, 27],
      [90, 1],
      [40, 0.99],
      [90, 2],
      [90, 0],
      [90, 3],
      [10, p(0, 0)],
      [40, 2.0486],
      [90, 2],
      [10, p(13.49, 6.3628)],
      [40, 1.536],
      [90, 3],
      [10, p(26.98, -6.5794)],
      [40, 1.176],
      [90, 3],
      [90, 4],
      ...[
        [0, 2, 4],
        [13.49, 5, 6],
        [26.98, 7, 7],
        [40.47, 8, 9],
      ].flatMap(([x, a, b]): [number, unknown][] => [
        [10, p(x!, 0)],
        [90, a],
        [90, b],
      ]),
      [90, 3],
      [330, null],
      [330, null],
      [330, null],
      [361, null],
    ];
    const read = recordBreaks(
      codes.map(([code, value]) => ({ code, value })),
      3.696,
    );
    expect(read).toMatchObject({ ranges: 4, continued: 3 });
    expect(read!.breaks).toEqual({
      enabled: true,
      direction: 'right',
      repeatTop: true,
      repeatBottom: false,
      manualPositions: true,
      manualHeights: true,
      height: 2.0486,
      spacing: 0.99,
      parts: [
        null,
        { offset: { x: 13.49, y: 6.3628 }, height: 1.536 },
        { offset: { x: 26.98, y: -6.5794 }, height: 1.176 },
      ],
    });
    // A record without break data: the one range of every corpus table.
    const plain = recordBreaks(
      [
        { code: 102, value: 'ACAD_ROUNDTRIP_2008_TABLE_ENTITY' },
        { code: 360, value: null },
        { code: 70, value: 2 },
        { code: 90, value: 1 },
        { code: 10, value: p(0, 0) },
        { code: 90, value: 0 },
        { code: 90, value: 6 },
        { code: 361, value: null },
      ],
      1,
    );
    expect(plain).toMatchObject({ breaks: undefined, ranges: 1, onlyRange: [0, 6], continued: 0 });
  });

  it.each([
    ['R2018 DXF', ACadVersion.AC1032],
    ['R2007 DXF', ACadVersion.AC1021],
  ] as const)('saves a table broken into parts to %s and reads it back', (_w, version) => {
    const bytes = drawing(version, 'dxf');
    const model = open(bytes);
    const g = broken(table(model).geom, { repeatTop: true });
    edit(model, g);
    const saved = exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
    const doc = readCadDocument(saved);
    expect(mapped(doc).breaks).toEqual(g.breaks);
    // AutoCAD's layout: break data, the labels two parts repeat, one break height, three ranges
    // (the data rows of each part, laid out to the right), no ACAD_TABLEs for the other parts.
    const w = g.columnWidths.reduce((s, x) => s + x, 0) + 0.5;
    expect(tail(acadTable(doc))).toEqual([
      [70, 1],
      [90, 3],
      [90, 1],
      [40, 0.5],
      [90, 2],
      [90, 0],
      [90, 1],
      [10, [0, 0]],
      [40, g.breaks!.height],
      [90, 2],
      [90, 3],
      [10, [0, 0]],
      [90, 2],
      [90, 2],
      [10, [w, 0]],
      [90, 3],
      [90, 3],
      [10, [2 * w, 0]],
      [90, 4],
      [90, 4],
      [90, 0],
    ]);

    // Opened from that save: down, a part's own height and place; then breaks off.
    const reopened = open(saved);
    const t = table(reopened).geom;
    const parts = [null, { height: 5, offset: { x: 1, y: -9 } }];
    const down: TableBreaks = {
      ...t.breaks!,
      direction: 'down',
      manualHeights: true,
      manualPositions: true,
      parts,
    };
    edit(reopened, { ...t, breaks: down });
    const again = exportDocument(readCadDocument(saved), reopened, { format: 'dxf' });
    expect(mapped(readCadDocument(again)).breaks).toEqual(down);
    const off = open(again);
    edit(off, { ...table(off).geom, breaks: { ...down, enabled: false } });
    const plain = readCadDocument(exportDocument(readCadDocument(again), off, { format: 'dxf' }));
    expect(mapped(plain).breaks?.enabled).toBe(false);
    expect(tail(acadTable(plain)).slice(0, 2)).toEqual([
      [70, 1],
      [90, 2 + 8 + 16],
    ]);
  });

  it('reads a DWG table’s break data (R2010 on)', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const doc = readCadDocument(bytes);
    const t = acadTable(doc);
    t.hasBreakData = true;
    const data = new BreakData();
    data.flags = 1 | 4;
    data.flowDirection = 4;
    data.breakSpacing = 0.25;
    const h = new BreakHeight();
    h.height = 1.5;
    data.heights.push(h);
    t.tableBreakData = data;
    expect(mapped(doc).breaks).toEqual({
      enabled: true,
      direction: 'left',
      repeatTop: false,
      repeatBottom: true,
      manualPositions: false,
      manualHeights: false,
      height: 1.5,
      spacing: 0.25,
    });
  });

  it.each([
    ['R2004 DXF', ACadVersion.AC1018, 'dxf', /cannot state/],
    ['R2018 DWG', ACadVersion.AC1032, 'dwg', /DXF only/],
  ] as const)('refuses them in %s', (_w, version, format: CadFormat, why) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    edit(model, broken(table(model).geom, {}));
    const problems = refusal(() => exportDocument(readCadDocument(bytes), model, { format }));
    expect(problems.join('\n')).toMatch(/table breaks/);
    expect(problems.join('\n')).toMatch(why);
  });
});
