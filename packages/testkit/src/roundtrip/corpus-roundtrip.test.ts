// The round-trip suite over the public corpus (docs/TESTING.md §1, §3; roadmap M0-05).
// Writes a per-file report to test-reports/roundtrip/ (not test-results/, which Playwright wipes) and holds every file to the committed
// baseline: a file may get better, never worse. Since M1-05 the save is Triya's own export
// (map → DocumentModel → exportDocument from the retained original), and every file that reads
// must come back with zero differences.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest, UNREADABLE_TAG } from '../corpus/manifest.ts';
import {
  compareToHandleBaseline,
  toHandleBaseline,
  type HandleBaseline,
  type HandleRun,
} from './handle-coverage.ts';
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
const handleBaselinePath = `${corpusDir}handle-coverage-baseline.json`;
const updateBaseline = process.env['TRIYA_UPDATE_BASELINE'] === '1';

describe('public corpus round-trip', () => {
  const manifest = loadManifest(`${corpusDir}corpus.json`);
  const runs: FileRoundTrip[] = [];
  const handleRuns = (): HandleRun[] =>
    runs.map(({ file, result }) =>
      result.handles
        ? { path: file.path, coverage: result.handles }
        : { path: file.path, unscanned: result.handlesError ?? result.status },
    );

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
    if (updateBaseline) {
      writeFileSync(baselinePath, `${JSON.stringify(toBaseline(runs), null, 2)}\n`);
      writeFileSync(
        handleBaselinePath,
        `${JSON.stringify(toHandleBaseline(handleRuns()), null, 2)}\n`,
      );
    }
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

  it('saves every readable corpus file through TriyaToAcad with zero differences (M1-05)', () => {
    expect(runs.length, 'the first test must run first').toBe(manifest.files.length);
    const unclean = runs
      .filter(({ result }) => result.status !== 'clean' && result.status !== 'read-error')
      .map(({ file, result }) => `${file.path}: ${result.status} ${result.error ?? ''}`.trim());
    expect(unclean).toEqual([]);
  });

  // M2-49: every corpus suite filters on the `unreadable` tag (readableFiles), so the tag must
  // name exactly the files acad-ts fails to read: no readable file left out, none let in.
  it('tags exactly the files acad-ts cannot read as unreadable', () => {
    expect(runs.length, 'the first test must run first').toBe(manifest.files.length);
    const failed = runs.filter((r) => r.result.status === 'read-error').map((r) => r.file.path);
    const tagged = manifest.files.filter((f) => f.tags.includes(UNREADABLE_TAG)).map((f) => f.path);
    expect(tagged).toEqual(failed);
  });

  // M1-30: objects acad-ts cannot map are kept raw and written back unchanged. No ratchet: zero
  // losses on every file that opens.
  it('keeps every unknown object, under its handle and with its raw payload', () => {
    expect(runs.length, 'the first test must run first').toBe(manifest.files.length);
    const lost = runs
      .filter((r) => (r.result.rawObjects?.lost.length ?? 0) > 0)
      .map((r) => `${r.file.path}: ${r.result.rawObjects!.lost.join(', ')}`);
    expect(lost).toEqual([]);
    const kept = runs.reduce((n, r) => n + (r.result.rawObjects?.kept ?? 0), 0);
    expect(kept, 'the corpus has unknown objects (view styles, AEC, SUN, …)').toBeGreaterThan(1000);
  });

  // M1-27: every handle the file declares must be in the reopened document. Until M1-31 the
  // known losses are in corpus/handle-coverage-baseline.json; any other lost handle fails.
  it('loses no declared handle beyond corpus/handle-coverage-baseline.json', () => {
    expect(runs.length, 'the first test must run first').toBe(manifest.files.length);
    expect(
      existsSync(handleBaselinePath),
      'run TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip',
    ).toBe(true);
    const baseline = JSON.parse(readFileSync(handleBaselinePath, 'utf8')) as HandleBaseline;
    const comparison = compareToHandleBaseline(handleRuns(), baseline);
    if (comparison.improvements.length > 0 && !updateBaseline) {
      console.info(
        `[handles] ${comparison.improvements.length} handle(s) no longer lost; lock it in with TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip:\n  ${comparison.improvements.slice(0, 50).join('\n  ')}`,
      );
    }
    expect(comparison.added, 'new corpus files need a baseline entry').toEqual([]);
    expect(comparison.regressions).toEqual([]);
    expect(Object.keys(baseline.files).sort()).toEqual(manifest.files.map((f) => f.path).sort());
    // Only files that cannot be read go unscanned; every format the corpus holds is scanned.
    const unscanned = runs.filter((r) => !r.result.handles).map((r) => r.result.status);
    expect(new Set(unscanned)).toEqual(new Set(['read-error']));
  });
});
