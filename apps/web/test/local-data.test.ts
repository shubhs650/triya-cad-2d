// M2-20: "Clear all local data" (PRD FR-F11, G6; ARCHITECTURE.md §13). Every IndexedDB
// database of the origin (settings, patterns, references, recent drawings, recovery snapshots),
// every file in the origin-private file system (user fonts), the offline caches and the service
// worker go, so the next visit is a first visit.
import { describe, expect, it } from 'vitest';
import { KNOWN_DATABASES, clearLocalData, type LocalDataHost } from '../src/local-data';

function fakeIdb(names: string[], o: { listing?: boolean; blocked?: string[] } = {}) {
  const dbs = new Set(names);
  const idb = {
    dbs,
    ...(o.listing !== false && {
      databases: () => Promise.resolve([...dbs].map((name) => ({ name, version: 1 }))),
    }),
    deleteDatabase(name: string) {
      const r: {
        onsuccess?: () => void;
        onerror?: () => void;
        onblocked?: () => void;
        error: null;
      } = { error: null };
      setTimeout(() => {
        if (o.blocked?.includes(name)) return r.onblocked?.();
        dbs.delete(name);
        r.onsuccess?.();
      });
      return r;
    },
  };
  return idb;
}

function fakeOpfs(entries: string[]) {
  const names = new Set(entries);
  return {
    names,
    storage: {
      getDirectory: () =>
        Promise.resolve({
          async *keys() {
            yield* [...names];
          },
          removeEntry: (name: string, opts?: { recursive?: boolean }) => {
            if (!opts?.recursive) return Promise.reject(new Error('not recursive'));
            names.delete(name);
            return Promise.resolve();
          },
        }),
    },
  };
}

function fakeCaches(keys: string[]) {
  const names = new Set(keys);
  return {
    names,
    keys: () => Promise.resolve([...names]),
    delete: (k: string) => Promise.resolve(names.delete(k)),
  };
}

function fakeWorkers(n: number) {
  const regs = Array.from({ length: n }, () => ({
    gone: false,
    unregister() {
      this.gone = true;
      return Promise.resolve(true);
    },
  }));
  return { regs, getRegistrations: () => Promise.resolve(regs) };
}

describe('clear all local data', () => {
  it('deletes every database, OPFS entry, cache and service worker of the origin', async () => {
    const idb = fakeIdb(['triya-settings', 'triya-recovery', 'triya-recent', 'other']);
    const opfs = fakeOpfs(['fonts', 'stray.bin']);
    const caches = fakeCaches(['triya-offline-abc', 'triya-offline-old']);
    const sw = fakeWorkers(1);
    const host = {
      idb,
      storage: opfs.storage,
      caches,
      serviceWorker: sw,
    } as unknown as LocalDataHost;
    const report = await clearLocalData(host);
    expect(idb.dbs.size).toBe(0);
    expect(opfs.names.size).toBe(0);
    expect(caches.names.size).toBe(0);
    expect(sw.regs.every((r) => r.gone)).toBe(true);
    expect(report.failed).toEqual([]);
    expect(report.cleared).toEqual(
      expect.arrayContaining(['triya-settings', 'other', 'fonts', 'triya-offline-abc']),
    );
  });

  it("deletes the app's own databases by name where the browser cannot list them", async () => {
    const idb = fakeIdb([...KNOWN_DATABASES], { listing: false });
    await clearLocalData({ idb } as unknown as LocalDataHost);
    expect(idb.dbs.size).toBe(0);
    expect(KNOWN_DATABASES).toEqual(
      expect.arrayContaining([
        'triya-settings',
        'triya-patterns',
        'triya-references',
        'triya-recent',
        'triya-recovery',
      ]),
    );
  });

  it('reports a database still held open elsewhere instead of waiting forever', async () => {
    const idb = fakeIdb(['triya-recent', 'triya-settings'], { blocked: ['triya-recent'] });
    const report = await clearLocalData({ idb } as unknown as LocalDataHost, { blockedMs: 20 });
    expect(report.failed).toEqual(['triya-recent']);
    expect(idb.dbs.has('triya-settings')).toBe(false);
  });

  it('a browser without a store skips it', async () => {
    const report = await clearLocalData({});
    expect(report).toEqual({ cleared: [], failed: [] });
  });
});
