// M4-30: a DXF table's AutoCAD 2008 data (the TABLECONTENT its ACAD_ROUNDTRIP_2008_TABLE_ENTITY
// XRECORD names, M4-28) read on open and written again from the edited table.
//
// Read: every table of a corpus DXF from R2007 maps from its TABLECONTENT (as an R2010+ DWG's
// table maps from its content) to what the model holds from the legacy ACAD_TABLE codes: the
// same grid, row heights, column widths, merges, cell formats and table-wide overrides, and the
// same text where the cell holds one text. What the model does not state (each row's, column's
// and cell's cell style, locks, custom data, border linetypes) stays in the content.
//
// Write: acadsharp's AC1032 table A35, edited (a cell typed in, a row inserted, a cell filled),
// saves a TABLECONTENT that holds the edit: the rows on their cell styles (the new row on its
// neighbour's), the typed text, the fill, the stale cell checksums of what changed left out, the
// break range over every row, and no cached content extents (TABLEGEOMETRY) for a grid they no
// longer describe. An edit the content cannot state the way the legacy codes do (a cell the
// content holds two blocks and a text in, which the legacy codes state as one block) drops the
// round-trip record, so AutoCAD reads the table from the legacy codes. An unedited table keeps
// its record as read.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  documentInit,
  readCadDocument,
  readTableContent,
  roundTripTableContent,
  tableEntityGeometry,
  type RawCode,
} from '@triya/io';
import type { XRecord } from '@node-projects/acad-ts';
import { TableEntity, type CadDocument, type CadObject } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  withCellText,
  withCellsFormatted,
  withRowsInserted,
  type Entity,
  type TableCell,
  type TableGeometry,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/third-party/', import.meta.url));
const FILES = [
  ...['AC1021', 'AC1024', 'AC1027', 'AC1032'].flatMap((v) => [
    `acadsharp/sample_${v}_ascii.dxf`,
    `acadsharp/sample_${v}_binary.dxf`,
  ]),
  'ezdxf/examples_dxf/acad_table_simple.dxf',
  'ezdxf/examples_dxf/acad_table_with_blk_ref.dxf',
];
const A35_FILE = 'acadsharp/sample_AC1032_ascii.dxf';
const CHECKSUM = 'ACAD_ROUNDTRIP_2008_CELL_CHECKSUM';

type Table = Entity & { geom: TableGeometry };
type Raw = CadObject & { rawDxfCodes: RawCode[] | null };

const bytesOf = (file: string) => new Uint8Array(readFileSync(`${corpusDir}${file}`));
const read = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

function tables(doc: CadDocument): TableEntity[] {
  const out: TableEntity[] = [];
  for (const o of (doc as unknown as { _cadObjects: Map<number, CadObject> })._cadObjects.values())
    if (o instanceof TableEntity) out.push(o);
  return out;
}

/** What a cell maps as that both mappings state alike. */
const kept = ({ text: _t, value: _v, valueFormat: _f, ...c }: TableCell) => c;

describe("a DXF table's TABLECONTENT read on open (M4-30)", () => {
  for (const file of FILES) {
    it(file, () => {
      const doc = readCadDocument(bytesOf(file));
      const found = tables(doc);
      expect(found.length).toBeGreaterThan(0);
      for (const t of found) {
        const at = `${file} ${t.handle.toString(16)}`;
        const rt = roundTripTableContent(t, (h) => doc.getCadObject(h));
        expect(rt, at).toBeDefined();
        expect(rt!.content, at).not.toBeNull();
        const legacy = tableEntityGeometry(t) as TableGeometry;
        const fromContent = tableEntityGeometry(t, rt!.content!) as TableGeometry;
        expect(fromContent.rowHeights, at).toEqual(legacy.rowHeights);
        expect(fromContent.columnWidths, at).toEqual(legacy.columnWidths);
        expect(fromContent.overrides, at).toEqual(legacy.overrides);
        expect(fromContent.style, at).toEqual(legacy.style);
        const content = rt!.content!;
        legacy.cells.forEach((row, i) =>
          row.forEach((c, j) => {
            const k = content.rows[i]!.cells[j]!;
            // acadsharp's A35 (1, 4) holds two blocks and a text, which the legacy codes state
            // as one block; the model keeps to the legacy codes.
            if (k.contents.length > 1) return;
            const d = fromContent.cells[i]![j]!;
            expect(kept(d), `${at} (${i}, ${j})`).toEqual(kept(c));
            if (k.contents[0]?.cadValue.valueType === 4) expect(d.text).toBe(c.text);
          }),
        );
        // The row cell styles the model does not state yet: title, header, data.
        expect(content.rows.map((r) => r.styleId).slice(0, 2), at).toEqual([1, 2]);
      }
    });
  }
});

/** The A35 round-trip record, its TABLECONTENT read, in a drawing read back. */
function a35Record(doc: CadDocument) {
  const t = doc.getCadObject(0xa35) as TableEntity;
  const x = t.xDictionary?.getEntry('ACAD_XREC_ROUNDTRIP') as XRecord | undefined;
  if (!x) return undefined;
  const object = x.entries.find((e) => e.code === 360)!.value as Raw;
  const { content } = readTableContent(object.rawDxfCodes!, (h) => doc.getCadObject(h));
  return { t, x, object, content };
}

