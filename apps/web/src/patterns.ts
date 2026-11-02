// The user's hatch pattern files (M1-50, PRD FR-A7): .pat files dropped on the window or
// picked in Settings. Their patterns draw hatches saved without their pattern lines, ahead of
// the bundled set, in every open drawing. They stay on this device (PRD §9): kept in IndexedDB,
// never uploaded, and read back on the next visit.
import { parsePat } from '@triya/hatch';

export const isPatFile = (name: string): boolean => /\.pat$/i.test(name);

/** One kept file. `key` is the name in lower case: AutoCAD file names ignore case. */
export interface StoredPattern {
  readonly key: string;
  readonly name: string;
  readonly source: string;
  /** Order added: later files win on a shared pattern name. */
  readonly seq: number;
}

/** Where the files are kept between visits. */
export interface PatternPersistence {
  load(): Promise<readonly StoredPattern[]>;
  put(row: StoredPattern): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PatternFile {
  readonly name: string;
  /** The pattern names it defines, as the file spells them. */
  readonly patterns: readonly string[];
}

export interface PatternState {
  readonly files: readonly PatternFile[];
  readonly notice?: string;
  readonly error?: string;
}

interface Entry extends StoredPattern {
  readonly patterns: readonly string[];
}

const KEEP_FAILED = 'could not be kept on this device; it works until the page is closed';

export class PatternStore {
  readonly #persistence: PatternPersistence;
  #entries: readonly Entry[] = [];
  #sources: readonly string[] = [];
  #state: PatternState = { files: [] };
  #listeners = new Set<() => void>();

  constructor(persistence: PatternPersistence) {
    this.#persistence = persistence;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): PatternState => this.#state;

  /** The kept files' sources in the order added, for `RendererHost.setPatterns`. */
  sources(): readonly string[] {
    return this.#sources;
  }

  /** Reads the files kept by earlier visits. Files added meanwhile stay after them. */
  async load(): Promise<void> {
    let rows: readonly StoredPattern[];
    try {
      rows = await this.#persistence.load();
    } catch {
      return;
    }
    const added = new Set(this.#entries.map((e) => e.key));
    const kept = [...rows]
      .filter((r) => !added.has(r.key))
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({ ...r, patterns: parsePat(r.source).patterns.map((p) => p.name) }));
    this.#set([...kept, ...this.#entries]);
  }

  async add(name: string, source: string): Promise<void> {
    const file = parsePat(source);
    if (file.patterns.length === 0) {
      const why = file.errors[0];
      this.#update({
        error: `${name} holds no hatch pattern${why ? ` (line ${why.line}: ${why.message})` : ''}.`,
      });
      return;
    }
    const key = name.toLowerCase();
    const seq = Math.max(0, ...this.#entries.map((e) => e.seq)) + 1;
    const patterns = file.patterns.map((p) => p.name);
    const row: StoredPattern = { key, name, source, seq };
    this.#set([...this.#entries.filter((e) => e.key !== key), { ...row, patterns }]);
    const n = patterns.length;
    const skipped = file.errors.length ? ` Skipped ${file.errors.length} with errors.` : '';
    this.#update({
      notice: `Added ${n} hatch pattern${n === 1 ? '' : 's'} from ${name}: ${patterns.join(', ')}.${skipped}`,
    });
    try {
      await this.#persistence.put(row);
    } catch {
      this.#update({ error: `${name} ${KEEP_FAILED}.` });
    }
  }

  async remove(name: string): Promise<void> {
    const key = name.toLowerCase();
    this.#set(this.#entries.filter((e) => e.key !== key));
    try {
      await this.#persistence.remove(key);
    } catch {
      // Removed for this session; nothing else can be done about the device store.
    }
  }

  dismiss(): void {
    this.#state = { files: this.#state.files };
    this.#emit();
  }

  #set(entries: readonly Entry[]): void {
    this.#entries = entries;
    this.#sources = entries.map((e) => e.source);
    this.#state = {
      ...this.#state,
      files: entries.map((e) => ({ name: e.name, patterns: e.patterns })),
    };
    this.#emit();
  }

  #update(message: { notice?: string; error?: string }): void {
    this.#state = { files: this.#state.files, ...message };
    this.#emit();
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }
}

const DB = 'triya-patterns';
const STORE = 'files';

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });

/** The files in this browser's IndexedDB (database `triya-patterns`, one row per file). */
export function indexedDbPatterns(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): PatternPersistence {
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
    load: async () => request((await store('readonly')).getAll() as IDBRequest<StoredPattern[]>),
    put: async (row) => {
      await request((await store('readwrite')).put(row));
    },
    remove: async (key) => {
      await request((await store('readwrite')).delete(key));
    },
  };
}
