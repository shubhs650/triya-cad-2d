// M1-23: the Layers palette's rows, the main thread's mirror of the LAYER table: the drawing's
// layers as opened with every change its engine applied since, sorted by name as AutoCAD's
// Layer Properties Manager lists them, with the current layer marked and, in a layout, how many
// of its viewports freeze each layer.
import type { ChangeSet, DocumentInit, EntityInit, LayerRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  layerColorBooks,
  layerLinetypes,
  layerRows,
  linetypeDashes,
  parseLayerTransparency,
} from '../src/layers';

const layer = (handle: string, name: string, extra: Partial<LayerRecord> = {}): LayerRecord => ({
  handle,
  name,
  color: { kind: 'aci', index: 7 },
  linetype: '14',
  lineweight: 'Default',
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
  ...extra,
});

const viewport = (handle: string, id: number, frozenLayers: string[]): EntityInit => ({
  handle,
  owner: '1B',
  type: 'VIEWPORT',
  layer: '10',
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  geom: {
    kind: 'VIEWPORT',
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    id,
    status: id,
    flags: 0,
    viewCenter: { x: 0, y: 0 },
    viewHeight: 10,
    viewDirection: { x: 0, y: 0, z: 1 },
    viewTarget: { x: 0, y: 0, z: 0 },
    twist: 0,
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    frozenLayers,
    plotStyleSheet: '',
    renderMode: 0,
  } as EntityInit['geom'],
});

const init: DocumentInit = {
  meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
  handSeed: '40',
  header: [['$CLAYER', 'walls']],
  tables: {
    layers: [
      layer('12', 'Walls', {
        color: { kind: 'aci', index: 1 },
        lineweight: 50,
        linetype: '15',
        description: 'Outer walls',
      }),
      layer('10', '0'),
      layer('11', 'doors', { color: { kind: 'rgb', r: 10, g: 20, b: 30 }, plot: false }),
    ],
    linetypes: [
      {
        handle: '14',
        name: 'Continuous',
        description: '',
        alignment: 'A',
        patternLength: 0,
        elements: [],
      },
      {
        handle: '15',
        name: 'DASHED',
        description: '',
        alignment: 'A',
        patternLength: 1,
        elements: [],
      },
    ],
  },
  entities: [viewport('30', 1, []), viewport('31', 2, ['11']), viewport('32', 3, ['11', '12'])],
};

describe('layerRows', () => {
  it('lists the layers by name with their states and properties', () => {
    const rows = layerRows(init, []);
    expect(rows.map((r) => r.name)).toEqual(['0', 'doors', 'Walls']);
    const walls = rows[2]!;
    expect(walls).toMatchObject({
      handle: '12',
      current: true,
      on: true,
      frozen: false,
      locked: false,
      plot: true,
      color: { label: 'red', css: '#ff0000' },
      linetype: 'DASHED',
      lineweight: '0.50 mm',
      description: 'Outer walls',
    });
    expect(rows[1]).toMatchObject({ color: { label: '10,20,30', css: '#0a141e' }, plot: false });
    expect(rows[0]).toMatchObject({
      current: false,
      lineweight: 'Default',
      color: { label: 'white' },
      description: '',
    });
  });

  it("names a colour-book colour by its colour's name, as the manager's Color column does", () => {
    // M2-35 part 19: io reads a layer's DXF 430 (acadsharp's Layer_color_book).
    const booked: DocumentInit = {
      ...init,
      tables: {
        ...init.tables,
        layers: [
          layer('13', 'Layer_color_book', {
            color: {
              kind: 'rgb',
              r: 252,
              g: 193,
              b: 135,
              bookName: 'DIC COLOR GUIDE(R)',
              colorName: 'DIC 7',
            },
          }),
        ],
      },
    };
    expect(layerRows(booked, [])[0]).toMatchObject({ color: { label: 'DIC 7', css: '#fcc187' } });
  });

  it('applies the changes the engine made since the drawing opened', () => {
    const before = init.tables!.layers![1]!;
    const off: ChangeSet = {
      tables: { layers: { updated: [{ before, after: { ...before, on: false } }] } },
    };
    const locked: ChangeSet = {
      tables: {
        layers: {
          updated: [
            { before: { ...before, on: false }, after: { ...before, on: false, locked: true } },
          ],
        },
      },
    };
    const row = layerRows(init, [off, locked]).find((r) => r.handle === '10');
    expect(row).toMatchObject({ on: false, locked: true });
  });

  it('marks the layer a later change made current (M2-35)', () => {
    const cs: ChangeSet = { header: [{ name: '$CLAYER', before: 'Walls', after: 'DOORS' }] };
    const rows = layerRows(init, [cs]);
    expect(rows.filter((r) => r.current).map((r) => r.name)).toEqual(['doors']);
  });

  it('counts the viewports of the layout shown that freeze each layer', () => {
    const rows = layerRows(init, [], '1B');
    // The layout's own paper-space viewport (id 1) is not one of its viewports.
    expect(rows.map((r) => [r.name, r.vpFrozen])).toEqual([
      ['0', { frozen: 0, of: 2 }],
      ['doors', { frozen: 2, of: 2 }],
      ['Walls', { frozen: 1, of: 2 }],
    ]);
    expect(layerRows(init, [])[0]!.vpFrozen).toBeUndefined();
  });
});

