/**
 * Runners behind `pnpm spike:read` and `pnpm spike:roundtrip` (docs/SPIKE_M0_ACAD_TS.md
 * procedure steps 2, 3 and 7). They write Markdown + JSON to test-reports/spike/ and, for the
 * round trip, the written drawings to docs/reports/M0-written/ (gitignored) for the owner's
 * AutoCAD AUDIT sweep (M0-07).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadManifest, type CorpusFile } from '../corpus/manifest.ts';
import { releaseName } from '../corpus/versions.ts';
import { roundTrip } from '../roundtrip/roundtrip.ts';
import { spikeRead, type SpikeReadResult } from './read.ts';
import { buildTaxonomy, CATEGORY_LABELS, type SpikeFileRun } from './taxonomy.ts';

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (p: string): string => p.replace(/^public\/third-party\//, '');
const top = (rec: Record<string, number>, n: number): [string, number][] =>
  Object.entries(rec)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);

export interface SpikePaths {
  corpusDir: string;
  reportDir: string;
  writtenDir: string;
}

function corpusFiles(paths: SpikePaths): CorpusFile[] {
  return loadManifest(path.join(paths.corpusDir, 'corpus.json')).files;
}

export function runSpikeRead(paths: SpikePaths): { file: CorpusFile; read: SpikeReadResult }[] {
  const runs = corpusFiles(paths).map((file) => ({
    file,
    read: spikeRead(new Uint8Array(readFileSync(path.join(paths.corpusDir, file.path)))),
  }));
  const status = { ok: 0, warnings: 0, error: 0 };
  const unmapped = new Map<string, { count: number; files: number }>();
  const messages = new Map<string, { count: number; files: number }>();
  const notInGraph = new Map<string, { count: number; files: number }>();
  let declared = 0;
  let missingTotal = 0;
  let scanned = 0;
  for (const { read } of runs) {
    if (read.coverage) {
      scanned++;
      declared += read.coverage.fileHandles;
      missingTotal += read.coverage.notInGraph;
      for (const [k, n] of Object.entries(read.coverage.notInGraphByType)) {
        const u = notInGraph.get(k) ?? { count: 0, files: 0 };
        notInGraph.set(k, { count: u.count + n, files: u.files + 1 });
      }
    }
    status[read.status]++;
    for (const [k, n] of Object.entries(read.unmapped)) {
      const u = unmapped.get(k) ?? { count: 0, files: 0 };
      unmapped.set(k, { count: u.count + n, files: u.files + 1 });
    }
    for (const [k, n] of Object.entries(read.messages)) {
      const m = messages.get(k) ?? { count: 0, files: 0 };
      messages.set(k, { count: m.count + n, files: m.files + 1 });
    }
  }
  const byFiles = (m: Map<string, { count: number; files: number }>) =>
    [...m].sort((a, b) => b[1].files - a[1].files || b[1].count - a[1].count);
  const md = [
    '# acad-ts spike: read results (public corpus)',
    '',
    '`pnpm spike:read`. **ok** = read with no warnings and nothing unmapped; **warnings** = read, but acad-ts reported problems or kept objects only as unknown/proxy; **error** = the reader threw.',
    '',
    `**${runs.length} files:** ok ${status.ok} · warnings ${status.warnings} · error ${status.error}`,
    '',
    '## Unmapped types (kept as unknown or proxy)',
    '',
    '| Type | Objects | Files |',
    '|---|---:|---:|',
    ...byFiles(unmapped).map(([k, v]) => `| \`${cell(k)}\` | ${v.count} | ${v.files} |`),
    '',
    '## Objects in the file that never reach the acad-ts graph',
    '',
    `Handle coverage over ${scanned} files (DWG handle map typed from each object record, ASCII and binary DXF \`5\`/\`105\` codes; scanner shared with the M1-27 gate): **${missingTotal} of ${declared}** declared objects are not in the object graph, so neither \`structuralDiff\` nor the writer sees them.`,
    '',
    '| Type | Objects | Files |',
    '|---|---:|---:|',
    ...byFiles(notInGraph).map(([k, v]) => `| \`${cell(k)}\` | ${v.count} | ${v.files} |`),
    '',
    '## Reader notifications (warnings and unsupported), normalised',
    '',
    '| Message | Count | Files |',
    '|---|---:|---:|',
    ...byFiles(messages)
      .slice(0, 40)
      .map(([k, v]) => `| ${cell(k)} | ${v.count} | ${v.files} |`),
    '',
    '## Per file',
    '',
    '| File | Version | Format | Status | Read ms | Objects | Not in graph | Unmapped / error |',
    '|---|---|---|---|---:|---:|---:|---|',
    ...runs.map(({ file, read }) => {
      const detail = read.error
        ? cell(read.error)
        : top(read.unmapped, 4)
            .map(([k, n]) => `\`${cell(k)}\` ×${n}`)
            .join(', ');
      const missing = read.coverage
        ? `${read.coverage.notInGraph} / ${read.coverage.fileHandles}`
        : '';
      return `| ${short(file.path)} | ${releaseName(file.version) ?? file.version} | ${file.format} | ${read.status} | ${read.ms} | ${read.objects} | ${missing} | ${detail} |`;
    }),
    '',
  ];
  mkdirSync(paths.reportDir, { recursive: true });
  writeFileSync(path.join(paths.reportDir, 'read.md'), md.join('\n'));
  writeFileSync(
    path.join(paths.reportDir, 'read.json'),
    `${JSON.stringify(
      runs.map(({ file, read }) => ({ path: file.path, ...read })),
      null,
      1,
    )}\n`,
  );
  return runs;
}

export function runSpikeRoundTrip(paths: SpikePaths): SpikeFileRun[] {
  const runs: SpikeFileRun[] = [];
  const files = corpusFiles(paths);
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(path.join(paths.corpusDir, file.path)));
    const read = spikeRead(bytes);
    const result = roundTrip(bytes, { keepOutput: true, sampleSize: 1e6, maxDifferences: 1e6 });
    if (result.output) {
      const out = path.join(paths.writtenDir, file.path.replace(/^public\//, ''));
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, result.output);
    }
    const differences = result.sample ?? [];
    const { output: _output, sample: _sample, ...rest } = result;
    runs.push({ path: file.path, read, roundTrip: rest, differences });
  }
  const tax = buildTaxonomy(runs);
  const status = new Map<string, number>();
  for (const r of runs) status.set(r.roundTrip.status, (status.get(r.roundTrip.status) ?? 0) + 1);
  const writerNotes = new Map<string, { count: number; files: number }>();
  for (const r of runs) {
    for (const [k, n] of Object.entries(r.roundTrip.writerNotes ?? {})) {
      const w = writerNotes.get(k) ?? { count: 0, files: 0 };
      writerNotes.set(k, { count: w.count + n, files: w.files + 1 });
    }
  }
  const md = [
    '# acad-ts spike: round-trip taxonomy (public corpus)',
    '',
    '`pnpm spike:roundtrip`: open → save (same version and format, Triya writer profile) → reopen → `structuralDiff`, every difference put in one category and grouped by object type and top-level field.',
    '',
    `**${runs.length} files:** ${['clean', 'diff', 'read-error', 'write-error', 'reread-error'].map((s) => `${s} ${status.get(s) ?? 0}`).join(' · ')} · differences ${runs.reduce((n, r) => n + r.differences.length, 0)}`,
    '',
    '## By category',
    '',
    '| Category | Count | Files |',
    '|---|---:|---:|',
    ...Object.entries(tax.byCategory).map(
      ([c, v]) =>
        `| ${CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS]} | ${v.count} | ${v.files} |`,
    ),
    '',
    '## By root (category · object · field), most files first',
    '',
    '| Category | Object · field | Count | Files |',
    '|---|---|---:|---:|',
    ...tax.rows
      .slice(0, 80)
      .map((r) => `| ${r.category} | \`${cell(r.key)}\` | ${r.count} | ${r.files} |`),
    '',
    '## Writer notifications',
    '',
    '| Message | Count | Files |',
    '|---|---:|---:|',
    ...[...writerNotes]
      .sort((a, b) => b[1].files - a[1].files || b[1].count - a[1].count)
      .map(([k, v]) => `| ${cell(k)} | ${v.count} | ${v.files} |`),
    '',
    '## Per file',
    '',
    '| File | Version | Format | Status | Differences | Read / write / reopen ms | Top roots / error |',
    '|---|---|---|---|---:|---|---|',
    ...runs.map((r) => {
      const file = files.find((f) => f.path === r.path)!;
      const rt = r.roundTrip;
      const roots = buildTaxonomy([{ ...r, read: { ...r.read, unmapped: {} } }])
        .rows.slice(0, 3)
        .map((x) => `\`${cell(x.key)}\` ×${x.count}`)
        .join('<br>');
      return `| ${short(r.path)} | ${releaseName(file.version) ?? file.version} | ${file.format} | ${rt.status} | ${r.differences.length} | ${rt.ms.read} / ${rt.ms.write ?? ''} / ${rt.ms.reread ?? ''} | ${rt.error ? cell(rt.error) : roots} |`;
    }),
    '',
  ];
  mkdirSync(paths.reportDir, { recursive: true });
  writeFileSync(path.join(paths.reportDir, 'roundtrip.md'), md.join('\n'));
  writeFileSync(
    path.join(paths.reportDir, 'roundtrip.json'),
    `${JSON.stringify({ taxonomy: tax, files: runs.map((r) => ({ path: r.path, read: r.read, roundTrip: r.roundTrip })) }, null, 1)}\n`,
  );
  return runs;
}
