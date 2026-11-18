// Fresh shard timings for one CI run (DEC-075). `detect hot-path changes` picks the artifacts of
// this repository's last green PR runs (at most three) and every shard downloads exactly those,
// so every shard of a run reads the same durations and computes the same split. This script then
// turns them into the files the shard splitters overlay on the committed timings:
//
//   <out>/vitest.json  for tests/ci/shard.ts (TRIYA_VITEST_TIMINGS), from each run's
//                      `vitest-results` (the merged Vitest JSON report)
//   <out>/ui.json      for tests/ci/ui-shard.ts (TRIYA_UI_TIMINGS), from each run's
//                      `ui-timings-<i>` files (tests/e2e/timings-reporter.ts)
//
// A file's seconds are the mean over the runs that have it, which damps one slow runner's swing.
// Both outputs are always written ({} when no run had data), so a shard never depends on whether
// a lookup found anything, only on the artifacts it was handed.
//
// Usage: node --experimental-strip-types scripts/ci-timings.ts <downloads dir> <out dir>
//   <downloads dir>/<run id>/vitest-results/results.json
//   <downloads dir>/<run id>/ui-timings-<i>/*.json
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportTimings, type JsonReport } from './vitest-timings.ts';

type Timings = Record<string, number>;

/** Each file's mean seconds over the runs that list it, one decimal, in path order. */
export function meanTimings(runs: readonly Timings[]): Timings {
  const sums = new Map<string, { total: number; n: number }>();
  for (const run of runs) {
    for (const [file, seconds] of Object.entries(run)) {
      const s = sums.get(file) ?? { total: 0, n: 0 };
      s.total += seconds;
      s.n += 1;
      sums.set(file, s);
    }
  }
  return Object.fromEntries(
    [...sums]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([file, { total, n }]) => [file, Math.round((total / n) * 10) / 10]),
  );
}

const dirs = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

/** Per run: its Vitest durations and its UI durations (either may be absent). */
export function readRuns(downloads: string, root: string): { vitest: Timings[]; ui: Timings[] } {
  const vitest: Timings[] = [];
  const ui: Timings[] = [];
  for (const run of dirs(downloads)) {
    const runDir = path.join(downloads, run);
    const report = path.join(runDir, 'vitest-results', 'results.json');
    if (existsSync(report)) {
      vitest.push(reportTimings(JSON.parse(readFileSync(report, 'utf8')) as JsonReport, root));
    }
    const shards = dirs(runDir).filter((d) => d.startsWith('ui-timings-'));
    if (shards.length > 0) {
      const merged: Timings = {};
      for (const shard of shards) {
        for (const f of readdirSync(path.join(runDir, shard)).filter((x) => x.endsWith('.json'))) {
          Object.assign(merged, JSON.parse(readFileSync(path.join(runDir, shard, f), 'utf8')));
        }
      }
      ui.push(merged);
    }
  }
  return { vitest, ui };
}

function main(argv: string[]): number {
  const [downloads, out] = argv;
  if (!downloads || !out) {
    console.error('usage: ci-timings.ts <downloads dir> <out dir>');
    return 2;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const runs = readRuns(path.resolve(downloads), root);
  mkdirSync(out, { recursive: true });
  for (const [name, list] of [
    ['vitest', runs.vitest],
    ['ui', runs.ui],
  ] as const) {
    const timings = meanTimings(list);
    writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(timings, null, 2)}\n`);
    console.log(`${name}: ${Object.keys(timings).length} files from ${list.length} runs`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
