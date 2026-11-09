// M2-14: crash recovery (PRD FR-F5, ARCHITECTURE.md §13). A drawing with unsaved changes is
// written to this device's store 5 s after its last edit, never to its own file: the bytes it
// was opened from once, and its engine's change log each time. A save or a close removes the
// snapshot; one left behind by a page that is gone (no live page holds its session's lock) is
// offered for recovery on the next launch.
import type { ChangeSet, DocumentInit } from '@triya/engine';
import type { OpenResult } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../src/documents';
import {
  AUTOSAVE_DELAY_MS,
  Autosaver,
  RecoveryOffers,
  type RecoveryEntry,
  type RecoveryInfo,
  type RecoveryPersistence,
  type SessionLocks,
} from '../src/recovery';
import type { DrawingFile } from '../src/save';

const BYTES = new Uint8Array([1, 2, 3]);
const FILE: DrawingFile = { bytes: BYTES, inPlace: false };
const opened = {
  init: {} as DocumentInit,
  summary: { format: 'dxf', version: 'AC1032' },
} as unknown as OpenResult;
const change = (n: number): ChangeSet => ({
  header: [{ name: '$LTSCALE', before: n, after: n + 1 }],
});

/** An in-memory store that records what was written, as IndexedDB would keep it. */
function memory() {
  const rows = new Map<string, RecoveryEntry>();
  const log: string[] = [];
  const p: RecoveryPersistence = {
    list: () =>
      Promise.resolve(
        [...rows.values()].map(({ key, session, name, savedAt, edits }) => ({
          key,
          session,
          name,
          savedAt,
          edits,
        })),
      ),
    put: (info, changes, bytes) => {
      const before = rows.get(info.key);
      const kept = bytes ?? before?.bytes;
      if (!kept) return Promise.reject(new Error(`no source for ${info.key}`));
      rows.set(info.key, { ...info, bytes: kept, changes: structuredClone([...changes]) });
      log.push(`put ${info.key} ${changes.length}${bytes ? ' +bytes' : ''}`);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(rows.get(key)),
    remove: (key) => {
      log.push(`remove ${key}`);
      rows.delete(key);
      return Promise.resolve();
    },
  };
  return { p, rows, log };
}

/** Timers run by hand. */
function clock() {
  let now = 1_000;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        pending.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (id: unknown) => void pending.delete(id as number),
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        pending.delete(id);
        t.fn();
      }
    },
    pending: () => pending.size,
  };
}

function setup() {
  const store = new DocumentStore();
  const mem = memory();
  const c = clock();
  const logs = new Map<number, ChangeSet[]>();
  const errors: string[] = [];
  const saver = new Autosaver({
    persistence: mem.p,
    session: 'S1',
    changesOf: (doc) => logs.get(doc) ?? [],
    timers: c.timers,
    now: c.now,
    onError: (m) => errors.push(m),
  });
  store.subscribe(() => saver.update(store.getSnapshot().docs));
  const open = (name: string) => {
    store.startOpening(name);
    const id = store.opened(name, opened, '1F', FILE);
    logs.set(id, []);
    return id;
  };
  const edit = (id: number) => {
    const log = logs.get(id)!;
    log.push(change(log.length));
    store.edited(id);
  };
  return { store, mem, c, saver, open, edit, errors };
}

