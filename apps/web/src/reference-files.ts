// The files and folders the user gave the app for a drawing's references (M1-21): kept as file
// system handles in IndexedDB on this device (PRD §9: nothing leaves it), so the next drawing
// that names one of their files, in this session or a later one, is resolved without asking,
// as AutoCAD finds an xref again from its saved path and the support search paths.
//
// The browser decides when a kept handle can be read without the user: Chromium grants it for
// the session it was dropped in, and again later only when the user allows it ("Allow on every
// visit", or a click on Reconnect, which asks). A handle the browser would ask about is not
// read silently; `waiting` counts them for the References palette's Reconnect button.
//
// Browsers without file system handles (Firefox, Safari) give dropped folders as entries
// (`webkitGetAsEntry`), which work for the drop itself and cannot be kept.
import type { FileSource } from './xrefs';

type Permission = 'granted' | 'denied' | 'prompt';

/** The parts of the File System Access API's handles used here (not in TypeScript's DOM lib). */
interface HandleBase {
  readonly name: string;
  queryPermission?(d: { mode: 'read' }): Promise<Permission>;
  requestPermission?(d: { mode: 'read' }): Promise<Permission>;
  isSameEntry?(other: ReferenceHandle): Promise<boolean>;
}
export interface FileHandle extends HandleBase {
  readonly kind: 'file';
  getFile(): Promise<File>;
}
export interface DirectoryHandle extends HandleBase {
  readonly kind: 'directory';
  values(): AsyncIterable<ReferenceHandle>;
}
export type ReferenceHandle = FileHandle | DirectoryHandle;

export interface StoredHandle {
  readonly key: string;
  readonly handle: ReferenceHandle;
}

export interface HandlePersistence {
  load(): Promise<StoredHandle[]>;
  put(row: StoredHandle): Promise<void>;
  remove(key: string): Promise<void>;
}

/** How far into a folder the search goes: AutoCAD looks in the saved folder, not a whole disk. */
const MAX_DEPTH = 3;
const MAX_ENTRIES = 5000;
/** Folders kept; the oldest go first. */
const MAX_FOLDERS = 32;

/** Every file in `dir` and its folders, MAX_DEPTH deep, at most MAX_ENTRIES entries. */
export async function filesInFolder(dir: DirectoryHandle): Promise<FileSource[]> {
  const out: FileSource[] = [];
  let budget = MAX_ENTRIES;
  const walk = async (d: DirectoryHandle, depth: number): Promise<void> => {
    for await (const h of d.values()) {
      if (--budget < 0) return;
      if (h.kind === 'file') out.push({ name: h.name, getFile: () => h.getFile() });
      else if (depth < MAX_DEPTH) await walk(h, depth + 1);
    }
  };
  await walk(dir, 1);
  return out;
}

/** The files of a dropped folder entry (browsers without handles), as `filesInFolder`. */
export async function filesInEntry(dir: FileSystemDirectoryEntry): Promise<FileSource[]> {
  const out: FileSource[] = [];
  let budget = MAX_ENTRIES;
  const entries = (d: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const reader = d.createReader();
      const all: FileSystemEntry[] = [];
      // readEntries hands the folder over in batches until an empty one.
      const next = () =>
        reader.readEntries((batch) => {
          if (batch.length === 0) resolve(all);
          else {
            all.push(...batch);
            next();
          }
        }, reject);
      next();
    });
  const walk = async (d: FileSystemDirectoryEntry, depth: number): Promise<void> => {
    for (const e of await entries(d)) {
      if (--budget < 0) return;
      if (e.isFile) {
        const f = e as FileSystemFileEntry;
        out.push({ name: f.name, getFile: () => new Promise((ok, fail) => f.file(ok, fail)) });
      } else if (depth < MAX_DEPTH) await walk(e as FileSystemDirectoryEntry, depth + 1);
    }
  };
  await walk(dir, 1);
  return out;
}

export class ReferenceFiles {
  readonly #persist: HandlePersistence;
  #rows: StoredHandle[] = [];
  #loaded: Promise<void> | undefined;
  #waiting = 0;
  #serial = 0;
  readonly #listeners = new Set<() => void>();

