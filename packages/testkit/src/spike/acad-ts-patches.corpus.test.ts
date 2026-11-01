// acad-ts patch tests that need a real drawing (third_party/acad-ts/PATCHES.md). The rest live
// in packages/io/test/acad-ts-patches.test.ts; @triya/io has no Node file APIs to read corpus files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  AttributeBase,
  BlockRecord,
  CadDictionary,
  CellBorder,
  CellStyle,
  CellStyleMap,
  TableStyle,
} from '@node-projects/acad-ts';
import {
  ACadVersion,
  Arc,
  AttributeDefinition,
  BlockEnd,
  BookColor,
  CadDictionaryWithDefault,
  DimensionArc,
  DwgReader,
  DwgReaderConfiguration,
  DwgWriter,
  DxfReader,
  DxfReaderConfiguration,
  DxfWriter,
  DxfWriterConfiguration,
  ExtendedData,
  ExtendedDataString,
  Hatch,
  ImageDefinition,
  HatchBoundaryPathArc,
  HatchBoundaryPathEllipse,
  Insert,
  LayoutFlags,
  Leader,
  Line,
  LineWeightType,
  Material,
  Mesh,
  MLineStyle,
  MText,
  MultiLeader,
  MultiLeaderStyle,
  ProxyObject,
  RasterImage,
  RasterVariables,
  Solid3D,
  SortEntitiesTable,
  TableEntity,
  TextEntity,
  Tolerance,
  UnknownEntity,
  UnknownNonGraphicalObject,
  Viewport,
  VisualStyle,
  XRecord,
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
  config.keepRawDxfPassthroughObjects = true;
  return config;
}
const readDxfRaw = (bytes: Uint8Array): CadDocument =>
  DxfReader.readFromStreamWithConfig(bytes, keepRaw(new DxfReaderConfiguration()));
const readDwgRaw = (path: string | ArrayBuffer): CadDocument =>
  DwgReader.readFromStreamWithConfig(
    typeof path === 'string' ? corpusFile(path) : path,
    keepRaw(new DwgReaderConfiguration()),
  );

function writeDxf(doc: CadDocument, binary: boolean, config?: DxfWriterConfiguration): Uint8Array {
  if (binary) {
    const chunks: Uint8Array[] = [];
    DxfWriter.writeToStream(
      { write: (b: Uint8Array) => void chunks.push(b.slice()) },
      doc,
      true,
      config,
    );
    return Buffer.concat(chunks);
  }
  // ASCII goes into a byte buffer (code-page encoding); DXF text has no NUL, so it ends at the
  // last non-zero byte. The corpus files used here are well under the buffer size.
  const buffer = new Uint8Array(32 << 20);
  DxfWriter.writeToStream(buffer, doc, false, config);
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) end--;
  return buffer.slice(0, end);
}
const dxfRawRoundTrip = (doc: CadDocument, binary: boolean): CadDocument =>
  readDxfRaw(writeDxf(doc, binary));
