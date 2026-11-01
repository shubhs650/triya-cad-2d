// The round-trip suite over the public corpus (docs/TESTING.md §1, §3; roadmap M0-05).
// Writes a per-file report to test-reports/roundtrip/ (not test-results/, which Playwright wipes) and holds every file to the committed
// baseline: a file may get better, never worse. At M0 most files have differences; they are
// the acad-ts spike's data (M0-06). The zero-difference gate arrives with M1-05.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const outDir = fileURLToPath(new URL('../../../../test-reports/roundtrip/', import.meta.url));
const baselinePath = `${corpusDir}roundtrip-baseline.json`;
const updateBaseline = process.env['TRIYA_UPDATE_BASELINE'] === '1';

describe('public corpus round-trip', () => {
  const manifest = loadManifest(`${corpusDir}corpus.json`);
  const runs: FileRoundTrip[] = [];

  it('runs open → save → reopen → diff on every corpus file and writes the report', () => {
    for (const file of manifest.files) {
      const result = roundTrip(new Uint8Array(readFileSync(`${corpusDir}${file.path}`)));
      runs.push({ file, result });
    }
    expect(runs).toHaveLength(manifest.files.length);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      `${outDir}report.md`,
      formatRoundTripReport(runs, 'Round-trip report: public corpus'),
    );
    writeFileSync(`${outDir}report.json`, `${JSON.stringify(runs, null, 1)}\n`);
    if (updateBaseline)
      writeFileSync(baselinePath, `${JSON.stringify(toBaseline(runs), null, 2)}\n`);
  }, 300_000);

  it('does not regress against corpus/roundtrip-baseline.json', () => {
    expect(runs.length, 'the previous test must run first').toBe(manifest.files.length);
    expect(existsSync(baselinePath), 'run TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip').toBe(
      true,
    );
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
    const comparison = compareToBaseline(runs, baseline);
    if (comparison.improvements.length > 0 && !updateBaseline) {
      console.info(
        `[roundtrip] ${comparison.improvements.length} file(s) improved; lock it in with TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip:\n  ${comparison.improvements.join('\n  ')}`,
      );
    }
    expect(comparison.added, 'new corpus files need a baseline entry').toEqual([]);
    expect(comparison.regressions).toEqual([]);
    // A baseline entry for a file that left the corpus would hide nothing but is stale.
    expect(Object.keys(baseline.files).sort()).toEqual(manifest.files.map((f) => f.path).sort());
  });
});
