import { describe, expect, it } from 'vitest';
import {
  compareToBaseline,
  formatRoundTripReport,
  toBaseline,
  type FileRoundTrip,
} from './report.ts';
import type { RoundTripResult, RoundTripStatus } from './roundtrip.ts';

const run = (path: string, status: RoundTripStatus, total = 0, error?: string): FileRoundTrip => {
  const result: RoundTripResult = {
    status,
    format: 'dxf-ascii',
    bytesIn: 10,
    ms: { read: 1 },
    ...(error ? { error } : {}),
    ...(status === 'diff' || status === 'clean'
      ? {
          objectsA: 5,
          objectsB: 5,
          summary: {
            total,
            truncated: false,
            byKind: { value: total },
            byPath: total ? [{ key: 'LINE endPoint.x', count: total }] : [],
          },
        }
      : {}),
  };
  return { file: { path, version: 'AC1032', format: 'dxf-ascii' }, result };
};

describe('round-trip baseline ratchet', () => {
  const baseline = toBaseline([
    run('public/a.dxf', 'diff', 5),
    run('public/b.dxf', 'read-error', 0, 'x'),
  ]);

  it('records status and difference count per file', () => {
    expect(baseline.files).toEqual({
      'public/a.dxf': { status: 'diff', differences: 5 },
      'public/b.dxf': { status: 'read-error', differences: 0 },
    });
  });

  it('flags more differences or a worse status as a regression', () => {
    expect(compareToBaseline([run('public/a.dxf', 'diff', 6)], baseline).regressions).toHaveLength(
      1,
    );
    expect(
      compareToBaseline([run('public/a.dxf', 'write-error', 0, 'boom')], baseline).regressions[0],
    ).toContain('boom');
  });

  it('counts fewer differences or a better status as an improvement', () => {
    const c = compareToBaseline(
      [run('public/a.dxf', 'clean'), run('public/b.dxf', 'diff', 40)],
      baseline,
    );
    expect(c.regressions).toEqual([]);
    expect(c.improvements).toHaveLength(2);
  });

  it('lists files the baseline does not know', () => {
    expect(compareToBaseline([run('public/new.dxf', 'diff', 1)], baseline).added).toEqual([
      'public/new.dxf',
    ]);
  });
});

describe('formatRoundTripReport', () => {
  const md = formatRoundTripReport([
    run('public/third-party/x/a.dxf', 'diff', 3),
    run('public/b.dxf', 'read-error', 0, 'DxfException: bad | table'),
  ]);

  it('summarises statuses and aggregates property paths across files', () => {
    expect(md).toContain('**2 files:** clean 0 · diff 1 · read-error 1');
    expect(md).toContain('| `LINE endPoint.x` | 3 | 1 |');
  });

  it('has one row per file with its status and error, pipes escaped', () => {
    expect(md).toMatch(/\| x\/a\.dxf \| R2018 \| dxf-ascii \| diff \| 3 \| 5 → 5 \|/);
    expect(md).toContain('DxfException: bad \\| table');
  });
});