// A save that writes every header variable, as @triya/io's fidelity configuration does.
function dxfAllHeaderRoundTrip(doc: CadDocument, binary: boolean): CadDocument {
  const config = new DxfWriterConfiguration();
  config.writeAllHeaderVariables = true;
  return readDxfRaw(writeDxf(doc, binary, config));
}
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
    // AcDbPlotSettings and AcDbLayout both use group 70. The layout map took the plot flags as
    // layout flags (then overwrote them), so plot flags stayed at their default (688). Model's
    // plot flags in this file are 11952; paper layouts happen to carry the default.
    const doc = DxfReader.readFromStream(
      corpusBytes('third-party/acadsharp/sample_AC1032_ascii.dxf'),
    );
    const model = [...doc.layouts!].find((l) => l.name === 'Model')!;

    expect(model.flags).toBe(11952);
    expect(model.layoutFlags).toBe(LayoutFlags.PaperSpaceLinetypeScaling);
  });

  it('0020 DWG reader returns $CELWEIGHT as a lineweight, matching the DXF of the drawing', () => {
    const dwg = DwgReader.readFromStream(corpusFile('third-party/acadsharp/sample_AC1032.dwg'));
    const dxf = DxfReader.readFromStream(
      corpusBytes('third-party/acadsharp/sample_AC1032_ascii.dxf'),
    );

    expect(dxf.header!.currentEntityLineWeight).toBe(LineWeightType.ByLayer);
    expect(dwg.header!.currentEntityLineWeight).toBe(LineWeightType.ByLayer);
  });

  it.each([
    ['acadsharp/sample_AC1032_ascii.dxf', false],
    ['acadsharp/sample_AC1032_binary.dxf', true],
    ['acadsharp/sample_AC1015_ascii.dxf', false],
  ])('0021 DXF writer writes MATERIAL and VISUALSTYLE back as read: %s', (path, binary) => {
    // The DXF writer has no MATERIAL or VISUALSTYLE writer (and the DXF reader assigns no
    // VISUALSTYLE field), so every DXF save dropped them, their dictionary entries and their
    // extension dictionaries.
    const doc = readDxfRaw(corpusBytes(`third-party/${path}`));
    const styles = (d: CadDocument): (Material | VisualStyle)[] =>
      [...d.getCadObjects()].filter(
        (o): o is Material | VisualStyle => o instanceof Material || o instanceof VisualStyle,
      );
    const before = styles(doc);
    expect(before.filter((o) => o instanceof VisualStyle).length).toBeGreaterThan(10);
    expect(before.filter((o) => o instanceof Material).length).toBeGreaterThanOrEqual(3);

    const reread = dxfRawRoundTrip(doc, binary);
    const after = new Map(styles(reread).map((o) => [o.handle, o]));

    for (const o of before) {
      const back = after.get(o.handle);
      expect(back?.objectName, handleHex(o)).toBe(o.objectName);
      expect(o.rawDxfCodes?.length, handleHex(o)).toBeGreaterThan(3);
      expect(asJson(back?.rawDxfCodes), handleHex(o)).toBe(asJson(o.rawDxfCodes));
      expect(handleHex(back?.xDictionary), handleHex(o)).toBe(handleHex(o.xDictionary));
    }
    // The named-object dictionaries still list every style under its handle.
    for (const name of ['ACAD_MATERIAL', 'ACAD_VISUALSTYLE']) {
      const entries = (d: CadDocument): Record<string, string | undefined> => {
        const dict = d.rootDictionary!.getEntry<CadDictionary>(name)!;
        return Object.fromEntries(
          [...dict.entryNames].map((n) => [n, handleHex(dict.getEntry(n))]),
        );
      };
      expect(entries(reread), name).toEqual(entries(doc));
    }
  });

  it('0023 DXF writer writes RASTERVARIABLES units (72), not the display quality twice', () => {
    const doc = DxfReader.readFromStream(corpusBytes('third-party/ezdxf/examples_dxf/images.dxf'));
    const vars = (d: CadDocument): RasterVariables =>
      [...d.getCadObjects()].find((o): o is RasterVariables => o instanceof RasterVariables)!;
    expect(vars(doc).units).toBe(5); // 72 = 5, inches
    expect(vars(doc).displayQuality).toBe(1);

    expect(vars(dxfRoundTrip(doc)).units).toBe(5);
  });

  it('0025 DXF BLOCK_RECORD keeps its insert units (70) and its whole preview (310)', () => {
    // 70 went to the common table-entry flags, and each 310 chunk replaced the previous one,
    // so a save wrote units 0 and no preview.
    const path = 'third-party/acadsharp/dynamic-blocks/BLOCKALIGNMENTPARAMETER.dxf';
    const bytes = corpusBytes(path);
    // The record's own groups, from the file: handle 250.
    const lines = new TextDecoder('latin1').decode(bytes).split(/\r?\n/);
    const start = lines.findIndex((l, i) => l.trim() === '5' && lines[i + 1]!.trim() === '250');
    const groups: [string, string][] = [];
    for (let i = start; lines[i]!.trim() !== '0'; i += 2)
      groups.push([lines[i]!.trim(), lines[i + 1]!.trim()]);
    const preview = groups
      .filter(([c]) => c === '310')
      .map(([, v]) => v)
      .join('');
    const units = Number(groups.find(([c]) => c === '70')![1]);
    expect(preview.length / 2).toBeGreaterThan(1000);
    expect(units).toBe(1);

    const doc = readDxfRaw(bytes);
    const record = (d: CadDocument): BlockRecord => d.getCadObject(0x250) as BlockRecord;
    const hex = (b: Uint8Array | null): string =>
      [...(b ?? [])].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
    expect(record(doc).units).toBe(units);
    expect(hex(record(doc).preview)).toBe(preview);

    const back = record(dxfRawRoundTrip(doc, false));
    expect(back.units).toBe(units);
    expect(hex(back.preview)).toBe(preview);
    expect(back.flags).toBe(record(doc).flags);
  });

  it('0028 DXF TABLESTYLE and CELLSTYLEMAP keep their cell styles through a save', () => {
    // TABLESTYLE: the reader filled cellStyles but never data/title/header, so the writer wrote
    // the defaults; it also read the 284-289 visibility flags inverted, and wrote 62/91 from
    // other fields than it reads them into. CELLSTYLEMAP: margins and borders were never written,
    // and the borders were read into objects nothing kept.
    const doc = DxfReader.readFromStream(
      corpusBytes('third-party/acadsharp/dynamic-blocks/BLOCKALIGNMENTPARAMETER.dxf'),
    );
    const tableStyle = (d: CadDocument): TableStyle => d.getCadObject(0x87) as TableStyle;
    const styleMap = (d: CadDocument): CellStyleMap => d.getCadObject(0x26f) as CellStyleMap;
    const edges = (c: CellStyle): CellBorder[] => [
      c.topBorder,
      c.horizontalInsideBorder,
      c.bottomBorder,
      c.leftBorder,
      c.verticalInsideBorder,
      c.rightBorder,
    ];
    const cell = (c: CellStyle): unknown => ({
      textHeight: c.textHeight,
      cellAlignment: c.cellAlignment,
      color: c.color.index,
      backgroundColor: c.backgroundColor.index,
      fill: c.isFillColorOn,
      type: c.cellStyleType,
      styleClass: c.styleClass,
      margins: [
        c.verticalMargin,
        c.horizontalMargin,
        c.bottomMargin,
        c.rightMargin,
        c.marginHorizontalSpacing,
        c.marginVerticalSpacing,
      ],
      borders: edges(c).map((b) => [
        b.lineWeight,
        b.isInvisible,
        b.color.index,
        b.doubleLineSpacing,
        b.propertyOverrideFlags,
      ]),
    });
    const ts = tableStyle(doc);
    // The file: data 0.18 top centre, title 0.25, header 0.18, every border visible.
    expect(
      [ts.dataCellStyle, ts.titleCellStyle, ts.headerCellStyle].map((c) => c.textHeight),
    ).toEqual([0.18, 0.25, 0.18]);
    expect(ts.dataCellStyle.cellAlignment).toBe(2);
    expect(ts.dataCellStyle.backgroundColor.index).toBe(7);
    expect(edges(ts.dataCellStyle).map((b) => b.isInvisible)).toEqual(Array(6).fill(false));
    const title = styleMap(doc).cellStyles.find((c) => c.name === '_TITLE')!;
    expect(cell(title)).toMatchObject({
      margins: [0.06, 0.06, 0.06, 0.06, 0.18, 0.18],
      borders: Array(6).fill([-2, false, 0, 0.045, 1]),
    });

    for (const binary of [false, true]) {
      const back = dxfRawRoundTrip(doc, binary);
      expect(tableStyle(back).cellStyles.map(cell), `binary ${binary}`).toEqual(
        ts.cellStyles.map(cell),
      );
      expect(
        [
          tableStyle(back).dataCellStyle,
          tableStyle(back).titleCellStyle,
          tableStyle(back).headerCellStyle,
        ].map(cell),
        `binary ${binary}`,
      ).toEqual([ts.dataCellStyle, ts.titleCellStyle, ts.headerCellStyle].map(cell));
      expect(styleMap(back).cellStyles.map(cell), `binary ${binary}`).toEqual(
        styleMap(doc).cellStyles.map(cell),
      );
    }
  });

  it('0031 DXF writer writes VIEWPORT entities with their own group codes', () => {
    // _writeViewport wrote the id as 68, twist as 50, circle zoom as 51, the UCS icon as 72 and
    // the UCS vectors as single groups, and none of the R2000+ settings (UCS per viewport,
    // elevation, shade plot, grid, visual style, lighting), so every paper-space viewport
    // came back with twist 1000 and default UCS and lighting.
    const fields = (v: Viewport): unknown => ({
      id: v.id,
      center: [v.center.x, v.center.y],
      size: [v.width, v.height],
      viewHeight: v.viewHeight,
      snapAngle: v.snapAngle,
      twistAngle: v.twistAngle,
      circleZoomPercent: v.circleZoomPercent,
      status: v.status,
      styleSheetName: v.styleSheetName,
      renderMode: v.renderMode,
      ucsPerViewport: v.ucsPerViewport,
      displayUcsIcon: v.displayUcsIcon,
      ucs: [v.ucsOrigin, v.ucsXAxis, v.ucsYAxis].map((p) => [p.x, p.y, p.z]),
      ucsOrthographicType: v.ucsOrthographicType,
      elevation: v.elevation,
      shadePlotMode: v.shadePlotMode,
      majorGridLineFrequency: v.majorGridLineFrequency,
      visualStyle: handleHex(v.visualStyle),
      useDefaultLighting: v.useDefaultLighting,
      defaultLightingType: v.defaultLightingType,
      brightness: v.brightness,
      contrast: v.contrast,
      ambient: v.ambientLightColor
        ? [v.ambientLightColor.index, v.ambientLightColor.trueColor]
        : null,
    });
    const viewports = (d: CadDocument): Viewport[] =>
      [...d.getCadObjects()].filter((o): o is Viewport => o instanceof Viewport);

    for (const version of ['AC1015', 'AC1018', 'AC1032']) {
      // Read as @triya/io does, so the VISUALSTYLE the viewports point at is written too (0021).
      const doc = readDxfRaw(corpusBytes(`third-party/acadsharp/sample_${version}_ascii.dxf`));
      // The file's viewport 245: id 2, circle zoom 1000, UCS per viewport on.
      const v245 = doc.getCadObject(0x245) as Viewport;
      expect([v245.id, v245.circleZoomPercent, v245.ucsPerViewport], version).toEqual([
        2,
        1000,
        true,
      ]);
      if (version === 'AC1032') expect(v245.majorGridLineFrequency).toBe(5);

      for (const binary of [false, true]) {
        const back = dxfRawRoundTrip(doc, binary);
        expect(viewports(back).map(fields), `${version} binary ${binary}`).toEqual(
          viewports(doc).map(fields),
        );
      }
    }
  });

  it('0032 DXF ATTDEF and ATTRIB keep version, lock position and multiline text through a save', () => {
    // The reader took every 280 as the version (so the lock position overwrote it) and the
    // AcDbText 71 (mirror) as the multiline flag; the writer wrote no version, multiline flag
    // or embedded MTEXT.
    const fields = (a: AttributeBase): unknown => ({
      tag: a.tag,
      flags: a.flags,
      version: a.version,
      locked: a.isReallyLocked,
      attributeType: a.attributeType,
      mirror: a.mirror,
      horizontal: a.horizontalAlignment,
      vertical: a.verticalAlignment,
      prompt: a instanceof AttributeDefinition ? a.prompt : undefined,
      mText: a.mText
        ? {
            value: a.mText.value,
            at: [a.mText.insertPoint.x, a.mText.insertPoint.y],
            height: a.mText.height,
            attachment: a.mText.attachmentPoint,
          }
        : null,
    });
    const attributes = (d: CadDocument): AttributeBase[] => [
      ...[...d.getCadObjects()].filter(
        (o): o is AttributeDefinition => o instanceof AttributeDefinition,
      ),
      ...[...d.getCadObjects()]
        .filter((o): o is Insert => o instanceof Insert)
        .flatMap((i) => [...i.attributes]),
    ];

    for (const version of ['AC1015', 'AC1021', 'AC1024', 'AC1032']) {
      const doc = readDxfRaw(corpusBytes(`third-party/acadsharp/sample_${version}_ascii.dxf`));
      const multi = doc.getCadObject(0x796) as AttributeDefinition;
      // The file: R2007+ writes the lock position (280 1) after 74; R2010+ adds version 280 0
      // before the prompt; R2018 adds the multiline text (71 4, embedded MTEXT).
      expect(multi.isReallyLocked, version).toBe(version !== 'AC1015');
      expect(multi.version, version).toBe(0);
      // Before R2018 the multiline text lives in an XRECORD under the extension dictionary.
      const multiline = version === 'AC1032';
      expect(multi.attributeType, version).toBe(multiline ? 4 : 1);
      expect(multi.mText !== null, version).toBe(multiline);

      for (const binary of [false, true]) {
        const back = dxfRawRoundTrip(doc, binary);
        expect(attributes(back).map(fields), `${version} binary ${binary}`).toEqual(
          attributes(doc).map(fields),
        );
      }
    }
  });

  it('0033 DXF writer keeps HATCH patterns and every angle exact through a save', () => {
    // The writer converted radians to degrees with radToDeg, which can land one ulp away from
    // the degree value read, so angles drifted on every save. It wrapped hatch edge angles into
    // [0, 360) (ezdxf writes an ellipse edge ending at 472.87), and it dropped the pattern of a
    // hatch flagged solid, although AutoCAD writes one (52, 41, 77, 78) for SOLID too.
    const edgeAngles = (h: Hatch): number[] =>
      h.paths.flatMap((p) =>
        p.edges.flatMap((e) =>
          e instanceof HatchBoundaryPathArc || e instanceof HatchBoundaryPathEllipse
            ? [e.startAngle, e.endAngle]
            : [],
        ),
      );
    const fields = (o: CadObject): unknown => {
      if (o instanceof Hatch) {
        return {
          h: handleHex(o),
          pattern: [o.pattern.name, o.patternAngle, o.patternScale, o.isDouble],
          lines: o.pattern.lines.map((l) => [
            l.angle,
            l.basePoint.x,
            l.basePoint.y,
            l.offset.x,
            l.offset.y,
            ...l.dashLengths,
          ]),
          edges: edgeAngles(o),
        };
      }
      if (o instanceof Arc) return { h: handleHex(o), arc: [o.startAngle, o.endAngle] };
      if (o instanceof TextEntity) return { h: handleHex(o), rotation: o.rotation };
      return null;
    };
    const all = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .map(fields)
        .filter((f) => f !== null)
        .sort((a, b) =>
          String((a as { h: string }).h).localeCompare(String((b as { h: string }).h)),
        );

    const files = [
      'third-party/acadsharp/sample_AC1018_ascii.dxf',
      'third-party/acadsharp/sample_AC1015_ascii.dxf',
      'third-party/ezdxf/examples_dxf/clockwise_arcs_hatch.dxf',
      'third-party/ezdxf/examples_dxf/hatches_2.dxf',
      'third-party/ezdxf/examples_dxf/text_fonts.dxf',
    ];
    const docs = new Map(files.map((f) => [f, readDxfRaw(corpusBytes(f))]));

    // The file's SOLID hatch 2D in clockwise_arcs_hatch.dxf carries 52 45, 41 64 and two lines.
    const solid = docs.get(files[2]!)!.getCadObject(0x2d) as Hatch;
    expect([solid.isSolid, solid.patternScale, solid.pattern.lines.length]).toEqual([true, 64, 2]);
    // Hatch 233 in hatches_2.dxf has an ellipse edge from 348.71 to 472.87 degrees.
    const wrapped = edgeAngles(docs.get(files[3]!)!.getCadObject(0x233) as Hatch);
    expect(wrapped[1]! * (180 / Math.PI)).toBeCloseTo(472.8737, 3);

    for (const [file, doc] of docs) {
      for (const binary of [false, true]) {
        // Objects the writer still drops (M1-31) are not this patch's concern: compare the rest.
        const back = all(dxfRawRoundTrip(doc, binary));
        const kept = new Set(back.map((f) => (f as { h: string }).h));
        const before = all(doc).filter((f) => kept.has((f as { h: string }).h));
        expect(before.length, file).toBeGreaterThan(0);
        expect(back, `${file} binary ${binary}`).toEqual(before);
      }
    }
  });

  it('0034 DXF and DWG writers keep SORTENTSTABLE entries in the order read', () => {
    // Both writers iterated the table, which yields its entries sorted by sort handle, so a save
    // reordered every table whose entries are not stored in that order (AutoCAD stores them in
    // the order the draw-order commands left them).
    type Entry = { entity: CadObject | null; sortHandle: number };
    const entries = (t: SortEntitiesTable): string[] =>
      (t as unknown as { _sorters: Entry[] })._sorters.map(
        (e) => `${handleHex(e.entity)}:${e.sortHandle.toString(16).toUpperCase()}`,
      );
    const tables = (d: CadDocument): string[][] =>
      [...d.getCadObjects()]
        .filter((o): o is SortEntitiesTable => o instanceof SortEntitiesTable)
        .sort((a, b) => a.handle - b.handle)
        .map(entries);

    const dxf = readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1015_ascii.dxf'));
    // Table 355 lists LWPOLYLINE 353 (sort handle 35A) before HATCH 35A (sort handle 354).
    expect(entries(dxf.getCadObject(0x355) as SortEntitiesTable).slice(0, 2)).toEqual([
      '353:35A',
      '35A:354',
    ]);
    for (const binary of [false, true]) {
      expect(tables(dxfRawRoundTrip(dxf, binary)), `binary ${binary}`).toEqual(tables(dxf));
    }
    for (const version of ['AC1015', 'AC1018', 'AC1032']) {
      const dwg = readDwgRaw(`third-party/acadsharp/sample_${version}.dwg`);
      expect(tables(dwg).length, version).toBeGreaterThan(0);
      expect(tables(dwgRawRoundTrip(dwg)), version).toEqual(tables(dwg));
    }
  });

  it('0035 DXF writer writes the R2018 MTEXT column data', () => {
    // The R2018 MTEXT "Embedded Object" block (101) carries the column settings, but the writer
    // never wrote it, so every MTEXT came back with no columns, and the reader dropped the
    // defined extents (42/43) it holds.
    const fields = (m: MText): unknown => ({
      h: handleHex(m),
      columns: m.columnData ? { ...m.columnData, heights: [...m.columnData.heights] } : null,
      extents: [m.horizontalWidth, m.verticalHeight],
    });
    const all = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is MText => o instanceof MText)
        .sort((a, b) => a.handle - b.handle)
        .map(fields);

    const files = [
      'third-party/acadsharp/sample_AC1032_ascii.dxf',
      'third-party/ezdxf/examples_dxf/columns_R2018.dxf',
      'third-party/ezdxf/examples_dxf/mtext_columns_R2018.dxf',
    ];
    for (const file of files) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(
        [...doc.getCadObjects()].some((o) => o instanceof MText && o.hasColumns),
        file,
      ).toBe(true);
      for (const binary of [false, true]) {
        expect(all(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(all(doc));
      }
    }
    // mtext_columns_R2018.dxf: dynamic columns with manual heights 20, 30, 0 and extents 62 x 30.
    const doc = readDxfRaw(corpusBytes(files[2]!));
    const manual = [...doc.getCadObjects()].find(
      (o): o is MText => o instanceof MText && (o.columnData?.heights.length ?? 0) === 3,
    );
    expect(manual && fields(manual)).toMatchObject({
      columns: { columnType: 2, columnCount: 3, width: 20, gutter: 1, heights: [20, 30, 0] },
      extents: [62, 30],
    });
  });

  it('0036 DWG reader keeps the R2018 MTEXT column count', () => {
    // The reader read the column count but never stored it, so the writer wrote 0 and the
    // heights that follow were dropped on the next read.
    const columns = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is MText => o instanceof MText && o.hasColumns)
        .sort((a, b) => a.handle - b.handle)
        .map((m) => [handleHex(m), m.columnData?.columnCount, m.columnData?.heights]);
    const doc = readDwgRaw('third-party/acadsharp/sample_AC1032.dwg');
    // MTEXT 3EC: one dynamic column of height 0, as the DXF export of the same drawing has it.
    expect((doc.getCadObject(0x3ec) as MText).columnData?.columnCount).toBe(1);
    expect(columns(dwgRawRoundTrip(doc))).toEqual(columns(doc));
  });

  it('0037 DXF writer writes MULTILEADER entities with their own group codes', () => {
    // _writeMultiLeader wrote a handful of groups on the wrong codes (the line colour as 171,
    // the attachment direction as 175 and 176) and none of the rest, and _writeAnnotContext
    // wrote the content base point as the base point and no text or background settings, so
    // every multileader came back with default styling and an empty label. The reader also
    // skipped the branch (LEADER{) groups and read the context text colour as RGB.
    const plain = (v: unknown): unknown => {
      if (v == null || typeof v !== 'object') return v;
      if ('handle' in v) return handleHex(v as CadObject);
      if ('_color' in v) return (v as { _color: number })._color;
      if ('x' in v && 'y' in v) return [...Object.values(v as object)];
      if (Array.isArray(v)) return v.map(plain);
      return v;
    };
    const pick = (o: object, keys: string[]): unknown =>
      Object.fromEntries(keys.map((k) => [k, plain((o as Record<string, unknown>)[k])]));
    const main = [
      'arrowheadSize',
      'contentType',
      'enableAnnotationScale',
      'enableDogleg',
      'enableLanding',
      'extendedToText',
      'landingDistance',
      'leaderLineType',
      'leaderLineWeight',
      'lineColor',
      'pathType',
      'propertyOverrideFlags',
      'scaleFactor',
      'style',
      'textAligninIPE',
      'textAttachmentDirection',
      'textAttachmentPoint',
      'textBottomAttachment',
      'textDirectionNegative',
      'textTopAttachment',
      'textAlignment',
      'textAngle',
      'textColor',
      'textFrame',
      'textLeftAttachment',
      'textRightAttachment',
      'textStyle',
      'blockContentColor',
      'blockContentConnection',
      'blockContentRotation',
      'blockContentScale',
    ];
    const context = [
      'arrowheadSize',
      'backgroundFillColor',
      'backgroundFillEnabled',
      'backgroundMaskFillOn',
      'backgroundScaleFactor',
      'backgroundTransparency',
      'baseDirection',
      'basePoint',
      'baseVertical',
      'blockContentConnection',
      'boundaryHeight',
      'boundaryWidth',
      'columnFlowReversed',
      'columnGutter',
      'columnSizes',
      'columnType',
      'columnWidth',
      'contentBasePoint',
      'direction',
      'flowDirection',
      'hasContentsBlock',
      'hasTextContents',
      'landingGap',
      'lineSpacing',
      'lineSpacingFactor',
      'normalReversed',
      'scaleFactor',
      'textAlignment',
      'textAttachmentPoint',
      'textBottomAttachment',
      'textColor',
      'textHeight',
      'textHeightAutomatic',
      'textLabel',
      'textLeftAttachment',
      'textLocation',
      'textNormal',
      'textRightAttachment',
      'textRotation',
      'textStyle',
      'textTopAttachment',
      'wordBreak',
    ];
    const fields = (m: MultiLeader): unknown => ({
      h: handleHex(m),
      main: pick(m, main),
      context: pick(m.contextData, context),
      leaders: m.contextData.leaderRoots.map((r) => ({
        root: pick(r, [
          'contentValid',
          'connectionPoint',
          'direction',
          'leaderIndex',
          'landingDistance',
        ]),
        lines: r.lines.map((l) => l.points.map(plain)),
      })),
    });
    const all = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is MultiLeader => o instanceof MultiLeader)
        .sort((a, b) => a.handle - b.handle)
        .map(fields);

    const files = [
      ...['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].map(
        (v) => `third-party/acadsharp/sample_${v}_ascii.dxf`,
      ),
      'third-party/ezdxf/examples_dxf/uncommon.dxf',
    ];
    for (const file of files) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(all(doc).length, file).toBeGreaterThan(0);
      for (const binary of [false, true]) {
        expect(all(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(all(doc));
      }
    }
    // The first multileader of the samples: "MLeader text, hello!" on style D8, one leader.
    const first = all(readDxfRaw(corpusBytes(files[5]!)))[0] as {
      main: Record<string, unknown>;
      context: Record<string, unknown>;
      leaders: unknown[];
    };
    expect(first.context.textLabel).toBe('MLeader text, hello!');
    expect([first.main.style, first.main.contentType, first.leaders.length]).toEqual(['D8', 2, 1]);
    // The reader decoded the context text colour 0xC0000000 as RGB 0,0,0 and skipped the
    // branch groups; the file has ByLayer and the branch 10/11/40 below.
    expect(first.context.textColor).toBe(256);
    expect(first.leaders[0]).toMatchObject({
      root: {
        connectionPoint: [1083.321045165764, 23.23924387283501, 0],
        direction: [1, 0, 0],
        landingDistance: 0.36,
      },
    });
  });

  const dxfSamples = ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].map(
    (v) => `third-party/acadsharp/sample_${v}_ascii.dxf`,
  );

  it('0038 DXF writer writes the common entity data of ENDBLK', () => {
    // _writeBlockEnd wrote only the AcDbEntity marker and the layer, so the colour, linetype,
    // lineweight and the rest of an ENDBLK (AutoCAD keeps them, and copies them from BLOCK)
    // came back as their defaults.
    const ends = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is BlockEnd => o instanceof BlockEnd)
        .sort((a, b) => a.handle - b.handle)
        .map((e) => [
          handleHex(e),
          e.layer?.name,
          e.lineType?.name,
          e.color.index,
          e.lineWeight,
          e.lineTypeScale,
          e.isInvisible,
        ]);
    for (const file of dxfSamples) {
      const doc = readDxfRaw(corpusBytes(file));
      for (const binary of [false, true]) {
        expect(ends(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(ends(doc));
      }
    }
    // sample_AC1015: ENDBLK 9D3 has colour 193, as its BLOCK has.
    const doc = readDxfRaw(corpusBytes(dxfSamples[0]!));
    expect((doc.getCadObject(0x9d3) as BlockEnd).color.index).toBe(193);
  });

  it('0039 DXF reader decodes the caret codes of TOLERANCE text', () => {
    // The text went through the generic map, which keeps "^J" undecoded, and the writer then
    // escaped the caret again ("^ J"), so every multi-line feature control frame grew a line
    // of literal text on each save. The DWG of the same drawing holds a real line break.
    const texts = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is Tolerance => o instanceof Tolerance)
        .sort((a, b) => a.handle - b.handle)
        .map((t) => [handleHex(t), t.text]);
    const dwg = readDwgRaw('third-party/acadsharp/sample_AC1015.dwg');
    const dxf = readDxfRaw(corpusBytes(dxfSamples[0]!));
    expect((dwg.getCadObject(0x823) as Tolerance).text).toBe('99\na');
    expect((dxf.getCadObject(0x823) as Tolerance).text).toBe('99\na');
    for (const file of dxfSamples) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(texts(doc).length, file).toBeGreaterThan(0);
      for (const binary of [false, true]) {
        expect(texts(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(texts(doc));
      }
    }
  });

  it('0040 DXF writer writes MESH version, blend crease and subdivision level on their codes', () => {
    // _writeMesh wrote the subdivision level as 71 (the version) and 0 for 72 and 91, so a save
    // turned every version 2 mesh into version 0 and dropped its blend crease and level.
    const meshes = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is Mesh => o instanceof Mesh)
        .sort((a, b) => a.handle - b.handle)
        .map((m) => [handleHex(m), m.version, m.blendCrease, m.subdivisionLevel]);
    for (const file of dxfSamples) {
      const doc = readDxfRaw(corpusBytes(file));
      for (const binary of [false, true]) {
        expect(meshes(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(
          meshes(doc),
        );
      }
    }
    const doc = readDxfRaw(corpusBytes(dxfSamples[0]!));
    expect(meshes(doc)).toContainEqual(['343', 2, 0, 0]);
  });

  // Every cell of every table, with the fields a DWG save must keep.
  const tableCells = (d: CadDocument): unknown[] =>
    [...d.getCadObjects()]
      .filter((o): o is TableEntity => o instanceof TableEntity)
      .sort((a, b) => a.handle - b.handle)
      .flatMap((t) =>
        t.rows.flatMap((row, r) =>
          row.cells.map((cell, c) => {
            const o = cell.styleOverride;
            const border = (b: typeof o.topBorder): unknown => [
              b.color.index,
              b.lineWeight,
              b.isInvisible,
            ];
            return {
              at: `${handleHex(t)}:${r}:${c}`,
              style: [
                o.cellAlignment,
                o.isFillColorOn,
                o.backgroundColor.index,
                o.contentColor.index,
                o.textStyle?.name,
                o.textHeight,
              ],
              borders: [o.topBorder, o.rightBorder, o.bottomBorder, o.leftBorder].map(border),
              geometry: [cell.geometryFlags, cell.geometryWidth, cell.geometryHeight],
            };
          }),
        ),
      );

  it('0041 DWG writer writes the cell overrides of R2004 and R2007 tables', () => {
    // Before R2010 a table cell carries its own overrides (alignment, colours, text height,
    // borders) behind a flag word; the writer always wrote "no overrides", so a save reset
    // every overridden cell to its table style.
    for (const version of ['AC1018', 'AC1021']) {
      const doc = readDwgRaw(`third-party/acadsharp/sample_${version}.dwg`);
      expect(tableCells(dwgRawRoundTrip(doc)), version).toEqual(tableCells(doc));
    }
    // Table 528, row 4 cell 0: background 165, middle-centre, text height 4, borders of
    // colour 63 and lineweight 0.40 mm, hidden.
    const cell = (
      tableCells(readDwgRaw('third-party/acadsharp/sample_AC1018.dwg')) as {
        at: string;
      }[]
    ).find((x) => x.at === '528:4:0');
    expect(cell).toMatchObject({
      style: [5, false, 165, 7, undefined, 4],
      borders: [[63, 40, true], expect.anything(), expect.anything(), [63, 40, true]],
    });
  });

  it('0042 DWG writer keeps the geometry of R2010+ table cells that list no content geometry', () => {
    // The writer wrote the cell geometry (flags, width, height) only when the cell listed
    // content geometry, so a cell with none lost its flags and size on a save.
    for (const version of ['AC1024', 'AC1027', 'AC1032']) {
      const doc = readDwgRaw(`third-party/acadsharp/sample_${version}.dwg`);
      expect(tableCells(dwgRawRoundTrip(doc)), version).toEqual(tableCells(doc));
    }
    const cell = (
      tableCells(readDwgRaw('third-party/acadsharp/sample_AC1024.dwg')) as {
        at: string;
      }[]
    ).find((x) => x.at === '528:0:1');
    expect(cell).toMatchObject({ geometry: [3, 0.0683964098745459, 0.0683964098745459] });
  });

  it('0043 DWG writer keeps the block record of R2004 and R2007 block cells', () => {
    // Before R2010 a block cell names its block record as the cell value; the writer took it
    // from the cell content, which such cells do not have, and wrote a null handle.
    const blocks = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is TableEntity => o instanceof TableEntity)
        .flatMap((t) =>
          t.rows.flatMap((row, r) =>
            row.cells.map((cell, c) => `${handleHex(t)}:${r}:${c}:${handleHex(cell.value)}`),
          ),
        );
    for (const version of ['AC1018', 'AC1021']) {
      const doc = readDwgRaw(`third-party/acadsharp/sample_${version}.dwg`);
      expect(blocks(doc), version).toContain('A35:1:3:A0B');
      expect(blocks(dwgRawRoundTrip(doc)), version).toEqual(blocks(doc));
    }
  });

  it('0044 DXF reader and writers keep one paper image origin for a layout', () => {
    // The DXF reader stored 148/149 in paperImageOriginX/Y while both writers and the DWG
    // reader use paperImageOrigin, so a DXF save wrote 0,0.
    const origins = (d: CadDocument): unknown[] =>
      [...d.layouts!].map((l) => [l.name, l.paperImageOrigin.x, l.paperImageOrigin.y]);
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/viewports.dxf'));
    expect(origins(doc)).toContainEqual(['Model', 114.98, 300.29]);
    for (const binary of [false, true]) {
      expect(origins(dxfRawRoundTrip(doc, binary)), `binary ${binary}`).toEqual(origins(doc));
    }
  });

  it('0045 DXF writer writes the standard scale of a layout as 147', () => {
    // 147 is the standard scale factor (the value behind 75); the writer wrote the custom
    // print scale (142 / 143) there instead.
    const scales = (d: CadDocument): unknown[] =>
      [...d.layouts!].map((l) => [l.name, l.standardScale]);
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/viewports.dxf'));
    expect(scales(doc)).toContainEqual(['Model', 0.069]);
    for (const binary of [false, true]) {
      expect(scales(dxfRawRoundTrip(doc, binary)), `binary ${binary}`).toEqual(scales(doc));
    }
  });

  it('0046 DXF LTYPE alignment (72) is read and written as a character code', () => {
    // 72 holds the character code of the alignment ("65" for "A"). The reader kept the digits
    // as the alignment and the writer converted the string to a number, so "A" went out as 0
    // and a DWG save wrote "6".
    const alignments = (d: CadDocument): unknown[] =>
      [...d.lineTypes!].map((l) => [l.name, l.alignment]);
    for (const file of [
      'third-party/ezdxf/integration_tests/ASCII_R12.dxf',
      'third-party/acadsharp/sample_AC1015_ascii.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      // Every linetype of these files is aligned "A" (72 = 65).
      expect(new Set(alignments(doc).map((a) => (a as string[])[1])), file).toEqual(new Set(['A']));
      for (const binary of [false, true]) {
        expect(alignments(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(
          alignments(doc),
        );
      }
    }
  });

  it('0047 DXF writer writes ARC_DIMENSION entities', () => {
    // _writeEntity had no DimensionArc branch, so an arc length dimension was written as an
    // ARC_DIMENSION with only its common entity data, and read back with no block, points or
    // angles. The leader points 16/17 were also written only when 71 says there is a leader;
    // AutoCAD writes them always.
    const arcs = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is DimensionArc => o instanceof DimensionArc)
        .map((a) => ({
          h: handleHex(a),
          block: a.block?.name,
          style: a.style?.name,
          points: [
            a.definitionPoint,
            a.textMiddlePoint,
            a.firstPoint,
            a.secondPoint,
            a.center,
            a.leaderPoint1,
            a.leaderPoint2,
          ].map((p) => [p.x, p.y, p.z]),
          angles: [a.startAngle, a.endAngle],
          flags: [a.isPartial, a.hasLeader, a.attachmentPoint],
        }));
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/uncommon.dxf'));
    expect(arcs(doc)).toHaveLength(1);
    expect(arcs(doc)[0]).toMatchObject({
      h: '3F6',
      block: '*D19',
      angles: [6.222496893710236, 1.45471846497695],
      flags: [false, false, 5],
    });
    for (const binary of [false, true]) {
      expect(arcs(dxfRawRoundTrip(doc, binary)), `binary ${binary}`).toEqual(arcs(doc));
    }
  });

  const dwgSamples = ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].map(
    (v) => `third-party/acadsharp/sample_${v}.dwg`,
  );

  it('0048 DWG writer keeps the frozen-in-new-viewports flag of R2000+ layers', () => {
    // The R2000+ flag word took bit 4 (frozen in new viewports) from the frozen flag, so a save
    // froze every frozen layer in new viewports and thawed the rest.
    const layers = (d: CadDocument): unknown[] =>
      [...d.layers!].map((l) => [l.name, l.flags, l.isOn, l.plotFlag]);
    for (const file of dwgSamples) {
      const doc = readDwgRaw(file);
      expect(layers(dwgRawRoundTrip(doc)), file).toEqual(layers(doc));
    }
    // sample_AC1015: layer 279 is frozen (65), layer 283 frozen in new viewports only (66).
    const doc = readDwgRaw(dwgSamples[0]!);
    expect(
      [doc.getCadObject(0x279), doc.getCadObject(0x283)].map(
        (l) => (l as unknown as { flags: number }).flags,
      ),
    ).toEqual([65, 66]);
  });

  it('0049 DWG writer writes the linetype index of pre-R2018 MLINESTYLE elements', () => {
    // Before R2018 an MLINESTYLE element names its linetype by index (0x7FFF ByLayer, 0x7FFE
    // ByBlock, otherwise the position in the LTYPE table); the writer always wrote 0, so every
    // element came back with the first linetype of the table.
    const styles = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is MLineStyle => o instanceof MLineStyle)
        .map((m) => [handleHex(m), m.elements.map((e) => e.lineType?.name)]);
    for (const file of dwgSamples) {
      const doc = readDwgRaw(file);
      expect(styles(dwgRawRoundTrip(doc)), file).toEqual(styles(doc));
    }
    expect(styles(readDwgRaw(dwgSamples[0]!))).toContainEqual(['18', ['ByLayer', 'ByLayer']]);
  });

  it('0050 DWG writer keeps the insert list of every block record', () => {
    // The writer listed only the model-space INSERTs of a block (and, for *T blocks, the ones
    // read), so a block inserted from another block, a dimension or a table lost those entries,
    // and the list lost its order.
    const inserts = (d: CadDocument): unknown[] =>
      [...d.blockRecords!].map((r) => [r.name, r.insertHandles.map((h) => h.toString(16))]);
    for (const file of dwgSamples) {
      const doc = readDwgRaw(file);
      expect(inserts(dwgRawRoundTrip(doc)), file).toEqual(inserts(doc));
    }
    // sample_AC1015: my_block lists 10 handles, from model space, *T16 and *U25.
    const doc = readDwgRaw(dwgSamples[0]!);
    expect((doc.getCadObject(0xa0b) as BlockRecord).insertHandles).toHaveLength(10);
  });

  it('0051 DWG writer writes the R2000+ header arrow blocks', () => {
    // From R2000 the header names $DIMBLK, $DIMBLK1 and $DIMBLK2 by block record handle; the
    // writer wrote null handles, so a save reset the drawing's arrowheads to closed filled.
    const blocks = (d: CadDocument): unknown[] => [
      d.header!.dimensionBlockName,
      d.header!.dimensionBlockNameFirst ?? '',
      d.header!.dimensionBlockNameSecond ?? '',
    ];
    for (const file of dwgSamples) {
      const doc = readDwgRaw(file);
      expect(blocks(dwgRawRoundTrip(doc)), file).toEqual(blocks(doc));
    }
    expect(blocks(readDwgRaw(dwgSamples[0]!))[0]).toBe('_BoxBlank');
  });

  it('0052 DWG writer writes the annotation a LEADER is attached to', () => {
    // The writer wrote a null annotation handle, so every leader came off its MTEXT, tolerance
    // or block reference on a save.
    const leaders = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is Leader => o instanceof Leader)
        .map((l) => [handleHex(l), handleHex(l.associatedAnnotation)]);
    for (const file of ['third-party/acadsharp/sample_AC1014.dwg', ...dwgSamples]) {
      const doc = readDwgRaw(file);
      expect(leaders(dwgRawRoundTrip(doc)), file).toEqual(leaders(doc));
    }
    expect(leaders(readDwgRaw(dwgSamples[0]!))).toContainEqual(['512', '513']);
  });

  it('0053 DWG writer writes the colour index of pre-R2004 DBCOLOR objects', () => {
    // Before R2004 a DBCOLOR holds only a colour index; the writer wrote 0 (ByBlock).
    const colors = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is BookColor => o instanceof BookColor)
        .map((c) => [handleHex(c), c.color.index]);
    for (const file of ['third-party/acadsharp/sample_AC1014.dwg', dwgSamples[0]!]) {
      const doc = readDwgRaw(file);
      expect(colors(doc).length, file).toBeGreaterThan(0);
      expect(colors(dwgRawRoundTrip(doc)), file).toEqual(colors(doc));
    }
    expect(colors(readDwgRaw(dwgSamples[0]!))).toContainEqual(['996', 42]);
  });

  it('0054 DXF writer leaves out R2007+ header flags the drawing never set', () => {
    // $LOFTNORMALS, $LIGHTGLYPHDISPLAY, $DWFFRAME and $DGNFRAME are single-character flags.
    // A drawing without them (any file before R2007) reads them as '', and writing every
    // header variable (as @triya/io does) put out '' under group 280, which reads back as "0".
    const flags = (d: CadDocument): unknown[] => [
      d.header!.loftedObjectNormals,
      d.header!.displayLightGlyphs,
      d.header!.dwgUnderlayFramesVisibility,
      d.header!.dgnUnderlayFramesVisibility,
    ];
    for (const file of [
      'third-party/acadsharp/sample_AC1015_ascii.dxf',
      'third-party/ezdxf/examples_dxf/Minimal_DXF_AC1021.dxf',
      'third-party/acadsharp/sample_AC1032_ascii.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      for (const binary of [false, true]) {
        expect(flags(dxfAllHeaderRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(
          flags(doc),
        );
      }
    }
    expect(flags(readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1015_ascii.dxf')))).toEqual(
      ['', '', '', ''],
    );
  });

  it('0055 DXF reader and writer keep single-character header variables as characters', () => {
    // $DIMDSEP (70) holds the character code of the decimal separator and the R2007+ flags
    // (280) a character whose code is the setting, as in the DWG header. The DXF reader kept
    // the digits ("46" for "."), so the same drawing read differently from DXF and DWG, and a
    // DXF-to-DWG save wrote the code of the first digit ("4").
    const chars = (d: CadDocument): unknown[] => [
      d.header!.dimensionDecimalSeparator,
      d.header!.loftedObjectNormals,
      d.header!.displayLightGlyphs,
      d.header!.dwgUnderlayFramesVisibility,
      d.header!.dgnUnderlayFramesVisibility,
    ];
    for (const version of ['AC1018', 'AC1032']) {
      const dxf = readDxfRaw(corpusBytes(`third-party/acadsharp/sample_${version}_ascii.dxf`));
      const dwg = readDwgRaw(`third-party/acadsharp/sample_${version}.dwg`);
      expect(chars(dxf), version).toEqual(chars(dwg));
      for (const binary of [false, true]) {
        expect(chars(dxfAllHeaderRoundTrip(dxf, binary)), `${version} binary ${binary}`).toEqual(
          chars(dxf),
        );
      }
    }
    expect(chars(readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1032_ascii.dxf')))).toEqual(
      ['.', '\u0001', '\u0001', '\u0002', '\u0000'],
    );
  });

  it('0056 DXF writer writes the default pixel size of IMAGEDEF objects', () => {
    // 11/21 holds the size of one pixel in drawing units; the writer left it out, so a saved
    // image definition came back with the 1 x 1 default.
    const sizes = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is ImageDefinition => o instanceof ImageDefinition)
        .map((i) => [handleHex(i), i.defaultSize.x, i.defaultSize.y]);
    for (const file of [
      'third-party/acadsharp/sample_AC1015_ascii.dxf',
      'third-party/ezdxf/examples_dxf/images.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(sizes(doc).length, file).toBeGreaterThan(0);
      for (const binary of [false, true]) {
        expect(sizes(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(sizes(doc));
      }
    }
    expect(
      sizes(readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1015_ascii.dxf')))[0],
    ).toEqual(['8C4', 0.2645833333333333, 0.2645833333333333]);
  });

  it('0057 DXF writer writes the visual style of VIEW table entries', () => {
    // A named view keeps its visual style in 348; the writer left it out, so saved views lost
    // their visual style.
    const styles = (d: CadDocument): unknown[] =>
      [...d.views!].map((v) => [v.name, handleHex(v.visualStyle)]);
    for (const version of ['AC1021', 'AC1032']) {
      const doc = readDxfRaw(corpusBytes(`third-party/acadsharp/sample_${version}_ascii.dxf`));
      expect(
        styles(doc).filter((s) => (s as unknown[])[1] !== undefined).length,
        version,
      ).toBeGreaterThan(0);
      for (const binary of [false, true]) {
        expect(styles(dxfRawRoundTrip(doc, binary)), `${version} binary ${binary}`).toEqual(
          styles(doc),
        );
      }
    }
  });

  it('0058 DXF writer writes the 298 flag of MLEADERSTYLE objects as read', () => {
    // The writer always wrote false, so styles that set it changed on every save.
    const flags = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is MultiLeaderStyle => o instanceof MultiLeaderStyle)
        .map((m) => [handleHex(m), m.unknownFlag298]);
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/text.dxf'));
    expect(flags(doc)).toContainEqual(['2D8', true]);
    for (const binary of [false, true]) {
      expect(flags(dxfRawRoundTrip(doc, binary)), `binary ${binary}`).toEqual(flags(doc));
    }
  });

  it('0059 DWG writer keeps the null object references of XRECORD entries', () => {
    // An XRECORD may hold a 340 entry that points at nothing (handle 0). The writer skipped
    // those entries, so the record came back shorter.
    const records = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is XRecord => o instanceof XRecord)
        .map((x) => [handleHex(x), [...x.entries].map((e) => e.code)]);
    const doc = readDwgRaw('third-party/acadsharp/sample_AC1014.dwg');
    expect(records(doc)).toContainEqual(['118C', [340]]);
    expect(records(dwgRawRoundTrip(doc))).toEqual(records(doc));
  });

  it('0060 DWG writer writes the default entry of a dictionary with default', () => {
    // The default entry (an ACDBPLACEHOLDER in R14 files) may be owned by nothing else; the
    // writer wrote its handle but never the object, so it read back as null.
    const defaults = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is CadDictionaryWithDefault => o instanceof CadDictionaryWithDefault)
        .map((x) => [handleHex(x), handleHex(x.defaultEntry)]);
    for (const file of ['third-party/acadsharp/sample_AC1014.dwg', ...dwgSamples]) {
      const doc = readDwgRaw(file);
      expect(defaults(doc).length, file).toBeGreaterThan(0);
      expect(defaults(dwgRawRoundTrip(doc)), file).toEqual(defaults(doc));
    }
    expect(defaults(readDwgRaw('third-party/acadsharp/sample_AC1014.dwg'))).toContainEqual([
      'E',
      'F',
    ]);
  });

  it('0061 DXF writer writes DIMASSOC objects', () => {
    // The writer refused DIMASSOC ("Object not implemented") although it has a field writer,
    // so every associative dimension lost its association object and the reactors pointing
    // at it on a DXF save.
    const assocs = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o) => o.objectName === 'DIMASSOC')
        .map((o) => {
          const a = o as unknown as { dimension: CadObject | null; associativityFlags: number };
          return [handleHex(o), handleHex(a.dimension), a.associativityFlags];
        });
    for (const file of [
      'third-party/acadsharp/sample_AC1015_ascii.dxf',
      'third-party/ezdxf/examples_dxf/uncommon.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(assocs(doc).length, file).toBeGreaterThan(0);
      for (const binary of [false, true]) {
        expect(assocs(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(
          assocs(doc),
        );
      }
    }
  });

  it('0062 DXF writer writes the IMAGEDEF_REACTOR of every image', () => {
    // An IMAGE hard-owns its reactor (360) but nothing queued the reactor for the OBJECTS
    // section, so it was dropped and the image and its definition lost the link.
    const reactors = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is RasterImage => o instanceof RasterImage)
        .map((i) => [handleHex(i), handleHex(i.definitionReactor)]);
    for (const file of [
      'third-party/acadsharp/sample_AC1015_ascii.dxf',
      'third-party/ezdxf/examples_dxf/images.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(
        reactors(doc).some((r) => (r as unknown[])[1] !== undefined),
        file,
      ).toBe(true);
      for (const binary of [false, true]) {
        expect(reactors(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(
          reactors(doc),
        );
      }
    }
  });

  it('0063 DXF proxy objects are kept as read and written back raw (DEC-040)', () => {
    // The DXF writer has no ACAD_PROXY_OBJECT writer ("Object not implemented"), and the reader
    // keeps neither the object references nor the class-id codes, so every proxy was dropped.
    const proxies = (d: CadDocument): unknown[] =>
      [...d.getCadObjects()]
        .filter((o): o is ProxyObject => o instanceof ProxyObject)
        .map((p) => [
          handleHex(p),
          handleHex(p.owner as CadObject | null),
          p.binaryData?.length ?? 0,
        ]);
    for (const file of [
      'third-party/ezdxf/integration_tests/bin_dxf_r13.dxf',
      'third-party/ezdxf/integration_tests/bin_dxf_r14.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(proxies(doc).length, file).toBe(49);
      for (const binary of [false, true]) {
        const back = dxfRawRoundTrip(doc, binary);
        expect(proxies(back), `${file} binary ${binary}`).toEqual(proxies(doc));
        // Binary chunks read back from a Buffer are Buffers; compare their bytes.
        const raw = (d: CadDocument): unknown =>
          (
            d.getCadObject(0x25) as unknown as { rawDxfCodes: { code: number; value: unknown }[] }
          ).rawDxfCodes.map(({ code, value }) => [
            code,
            value instanceof Uint8Array ? [...value] : value,
          ]);
        expect(raw(back), `${file} binary ${binary}`).toEqual(raw(doc));
      }
    }
  });

  it('0064 R12 DXF saves write the $MODEL_SPACE and $PAPER_SPACE blocks', () => {
    // AutoCAD's R12 DXF export writes both space blocks, empty, so their ENDBLK handles survive;
    // the acad-ts R12 writer skipped them and a reopened file made new ones.
    const ends = (d: CadDocument): (string | undefined)[] =>
      ['*Model_Space', '*Paper_Space'].map((n) => handleHex(d.blockRecords?.get(n)?.blockEnd));
    for (const file of [
      'third-party/acadsharp/sample_AC1009_ascii.dxf',
      'third-party/ezdxf/integration_tests/ASCII_R12.dxf',
      'third-party/ezdxf/integration_tests/bin_dxf_r12.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(ends(doc), file).not.toContain(undefined);
      for (const binary of [false, true]) {
        const bytes = writeDxf(doc, binary);
        expect(Buffer.from(bytes).includes('$MODEL_SPACE'), `${file} binary ${binary}`).toBe(true);
        expect(ends(readDxfRaw(bytes)), `${file} binary ${binary}`).toEqual(ends(doc));
      }
    }
  });

  it('0065 R12 DXF saves keep the DIMSTYLE handle', () => {
    // R12 DIMSTYLE entries carry their handle in 105, because 5 is DIMBLK there. The writer left
    // it out, so a reopened file gave the style a new handle.
    const file = 'third-party/ezdxf/integration_tests/r12_blocks_with_no_names.dxf';
    const doc = readDxfRaw(corpusBytes(file));
    const standard = (d: CadDocument): string | undefined =>
      handleHex(d.dimensionStyles?.get('Standard'));
    expect(standard(doc)).toBe('2B');
    for (const binary of [false, true]) {
      expect(standard(dxfRawRoundTrip(doc, binary)), `binary ${binary}`).toBe('2B');
    }
  });

  // The acadsharp samples hold the same two tables in every version: R2000/R2004 cells carry
  // their override flags in 177 and their text in 1, R2007+ cells in 91 and a CELL_VALUE block.
  const tableSamples = ['1015', '1018', '1021', '1024', '1027', '1032'].map(
    (v) => `third-party/acadsharp/sample_AC${v}_ascii.dxf`,
  );
  const [tablesR2000, tablesR2018] = [tableSamples[0]!, tableSamples[5]!];
  const tables = (d: CadDocument): TableEntity[] =>
    [...d.getCadObjects()].filter((o): o is TableEntity => o instanceof TableEntity);

  it('0066 DXF ACAD_TABLE reader keeps cell override flags and the table-wide overrides', () => {
    for (const file of [tablesR2000, tablesR2018]) {
      const table = tables(readDxfRaw(corpusBytes(file))).find((t) => t.handle === 0x528)!;
      // The table-wide overrides follow 93 and end at the first row height; 41 is the vertical
      // cell margin there, not the block reference's X scale.
      expect(
        table.tableOverrideDxfCodes.map((c) => c.code),
        file,
      ).toEqual([93, 94, 95, 96, 40, 41, 140, 140, 140]);
      expect(table.xScale, file).toBe(1);
      const cell = table.getCell(4, 0);
      expect(cell.overrideFlags, file).toBe(file === tablesR2000 ? 26223 : 419439);
      expect(cell.styleOverride.cellAlignment, file).toBe(5);
      expect(cell.styleOverride.backgroundColor.index, file).toBe(165);
    }
  });

  it('0067 DXF values keep their unit, format and formatted value; empty ones stay empty', () => {
    const values = (d: CadDocument): unknown =>
      tables(d).flatMap((t) =>
        t.rows.flatMap((r) =>
          r.cells.flatMap((c) =>
            c.contents.map(({ cadValue: v }) => [
              v.flags,
              v.valueType,
              v.value,
              v.units,
              v.format,
              v.formattedValue,
            ]),
          ),
        ),
      );
    const doc = readDxfRaw(corpusBytes(tablesR2018));
    for (const binary of [false, true]) {
      expect(values(dxfRawRoundTrip(doc, binary)), `binary ${binary}`).toEqual(values(doc));
    }
    // An unknown-typed value was written as 91=0, which the reader cannot set, so the FIELD
    // holding it was lost.
    const uncommon = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/uncommon.dxf'));
    expect(uncommon.getCadObject(0x5f8)?.objectName).toBe('FIELD');
    expect(dxfRawRoundTrip(uncommon, false).getCadObject(0x5f8)?.objectName).toBe('FIELD');
  });

  it('0068 DXF writer writes ACAD_TABLE entities', () => {
    // The writer had no ACAD_TABLE branch, so tables went out as bare INSERTs and were lost.
    const project = (d: CadDocument): unknown =>
      tables(d).map((t) => ({
        handle: handleHex(t),
        block: t.block?.name,
        style: handleHex(t.style as CadObject | null),
        insertPoint: t.insertPoint,
        overrides: t.tableOverrideDxfCodes.map(({ code, value }) => [code, String(value)]),
        rows: t.rows.map((r) => r.height),
        columns: t.columns.map((c) => c.width),
        cells: t.rows.flatMap((r) =>
          r.cells.map((c) => [
            c.type,
            c.edgeFlags,
            c.mergedValue,
            c.overrideFlags,
            c.virtualEdgeFlag,
            c.styleOverride.textHeight,
            c.styleOverride.cellAlignment,
            c.styleOverride.topBorder.lineWeight,
            c.styleOverride.leftBorder.color.index,
            c.contents.map((x) => x.cadValue.value),
          ]),
        ),
      }));
    for (const file of tableSamples) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(tables(doc).length, file).toBeGreaterThan(0);
      for (const binary of [false, true]) {
        expect(project(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(
          project(doc),
        );
      }
    }
  });

  it('0069 DXF XRECORDs keep caret-escaped strings and unresolved handles', () => {
    const entries = (d: CadDocument, handle: number): unknown =>
      (d.getCadObject(handle) as XRecord).entries.map((e) => [
        e.code,
        e.value instanceof Object && 'handle' in e.value
          ? handleHex(e.value as CadObject)
          : e.value,
      ]);
    const doc = readDxfRaw(corpusBytes(tablesR2000));
    // 0x14FD holds a string with a line break; 0x148C a handle to an object acad-ts never reads.
    expect(String(entries(doc, 0x14fd))).toContain('\n');
    for (const binary of [false, true]) {
      const back = dxfRawRoundTrip(doc, binary);
      for (const handle of [0x14fd, 0x148c]) {
        expect(entries(back, handle), `${handle.toString(16)} binary ${binary}`).toEqual(
          entries(doc, handle),
        );
      }
    }
  });

  it('0070 DXF TABLECONTENT objects are kept as read and written back raw (DEC-040)', () => {
    // The table's round-trip XRECORD owns a TABLECONTENT, which the DXF writer cannot write.
    const raw = (d: CadDocument, handle: number): unknown =>
      (
        d.getCadObject(handle) as unknown as { rawDxfCodes: { code: number; value: unknown }[] }
      )?.rawDxfCodes?.map(({ code, value }) => [
        code,
        value instanceof Uint8Array ? [...value] : value,
      ]);
    const doc = readDxfRaw(corpusBytes(tablesR2018));
    for (const handle of [0x747, 0x12d7]) {
      expect(doc.getCadObject(handle)?.objectName).toBe('TABLECONTENT');
      expect(raw(doc, handle)).toBeDefined();
      for (const binary of [false, true]) {
        expect(dxfRawRoundTrip(doc, binary).getCadObject(handle)?.objectName).toBe('TABLECONTENT');
        expect(raw(dxfRawRoundTrip(doc, binary), handle), `binary ${binary}`).toEqual(
          raw(doc, handle),
        );
      }
    }
  });

  it('0071 R2007+ DXF text is read and written as UTF-8', () => {
    // AutoCAD writes DXF as UTF-8 from R2007; $DWGCODEPAGE still names the drawing's code
    // page. Reading these files in ANSI_1252 turned "°" into "Â°".
    const texts = (d: CadDocument): string[] =>
      [...(d.modelSpace?.entities ?? [])]
        .map((e) => (e as unknown as { value?: unknown }).value)
        .filter((v): v is string => typeof v === 'string');
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/text_oblique_rotate.dxf'));
    expect(texts(doc)).toContain('OBLIQUE 15°');
    expect(new TextDecoder('utf-8', { fatal: true }).decode(writeDxf(doc, false))).toContain(
      'OBLIQUE 15°',
    );
    for (const binary of [false, true]) {
      expect(texts(dxfRawRoundTrip(doc, binary)), `binary ${binary}`).toContain('OBLIQUE 15°');
    }
  });

  it('0072 DXF \\U+ escapes are decoded on read and written back where the code page lacks the character', () => {
    const named = (d: CadDocument, handle: number): string | undefined =>
      (d.getCadObject(handle) as unknown as { name?: string } | null)?.name;
    // An R2013 drawing whose layer name ends in an escaped ü. With its backslash the name is
    // invalid in DXF, so the writer refused the layer.
    const unicode = readDxfRaw(corpusBytes('third-party/ezdxf/integration_tests/dxf_unicode.dxf'));
    expect(named(unicode, 0x2f)).toBe('Tschüss mit ü');
    // An R12 ANSI_1252 drawing: the Greek letters are not in the code page, so they go back
    // out as \U+ escapes, and the lines stay on their layer.
    const r12 = readDxfRaw(corpusBytes('third-party/ezdxf/integration_tests/ASCII_R12.dxf'));
    const greek = 'ΛΑΓΕΡÄÜÖ';
    const onGreek = (d: CadDocument): number =>
      [...(d.modelSpace?.entities ?? [])].filter((e) => e.layer?.name === greek).length;
    const greekCount = onGreek(r12);
    expect(greekCount).toBeGreaterThan(0);
    expect(new TextDecoder('windows-1252').decode(writeDxf(r12, false))).toContain(
      '\\U+039B\\U+0391',
    );
    for (const binary of [false, true]) {
      expect(named(dxfRawRoundTrip(unicode, binary), 0x2f), `binary ${binary}`).toBe(
        'Tschüss mit ü',
      );
      expect(onGreek(dxfRawRoundTrip(r12, binary)), `binary ${binary}`).toBe(greekCount);
    }
  });

  it('0073 DWG AEC objects keep their raw data, and only it, through a save', () => {
    // The readers took every byte to the end of the object, handle stream included, and the
    // writer wrote the handles again after them, so each save grew the data by 6-20 bytes.
    const raw = (d: CadDocument, handle: number): number[] => {
      const o = d.getCadObject(handle) as unknown as {
        rawData?: Uint8Array;
        binaryData?: Uint8Array;
      } | null;
      return [...(o?.rawData ?? o?.binaryData ?? [])];
    };
    const doc = readDwgRaw('third-party/acadsharp/aec_objects/AecObjects.dwg');
    let back = doc;
    for (let save = 1; save <= 2; save++) {
      back = dwgRawRoundTrip(back);
      // AEC_CLEANUP_GROUP_DEF, AEC_WALL_STYLE, BINRECORD, AEC_WALL
      for (const handle of [0x2191, 0x27ba, 0x3d2d, 0x3d38]) {
        expect(raw(doc, handle).length, handle.toString(16)).toBeGreaterThan(0);
        expect(raw(back, handle), `${handle.toString(16)} save ${save}`).toEqual(raw(doc, handle));
      }
    }
  });

  it('0076 R12 DXF saves keep the handles acad-ts made up for what R12 does not store', () => {
    // R12 has no BLOCK_RECORD table (and many R12 files no handles at all), so the reader makes
    // up records and handles from $HANDSEED. A save wrote some of those handles and a raised
    // $HANDSEED, so the reopened file made them up again under other handles.
    const handles = (d: CadDocument): string[] =>
      [...d.getCadObjects()].map((o) => `${o.objectName}#${o.handle.toString(16)}`).sort();
    for (const file of [
      'third-party/acadsharp/sample_AC1009_ascii.dxf',
      'third-party/ezdxf/integration_tests/ASCII_R12.dxf',
      'third-party/ezdxf/integration_tests/r12_blocks_with_no_names.dxf',
      'third-party/ezdxf/integration_tests/AC1003_LINE_Example.dxf',
    ]) {
      for (const binary of [false, true]) {
        const doc = readDxfRaw(corpusBytes(file));
        // Taken before the save, which registers missing SEQENDs into the document it writes.
        const read = handles(doc);
        expect(handles(dxfRawRoundTrip(doc, binary)), `${file} binary ${binary}`).toEqual(read);
      }
    }

    // An object added after reading keeps its handle; the made-up ones move above it.
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/integration_tests/ASCII_R12.dxf'));
    const line = new Line();
    doc.modelSpace!.entities.add(line);
    const back = dxfRawRoundTrip(doc, false);
    expect(back.getCadObject(line.handle)?.objectName).toBe('LINE');
    expect(new Set([...back.getCadObjects()].map((o) => o.handle)).size).toBe(
      [...back.getCadObjects()].length,
    );
  });

  // R12 xdata, as read and after a save: app name and each record's code and value (a 1003 layer
  // by the name it resolves to).
  const xdataOf = (d: CadDocument, handle: number): string[] => {
    const o = d.getCadObject(handle) as
      | (CadObject & {
          extendedData?: Iterable<
            [
              { name: string },
              {
                records: {
                  code: number;
                  value: unknown;
                  resolveReference?: (doc: CadDocument) => { name?: string } | null;
                }[];
              },
            ]
          > | null;
        })
      | null;
    const out: string[] = [];
    for (const [app, data] of o?.extendedData ?? []) {
      out.push(app.name);
      for (const r of data.records) {
        out.push(
          `${r.code}=${r.code === 1003 ? (r.resolveReference?.(d)?.name ?? 'unresolved') : JSON.stringify(r.value)}`,
        );
      }
    }
    return out;
  };

  it('0077 an R12 DXF 1003 xdata layer keeps its layer when the layer has no handle in the file', () => {
    // sample_AC1009 TEXT 91B: 1001 LAYER_APP, 1002 {, 1003 APP_LAYER, 1002 }. R12 layers state no
    // handle, so the reader linked the record to handle 0 and a save left the 1003 out.
    const doc = readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1009_ascii.dxf'));
    expect(xdataOf(doc, 0x91b)).toEqual(['LAYER_APP', '1002="{"', '1003=APP_LAYER', '1002="}"']);
    for (const binary of [false, true]) {
      expect(xdataOf(dxfRawRoundTrip(doc, binary), 0x91b), `binary ${binary}`).toEqual(
        xdataOf(doc, 0x91b),
      );
    }
  });

  it('0078 DXF POLYLINE and INSERT xdata is written with them, not after their SEQEND', () => {
    // The writer wrote an entity's xdata after the entity's vertices or attributes and SEQEND, so
    // the reader gave it to the SEQEND (sample_AC1009 POLYLINE 353 and its SEQEND 17F1).
    const doc = readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1009_ascii.dxf'));
    const polyline = xdataOf(doc, 0x353);
    expect(polyline.slice(0, 2)).toEqual(['ACAD', '1000="ASC_BOUNDS"']);
    for (const binary of [false, true]) {
      const back = dxfRawRoundTrip(doc, binary);
      expect(xdataOf(back, 0x353), `binary ${binary}`).toEqual(polyline);
      expect(xdataOf(back, 0x17f1), `binary ${binary}`).toEqual([]);
    }

    // The same for an INSERT with attributes; no corpus file has one with xdata, so add some.
    const insert = [...doc.getCadObjects()].find(
      (o): o is Insert => o instanceof Insert && o.hasAttributes,
    )!;
    insert.extendedData.addByName('ACAD', new ExtendedData([new ExtendedDataString('ATTRIBUTED')]));
    const back = dxfRawRoundTrip(doc, false);
    expect(xdataOf(back, insert.handle)).toEqual(['ACAD', '1000="ATTRIBUTED"']);
    expect(xdataOf(back, insert.attributes.seqend!.handle)).toEqual([]);
  });

  it('0079 R12 DXF saves write $DWGCODEPAGE, so the text is read back in its code page', () => {
    // R12 has $DWGCODEPAGE (ezdxf's bin_dxf_r12.dxf carries "ansi_1252"). The R12 header writer
    // left it out, so a reopened file read as ANSI_1252 whatever code page it was written in.
    const bin = readDxfRaw(corpusBytes('third-party/ezdxf/integration_tests/bin_dxf_r12.dxf'));
    expect(bin.header!.codePage).toBe('ansi_1252');
    expect(dxfRawRoundTrip(bin, true).header!.codePage).toBe('ansi_1252');

    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/integration_tests/ASCII_R12.dxf'));
    doc.header!.codePage = 'ANSI_1251';
    const text = new TextEntity();
    text.value = 'Привет';
    doc.modelSpace!.entities.add(text);
    for (const binary of [false, true]) {
      const back = dxfRawRoundTrip(doc, binary);
      expect(back.header!.codePage, `binary ${binary}`).toBe('ANSI_1251');
      expect((back.getCadObject(text.handle) as TextEntity).value, `binary ${binary}`).toBe(
        'Привет',
      );
    }
  });

  it('0080 DXF BLOCK xdata is written with the block', () => {
    // ezdxf tags the $MODEL_SPACE BLOCK of r12_blocks_with_no_names.dxf (18) with EZDXF xdata; the
    // BLOCK writer wrote none, so a save dropped it.
    const doc = readDxfRaw(
      corpusBytes('third-party/ezdxf/integration_tests/r12_blocks_with_no_names.dxf'),
    );
    const block = xdataOf(doc, 0x18);
    expect(block.slice(0, 2)).toEqual(['EZDXF', '1000="CREATED_BY_EZDXF"']);
    for (const binary of [false, true]) {
      expect(xdataOf(dxfRawRoundTrip(doc, binary), 0x18), `binary ${binary}`).toEqual(block);
    }
  });

  it('0081 a DXF with no version and no R13 sections reads as R12 and saves as R12', () => {
    // AutoCAD and ezdxf read a DXF with no $ACADVER as R12 (the minimal R12 file is ENTITIES and
    // EOF). acad-ts kept its R2018 default and saved such a file with a layout, dictionaries and
    // a BLOCK_RECORD table it never had, so reopening found a different document.
    for (const file of [
      'third-party/ezdxf/examples_dxf/Minimal_DXF_AC1009.dxf',
      'third-party/ezdxf/integration_tests/R12_with_trash_beyond_EOF.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      expect(doc.header!.version, file).toBe(ACadVersion.AC1009);
      const owned = (d: CadDocument): number[] => d.modelSpace!.ownedObjectHandles;
      // The model space record names the entities it owns, under the handles they have.
      expect(owned(doc), file).toEqual([...doc.modelSpace!.entities].map((e) => e.handle));
      const back = dxfRawRoundTrip(doc, false);
      expect(back.header!.version, file).toBe(ACadVersion.AC1009);
      expect(owned(back), file).toEqual(owned(doc));
    }
  });

  it('0082 GEODATA coordinate system XML is read with its line breaks and kept through a save', () => {
    // The XML comes as 303 chunks and a last 301; the 301 was read raw, so its ^J stayed text
    // and a save escaped the caret ("^ J").
    for (const file of [
      'third-party/acadsharp/geolocation/geoloc.dxf',
      'third-party/acadsharp/geolocation/geoloc_AC1021.dxf',
    ]) {
      const geodata = (d: CadDocument): string =>
        (
          [...d.getCadObjects()].find((o) => o.objectName === 'GEODATA') as unknown as {
            coordinateSystemDefinition: string;
          }
        ).coordinateSystemDefinition;
      const doc = readDxfRaw(corpusBytes(file));
      expect(geodata(doc), file).not.toContain('^J');
      // geoloc.dxf has the XML form, geoloc_AC1021.dxf the WKT form.
      expect(geodata(doc), file).toMatch(/^(<\?xml|PROJCS\[)/);
      expect(geodata(dxfRawRoundTrip(doc, false)), file).toBe(geodata(doc));
    }
  });

  it('0083 a DXF FIELD keeps its whole field code and format string', () => {
    // The field code comes as 3 overflow chunks and a last 2, the format string as 9 chunks and a
    // last 301 (98 is its length). Both last chunks were assigned over what came before them.
    const doc = readDxfRaw(
      corpusBytes('third-party/ezdxf/examples_dxf/mtext_complex_inline_codes.dxf'),
    );
    const field = (d: CadDocument): { fieldCode: string; formatString: string } =>
      d.getCadObject(0xa9) as unknown as { fieldCode: string; formatString: string };
    expect(field(doc).fieldCode.startsWith('{\\A1;Complex MTEXT content:}')).toBe(true);
    expect(field(doc).formatString).toHaveLength(1995);
    for (const binary of [false, true]) {
      const back = field(dxfRawRoundTrip(doc, binary));
      expect(back.fieldCode, `binary ${binary}`).toBe(field(doc).fieldCode);
      expect(back.formatString, `binary ${binary}`).toBe(field(doc).formatString);
    }
  });

  it('0084 a TrueType STYLE keeps its ACAD font xdata as read through a DXF save', () => {
    // text_fonts.dxf STYLE 6A8: 1000 "Arial Black" (the face name), 1071 0x02000022 (bold plus
    // pitch and family). A save rebuilt both from the file name and the bold/italic flags.
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/text_fonts.dxf'));
    expect(xdataOf(doc, 0x6a8).slice(-3)).toEqual(['ACAD', '1000="Arial Black"', '1071=33554466']);
    for (const binary of [false, true]) {
      expect(xdataOf(dxfRawRoundTrip(doc, binary), 0x6a8), `binary ${binary}`).toEqual(
        xdataOf(doc, 0x6a8),
      );
    }
    // A style given another font file is still written with that font's name.
    const style = doc.getCadObject(0x6a8) as unknown as { filename: string };
    style.filename = 'arial.ttf';
    expect(xdataOf(dxfRawRoundTrip(doc, false), 0x6a8).slice(-2)[0]).toBe('1000="arial"');
  });

  it('0085 a DBCOLOR with no true colour is not written with one', () => {
    // sample_AC1015 DBCOLOR 996 has no colour groups and reads as index 0. The writer wrote 420
    // anyway, as true colour 0, which reads back as true-colour black.
    for (const file of [
      'third-party/acadsharp/sample_AC1015_ascii.dxf',
      'third-party/acadsharp/sample_AC1015_binary.dxf',
    ]) {
      const doc = readDxfRaw(corpusBytes(file));
      const color = (d: CadDocument) => (d.getCadObject(0x996) as BookColor).color;
      expect(color(doc).isTrueColor, file).toBe(false);
      const back = color(dxfRawRoundTrip(doc, file.includes('binary')));
      expect(back.isTrueColor, file).toBe(false);
      expect(back.index, file).toBe(color(doc).index);
    }
  });

  it('0086 an R2010+ DXF IMAGE keeps its clip mode (290)', () => {
    // viewports.dxf (AC1027) IMAGE 7E9 has 290 = 1 (inverted clip); the writer left 290 out.
    const doc = readDxfRaw(corpusBytes('third-party/ezdxf/examples_dxf/viewports.dxf'));
    const mode = (d: CadDocument) => (d.getCadObject(0x7e9) as RasterImage).clipMode;
    expect(Number(mode(doc))).toBe(1);
    for (const binary of [false, true]) {
      expect(Number(mode(dxfRawRoundTrip(doc, binary))), `binary ${binary}`).toBe(1);
    }
  });

  it('0087 a DXF Defpoints layer reads as not plotted, as it is written', () => {
    // duplicate_handles.dxf DEFPOINTS has no 290. It read as plottable (the getter hides it), the
    // writer writes AutoCAD's 290 = 0, and the reopened layer stored a different flag.
    const doc = readDxfRaw(
      corpusBytes('third-party/ezdxf/integration_tests/duplicate_handles.dxf'),
    );
    const stored = (d: CadDocument) =>
      (d.getCadObject(0x29) as unknown as { _plotFlag: boolean })._plotFlag;
    expect(stored(doc)).toBe(false);
    expect(stored(dxfRawRoundTrip(doc, false))).toBe(false);
  });
});
