// Checks that the merged Vitest report of CI's unit shards (DEC-053) has a result for every test
// file of the suite, so a shard that split differently from its siblings, or a blob that lost
// files, cannot pass the required unit check with part of the suite unrun (DEC-075).
//
// Usage: node --experimental-strip-types scripts/vitest-every-file.ts <list.json> <results.json>
//   list.json:    `vitest list --filesOnly --json=<list.json>` (every file the config includes)
//   results.json: the merged report `pnpm test:merge` writes
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportTimings, type JsonReport } from './vitest-timings.ts';

/** Files of `listed` (repo-relative) that the report has no result for, in path order. */
export function unrunFiles(listed: readonly string[], report: JsonReport, root: string): string[] {
  const ran = new Set(Object.keys(reportTimings(report, root)));
  return [...new Set(listed)].filter((f) => !ran.has(f)).sort();
}

function main(argv: string[]): number {
  const [listPath, resultsPath] = argv;
  if (!listPath || !resultsPath) {
    console.error('usage: vitest-every-file.ts <list.json> <results.json>');
    return 2;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const listed = (JSON.parse(readFileSync(listPath, 'utf8')) as { file: string }[]).map((e) =>
    path.relative(root, e.file).split(path.sep).join('/'),
  );
  const report = JSON.parse(readFileSync(resultsPath, 'utf8')) as JsonReport;
  const missing = unrunFiles(listed, report, root);
  for (const f of missing) console.error(`not run on any shard: ${f}`);
  console.log(
    `${listed.length - missing.length} of ${listed.length} test files have results in the merged report`,
  );
  return missing.length === 0 && listed.length > 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
