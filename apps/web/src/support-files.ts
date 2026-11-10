// The user's plot style tables and linetype files (M2-20 part 2), as AutoCAD's OPTIONS > Files
// lists its Plot Style Table Search Path and support files: dropped on the window or picked in
// Settings, checked when added (parsePlotStyleTable, parseLin), listed with what they hold and
// kept on this device (PRD §9): in the origin-private file system, never uploaded, read back on
// the next visit. The Plot dialog (M2-17 part 3) and the linetype loader (M5-08) look them up
// by file name with `file`.
import { parseLin, parsePlotStyleTable, type PlotStyleTable } from '@triya/render';

/** One kept file, by its name as dropped. */
export interface StoredSupportFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** A kept file that could not be read back or used, and why. */
export interface UnusableFile {
  readonly name: string;
  readonly problem: string;
}

/** Where the files are kept between visits. */
export interface SupportPersistence {
  load(): Promise<{
    readonly files: readonly StoredSupportFile[];
    readonly unreadable: readonly UnusableFile[];
  }>;
  put(file: StoredSupportFile): Promise<void>;
  remove(name: string): Promise<void>;
}

/** What a file holds, for the list and the message on adding it, or why it cannot be used. */
export type Reading =
  { readonly summary: string; readonly notice: string } | { readonly error: string };

/** One kind of support file. */
export interface SupportKind {
  /** The private file system's folder the files are kept in. */
  readonly folder: string;
  readonly accepts: (name: string) => boolean;
  readonly read: (name: string, bytes: Uint8Array) => Reading;
}

export interface SupportFile {
  readonly name: string;
  readonly summary: string;
}

export interface SupportState {
  readonly files: readonly SupportFile[];
  /** Kept files that could not be read back or no longer read as their kind. */
  readonly unreadable: readonly UnusableFile[];
  readonly notice?: string;
  readonly error?: string;
}

/** Names, the first few of them: "A, B, C and 4 more". */
function some(names: readonly string[], max = 8): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

const KIND_NAME = { ctb: 'color-dependent', stb: 'named' } as const;

/**
 * .ctb and .stb files. AutoCAD tells the two kinds apart by the extension, so a file whose
 * contents are the other kind is refused rather than listed where it cannot work.
 */
export const PLOT_STYLE_FILES: SupportKind = {
  folder: 'plotstyles',
  accepts: (name) => /\.(ctb|stb)$/i.test(name),
  read: (name, bytes) => {
    let table: PlotStyleTable;
    try {
      table = parsePlotStyleTable(bytes);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return { error: `${name} is not a plot style table Triya can read (${why}).` };
    }
    const ext = /\.ctb$/i.test(name) ? 'ctb' : 'stb';
    if (table.kind !== ext) {
      return {
        error: `${name} holds a ${KIND_NAME[table.kind]} plot style table, so its name must end in .${table.kind}.`,
      };
    }
    const n = table.styles.length;
    const head =
      table.kind === 'ctb'
        ? `Color-dependent, ${plural(n, 'style')}`
        : `Named, ${plural(n, 'style')} (${some(table.styles.map((s) => s.name))})`;
    return {
      summary: table.description ? `${head}: ${table.description}` : head,
      notice: `Added ${KIND_NAME[table.kind]} plot style table ${name}.`,
    };
  },
};

const tablesRead = new WeakMap<SupportState, ReadonlyMap<string, PlotStyleTable>>();

/**
 * The plot style tables a store keeps, by file name (the Plot dialog's list, M2-17 part 3), read
 * once for each state of the store.
 */
export function plotStyleTablesIn(store: SupportFileStore): ReadonlyMap<string, PlotStyleTable> {
  const state = store.getSnapshot();
  let tables = tablesRead.get(state);
  if (!tables) {
    const read = new Map<string, PlotStyleTable>();
    for (const { name } of state.files) {
      const bytes = store.file(name);
      if (!bytes) continue;
      try {
        read.set(name, parsePlotStyleTable(bytes));
      } catch {
        // Checked when added; a file that no longer reads is listed as unusable instead.
      }
    }
    tables = read;
    tablesRead.set(state, tables);
  }
  return tables;
}

/** .lin files are ANSI text (AutoCAD writes them in the system code page). */
const latin1 = new TextDecoder('windows-1252');

export const LINETYPE_FILES: SupportKind = {
  folder: 'linetypes',
  accepts: (name) => /\.lin$/i.test(name),
  read: (name, bytes) => {
    const file = parseLin(latin1.decode(bytes));
    const names = file.linetypes.map((l) => l.name);
    if (names.length === 0) {
      const why = file.errors[0];
      return {
        error: `${name} holds no linetype${why ? ` (line ${why.line}: ${why.message})` : ''}.`,
      };
    }
    const skipped = file.errors.length ? ` Skipped ${file.errors.length} with errors.` : '';
    return {
      summary: some(names),
      notice: `Added ${plural(names.length, 'linetype')} from ${name}: ${some(names)}.${skipped}`,
    };
  },
};

