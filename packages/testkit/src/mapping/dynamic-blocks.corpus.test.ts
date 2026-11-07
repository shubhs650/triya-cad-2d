// M1-14 part 3 (FR-B3): dynamic blocks draw their stored state and carry a "Dynamic — edit in
// AutoCAD" badge, so the mapping must say which block records are dynamic block definitions
// (an ACAD_ENHANCEDBLOCK evaluation graph in the extension dictionary, shown by the
// AcDbDynamicBlockTrueName xdata when there is one) and which anonymous records hold a state
// of one (AcDbBlockRepBTag xdata: 1070 version, 1005 the definition's handle). Checked
// against an independent read of every ASCII DXF, and DWG against the same drawing's DXF.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dynamicBlockOf, type BlockDefinition, type Handle } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { first, readDxfOracle, recordHandle, type DxfRecord, type Group } from './dxf-oracle.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
const load = (path: string) => new Uint8Array(readFileSync(`${corpusDir}${path}`));
const canonical = (h: string) =>
  h
    .trim()
    .replace(/^0+(?=.)/, '')
    .toUpperCase();

/** The groups of one application's xdata: those after its 1001 up to the next 1001. */
function xdataOf(groups: readonly Group[], app: string): Group[] | undefined {
  const at = groups.findIndex(([c, v]) => c === 1001 && v === app);
  if (at < 0) return undefined;
  const end = groups.findIndex(([c], i) => i > at && c === 1001);
  return groups.slice(at + 1, end < 0 ? undefined : end);
}

/** The extension dictionary handle: the 360 inside `102 {ACAD_XDICTIONARY`. */
function extDictOf(groups: readonly Group[]): string | undefined {
  const at = groups.findIndex(([c, v]) => c === 102 && v === '{ACAD_XDICTIONARY');
  return at < 0 ? undefined : groups[at + 1]?.[1];
}

type Dynamic = { dynamic: Map<Handle, string>; dynamicOf: Map<Handle, Handle> };

/** What an ASCII DXF states about its block records. */
function stated(bytes: Uint8Array): Dynamic {
  const oracle = readDxfOracle(bytes);
  const dictionaries = new Map<string, DxfRecord>();
  for (const r of oracle.variableObjects) {
    const h = first(r.groups, 5);
    if (r.type === 'DICTIONARY' && h !== undefined) dictionaries.set(canonical(h), r);
  }
  const out: Dynamic = { dynamic: new Map(), dynamicOf: new Map() };
  for (const r of oracle.records) {
    if (r.type !== 'BLOCK_RECORD') continue;
    const handle = recordHandle(r)!;
    const xdict = extDictOf(r.groups);
    const dict = xdict === undefined ? undefined : dictionaries.get(canonical(xdict));
    const graph = dict?.groups.some(
      ([c, v]) => c === 3 && v.toUpperCase() === 'ACAD_ENHANCEDBLOCK',
    );
    if (graph) {
      const trueName = xdataOf(r.groups, 'AcDbDynamicBlockTrueName')?.find(([c]) => c === 1000);
      out.dynamic.set(handle, trueName?.[1] ?? first(r.groups, 2) ?? '');
    }
    const rep = xdataOf(r.groups, 'AcDbBlockRepBTag')?.find(([c]) => c === 1005);
    if (rep) out.dynamicOf.set(handle, canonical(rep[1]));
  }
  return out;
}

function mapped(blocks: readonly BlockDefinition[]): Dynamic {
  const out: Dynamic = { dynamic: new Map(), dynamicOf: new Map() };
  for (const b of blocks) {
    if (b.dynamic) out.dynamic.set(b.handle, b.dynamic.name);
    if (b.dynamicOf !== undefined) out.dynamicOf.set(b.handle, b.dynamicOf);
  }
  return out;
}

function open(path: string) {
  try {
    return documentInit(readCadDocument(load(path)));
  } catch {
    return undefined; // read failures are the round-trip suite's concern
  }
}

describe('dynamic blocks on the public corpus (M1-14 part 3)', () => {
  it('maps every dynamic block and anonymous state an ASCII DXF states', () => {
    let definitions = 0;
    let states = 0;
    let references = 0;
    const problems: string[] = [];
    for (const f of readable) {
      if (f.format !== 'dxf-ascii') continue;
      const init = open(f.path);
      if (!init) continue;
      const want = stated(load(f.path));
      const got = mapped(init.blocks ?? []);
      expect.soft(got, f.path).toEqual(want);
      definitions += want.dynamic.size;
      states += want.dynamicOf.size;
      // Every reference to a state finds the definition its record names.
      const blocks = new Map((init.blocks ?? []).map((b) => [b.handle, b]));
      for (const e of init.entities ?? []) {
        if (e.geom.kind !== 'INSERT') continue;
        const of = want.dynamicOf.get(e.geom.block);
        const dynamic = dynamicBlockOf(blocks, e.geom.block);
        if (dynamic) references++;
        if (of !== undefined && want.dynamic.has(of) && dynamic?.handle !== of)
          problems.push(`${f.path} ${e.handle}: state of ${of}, got ${dynamic?.handle}`);
      }
    }
    expect(problems).toEqual([]);
    // The acadsharp dynamic-block samples and the sample_AC10xx drawings: 16 definitions, 56
    // anonymous states, and 37 references drawn from a definition or one of its states.
    expect([definitions, states, references]).toEqual([16, 56, 37]);
  }, 60_000);

  /**
   * DWG samples whose DXF beside them is another save of the drawing, not the same one: the
   * polar-parameter DWG holds three more anonymous states (and a `*U3` copy of the definition)
   * than its DXF, and its AcDbBlockRepETag counts 4 where the DXF's counts 2.
   */
  const DIFFERENT_DRAWINGS = new Set([
    'public/third-party/acadsharp/dynamic-blocks/BLOCKPOLARPARAMETER.dwg',
  ]);

  const twins = readable
    .filter((f) => f.format === 'dwg')
    .flatMap((f) => {
      const stem = f.path.replace(/\.dwg$/i, '');
      const dxf = readable.find(
        (d) =>
          d.format === 'dxf-ascii' && (d.path === `${stem}.dxf` || d.path === `${stem}_ascii.dxf`),
      );
      return dxf && !DIFFERENT_DRAWINGS.has(f.path) ? [[f.path, dxf.path] as const] : [];
    });

  it('has DWG and DXF saves of the same dynamic-block drawings', () => {
    expect(twins.length).toBeGreaterThanOrEqual(10);
  });

  it.each(twins)('maps %s as its DXF save %s', (dwg, dxf) => {
    const a = open(dwg);
    const b = open(dxf);
    if (!a || !b) return;
    expect(mapped(a.blocks ?? [])).toEqual(mapped(b.blocks ?? []));
  });
});
