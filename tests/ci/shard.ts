// Duration-balanced Vitest sharding for CI (DEC-053, roadmap M2-58; DEC-075).
//
// CI splits `pnpm test` over several runners with `vitest run --shard=i/n`. Vitest's own sharding
// orders files by a hash of their path and cuts the list into equal counts, which put 1 691 s of
// the 3 212 s suite on one of three shards (one corpus file alone took 450 s). This sequencer
// cuts by recorded duration instead: longest first, each file to the least loaded shard. Every
// shard computes the same split from the same file list, so each file runs on exactly one shard;
// the merged report (`pnpm test:merge`) then checks that all of them passed and applies the
// coverage gates once, over the whole suite.
//
// Durations live in tests/ci/vitest-timings.json (seconds per file on a CI runner). In CI each
// shard also reads TRIYA_VITEST_TIMINGS, the durations of this repository's last green PR runs
// that `detect hot-path changes` picked for the whole run (DEC-075), so files added since the
// committed refresh are weighed by what they took rather than guessed. A stale or missing entry
// only makes the split less even; it can never drop or repeat a file. Refresh the committed file
// with `pnpm test:timings` (TESTING.md §1).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { balance, overlay, type Timings } from './balance.ts';

export type { Timings };

/** Startup cost every file pays (import and collection are not in its recorded duration). */
const PER_FILE_S = 0.5;
/** Guesses for files the timings do not list yet: corpus suites read every corpus drawing. */
const UNKNOWN_CORPUS_S = 60;
const UNKNOWN_S = 2;

export function fileWeight(file: string, timings: Timings): number {
  const known = timings[file];
  if (known !== undefined) return known + PER_FILE_S;
  return (file.endsWith('.corpus.test.ts') ? UNKNOWN_CORPUS_S : UNKNOWN_S) + PER_FILE_S;
}

/**
 * Splits `files` (repo-relative, `/`-separated) into `count` groups of similar total weight:
 * heaviest file first, each to the lightest group so far (ties: the lower group). Deterministic
 * for a given file set, whatever order the files come in.
 */
export function balancedShards(
  files: readonly string[],
  timings: Timings,
  count: number,
): string[][] {
  return balance(files, count, (file) => fileWeight(file, timings));
}

/** The committed durations (tests/ci/vitest-timings.json). */
export function committedTimings(): Timings {
  const file = path.join(import.meta.dirname, 'vitest-timings.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Timings;
}

/** What the shards split by: the committed durations, overlaid with CI's fresh ones if any. */
export function loadTimings(fresh = process.env['TRIYA_VITEST_TIMINGS']): Timings {
  const measured =
    fresh && existsSync(fresh) ? (JSON.parse(readFileSync(fresh, 'utf8')) as Timings) : undefined;
  return overlay(committedTimings(), measured);
}

export default class BalancedSequencer extends BaseSequencer {
  readonly #timings = loadTimings();

  #relative(spec: TestSpecification): string {
    return path.relative(this.ctx.config.root, spec.moduleId).split(path.sep).join('/');
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const groups = balancedShards(
      files.map((f) => this.#relative(f)),
      this.#timings,
      count,
    );
    const mine = new Set(groups[index - 1]);
    return files.filter((f) => mine.has(this.#relative(f)));
  }

  // Within a shard, start the longest files first so no worker is left with a long file at the
  // end. Unsharded runs keep Vitest's own order (failed files first, from its local cache).
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    if (!this.ctx.config.shard) return super.sort(files);
    const weight = (f: TestSpecification) => fileWeight(this.#relative(f), this.#timings);
    return [...files].sort((a, b) => weight(b) - weight(a));
  }
}
