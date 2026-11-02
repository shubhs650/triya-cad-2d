// M1-22: the app opens a drawing with one I/O worker job, `ioApi.open`, which parses the file
// and hands back the summary and the Triya document (`DocumentInit`) the engine and the
// renderer are built from. The document crosses postMessage as a structured clone, so on
// every readable public corpus file it must clone to an equal value, build a DocumentModel,
// and name the model-space block the app shows and its extents (for Zoom Extents).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DocumentModel } from '@triya/engine';
import { ioApi, mapEntities, readCadDocument, summarizeDocument, detectFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

describe('ioApi.open on the public corpus', () => {
  it('returns the summary and a clonable document for every readable file', async () => {
    expect(readable.length).toBeGreaterThan(100);
    for (const f of readable) {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const doc = readCadDocument(bytes);
      const opened = await ioApi.open(bytes.slice());
      const { summary, init, modelSpace: space } = opened;
      const extents = space === undefined ? undefined : opened.extents[space];

      expect(summary, f.path).toEqual(summarizeDocument(doc, detectFormat(bytes)));
      expect(structuredClone(init), f.path).toEqual(init);
      expect(init.entities?.length, f.path).toBe(mapEntities(doc).entities.length);

      const model = DocumentModel.create(structuredClone(init));
      expect(space, f.path).toBe(modelSpace(model));

      // Zoom Extents: every model-space line lies inside the extents the job reports.
      const lines = (init.entities ?? []).filter(
        (e) => e.owner === space && e.geom.kind === 'LINE',
      );
      if (lines.length > 0) expect(extents, f.path).toBeDefined();
      for (const e of lines) {
        if (e.geom.kind !== 'LINE') continue;
        for (const p of [e.geom.start, e.geom.end]) {
          const slack = 1e-9 * Math.max(1, Math.abs(p.x), Math.abs(p.y));
          expect(p.x, f.path).toBeGreaterThanOrEqual(extents!.minX - slack);
          expect(p.x, f.path).toBeLessThanOrEqual(extents!.maxX + slack);
          expect(p.y, f.path).toBeGreaterThanOrEqual(extents!.minY - slack);
          expect(p.y, f.path).toBeLessThanOrEqual(extents!.maxY + slack);
        }
      }

      // Every layout's paper space with entities of known extent has its extents too.
      for (const l of init.layouts ?? []) {
        const known = (init.entities ?? []).some(
          (e) => e.owner === l.blockRecord && e.geom.kind === 'LINE',
        );
        if (known) expect(opened.extents[l.blockRecord], `${f.path} ${l.name}`).toBeDefined();
      }
    }
  });

  it('reports stages in order', async () => {
    const f = readable[0]!;
    const stages: string[] = [];
    await ioApi.open(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)), undefined, (p) => {
      stages.push(p.stage);
    });
    expect(stages).toEqual(['parse', 'map', 'done']);
  });

  it('throws the reader error on bytes that are no drawing', async () => {
    await expect(ioApi.open(new TextEncoder().encode('not a drawing'))).rejects.toThrow();
  });
});

function modelSpace(model: DocumentModel): string | undefined {
  for (const [handle, b] of model.blocks) {
    if (b.name.toUpperCase() === '*MODEL_SPACE') return handle;
  }
  return undefined;
}
