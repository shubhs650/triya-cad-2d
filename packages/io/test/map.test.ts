// AcadToTriya value conversions (M1-03), on drawings authored in memory with acad-ts. The
// corpus comparison against an independent DXF reader lives in
// packages/testkit/src/mapping/tables.corpus.test.ts.
import {
  ACadVersion,
  AppId,
  CadDocument,
  Color,
  ExtendedData,
  ExtendedDataHandle,
  ExtendedDataInteger32,
  ExtendedDataString,
  ExtendedDataWorldCoordinate,
  Layer,
  LineType,
  LineTypeSegment,
  View,
  XYZ,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { mapHeader, mapTables } from '../src/index';
import { mapColor, mapLineweight } from '../src/map/common';

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

  it('gives a true-colour variable its nearest ACI number', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.header!.currentEntityColor = new Color(255, 0, 0);

    expect(mapHeader(doc).header.get('$CECOLOR')).toBe(1);
  });
});
