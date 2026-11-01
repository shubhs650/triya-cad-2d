import type { CorpusManifest } from './manifest.ts';
import { ACAD_VERSIONS, releaseName } from './versions.ts';

const VERSION_ORDER = Object.keys(ACAD_VERSIONS);
const rank = (v: string): number => VERSION_ORDER.indexOf(v);

/** Human-readable table for `pnpm corpus:list`: one row per drawing, then totals. */
export function formatCorpusList(manifest: CorpusManifest): string {
  const files = [...manifest.files].sort(
    (a, b) => rank(a.version) - rank(b.version) || a.path.localeCompare(b.path),
  );
  const rows = files.map((f) => [
    releaseName(f.version) ?? '?',
    f.version,
    f.format,
    f.source,
    f.path,
    f.tags.join(','),
  ]);
  const header = ['RELEASE', 'VERSION', 'FORMAT', 'SOURCE', 'PATH', 'TAGS'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const fmt = (r: string[]): string =>
    r
      .map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();

  const count = (key: (f: (typeof files)[number]) => string): string => {
    const m = new Map<string, number>();
    for (const f of files) m.set(key(f), (m.get(key(f)) ?? 0) + 1);
    return [...m].map(([k, n]) => `${k}: ${n}`).join(' · ');
  };

  return [
    fmt(header),
    ...rows.map(fmt),
    '',
    `${files.length} files`,
    `by release: ${count((f) => releaseName(f.version) ?? f.version)}`,
    `by format:  ${count((f) => f.format)}`,
    `by source:  ${count((f) => f.source)}`,
  ].join('\n');
}
