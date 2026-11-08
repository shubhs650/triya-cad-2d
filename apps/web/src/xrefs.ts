// External references (M1-21): which of a drawing's xrefs still wait for their file, and which
// of them a dropped drawing file answers. The main thread's mirror of the xref blocks, rebuilt
// from the drawing as opened plus every change its engine applied since (a loaded xref brings
// its nested xrefs in, as blocks of their own).
import {
  isXrefRecord,
  type BlockDefinition,
  type ChangeSet,
  type DocumentInit,
  type ImageDefinition,
  type PdfDefinition,
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
 * name, compared as Windows does, without case.
 */
export function xrefsAnsweredBy(pending: readonly PendingXref[], fileName: string): PendingXref[] {
  const name = fileName.toUpperCase();
  return pending.filter((x) => fileNameOf(x.path).toUpperCase() === name);
}

// ── The References palette (UI_SPEC §6) ─────────────────────────────────────────────────────

export type ReferenceKind = 'attach' | 'overlay' | 'image' | 'pdf';
/** AutoCAD's statuses in the External References palette that Triya has (M5-04 adds Unload). */
export type ReferenceStatus = 'loaded' | 'not-found' | 'unloaded';

export interface ReferenceRow {
  /** The xref's block record, or the image's or PDF's definition. */
  readonly handle: string;
  readonly kind: ReferenceKind;
  readonly name: string;
  readonly path: string;
  readonly status: ReferenceStatus;
  /** 0 for the drawing's own references, 1 for those of its xrefs, and so on. */
  readonly depth: number;
}

/** Which image and PDF files the user has supplied this session. */
export interface SuppliedFiles {
  image(fileName: string): boolean;
  pdf(fileName: string): boolean;
}

type Node = { readonly kind: 'xref' | 'image' | 'pdf'; readonly handle: string };

/**
 * The drawing's references as a tree, depth first, as AutoCAD's palette lists them: its xrefs,
 * images and PDF underlays, and under each loaded xref the xrefs, images and PDFs its file
 * brought in. A reference two xrefs bring in (one grandchild under an attachment and an overlay
 * of the same file) is listed under each.
 */
export function referencesOf(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  supplied: SuppliedFiles,
): ReferenceRow[] {
  const records = new Map((init.tables?.blockRecords ?? []).map((r) => [r.handle, r]));
  const defs = new Map<string, BlockDefinition>((init.blocks ?? []).map((b) => [b.handle, b]));
  const objects = new Map((init.objects ?? []).map((o) => [o.handle, o]));
  const top: Node[] = [];
  const under = new Map<string, Node[]>();
  const fileObject = (type: string): Node['kind'] | undefined =>
    type === 'IMAGEDEF' ? 'image' : type === 'PDFDEFINITION' ? 'pdf' : undefined;
  for (const r of init.tables?.blockRecords ?? []) {
    if (isXrefRecord(r)) top.push({ kind: 'xref', handle: r.handle });
  }
  for (const o of init.objects ?? []) {
    const kind = fileObject(o.type);
    if (kind) top.push({ kind, handle: o.handle });
  }
  for (const cs of changes) {
    const r = cs.tables?.blockRecords;
    for (const x of r?.removed ?? []) records.delete(x.handle);
    for (const x of r?.added ?? []) records.set(x.handle, x);
    for (const u of r?.updated ?? []) records.set(u.after.handle, u.after);
    for (const x of cs.blocks?.removed ?? []) defs.delete(x.handle);
    for (const x of cs.blocks?.added ?? []) defs.set(x.handle, x);
    for (const u of cs.blocks?.updated ?? []) defs.set(u.after.handle, u.after);
    for (const x of cs.objects?.removed ?? []) objects.delete(x.handle);
    for (const u of cs.objects?.updated ?? []) objects.set(u.after.handle, u.after);
    for (const x of cs.objects?.added ?? []) objects.set(x.handle, x);
    // An xref load: what it brought in is listed under the xref.
    const load = cs.blocks?.updated?.find((u) => u.after.xrefLoaded && !u.before.xrefLoaded);
    if (!load) continue;
    const children: Node[] = [];
    const seen = new Set<string>();
    for (const { entity } of cs.entities?.added ?? []) {
      const g = entity.geom;
      if (g.kind !== 'INSERT' || seen.has(g.block) || !isXrefRecord(records.get(g.block))) continue;
      seen.add(g.block);
      children.push({ kind: 'xref', handle: g.block });
    }
    for (const o of cs.objects?.added ?? []) {
      const kind = fileObject(o.type);
      if (kind) children.push({ kind, handle: o.handle });
    }
    under.set(load.after.handle, children);
  }

  const out: ReferenceRow[] = [];
  const visit = (nodes: readonly Node[], depth: number, path: ReadonlySet<string>) => {
    for (const n of nodes) {
      const row = rowOf(n, depth);
      if (!row) continue;
      out.push(row);
      // An xref that (through its nesting) references itself is listed once.
      if (n.kind === 'xref' && !path.has(n.handle))
        visit(under.get(n.handle) ?? [], depth + 1, new Set([...path, n.handle]));
    }
  };
  const rowOf = (n: Node, depth: number): ReferenceRow | undefined => {
    if (n.kind === 'xref') {
      const r = records.get(n.handle);
      const def = defs.get(n.handle);
      if (!r || !def || !isXrefRecord(r)) return undefined;
      return {
        handle: n.handle,
        kind: (r.flags ?? 0) & 8 ? 'overlay' : 'attach',
        name: r.name,
        path: def.xrefPath ?? '',
        status: def.xrefLoaded ? 'loaded' : 'not-found',
        depth,
      };
    }
    const o = objects.get(n.handle) as ImageDefinition | PdfDefinition | undefined;
    if (!o) return undefined;
    const found = n.kind === 'image' ? supplied.image(o.fileName) : supplied.pdf(o.fileName);
    const unloaded = o.type === 'IMAGEDEF' && !o.loaded;
    return {
      handle: n.handle,
      kind: n.kind,
      name: o.name || fileNameOf(o.fileName),
      path: o.fileName,
      status: unloaded ? 'unloaded' : found ? 'loaded' : 'not-found',
      depth,
    };
  };
  visit(top, 0, new Set());
  return out;
}

/** The file names the not-found references wait for, each once. */
export function missingFileNames(rows: readonly ReferenceRow[]): string[] {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.status !== 'not-found') continue;
    const name = fileNameOf(r.path);
    if (name) out.set(name.toUpperCase(), name);
  }
  return [...out.values()];
}

