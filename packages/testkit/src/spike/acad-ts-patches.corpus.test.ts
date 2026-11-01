// acad-ts patch tests that need a real drawing (third_party/acad-ts/PATCHES.md). The rest live
// in packages/io/test/acad-ts-patches.test.ts; @triya/io has no Node file APIs to read corpus files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CadDictionary } from '@node-projects/acad-ts';
import {
  DwgReader,
  DwgWriter,
  DxfReader,
  DxfWriter,
  LayoutFlags,
  XY,
  type CadDocument,
  type Layout,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';

const corpusBytes = (path: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );
const corpusFile = (path: string): ArrayBuffer => corpusBytes(path).buffer as ArrayBuffer;

function dxfRoundTrip(doc: CadDocument): CadDocument {
  const chunks: Uint8Array[] = [];
  DxfWriter.writeToStream({ write: (b: Uint8Array) => void chunks.push(b.slice()) }, doc, true);
  return DxfReader.readFromStream(Buffer.concat(chunks));
}

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

  it('0010 DXF writer writes AcDbLayout flags, UCS orthographic type and last viewport', () => {
    const doc = DxfReader.readFromStream(
      corpusBytes('third-party/ezdxf/examples_dxf/caret_encoding.dxf'),
    );
    const layout = paperLayouts(doc)[0]!;
    layout.layoutFlags = LayoutFlags.LimitsChecking;
    layout.ucsOrthographicType = 2;

    const back = paperLayouts(dxfRoundTrip(doc)).find((l) => l.handle === layout.handle)!;

    expect(back.layoutFlags).toBe(layout.layoutFlags);
    expect(back.ucsOrthographicType).toBe(2);
  });

  it('0011 DXF writer keeps empty dictionaries and ACAD_MATERIAL under their handles', () => {
    // Dropped dictionaries were recreated by the reader with new handles on every save.
    const doc = DxfReader.readFromStream(
      corpusBytes('third-party/ezdxf/examples_dxf/caret_encoding.dxf'),
    );
    const entries = (d: CadDocument): Record<string, number> =>
      Object.fromEntries(
        [...d.rootDictionary!.entryNames].map((name) => [
          name,
          d.rootDictionary!.getEntry<CadDictionary>(name)!.handle,
        ]),
      );
    const before = entries(doc);
    expect(before['ACAD_MATERIAL']).toBeDefined();
    expect(before['ACAD_PLOTSETTINGS']).toBeDefined();

    expect(entries(dxfRoundTrip(doc))).toEqual(before);
  });
});
