// Recent drawings (M2-14, PRD FR-F6, ARCHITECTURE.md §13): the drawings opened or saved through
// a File System Access file handle, newest first, as AutoCAD lists its recent documents. The
// handles are kept in IndexedDB on this device (`indexedDbRecent`), so the list outlives the
// page; opening one asks for read access again (browsers drop it on reload) and reads the file
// through its handle, so Save still writes in place. A file opened without a handle (the file
// input, a drop without File System Access) cannot be opened again by the app, so it is not
// listed.
import { closeOnDelete } from './local-data';

/** The parts of a File System Access file handle the list uses. */
export interface RecentHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  isSameEntry?(other: RecentHandle): Promise<boolean>;
}

export interface RecentEntry {
  readonly key: string;
  readonly name: string;
  readonly handle: RecentHandle;
  /** When it was last opened or saved (ms since 1970). */
  readonly openedAt: number;
}

/** Where the list is kept (IndexedDB in the app). */
export interface RecentPersistence {
  load(): Promise<RecentEntry[]>;
  save(list: readonly RecentEntry[]): Promise<void>;
}

/** AutoCAD's default number of recent documents (Options › Open and Save › File Open). */
export const RECENT_MAX = 9;

export type RecentOpen =
  | { readonly ok: true; readonly file: File; readonly handle: RecentHandle }
  | { readonly ok: false; readonly message: string };

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class RecentFiles {
  readonly #persistence: RecentPersistence;
  readonly #now: () => number;
  #list: readonly RecentEntry[] = [];
  readonly #listeners = new Set<() => void>();
  #next = 0;

  constructor(persistence: RecentPersistence, now: () => number = Date.now) {
    this.#persistence = persistence;
    this.#now = now;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly RecentEntry[] => this.#list;

  /** Reads the list kept by earlier visits; drawings added meanwhile stay on top. */
  async load(): Promise<void> {
    let kept: RecentEntry[];
    try {
      kept = await this.#persistence.load();
    } catch {
      return;
    }
    const merged = [...this.#list];
    for (const e of kept.sort((a, b) => b.openedAt - a.openedAt)) {
      if (!(await this.#find(merged, e.handle))) merged.push(e);
    }
    this.#set(merged.slice(0, RECENT_MAX), false);
  }

  /** A drawing was opened or saved through `handle`: it goes to the top. */
  async add(handle: RecentHandle): Promise<void> {
    const same = await this.#find(this.#list, handle);
    const entry: RecentEntry = {
      key: `${this.#now()}-${this.#next++}`,
      name: handle.name,
      handle,
      openedAt: this.#now(),
    };
    this.#set([entry, ...this.#list.filter((e) => e !== same)].slice(0, RECENT_MAX));
  }

  /**
   * Reads the drawing `key` through its handle, asking for read access first where the
   * browser wants it (the click that asks is the user's gesture). A file that is gone leaves
   * the list.
   */
  async open(key: string): Promise<RecentOpen> {
    const entry = this.#list.find((e) => e.key === key);
    if (!entry) return { ok: false, message: 'That drawing is no longer listed.' };
    const h = entry.handle;
    try {
      if (h.queryPermission && h.requestPermission) {
        const state =
          (await h.queryPermission({ mode: 'read' })) === 'granted'
            ? 'granted'
            : await h.requestPermission({ mode: 'read' });
        if (state !== 'granted') {
          return {
            ok: false,
            message: `${entry.name} was not opened: reading it was not allowed.`,
          };
        }
      }
      const file = await h.getFile();
      await this.add(h);
      return { ok: true, file, handle: h };
    } catch (e) {
      if (e instanceof Error && e.name === 'NotFoundError') {
        this.#set(this.#list.filter((x) => x !== entry));
        return {
          ok: false,
          message: `${entry.name} was not found. It was removed from the recent drawings.`,
        };
      }
      return { ok: false, message: `${entry.name} was not opened: ${reason(e)}` };
    }
  }

  async #find(list: readonly RecentEntry[], h: RecentHandle): Promise<RecentEntry | undefined> {
    for (const e of list) {
      if (e.handle === h) return e;
      if (h.isSameEntry && (await h.isSameEntry(e.handle).catch(() => false))) return e;
    }
    return undefined;
  }

  #set(list: readonly RecentEntry[], persist = true): void {
    this.#list = list;
    for (const l of this.#listeners) l();
    // Without a store the list lasts for this visit.
    if (persist) this.#persistence.save(list).catch(() => undefined);
  }
}

const DB = 'triya-recent';
const STORE = 'files';

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });

/**
 * The list in this browser's IndexedDB (database `triya-recent`, one row per drawing): file
 * handles are structured-cloneable, so they keep there between visits.
 */
export function indexedDbRecent(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): RecentPersistence {
  let db: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('IndexedDB is unavailable'));
    db ??= new Promise((resolve, reject) => {
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
      r.onsuccess = () => resolve(closeOnDelete(r.result, () => (db = undefined)));
      r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    });
    return db;
  };
  return {
    load: async () =>
      request(
        (await open()).transaction(STORE).objectStore(STORE).getAll() as IDBRequest<RecentEntry[]>,
      ),
    save: async (list) => {
      const tx = (await open()).transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const e of list) store.put(e);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      });
    },
  };
}
