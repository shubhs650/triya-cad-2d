// M1-75 part 35: AcadToTriya maps every DIMASSOC of the public corpus with the geometry of each
// associative point, linked both ways (the dimension and the geometry list the DIMASSOC in their
// reactors, as AutoCAD saved them), and a DXF save maps alike to the DWG of the same ACadSharp
// sample (`sample_AC10xx`, which share handles). Before acad-ts patch 0167 every DXF DIMASSOC
// lost its geometry.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DimAssoc, NonGraphicalObject } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const assocsOf = (objects: readonly NonGraphicalObject[] | undefined): DimAssoc[] =>
  (objects ?? []).filter((o): o is DimAssoc => o.type === 'DIMASSOC');
const comparable = ({ raw: _raw, ...rest }: DimAssoc) => rest;

describe('DIMASSOC mapping on the public corpus', () => {
  const mapped = new Map<string, DimAssoc[]>();
  for (const f of readable) {
    // DWGs from R2004 are compressed, so only a DXF can be passed over by its text.
    const text = f.format === 'dwg' ? '' : readFileSync(`${corpusDir}${f.path}`, 'latin1');
    if (f.format !== 'dwg' && !/AcDbDimAssoc/.test(text)) continue;
    const init = documentInit(
      readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`))),
    );
    const assocs = assocsOf(init.objects);
    if (assocs.length === 0) continue;
    mapped.set(f.path, assocs);
    it(`links every DIMASSOC of ${f.path} both ways`, () => {
      const entities = new Map((init.entities ?? []).map((e) => [e.handle, e]));
      const problems: string[] = [];
      for (const a of assocs) {
        const dim = entities.get(a.dimension);
        if (!dim?.type.endsWith('DIMENSION')) problems.push(`${a.handle}: no dimension`);
        else if (!(dim.reactors ?? []).includes(a.handle)) problems.push(`${a.handle}: dimension`);
        if (dim?.extDict !== a.owner) problems.push(`${a.handle}: not in its dictionary`);
        a.points.forEach((p, i) => {
          if (!p) return;
          if (p.geometry.length !== 1) problems.push(`${a.handle} ${i}: geometry ${p.geometry}`);
          for (const g of p.geometry) {
            if (!(entities.get(g)?.reactors ?? []).includes(a.handle)) {
              problems.push(`${a.handle} ${i}: ${g} does not list it`);
            }
          }
        });
        if (a.points.every((p) => p === null)) problems.push(`${a.handle}: no point`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('maps the ACadSharp DXF saves alike to their DWGs', () => {
    const pairs = [...mapped.keys()].flatMap((path) => {
      const m = /^(.*sample_AC\d{4})_(?:ascii|binary)\.dxf$/.exec(path);
      const dwg = m && `${m[1]}.dwg`;
      return dwg && mapped.has(dwg) ? [[path, dwg] as const] : [];
    });
    expect(pairs.length).toBeGreaterThanOrEqual(12);
    for (const [dxf, dwg] of pairs) {
      // AutoCAD's own rounding of the endpoint parameter differs between the two saves.
      const round = (a: DimAssoc) =>
        JSON.parse(
          JSON.stringify(comparable(a), (_k, v: unknown) =>
            typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v,
          ),
        ) as unknown;
      expect(mapped.get(dxf)!.map(round), dxf).toEqual(mapped.get(dwg)!.map(round));
    }
  });
});
