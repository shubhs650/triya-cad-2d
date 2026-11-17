// A new table's AutoCAD 2008 data in a DXF save (M4-28). AutoCAD keeps what the legacy
// ACAD_TABLE codes cannot state (each row's, column's and cell's cell style, locks, border
// linetypes, custom data) in a TABLECONTENT object, named by the `ACAD_ROUNDTRIP_2008_TABLE_ENTITY`
// data of the XRECORD `ACAD_XREC_ROUNDTRIP` in the table's extension dictionary; every corpus
// DXF table has one (acadsharp sample_AC1015…AC1032, ezdxf acad_table_*). A table the drawing
// came with keeps its own as read (acad-ts patch 0070, DEC-040). A new one (TABLE, -TABLE, COPY,
// PASTECLIP) gets the content a DWG from R2010 states for it (entities.ts `newTableContent`:
// rows on the `_TITLE`, `_HEADER` and `_DATA` cell styles of their row type, the cells' formats
// in cell styles, merges as ranges), written by map/table-content.ts.
//
// The XRECORD is laid out as every corpus one is: 102 `ACAD_ROUNDTRIP_2008_TABLE_ENTITY`, 360 the
// TABLECONTENT (which it owns), 70 2, 90 the break row ranges (one, from (0, 0, 0), over every
// row: what each corpus table states), then each range's 10/20/30 position and 90 first and last
// row. AutoCAD then names a TABLEGEOMETRY (361), its cache of each cell's content extents, which
// Triya does not lay out the way AutoCAD does; a new table states none, and AutoCAD works the
// extents out again when it draws the table. A DWG states the content in the table itself, so
// this is for DXF saves only.
import {
  ACadVersion,
  CadDictionary,
  CadValueType,
  CellContent,
  Field,
  TableCellContentType,
  DictionaryCloningFlags,
  TableContentObject,
  TableEntity,
  XRecord,
  XYZ,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { Entity, TableGeometry } from '@triya/engine';
import {
  ROUNDTRIP_DICTIONARY_KEY,
  ROUNDTRIP_TABLE,
  roundTripTableContent,
  tableContentCodes,
} from '../map/table-content';
import { editedTableContent, newTableContent, same, type Resolver } from './entities';

export { ROUNDTRIP_DICTIONARY_KEY, ROUNDTRIP_TABLE };

/**
 * Gives each new table of a DXF save its round-trip XRECORD and TABLECONTENT, after the entities
 * are written. A table that has the record already (none does: the save makes the table) keeps it.
 */
export function writeNewTableContents(
  doc: CadDocument,
  r: Resolver,
  added: readonly { e: unknown; after: Entity }[],
): void {
  if (!statesContent(r)) return;
  for (const { e, after } of added) {
    if (!(e instanceof TableEntity) || after.geom.kind !== 'ACAD_TABLE') continue;
    if (e.xDictionary?.getEntry(ROUNDTRIP_DICTIONARY_KEY)) continue;
    writeTableContent(doc, r, e, after.geom as TableGeometry);
  }
}

/** A DXF from R2000, the versions AutoCAD writes a table's AutoCAD 2008 data in. */
function statesContent(r: Resolver): boolean {
  const version = r.version;
  return (
    r.format === 'dxf' &&
    (version === undefined || version === ACadVersion.Unknown || version >= ACadVersion.AC1015)
  );
}

/** The table fields its TABLECONTENT states; placement, plane and the `*T` block it does not. */
const CONTENT_FIELDS = [
  'style',
  'rowHeights',
  'columnWidths',
  'cells',
  'overrides',
  'rowStyles',
  'rowOrigins',
  'columnOrigins',
] as const;

/**
 * Writes the AutoCAD 2008 data of each table a DXF save edits again from the edited table
 * (M4-30), after the entities are written: AutoCAD reads a table from its TABLECONTENT where it
 * has one, so a copy as read would undo the edit there. The content as read gets the edit
 * (entities.ts `editedTableContent`) and keeps everything else; the object, its record and their
 * handles stay. The record's break range (one, over every row) is made to cover the rows as
 * edited, and its TABLEGEOMETRY (361), AutoCAD's cache of each cell's content extents laid out for
 * the grid as it was, goes, as a new table states none (DEC-067 item 3): AutoCAD works the
 * extents out again. A record laid out otherwise (table breaks, a DXF before R2007's own round-trip
 * data after it) or a content the edit cannot be written into is dropped (DEC-069), so that
 * AutoCAD reads the table from the legacy ACAD_TABLE codes, which hold the edit. A table whose
 * content fields did not change (moved, rotated, another layer) keeps its record as read.
 */
export function writeEditedTableContents(
  doc: CadDocument,
  r: Resolver,
  updated: readonly { acad: unknown; before: Pick<Entity, 'geom'>; after: Pick<Entity, 'geom'> }[],
): void {
  if (!statesContent(r)) return;
  for (const { acad, before, after } of updated) {
    if (!(acad instanceof TableEntity)) continue;
    if (before.geom.kind !== 'ACAD_TABLE' || after.geom.kind !== 'ACAD_TABLE') continue;
    const b = before.geom as TableGeometry;
    const a = after.geom as TableGeometry;
    if (CONTENT_FIELDS.every((k) => same(b[k], a[k]))) continue;
    // A table that came without AutoCAD 2008 data (a DXF from another program) gets it as a new
    // table does when it now states what only that data holds: rows or cells on cell styles
    // other than their place gives them (M4-16 part 5), which the legacy codes cannot state.
    if (!acad.xDictionary?.getEntry(ROUNDTRIP_DICTIONARY_KEY)) {
      if (statesCellStyles(a)) writeTableContent(doc, r, acad, a);
      continue;
    }
    rewriteTableContent(doc, r, acad, b, a);
  }
}

/** Whether `g` puts a row or cell on a cell style of its own (`rowStyles`, `cellStyle`). */
function statesCellStyles(g: TableGeometry): boolean {
  return g.rowStyles !== undefined || g.cells.some((row) => row.some((c) => c.cellStyle));
}

/** The record's entries before any break range: 102, 360, 70 and 90 the range count. */
const RECORD_HEAD = [102, 360, 70, 90] as const;

function rewriteTableContent(
  doc: CadDocument,
  r: Resolver,
  t: TableEntity,
  before: TableGeometry,
  after: TableGeometry,
): void {
  const rt = roundTripTableContent(t, (h) => doc.getCadObject(h));
  if (!rt) return;
  const entries = rt.record.entries;
  // One break range over every row (10 its position, 90 its first and last row), then at most the
  // TABLEGEOMETRY: what every corpus table from R2007 states.
  const plain =
    entries.length >= 7 &&
    entries.length <= 8 &&
    RECORD_HEAD.every((code, k) => entries[k]!.code === code) &&
    entries[3]!.value === 1 &&
    entries[4]!.code === 10 &&
    entries[5]!.code === 90 &&
    entries[5]!.value === 0 &&
    entries[6]!.code === 90 &&
    entries[6]!.value === before.rowHeights.length - 1 &&
    (entries.length === 7 || entries[7]!.code === 361);
  const content =
    plain && rt.content ? editedTableContent(r, rt.content, before, after) : undefined;
  if (!content) {
    t.xDictionary!.remove(ROUNDTRIP_DICTIONARY_KEY);
    return;
  }
  nameCellFields(content, t, after);
  rt.object.rawDxfCodes = tableContentCodes(content, rt.head);
  const kept = entries.slice(0, 7).map((e) => [e.code, e.value] as const);
  rt.record.clear();
  for (const [code, value] of kept) rt.record.createEntry(code, value);
  rt.record.entries[6]!.value = Math.max(0, content.rows.length - 1);
}

function writeTableContent(doc: CadDocument, r: Resolver, t: TableEntity, g: TableGeometry): void {
  const content = newTableContent(r, g);
  nameCellFields(content, t, g);
  const x = new XRecord();
  x.handle = r.allocate();
  x.cloningFlags = DictionaryCloningFlags.KeepExisting;
  const object = new TableContentObject();
  object.handle = r.allocate();
  object.owner = x;
  object.rawDxfCodes = tableContentCodes(content, [
    { code: 5, value: object.handle },
    { code: 330, value: x.handle },
  ]);
  x.createEntry(102, ROUNDTRIP_TABLE);
  x.createEntry(360, object);
  x.createEntry(70, 2);
  x.createEntry(90, 1);
  x.createEntry(10, new XYZ(0, 0, 0));
  x.createEntry(90, 0);
  x.createEntry(90, Math.max(0, content.rows.length - 1));
  let dict = t.xDictionary;
  if (!dict) {
    dict = new CadDictionary();
    dict.handle = r.allocate();
    dict.hardOwnerFlag = true;
    dict.clonningFlags = DictionaryCloningFlags.KeepExisting;
    dict.addByKey(ROUNDTRIP_DICTIONARY_KEY, x);
    // Joining the table registers the dictionary and its record with the drawing.
    t.xDictionary = dict;
  } else {
    dict.addByKey(ROUNDTRIP_DICTIONARY_KEY, x);
  }
  if (!doc.getCadObject(object.handle)) doc.registerCollection(object);
}

/**
 * Names in `content` the FIELDs table `t`'s cells hold (M4-23 part 2), which the scratch table the
 * content was written from does not make: a text cell with fields gets a field content naming its
 * root FIELD (340), as a DWG from R2010 states it, and the content's field references (360) list
 * the roots, in place of the ones its cells named before; a cell whose fields are gone holds its
 * text as a value again. `t`'s grid is the content's, the edit written into both.
 */
function nameCellFields(content: TableEntity['content'], t: TableEntity, g: TableGeometry): void {
  const before = new Set<unknown>();
  const roots: Field[] = [];
  content.rows.forEach((row, i) =>
    row.cells.forEach((cell, j) => {
      const field = t.rows[i]?.cells[j]?.contents[0]?.field ?? null;
      let k = cell.contents[0];
      if (k?.field) before.add(k.field);
      if (field) {
        roots.push(field);
        if (!k) {
          k = new CellContent();
          cell.contents.push(k);
        }
        k.contentType = TableCellContentType.Field;
        k.field = field;
      } else if (k && k.contentType === TableCellContentType.Field && k.field instanceof Field) {
        const text = g.cells[i]?.[j]?.text ?? '';
        k.contentType = TableCellContentType.Value;
        k.field = null;
        if (k.cadValue.value == null) k.cadValue.setValue(text, CadValueType.String);
      }
    }),
  );
  const kept = content.fieldReferences.filter((f) => !before.has(f) && !roots.includes(f as Field));
  content.fieldReferences = [...kept, ...roots];
}
