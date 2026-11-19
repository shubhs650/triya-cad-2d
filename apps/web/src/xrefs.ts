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
    if (!isXrefRecord(r) || !def || def.xrefLoaded || def.xrefUnloaded) continue;
    if (def.xrefPath === undefined) continue;
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
/** AutoCAD's statuses in the External References palette that Triya has. */
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
  /** What was listed under each xref bound, for its undo. */
  const bound = new Map<string, Node[]>();
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
    // An xref bound (M5-04 part 2): it is no reference any more, and the images and underlays
    // it brought are the drawing's own. Undone, it lists what it did before.
    const updated = cs.blocks?.updated ?? [];
    const binds = updated.filter((u) => u.before.xrefPath !== undefined && !u.after.xrefPath);
    const unbinds = updated.filter((u) => u.before.xrefPath === undefined && u.after.xrefPath);
    if (binds.length > 0 || unbinds.length > 0) {
      for (const u of binds) {
        bound.set(u.after.handle, under.get(u.after.handle) ?? []);
        under.delete(u.after.handle);
      }
      for (const o of cs.objects?.updated ?? []) {
        const kind = fileObject(o.after.type);
        const h = o.after.handle;
        if (kind && binds.length > 0 && !top.some((n) => n.handle === h))
          top.push({ kind, handle: h });
      }
      const back = new Set<string>();
      for (const u of unbinds) {
        const children = bound.get(u.after.handle) ?? [];
        bound.delete(u.after.handle);
        under.set(u.after.handle, children);
        for (const n of children) back.add(n.handle);
      }
      if (back.size > 0) top.splice(0, top.length, ...top.filter((n) => !back.has(n.handle)));
      continue;
    }
    // An xref unloaded or reloaded (M5-04): nothing is listed under it until it loads again.
    for (const u of cs.blocks?.updated ?? []) {
      if (u.before.xrefLoaded && !u.after.xrefLoaded) under.delete(u.after.handle);
    }
    // An xref load: what it brought in is listed under the xref.
    const load = cs.blocks?.updated?.find((u) => u.after.xrefLoaded && !u.before.xrefLoaded);
    if (!load) {
      // The drawing's own, made since it opened: a pasted picture's (M2-54, M2-72) or a pasted
      // image's or underlay's (M2-32), an xref attached (XATTACH, M5-04 part 6).
      for (const o of cs.objects?.added ?? []) {
        const kind = fileObject(o.type);
        if (kind && !top.some((n) => n.handle === o.handle)) top.push({ kind, handle: o.handle });
      }
      const own = (h: string) => {
        if (!top.some((n) => n.handle === h)) top.push({ kind: 'xref', handle: h });
      };
      for (const x of r?.added ?? []) if (isXrefRecord(x)) own(x.handle);
      // A nested xref XATTACH made the drawing's own: it leaves its xref's content.
      for (const u of cs.blocks?.updated ?? []) {
        if (!u.before.xrefLoaded || !u.after.xrefLoaded) continue;
        const kept = new Set(u.after.xrefLoaded);
        for (const h of u.before.xrefLoaded)
          if (!kept.has(h) && isXrefRecord(records.get(h))) own(h);
      }
      continue;
    }
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
        status: def.xrefLoaded ? 'loaded' : def.xrefUnloaded ? 'unloaded' : 'not-found',
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

// ── Reload All References and the details pane (M5-04 part 14) ─────────────────────────────

/** The palette's names of the reference types, as AutoCAD's Type column gives them. */
export const REFERENCE_KIND: Readonly<Record<ReferenceKind, string>> = {
  attach: 'Attach',
  overlay: 'Overlay',
  image: 'Image',
  pdf: 'PDF underlay',
};

/** The palette's names of the statuses. */
export const REFERENCE_STATUS: Readonly<Record<ReferenceStatus, string>> = {
  loaded: 'Loaded',
  'not-found': 'Not found',
  unloaded: 'Unloaded',
};

/**
 * What the palette's Reload All References reloads: the xrefs the drawing attaches itself (a
 * nested one comes back with the xref that brings it in) and the image and PDF files, each file
 * once. AutoCAD's Help says only that it "reloads all referenced files"; whether an xref
 * unloaded on purpose comes back is not said, so Triya leaves unloaded references unloaded, as
 * a drafter who unloaded one to lighten the drawing expects.
 */
export function reloadAllTargets(rows: readonly ReferenceRow[]): {
  readonly xrefs: string[];
  readonly files: string[];
} {
  const xrefs: string[] = [];
  const files = new Map<string, string>();
  for (const r of rows) {
    if (r.status === 'unloaded') continue;
    if (r.kind === 'attach' || r.kind === 'overlay') {
      if (r.depth === 0 && !xrefs.includes(r.handle)) xrefs.push(r.handle);
    } else {
      const key = fileNameOf(r.path).toLowerCase();
      if (key && !files.has(key)) files.set(key, r.path);
    }
  }
  return { xrefs, files: [...files.values()] };
}

/** A file size as Windows lists it, and AutoCAD's details pane after it: kilobytes rounded up. */
export function formatFileSize(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString('en-US')} KB`;
}

const RASTER_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/** The media type an image file opens in a browser tab with (the palette's Open). */
export function rasterMimeType(fileName: string): string {
  const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  return RASTER_TYPES[ext] ?? 'application/octet-stream';
}

/** Where the file of a reference was found, and what the browser says of it. */
export interface FoundFile {
  /** The folder path it was found at (`sheets/xrefs/tb.dxf`), or how it came. */
  readonly foundAt: string;
  readonly size: number;
  /** Last modified, ms since 1970; unknown for a file only this device keeps. */
  readonly modified?: number;
}

/**
 * The details pane of the External References palette for one reference, in AutoCAD's order:
 * Reference Name, Status, Size, Type, Date, Saved Path and Found At. Size, Date and Found At are
 * empty while the file is not found.
 */
export function referenceDetails(
  row: ReferenceRow,
  found: FoundFile | undefined,
  formatDate: (ms: number) => string,
): [string, string][] {
  return [
    ['Reference Name', row.name],
    ['Status', REFERENCE_STATUS[row.status]],
    ['Size', found ? formatFileSize(found.size) : ''],
    ['Type', REFERENCE_KIND[row.kind]],
    ['Date', found?.modified !== undefined ? formatDate(found.modified) : ''],
    ['Saved Path', row.path],
    ['Found At', found?.foundAt ?? ''],
  ];
}

/** A file the user supplied: dropped, picked, or found in a folder; read only when used. */
export interface FileSource {
  readonly name: string;
  getFile(): Promise<Blob>;
  /**
   * Where it was found, for the References palette's Found At (M5-04 part 14): its path in the
   * folder dropped or picked, starting with the folder's name; a file dropped or picked alone
   * has no folder the browser tells of, and is found at its name.
   */
  readonly foundAt?: string;
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
