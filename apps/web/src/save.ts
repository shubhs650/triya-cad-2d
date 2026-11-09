// Save and Save As (M2-13, PRD FR-F2/FR-F4, DEC-047). Every save writes an AC1032 DXF from the
// bytes the drawing was opened from and the change log its engine applied since; the I/O worker
// does the writing (`saveInWorker`). Where it goes:
// - QSAVE (Ctrl+S) writes in place when the drawing has a file handle for an AC1032 DXF: the
//   file it was opened from, or the one the last Save As wrote. A drawing opened from a DWG or an
//   older DXF, or without a handle, goes to Save As: Triya never overwrites a file in another
//   format.
// - Save As (Ctrl+Shift+S, SAVE, SAVEAS) asks for a `.dxf` name with the File System Access save
//   picker, suggesting the drawing's name with its extension changed (AutoCAD's Save Drawing As;
//   its "Files of type" list holds AutoCAD 2018 DXF only, DEC-047).
// - Without File System Access (Firefox, Safari, PRD §11 degraded mode) both download the file.
// The picker and the permission prompt need the user's gesture, so both come before the save is
// written, while the gesture still counts. The browser's side is save-browser.ts.
import type { ChangeSet } from '@triya/engine';

type Permission = 'granted' | 'denied' | 'prompt';

/** The parts of a File System Access file handle a save uses (not in TypeScript's DOM lib). */
export interface SaveHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<Blob>;
  createWritable?(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<Permission>;
}

/** The file a drawing came from and where Save writes it. */
export interface DrawingFile {
  /** The file as opened: every save starts from it (ARCHITECTURE.md §6.1). */
  readonly bytes: Uint8Array;
  /** The file Save writes in place: the one opened, or the one the last Save As wrote. */
  readonly handle?: SaveHandle;
  /** `handle` is an AC1032 DXF, which Save may overwrite. */
  readonly inPlace: boolean;
}

/** The version every save writes (DEC-047), as the I/O worker's summary names versions. */
export const SAVE_VERSION = 'AC1032';

/** The drawing as opened: a DXF already in the version saves write can be saved over. */
export function drawingFile(
  bytes: Uint8Array,
  summary: { readonly format: string; readonly version: string },
  handle: SaveHandle | undefined,
): DrawingFile {
  const inPlace = summary.format === 'dxf' && summary.version === SAVE_VERSION;
  return { bytes, ...(handle && { handle }), inPlace: inPlace && handle !== undefined };
}

/** The name Save As suggests: the drawing's, as a `.dxf`. */
export function dxfName(name: string): string {
  const base = name.replace(/\.(dwg|dxf|dwt|dws)$/i, '');
  return `${base === '' ? 'Drawing1' : base}.dxf`;
}

export type SaveMode = 'qsave' | 'saveas';

/** What a save needs of the browser and the I/O worker; the app's is `browserSave` (save-browser.ts). */
export interface SaveEnv {
  /** Writes the AC1032 DXF (the I/O worker). */
  write(bytes: Uint8Array, changes: readonly ChangeSet[]): Promise<Uint8Array>;
  /**
   * The save picker, undefined when cancelled; absent without File System Access, when saves
   * download.
   */
  pick?(suggestedName: string): Promise<SaveHandle | undefined>;
  download(name: string, bytes: Uint8Array): void;
}

export type SaveOutcome =
  | { readonly ok: true; readonly name: string; readonly file: DrawingFile }
  | { readonly ok: false; readonly cancelled?: true; readonly message: string };

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Saves the drawing `name`, from `file` with the engine's `changes` (QSAVE or Save As). */
export async function saveDrawing(
  name: string,
  file: DrawingFile,
  changes: readonly ChangeSet[],
  mode: SaveMode,
  env: SaveEnv,
): Promise<SaveOutcome> {
  let target: SaveHandle | undefined;
  if (mode === 'qsave' && file.inPlace && file.handle) {
    target = file.handle;
    if (!(await mayWrite(target))) {
      return { ok: false, message: `${name} was not saved: writing to it was not allowed.` };
    }
  } else if (env.pick) {
    try {
      target = await env.pick(dxfName(name));
    } catch (e) {
      // The picker rejects with AbortError when dismissed.
      if (e instanceof Error && e.name === 'AbortError') target = undefined;
      else return { ok: false, message: `${name} was not saved: ${reason(e)}` };
    }
    if (!target) return { ok: false, cancelled: true, message: 'Save cancelled.' };
  }
  let out: Uint8Array;
  try {
    out = await env.write(file.bytes, changes);
  } catch (e) {
    return { ok: false, message: `${name} was not saved: ${reason(e)}` };
  }
  if (!target) {
    const saved = dxfName(name);
    env.download(saved, out);
    return { ok: true, name: saved, file: { bytes: file.bytes, inPlace: false } };
  }
  try {
    const w = await target.createWritable!();
    await w.write(new Blob([out], { type: 'application/dxf' }));
    await w.close();
  } catch (e) {
    return { ok: false, message: `${target.name} was not saved: ${reason(e)}` };
  }
  return { ok: true, name: target.name, file: { bytes: file.bytes, handle: target, inPlace: true } };
}

/** Asks for write access to a file opened for reading (Chromium asks the user once). */
async function mayWrite(h: SaveHandle): Promise<boolean> {
  if (!h.createWritable) return false;
  if (!h.queryPermission || !h.requestPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}
