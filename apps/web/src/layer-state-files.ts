// -LAYER stAte Import and EXport (M5-18 part 3): the app's side. AutoCAD 2024 Help, "-LAYER
// (Command)": Import "Loads a previously exported layer state (LAS) file, or layers states from a
// file (DWG, DWS, DWT) into the current drawing"; Export "Saves a selected named layer state to a
// layer state (LAS) file".
//
// A browser opens no path by itself, so Import finds the file by name (folders, enclosing quotes
// and case aside; without an extension a .las, then a drawing of that name) among what the app
// holds: the layer state files kept in Settings (and those exported before), the folders kept for
// references, the drawings open (as saved) and the files that answered xrefs. A .las file answers
// with its states (io `parseLas`), a drawing with the drawing read, whose states the engine takes.
// Export writes the state with io `writeLas`, downloads it as WBLOCK downloads a drawing, and
// keeps it with the layer state files, so a later Import finds it by name.
import { LasError, parseLas, writeLas } from '@triya/io';
import type { DocumentInit, ViewReply, ViewRequest } from '@triya/engine';
import { fileNameOf, type FileSource } from './xrefs';

/** Somewhere the app holds files: those it holds there, listed when asked. */
export type LayerStateFilePlace = () => readonly FileSource[] | Promise<readonly FileSource[]>;

export interface LayerStateFileEnv {
  /** A drawing file read (the I/O worker). */
  open(file: Blob): Promise<{ readonly init: DocumentInit }>;
}

const LAS = /\.las$/i;
const DRAWING = /\.(dxf|dwg|dws|dwt)$/i;
const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The file name typed, without folders or enclosing quotes, in capitals. */
function typedName(file: string): string {
  return fileNameOf(file.trim().replace(/^"(.*)"$/, '$1')).toUpperCase();
}

/**
 * The reply to `layerStateFile`: the first file of `places` that `file` names, a .las before a
 * drawing, read; no `layerStateFile` when none is held.
 */
export async function layerStateFileReply(
  file: string,
  places: readonly LayerStateFilePlace[],
  env: LayerStateFileEnv,
): Promise<ViewReply> {
  const typed = typedName(file);
  const named = (kind: RegExp) => (name: string) =>
    kind.test(name) &&
    (name.toUpperCase() === typed || name.replace(kind, '').toUpperCase() === typed);
  for (const kind of [LAS, DRAWING]) {
    for (const place of places) {
      const source = (await place()).find((s) => named(kind)(s.name));
      if (source) return read(source, kind === LAS, env);
    }
  }
  return { ok: true };
}

async function read(source: FileSource, las: boolean, env: LayerStateFileEnv): Promise<ViewReply> {
  try {
    const blob = await source.getFile();
    if (!las) {
      const { init } = await env.open(blob);
      return { ok: true, layerStateFile: { name: source.name, drawing: init } };
    }
    const states = parseLas(await blob.text());
    return { ok: true, layerStateFile: { name: source.name, states } };
  } catch (e) {
    const why = e instanceof LasError ? e.message : reason(e);
    return { ok: false, message: `${source.name} could not be read: ${why}` };
  }
}

export interface LayerStateWriteEnv {
  download(name: string, bytes: Uint8Array): void;
  /** Keeps the file with the layer state files (Settings). */
  keep(name: string, bytes: Uint8Array): Promise<void>;
}

/** No tables: an exported state names its layers and linetypes itself (`fileLayerState`). */
const NO_TABLES = { tables: { layers: new Map(), linetypes: new Map() } };

/** The reply to `writeLayerState`: the state written as a .las file, downloaded and kept. */
export async function writeLayerStateFile(
  r: Extract<ViewRequest, { op: 'writeLayerState' }>,
  env: LayerStateWriteEnv,
): Promise<ViewReply> {
  const name = fileNameOf(r.file);
  const bytes = new TextEncoder().encode(writeLas(NO_TABLES, r.state));
  env.download(name, bytes);
  await env.keep(name, bytes);
  return { ok: true, file: name };
}
