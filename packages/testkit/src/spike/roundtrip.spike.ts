// `pnpm spike:roundtrip` (docs/SPIKE_M0_ACAD_TS.md steps 3 and 7): the failure taxonomy, and the
// written drawings in docs/reports/M0-written/ (gitignored) for the owner's AUDIT sweep (M0-07).
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runSpikeRoundTrip } from './run.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

it('round-trips every public corpus file and writes the taxonomy', () => {
  const runs = runSpikeRoundTrip({
    corpusDir: `${root}corpus/`,
    reportDir: `${root}test-reports/spike/`,
    writtenDir: `${root}docs/reports/M0-written/`,
  });
  expect(runs.length).toBeGreaterThan(0);
}, 600_000);
