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
  DictionaryCloningFlags,
  TableContentObject,
  TableEntity,
  XRecord,
  XYZ,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { Entity, TableGeometry } from '@triya/engine';
import { tableContentCodes } from '../map/table-content';
import { newTableContent, type Resolver } from './entities';

export const ROUNDTRIP_DICTIONARY_KEY = 'ACAD_XREC_ROUNDTRIP';
export const ROUNDTRIP_TABLE = 'ACAD_ROUNDTRIP_2008_TABLE_ENTITY';

/**
 * Gives each new table of a DXF save its round-trip XRECORD and TABLECONTENT, after the entities
 * are written. A table that has the record already (none does: the save makes the table) keeps it.
 */
export function writeNewTableContents(
  doc: CadDocument,
  r: Resolver,
  added: readonly { e: unknown; after: Entity }[],
): void {
  if (r.format !== 'dxf') return;
  const version = r.version;
  if (version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015)
    return;
  for (const { e, after } of added) {
    if (!(e instanceof TableEntity) || after.geom.kind !== 'ACAD_TABLE') continue;
    if (e.xDictionary?.getEntry(ROUNDTRIP_DICTIONARY_KEY)) continue;
    writeTableContent(doc, r, e, after.geom as TableGeometry);
  }
}

function writeTableContent(doc: CadDocument, r: Resolver, t: TableEntity, g: TableGeometry): void {
  const content = newTableContent(r, g);
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
