// What a save rewrites with an edited table beside the table itself (M4-30): its AutoCAD 2008
// data, the `ACAD_XREC_ROUNDTRIP` XRECORD in its extension dictionary and the TABLECONTENT and
// TABLEGEOMETRY that record owns. A structural diff of an edited table's save ignores them with
// the table, as it ignores the vertices of an edited polyline.
import { isDeepStrictEqual } from 'node:util';
import {
  CadObject,
  CadValueType,
  TableEntity,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { TableGeometry } from '@triya/engine';
import { roundTripTableContent, tableEntityGeometry } from '@triya/io';

/** `o` and what it owns (a DXF before R2007's round-trip data nests records and tables). */
function owned(o: CadObject, ignore: Set<number>): void {
  if (ignore.has(o.handle) && o.handle !== 0) return;
  ignore.add(o.handle);
  // A raw object (ACDBDATATABLE) owns the records it lists.
  const raw = (o as { rawOwnedObjects?: readonly CadObject[] }).rawOwnedObjects ?? [];
  for (const child of raw) owned(child, ignore);
  if (!(o instanceof XRecord)) return;
  for (const e of o.entries) {
    if (e.code >= 360 && e.code <= 369 && e.value instanceof CadObject) owned(e.value, ignore);
  }
}

/** Adds to `ignore` the round-trip record (and its dictionary and objects) of each table in it. */
export function withTableRecords(doc: CadDocument, ignore: Set<number>): Set<number> {
  for (const h of [...ignore]) {
    const t = doc.getCadObject(h);
    if (!(t instanceof TableEntity) || !t.xDictionary) continue;
    const record = t.xDictionary.getEntry('ACAD_XREC_ROUNDTRIP');
    if (!(record instanceof XRecord)) continue;
    // A record the save drops leaves the dictionary without it.
    ignore.add(t.xDictionary.handle);
    owned(record, ignore);
  }
  return ignore;
}

/**
 * Where the TABLECONTENT a save wrote for table `handle` maps otherwise than `expected` (the
 * table as edited, M4-30): the grid, row heights, column widths, table-wide overrides, each
 * cell's spans, rotation and format, and the text of each cell holding one text. A cell the
 * content holds several contents in is passed over (the legacy codes state it otherwise), as is
 * a table whose record the save dropped. Returns null when the table has no record.
 */
export function contentMismatches(
  doc: CadDocument,
  handle: string,
  expected: TableGeometry,
): string[] | null {
  const t = doc.getCadObject(Number.parseInt(handle, 16));
  if (!(t instanceof TableEntity)) return [`${handle} is not a table`];
  const rt = roundTripTableContent(t, (h) => doc.getCadObject(h));
  if (!rt) return null;
  if (!rt.content) return ['its TABLECONTENT does not read'];
  const g = tableEntityGeometry(t, rt.content) as TableGeometry;
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => isDeepStrictEqual(clean(a), clean(b));
  for (const k of ['rowHeights', 'columnWidths', 'overrides', 'style'] as const) {
    if (!same(g[k], expected[k])) out.push(`${k}: ${JSON.stringify(g[k])}`);
  }
  if (g.cells.length !== expected.cells.length) return [...out, 'rows'];
  expected.cells.forEach((row, i) =>
    row.forEach((c, j) => {
      const k = rt.content!.rows[i]?.cells[j];
      if (!k) return void out.push(`(${i}, ${j}) missing`);
      if (k.contents.length > 1) return;
      const d = g.cells[i]![j]!;
      const { text: _t, value: _v, valueFormat: _f, ...a } = d;
      const { text: _t2, value: _v2, valueFormat: _f2, ...b } = c;
      if (!same(a, b)) out.push(`(${i}, ${j}): ${JSON.stringify(a)} for ${JSON.stringify(b)}`);
      const string = k.contents[0]?.cadValue.valueType === CadValueType.String;
      if (string && c.type === 'text' && d.text !== c.text && !c.value) {
        out.push(`(${i}, ${j}) text ${JSON.stringify(d.text)} for ${JSON.stringify(c.text)}`);
      }
    }),
  );
  return out;
}

/** JSON's view: undefined fields dropped. */
const clean = (v: unknown): unknown => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
