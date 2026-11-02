// AcadToTriya value conversions (M1-03), on drawings authored in memory with acad-ts. The
// corpus comparison against an independent DXF reader lives in
// packages/testkit/src/mapping/tables.corpus.test.ts.
import {
  ACadVersion,
  AppId,
  BlockRecord,
  CadDictionary,
  CadDocument,
  Color,
  DictionaryVariable,
  DimensionStyle,
  ExtendedData,
  ExtendedDataHandle,
  ExtendedDataInteger32,
  ExtendedDataString,
  ExtendedDataWorldCoordinate,
  Layer,
  LineType,
  LineTypeSegment,
  MultiLeaderStyle,
  Scale,
  TableStyle,
  View,
  XYZ,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { mapHeader, mapTables } from '../src/index';
import { aciOfTrueColor, mapColor, mapEntityColor, mapLineweight } from '../src/map/common';
import { DIMVARS } from '../src/map/dimvars';

function docWithLayer(name: string): { doc: CadDocument; layer: Layer } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const layer = new Layer(name);
  doc.layers?.add(layer);
  return { doc, layer };
}

const layerNamed = (doc: CadDocument, name: string) =>
  mapTables(doc).layers.find((l) => l.name === name)!;

describe('mapColor (DXF 62/420)', () => {
  it('maps ByLayer, ByBlock, ACI and true colour', () => {
    expect(mapColor(Color.byLayer)).toEqual({ kind: 'byLayer' });
    expect(mapColor(Color.byBlock)).toEqual({ kind: 'byBlock' });
    expect(mapColor(new Color(1))).toEqual({ kind: 'aci', index: 1 });
    expect(mapColor(new Color(10, 20, 30))).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
  });
});

// The ACI AutoCAD writes for a true colour (DXF 62 beside 420, DIMSTYLE 176–178 and R2000 saves).
// Every true colour in the public corpus with the ACI AutoCAD stored for it (M1-55).
const AUTOCAD_TRUE_COLOR_ACI: readonly (readonly [number, number, number, number])[] = [
  [241, 235, 31, 2],
  [242, 103, 34, 30],
  [252, 193, 135, 31],
  [226, 144, 0, 42],
  [52, 201, 24, 82],
  [44, 136, 27, 86],
  [19, 155, 72, 114],
  [17, 146, 238, 150],
  [80, 179, 255, 151],
  [128, 61, 194, 183],
  [155, 66, 236, 193],
  [169, 83, 160, 215],
  [245, 10, 147, 230],
  [205, 32, 39, 242],
  [125, 33, 79, 247],
  [0, 0, 0, 18],
  [120, 120, 120, 8],
  [128, 128, 128, 8],
  [255, 255, 255, 7],
  [0, 0, 255, 5],
  [0, 255, 255, 4],
];

describe('aciOfTrueColor', () => {
  it('picks the ACI AutoCAD stores for each corpus true colour', () => {
    const got = AUTOCAD_TRUE_COLOR_ACI.map(([r, g, b]) => [r, g, b, aciOfTrueColor(r, g, b)]);
    expect(got).toEqual(AUTOCAD_TRUE_COLOR_ACI);
  });

  it('never returns ByBlock or ByLayer', () => {
    for (let v = 0; v < 256; v += 15) {
      const i = aciOfTrueColor(v, 255 - v, v / 2);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(255);
    }
  });
});

describe('mapLineweight (DXF 370)', () => {
  it('maps the three special values and keeps hundredths of a millimetre', () => {
    expect(mapLineweight(-1)).toBe('ByLayer');
    expect(mapLineweight(-2)).toBe('ByBlock');
    expect(mapLineweight(-3)).toBe('Default');
    expect(mapLineweight(35)).toBe(35);
  });
});

