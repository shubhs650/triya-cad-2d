// M2-64: the shard durations come from a CI run's merged Vitest report, whose file names are
// absolute paths in the runner's checkout (/home/runner/work/<repo>/<repo>/…). Refreshing them on
// any other machine must still give repo-relative names, or every file would look new to the
// sequencer and the shards would split by guesses.
import { describe, expect, it } from 'vitest';
import { blendTimings, reportTimings } from '../../scripts/vitest-timings.ts';

const result = (name: string, seconds: number) => ({ name, startTime: 0, endTime: seconds * 1000 });

describe('reportTimings', () => {
  it('names the files of a report written in another checkout relative to that checkout', () => {
    const ci = '/home/runner/work/triya-cad-2d/triya-cad-2d';
    const timings = reportTimings(
      {
        testResults: [
          result(`${ci}/packages/io/test/a.test.ts`, 12.34),
          result(`${ci}/apps/web/test/b.test.ts`, 0.04),
          result(`${ci}/tests/ci/c.test.ts`, 1),
        ],
      },
      '/home/user/triya-cad-2d',
    );
    expect(timings).toEqual({
      'apps/web/test/b.test.ts': 0,
      'packages/io/test/a.test.ts': 12.3,
      'tests/ci/c.test.ts': 1,
    });
  });

  it('names the files of a report written in this checkout relative to it', () => {
    const root = '/work/repo';
    const timings = reportTimings(
      { testResults: [result(`${root}/packages/io/test/a.test.ts`, 2)] },
      root,
    );
    expect(timings).toEqual({ 'packages/io/test/a.test.ts': 2 });
  });

  it('lists the files in path order', () => {
    const root = '/r';
    const timings = reportTimings(
      { testResults: [result('/r/b/x.test.ts', 1), result('/r/a/y.test.ts', 1)] },
      root,
    );
    expect(Object.keys(timings)).toEqual(['a/y.test.ts', 'b/x.test.ts']);
  });
});

// A file's duration depends on what shares its shard: moved to a lighter shard it runs faster
// (M2-64 measured the third shard at 922 s against the 1 422 s planned). Taking each run's
// numbers as they are would swing the split back and forth, so a refresh averages them with the
// committed ones.
describe('blendTimings', () => {
  it('averages a listed file, takes a new one as measured and drops a removed one', () => {
    expect(blendTimings({ a: 100, b: 3, gone: 9 }, { a: 60, b: 4, fresh: 7 })).toEqual({
      a: 80,
      b: 3.5,
      fresh: 7,
    });
  });
});
