// Paint (M1-12): colour and lineweight resolved at cache time. ACI 7 stays "foreground" so a
// light or dark canvas picks black or white without re-tessellating.
import type { DocumentModel, Entity, LayerRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { colorOf, defaultPaint, lineweightOf } from '../src/index';

const layer = (extra: Partial<LayerRecord> = {}): LayerRecord => ({
  handle: '10',
  name: '0',
  color: { kind: 'aci', index: 1 },
  linetype: '14',
  lineweight: 35,
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
  ...extra,
});

const entity = (extra: Partial<Entity> = {}): Entity =>
  ({
    id: 1,
    handle: '20',
    owner: '1F',
    type: 'LINE',
    layer: '10',
    color: { kind: 'byLayer' },
    linetype: 'ByLayer',
    lineweight: 'ByLayer',
    transparency: 'ByLayer',
    ltScale: 1,
    visible: true,
    geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    ...extra,
  }) as Entity;

const model = (l: LayerRecord): DocumentModel =>
  ({ tables: { layers: new Map([[l.handle, l]]) } }) as unknown as DocumentModel;

describe('colorOf', () => {
  it('keeps ACI 7, ACI 0 and ByBlock as the foreground', () => {
    expect(colorOf({ kind: 'aci', index: 7 }, undefined)).toBe('foreground');
    expect(colorOf({ kind: 'aci', index: 0 }, undefined)).toBe('foreground');
    expect(colorOf({ kind: 'byBlock' }, undefined)).toBe('foreground');
  });

  it('maps the basic ACI colours, true colour and ByLayer', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 8, 9].map((index) => colorOf({ kind: 'aci', index }, undefined)),
    ).toEqual([
      '#ff0000',
      '#ffff00',
      '#00ff00',
      '#00ffff',
      '#0000ff',
      '#ff00ff',
      '#808080',
      '#c0c0c0',
    ]);
    // A negative ACI is a layer that is off; its colour is the same.
    expect(colorOf({ kind: 'aci', index: -1 }, undefined)).toBe('#ff0000');
    expect(colorOf({ kind: 'rgb', r: 1, g: 2, b: 255 }, undefined)).toBe('#0102ff');
    expect(colorOf({ kind: 'byLayer' }, layer())).toBe('#ff0000');
    expect(colorOf({ kind: 'byLayer' }, undefined)).toBe('foreground');
  });
});

describe('lineweightOf', () => {
  it('converts hundredths of a millimetre, through ByLayer', () => {
    expect(lineweightOf(entity({ lineweight: 50 }), layer())).toBe(0.5);
    expect(lineweightOf(entity(), layer())).toBe(0.35);
    expect(lineweightOf(entity({ lineweight: 'Default' }), layer())).toBeUndefined();
    expect(lineweightOf(entity({ lineweight: 'ByBlock' }), layer())).toBeUndefined();
  });
});

describe('defaultPaint', () => {
  it('hides invisible entities and entities on layers that are off or frozen', () => {
    expect(defaultPaint(entity(), model(layer()))).toEqual({ color: '#ff0000', lineweight: 0.35 });
    expect(defaultPaint(entity({ visible: false }), model(layer()))).toBeUndefined();
    expect(defaultPaint(entity(), model(layer({ on: false })))).toBeUndefined();
    expect(defaultPaint(entity(), model(layer({ frozen: true })))).toBeUndefined();
    expect(defaultPaint(entity({ lineweight: 'Default' }), model(layer()))).toEqual({
      color: '#ff0000',
    });
  });
});
