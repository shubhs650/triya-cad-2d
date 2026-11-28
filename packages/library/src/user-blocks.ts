// The blocks of the drawing files kept in the user's library folders (M8-03 part 2). The Library
// palette lists a file's named blocks, as DesignCenter lists a drawing's (`designCenterContent`),
// and hands one to the drawing shown as it hands the catalogue's: copied out with what it names
// (`designCenterItem`), added unless the drawing has a block of its name, and inserted at scale 1,
// INSERT converting the block's units into the drawing's.
//
// A block's units are its record's (DXF 70 of AcDbBlockTableRecord, the Block Unit). AutoCAD
// inserts a unitless block unscaled; a library block is a symbol drawn in its file's units, so
// one the file left unitless is taken to be in the file's INSUNITS, and a valve drawn in
// millimetres is the same size in a drawing in inches (DEC-096). A unitless file leaves it so.
import {
  designCenterContent,
  designCenterItem,
  insUnitsOf,
  type Clipboard,
  type DocumentModel,
} from '@triya/engine';
import type { LibraryBlock } from './catalogue';

/** The named blocks `model` offers a library: DesignCenter's (no layout, anonymous or xref blocks). */
export function libraryDrawingBlocks(model: DocumentModel): readonly string[] {
  return designCenterContent(model).blocks;
}

/** Block `name` (case aside) of a library drawing, copied out in its units for another drawing. */
export function libraryDrawingBlock(model: DocumentModel, name: string): LibraryBlock {
  const item = designCenterItem(model, 'blocks', name);
  if (!item) return { name: '', error: `The drawing file has no block ${name}` };
  return { name: item.name, content: inFileUnits(item.content, item.name, insUnitsOf(model)) };
}

/** `clip` with its block `name`'s record in `units` when the record has none. */
function inFileUnits(clip: Clipboard, name: string, units: number): Clipboard {
  const records = clip.tables.blockRecords;
  if (units === 0 || !records) return clip;
  return {
    ...clip,
    tables: {
      ...clip.tables,
      blockRecords: records.map((r) =>
        r.name === name && (r.units ?? 0) === 0 ? { ...r, units } : r,
      ),
    },
  };
}
