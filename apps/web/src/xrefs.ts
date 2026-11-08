// External references (M1-21): which of a drawing's xrefs still wait for their file, and which
// of them a dropped drawing file answers. The main thread's mirror of the xref blocks, rebuilt
// from the drawing as opened plus every change its engine applied since (a loaded xref brings
// its nested xrefs in, as blocks of their own).
import {
  isXrefRecord,
  type BlockDefinition,
  type ChangeSet,
  type DocumentInit,
} from '@triya/engine';

export interface PendingXref {
  /** The xref's block record. */
  readonly block: string;
  readonly name: string;
  /** The path the drawing saves (often relative, `.\title.dxf`). */
  readonly path: string;
}

/** The file name a saved path ends in: AutoCAD writes `\`, other tools `/`. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The drawing's xrefs whose file has not been loaded yet, in block table order. */
export function pendingXrefs(init: DocumentInit, changes: readonly ChangeSet[]): PendingXref[] {
  const records = new Map((init.tables?.blockRecords ?? []).map((r) => [r.handle, r]));
  const defs = new Map<string, BlockDefinition>((init.blocks ?? []).map((b) => [b.handle, b]));
  for (const cs of changes) {
    const r = cs.tables?.blockRecords;
    for (const x of r?.removed ?? []) records.delete(x.handle);
    for (const x of r?.added ?? []) records.set(x.handle, x);
    for (const u of r?.updated ?? []) records.set(u.after.handle, u.after);
    for (const x of cs.blocks?.removed ?? []) defs.delete(x.handle);
    for (const x of cs.blocks?.added ?? []) defs.set(x.handle, x);
    for (const u of cs.blocks?.updated ?? []) defs.set(u.after.handle, u.after);
  }
  const out: PendingXref[] = [];
  for (const r of records.values()) {
    const def = defs.get(r.handle);
    if (!isXrefRecord(r) || !def || def.xrefLoaded || def.xrefPath === undefined) continue;
    out.push({ block: r.handle, name: r.name, path: def.xrefPath });
  }
  return out;
}

/**
 * The pending xrefs a file of this name answers: those whose saved path ends in the same file
 * name, compared as Windows does, without case. (Folders and cached file handles come later.)
 */
export function xrefsAnsweredBy(pending: readonly PendingXref[], fileName: string): PendingXref[] {
  const name = fileName.toUpperCase();
  return pending.filter((x) => fileNameOf(x.path).toUpperCase() === name);
}