/** A file the user supplied: dropped, picked, or found in a folder; read only when used. */
export interface FileSource {
  readonly name: string;
  getFile(): Promise<Blob>;
}

/**
 * Loads `files` into the xrefs that wait for them, in every open drawing, as AutoCAD resolves
 * an xref found by name: a file that answers xrefs of several drawings (or two xrefs of one) is
 * loaded into each, and the nested xrefs a load brings in are answered from the same files, so
 * a title block and its grandchild dropped together both load. `pending` is asked again after
 * every load. Returns the files that answered an xref; an xref whose load failed (`load`
 * throws, having shown its error) is not tried again.
 */
export async function loadXrefFiles<F extends { readonly name: string }>(
  files: readonly F[],
  pending: () => readonly { readonly doc: number; readonly xrefs: readonly PendingXref[] }[],
  load: (doc: number, xrefs: readonly PendingXref[], file: F) => Promise<void>,
): Promise<Set<F>> {
  const used = new Set<F>();
  const failed = new Set<string>();
  for (;;) {
    const next = (() => {
      for (const { doc, xrefs } of pending()) {
        const open = xrefs.filter((x) => !failed.has(`${doc} ${x.block}`));
        for (const file of files) {
          const answered = xrefsAnsweredBy(open, file.name);
          if (answered.length) return { doc, answered, file };
        }
      }
      return undefined;
    })();
    if (!next) return used;
    // A file that answers an xref is the xref's even when its load fails (its error shows).
    used.add(next.file);
    try {
      await load(next.doc, next.answered, next.file);
    } catch {
      for (const x of next.answered) failed.add(`${next.doc} ${x.block}`);
    }
  }
}