  constructor(persist: HandlePersistence) {
    this.#persist = persist;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Kept handles the browser would ask about before they can be read again. */
  readonly waiting = (): number => this.#waiting;

  load(): Promise<void> {
    this.#loaded ??= this.#persist.load().then(
      (rows) => {
        // Kept order: files by name, folders by when they were first dropped.
        this.#rows = rows.sort((a, b) => a.key.localeCompare(b.key));
        for (const r of rows)
          this.#serial = Math.max(this.#serial, Number(/^folder:(\d+):/.exec(r.key)?.[1] ?? 0));
      },
      // No IndexedDB (a private window): nothing is kept, drops still work.
      () => {},
    );
    return this.#loaded;
  }

  /**
   * Keeps dropped files and folders. A file is kept under its name (the newest of a name wins,
   * as names are what references are matched by); a folder replaces the same folder kept
   * before.
   */
  async remember(handles: readonly ReferenceHandle[]): Promise<void> {
    await this.load();
    for (const handle of handles) {
      let key = `file:${handle.name.toLowerCase()}`;
      if (handle.kind === 'directory') {
        const folders = this.#rows.filter((r) => r.handle.kind === 'directory');
        const same = await findAsync(folders, (r) => sameEntry(r.handle, handle));
        if (same) key = same.key;
        else {
          key = `folder:${String(++this.#serial).padStart(6, '0')}:${Date.now()}`;
          // The folder kept longest makes room.
          if (folders.length >= MAX_FOLDERS) await this.#forget(folders[0]!.key);
        }
      }
      // Re-kept, a handle moves to the end: the newest drop of a name wins in `files`.
      const row = { key, handle };
      this.#rows = [...this.#rows.filter((r) => r.key !== key), row];
      await this.#persist.put(row).catch(() => {});
    }
  }

  async #forget(key: string): Promise<void> {
    this.#rows = this.#rows.filter((r) => r.key !== key);
    await this.#persist.remove(key).catch(() => {});
  }

  /**
   * Every file the kept handles give without asking the user; with `ask` (a click on
   * Reconnect, which the browser needs for its prompt) the others are asked for first.
   */
  async files(ask = false): Promise<FileSource[]> {
    await this.load();
    const out: FileSource[] = [];
    let waiting = 0;
    for (const { handle } of this.#rows) {
      let state =
        (await handle.queryPermission?.({ mode: 'read' }).catch(() => 'denied')) ?? 'granted';
      if (state === 'prompt' && ask)
        state =
          (await handle.requestPermission?.({ mode: 'read' }).catch(() => 'denied')) ?? 'denied';
      if (state === 'prompt') waiting++;
      if (state !== 'granted') continue;
      try {
        if (handle.kind === 'file')
          out.push({ name: handle.name, getFile: () => handle.getFile() });
        else out.push(...(await filesInFolder(handle)));
      } catch {
        // A folder moved or deleted since: what it held is not found.
      }
    }
    if (waiting !== this.#waiting) {
      this.#waiting = waiting;
      for (const l of this.#listeners) l();
    }
    return out;
  }
}

async function sameEntry(a: ReferenceHandle, b: ReferenceHandle): Promise<boolean> {
  if (a.isSameEntry) return a.isSameEntry(b).catch(() => false);
  return a.name === b.name;
}

async function findAsync<T>(list: readonly T[], f: (t: T) => Promise<boolean>) {
  for (const t of list) if (await f(t)) return t;
  return undefined;
}

const DB = 'triya-references';
const STORE = 'handles';

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });

/** The handles kept in this browser's IndexedDB (handles can be stored there, nowhere else). */
export function indexedDbHandles(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): HandlePersistence {
  let db: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('IndexedDB is unavailable'));
    db ??= new Promise((resolve, reject) => {
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    });
    return db;
  };
  const store = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    load: async () => request((await store('readonly')).getAll() as IDBRequest<StoredHandle[]>),
    put: async (row) => {
      await request((await store('readwrite')).put(row));
    },
    remove: async (key) => {
      await request((await store('readwrite')).delete(key));
    },
  };
}
