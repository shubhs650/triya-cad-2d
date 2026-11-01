/**
 * Failure taxonomy for the acad-ts spike (roadmap M0-06): every round-trip difference and read
 * problem is put in one category, then grouped by the object type and field that carries it, which
 * is the unit a patch fixes.
 */
import type { Difference } from '../roundtrip/diff.ts';
import type { FileRoundTrip } from '../roundtrip/report.ts';
import type { SpikeReadResult } from './read.ts';

export type FailureCategory =
  | 'parse-error'
  | 'entity-not-mapped'
  | 'writer-error'
  | 'dropped-by-writer'
  | 'added-on-reopen'
  | 'header-loss'
  | 'property-loss';

export const CATEGORY_LABELS: Record<FailureCategory, string> = {
  'parse-error': 'Parse error (file does not open, or its written copy does not reopen)',
  'entity-not-mapped': 'Entity/object not mapped (kept only as unknown/proxy on read)',
  'writer-error': 'Writer error (save throws)',
  'dropped-by-writer': 'Object dropped by the writer (in the original, missing after reopen)',
  'added-on-reopen': 'Object added on reopen (reader recreates something the writer dropped)',
  'header-loss': 'Header variable lost or changed',
  'property-loss': 'Object property lost or changed',
};

export function categorize(d: Difference): FailureCategory {
  if (d.kind === 'missing') return 'dropped-by-writer';
  if (d.kind === 'added') return 'added-on-reopen';
  return d.objectName === 'HEADER' ? 'header-loss' : 'property-loss';
}

/** `OBJECTNAME field` with indices folded and only the first path segment: one patch's scope. */
export function rootKey(d: Difference): string {
  if (d.kind === 'missing' || d.kind === 'added') return d.objectName;
  const field = d.path.replace(/\[[^\]]*\]/g, '[]').split('.')[0]!;
  return `${d.objectName} ${field}`;
}

export interface TaxonomyRow {
  category: FailureCategory;
  key: string;
  count: number;
  files: number;
}

export interface Taxonomy {
  byCategory: Record<FailureCategory, { count: number; files: number }>;
  rows: TaxonomyRow[];
}

export interface SpikeFileRun {
  path: string;
  read: SpikeReadResult;
  roundTrip: FileRoundTrip['result'];
  /** All differences (not only the sample), when the runner kept them. */
  differences: Difference[];
}

export function buildTaxonomy(runs: SpikeFileRun[]): Taxonomy {
  const cats = new Map<FailureCategory, { count: number; files: Set<string> }>();
  const rows = new Map<
    string,
    { category: FailureCategory; key: string; count: number; files: Set<string> }
  >();
  const add = (category: FailureCategory, key: string, path: string, n = 1): void => {
    const c = cats.get(category) ?? { count: 0, files: new Set() };
    c.count += n;
    c.files.add(path);
    cats.set(category, c);
    const id = `${category}\u0000${key}`;
    const r = rows.get(id) ?? { category, key, count: 0, files: new Set() };
    r.count += n;
    r.files.add(path);
    rows.set(id, r);
  };

  for (const run of runs) {
    if (run.read.status === 'error') add('parse-error', `read: ${run.read.error ?? '?'}`, run.path);
    for (const [type, n] of Object.entries(run.read.unmapped))
      add('entity-not-mapped', type, run.path, n);
    const status = run.roundTrip.status;
    if (status === 'write-error') add('writer-error', run.roundTrip.error ?? '?', run.path);
    if (status === 'reread-error')
      add('parse-error', `reopen: ${run.roundTrip.error ?? '?'}`, run.path);
    for (const d of run.differences) add(categorize(d), rootKey(d), run.path);
  }

  const order = Object.keys(CATEGORY_LABELS) as FailureCategory[];
  const byCategory = Object.fromEntries(
    order.map((c) => [c, { count: cats.get(c)?.count ?? 0, files: cats.get(c)?.files.size ?? 0 }]),
  ) as Taxonomy['byCategory'];
  return {
    byCategory,
    rows: [...rows.values()]
      .map(({ category, key, count, files }) => ({ category, key, count, files: files.size }))
      .sort((a, b) => b.files - a.files || b.count - a.count || a.key.localeCompare(b.key)),
  };
}
