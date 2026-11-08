// M1-104: AcadToTriya maps a layer's Description (its AcAecLayerStandard xdata, an empty 1000
// string and then the text) on the public corpus. Every ACadSharp sample, R14 to R2018, DWG and
// both DXF saves, has the layer Layer_desc with a description and maps alike (the R12 DXF
// saves have none: AutoCAD drops the entries saving to R12); AecObjects.dwg's
// Defpoints has AutoCAD's own "Default Non-Plotting Layer".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Each layer's description by name, of the layers that have one. */
function descriptions(path: string): Map<string, string> {
  const init = documentInit(readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${path}`))));
  return new Map(
    (init.tables?.layers ?? []).flatMap((l) => (l.description ? [[l.name, l.description]] : [])),
  );
}

describe('layer descriptions on the public corpus', () => {
  const samples = readable.filter((f) =>
    /\/sample_AC10\d\d(_ascii|_binary)?\.(dwg|dxf)$/.test(f.path),
  );

  it('finds every ACadSharp sample', () => {
    // R12 (DXF), R14 (DWG only) and R2000–R2018 (DWG, ASCII and binary DXF).
    expect(samples.length).toBeGreaterThanOrEqual(21);
  });

  it.each(samples.map((f) => [f.path] as const))('maps Layer_desc’s description in %s', (path) => {
    const got = descriptions(path);
    // AutoCAD's R12 save keeps the AcAecLayerStandard APPID but no layer's entry.
    if (/sample_AC1009/.test(path)) {
      expect(got.size, path).toBe(0);
      return;
    }
    // sample_AC1014.dwg names the layer in capitals, as R14 kept layer names.
    const key = [...got.keys()].find((n) => n.toUpperCase() === 'LAYER_DESC');
    expect(key, path).toBeDefined();
    expect(got.get(key!), path).toBe("This layer has it's own description");
    // No other layer of the samples has one: every other entry holds two empty strings.
    expect(got.size, path).toBe(1);
  });

  it('maps the DXF saves of each sample alike to its DWG', () => {
    const pairs = samples
      .filter((f) => f.format !== 'dwg')
      .map((f) => [f.path, f.path.replace(/_(ascii|binary)\.dxf$/, '.dwg')] as const)
      .filter(([, dwg]) => samples.some((f) => f.path === dwg));
    expect(pairs.length).toBeGreaterThanOrEqual(12);
    for (const [dxf, dwg] of pairs) expect(descriptions(dxf), dxf).toEqual(descriptions(dwg));
  });

  it('maps AutoCAD’s own Defpoints description and a layer with the first string only', () => {
    const path = readable.find((f) => f.path.endsWith('/AecObjects.dwg'))?.path;
    expect(path).toBeDefined();
    // Layer 0 holds the first (empty) string only, so it has no description.
    expect(descriptions(path!)).toEqual(new Map([['Defpoints', 'Default Non-Plotting Layer']]));
  });
});
