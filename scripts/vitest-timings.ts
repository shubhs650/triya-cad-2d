// Refreshes tests/ci/vitest-timings.json, the per-file durations CI's Vitest shards split by
// (tests/ci/shard.ts, DEC-053). Input: the JSON report `pnpm test:merge` writes, by default
// test-reports/vitest/results.json; CI keeps it as the `vitest-results` artifact of the
// "lint · typecheck · unit · round-trip" job, so a CI run's own durations can be used:
//
//   gh run download <run id> -n vitest-results -D test-reports/vitest
//   pnpm test:timings
//
// Each file's committed seconds are averaged with the measured ones (`blendTimings`).
//
// Usage: node --experimental-strip-types scripts/vitest-timings.ts [results.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface JsonReport {
  testResults: { name: string; startTime: number; endTime: number }[];
}

/** The directory every name sits in (`/`-separated, no trailing `/`). */
function commonDir(names: readonly string[]): string {
  const parts = names.map((n) => n.split('/').slice(0, -1));
  const first = parts[0] ?? [];
  let n = first.length;
  for (const p of parts) {
    let i = 0;
    while (i < n && p[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join('/');
}

/**
 * Seconds per test file, keyed by repo-relative path in path order. A report written in this
 * checkout is read relative to `root`; one written elsewhere (CI's report names files by their
 * absolute path in the runner's checkout, M2-64) relative to the directory all its files share,
 * which is that checkout's root since the suite spans `apps/`, `packages/` and `tests/`.
 */
export function reportTimings(report: JsonReport, root: string): Record<string, number> {
  const names = report.testResults.map((r) => r.name.split(path.sep).join('/'));
  const local = root.split(path.sep).join('/');
  const base = names.every((n) => n.startsWith(`${local}/`)) ? local : commonDir(names);
  const timings: Record<string, number> = {};
  report.testResults.forEach((r, i) => {
    timings[path.posix.relative(base, names[i]!)] =
      Math.round((r.endTime - r.startTime) / 100) / 10;
  });
  return Object.fromEntries(Object.entries(timings).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * The timings to commit: each file the committed timings list gets the mean of its committed and
 * measured seconds, a new file its measured ones, and a file the report lacks is dropped. A file's
 * duration depends on what shares its shard (M2-64), so averaging damps the swing a refresh would
 * otherwise cause, the split chasing numbers its own previous split produced.
 */
export function blendTimings(
  committed: Readonly<Record<string, number>>,
  measured: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(measured).map(([file, seconds]) => {
      const old = committed[file];
      return [file, old === undefined ? seconds : Math.round((old + seconds) * 5) / 10];
    }),
  );
}

function main(argv: string[]): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const input = path.resolve(argv[0] ?? path.join(root, 'test-reports/vitest/results.json'));
  const output = path.join(root, 'tests/ci/vitest-timings.json');
  const timings = reportTimings(JSON.parse(readFileSync(input, 'utf8')) as JsonReport, root);
  // A name that is no file here means the report came from another tree: keep the old timings.
  const missing = Object.keys(timings).filter((f) => !existsSync(path.join(root, f)));
  if (missing.length > 0) {
    console.error(
      `${missing.length} files of the report are not in this checkout, e.g. ${missing[0]}`,
    );
    return 1;
  }
  const committed = existsSync(output)
    ? (JSON.parse(readFileSync(output, 'utf8')) as Record<string, number>)
    : {};
  const blended = blendTimings(committed, timings);
  writeFileSync(output, `${JSON.stringify(blended, null, 2)}\n`);
  const total = Object.values(blended).reduce((s, t) => s + t, 0);
  console.log(`${Object.keys(blended).length} files, ${Math.round(total)} s in all → ${output}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
