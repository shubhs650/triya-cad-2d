// M1-50: the user's .pat files. Adding one keeps its patterns on the device and hands its
// source to the renderers; a file of the same name replaces the old one and moves last, since
// a later file wins on a shared pattern name; a file with no valid pattern is refused.
import { describe, expect, it } from 'vitest';
import {
  PatternStore,
  isPatFile,
  type PatternPersistence,
  type StoredPattern,
} from '../src/patterns';

const GRID = '*MY_GRID, a grid\n0, 0,0, 0,5\n90, 0,0, 0,5\n';
const BRICK = '*MY_BRICK\n0, 0,0, 0,6\n90, 0,0, 6,6, 6,-6\n*MY_STONE\n45, 0,0, 0,4\n';

/** IndexedDB stand-in: what a reload would read back. */
function memory(initial: StoredPattern[] = []): PatternPersistence & { rows: StoredPattern[] } {
  const p = {
    rows: [...initial],
    load: () => Promise.resolve([...p.rows]),
    put: (row: StoredPattern) => {
      p.rows = [...p.rows.filter((r) => r.key !== row.key), row];
      return Promise.resolve();
    },
    remove: (key: string) => {
      p.rows = p.rows.filter((r) => r.key !== key);
      return Promise.resolve();
    },
  };
  return p;
}

const files = (s: PatternStore) => s.getSnapshot().files.map((f) => [f.name, f.patterns]);

describe('PatternStore', () => {
  it('adds a .pat file, lists its patterns and keeps it', async () => {
    const db = memory();
    const s = new PatternStore(db);
    await s.add('grid.pat', GRID);
    expect(files(s)).toEqual([['grid.pat', ['MY_GRID']]]);
    expect(s.sources()).toEqual([GRID]);
    expect(s.getSnapshot().notice).toBe('Added 1 hatch pattern from grid.pat: MY_GRID.');
    expect(db.rows.map((r) => r.name)).toEqual(['grid.pat']);
  });

  it('reads back what an earlier session kept, in the order added', async () => {
    const db = memory();
    const first = new PatternStore(db);
    await first.add('grid.pat', GRID);
    await first.add('brick.pat', BRICK);
    const s = new PatternStore(db);
    await s.load();
    expect(files(s)).toEqual([
      ['grid.pat', ['MY_GRID']],
      ['brick.pat', ['MY_BRICK', 'MY_STONE']],
    ]);
    expect(s.sources()).toEqual([GRID, BRICK]);
  });

  it('replaces a file of the same name, which then wins as the latest', async () => {
    const s = new PatternStore(memory());
    await s.add('grid.pat', GRID);
    await s.add('brick.pat', BRICK);
    const finer = GRID.replaceAll('0,5', '0,2');
    await s.add('GRID.PAT', finer);
    expect(files(s)).toEqual([
      ['brick.pat', ['MY_BRICK', 'MY_STONE']],
      ['GRID.PAT', ['MY_GRID']],
    ]);
    expect(s.sources()).toEqual([BRICK, finer]);
  });

  it('refuses a file with no valid pattern and says why', async () => {
    const db = memory();
    const s = new PatternStore(db);
    await s.add('notes.pat', 'just some text\n');
    expect(files(s)).toEqual([]);
    expect(db.rows).toEqual([]);
    expect(s.getSnapshot().error).toMatch(/^notes\.pat holds no hatch pattern/);
  });

  it('removes a file', async () => {
    const db = memory();
    const s = new PatternStore(db);
    await s.add('grid.pat', GRID);
    await s.remove('grid.pat');
    expect(files(s)).toEqual([]);
    expect(s.sources()).toEqual([]);
    expect(db.rows).toEqual([]);
  });

  it('keeps the same sources array until the files change', async () => {
    const s = new PatternStore(memory());
    await s.add('grid.pat', GRID);
    const before = s.sources();
    s.dismiss();
    expect(s.sources()).toBe(before);
  });

  it('works for the session when the device store is unavailable', async () => {
    const broken: PatternPersistence = {
      load: () => Promise.reject(new Error('no IndexedDB')),
      put: () => Promise.reject(new Error('no IndexedDB')),
      remove: () => Promise.reject(new Error('no IndexedDB')),
    };
    const s = new PatternStore(broken);
    await s.load();
    await s.add('grid.pat', GRID);
    expect(s.sources()).toEqual([GRID]);
    expect(s.getSnapshot().error).toMatch(/could not be kept on this device/);
  });

  it('recognises .pat files by extension', () => {
    expect(isPatFile('acad-like.PAT')).toBe(true);
    expect(isPatFile('drawing.dxf')).toBe(false);
  });
});
