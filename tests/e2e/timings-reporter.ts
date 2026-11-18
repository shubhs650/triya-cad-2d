// Records how long each spec file's tests took, for CI's duration-balanced UI shards (DEC-075,
// tests/ci/ui-shard.ts). Active only when TRIYA_PW_TIMINGS names the JSON file to write
// ({ "<repo-relative spec path>": seconds }); CI keeps it as each UI shard's `ui-timings-<i>`
// artifact, and later runs split by the last green runs' files (scripts/ci-timings.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const ROOT = path.join(import.meta.dirname, '../..');

export default class TimingsReporter implements Reporter {
  readonly #out = process.env['TRIYA_PW_TIMINGS'];
  readonly #seconds = new Map<string, number>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = path.relative(ROOT, test.location.file).split(path.sep).join('/');
    this.#seconds.set(file, (this.#seconds.get(file) ?? 0) + result.duration / 1000);
  }

  onEnd(): void {
    if (!this.#out || this.#seconds.size === 0) return;
    const sorted = [...this.#seconds].sort(([a], [b]) => (a < b ? -1 : 1));
    const json = Object.fromEntries(sorted.map(([f, s]) => [f, Math.round(s * 10) / 10]));
    mkdirSync(path.dirname(path.resolve(this.#out)), { recursive: true });
    writeFileSync(path.resolve(this.#out), `${JSON.stringify(json, null, 2)}\n`);
  }

  printsToStdio(): boolean {
    return false;
  }
}
