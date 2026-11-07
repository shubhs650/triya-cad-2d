// Every header variable on every format and version of the public corpus (M1-75 part 6): a
// save of a change to each variable either maps back to the change, or TriyaToAcad refuses it,
// before writing anything, for a reason the format or the writer gives. This keeps the lists
// of what each format stores (export/header.ts) true: a variable a format loses without a
// refusal fails here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CadHeader } from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type HeaderValue } from '@triya/engine';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

/** One readable file per format (DWG, ASCII and binary DXF) and version. */
const samples = (() => {
  const seen = new Set<string>();
  return manifest.files.filter((f) => {
    if (f.knownIssues.some((k) => /read/i.test(k))) return false;
    const key = `${f.format} ${f.version} ${f.path.includes('binary') ? 'binary' : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

/** Why a variable may be refused here; "cannot hold" would mean the test's value is wrong. */
const EXPECTED_REFUSAL =
  /the save sets it|names the UCS record|does not store it|acad-ts writes no (DXF|DWG) value/;

/** Made up on every read when the file lacks them; a save never writes them (export/header.ts). */
const VOLATILE = /^\$(TDCREATE|TDUCREATE|TDUPDATE|TDUUPDATE|VERSIONGUID|FINGERPRINTGUID)$/;

/** A different value of the same kind for every variable the drawing states. */
function changes(model: DocumentModel): Map<string, HeaderValue> {
  const out = new Map<string, HeaderValue>();
  const names = (records: Iterable<{ name: string }>) => [...records].map((r) => r.name);
  const other = (all: readonly string[], v: HeaderValue | undefined) =>
    all.find((n) => n !== '' && n !== v && !n.startsWith('*'));
  const t = model.tables;
  for (const [name, variable] of CadHeader.getHeaderMap()) {
    const v = model.header.get(name);
    if (v === undefined || VOLATILE.test(name)) continue;
    let next: HeaderValue | undefined;
    if (name === '$CLAYER') next = other(names(t.layers.values()), v);
    else if (name === '$CELTYPE' || /^\$DIMLT/.test(name))
      next = other(names(t.linetypes.values()), v);
    else if (name === '$TEXTSTYLE' || name === '$DIMTXSTY')
      next = other(names(t.textStyles.values()), v);
    else if (name === '$DIMSTYLE') next = other(names(t.dimStyles.values()), v);
    // The default arrowhead, as no arrow block can be counted on.
    else if (/^\$(DIMBLK|DIMLDRBLK)/.test(name)) next = v === '' ? undefined : '';
    else if (variable.isName || name === '$CMLSTYLE') next = undefined;
    // AutoCAD takes 1 to 30 steps a second.
    else if (name === '$STEPSPERSEC') next = v === 1 ? 2 : 1;
    else if (typeof v === 'number') next = Number.isInteger(v) ? (v === 0 ? 1 : 0) : v + 0.5;
    else if (typeof v === 'boolean') next = !v;
    // A handle variable ($CMATERIAL) has to name an object of its kind; leave it.
    else if (typeof v === 'string')
      next = /^[0-9A-F]+$/.test(v) && variable.dxfCodes[0]! >= 320 ? undefined : `${v}X`;
    else next = 'z' in v ? { x: v.x + 1, y: v.y + 1, z: v.z + 1 } : { x: v.x + 1, y: v.y + 1 };
    if (next !== undefined) out.set(name, next);
  }
  return out;
}

function edited(bytes: Uint8Array, values: ReadonlyMap<string, HeaderValue>): DocumentModel {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const b = new ChangeSetBuilder(model);
  for (const [name, value] of values) b.setHeader(name, value);
  model.apply(b.build());
  return model;
}

describe('TriyaToAcad header variables on every corpus format', () => {
  it('has a sample of every format', () => {
    expect(samples.length).toBeGreaterThan(20);
  });

  it.each(samples.map((f) => [f.path, f] as const))('%s', (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    const { format } = sniffCadFile(bytes);
    const options = {
      format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
      binary: format === 'dxf-binary',
    };
    withPinnedClock(() => {
      const all = changes(DocumentModel.create(documentInit(readCadDocument(bytes))));
      let problems: readonly string[] = [];
      try {
        exportDocument(readCadDocument(bytes), edited(bytes, all), options);
      } catch (e) {
        if (!(e instanceof UnsupportedChangeError)) throw e;
        problems = e.problems;
      }
      expect(
        problems.filter((p) => !EXPECTED_REFUSAL.test(p)),
        f.path,
      ).toEqual([]);

      const refused = new Set(problems.map((p) => /^header variable (\S+):/.exec(p)?.[1]));
      const kept = new Map([...all].filter(([name]) => !refused.has(name)));
      const saved = exportDocument(readCadDocument(bytes), edited(bytes, kept), options);
      const back = new Map(documentInit(readCadDocument(saved)).header);
      const lost = [...kept]
        .filter(([name, value]) => JSON.stringify(back.get(name)) !== JSON.stringify(value))
        .map(
          ([name, value]) => `${name} ${JSON.stringify(value)} → ${JSON.stringify(back.get(name))}`,
        );
      expect(lost, f.path).toEqual([]);
    });
  });
});
