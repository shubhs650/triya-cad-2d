// Which corpus the fidelity suite runs on (M1-106): the public manifest, or the owner's private
// one when `pnpm test:private` sets TRIYA_CORPUS=private (TESTING.md §2.2).
import path from 'node:path';

const CORPUS_DIR = path.join(import.meta.dirname, '../../../corpus');

export const isPrivateRun = (): boolean => process.env['TRIYA_CORPUS'] === 'private';

export function manifestPath(): string {
  if (!isPrivateRun()) return path.join(CORPUS_DIR, 'corpus.json');
  return process.env['TRIYA_PRIVATE_MANIFEST'] ?? path.join(CORPUS_DIR, 'private/corpus.json');
}

/** The folder manifest paths are relative to: `corpus/`, the private manifest's parent. */
export function corpusDir(): string {
  return isPrivateRun() ? path.resolve(path.dirname(manifestPath()), '..') : CORPUS_DIR;
}
