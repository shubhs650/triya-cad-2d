// `pnpm spike:read` (docs/SPIKE_M0_ACAD_TS.md step 2). Data, not a gate: it records what acad-ts
// reads and leaves unmapped. Reports land in test-reports/spike/.
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runSpikeRead } from './run.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

it('reads every public corpus file and reports unmapped types', () => {
  const runs = runSpikeRead({
    corpusDir: `${root}corpus/`,
    reportDir: `${root}test-reports/spike/`,
    writtenDir: `${root}docs/reports/M0-written/`,
  });
  expect(runs.length).toBeGreaterThan(0);
}, 300_000);
