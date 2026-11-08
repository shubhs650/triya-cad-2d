// The fidelity reporter (M1-106, TESTING.md §4): collects the `triage.json` each golden-image
// test attaches and, after the run, writes the entity-level report. Always to
// test-reports/fidelity/fidelity-latest.md; for a run that covered the whole public corpus also
// to docs/reports/fidelity-latest.md, which is committed. A private run
// (`pnpm test:private`) writes test-reports/fidelity-private/fidelity-latest.md without file
// names or handles, and never into docs/ (TESTING.md §2.2).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { loadManifest } from '../../../packages/testkit/src/corpus/manifest';
import {
  formatFidelityReport,
  isCompleteRun,
  type FileTriage,
} from '../../../packages/testkit/src/fidelity/triage';
import { isPrivateRun, manifestPath } from './corpus';

const ROOT = path.join(import.meta.dirname, '../../..');

export default class FidelityReporter implements Reporter {
  readonly #files = new Map<string, FileTriage>();

  onTestEnd(_test: TestCase, result: TestResult): void {
    const a = result.attachments.find((x) => x.name === 'triage.json' && x.body);
    if (!a?.body) return;
    const triage = JSON.parse(a.body.toString('utf8')) as FileTriage;
    // A retried test reports again; its last result stands.
    this.#files.set(triage.path, triage);
  }

  onEnd(): void {
    if (this.#files.size === 0) return;
    const files = [...this.#files.values()];
    const priv = isPrivateRun();
    const title = priv ? 'Fidelity report: private corpus' : 'Fidelity report: public corpus';
    const report = formatFidelityReport(files, { title, names: !priv });
    const outDir = path.join(ROOT, 'test-reports', priv ? 'fidelity-private' : 'fidelity');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'fidelity-latest.md'), report);
    if (priv) return;
    const paths = loadManifest(manifestPath()).files.map((f) => f.path);
    if (isCompleteRun(files, paths)) {
      writeFileSync(path.join(ROOT, 'docs/reports/fidelity-latest.md'), report);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
