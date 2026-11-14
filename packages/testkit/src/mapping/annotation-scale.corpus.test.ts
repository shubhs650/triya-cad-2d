// M1-63: MSLTSCALE and CANNOSCALE are system variables AutoCAD saves as DICTIONARYVAR entries
// of the AcDbVariableDictionary, not in the HEADER section. AcadToTriya carries every entry
// under its bare name, plus CANNOSCALEVALUE from the ACAD_SCALELIST SCALE that CANNOSCALE
// names. Checked against an independent read of every ASCII DXF, and through a save and
// reopen of every readable corpus file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DocumentModel, type HeaderValue } from '@triya/engine';
import { documentInit, exportDocument, mapHeader, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { first, readDxfOracle, type DxfRecord, type Group } from './dxf-oracle.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** The (key, handle) entries of a DICTIONARY: each 3 followed by its 350 or 360. */
function entries(groups: readonly Group[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < groups.length; i++) {
    const [code, key] = groups[i]!;
    const [next, handle] = groups[i + 1]!;
    if (code === 3 && (next === 350 || next === 360)) out.push([key, handle.trim()]);
  }
  return out;
}

/** What the file states: DICTIONARYVAR values by name, and CANNOSCALEVALUE when it resolves. */
function stated(bytes: Uint8Array): Map<string, HeaderValue> {
  const objects = readDxfOracle(bytes).variableObjects;
  const byHandle = new Map<string, DxfRecord>();
  for (const r of objects) {
    const h = first(r.groups, 5);
    if (h !== undefined) byHandle.set(h.trim().toUpperCase(), r);
  }
  const dictionary = (r: DxfRecord | undefined, key: string): DxfRecord | undefined => {
    const h = r && entries(r.groups).find(([k]) => k === key)?.[1];
    return h === undefined ? undefined : byHandle.get(h.toUpperCase());
  };
  const root = objects.find((r) => r.type === 'DICTIONARY');
  const out = new Map<string, HeaderValue>();
  const vars = dictionary(root, 'AcDbVariableDictionary');
  for (const [name, h] of vars ? entries(vars.groups) : []) {
    const v = byHandle.get(h.toUpperCase());
    if (v?.type === 'DICTIONARYVAR') out.set(name, first(v.groups, 1) ?? '');
  }
  const list = dictionary(root, 'ACAD_SCALELIST');
  for (const [, h] of list ? entries(list.groups) : []) {
    const s = byHandle.get(h.toUpperCase());
    if (s?.type !== 'SCALE' || first(s.groups, 300) !== out.get('CANNOSCALE')) continue;
    const paper = Number(first(s.groups, 140));
    const drawing = Number(first(s.groups, 141));
    if (paper > 0 && drawing > 0) out.set('CANNOSCALEVALUE', paper / drawing);
  }
  return out;
}

/** The mapped variables that do not come from the HEADER section (no `$`). */
const bareNames = (header: ReadonlyMap<string, HeaderValue>): Map<string, HeaderValue> =>
  new Map([...header].filter(([name]) => !name.startsWith('$')));

const load = (path: string) => new Uint8Array(readFileSync(`${corpusDir}${path}`));

describe('MSLTSCALE and CANNOSCALE on the public corpus (M1-63)', () => {
  it('maps every variable-dictionary entry an ASCII DXF states, unchanged', () => {
    let files = 0;
    const msltscale = new Set<HeaderValue>();
    const problems: string[] = [];
    for (const f of readable) {
      if (f.format !== 'dxf-ascii') continue;
      const bytes = load(f.path);
      let doc;
      try {
        doc = readCadDocument(bytes);
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      files++;
      const want = stated(bytes);
      const got = bareNames(mapHeader(doc).header);
      if (want.has('MSLTSCALE')) msltscale.add(want.get('MSLTSCALE')!);
      for (const name of new Set([...want.keys(), ...got.keys()])) {
        const a = want.get(name);
        const b = got.get(name);
        const same =
          typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-12 : a === b;
        if (!same) problems.push(`${f.path} ${name}: file ${String(a)}, mapped ${String(b)}`);
      }
    }
    expect(files).toBeGreaterThan(50);
    expect(problems).toEqual([]);
    // Both states occur in the corpus.
    expect([...msltscale].sort()).toEqual(['0', '1']);
  }, 60_000);

  it.each(readable.map((f) => [f.path] as const))(
    'keeps MSLTSCALE and CANNOSCALE through a save of %s',
    (path) => {
      const bytes = load(path);
      let original;
      try {
        original = readCadDocument(bytes);
      } catch {
        return; // read failures are the round-trip suite's concern
      }
      const before = bareNames(mapHeader(original).header);
      const format = /\.dwg$/i.test(path) ? 'dwg' : 'dxf';
      const written = exportDocument(original, DocumentModel.create(documentInit(original)), {
        format,
        binary: format === 'dxf' && isBinaryDxf(bytes),
      });
      const after = bareNames(mapHeader(readCadDocument(written)).header);
      expect(after).toEqual(before);
    },
    5_000,
  );
});

/** Binary DXF starts with the 22-byte sentinel "AutoCAD Binary DXF\r\n\x1a\0". */
function isBinaryDxf(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 18)) === 'AutoCAD Binary DXF';
}
