// AcadToTriya for ACAD_TABLE (M1-04 part 3d) on drawings authored in memory with acad-ts:
// rows, columns and cells, merged ranges stated either way (DXF per cell, DWG as ranges), and
// the −Z plan view. The corpus comparison is in packages/testkit/src/mapping/entities.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  CellContent,
  CellRange,
  TableEntity,
  TableEntityCell,
  TableEntityColumn,
  TableEntityRow,
  XYZ,
} from '@node-projects/acad-ts';
import type { TableGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function cell(text: unknown, formatted = ''): TableEntityCell {
  const c = new TableEntityCell();
  const k = new CellContent();
  k.cadValue.value = text;
  k.cadValue.formattedValue = formatted;
  c.contents.push(k);
  return c;
}

/** A 2 × 2 table with a title row whose two cells are merged. */
function table(doc: CadDocument): { t: TableEntity; block: BlockRecord } {
  const block = new BlockRecord('*T1');
  doc.blockRecords?.add(block);
  const t = new TableEntity();
  t.block = block;
  t.insertPoint = new XYZ(10, 20, 0);
  t.horizontalDirection = new XYZ(1, 0, 0);
  for (const w of [30, 40]) {
    const c = new TableEntityColumn();
    c.width = w;
    t.columns.push(c);
  }
  const title = new TableEntityRow();
  title.height = 8;
  title.cells.push(cell('PARTS LIST'), cell(''));
  const body = new TableEntityRow();
  body.height = 6;
  body.cells.push(cell(null, '12.50'), cell('{\\C1;BOLT}'));
  t.rows.push(title, body);
  doc.entities?.add(t);
  return { t, block };
}

function mapOne(doc: CadDocument, t: TableEntity): TableGeometry {
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  const g = entities.find((e) => e.handle === H(t))!.geom;
  if (g.kind !== 'ACAD_TABLE') throw new Error(g.kind);
  return g;
}

const plain = { rowSpan: 1, columnSpan: 1, merged: false, rotation: 0, type: 'text' as const };

describe('ACAD_TABLE', () => {
  it('maps the grid, the *T block and each cell, merges stated per cell as DXF does', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const { t, block } = table(doc);
    t.rows[0]!.cells[0]!.borderWidth = 2; // DXF 175: spans two columns
    t.rows[0]!.cells[0]!.borderHeight = 1;
    t.rows[0]!.cells[1]!.mergedValue = 1; // DXF 173
    t.rows[1]!.cells[1]!.rotation = Math.PI / 2;

    expect(mapOne(doc, t)).toEqual({
      kind: 'ACAD_TABLE',
      block: H(block),
      position: { x: 10, y: 20 },
      direction: { x: 1, y: 0 },
      rowHeights: [8, 6],
      columnWidths: [30, 40],
      cells: [
        [
          { ...plain, text: 'PARTS LIST', columnSpan: 2 },
          { ...plain, text: '', merged: true },
        ],
        [
          { ...plain, text: '12.50' },
          { ...plain, text: '{\\C1;BOLT}', rotation: Math.PI / 2 },
        ],
      ],
    });
  });

  it('derives spans from merged ranges, as DWG states them', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const { t } = table(doc);
    const r = new CellRange();
    r.topRowIndex = 0;
    r.bottomRowIndex = 0;
    r.leftColumnIndex = 0;
    r.rightColumnIndex = 1;
    t.mergedCellRanges.push(r);
    const g = mapOne(doc, t);

    expect(g.cells[0]).toEqual([
      { ...plain, text: 'PARTS LIST', columnSpan: 2 },
      { ...plain, text: '', merged: true },
    ]);
    expect(g.cells[1]!.every((c) => !c.merged && c.columnSpan === 1)).toBe(true);
  });

  it('maps a block cell', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const { t } = table(doc);
    const sym = new BlockRecord('SYMBOL');
    doc.blockRecords?.add(sym);
    const c = t.rows[1]!.cells[1]!;
    c.type = 2 as never;
    c.contents[0]!.blockRecord = sym;
    c.contents[0]!.cadValue.value = null;

    expect(mapOne(doc, t).cells[1]![1]).toEqual({
      ...plain,
      type: 'block',
      text: '',
      block: H(sym),
    });
  });

  it('mirrors a −Z table’s OCS insertion point and keeps its WCS direction', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const { t } = table(doc);
    t.normal = new XYZ(0, 0, -1);
    t.insertPoint = new XYZ(10, 20, 3);
    t.horizontalDirection = new XYZ(-1, 0, 0);

    expect(mapOne(doc, t)).toMatchObject({
      position: { x: -10, y: 20 },
      direction: { x: -1, y: 0 },
      elevation: -3,
      normal: { x: 0, y: 0, z: -1 },
    });
  });
});
