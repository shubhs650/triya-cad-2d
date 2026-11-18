// XATTACH (M5-04 part 6): the xref block a drawing file is attached or overlaid as, before the
// app loads the file into it (model/xref.ts, `xrefLoadChange`). AutoCAD 2024 Help, "XATTACH
// (Command)", "Attach External Reference Dialog Box", "About Attaching Drawing References
// (Xrefs)":
//
// - the xref is a block record with DXF 70 bit 4 (an attachment) or 4 + 8 (an overlay) whose
//   BLOCK names the file (DXF 1) and holds nothing in the host file; its name is the file's name
//   without the extension, and its units (BLOCK_RECORD 70) the file's INSUNITS, so a reference
//   is scaled from them to the drawing's as a block's is;
// - a file the drawing has an xref of already (its file name, case aside, as Windows compares
//   them) is attached again as that xref: "the reference type of an xref already attached
//   cannot be changed", so the new reference is to the same block, whatever the dialog's type.
//   One a loaded xref brought in (nested) becomes the drawing's own (`adoptNestedXref`): the
//   drawing references it now, so its record is saved, as AutoCAD lists it at the top level too;
// - a name the drawing has for another block is numbered (`name-1`), as IMAGEATTACH numbers an
//   image's name (edit/picture.ts) and AutoCAD asks for another.
//
// The block's base point is the file's INSBASE, which the load sets (`xrefLoadChange`).
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { BlockTableRecord } from '../model/types';
import { XREF_FLAG, XREF_OVERLAY_FLAG, isXrefRecord, xrefBringing } from '../model/xref';
import { blockNameProblem, blockNamed } from './blocks';

/** The drawing file to attach, as the app read it. */
export interface XrefAttachFile {
  /** The file's name, which the xref saves as its path (Path type No path). */
  readonly fileName: string;
  /** The file's INSUNITS, an `$INSUNITS` code. */
  readonly units: number;
}

/** The file name a saved path ends in: AutoCAD writes `\`, other tools `/`. */
export function xrefFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The xref of the drawing whose saved path names the file `fileName` (case aside). */
export function xrefOfFile(model: DocumentModel, fileName: string): BlockTableRecord | undefined {
  const name = xrefFileName(fileName).toUpperCase();
  for (const r of model.tables.blockRecords.values()) {
    const path = model.blocks.get(r.handle)?.xrefPath;
    if (isXrefRecord(r) && path !== undefined && xrefFileName(path).toUpperCase() === name)
      return r;
  }
  return undefined;
}

/**
 * Makes xref `block`, which a loaded xref brought in, the drawing's own: it leaves the loading
 * xref's content (`xrefLoaded`), so unloading that xref keeps it and the save writes it. Nothing
 * when the drawing has it itself.
 */
export function adoptNestedXref(b: ChangeSetBuilder, model: DocumentModel, block: Handle): void {
  const parent = xrefBringing(model, block);
  const loaded = parent && b.block(parent.handle)?.xrefLoaded;
  if (loaded) b.updateBlock(parent.handle, { xrefLoaded: loaded.filter((h) => h !== block) });
}

/**
 * The name a new xref of `fileName` takes: the file's name without its extension, characters a
 * block name cannot have made `_`, numbered past the names the drawing has.
 */
export function xrefNameFor(model: DocumentModel, fileName: string): string {
  const file = xrefFileName(fileName);
  const stem = file.replace(/\.[^.]*$/, '') || file;
  let base = stem.replace(/[<>/\\":;?*|,=`]/g, '_').trim();
  if (base.startsWith('*') || blockNameProblem(base)) base = 'xref';
  let name = base;
  for (let n = 1; blockNamed(model, name); n += 1) name = `${base}-${n}`;
  return name;
}

/**
 * Adds the xref block of `file` (an overlay with `overlay`) to `b`, empty until the app loads the
 * file, and returns its handle. The caller has checked the drawing has no xref of the file
 * (`xrefOfFile`).
 */
export function attachXref(
  b: ChangeSetBuilder,
  model: DocumentModel,
  file: XrefAttachFile,
  overlay: boolean,
): Handle {
  const name = xrefNameFor(model, file.fileName);
  const def = b.addBlock({
    name,
    basePoint: { x: 0, y: 0 },
    flags: overlay ? XREF_FLAG | XREF_OVERLAY_FLAG : XREF_FLAG,
    units: file.units,
  });
  b.updateBlock(def.handle, { xrefPath: xrefFileName(file.fileName) });
  return def.handle;
}
