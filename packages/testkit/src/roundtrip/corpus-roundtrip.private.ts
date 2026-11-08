// The round-trip suite over the owner's private corpus (M1-106, TESTING.md §2.2), run only by
// `pnpm test:private` (vitest.private.config.ts) because the drawings are never committed. The
// same open → save → reopen → diff as the public suite: every file that opens must come back
// with zero differences and keep its unknown objects, or, once the owner has locked in a
// baseline with TRIYA_UPDATE_BASELINE=1, do no worse than corpus/private/roundtrip-baseline.json
// (gitignored with the drawings). The per-file report goes to test-reports/roundtrip-private/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import {
  compareToBaseline,
  formatRoundTripReport,
  toBaseline,
  type Baseline,
  type FileRoundTrip,
} from './report.ts';
import { roundTrip } from './roundtrip.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const manifestPath =
  process.env['TRIYA_PRIVATE_MANIFEST'] ?? path.join(root, 'corpus/private/corpus.json');
// Manifest paths are relative to corpus/ and start with private/ (TESTING.md §2.3).
const corpusDir = path.resolve(path.dirname(manifestPath), '..');
const baselinePath = path.join(path.dirname(manifestPath), 'roundtrip-baseline.json');
const outDir = path.join(root, 'test-reports/roundtrip-private');
const updateBaseline = process.env['TRIYA_UPDATE_BASELINE'] === '1';

describe('private corpus round-trip', () => {
  const manifest = loadManifest(manifestPath);
  const runs: FileRoundTrip[] = [];

  it('runs open → save → reopen → diff on every private file and writes the report', () => {
    for (const file of manifest.files) {
      const result = roundTrip(new Uint8Array(readFileSync(path.join(corpusDir, file.path))));
      runs.push({ file, result });
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, 'report.md'),
      formatRoundTripReport(runs, 'Round-trip report: private corpus'),
    );
    if (updateBaseline) {
      writeFileSync(baselinePath, `${JSON.stringify(toBaseline(runs), null, 2)}\n`);
    }
    expect(runs).toHaveLength(manifest.files.length);
  }, 3_600_000);

  it('does no worse than the private baseline, or comes back clean without one', () => {
    expect(runs.length, 'the previous test must run first').toBe(manifest.files.length);
    if (existsSync(baselinePath)) {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
      const comparison = compareToBaseline(runs, baseline);
      expect(
        comparison.added,
        'new private files: TRIYA_UPDATE_BASELINE=1 pnpm test:private',
      ).toEqual([]);
      expect(comparison.regressions).toEqual([]);
      return;
    }
    const unclean = runs
      .filter(({ result }) => result.status !== 'clean')
      .map(({ file, result }) => `${file.path}: ${result.status} ${result.error ?? ''}`.trim());
    expect(unclean).toEqual([]);
  });

  it('keeps every unknown object, under its handle and with its raw payload', () => {
    const lost = runs
      .filter((r) => (r.result.rawObjects?.lost.length ?? 0) > 0)
      .map((r) => `${r.file.path}: ${r.result.rawObjects!.lost.join(', ')}`);
    expect(lost).toEqual([]);
  });
});
