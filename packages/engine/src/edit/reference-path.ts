// A reference's saved path (M5-04 part 15): -XREF Path and Pathtype, and the References
// palette's Saved Path. AutoCAD 2024 Help:
//
// - "-XREF (Command)", Path: "Displays and edits the path name associated with a particular DWG
//   reference", useful when the file was moved or renamed. Pathtype sets a Full, Relative or
//   None path.
// - "To Change the Path of a DWG Reference": the palette's Saved Path is edited (or a file picked
//   with its Browse button), and "the program reloads the xref".
//
// The path is the xref BLOCK's DXF 1, an IMAGEDEF's or PDFDEFINITION's DXF 1. Only the drawing's
// own references have a path it saves: a nested xref's, or an image's or underlay's an xref
// brought in, is in the xref's file, so it is refused (AutoCAD greys the nested ones' paths).
//
// An xref given a new path is loaded again from it (`setReferencePath` leaves it waiting for its
// file, as XREF Reload does, in the same change), so the app loads the file of the new name and
// that load joins the undo step (`PromptBus.joinLoad`); an unloaded xref stays unloaded. Triya
// finds files by name (a browser tells no folder), so a full or relative path is only ever what
// a file already had: Pathtype None is the one type it can give (`withoutFolder`).
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { ImageDefinition, PdfDefinition } from '../model/types';
import { isXrefRecord, removeXrefContent, xrefBringing } from '../model/xref';
import { xrefFileName } from './xref-attach';

/** The path a reference has with Pathtype None (REFPATHTYPE 0): its file name. */
export function withoutFolder(path: string): string {
  return xrefFileName(path);
}

/** A typed path: blanks around it and the double quotes a name with spaces comes in go. */
export function typedPath(text: string): string {
  const t = text.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).trim() : t;
}

/** The saved path of reference `handle` (an xref's block, or an image's or PDF's definition). */
export function referencePath(model: DocumentModel, handle: Handle): string | undefined {
  const def = model.blocks.get(handle);
  if (def) return isXrefRecord(model.tables.blockRecords.get(handle)) ? def.xrefPath : undefined;
  const o = model.objects.get(handle);
  return o?.type === 'IMAGEDEF' || o?.type === 'PDFDEFINITION'
    ? (o as ImageDefinition | PdfDefinition).fileName
    : undefined;
}

/** What reference `handle` is called in messages: its xref name, or its definition's name. */
function referenceName(model: DocumentModel, handle: Handle): string {
  const r = model.tables.blockRecords.get(handle);
  if (r) return r.name;
  const o = model.objects.get(handle) as ImageDefinition | PdfDefinition | undefined;
  return o?.name || (o ? xrefFileName(o.fileName) : handle);
}

/** Why reference `handle` cannot be given the saved path `path`, or undefined. */
export function referencePathProblem(
  model: DocumentModel,
  handle: Handle,
  path: string,
): string | undefined {
  if (referencePath(model, handle) === undefined) return `No reference ${handle}.`;
  const name = referenceName(model, handle);
  const parent = xrefBringing(model, handle);
  if (parent) return `"${name}" is nested in "${parent.name}": its path is saved in that file.`;
  if (path.trim() === '') return `A path names a file: "${name}" keeps its path.`;
  return undefined;
}

/**
 * Gives reference `handle` the saved path `path` in `b`. A loaded xref is emptied and waits for
 * its file again, to be loaded from the new path; one unloaded stays so. Throws when
 * `referencePathProblem` names a problem; nothing when the path is the same.
 */
export function setReferencePath(
  b: ChangeSetBuilder,
  model: DocumentModel,
  handle: Handle,
  path: string,
): void {
  const problem = referencePathProblem(model, handle, path);
  if (problem) throw new Error(problem);
  if (referencePath(model, handle) === path) return;
  const def = model.blocks.get(handle);
  if (!def) {
    b.updateObject(handle, { fileName: path } as Partial<ImageDefinition>);
    return;
  }
  if (def.xrefLoaded) removeXrefContent(b, model, [handle]);
  b.updateBlock(handle, { xrefPath: path, xrefLoaded: undefined, xrefHandles: undefined });
}
