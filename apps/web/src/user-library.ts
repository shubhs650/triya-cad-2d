// The user's library folders (M8-03 part 2): drawing files dropped on the Library palette (or
// added by its Add Drawings... button), kept in folders the user names, their blocks listed,
// previewed and inserted as the library's are (`libraryDrawingBlock`). They stay on this device
// (PRD §9): kept in the origin-private file system, folder `library`, one folder of drawing files
// per library folder, never uploaded, and read back on the next visit. Clear all local data
// removes them with the rest of the file system (local-data.ts).

/** The folder files go to when none is chosen; made when it is needed. */
export const LIBRARY_FOLDER = 'My Library';

/** Drawing files Triya reads: DXF, and DWG (read, never written). */
export const isLibraryDrawing = (name: string): boolean => /\.(dxf|dwg)$/i.test(name);

/** Names that are file names everywhere: Windows refuses these characters. */
const NOT_IN_NAMES = /[\\/:*?"<>|]/;

/** Why `name` cannot be a new library folder among `folders`; undefined when it can. */
export function folderNameProblem(name: string, folders: readonly string[]): string | undefined {
  const n = name.trim();
  if (n === '') return 'Type a name for the folder.';
  if (NOT_IN_NAMES.test(n)) return 'A folder name cannot contain \\ / : * ? " < > |.';
  if (n === '.' || n === '..') return 'A folder name cannot be . or ..';
  if (n.length > 255) return 'A folder name has at most 255 characters.';
  if (folders.some((f) => keyOf(f) === keyOf(n))) return `A folder named ${n} already exists.`;
  return undefined;
}

/** File and folder names ignore case, as on Windows: a file replaces one differing only in case. */
const keyOf = (name: string) => name.toLowerCase();

/** One file of a folder, as the palette lists it. */
export interface LibraryFileRef {
  readonly folder: string;
  readonly name: string;
  /** Changes when the file is replaced: what the palette's reading of it is kept by. */
  readonly key: string;
}

export interface LibraryFolder {
  readonly name: string;
  /** Sorted by name. */
  readonly files: readonly LibraryFileRef[];
}

export interface UserLibraryState {
  /** Sorted by name. */
  readonly folders: readonly LibraryFolder[];
  readonly notice?: string;
  readonly error?: string;
}

/** A file to keep: its name as dropped and its bytes. */
export interface DroppedDrawing {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Where the folders are kept between visits. */
export interface LibraryPersistence {
  load(): Promise<{
    readonly folders: readonly {
      readonly name: string;
      readonly files: readonly DroppedDrawing[];
    }[];
    /** Files there that could not be read back, as `folder/file`, and why. */
    readonly unreadable: readonly { readonly name: string; readonly problem: string }[];
  }>;
  addFolder(name: string): Promise<void>;
  removeFolder(name: string): Promise<void>;
  put(folder: string, file: DroppedDrawing): Promise<void>;
  remove(folder: string, name: string): Promise<void>;
}

const KEEP_FAILED = 'could not be kept on this device; it works until the page is closed';
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export class UserLibraryStore {
  readonly #persistence: LibraryPersistence;
  /** Folder key → its name and files (file key → file). */
  #folders = new Map<string, { name: string; files: Map<string, DroppedDrawing> }>();
  #version = 0;
  #keys = new Map<string, string>();
  #state: UserLibraryState = { folders: [] };
  #loaded: Promise<void> | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(persistence: LibraryPersistence) {
    this.#persistence = persistence;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): UserLibraryState => this.#state;

  /** Reads the folders kept by earlier visits, once. Folders and files added meanwhile win. */
  load(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  async #load(): Promise<void> {
    let kept: Awaited<ReturnType<LibraryPersistence['load']>>;
    try {
      kept = await this.#persistence.load();
    } catch {
      // No device store in this browser: the folders work for the session (add says so).
      return;
    }
    for (const folder of kept.folders) {
      const f = this.#folder(folder.name);
      for (const file of folder.files) {
        if (!f.files.has(keyOf(file.name))) this.#setFile(f.name, f.files, file);
      }
    }
    const problems = kept.unreadable.map((u) => `${u.name} ${u.problem}.`);
    this.#publish(problems.length > 0 ? { error: problems.join(' ') } : {});
  }

  /** The bytes of `folder`'s file `name` (case aside). */
  bytes(folder: string, name: string): Uint8Array | undefined {
    return this.#folders.get(keyOf(folder))?.files.get(keyOf(name))?.bytes;
  }

  /** Makes folder `name`; false, with the reason shown, when it cannot be. */
  async addFolder(name: string): Promise<boolean> {
    const problem = folderNameProblem(
      name,
      [...this.#folders.values()].map((f) => f.name),
    );
    if (problem) {
      this.#publish({ error: problem });
      return false;
    }
    const f = this.#folder(name.trim());
    this.#publish({});
    try {
      await this.#persistence.addFolder(f.name);
    } catch {
      this.#publish({ error: `Folder ${f.name} ${KEEP_FAILED}.` });
    }
    return true;
  }

  async removeFolder(name: string): Promise<void> {
    const f = this.#folders.get(keyOf(name));
    if (!f) return;
    this.#folders.delete(keyOf(name));
    this.#publish({});
    try {
      await this.#persistence.removeFolder(f.name);
    } catch {
      // Removed for this session; nothing else can be done about the device store.
    }
  }

  /**
   * Drawing files join `folder` (made when missing; with none, the first folder, or My Library
   * made); one of a name the folder has replaces it. Other files are refused.
   */
  async add(folder: string | undefined, files: readonly DroppedDrawing[]): Promise<void> {
    const refused = files.filter((f) => !isLibraryDrawing(f.name));
    const drawings = files.filter((f) => isLibraryDrawing(f.name));
    const errors = refused.map((f) => `${f.name} is not a drawing file (DXF or DWG).`);
    if (drawings.length === 0) {
      if (errors.length > 0) this.#publish({ error: errors.join(' ') });
      return;
    }
    const name = folder ?? [...this.#folders.values()].sort(byName)[0]?.name ?? LIBRARY_FOLDER;
    const isNew = !this.#folders.has(keyOf(name));
    const f = this.#folder(name);
    const replaced: string[] = [];
    for (const file of drawings) {
      const old = f.files.get(keyOf(file.name));
      if (old && old.name !== file.name) replaced.push(old.name);
      this.#setFile(f.name, f.files, file);
    }
    const what = drawings.length === 1 ? drawings[0]!.name : `${drawings.length} drawings`;
    this.#publish({
      notice: `Added ${what} to ${f.name}.`,
      ...(errors.length > 0 && { error: errors.join(' ') }),
    });
    const failed: string[] = [];
    try {
      if (isNew) await this.#persistence.addFolder(f.name);
      for (const old of replaced) await this.#persistence.remove(f.name, old);
    } catch {
      failed.push(...drawings.map((d) => d.name));
    }
    if (failed.length === 0) {
      for (const file of drawings) {
        try {
          await this.#persistence.put(f.name, file);
        } catch {
          failed.push(file.name);
        }
      }
    }
    if (failed.length > 0) {
      const which = failed.length === 1 ? failed[0]! : `${failed.length} drawings`;
      this.#publish({ error: [...errors, `${which} ${KEEP_FAILED}.`].join(' ') });
    }
  }

  async remove(folder: string, name: string): Promise<void> {
    const f = this.#folders.get(keyOf(folder));
    const file = f?.files.get(keyOf(name));
    if (!f || !file) return;
    f.files.delete(keyOf(name));
    this.#publish({});
    try {
      await this.#persistence.remove(f.name, file.name);
    } catch {
      // Removed for this session.
    }
  }

  /** Clears the notice and the error. */
  dismiss(): void {
    this.#publish({});
  }

  #folder(name: string) {
    let f = this.#folders.get(keyOf(name));
    if (!f) this.#folders.set(keyOf(name), (f = { name, files: new Map() }));
    return f;
  }

  #setFile(folder: string, files: Map<string, DroppedDrawing>, file: DroppedDrawing): void {
    files.set(keyOf(file.name), file);
    this.#keys.set(`${keyOf(folder)}/${keyOf(file.name)}`, `${++this.#version}`);
  }

  #publish(message: { notice?: string; error?: string }): void {
    const folders = [...this.#folders.values()].sort(byName).map((f) => ({
      name: f.name,
      files: [...f.files.values()].sort(byName).map((file) => {
        const id = `${keyOf(f.name)}/${keyOf(file.name)}`;
        return { folder: f.name, name: file.name, key: `${id}@${this.#keys.get(id)}` };
      }),
    }));
    this.#state = { folders, ...message };
    for (const l of this.#listeners) l();
  }
}

