// acad-ts patch tests that need a real drawing (third_party/acad-ts/PATCHES.md). The rest live
// in packages/io/test/acad-ts-patches.test.ts; @triya/io has no Node file APIs to read corpus files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CadDictionary } from '@node-projects/acad-ts';
import {
  DwgReader,
  DwgReaderConfiguration,
  DwgWriter,
  DxfReader,
  DxfReaderConfiguration,
  DxfWriter,
  LayoutFlags,
  LineWeightType,
  Solid3D,
  UnknownEntity,
  UnknownNonGraphicalObject,
  Viewport,
  XY,
  type CadDocument,
  type CadObject,
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

// Reader settings that keep objects acad-ts cannot map (0014, 0016), as @triya/io reads them.
function keepRaw<T extends DwgReaderConfiguration | DxfReaderConfiguration>(config: T): T {
  config.keepUnknownEntities = true;
  config.keepUnknownNonGraphicalObjects = true;
  return config;
}
const readDxfRaw = (bytes: Uint8Array): CadDocument =>
  DxfReader.readFromStreamWithConfig(bytes, keepRaw(new DxfReaderConfiguration()));
const readDwgRaw = (path: string | ArrayBuffer): CadDocument =>
  DwgReader.readFromStreamWithConfig(
    typeof path === 'string' ? corpusFile(path) : path,
    keepRaw(new DwgReaderConfiguration()),
  );

function writeDxf(doc: CadDocument, binary: boolean): Uint8Array {
  if (binary) {
    const chunks: Uint8Array[] = [];
    DxfWriter.writeToStream({ write: (b: Uint8Array) => void chunks.push(b.slice()) }, doc, true);
    return Buffer.concat(chunks);
  }
  // ASCII goes into a byte buffer (code-page encoding); DXF text has no NUL, so it ends at the
  // last non-zero byte. The corpus files used here are well under the buffer size.
  const buffer = new Uint8Array(32 << 20);
  DxfWriter.writeToStream(buffer, doc, false);
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) end--;
  return buffer.slice(0, end);
}
const dxfRawRoundTrip = (doc: CadDocument, binary: boolean): CadDocument =>
  readDxfRaw(writeDxf(doc, binary));
const dwgRawRoundTrip = (doc: CadDocument): CadDocument =>
  readDwgRaw(DwgWriter.writeToBuffer(doc).slice().buffer);

type RawObject = UnknownEntity | UnknownNonGraphicalObject;
const rawObjects = (doc: CadDocument): RawObject[] =>
  [...doc.getCadObjects()].filter(
    (o): o is RawObject => o instanceof UnknownEntity || o instanceof UnknownNonGraphicalObject,
  );
const handleHex = (o: CadObject | null | undefined): string | undefined =>
  o?.handle.toString(16).toUpperCase();
