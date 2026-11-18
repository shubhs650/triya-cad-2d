// M2-64: the shard durations come from a CI run's merged Vitest report, whose file names are
// absolute paths in the runner's checkout (/home/runner/work/<repo>/<repo>/…). Refreshing them on
// any other machine must still give repo-relative names, or every file would look new to the
// sequencer and the shards would split by guesses.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { meanTimings, readRuns } from '../../scripts/ci-timings.ts';
import { unrunFiles } from '../../scripts/vitest-every-file.ts';
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

// DEC-075: each CI run's shards split by the mean durations of the last green runs.
describe('meanTimings and readRuns', () => {
  it('averages each file over the runs that list it', () => {
    expect(meanTimings([{ a: 10, b: 1 }, { a: 20 }, { a: 30, c: 2.25 }])).toEqual({
      a: 20,
      b: 1,
      c: 2.3,
    });
    expect(meanTimings([])).toEqual({});
  });

  it('reads each run’s Vitest report and UI shard files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'triya-runs-'));
    const ci = '/home/runner/work/triya-cad-2d/triya-cad-2d';
    const write = (file: string, json: unknown) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), JSON.stringify(json));
    };
    write('101/vitest-results/results.json', {
      testResults: [
        result(`${ci}/packages/io/test/a.test.ts`, 4),
        result(`${ci}/tests/ci/c.test.ts`, 2),
      ],
    });
    write('101/ui-timings-1/ui-1.json', { 'tests/e2e/ui/a.spec.ts': 3 });
    write('101/ui-timings-2/ui-2.json', { 'tests/e2e/ui/b.spec.ts': 5 });
    write('102/vitest-results/results.json', {
      testResults: [
        result(`${ci}/packages/io/test/a.test.ts`, 6),
        result(`${ci}/apps/x.test.ts`, 1),
      ],
    });
    const runs = readRuns(dir, '/home/user/triya-cad-2d');
    expect(runs.ui).toEqual([{ 'tests/e2e/ui/a.spec.ts': 3, 'tests/e2e/ui/b.spec.ts': 5 }]);
    expect(meanTimings(runs.vitest)).toEqual({
      'apps/x.test.ts': 1,
      'packages/io/test/a.test.ts': 5,
      'tests/ci/c.test.ts': 2,
    });
    expect(readRuns(path.join(dir, 'none'), '/x')).toEqual({ vitest: [], ui: [] });
  });
});

// DEC-075: the unit check fails unless the merged report has every file `vitest list` names.
describe('unrunFiles', () => {
  it('names the listed files the merged report has no result for', () => {
    const ci = '/home/runner/work/triya-cad-2d/triya-cad-2d';
    const report = {
      testResults: [result(`${ci}/packages/a.test.ts`, 1), result(`${ci}/tests/b.test.ts`, 1)],
    };
    const root = '/home/user/triya-cad-2d';
    expect(unrunFiles(['packages/a.test.ts', 'tests/b.test.ts'], report, root)).toEqual([]);
    expect(unrunFiles(['tests/c.test.ts', 'packages/a.test.ts'], report, root)).toEqual([
      'tests/c.test.ts',
    ]);
  });
});
