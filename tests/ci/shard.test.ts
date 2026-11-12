// DEC-053 (M2-58): CI's Vitest shards split by recorded duration, and each file runs on exactly
// one shard whatever the timings say.
import { describe, expect, it } from 'vitest';
import { balancedShards, fileWeight, loadTimings } from './shard';

const files = (n: number) => Array.from({ length: n }, (_, i) => `packages/x/test/f${i}.test.ts`);

describe('balancedShards', () => {
  it('puts every file on exactly one shard', () => {
    const all = files(50);
    const timings = Object.fromEntries(all.map((f, i) => [f, (i * 37) % 23]));
    for (const count of [1, 2, 3, 4, 7]) {
      const shards = balancedShards(all, timings, count);
      expect(shards).toHaveLength(count);
      expect(shards.flat().sort()).toEqual([...all].sort());
    }
  });

  it('gives the same split whatever order the files come in', () => {
    const all = files(30);
    const timings = Object.fromEntries(all.map((f, i) => [f, i % 5]));
    const a = balancedShards(all, timings, 3);
    const b = balancedShards([...all].reverse(), timings, 3);
    expect(b).toEqual(a);
  });

  it('runs a repeated file once', () => {
    const shards = balancedShards(['a.test.ts', 'a.test.ts', 'b.test.ts'], {}, 2);
    expect(shards.flat().sort()).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('keeps the heaviest file apart and fills the other shards around it', () => {
    const timings = { big: 450, a: 200, b: 150, c: 100, d: 100, e: 50, f: 50 };
    const shards = balancedShards(Object.keys(timings), timings, 3);
    const big = shards.find((s) => s.includes('big'))!;
    expect(big).toEqual(['big']);
  });

  it('guesses files the timings do not list yet, corpus suites as heavy', () => {
    expect(fileWeight('x.corpus.test.ts', {})).toBeGreaterThan(fileWeight('x.test.ts', {}));
    expect(fileWeight('x.test.ts', { 'x.test.ts': 10 })).toBeGreaterThan(10);
  });

  it('rejects a shard count that is not a positive whole number', () => {
    expect(() => balancedShards([], {}, 0)).toThrow();
    expect(() => balancedShards([], {}, 1.5)).toThrow();
  });

  // The committed timings split the suite evenly: no CI shard waits much past the heaviest file
  // or an equal share, whichever is longer (vitest-timings.json is from a CI run).
  it('splits the committed suite timings evenly over three shards', () => {
    const timings = loadTimings();
    const all = Object.keys(timings);
    const shards = balancedShards(all, timings, 3);
    const load = (s: string[]) => s.reduce((sum, f) => sum + fileWeight(f, timings), 0);
    const total = load(all);
    const heaviest = Math.max(...all.map((f) => fileWeight(f, timings)));
    for (const s of shards)
      expect(load(s)).toBeLessThanOrEqual(Math.max(heaviest, total / 3) * 1.05);
  });
});
