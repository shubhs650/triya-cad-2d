// M1-75 part 37: AcadToTriya maps the annotation scale representations of every annotative entity
// of the public corpus (the context data in the ACDB_ANNOTATIONSCALES dictionary of its
// AcDbContextDataManager), a TEXT's with its placement, which AutoCAD keeps equal to the text's
// own for the default representation. A DXF save maps alike to the DWG of the same ACadSharp
// sample (`sample_AC10xx`, which share handles): before acad-ts patch 0168 a DWG's text context
// data read one bit late, and a DXF's as an unknown object.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EntityInit, TextFields } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

const annotated = (es: readonly EntityInit[] | undefined): EntityInit[] =>
  (es ?? []).filter((e) => e.annotative !== undefined);

describe('annotation scale representations on the public corpus', () => {
  const mapped = new Map<string, EntityInit[]>();
  for (const f of readable) {
    // DWGs from R2004 are compressed, so only a DXF can be passed over by its text.
    const text = f.format === 'dwg' ? '' : readFileSync(`${corpusDir}${f.path}`, 'latin1');
    if (f.format !== 'dwg' && !/OBJECTCONTEXTDATA_CLASS/.test(text)) continue;
    const entities = annotated(
      documentInit(readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)))).entities,
    );
    if (entities.length === 0) continue;
    mapped.set(f.path, entities);
    it(`maps the representations of ${f.path}, a default one where each text is`, () => {
      const problems: string[] = [];
      for (const e of entities) {
        const reps = e.annotative!.representations;
        if (reps.length === 0) problems.push(`${e.handle}: no representation`);
        if (reps.filter((r) => r.isDefault).length !== 1)
          problems.push(`${e.handle}: not one default representation`);
        if (e.geom.kind !== 'TEXT') continue;
        const g: TextFields = e.geom;
        for (const r of reps) if (!r.text || !r.scale) problems.push(`${e.handle}: ${r.handle}`);
        const d = reps.find((r) => r.isDefault)?.text;
        if (
          !d ||
          d.position.x !== g.position.x ||
          d.position.y !== g.position.y ||
          d.rotation !== g.rotation ||
          d.halign !== g.halign
        )
          problems.push(`${e.handle}: default representation ${JSON.stringify(d)}`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('maps the annotative texts of the ACadSharp samples, their DXF saves alike to their DWGs', () => {
    const texts = [...mapped.values()].flat().filter((e) => e.geom.kind === 'TEXT');
    // Two annotative texts in each R2010, R2013 and R2018 sample (DWG, ASCII and binary DXF).
    expect(texts.length).toBeGreaterThanOrEqual(18);
    const pairs = [...mapped.keys()].flatMap((path) => {
      const m = /^(.*sample_AC\d{4})_(?:ascii|binary)\.dxf$/.exec(path);
      const dwg = m && `${m[1]}.dwg`;
      return dwg && mapped.has(dwg) ? [[path, dwg] as const] : [];
    });
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    for (const [dxf, dwg] of pairs) {
      const of = (path: string) => mapped.get(path)!.map((e) => [e.handle, e.annotative] as const);
      expect(of(dxf), dxf).toEqual(of(dwg));
    }
  });
});
