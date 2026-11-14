// M1-103: AcadToTriya maps every SPATIAL_FILTER (XCLIP) of the public corpus, each one on the
// INSERT whose ACAD_FILTER dictionary holds it, and a DXF save maps alike to the DWG of the same
// ACadSharp sample (`sample_AC10xx`, which share handles). Before acad-ts patch 0169 every DXF
// filter lost its inverse insert transform (the second matrix overwrote it), so the clip of the
// samples' reference, inserted at 1/25.4, landed 25 times too small and off to one side.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clipBoundary, type NonGraphicalObject, type SpatialFilter } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const filtersOf = (objects: readonly NonGraphicalObject[] | undefined): SpatialFilter[] =>
  (objects ?? []).filter((o): o is SpatialFilter => o.type === 'SPATIAL_FILTER');
const comparable = ({ raw: _raw, ...rest }: SpatialFilter) => rest;

describe('SPATIAL_FILTER mapping on the public corpus', () => {
  const mapped = new Map<string, SpatialFilter[]>();
  for (const f of readable) {
    // DWGs from R2004 are compressed, so only a DXF can be passed over by its text.
    const text = f.format === 'dwg' ? '' : readFileSync(`${corpusDir}${f.path}`, 'latin1');
    if (f.format !== 'dwg' && !/AcDbSpatialFilter/.test(text)) continue;
    const init = documentInit(
      readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`))),
    );
    const filters = filtersOf(init.objects);
    if (filters.length === 0) continue;
    mapped.set(f.path, filters);
    it(`puts every SPATIAL_FILTER of ${f.path} on its INSERT`, () => {
      const entities = new Map((init.entities ?? []).map((e) => [e.handle, e]));
      const problems: string[] = [];
      for (const s of filters) {
        const insert = entities.get(s.insert);
        if (insert?.type !== 'INSERT') problems.push(`${s.handle}: no INSERT ${s.insert}`);
        if (!clipBoundary(s)) problems.push(`${s.handle}: no boundary`);
        if (s.inverseInsert.length !== 12 || s.boundaryTransform.length !== 12) {
          problems.push(`${s.handle}: matrices`);
        }
      }
      expect(problems).toEqual([]);
    });
  }

  it('finds the clips of xclip.dxf and the ACadSharp samples', () => {
    expect(mapped.get('public/third-party/ezdxf/examples_dxf/xclip.dxf')).toHaveLength(9);
    expect(mapped.size).toBeGreaterThanOrEqual(21);
  });

  it('maps the ACadSharp DXF saves alike to their DWGs', () => {
    const pairs = [...mapped.keys()].flatMap((path) => {
      const m = /^(.*sample_AC\d{4})_(?:ascii|binary)\.dxf$/.exec(path);
      const dwg = m && `${m[1]}.dwg`;
      return dwg && mapped.has(dwg) ? [[path, dwg] as const] : [];
    });
    expect(pairs.length).toBeGreaterThanOrEqual(12);
    // An ASCII DXF writes doubles to 16 significant digits, so its last digit may differ.
    const round = (s: SpatialFilter) =>
      JSON.parse(
        JSON.stringify(comparable(s), (_k, v: unknown) =>
          typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v,
        ),
      ) as unknown;
    for (const [dxf, dwg] of pairs) {
      expect(mapped.get(dxf)!.map(round), dxf).toEqual(mapped.get(dwg)!.map(round));
    }
    // The samples' reference is inserted at 1/25.4, so the inverse scales by 25.4.
    const [sample] = mapped.get('public/third-party/acadsharp/sample_AC1032_ascii.dxf')!;
    expect(sample!.inverseInsert[0]).toBeCloseTo(25.4, 9);
  });
});