describe('the property cells (M5-05 part 2)', () => {
  it('gives each row its colour, linetype, lineweight and transparency to edit', () => {
    const glass: DocumentInit = {
      ...init,
      tables: {
        ...init.tables,
        layers: [layer('16', 'Glass', { transparency: { alpha: 179 }, lineweight: 25 })],
      },
    };
    const row = layerRows(glass, [])[0]!;
    expect(row).toMatchObject({
      transparency: '30',
      value: {
        color: { kind: 'aci', index: 7 },
        linetype: '14',
        lineweight: 25,
        transparency: { alpha: 179 },
      },
    });
    // An opaque layer shows 0, as AutoCAD's Transparency column does.
    expect(layerRows(init, [])[0]!.transparency).toBe('0');
  });

  it('lists the loaded linetypes by name, without ByLayer and ByBlock, as changed since', () => {
    const lt = (handle: string, name: string, description = '') => ({
      handle,
      name,
      description,
      alignment: 'A',
      patternLength: 0,
      elements: [],
    });
    const withBy: DocumentInit = {
      ...init,
      tables: {
        ...init.tables,
        linetypes: [lt('17', 'ByBlock'), lt('18', 'ByLayer'), ...init.tables!.linetypes!],
      },
    };
    const loaded: ChangeSet = {
      tables: { linetypes: { added: [lt('19', 'CENTER', 'Center ____ _ ____')] } },
    };
    expect(layerLinetypes(withBy, [loaded]).map((l) => [l.name, l.description])).toEqual([
      ['CENTER', 'Center ____ _ ____'],
      ['Continuous', ''],
      ['DASHED', ''],
    ]);
    // A row names a linetype loaded after the drawing opened.
    const onCenter: DocumentInit = {
      ...init,
      tables: { ...init.tables, layers: [layer('20', 'Axes', { linetype: '19' })] },
    };
    expect(layerRows(onCenter, [loaded])[0]!.linetype).toBe('CENTER');
  });

  it("offers the colour books the layers' colours come from", () => {
    const book = (r: number, colorName: string) => ({
      kind: 'rgb' as const,
      r,
      g: 0,
      b: 0,
      bookName: 'RAL CLASSIC',
      colorName,
    });
    const booked: DocumentInit = {
      ...init,
      tables: {
        ...init.tables,
        layers: [
          layer('21', 'A', { color: book(200, 'RAL 3020') }),
          layer('22', 'B', { color: book(100, 'RAL 3000') }),
          layer('23', 'C', { color: book(200, 'RAL 3020') }),
          layer('24', 'D', { color: { kind: 'rgb', r: 1, g: 2, b: 3 } }),
        ],
      },
    };
    expect(layerColorBooks(booked, [])).toEqual([
      {
        name: 'RAL CLASSIC',
        colors: [
          { name: 'RAL 3000', value: 'rgb:100,0,0;RAL CLASSIC;RAL 3000', rgb: [100, 0, 0] },
          { name: 'RAL 3020', value: 'rgb:200,0,0;RAL CLASSIC;RAL 3020', rgb: [200, 0, 0] },
        ],
      },
    ]);
  });

  it('reads the Layer Transparency field: a whole number from 0 to 90', () => {
    expect(parseLayerTransparency('30')).toBe(30);
    expect(parseLayerTransparency(' 0 ')).toBe(0);
    expect(parseLayerTransparency('90')).toBe(90);
    for (const bad of ['91', '-1', '12.5', '', 'half'])
      expect(parseLayerTransparency(bad)).toBe('Transparency value must be between 0 and 90.');
  });

  it("draws a linetype's appearance as dashes scaled to the cell", () => {
    expect(linetypeDashes([], 100)).toBeUndefined();
    const el = (length: number) => ({
      length,
      shapeFlags: 0,
      shapeNumber: 0,
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: 0,
    });
    // DASHED (0.5, -0.25) repeated four times across 120 px: 20 px dashes, 10 px gaps.
    expect(linetypeDashes([el(0.5), el(-0.25)], 120)).toEqual([20, 10]);
    // A dot draws as a 1 px dash.
    expect(linetypeDashes([el(0.5), el(-0.25), el(0), el(-0.25)], 100)).toEqual([
      12.5, 6.25, 1, 6.25,
    ]);
  });
});