describe('layers', () => {
  it('maps state flags, colour and linetype by handle', () => {
    const { doc, layer } = docWithLayer('A-WALL');
    layer.color = new Color(3);
    layer.isOn = false;
    layer.flags = 1 | 4;
    const mapped = layerNamed(doc, 'A-WALL');

    expect(mapped.handle).toBe(layer.handle.toString(16).toUpperCase());
    expect(mapped.raw).toEqual({ handle: mapped.handle });
    expect(mapped.color).toEqual({ kind: 'aci', index: 3 });
    expect(mapped).toMatchObject({ on: false, frozen: true, locked: true, plot: true });
    expect(mapped.linetype).toBe(layer.lineType.handle.toString(16).toUpperCase());
    expect(mapped.lineweight).toBe('Default');
  });

  it('reads transparency from AcCmTransparency xdata and defaults to opaque', () => {
    const { doc, layer } = docWithLayer('GLASS');
    const app = new AppId('AcCmTransparency');
    doc.appIds?.add(app);
    layer.extendedData.addByAppId(
      app,
      new ExtendedData([new ExtendedDataInteger32(0x02000000 | 89)]),
    );
    doc.layers?.add(new Layer('SOLID'));

    expect(layerNamed(doc, 'GLASS').transparency).toEqual({ alpha: 89 });
    expect(layerNamed(doc, 'SOLID').transparency).toEqual({ alpha: 255 });
  });

  it('carries xdata per application with handles as hex and points as Vec3', () => {
    const { doc, layer } = docWithLayer('TAGGED');
    const app = new AppId('TRIYA_TEST');
    doc.appIds?.add(app);
    layer.extendedData.addByAppId(
      app,
      new ExtendedData([
        new ExtendedDataString('note'),
        new ExtendedDataHandle(0x2f),
        new ExtendedDataWorldCoordinate(new XYZ(1, 2, 3)),
      ]),
    );
    const mapped = layerNamed(doc, 'TAGGED');

    expect(mapped.xdata).toEqual([
      {
        appId: app.handle.toString(16).toUpperCase(),
        values: [
          { code: 1000, value: 'note' },
          { code: 1005, value: '2F' },
          { code: 1011, value: { x: 1, y: 2, z: 3 } },
        ],
      },
    ]);
    // Nothing invented for a layer without them.
    expect(layerNamed(doc, '0')).not.toHaveProperty('xdata');
    expect(layerNamed(doc, '0')).not.toHaveProperty('reactors');
  });
});

describe('linetypes', () => {
  it('maps dash elements and normalises the DXF 72 character code', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const dashed = new LineType('DASHED2');
    dashed.description = '__ __ __';
    dashed.alignment = '65'; // as acad-ts keeps it after a DXF read
    for (const length of [0.5, -0.25]) {
      const s = new LineTypeSegment();
      s.length = length;
      dashed.addSegment(s);
    }
    doc.lineTypes?.add(dashed);
    const mapped = mapTables(doc).linetypes.find((t) => t.name === 'DASHED2')!;

    expect(mapped.alignment).toBe('A');
    expect(mapped.description).toBe('__ __ __');
    expect(mapped.patternLength).toBe(0.75);
    expect(mapped.elements.map((e) => e.length)).toEqual([0.5, -0.25]);
    expect(mapped.elements[0]).not.toHaveProperty('style');
    expect(mapped.elements[0]).not.toHaveProperty('text');
  });
});

describe('views', () => {
  it('carries the view UCS only when the view is UCS-associated', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const plain = new View('PLAIN');
    const withUcs = new View('UCS');
    withUcs.isUcsAssociated = true;
    withUcs.ucsOrigin = new XYZ(10, 20, 0);
    doc.views?.add(plain);
    doc.views?.add(withUcs);
    const views = mapTables(doc).views;

    expect(views.find((v) => v.name === 'PLAIN')).not.toHaveProperty('ucs');
    expect(views.find((v) => v.name === 'UCS')!.ucs?.origin).toEqual({ x: 10, y: 20, z: 0 });
  });
});

