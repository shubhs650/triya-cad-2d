// M0-03 acceptance on real files: DwgReader (via @triya/io) reads the ACadSharp sample drawing
// saved by AutoCAD in every DWG version from R14 to 2018. Reading the whole corpus, and
// round-tripping it, is the M0-05/M0-06 harness's job; this only proves the wiring.
import { readCadDocument, summarizeDocument } from '@triya/io';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(import.meta.dirname, '../../corpus/public/third-party/acadsharp');
const versions = ['AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'];

describe('DwgReader on corpus samples', () => {
  it.each(versions)('reads sample_%s.dwg', (version) => {
    const bytes = new Uint8Array(readFileSync(path.join(dir, `sample_${version}.dwg`)));

    const summary = summarizeDocument(readCadDocument(bytes), 'dwg');

    expect(summary.version).toBe(version);
    expect(Object.values(summary.modelSpaceEntities).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(summary.layers).toContain('0');
  });
});