describe('Autosaver', () => {
  it(`writes a drawing ${AUTOSAVE_DELAY_MS / 1000} s after its last edit, the source once`, async () => {
    const { mem, c, saver, open, edit } = setup();
    const id = open('plan.dxf');
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS - 1);
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS - 1);
    await saver.idle();
    expect(mem.log).toEqual([]);
    c.advance(1);
    await saver.idle();
    expect(mem.log).toEqual([`put S1-${id} 2 +bytes`]);
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS);
    await saver.idle();
    expect(mem.log.at(-1)).toBe(`put S1-${id} 3`);
    const row = mem.rows.get(`S1-${id}`)!;
    expect(row).toMatchObject({ session: 'S1', name: 'plan.dxf', edits: 3, bytes: BYTES });
    expect(row.changes).toHaveLength(3);
    expect(row.savedAt).toBe(c.now());
  });

  it('never writes a drawing without unsaved changes', async () => {
    const { mem, c, saver, store, open } = setup();
    const id = open('plan.dxf');
    store.edited(id, false); // loading an xref changes nothing to save
    c.advance(AUTOSAVE_DELAY_MS * 2);
    await saver.idle();
    expect(mem.log).toEqual([]);
  });

  it('removes the snapshot once a save holds every edit, and starts again on the next', async () => {
    const { mem, c, saver, store, open, edit } = setup();
    const id = open('plan.dxf');
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS);
    await saver.idle();
    store.saved(id, 'plan.dxf', FILE, 1);
    await saver.idle();
    expect(mem.rows.size).toBe(0);
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS);
    await saver.idle();
    // The source went with the snapshot, so it is written again.
    expect(mem.log).toEqual([`put S1-${id} 1 +bytes`, `remove S1-${id}`, `put S1-${id} 2 +bytes`]);
  });

  it('drops a pending write when the drawing is saved or closed first', async () => {
    const { mem, c, saver, store, open, edit } = setup();
    const a = open('a.dxf');
    const b = open('b.dxf');
    edit(a);
    edit(b);
    store.saved(a, 'a.dxf', FILE, 1);
    store.close(b);
    c.advance(AUTOSAVE_DELAY_MS);
    await saver.idle();
    expect(mem.rows.size).toBe(0);
    expect(c.pending()).toBe(0);
  });

  it('removes the snapshot of a closed drawing', async () => {
    const { mem, c, saver, store, open, edit } = setup();
    const id = open('plan.dxf');
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS);
    await saver.idle();
    store.close(id);
    await saver.idle();
    expect(mem.rows.size).toBe(0);
  });

  it('writes everything pending at once when the page goes away', async () => {
    const { mem, saver, open, edit } = setup();
    const id = open('plan.dxf');
    edit(id);
    saver.flush();
    await saver.idle();
    expect(mem.log).toEqual([`put S1-${id} 1 +bytes`]);
  });

  it('writes a recovered drawing at once and then removes the snapshot it came from', async () => {
    const { mem, c, saver, store, open } = setup();
    await mem.p.put(
      { key: 'S0-4', session: 'S0', name: 'plan.dxf', savedAt: 5, edits: 2 },
      [change(0), change(1)],
      BYTES,
    );
    const id = open('plan.dxf');
    // As the app opens one: its log replayed, its edits unsaved.
    store.edited(id);
    store.edited(id);
    saver.recovered(id, 'S0-4');
    c.advance(0);
    await saver.idle();
    expect([...mem.rows.keys()]).toEqual([`S1-${id}`]);
  });

  it('reports a failed write once and keeps trying on later edits', async () => {
    const { c, saver, open, edit, errors, mem } = setup();
    mem.p.put = () => Promise.reject(new Error('quota exceeded'));
    const id = open('plan.dxf');
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS);
    await saver.idle();
    edit(id);
    c.advance(AUTOSAVE_DELAY_MS);
    await saver.idle();
    expect(errors).toEqual(['Autosave of plan.dxf failed: quota exceeded']);
  });
});

describe('RecoveryOffers', () => {
  const info = (key: string, session: string, savedAt: number): RecoveryInfo => ({
    key,
    session,
    name: `${key}.dxf`,
    savedAt,
    edits: 1,
  });
  const locks = (held: string[] | undefined): SessionLocks => ({
    hold: () => undefined,
    held: () => Promise.resolve(held && new Set(held)),
  });

  async function offers(held: string[] | undefined) {
    const mem = memory();
    for (const i of [info('a', 'S0', 10), info('b', 'S2', 30), info('c', 'S1', 20)]) {
      await mem.p.put(i, [change(0)], BYTES);
    }
    const o = new RecoveryOffers(mem.p, locks(held), 'S1');
    await o.load();
    return { o, mem };
  }

  it("offers snapshots of pages that are gone, newest first, never this page's", async () => {
    const { o } = await offers(['S2']);
    expect(o.getSnapshot().map((i) => i.key)).toEqual(['a']);
    const all = await offers(undefined); // no Web Locks: every other page's snapshot
    expect(all.o.getSnapshot().map((i) => i.key)).toEqual(['b', 'a']);
  });

  it('takes an offer with its file and change log, or discards it', async () => {
    const { o, mem } = await offers([]);
    expect(o.getSnapshot().map((i) => i.key)).toEqual(['b', 'a']);
    const taken = await o.take('b');
    expect(taken).toMatchObject({ key: 'b', bytes: BYTES, changes: [change(0)] });
    // Taken, the snapshot stays until the recovered drawing's own is written.
    expect(mem.rows.has('b')).toBe(true);
    await o.discard('a');
    expect(mem.rows.has('a')).toBe(false);
    expect(o.getSnapshot()).toEqual([]);
  });

  it('lists them again for DRAWINGRECOVERY, but not one already recovered (M2-14 part 2)', async () => {
    const { o } = await offers([]);
    await o.take('b');
    expect(o.getSnapshot().map((i) => i.key)).toEqual(['a']);
    // The banner was closed by recovering or discarding; DRAWINGRECOVERY shows it again.
    await o.load();
    expect(o.getSnapshot().map((i) => i.key)).toEqual(['a']);
  });
});