describe('dimension styles', () => {
  it('lists each DIMVAR and DXF group once', () => {
    expect(new Set(DIMVARS.map(([name]) => name)).size).toBe(DIMVARS.length);
    expect(new Set(DIMVARS.map(([, code]) => code)).size).toBe(DIMVARS.length);
  });

  it('keys DIMVARs by name with colours as ACI and references as handles', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const arrow = new BlockRecord('_ARCHTICK');
    doc.blockRecords?.add(arrow);
    const style = new DimensionStyle('ARCH');
    doc.dimensionStyles?.add(style);
    style.scaleFactor = 48;
    style.textVerticalAlignment = 1 as never;
    style.textInsideHorizontal = false;
    style.decimalSeparator = ',';
    style.dimensionLineColor = new Color(2);
    style.textColor = new Color(0, 128, 255);
    style.arrowBlock = arrow;
    style.style = doc.textStyles!.tryGetValue('Standard')!;
    const vars = mapTables(doc).dimStyles.find((d) => d.name === 'ARCH')!.vars;

    expect(vars).toMatchObject({
      DIMSCALE: 48,
      DIMTAD: 1,
      DIMTIH: false,
      DIMDSEP: ',',
      DIMCLRD: 2,
      DIMBLK: arrow.handle.toString(16).toUpperCase(),
      DIMTXSTY: style.style.handle.toString(16).toUpperCase(),
    });
    // A true colour keeps the ACI AutoCAD writes for it in DXF, never acad-ts's −1.
    expect(vars['DIMCLRT']).toBe(aciOfTrueColor(0, 128, 255));
    // The default arrowhead (no block) and a ByBlock dimension linetype point at nothing.
    expect(vars).not.toHaveProperty('DIMBLK1');
    expect(vars).not.toHaveProperty('DIMLTYPE');
  });

  it('keeps a true DIMVAR colour beside the ACI that DXF stores for it', () => {
    // The acadsharp `custom_dim_style` colours as its R2004+ DWGs hold them (M1-55).
    const doc = new CadDocument(ACadVersion.AC1032);
    const style = new DimensionStyle('CUSTOM');
    doc.dimensionStyles?.add(style);
    style.dimensionLineColor = new Color(44, 136, 27);
    style.extensionLineColor = new Color(128, 61, 194);
    style.textColor = new Color(80, 179, 255);
    style.textBackgroundColor = new Color(3);
    const rec = mapTables(doc).dimStyles.find((d) => d.name === 'CUSTOM')!;
    expect(rec.vars).toMatchObject({ DIMCLRD: 86, DIMCLRE: 183, DIMCLRT: 151, DIMTFILLCLR: 3 });
    expect(rec.trueColors).toEqual({
      DIMCLRD: { kind: 'rgb', r: 44, g: 136, b: 27 },
      DIMCLRE: { kind: 'rgb', r: 128, g: 61, b: 194 },
      DIMCLRT: { kind: 'rgb', r: 80, g: 179, b: 255 },
    });
    // A style without true colours carries no map.
    expect(mapTables(doc).dimStyles.find((d) => d.name === 'Standard')).not.toHaveProperty(
      'trueColors',
    );
  });
});

describe('mapEntityColor (MLEADERSTYLE 91/93/94)', () => {
  it('maps every AcCmEntityColor method acad-ts decodes (0122)', () => {
    const m = (v: number) => mapEntityColor(Color.fromCmValue(v));
    expect(m(0xc0000000 | 0)).toEqual({ kind: 'byLayer' });
    expect(m(-1056964608)).toEqual({ kind: 'byBlock' }); // 0xC1000000
    expect(m(0xc2000000 | 0x102030)).toEqual({ kind: 'rgb', r: 16, g: 32, b: 48 });
    expect(m(0xc3000000 | 5)).toEqual({ kind: 'aci', index: 5 });
    expect(m(0xc8000000)).toEqual({ kind: 'byBlock' });
  });

  it('maps a Color as mapColor does', () => {
    expect(mapEntityColor(new Color(3))).toEqual({ kind: 'aci', index: 3 });
  });
});

function styleDictionary(doc: CadDocument, key: string): CadDictionary {
  const root = doc.rootDictionary!;
  let dict = root.get(key);
  if (!(dict instanceof CadDictionary)) {
    dict = new CadDictionary(key);
    root.add(dict as CadDictionary);
  }
  return dict as CadDictionary;
}

describe('multileader and table styles', () => {
  it('maps a multileader style from ACAD_MLEADERSTYLE with its references', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const style = new MultiLeaderStyle('NOTES');
    style.textStyle = doc.textStyles!.tryGetValue('Standard')!;
    style.textHeight = 2.5;
    style.lineColor = new Color(1);
    styleDictionary(doc, CadDictionary.acadMLeaderStyle).add(style);
    const mapped = mapTables(doc).mleaderStyles.find((m) => m.name === 'NOTES')!;

    expect(mapped.handle).toBe(style.handle.toString(16).toUpperCase());
    expect(mapped).toMatchObject({
      textHeight: 2.5,
      lineColor: { kind: 'aci', index: 1 },
      textStyle: style.textStyle!.handle.toString(16).toUpperCase(),
    });
    expect(mapped).not.toHaveProperty('arrowhead');
  });

  it('maps a table style without taking its 71 flags for standard flags', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const style = new TableStyle('GRID');
    style.flags = 3;
    style.suppressTitle = true;
    styleDictionary(doc, CadDictionary.acadTableStyle).add(style);
    const mapped = mapTables(doc).tableStyles.find((t) => t.name === 'GRID')!;

    expect(mapped).not.toHaveProperty('flags');
    expect(mapped).toMatchObject({ styleFlags: 3, suppressTitle: true, cellStyles: [] });
  });
});

