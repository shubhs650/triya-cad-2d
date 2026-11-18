// One test per corpus file for a check that sweeps the corpus (TESTING.md §2 "Corpus sweeps").
import { it } from 'vitest';

/**
 * Runs `check` as one test per file, then `total` as one more test for what is summed over all of
 * them (counts, the first problems found). Vitest runs a file's tests in order, one at a time,
 * so `total` sees what every file's test added.
 *
 * Why: a single test that read and drew every corpus file took 20–33 s on a loaded CI shard and
 * ran into Vitest's 30 s test timeout (leaders.corpus.test.ts's GD&T test failed five PR runs on
 * 2026-11-18; text.corpus.test.ts's four sweeps took 21–24 s on a normal run). Per file, each
 * test does a fraction of that, and a growing corpus adds tests instead of stretching one.
 */
export function eachCorpusFile<F extends { readonly path: string }>(
  files: readonly F[],
  check: (file: F) => void,
  total: () => void,
): void {
  for (const f of files) it(f.path, () => check(f));
  it('over every file', total);
}
