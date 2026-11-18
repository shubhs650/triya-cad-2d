// The linetype files the loader reads (M5-08; AutoCAD 2024 Help, "Load or Reload Linetypes
// Dialog Box"): the bundled set (`BUNDLED_LIN_FILES`, as AutoCAD ships acad.lin and acadiso.lin),
// then the user's .lin files kept on this device (M2-20 part 2, Settings > Linetypes). The engine
// reads no files: -LINETYPE asks the app for a file by name (`linetypeFile`), and the Linetype
// Manager's Load... and the Layer Properties Manager's Select Linetype hand the engine the
// definitions read here.
import type { LinetypeDefinition, ViewReply } from '@triya/engine';
import { BUNDLED_LIN_FILES, parseLin } from '@triya/render';

/** One .lin file the loader offers. */
export interface LinetypeFileSource {
  readonly name: string;
  readonly source: string;
  /** Shipped with Triya, not one of the user's. */
  readonly bundled: boolean;
}

/** What the loader needs of the app: the files, and a .lin file picked from disk kept. */
export interface LinetypeFiles {
  list(): readonly LinetypeFileSource[];
  /** Keeps a picked file with the user's linetype files; its name, or why it was refused. */
  add(name: string, bytes: Uint8Array): Promise<{ name: string } | { error: string }>;
}

/** .lin files are ANSI text (AutoCAD writes them in the system code page). */
const latin1 = new TextDecoder('windows-1252');

/** The user's files as `SupportFileStore` keeps them (by name, bytes on request). */
export interface KeptLinFiles {
  getSnapshot(): { readonly files: readonly { readonly name: string }[] };
  file(name: string): Uint8Array | undefined;
}

/** The bundled files, then the user's (a user's file of a bundled name is listed after it). */
export function linetypeFileSources(kept?: KeptLinFiles): LinetypeFileSource[] {
  const out: LinetypeFileSource[] = BUNDLED_LIN_FILES.map((f) => ({ ...f, bundled: true }));
  for (const { name } of kept?.getSnapshot().files ?? []) {
    const bytes = kept!.file(name);
    if (bytes) out.push({ name, source: latin1.decode(bytes), bundled: false });
  }
  return out;
}

const key = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\.lin$/, '');

/**
 * The file `name` names (ignoring case, `.lin` optional; the user's file winning over a bundled
 * one of the same name), or the first bundled file when `name` is undefined.
 */
export function findLinetypeFile(
  files: readonly LinetypeFileSource[],
  name?: string,
): LinetypeFileSource | undefined {
  if (name === undefined) return files.find((f) => f.bundled);
  const k = key(name);
  const found = files.filter((f) => key(f.name) === k);
  return found.find((f) => !f.bundled) ?? found[0];
}

/** A file's linetypes as the engine loads them; definitions with errors are left out. */
export function linetypesOf(file: LinetypeFileSource): LinetypeDefinition[] {
  return parseLin(file.source).linetypes.map((l) => ({
    name: l.name,
    description: l.description,
    elements: l.elements.map((e) => ({
      length: e.length,
      ...(e.embed && { embed: e.embed }),
    })),
  }));
}

/** The answer to -LINETYPE's `linetypeFile`: the file read, or none when there is no such file. */
export function linetypeFileReply(files: readonly LinetypeFileSource[], name?: string): ViewReply {
  const f = findLinetypeFile(files, name);
  return f ? { ok: true, linetypeFile: { name: f.name, linetypes: linetypesOf(f) } } : { ok: true };
}
