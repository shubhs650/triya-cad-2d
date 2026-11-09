// "Clear all local data" (M2-20; PRD FR-F11 and G6, ARCHITECTURE.md §13): everything the app
// keeps on the device goes, so the next visit is a first visit. That is every IndexedDB
// database of the origin (settings, hatch patterns, reference files, recent drawings and the
// recovery snapshots), every entry of the origin-private file system (user fonts), the offline
// caches and the service worker that fills them. The origin is the app's alone, so whatever
// it holds is the app's.

/** The databases the app opens, deleted by name where `indexedDB.databases()` is missing. */
export const KNOWN_DATABASES = [
  'triya-settings',
  'triya-patterns',
  'triya-references',
  'triya-recent',
  'triya-recovery',
] as const;

/** How long a deletion may wait on a connection another tab keeps open. */
const BLOCKED_MS = 5000;

interface DirectoryLike {
  keys(): AsyncIterable<string>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** The browser's stores, injected so the clearing runs in Node tests. */
export interface LocalDataHost {
  readonly idb?: Pick<IDBFactory, 'deleteDatabase'> & {
    databases?: () => Promise<{ name?: string }[]>;
  };
  readonly storage?: { getDirectory?: () => Promise<unknown> };
  readonly caches?: Pick<CacheStorage, 'keys' | 'delete'>;
  readonly serviceWorker?: {
    getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]>;
  };
  readonly webStorage?: readonly Pick<Storage, 'clear'>[];
}

export function browserLocalData(): LocalDataHost {
  const g = globalThis as Partial<typeof globalThis>;
  return {
    ...(g.indexedDB && { idb: g.indexedDB }),
    ...(g.navigator?.storage && { storage: g.navigator.storage }),
    ...(g.caches && { caches: g.caches }),
    ...(g.navigator?.serviceWorker && { serviceWorker: g.navigator.serviceWorker }),
    webStorage: [g.localStorage, g.sessionStorage].filter((s): s is Storage => !!s),
  };
}

export interface ClearReport {
  /** What was deleted: database, file system entry and cache names. */
  readonly cleared: string[];
  /** What could not be: a database another tab keeps open, a store that refused. */
  readonly failed: string[];
}

function deleteDatabase(
  idb: NonNullable<LocalDataHost['idb']>,
  name: string,
  blockedMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const r = idb.deleteDatabase(name);
    let timer: ReturnType<typeof setTimeout> | undefined;
    r.onsuccess = () => {
      clearTimeout(timer);
      resolve(true);
    };
    r.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    // Every connection this page holds closes on `versionchange` (`closeOnDelete`); one that
    // another tab holds may not, and the deletion then waits for it.
    r.onblocked = () => {
      timer ??= setTimeout(() => resolve(false), blockedMs);
    };
  });
}

/** Deletes everything the app keeps on this device. */
export async function clearLocalData(
  host: LocalDataHost,
  options: { blockedMs?: number } = {},
): Promise<ClearReport> {
  const cleared: string[] = [];
  const failed: string[] = [];
  const attempt = async (name: string, run: () => Promise<boolean | void>) => {
    const ok = await run().catch(() => false);
    (ok === false ? failed : cleared).push(name);
  };
  // The service worker first, so it cannot refill a cache once they are gone.
  if (host.serviceWorker) {
    const regs = await host.serviceWorker.getRegistrations().catch(() => []);
    for (const r of regs) await attempt('service worker', () => r.unregister());
  }
  if (host.caches) {
    for (const key of await host.caches.keys().catch(() => [] as string[]))
      await attempt(key, () => host.caches!.delete(key));
  }
  if (host.idb) {
    const listed = host.idb.databases
      ? await host.idb.databases().catch(() => [] as { name?: string }[])
      : [];
    const names = new Set<string>(KNOWN_DATABASES);
    for (const d of listed) if (d.name) names.add(d.name);
    // Unlisted known names are deleted too (a no-op when they do not exist), but only
    // reported when the browser listed them or cannot list.
    const report = new Set(host.idb.databases ? listed.map((d) => d.name) : names);
    for (const name of names) {
      const ok = await deleteDatabase(host.idb, name, options.blockedMs ?? BLOCKED_MS);
      if (report.has(name)) (ok ? cleared : failed).push(name);
    }
  }
  if (host.storage?.getDirectory) {
    const root = (await host.storage.getDirectory().catch(() => undefined)) as
      DirectoryLike | undefined;
    if (root) {
      const names: string[] = [];
      for await (const name of root.keys()) names.push(name);
      for (const name of names)
        await attempt(name, () => root.removeEntry(name, { recursive: true }));
    }
  }
  for (const s of host.webStorage ?? []) s.clear();
  return { cleared, failed };
}

/**
 * An open database closes when another page or "Clear all local data" deletes it (its
 * `versionchange`), so the deletion is not blocked; the next use opens it afresh.
 */
export function closeOnDelete(db: IDBDatabase, forget: () => void): IDBDatabase {
  db.onversionchange = () => {
    db.close();
    forget();
  };
  return db;
}
