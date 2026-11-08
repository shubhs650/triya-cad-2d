// Fidelity triage (M1-106, TESTING.md §4): where a render differs from its golden image, the
// harness asks the app which entities are drawn in each differing region (the renderer's R-tree,
// `DevHooks.entitiesIn`) and names them by type and handle. After a run the per-space results
// are folded into the entity-level report, `docs/reports/fidelity-latest.md` for the public
// corpus; the private corpus's report leaves out file names and handles (TESTING.md §2.2).
import type { Region } from './compare.ts';

/** An entity drawn on the canvas, as the app's renderer names it. */
export interface DrawnEntity {
  readonly handle: string;
  /** The DXF type: LINE, MTEXT, INSERT, VIEWPORT, … */
  readonly type: string;
}

export interface SpaceTriage {
  /** The tab's name: Model, or the layout's. */
  readonly space: string;
  readonly pass: boolean;
  /** Why it failed; absent when it passed. */
  readonly reason?: string;
  /** The entities in view in this space, counted by type. */
  readonly drawn: Readonly<Record<string, number>>;
  /** Each region that differs from the golden image and the entities drawn in it. */
  readonly regions: readonly {
    readonly region: Region;
    readonly entities: readonly DrawnEntity[];
  }[];
}

export interface FileTriage {
  /** The corpus path, relative to `corpus/`. */
  readonly path: string;
  /** Why the app cannot open it, for a file the harness expects to fail. */
  readonly unreadable?: string;
  readonly spaces: readonly SpaceTriage[];
}

/** Entities named per region before the rest are only counted. */
const MAX_NAMED = 8;

/** A differing region as the failure message gives it: `w×h@x,y (TYPE handle, …)`. */
export function describeRegion(region: Region, entities: readonly DrawnEntity[]): string {
  const box = `${region.width}×${region.height}@${region.x},${region.y}`;
  if (entities.length === 0) return `${box} (no entity drawn there)`;
  const named = entities.slice(0, MAX_NAMED).map((e) => `${e.type} ${e.handle}`);
  const rest = entities.length - named.length;
  return `${box} (${named.join(', ')}${rest > 0 ? `, and ${rest} more` : ''})`;
}

/** Entities counted by type. */
export function typeCounts(entities: readonly DrawnEntity[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entities) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

/** Whether `files` holds a result for every manifest path and for nothing else. */
export function isCompleteRun(files: readonly FileTriage[], manifestPaths: readonly string[]) {
  const got = new Set(files.map((f) => f.path));
  return got.size === manifestPaths.length && manifestPaths.every((p) => got.has(p));
}

interface TypeRow {
  inView: number;
  spaces: number;
  inRegions: number;
  failingSpaces: number;
}

/**
 * The entity-level report: a summary, a table of entity types (how many are in view across
 * the corpus's spaces, in how many spaces, how many are drawn in a region that differs from
 * its golden image, and in how many failing spaces), and each failing space with its regions.
 * Sorted throughout, so the same run gives the same bytes. `names: false` (the private corpus)
 * leaves out file names and handles.
 */
export function formatFidelityReport(
  input: readonly FileTriage[],
  o: { readonly title: string; readonly names?: boolean },
): string {
  const names = o.names ?? true;
  const files = [...input].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const spaces = files.flatMap((f) => f.spaces.map((s) => ({ file: f.path, ...s })));
  const failing = spaces.filter((s) => !s.pass);
  const unreadable = files.filter((f) => f.unreadable !== undefined).length;

  const rows = new Map<string, TypeRow>();
  const row = (type: string): TypeRow => {
    let r = rows.get(type);
    if (!r) rows.set(type, (r = { inView: 0, spaces: 0, inRegions: 0, failingSpaces: 0 }));
    return r;
  };
  for (const s of spaces) {
    for (const [type, n] of Object.entries(s.drawn)) {
      if (n <= 0) continue;
      const r = row(type);
      r.inView += n;
      r.spaces++;
      if (!s.pass) r.failingSpaces++;
    }
    // An entity spanning several regions counts once per space.
    const seen = new Set<string>();
    for (const { entities } of s.regions) {
      for (const e of entities) {
        if (seen.has(e.handle)) continue;
        seen.add(e.handle);
        row(e.type).inRegions++;
      }
    }
  }

  const lines = [
    `# ${o.title}`,
    '',
    'Written by `pnpm test:fidelity` (M1-106, TESTING.md §4) from the golden-image comparison of each space.',
    '',
    `${files.length} files${unreadable > 0 ? ` (${unreadable} unreadable)` : ''}, ${spaces.length} spaces, ${failing.length} failing.`,
    '',
    '## Entity types',
    '',
    '"In view" counts the entities drawn in each space’s shot, summed over the spaces; "In differing regions" counts those drawn where a shot differs from its golden image.',
    '',
    '| Type | In view | Spaces | In differing regions | Failing spaces |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...[...rows]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([type, r]) =>
          `| ${type} | ${r.inView} | ${r.spaces} | ${r.inRegions} | ${r.failingSpaces} |`,
      ),
    '',
    '## Failing spaces',
    '',
  ];
  if (failing.length === 0) lines.push('Every space matches its golden image.');
  else if (!names)
    lines.push(`${failing.length} failing spaces; file names are left out of the private report.`);
  else
    for (const s of failing) {
      lines.push(`- \`${s.file}\` ${s.space}: ${s.reason ?? 'failed'}`);
      for (const r of s.regions) lines.push(`  - ${describeRegion(r.region, r.entities)}`);
    }
  return `${lines.join('\n')}\n`;
}