describe('every table', () => {
  it('maps the default entries of a new drawing, including model and paper space', () => {
    const tables = mapTables(new CadDocument(ACadVersion.AC1032));

    expect(tables.layers.map((l) => l.name)).toContain('0');
    expect(tables.linetypes.map((t) => t.name)).toEqual(
      expect.arrayContaining(['ByLayer', 'ByBlock', 'Continuous']),
    );
    expect(tables.blockRecords.map((b) => b.name)).toEqual(
      expect.arrayContaining(['*Model_Space', '*Paper_Space']),
    );
    expect(tables.vports.map((v) => v.name)).toContain('*Active');
    for (const records of Object.values(tables)) {
      for (const r of records) expect(r.handle).toMatch(/^[0-9A-F]+$/);
    }
  });
});

describe('mapHeader', () => {
  it('keys values by DXF name with points, colours and the handle seed', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const h = doc.header!;
    h.lineTypeScale = 2.5;
    h.modelSpaceInsertionBase = new XYZ(1, 2, 3);
    h.currentEntityColor = new Color(5);
    h.handleSeed = 0x1a2b;
    const { header, handSeed, meta } = mapHeader(doc);

    expect(header.get('$LTSCALE')).toBe(2.5);
    expect(header.get('$INSBASE')).toEqual({ x: 1, y: 2, z: 3 });
    expect(header.get('$CECOLOR')).toBe(5);
    expect(handSeed).toBe('1A2B');
    expect(header.get('$HANDSEED')).toBe('1A2B');
    expect(meta.sourceVersion).toBe('AC1032');
    expect(meta.measurement).toBe('metric');
  });

  it('gives a true-colour variable the ACI AutoCAD writes for it', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.header!.currentEntityColor = new Color(255, 0, 0);
    doc.header!.dimensionLineColor = new Color(44, 136, 27);

    expect(mapHeader(doc).header.get('$CECOLOR')).toBe(1);
    // acad-ts's own approximation gives 1 here (M1-43); AutoCAD writes 86.
    expect(mapHeader(doc).header.get('$DIMCLRD')).toBe(86);
  });

  // M1-63: MSLTSCALE, CANNOSCALE and their kind are system variables AutoCAD saves as
  // DICTIONARYVAR entries of the AcDbVariableDictionary, not in the HEADER section.
  it('carries the variable dictionary under bare names, with CANNOSCALEVALUE', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const vars = doc.rootDictionary!.get(CadDictionary.variableDictionary) as CadDictionary;
    vars.add(new DictionaryVariable('MSLTSCALE', '1'));
    vars.add(new DictionaryVariable('CANNOSCALE', '1:50'));
    const scales = doc.rootDictionary!.get(CadDictionary.acadScaleList) as CadDictionary;
    for (const [key, name, paper, drawing] of [
      ['A0', '1:1', 1, 1],
      ['A1', '1:50', 1, 50],
    ] as const) {
      const s = new Scale(name);
      s.paperUnits = paper;
      s.drawingUnits = drawing;
      scales.addByKey(key, s);
    }
    const { header } = mapHeader(doc);

    expect(header.get('MSLTSCALE')).toBe('1');
    expect(header.get('CANNOSCALE')).toBe('1:50');
    expect(header.get('CANNOSCALEVALUE')).toBe(0.02);
    expect(header.has('$MSLTSCALE')).toBe(false);
  });

  it('leaves CANNOSCALEVALUE out when CANNOSCALE names no scale of the list', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const vars = doc.rootDictionary!.get(CadDictionary.variableDictionary) as CadDictionary;
    vars.add(new DictionaryVariable('CANNOSCALE', '1:20'));
    const { header } = mapHeader(doc);

    expect(header.get('CANNOSCALE')).toBe('1:20');
    expect(header.has('CANNOSCALEVALUE')).toBe(false);
    expect(header.has('MSLTSCALE')).toBe(false);
  });
});
