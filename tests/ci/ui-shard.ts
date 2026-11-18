// Duration-balanced shards for the Playwright UI suite in CI (DEC-075).
//
// `playwright test --shard=i/n` cuts a suite into equal counts of test groups, and a UI spec file
// is one group (its tests share the app server it starts), so shards of the same count took from
// 5.3 to 8.8 minutes on one run (2026-11-18). This lists the spec files of shard i/n split by
// recorded duration instead, the way tests/ci/shard.ts splits the Vitest suite: longest first,
// each to the least loaded shard. Every shard lists the same files and reads the same timings, so
// each file runs on exactly one shard.
//
// Durations: tests/ci/ui-timings.json (seconds of test time per file on a CI runner), overlaid in
// CI with TRIYA_UI_TIMINGS, the durations of the last green PR runs that `detect hot-path changes`
// picked for the whole run (written by tests/e2e/timings-reporter.ts, gathered by
// scripts/ci-timings.ts).
//
// Usage (CI): pnpm test:ui $(node --experimental-strip-types tests/ci/ui-shard.ts <i>/<n>)
// prints one file filter per line: each file's path as an anchored regular expression, which is
// how Playwright reads a file argument, so a path matches only itself. Then
// `ui-shard.ts --ran <i>/<n> <timings.json>` fails unless every file of the shard has results.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { balance, overlay, type Timings } from './balance.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
/** The UI project's files: playwright.config.ts `suite('ui')`, testMatch `**\/*.spec.ts`. */
export const UI_DIR = 'tests/e2e/ui';

/** Worker fixture setup (the file's app server) is not in its tests' durations. */
const PER_FILE_S = 1.5;
/** A file the timings do not list yet: about a median UI spec. */
const UNKNOWN_S = 10;

export function uiFileWeight(file: string, timings: Timings): number {
  return (timings[file] ?? UNKNOWN_S) + PER_FILE_S;
}

/** Every UI spec file, repo-relative and `/`-separated, in path order. */
export function uiSpecFiles(root = ROOT): string[] {
  return readdirSync(path.join(root, UI_DIR), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => `${UI_DIR}/${f.split(path.sep).join('/')}`)
    .sort();
}

export function loadUiTimings(fresh = process.env['TRIYA_UI_TIMINGS'], root = ROOT): Timings {
  const committed = JSON.parse(
    readFileSync(path.join(root, 'tests/ci/ui-timings.json'), 'utf8'),
  ) as Timings;
  const measured =
    fresh && existsSync(fresh) ? (JSON.parse(readFileSync(fresh, 'utf8')) as Timings) : undefined;
  return overlay(committed, measured);
}

export function uiShards(files: readonly string[], timings: Timings, count: number): string[][] {
  return balance(files, count, (file) => uiFileWeight(file, timings));
}

/** `file` as a Playwright file filter that matches that path only. */
export function fileFilter(file: string): string {
  return `${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/** Parses `i/n` (1-based); throws on anything else. */
export function parseShard(arg: string | undefined): { index: number; count: number } {
  const m = /^(\d+)\/(\d+)$/.exec(arg ?? '');
  const index = Number(m?.[1]);
  const count = Number(m?.[2]);
  if (!m || index < 1 || index > count) throw new Error(`expected <i>/<n>, got ${arg}`);
  return { index, count };
}

/** Files of `mine` with no test result in `ran` (the shard's timings-reporter output). */
export function unrunFiles(mine: readonly string[], ran: Timings): string[] {
  return mine.filter((f) => ran[f] === undefined);
}

function main(argv: string[]): number {
  // --ran <i>/<n> <timings.json>: after the run, every file of the shard must have results, so
  // a filter that matched nothing (`test:ui` passes with no tests) cannot pass the shard.
  if (argv[0] === '--ran') {
    const { index, count } = parseShard(argv[1]);
    const mine = uiShards(uiSpecFiles(), loadUiTimings(), count)[index - 1]!;
    const out = argv[2];
    const ran = out && existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as Timings) : {};
    const missing = unrunFiles(mine, ran);
    for (const f of missing) console.error(`UI shard ${index}/${count} did not run ${f}`);
    console.log(
      `UI shard ${index}/${count}: ${mine.length - missing.length} of ${mine.length} files ran`,
    );
    return missing.length === 0 ? 0 : 1;
  }
  const { index, count } = parseShard(argv[0]);
  const mine = uiShards(uiSpecFiles(), loadUiTimings(), count)[index - 1]!;
  // An empty list would make `playwright test` run the whole suite.
  if (mine.length === 0) {
    console.error(`UI shard ${index}/${count} has no files`);
    return 1;
  }
  console.log(mine.map(fileFilter).join('\n'));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