const asJson = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v instanceof Uint8Array ? [...v] : typeof v === 'bigint' ? v.toString() : v,
  );

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

  it.each([
    ['acadsharp/sample_AC1032_ascii.dxf', false, 'ACDBDETAILVIEWSTYLE'],
    ['acadsharp/sample_AC1032_binary.dxf', true, 'ACDBDETAILVIEWSTYLE'],
    ['ezdxf/examples_dxf/uncommon.dxf', false, 'LARGE_RADIAL_DIMENSION'],
  ])('0014 DXF keeps unknown objects raw and writes them back: %s', (path, binary, expected) => {
    // Unmapped objects (view styles, AEC objects, proxies) used to be discarded on read, so every
    // save dropped them without the round-trip diff noticing.
    const doc = readDxfRaw(corpusBytes(`third-party/${path}`));
    const before = rawObjects(doc);
    expect(before.map((o) => o.objectName)).toContain(expected);

    const after = new Map(rawObjects(dxfRawRoundTrip(doc, binary)).map((o) => [o.handle, o]));

    for (const o of before) {
      expect(o.rawDxfCodes?.length, `${handleHex(o)} ${o.objectName}`).toBeGreaterThan(0);
      const back = after.get(o.handle);
      expect(back?.objectName, handleHex(o)).toBe(o.objectName);
      expect(asJson(back?.rawDxfCodes), handleHex(o)).toBe(asJson(o.rawDxfCodes));
    }
  });

  it('0015 DWG reader keeps classes that share a DXF name, under their own numbers', () => {
    // AecObjects.dwg has two AEC_LIST_DEF classes (808 and 809); 133 objects use 809, which the
    // reader dropped, so those objects lost their class and could not be written back.
    const doc = readDwgRaw('third-party/acadsharp/aec_objects/AecObjects.dwg');
    const listDefs = (d: CadDocument): number[] =>
      [...d.classes!]
        .filter((c) => c.dxfName === 'AEC_LIST_DEF')
        .map((c) => c.classNumber)
        .sort();
    expect(listDefs(doc)).toEqual([808, 809]);

    const reread = dwgRawRoundTrip(doc);

    expect(listDefs(reread)).toEqual([808, 809]);
    const of809 = (d: CadDocument): number =>
      rawObjects(d).filter((o) => o.rawDwgData?.typeCode === 809).length;
    expect(of809(doc)).toBeGreaterThan(100);
    expect(of809(reread)).toBe(of809(doc));
  });

  it('0016 DWG keeps unknown objects raw and writes their records back byte for byte', () => {
    const doc = readDwgRaw('third-party/acadsharp/sample_AC1032.dwg');
    const before = rawObjects(doc);
    expect(before.map((o) => o.objectName)).toContain('ACDBDETAILVIEWSTYLE');

    const after = new Map(rawObjects(dwgRawRoundTrip(doc)).map((o) => [o.handle, o]));

    for (const o of before) {
      expect(o.rawDwgData, `${handleHex(o)} ${o.objectName}`).toBeTruthy();
      const back = after.get(o.handle);
      expect(back?.objectName, handleHex(o)).toBe(o.objectName);
      expect(asJson(back?.rawDwgData?.data), handleHex(o)).toBe(asJson(o.rawDwgData?.data));
    }
  });

  it('0017 SUN objects of VPORTs and viewports survive a DXF save', () => {
    const vportDoc = readDxfRaw(corpusBytes('third-party/acadsharp/geolocation/geoloc_AC1021.dxf'));
    const sunOf = (d: CadDocument): string | undefined =>
      handleHex([...d.vPorts!].find((v) => v.name === '*Active')?.sun);
    expect(sunOf(vportDoc)).toBe('23B');
    expect(sunOf(dxfRawRoundTrip(vportDoc, false))).toBe('23B');

    const vpDoc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/VP4.dxf'));
    const suns = (d: CadDocument): Record<string, string | undefined> =>
      Object.fromEntries(
        [...d.getCadObjects()]
          .filter((o): o is Viewport => o instanceof Viewport && o.sun != null)
          .map((v) => [handleHex(v)!, handleHex(v.sun)]),
      );
    expect(Object.keys(suns(vpDoc))).toHaveLength(5);
    expect(suns(dxfRawRoundTrip(vpDoc, false))).toEqual(suns(vpDoc));
  });

  it('0017 3DSOLID history objects survive DWG and DXF saves', () => {
    const histories = (d: CadDocument): Record<string, string | undefined> =>
      Object.fromEntries(
        [...d.getCadObjects()]
          .filter((o): o is Solid3D => o instanceof Solid3D)
          .map((s) => [handleHex(s)!, handleHex(s.history)]),
      );
    const dwg = readDwgRaw('third-party/acadsharp/sample_AC1032.dwg');
    expect(Object.values(histories(dwg))).toHaveLength(2);
    expect(Object.values(histories(dwg)).every((h) => h != null)).toBe(true);
    expect(histories(dwgRawRoundTrip(dwg))).toEqual(histories(dwg));

    const dxf = readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1032_ascii.dxf'));
    expect(Object.values(histories(dxf)).every((h) => h != null)).toBe(true);
    expect(histories(dxfRawRoundTrip(dxf, false))).toEqual(histories(dxf));
  });

  it('0018 objects owned only through an XRECORD entry are read and written', () => {
    // A table's DATATABLE (FD3) is referenced only from an XRECORD's 360 entry.
    const doc = readDwgRaw('third-party/acadsharp/sample_AC1018.dwg');
    expect(doc.getCadObject(0xfd3)?.objectName).toBe('DATATABLE');

    expect(dwgRawRoundTrip(doc).getCadObject(0xfd3)?.objectName).toBe('DATATABLE');
  });

  it("0019 DXF reader keeps a layout's plot flags apart from its layout flags", () => {
    // Both AcDbPlotSettings and AcDbLayout use group 70; the layout's 1 overwrote the plot 688.
    const doc = DxfReader.readFromStream(
      corpusBytes('third-party/acadsharp/sample_AC1032_ascii.dxf'),
    );
    const layout1 = [...doc.layouts!].find((l) => l.name === 'Layout1')!;

    expect(layout1.flags).toBe(688);
    expect(layout1.layoutFlags).toBe(LayoutFlags.PaperSpaceLinetypeScaling);
  });

  it('0020 DWG reader returns $CELWEIGHT as a lineweight, matching the DXF of the drawing', () => {
    const dwg = DwgReader.readFromStream(corpusFile('third-party/acadsharp/sample_AC1032.dwg'));
    const dxf = DxfReader.readFromStream(
      corpusBytes('third-party/acadsharp/sample_AC1032_ascii.dxf'),
    );

    expect(dxf.header!.currentEntityLineWeight).toBe(LineWeightType.ByLayer);
    expect(dwg.header!.currentEntityLineWeight).toBe(LineWeightType.ByLayer);
  });
});