describe("an edited table's TABLECONTENT written back (M4-30)", () => {
  const bytes = bytesOf(A35_FILE);

  it('keeps the record of a table nothing edited as read', () => {
    const model = read(bytes);
    const before = a35Record(readCadDocument(bytes))!;
    const back = a35Record(
      readCadDocument(withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model))),
    )!;
    expect(back.object.rawDxfCodes).toEqual(before.object.rawDxfCodes);
    expect(back.x.entries.map((e) => e.code)).toEqual(before.x.entries.map((e) => e.code));
  });

  it('writes the edit into the TABLECONTENT', () => {
    const model = read(bytes);
    const table = model.entityByHandle('A35') as Table;
    const was = a35Record(readCadDocument(bytes))!;
    const rows = table.geom.rowHeights.length;
    // Row 2's first cell typed in, a data row inserted after it, and row 3's first cell filled.
    let g = withCellText(table.geom, 2, 0, 'Edited');
    g = withRowsInserted(g, 3, 1, 2);
    g = withCellText(g, 3, 1, 'New');
    g = withCellsFormatted(
      g,
      { r0: 4, c0: 0, r1: 4, c1: 0 },
      { background: { kind: 'aci', index: 3 } },
    );
    const b = new ChangeSetBuilder(model);
    b.updateEntity(table.id, { geom: g });
    model.apply(b.build());
    const edited = (model.entity(table.id) as Table).geom;

    const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    const doc = readCadDocument(saved);
    const back = a35Record(doc)!;
    expect(back).toBeDefined();
    // The same objects, rewritten.
    expect(back.object.handle).toBe(was.object.handle);
    expect(back.x.handle).toBe(was.x.handle);
    const c = back.content;
    expect(c.rows).toHaveLength(rows + 1);
    expect(c.rows.map((r) => r.styleId)).toEqual([1, 2, 3, 3, 3]);
    expect(c.rows.map((r) => r.height)).toEqual(edited.rowHeights);
    expect(c.columns.map((col) => col.width)).toEqual(edited.columnWidths);
    const text = (i: number, j: number) => c.rows[i]!.cells[j]!.contents[0]?.cadValue.value;
    expect(text(2, 0)).toBe('Edited');
    expect(text(3, 1)).toBe('New');
    // The row as read after the new one is that row still.
    expect(text(4, 0)).toBe(was.content.rows[3]!.cells[0]!.contents[0]!.cadValue.value);
    // Each cell's stale checksum is left out where the cell changed, kept where it did not.
    const sums = (i: number, j: number) =>
      c.rows[i]!.cells[j]!.customDataCollection.filter((d) => d.name === CHECKSUM).length;
    const hadSum = (i: number, j: number) =>
      was.content.rows[i]!.cells[j]!.customDataCollection.some((d) => d.name === CHECKSUM);
    expect(hadSum(2, 0) && hadSum(3, 0) && hadSum(0, 0)).toBe(true);
    expect(sums(2, 0)).toBe(0);
    expect(sums(4, 0)).toBe(0);
    expect(sums(3, 0)).toBe(0);
    expect(sums(0, 0)).toBe(1);
    // The fill is stated in the cell's own cell style, as an R2010+ DWG states a cell's format.
    const back4 = (read(saved).entityByHandle('A35') as Table).geom;
    expect(back4).toEqual(edited.rowOrigins ? { ...edited, rowOrigins: undefined } : edited);
    const fromContent = tableEntityGeometry(back.t, c) as TableGeometry;
    expect(fromContent.cells[4]![0]!.format?.background).toEqual({ kind: 'aci', index: 3 });
    // The break range covers every row; no cached extents for the grid as it was.
    const codes = back.x.entries.map((e) => e.code);
    expect(codes.slice(0, 7)).toEqual([102, 360, 70, 90, 10, 90, 90]);
    expect(back.x.entries[6]!.value).toBe(rows);
    expect(codes).not.toContain(361);
    expect(c.rows.flatMap((r) => r.cells).every((k) => k.geometryCollection.length === 0)).toBe(
      true,
    );
    expect(
      [...(doc as unknown as { _cadObjects: Map<number, CadObject> })._cadObjects.values()]
        .filter((o) => o.objectName === 'TABLEGEOMETRY')
        .map((o) => o.handle),
    ).not.toContain(was.x.entries.find((e) => e.code === 361)!.value);
  });

  it('drops the record when the content cannot state the edit', () => {
    const model = read(bytes);
    const table = model.entityByHandle('A35') as Table;
    // (1, 4): one block by the legacy codes, two blocks and a text in the content.
    expect(table.geom.cells[1]![4]!.type).toBe('block');
    const b = new ChangeSetBuilder(model);
    b.updateEntity(table.id, { geom: withCellText(table.geom, 1, 4, 'Typed') });
    model.apply(b.build());
    const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    expect(a35Record(readCadDocument(saved))).toBeUndefined();
    expect((read(saved).entityByHandle('A35') as Table).geom.cells[1]![4]!.text).toBe('Typed');
  });
});
