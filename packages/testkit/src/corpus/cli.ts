/**
 * `pnpm corpus:list` and `pnpm corpus:validate` (docs/TESTING.md §9).
 * Runs directly under Node's TypeScript type stripping; no build step.
 *   node packages/testkit/src/corpus/cli.ts list|validate [--private]
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatCorpusList } from './list.ts';
import { loadManifest, validateCorpus } from './manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const [command, ...flags] = process.argv.slice(2);
// The private corpus keeps its own manifest so nothing about it is ever committed.
const manifestPath = flags.includes('--private')
  ? `${corpusDir}private/corpus.json`
  : `${corpusDir}corpus.json`;

if (!existsSync(manifestPath)) {
  console.error(`[corpus] no manifest at ${manifestPath}`);
  process.exit(1);
}

try {
  const manifest = loadManifest(manifestPath);
  if (command === 'list') {
    console.log(formatCorpusList(manifest));
  } else if (command === 'validate') {
    const errors = validateCorpus(manifest, corpusDir);
    for (const e of errors) console.error(`[corpus] ${e}`);
    if (errors.length > 0) {
      console.error(`[corpus] ${errors.length} problem(s) in ${manifestPath}`);
      process.exit(1);
    }
    console.log(`[corpus] ${manifest.files.length} files OK (${manifestPath})`);
  } else {
    console.error('usage: cli.ts list|validate [--private]');
    process.exit(2);
  }
} catch (err) {
  console.error(`[corpus] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
