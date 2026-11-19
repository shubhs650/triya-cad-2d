// REFEDIT of an xref (M5-02 part 6): the app's side of REFCLOSE Save, which writes the edits back
// to the xref's own file (AutoCAD 2024 Help, "REFCLOSE (Command)"). The engine asks for the
// xref's file as it is now (`xrefDrawing`), makes its change in the file's handles, and hands it
// over (`writeXref`); the file is the one that answered the xref this session (dropped, picked in
// XATTACH or found in a kept folder), found by the name its saved path ends in, as a load finds it.
//
// The write is Save's (save.ts, DEC-047): an AC1032 DXF from the file's own bytes and the change.
// It goes in place where the browser gives the app a file handle it may write (Chromium asks the
// user once); otherwise (a file dropped without a handle, Firefox, Safari, writing refused) the
// file is downloaded under its name, for the user to put in place of the old one. Either way the
// session's later reads of the xref (XREF Reload, another REFEDIT) read what was written.
//
// -XREF Attach and Overlay (M5-04 part 12) name a file at the command line; a browser opens no
// path by itself, so the app finds it by name among the drawings it holds (`xrefFileReply`): the
// files that answered xrefs this session, the drawings open (as saved), then its kept folders.
import type { ChangeSet, DocumentInit, ViewReply } from '@triya/engine';
import type { SaveHandle } from './save';
import type { ReferenceHandle } from './reference-files';
import type { FileSource } from './xrefs';

/** A file that answered xrefs, with the handle it came with when the browser gave one. */
export type XrefSource = FileSource & { readonly handle?: ReferenceHandle };

export interface XrefWriteEnv {
  /** Save's writer: the AC1032 DXF of `bytes` with `changes` (the I/O worker). */
  write(bytes: Uint8Array, changes: readonly ChangeSet[]): Promise<Uint8Array>;
  download(name: string, bytes: Uint8Array): void;
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The reply to `xrefDrawing`: the file read and opened, or no drawing when there is no file. */
export async function xrefDrawingReply(
  source: XrefSource | undefined,
  open: (file: Blob) => Promise<{ readonly init: DocumentInit }>,
): Promise<ViewReply> {
  if (!source) return { ok: true };
  try {
    const opened = await open(await source.getFile());
    return { ok: true, xrefDrawing: { name: source.name, init: opened.init } };
  } catch (e) {
    return { ok: false, message: `${source.name} could not be read: ${reason(e)}` };
  }
}

/** Whether the app may write `h` in place, asking the browser once when it has to. */
async function mayWrite(h: SaveHandle): Promise<boolean> {
  if (!h.createWritable) return false;
  try {
    if (!h.queryPermission || !h.requestPermission) return true;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * `writeXref`: the xref's file `source` written with `changes`, in place or downloaded. Returns
 * the reply and the source later reads of the xref use (the file as written).
 */
export async function writeXrefFile(
  source: XrefSource,
  changes: readonly ChangeSet[],
  env: XrefWriteEnv,
): Promise<{ readonly reply: ViewReply; readonly source: XrefSource }> {
  let out: Uint8Array;
  try {
    const bytes = new Uint8Array(await (await source.getFile()).arrayBuffer());
    out = await env.write(bytes, changes);
  } catch (e) {
    return {
      reply: { ok: false, message: `${source.name} was not written: ${reason(e)}` },
      source,
    };
  }
  const written: XrefSource = {
    name: source.name,
    getFile: () => Promise.resolve(new Blob([out as Uint8Array<ArrayBuffer>])),
    ...(source.handle ? { handle: source.handle } : {}),
  };
  const h = source.handle?.kind === 'file' ? (source.handle as unknown as SaveHandle) : undefined;
  if (h && (await mayWrite(h))) {
    try {
      const w = await h.createWritable!();
      await w.write(new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/dxf' }));
      await w.close();
      return {
        reply: { ok: true, written: { file: source.name, downloaded: false } },
        source: written,
      };
    } catch {
      // Written nowhere: downloaded below.
    }
  }
  env.download(source.name, out);
  return { reply: { ok: true, written: { file: source.name, downloaded: true } }, source: written };
}

/** Somewhere the app holds drawing files: those it holds there, listed when asked. */
export type XrefFilePlace = () => readonly XrefSource[] | Promise<readonly XrefSource[]>;

export interface XrefFileEnv {
  /** The file's INSUNITS (read with the I/O worker). */
  units(file: Blob): Promise<number>;
  /** The file found: the app keeps it, so the attach loads the xref from it. */
  found(source: XrefSource): void;
  /** The drawing's own file name, which it cannot reference. */
  readonly self?: string;
}

const DRAWING = /\.(dxf|dwg)$/i;

/**
 * The reply to -XREF Attach's `xrefFile`: the drawing file `file` names (folders and enclosing
 * quotes aside, any case; without an extension a .dxf or .dwg of that name), the first held in
 * `places` in order, with its INSUNITS; no file when none is held.
 */
export async function xrefFileReply(
  file: string,
  places: readonly XrefFilePlace[],
  env: XrefFileEnv,
): Promise<ViewReply> {
  const typed = (
    file
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .split(/[\\/]/)
      .pop() ?? ''
  ).toUpperCase();
  const matches = (name: string) =>
    DRAWING.test(name) &&
    (name.toUpperCase() === typed || name.replace(DRAWING, '').toUpperCase() === typed);
  for (const place of places) {
    const source = (await place()).find((s) => matches(s.name));
    if (!source) continue;
    if (env.self !== undefined && source.name.toUpperCase() === env.self.toUpperCase())
      return {
        ok: false,
        message: `${source.name} is this drawing: a drawing cannot reference itself.`,
      };
    try {
      const units = await env.units(await source.getFile());
      env.found(source);
      return { ok: true, xrefFile: { fileName: source.name, units } };
    } catch (e) {
      return { ok: false, message: `${source.name} could not be read: ${reason(e)}` };
    }
  }
  return { ok: true };
}
