// Refreshes tests/ci/vitest-timings.json, the per-file durations CI's Vitest shards split by
// (tests/ci/shard.ts, DEC-053). Input: the JSON report `pnpm test:merge` writes, by default
// test-reports/vitest/results.json; CI keeps it as the `vitest-results` artifact of the
// "lint · typecheck · unit · round-trip" job, so a CI run's own durations can be used:
//
//   gh run download <run id> -n vitest-results -D test-reports/vitest
//   pnpm test:timings
//
// Usage: node --experimental-strip-types scripts/vitest-timings.ts [results.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface JsonReport {
  testResults: { name: string; startTime: number; endTime: number }[];
}

const root = path.resolve(import.meta.dirname, '..');
const input = path.resolve(process.argv[2] ?? path.join(root, 'test-reports/vitest/results.json'));
const output = path.join(root, 'tests/ci/vitest-timings.json');

const report = JSON.parse(readFileSync(input, 'utf8')) as JsonReport;
const timings: Record<string, number> = {};
for (const r of report.testResults) {
  const file = path.relative(root, r.name).split(path.sep).join('/');
  timings[file] = Math.round((r.endTime - r.startTime) / 100) / 10;
}
const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(output, `${JSON.stringify(sorted, null, 2)}\n`);
const total = Object.values(sorted).reduce((s, t) => s + t, 0);
console.log(`${Object.keys(sorted).length} files, ${Math.round(total)} s in all → ${output}`);