const KEEP_FAILED = 'could not be kept on this device; it works until the page is closed';

/** AutoCAD file names ignore case, so a file replaces one whose name differs only in case. */
const keyOf = (name: string) => name.toLowerCase();

interface Entry extends StoredSupportFile {
  readonly key: string;
  readonly summary: string;
}

export class SupportFileStore {
  readonly #kind: SupportKind;
  readonly #persistence: SupportPersistence;
  #entries: readonly Entry[] = [];
  #state: SupportState = { files: [], unreadable: [] };
  readonly #listeners = new Set<() => void>();

  constructor(kind: SupportKind, persistence: SupportPersistence) {
    this.#kind = kind;
    this.#persistence = persistence;
  }

  get kind(): SupportKind {
    return this.#kind;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): SupportState => this.#state;

  /** A kept file's bytes by its name, ignoring case. */
  file(name: string): Uint8Array | undefined {
    return this.#entries.find((e) => e.key === keyOf(name))?.bytes;
  }

  /** Reads the files kept by earlier visits. Files added meanwhile win over a kept namesake. */
  async load(): Promise<void> {
    let kept: Awaited<ReturnType<SupportPersistence['load']>>;
    try {
      kept = await this.#persistence.load();
    } catch {
      // No device store in this browser: the files work for the session (add says so).
      return;
    }
    const added = new Set(this.#entries.map((e) => e.key));
    const entries: Entry[] = [];
    const unusable: UnusableFile[] = [];
    for (const f of kept.files) {
      if (added.has(keyOf(f.name))) continue;
      const r = this.#kind.read(f.name, f.bytes);
      if ('error' in r) unusable.push({ name: f.name, problem: r.error });
      else entries.push({ ...f, key: keyOf(f.name), summary: r.summary });
    }
    const unreadable = [...unusable, ...kept.unreadable].filter((u) => !added.has(keyOf(u.name)));
    this.#state = { ...this.#state, unreadable };
    this.#set([...entries, ...this.#entries]);
  }

  async add(name: string, bytes: Uint8Array): Promise<void> {
    const r = this.#kind.read(name, bytes);
    if ('error' in r) {
      this.#update({ error: r.error });
      return;
    }
    const key = keyOf(name);
    const old = this.#entries.find((e) => e.key === key);
    const unreadable = this.#state.unreadable.filter((u) => keyOf(u.name) !== key);
    this.#state = { ...this.#state, unreadable };
    this.#set([
      ...this.#entries.filter((e) => e !== old),
      { name, bytes, key, summary: r.summary },
    ]);
    this.#update({ notice: r.notice });
    try {
      if (old && old.name !== name) await this.#persistence.remove(old.name);
      await this.#persistence.put({ name, bytes });
    } catch {
      this.#update({ error: `${name} ${KEEP_FAILED}.` });
    }
  }

  async remove(name: string): Promise<void> {
    const kept = this.#entries.find((e) => e.key === keyOf(name));
    if (!kept) return;
    this.#set(this.#entries.filter((e) => e !== kept));
    try {
      await this.#persistence.remove(kept.name);
    } catch {
      // Removed for this session; nothing else can be done about the device store.
    }
  }

  dismiss(): void {
    this.#state = { files: this.#state.files, unreadable: this.#state.unreadable };
    this.#emit();
  }

  #set(entries: readonly Entry[]): void {
    this.#entries = [...entries].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    this.#state = {
      ...this.#state,
      files: this.#entries.map((e) => ({ name: e.name, summary: e.summary })),
    };
    this.#emit();
  }

  #update(message: { notice?: string; error?: string }): void {
    this.#state = { files: this.#state.files, unreadable: this.#state.unreadable, ...message };
    this.#emit();
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }
}

/** A directory handle's entries; the DOM typings here lack its async iterator. */
type Listable = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

/** The files in this origin's private file system, in the kind's folder, one file each. */
export function opfsSupportFiles(
  kind: SupportKind,
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): SupportPersistence {
  const folder = async (): Promise<Listable> => {
    if (!storage?.getDirectory) throw new Error('the origin-private file system is unavailable');
    const root = await storage.getDirectory();
    return (await root.getDirectoryHandle(kind.folder, { create: true })) as Listable;
  };
  return {
    load: async () => {
      const files: StoredSupportFile[] = [];
      const unreadable: UnusableFile[] = [];
      for await (const handle of (await folder()).values()) {
        if (handle.kind !== 'file' || !kind.accepts(handle.name)) continue;
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          files.push({ name: handle.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        } catch (e) {
          // One file the browser will not give back does not cost the others.
          const why = e instanceof Error ? e.message : String(e);
          unreadable.push({ name: handle.name, problem: `could not be read (${why})` });
        }
      }
      return { files, unreadable };
    },
    put: async (file) => {
      const handle = await (await folder()).getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    },
    remove: async (name) => {
      await (await folder()).removeEntry(name);
    },
  };
}
