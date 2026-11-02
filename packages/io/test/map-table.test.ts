// AcadToTriya for ACAD_TABLE (M1-04 part 3d) on drawings authored in memory with acad-ts:
// rows, columns and cells, merged ranges stated either way (DXF per cell, DWG as ranges), and
// the −Z plan view, and the cell formats of M1-36 (a DXF / R2004 flag word, or R2010 cell,
// row, column and content formats). The corpus comparison is in packages/testkit/src/mapping/entities.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  CellContent,
  CellRange,
  Color,
  TableEntity,
  TableEntityCell,
  TableEntityColumn,
  TableEntityRow,
  TextStyle,
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

  describe('cell formats (M1-36)', () => {
    it('reads a DXF / R2004 flag word: only the flagged values, 283 = 1 as no fill', () => {
      const doc = new CadDocument(ACadVersion.AC1018);
      const { t } = table(doc);
      const style = new TextStyle('NOTES');
      doc.textStyles?.add(style);
      const c = t.rows[1]!.cells[0]!;
      const s = c.styleOverride;
      s.cellAlignment = 5;
      s.backgroundColor = new Color(165);
      s.contentColor = new Color(7);
      s.textStyle = style;
      s.textHeight = 4;
      s.topBorder.color = new Color(63);
      s.topBorder.lineWeight = 40 as never;
      s.leftBorder.isInvisible = true;
      s.rightBorder.color = new Color(1); // not flagged: ignored
      // alignment, background colour, content colour, text style, text height, top colour and
      // lineweight, left visibility
      c.overrideFlags = (0x01 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40 | 0x400 | 0x20000) as never;

      const fill = t.rows[1]!.cells[1]!;
      fill.styleOverride.backgroundColor = new Color(3);
      fill.styleOverride.isFillColorOn = true; // DXF 283 = 1: background fill none
      fill.overrideFlags = (0x02 | 0x04) as never;

      const g = mapOne(doc, t);
      expect(g.cells[1]![0]!.format).toEqual({
        alignment: 5,
        background: { kind: 'aci', index: 165 },
        contentColor: { kind: 'aci', index: 7 },
        textStyle: H(style),
        textHeight: 4,
        borders: {
          top: { color: { kind: 'aci', index: 63 }, lineweight: 40 },
          left: { hidden: true },
        },
      });
      expect(g.cells[1]![1]!.format).toEqual({ background: null });
      expect(g.cells[0]![0]!.format).toBeUndefined();
    });

    it('keeps a visibility override only when it hides the edge', () => {
      const doc = new CadDocument(ACadVersion.AC1018);
      const { t } = table(doc);
      const c = t.rows[0]!.cells[0]!;
      c.styleOverride.topBorder.isInvisible = false;
      c.overrideFlags = 0x4000 as never; // top visibility, shown
      expect(mapOne(doc, t).cells[0]![0]!.format).toBeUndefined();
    });

    it('folds R2010 column, row, cell and content formats, the nearer one winning', () => {
      const doc = new CadDocument(ACadVersion.AC1032);
      const { t } = table(doc);
      const column = t.columns[1]!.cellStyleOverride;
      column.hasData = true;
      column.cellPropertyOverrideFlags = 0x80 | 0x20; // text height, content colour
      column.textHeight = 1;
      column.color = new Color(2);
      const row = t.rows[1]!.cellStyleOverride;
      row.hasData = true;
      row.cellPropertyOverrideFlags = 0x80; // text height
      row.textHeight = 2;
      const c = t.rows[1]!.cells[1]!;
      const s = c.styleOverride;
      s.hasData = true;
      s.cellPropertyOverrideFlags = 0x10 | 0x200; // alignment, background
      s.propertyOverrideFlags = 0x80 as never; // the cell style's content format: not an override
      s.alignment = 8;
      s.textHeight = 9;
      s.backgroundColor = new Color(140);
      s.rightBorder.propertyOverrideFlags = (0x08 | 0x02 | 0x10) as never;
      s.rightBorder.color = new Color(63);
      s.rightBorder.lineWeight = 50 as never;
      s.rightBorder.isInvisible = true;
      s.topBorder.propertyOverrideFlags = 0x25 as never; // type, linetype, spacing: not mapped
      const k = c.contents[0]!.format;
      k.hasData = true;
      k.propertyOverrideFlags = 0x80 as never;
      k.textHeight = 3;

      const g = mapOne(doc, t);
      expect(g.cells[1]![1]!.format).toEqual({
        alignment: 8,
        contentColor: { kind: 'aci', index: 2 },
        textHeight: 3,
        background: { kind: 'aci', index: 140 },
        borders: { right: { color: { kind: 'aci', index: 63 }, lineweight: 50, hidden: true } },
      });
      expect(g.cells[1]![0]!.format).toEqual({ textHeight: 2 });
      expect(g.cells[0]![1]!.format).toEqual({
        textHeight: 1,
        contentColor: { kind: 'aci', index: 2 },
      });
    });

    it('drops R2010 cell margins equal to the table’s and reads a None background as no fill', () => {
      const doc = new CadDocument(ACadVersion.AC1032);
      const { t } = table(doc);
      const margins = (s: TableEntityCell['styleOverride'], [l, t, r, b]: number[]) => {
        s.hasData = true;
        s.marginOverrideFlags = 1 as never;
        s.horizontalMargin = l!;
        s.verticalMargin = t!;
        s.rightMargin = r!;
        s.bottomMargin = b!;
      };
      const all = 0x400 | 0x800 | 0x1000 | 0x2000;
      margins(t.cellStyleOverride, [0.5, 0.5, 0.5, 0.5]);
      t.cellStyleOverride.cellPropertyOverrideFlags = all;
      const c = t.rows[0]!.cells[0]!.styleOverride;
      margins(c, [0.5, 0.25, 0.5, 1]);
      c.cellPropertyOverrideFlags = all | 0x200;
      c.backgroundColor = new Color(257); // CMC method None (0xC8), as acad-ts reads it (0120)
      const black = t.rows[0]!.cells[1]!.styleOverride;
      black.hasData = true;
      black.cellPropertyOverrideFlags = 0x200;
      black.backgroundColor = Color.fromTrueColor(0); // a real black fill (M1-76)

      const cells = mapOne(doc, t).cells[0]!;
      expect(cells[0]!.format).toEqual({
        background: null,
        margins: { top: 0.25, bottom: 1 },
      });
      expect(cells[1]!.format).toEqual({ background: { kind: 'rgb', r: 0, g: 0, b: 0 } });
    });
  });
});
