// The duration-balanced split behind CI's test shards (DEC-053, DEC-075). Kept free of Vitest and
// Playwright imports so the Vitest sequencer (tests/ci/shard.ts) and the UI suite's shard lister
// (tests/ci/ui-shard.ts, run by plain Node in CI) share one implementation.

export type Timings = Readonly<Record<string, number>>;

/**
 * Splits `files` into `count` groups of similar total `weight`: heaviest file first, each to the
 * lightest group so far (ties: the lower group). Deterministic for a given file set and weights,
 * whatever order the files come in, and every file lands in exactly one group.
 */
export function balance(
  files: readonly string[],
  count: number,
  weight: (file: string) => number,
): string[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count ${count}`);
  const order = [...new Set(files)]
    .map((file) => ({ file, weight: weight(file) }))
    .sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const groups = Array.from({ length: count }, () => ({ files: [] as string[], load: 0 }));
  for (const { file, weight: w } of order) {
    let lightest = groups[0]!;
    for (const g of groups) if (g.load < lightest.load) lightest = g;
    lightest.files.push(file);
    lightest.load += w;
  }
  return groups.map((g) => g.files);
}

/**
 * The committed timings with each file of `fresh` taking its fresh seconds: recent green CI runs'
 * durations (scripts/ci-timings.ts) where CI fetched them, the committed ones for anything else.
 */
export function overlay(committed: Timings, fresh: Timings | undefined): Timings {
  return fresh ? { ...committed, ...fresh } : committed;
}
