/**
 * Per-file round-trip report for a corpus run, and the regression ratchet against the
 * committed baseline (`corpus/roundtrip-baseline.json`).
 */
import type { CorpusFile } from '../corpus/manifest.ts';
import { releaseName } from '../corpus/versions.ts';
import type { RoundTripResult, RoundTripStatus } from './roundtrip.ts';

export interface FileRoundTrip {
  file: Pick<CorpusFile, 'path' | 'version' | 'format'>;
  result: RoundTripResult;
}

/** What the ratchet remembers per file: enough to detect a regression, nothing volatile. */
export interface BaselineEntry {
  status: RoundTripStatus;
  differences: number;
}

export interface Baseline {
  /** Explains the file to whoever opens it. */
  note: string;
  files: Record<string, BaselineEntry>;
}

/** Worst first. A file may only move towards `clean`. */
const STATUS_RANK: Record<RoundTripStatus, number> = {
  'read-error': 4,
  'write-error': 3,
  'reread-error': 2,
  diff: 1,
  clean: 0,
};

export function toBaseline(runs: FileRoundTrip[]): Baseline {
  const files: Record<string, BaselineEntry> = {};
  for (const { file, result } of [...runs].sort((a, b) => a.file.path.localeCompare(b.file.path))) {
    files[file.path] = { status: result.status, differences: result.summary?.total ?? 0 };
  }
  return {
    note: 'Round-trip ratchet (docs/TESTING.md §3). pnpm test fails if a file gets worse than this; regenerate with TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip after an improvement.',
    files,
  };
}

export interface BaselineComparison {
  regressions: string[];
  improvements: string[];
  /** Files in the run that the baseline does not know yet. */
  added: string[];
}

export function compareToBaseline(runs: FileRoundTrip[], baseline: Baseline): BaselineComparison {
  const out: BaselineComparison = { regressions: [], improvements: [], added: [] };
  for (const { file, result } of runs) {
    const before = baseline.files[file.path];
    const now: BaselineEntry = { status: result.status, differences: result.summary?.total ?? 0 };
    if (!before) {
      out.added.push(file.path);
      continue;
    }
    const was = `${before.status}/${before.differences}`;
    const is = `${now.status}/${now.differences}`;
    const rankDelta = STATUS_RANK[now.status] - STATUS_RANK[before.status];
    if (rankDelta > 0 || (rankDelta === 0 && now.differences > before.differences)) {
      out.regressions.push(
        `${file.path}: ${was} → ${is}${result.error ? ` (${result.error})` : ''}`,
      );
    } else if (rankDelta < 0 || now.differences < before.differences) {
      out.improvements.push(`${file.path}: ${was} → ${is}`);
    }
  }
  return out;
}

export function formatRoundTripReport(runs: FileRoundTrip[], title = 'Round-trip report'): string {
  const byStatus = new Map<RoundTripStatus, number>();
  const byPath = new Map<string, { count: number; files: number }>();
  for (const { result } of runs) {
    byStatus.set(result.status, (byStatus.get(result.status) ?? 0) + 1);
    for (const { key, count } of result.summary?.byPath ?? []) {
      const agg = byPath.get(key) ?? { count: 0, files: 0 };
      agg.count += count;
      agg.files += 1;
      byPath.set(key, agg);
    }
  }
  const order: RoundTripStatus[] = ['clean', 'diff', 'read-error', 'write-error', 'reread-error'];
  const rawKept = runs.reduce((n, r) => n + (r.result.rawObjects?.kept ?? 0), 0);
  const rawLost = runs.reduce((n, r) => n + (r.result.rawObjects?.lost.length ?? 0), 0);
  const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lostByType = new Map<string, { read: number; save: number; files: Set<string> }>();
  let declared = 0;
  let scanned = 0;
  for (const { file, result } of runs) {
    if (!result.handles) continue;
    scanned++;
    declared += result.handles.declared;
    for (const l of result.handles.lost) {
      const agg = lostByType.get(l.type) ?? { read: 0, save: 0, files: new Set<string>() };
      agg[l.stage]++;
      agg.files.add(file.path);
      lostByType.set(l.type, agg);
    }
  }
  const lostTotal = [...lostByType.values()].reduce((n, v) => n + v.read + v.save, 0);
  const lines = [
    `# ${title}`,
    '',
    'open → save (same version and format) → reopen → `structuralDiff` (docs/TESTING.md §3). Expected end state: every file `clean`.',
    '',
    `**${runs.length} files:** ${order.map((s) => `${s} ${byStatus.get(s) ?? 0}`).join(' · ')}`,
    '',
    `**Unknown objects kept raw:** ${rawKept}, lost or changed by the save: ${rawLost}`,
    '',
    `**Declared handles (M1-27):** ${lostTotal} of ${declared} declared in ${scanned} scanned files are missing after the save. \`read\` = acad-ts never loaded the object, \`save\` = the writer dropped it.`,
    '',
    ...(lostTotal === 0
      ? []
      : [
          '| Lost type | read | save | Files |',
          '|---|---:|---:|---:|',
          ...[...lostByType]
            .sort(
              (a, b) => b[1].read + b[1].save - (a[1].read + a[1].save) || a[0].localeCompare(b[0]),
            )
            .map(([t, v]) => `| \`${cell(t)}\` | ${v.read} | ${v.save} | ${v.files.size} |`),
          '',
        ]),
    '## Differences by object type and property (all files)',
    '',
    '| Object · path | Differences | Files |',
    '|---|---:|---:|',
    ...[...byPath]
      .sort(
        (a, b) => b[1].files - a[1].files || b[1].count - a[1].count || a[0].localeCompare(b[0]),
      )
      .slice(0, 60)
      .map(([key, v]) => `| \`${cell(key)}\` | ${v.count} | ${v.files} |`),
    '',
    '## Per file',
    '',
    '| File | Version | Format | Status | Differences | Objects (orig → reopened) | Top paths / error |',
    '|---|---|---|---|---:|---|---|',
    ...[...runs]
      .sort((a, b) => a.file.path.localeCompare(b.file.path))
      .map(({ file, result: r }) => {
        const top = r.error
          ? cell(r.error)
          : (r.summary?.byPath ?? [])
              .slice(0, 3)
              .map((p) => `\`${cell(p.key)}\` ×${p.count}`)
              .join('<br>');
        const objects = r.objectsA === undefined ? '' : `${r.objectsA} → ${r.objectsB}`;
        return `| ${file.path.replace(/^public\/third-party\//, '')} | ${releaseName(file.version) ?? file.version} | ${file.format} | ${r.status} | ${r.summary?.total ?? ''}${r.summary?.truncated ? '+' : ''} | ${objects} | ${top} |`;
      }),
    '',
  ];
  return lines.join('\n');
}
