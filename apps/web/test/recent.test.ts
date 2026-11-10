// M2-14: recent drawings (PRD FR-F6, ARCHITECTURE.md §13). A drawing opened or saved through a
// file handle is listed, newest first, as AutoCAD's recent documents are; opening one asks for
// read access again (the browser's rule after a reload) and reads the file through its handle,
// so Save still writes in place.
import { describe, expect, it } from 'vitest';
import {
  RECENT_MAX,
  RecentFiles,
  type RecentEntry,
  type RecentHandle,
  type RecentPersistence,
} from '../src/recent';

function handle(
  name: string,
  o: { permission?: 'granted' | 'prompt' | 'denied'; gone?: boolean } = {},
): RecentHandle & { asked: number } {
  const h = {
    kind: 'file' as const,
    name,
    asked: 0,
    getFile: () =>
      o.gone
        ? Promise.reject(
            Object.assign(new Error('A requested file could not be found.'), {
              name: 'NotFoundError',
            }),
          )
        : Promise.resolve(new File(['x'], name)),
    queryPermission: () => Promise.resolve(o.permission ?? 'granted'),
    requestPermission: () => {
      h.asked++;
      return Promise.resolve(o.permission === 'prompt' ? 'granted' : (o.permission ?? 'granted'));
    },
    isSameEntry: (other: RecentHandle) => Promise.resolve(other === h),
  };
  return h;
}

function memory(initial: RecentEntry[] = []) {
  let rows = [...initial];
  const p: RecentPersistence = {
    load: () => Promise.resolve([...rows]),
    save: (list) => {
      rows = [...list];
      return Promise.resolve();
    },
  };
  return { p, rows: () => rows };
}

let t = 0;
const now = () => ++t;

describe('RecentFiles', () => {
  it('lists drawings newest first, once each, at most RECENT_MAX', async () => {
    const mem = memory();
    const r = new RecentFiles(mem.p, now);
    await r.load();
    const a = handle('a.dxf');
    await r.add(a);
    for (let i = 0; i < RECENT_MAX; i++) await r.add(handle(`d${i}.dxf`));
    await r.add(a);
    const names = r.getSnapshot().map((e) => e.name);
    expect(names[0]).toBe('a.dxf');
    expect(names).toHaveLength(RECENT_MAX);
    expect(new Set(names).size).toBe(RECENT_MAX);
    expect(mem.rows().map((e) => e.name)).toEqual(names);
  });

  it('keeps a reloaded list and adds to it', async () => {
    const mem = memory([{ key: 'k1', name: 'old.dxf', handle: handle('old.dxf'), openedAt: 1 }]);
    const r = new RecentFiles(mem.p, now);
    await r.load();
    await r.add(handle('new.dxf'));
    expect(r.getSnapshot().map((e) => e.name)).toEqual(['new.dxf', 'old.dxf']);
  });

  it('opens a drawing through its handle, asking for read access when needed', async () => {
    const h = handle('a.dxf', { permission: 'prompt' });
    const r = new RecentFiles(memory().p, now);
    await r.add(h);
    const got = await r.open(r.getSnapshot()[0]!.key);
    expect(got.ok && got.handle).toBe(h);
    expect(got.ok && (await got.file.text())).toBe('x');
    expect(h.asked).toBe(1);
    // Opening moves it to the top.
    await r.add(handle('b.dxf'));
    await r.open(r.getSnapshot()[1]!.key);
    expect(r.getSnapshot()[0]!.name).toBe('a.dxf');
  });

  it('says why a drawing cannot be opened, and forgets one that is gone', async () => {
    const r = new RecentFiles(memory().p, now);
    await r.add(handle('denied.dxf', { permission: 'denied' }));
    await r.add(handle('gone.dxf', { gone: true }));
    const [gone, denied] = r.getSnapshot();
    expect(await r.open(denied!.key)).toEqual({
      ok: false,
      message: 'denied.dxf was not opened: reading it was not allowed.',
    });
    expect(await r.open(gone!.key)).toEqual({
      ok: false,
      message: 'gone.dxf was not found. It was removed from the recent drawings.',
    });
    expect(r.getSnapshot().map((e) => e.name)).toEqual(['denied.dxf']);
  });

  it('keeps a picture of a listed drawing through reloads and reopening (M2-32)', async () => {
    const mem = memory();
    const r = new RecentFiles(mem.p, now);
    const h = handle('plan.dxf');
    await r.add(h);
    await r.add(handle('other.dxf'));
    const picture = new Blob(['png'], { type: 'image/png' });
    await r.setThumbnail(h, picture);
    expect(r.getSnapshot().find((e) => e.name === 'plan.dxf')?.thumbnail).toBe(picture);
    expect(mem.rows().find((e) => e.name === 'plan.dxf')?.thumbnail).toBe(picture);
    // Opened again, it goes to the top with its picture until a new one is taken.
    await r.add(h);
    expect(r.getSnapshot()[0]).toMatchObject({ name: 'plan.dxf', thumbnail: picture });
    const reloaded = new RecentFiles(memory(mem.rows()).p, now);
    await reloaded.load();
    expect(reloaded.getSnapshot()[0]?.thumbnail).toBe(picture);
  });

  it('takes no picture of a drawing it does not list', async () => {
    const mem = memory();
    const r = new RecentFiles(mem.p, now);
    await r.add(handle('a.dxf'));
    const saved = mem.rows();
    await r.setThumbnail(handle('b.dxf'), new Blob(['png']));
    expect(r.getSnapshot().map((e) => e.thumbnail)).toEqual([undefined]);
    expect(mem.rows()).toBe(saved);
  });

  it('works without a store, for this visit only', async () => {
    const r = new RecentFiles(
      {
        load: () => Promise.reject(new Error('no IndexedDB')),
        save: () => Promise.reject(new Error('no')),
      },
      now,
    );
    await r.load();
    await r.add(handle('a.dxf'));
    expect(r.getSnapshot().map((e) => e.name)).toEqual(['a.dxf']);
  });
});
