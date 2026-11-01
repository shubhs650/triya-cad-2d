// acad-ts patch tests that need a real drawing (third_party/acad-ts/PATCHES.md). The rest live
// in packages/io/test/acad-ts-patches.test.ts; @triya/io has no Node file APIs to read corpus files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DwgReader, DwgWriter, XY, type CadDocument, type Layout } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';

const corpusFile = (path: string): ArrayBuffer =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  ).buffer;

const paperLayouts = (doc: CadDocument): Layout[] =>
  [...doc.layouts!].filter((layout) => layout.name !== 'Model');

describe('acad-ts local patches (corpus-backed)', () => {
  it("0006 DWG writer stores a layout's maximum limits, not its minimum twice", () => {
    const doc = DwgReader.readFromStream(corpusFile('third-party/acadsharp/sample_base/empty.dwg'));
    const layout = paperLayouts(doc)[0]!;
    layout.minLimits = new XY(-10, -5);
    layout.maxLimits = new XY(420, 297);

    const reread = DwgReader.readFromStream(DwgWriter.writeToBuffer(doc).slice().buffer);

    const back = paperLayouts(reread).find((l) => l.handle === layout.handle)!;
    expect([back.minLimits.x, back.minLimits.y]).toEqual([-10, -5]);
    expect([back.maxLimits.x, back.maxLimits.y]).toEqual([420, 297]);
  });
});
