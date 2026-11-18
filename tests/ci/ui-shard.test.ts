// DEC-075: CI's UI shards run the spec files tests/ci/ui-shard.ts lists, split by duration. Every
// UI spec file must run on exactly one shard, a file filter must match that file only, and a
// shard whose files did not all run must fail.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fileFilter,
  loadUiTimings,
  parseShard,
  uiFileWeight,
  uiShards,
  uiSpecFiles,
  unrunFiles,
} from './ui-shard';

describe('uiSpecFiles', () => {
  it('lists every spec file of the UI project, nested ones too, and nothing else', () => {
    const files = uiSpecFiles();
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) expect(f).toMatch(/^tests\/e2e\/ui\/.+\.spec\.ts$/);
    expect(files).toEqual([...files].sort());
    const dir = mkdtempSync(path.join(tmpdir(), 'triya-ui-'));
    const nested = path.join(dir, 'tests/e2e/ui/sub');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'b.spec.ts'), '');
    writeFileSync(path.join(dir, 'tests/e2e/ui/a.spec.ts'), '');
    writeFileSync(path.join(dir, 'tests/e2e/ui/helper.ts'), '');
    expect(uiSpecFiles(dir)).toEqual(['tests/e2e/ui/a.spec.ts', 'tests/e2e/ui/sub/b.spec.ts']);
  });
});

describe('uiShards', () => {
  const files = uiSpecFiles();
  const timings = loadUiTimings('');

  it('puts every UI spec file on exactly one of the three CI shards', () => {
    const shards = uiShards(files, timings, 3);
    expect(shards.flat().sort()).toEqual(files);
    for (const s of shards) expect(s.length).toBeGreaterThan(0);
  });

  it('splits the committed durations evenly', () => {
    const shards = uiShards(files, timings, 3);
    const load = (s: string[]) => s.reduce((sum, f) => sum + uiFileWeight(f, timings), 0);
    const total = load(files);
    const heaviest = Math.max(...files.map((f) => uiFileWeight(f, timings)));
    for (const s of shards)
      expect(load(s)).toBeLessThanOrEqual(Math.max(heaviest, total / 3) * 1.05);
  });

  it('weighs a file the timings do not list yet', () => {
    expect(uiFileWeight('tests/e2e/ui/new.spec.ts', {})).toBeGreaterThan(0);
    expect(uiFileWeight('a', { a: 30 })).toBeGreaterThan(30);
  });

  it('lets the fresh durations of CI runs win over the committed ones', () => {
    const fresh = path.join(mkdtempSync(path.join(tmpdir(), 'triya-ui-')), 'ui.json');
    writeFileSync(fresh, JSON.stringify({ [files[0]!]: 999 }));
    expect(loadUiTimings(fresh)[files[0]!]).toBe(999);
    expect(loadUiTimings(`${fresh}.missing`)).toEqual(timings);
  });
});

describe('fileFilter', () => {
  // Playwright reads a file argument as a regular expression searched in the absolute path.
  const matches = (filter: string, file: string) => new RegExp(filter).test(`/repo/${file}`);

  it('matches its own file only', () => {
    const f = fileFilter('tests/e2e/ui/a.spec.ts');
    expect(matches(f, 'tests/e2e/ui/a.spec.ts')).toBe(true);
    expect(matches(f, 'tests/e2e/ui/ba.spec.ts')).toBe(false);
    expect(matches(f, 'tests/e2e/ui/aXspecXts')).toBe(false);
    expect(matches(f, 'tests/e2e/ui/a.spec.ts.bak')).toBe(false);
  });
});

describe('parseShard and unrunFiles', () => {
  it('reads i/n and refuses anything else', () => {
    expect(parseShard('2/3')).toEqual({ index: 2, count: 3 });
    for (const bad of [undefined, '', '0/3', '4/3', '1', 'a/b']) {
      expect(() => parseShard(bad)).toThrow();
    }
  });

  it('names the files of a shard that have no results', () => {
    expect(unrunFiles(['a', 'b', 'c'], { a: 1, c: 0 })).toEqual(['b']);
    expect(unrunFiles(['a'], {})).toEqual(['a']);
  });
});