/** Whether every word of `query` is in the block's name, its file's or its folder's (case aside). */
export function userBlockMatches(
  query: string,
  at: { readonly folder: string; readonly file: string; readonly block: string },
): boolean {
  const text = `${at.block} ${at.file} ${at.folder}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
    .every((w) => text.includes(w));
}

/** A directory handle's entries; the DOM typings here lack its async iterator. */
type Listable = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

/** The folders in this origin's private file system, under folder `library`. */
export function opfsLibrary(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): LibraryPersistence {
  const root = async (): Promise<Listable> => {
    if (!storage?.getDirectory) throw new Error('the origin-private file system is unavailable');
    const top = await storage.getDirectory();
    return (await top.getDirectoryHandle('library', { create: true })) as Listable;
  };
  const folder = async (name: string) =>
    (await (await root()).getDirectoryHandle(name, { create: true })) as Listable;
  return {
    load: async () => {
      const folders: { name: string; files: DroppedDrawing[] }[] = [];
      const unreadable: { name: string; problem: string }[] = [];
      for await (const dir of (await root()).values()) {
        if (dir.kind !== 'directory') continue;
        const files: DroppedDrawing[] = [];
        for await (const handle of (dir as Listable).values()) {
          if (handle.kind !== 'file' || !isLibraryDrawing(handle.name)) continue;
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            files.push({ name: handle.name, bytes: new Uint8Array(await file.arrayBuffer()) });
          } catch (e) {
            // One file the browser will not give back does not cost the others.
            const why = e instanceof Error ? e.message : String(e);
            unreadable.push({
              name: `${dir.name}/${handle.name}`,
              problem: `could not be read (${why})`,
            });
          }
        }
        folders.push({ name: dir.name, files });
      }
      return { folders, unreadable };
    },
    addFolder: async (name) => {
      await folder(name);
    },
    removeFolder: async (name) => {
      await (await root()).removeEntry(name, { recursive: true });
    },
    put: async (name, file) => {
      const handle = await (await folder(name)).getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    },
    remove: async (name, file) => {
      await (await folder(name)).removeEntry(file);
    },
  };
}

/** The app's library folders, on this device. */
export const userLibrary = new UserLibraryStore(opfsLibrary());
