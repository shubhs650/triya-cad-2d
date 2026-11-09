// The browser's side of crash recovery (M2-14, recovery.ts): snapshots in IndexedDB, live pages
// told apart by Web Locks. IndexedDB rather than an OPFS file (ARCHITECTURE.md §13 as built):
// a change log holds what JSON cannot (bigint and byte xdata values), IndexedDB stores the
// structured clone the engine's change sets already cross workers as, and one transaction
// writes a snapshot whole or not at all, so a crash mid-write leaves the previous one.
import type { ChangeSet } from '@triya/engine';
import type { RecoveryEntry, RecoveryInfo, RecoveryPersistence, SessionLocks } from './recovery';
import { closeOnDelete } from './local-data';

const DB = 'triya-recovery';
/** The listing: `RecoveryInfo` rows. */
const DRAWINGS = 'drawings';
/** `{ key, changes }`, rewritten with each snapshot. */
const LOGS = 'logs';
/** `{ key, bytes }`, written once per drawing. */
const SOURCES = 'sources';

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

/** Snapshots in this browser's IndexedDB (database `triya-recovery`). */
export function indexedDbRecovery(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): RecoveryPersistence {
  let db: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('IndexedDB is unavailable'));
    db ??= new Promise((resolve, reject) => {
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => {
        for (const s of [DRAWINGS, LOGS, SOURCES])
          r.result.createObjectStore(s, { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(closeOnDelete(r.result, () => (db = undefined)));
      r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    });
    return db;
  };
  return {
    list: async () => {
      const tx = (await open()).transaction(DRAWINGS, 'readonly');
      return request(tx.objectStore(DRAWINGS).getAll() as IDBRequest<RecoveryInfo[]>);
    },
    put: async (info, changes, bytes) => {
      const tx = (await open()).transaction([DRAWINGS, LOGS, SOURCES], 'readwrite');
      const written = done(tx);
      if (bytes) tx.objectStore(SOURCES).put({ key: info.key, bytes });
      tx.objectStore(LOGS).put({ key: info.key, changes });
      tx.objectStore(DRAWINGS).put(info);
      await written;
    },
    get: async (key) => {
      const tx = (await open()).transaction([DRAWINGS, LOGS, SOURCES], 'readonly');
      const [info, log, source] = await Promise.all([
        request(tx.objectStore(DRAWINGS).get(key) as IDBRequest<RecoveryInfo | undefined>),
        request(tx.objectStore(LOGS).get(key) as IDBRequest<{ changes: ChangeSet[] } | undefined>),
        request(tx.objectStore(SOURCES).get(key) as IDBRequest<{ bytes: Uint8Array } | undefined>),
      ]);
      if (!info || !log || !source) return undefined;
      return { ...info, changes: log.changes, bytes: source.bytes } satisfies RecoveryEntry;
    },
    remove: async (key) => {
      const tx = (await open()).transaction([DRAWINGS, LOGS, SOURCES], 'readwrite');
      const removed = done(tx);
      for (const s of [DRAWINGS, LOGS, SOURCES]) tx.objectStore(s).delete(key);
      await removed;
    },
  };
}

const LOCK_PREFIX = 'triya-session-';

interface LockManagerLike {
  request(name: string, callback: () => Promise<void>): Promise<void>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

/** Live pages by Web Locks: each holds `triya-session-<session>` until it goes. */
export function webLocks(
  locks: LockManagerLike | undefined = (
    globalThis.navigator as { locks?: LockManagerLike } | undefined
  )?.locks,
): SessionLocks {
  return {
    hold: (session) => {
      // Never released: the browser releases it when the page goes, however it goes.
      void locks?.request(LOCK_PREFIX + session, () => new Promise<void>(() => undefined));
    },
    held: async () => {
      if (!locks) return undefined;
      const { held = [] } = await locks.query();
      return new Set(
        held
          .map((l) => l.name ?? '')
          .filter((n) => n.startsWith(LOCK_PREFIX))
          .map((n) => n.slice(LOCK_PREFIX.length)),
      );
    },
  };
}
