// The linetype files the loader reads (M5-08; AutoCAD 2024 Help, "Load or Reload Linetypes
// Dialog Box"): the bundled set (`BUNDLED_LIN_FILES`, as AutoCAD ships acad.lin and acadiso.lin),
// then the user's .lin files kept on this device (M2-20 part 2, Settings > Linetypes). The engine
// reads no files: -LINETYPE asks the app for a file by name (`linetypeFile`), and the Linetype
// Manager's Load... and the Layer Properties Manager's Select Linetype hand the engine the
// definitions read here. -LINETYPE Create (M5-08 part 4) writes a definition into one of the
// user's files (`createLinetype`); the bundled files stay as they ship.
import type { LinetypeDefinition, ViewReply, ViewRequest } from '@triya/engine';
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
  return f
    ? {
        ok: true,
        linetypeFile: {
          name: f.name,
          linetypes: linetypesOf(f),
          ...(f.bundled && { bundled: true }),
        },
      }
    : { ok: true };
}

/** .lin files are ANSI text: a character the code page lacks is written as `?`. */
function ansi(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : 0x3f;
  }
  return out;
}

/** The definition's header name, as parseLin reads it. */
const headerName = (line: string) => {
  const t = line.trim();
  const comma = t.indexOf(',');
  return (comma < 0 ? t.slice(1) : t.slice(1, comma)).trim().toUpperCase();
};

/**
 * `source` with `lines` (a definition) in place of the one named `name` (its header and pattern
 * lines), or appended, in the file's own line endings.
 */
function withDefinition(source: string, name: string, lines: readonly string[]): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const all = source.split(/\r?\n/);
  const at = all.findIndex((l) => l.trim().startsWith('*') && headerName(l) === name.toUpperCase());
  if (at < 0) {
    const body = source === '' || /\n$/.test(source) ? source : source + eol;
    return body + lines.join(eol) + eol;
  }
  // The pattern line is the next line that is not blank or a comment, unless another header.
  let end = at + 1;
  while (end < all.length && (all[end]!.trim() === '' || all[end]!.trim().startsWith(';'))) end++;
  const pattern = end < all.length && !all[end]!.trim().startsWith('*') ? end : at;
  return [...all.slice(0, at), ...lines, ...all.slice(pattern + 1)].join(eol);
}

/**
 * -LINETYPE Create (M5-08 part 4): the definition checked as the loader reads it (AutoCAD Help,
 * "About Custom Linetypes") and written to the user's file `r.file`, a new file (CRLF lines, as
 * AutoCAD writes .lin files) or one kept already, replacing a definition of the same name in
 * place. Answered with the file as written.
 */
export async function createLinetype(
  files: LinetypeFiles,
  r: Extract<ViewRequest, { op: 'linetypeCreate' }>,
): Promise<ViewReply> {
  const lines = [`*${r.name},${r.description}`, r.pattern];
  const check = parseLin(lines.join('\n'));
  if (check.linetypes.length !== 1) {
    const why = check.errors[0]?.message.replace(/^[^:]*: /, '') ?? 'it cannot be read';
    return { ok: false, message: `The linetype pattern is not valid: ${why}.` };
  }
  const found = findLinetypeFile(files.list(), r.file);
  if (found?.bundled)
    return { ok: false, message: `${found.name} is bundled with Triya and cannot be changed.` };
  const name = found?.name ?? r.file;
  const source = found ? withDefinition(found.source, r.name, lines) : lines.join('\r\n') + '\r\n';
  const kept = await files.add(name, ansi(source));
  if ('error' in kept) return { ok: false, message: kept.error };
  const file: LinetypeFileSource = { name: kept.name, source, bundled: false };
  return { ok: true, linetypeFile: { name: kept.name, linetypes: linetypesOf(file) } };
}
