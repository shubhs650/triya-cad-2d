// M1-23: the Layers palette's rows, the main thread's mirror of the LAYER table: the drawing's
// layers as opened with every change its engine applied since, sorted by name as AutoCAD's
// Layer Properties Manager lists them, with the current layer marked and, in a layout, how many
// of its viewports freeze each layer.
import type { ChangeSet, DocumentInit, EntityInit, LayerRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { layerRows } from '../src/layers';

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
