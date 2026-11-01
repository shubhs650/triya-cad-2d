// Paint (M1-12, resolution from M1-13): colour, lineweight and linetype resolved at cache time.
// ACI 7 stays "foreground" so a light or dark canvas picks black or white without
// re-tessellating.
import type {
  DocumentModel,
  Entity,
  HeaderValue,
  LayerRecord,
  LinetypeRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { createPaint, defaultPaint } from '../src/index';
import { dash } from './fixtures';

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

const linetype = (handle: string, name: string, lengths: number[]): LinetypeRecord => ({
  handle,
  name,
  description: '',
  alignment: 'A',
  patternLength: lengths.reduce((s, l) => s + Math.abs(l), 0),
  elements: lengths.map(dash),
});
const CONTINUOUS = linetype('14', 'Continuous', []);
const DASHED = linetype('15', 'DASHED', [0.5, -0.25]);

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

const model = (l: LayerRecord, header: [string, HeaderValue][] = []): DocumentModel =>
  ({
    header: new Map(header),
    tables: {
      layers: new Map([[l.handle, l]]),
      linetypes: new Map([CONTINUOUS, DASHED].map((r) => [r.handle, r])),
    },
  }) as unknown as DocumentModel;

const colorOf = (color: Entity['color'], l = layer()) =>
  defaultPaint(entity({ color }), model(l))?.color;

describe('colour', () => {
  it('keeps ACI 7, ACI 0 and ByBlock outside a block as the foreground', () => {
    expect(colorOf({ kind: 'aci', index: 7 })).toBe('foreground');
    expect(colorOf({ kind: 'aci', index: 0 })).toBe('foreground');
    expect(colorOf({ kind: 'byBlock' })).toBe('foreground');
  });

  it('maps ACI through the AutoCAD palette, true colour and ByLayer', () => {
    expect([1, 2, 3, 4, 5, 6, 8, 9].map((index) => colorOf({ kind: 'aci', index }))).toEqual([
      '#ff0000',
      '#ffff00',
      '#00ff00',
      '#00ffff',
      '#0000ff',
      '#ff00ff',
      '#808080',
      '#c0c0c0',
    ]);
    // The computed palette, not the basic eight: ACI 30 is orange, 250 the darkest grey.
    expect(colorOf({ kind: 'aci', index: 30 })).toBe('#ff7f00');
    expect(colorOf({ kind: 'aci', index: 250 })).toBe('#333333');
    expect(colorOf({ kind: 'rgb', r: 1, g: 2, b: 255 })).toBe('#0102ff');
    expect(colorOf({ kind: 'byLayer' })).toBe('#ff0000');
    // A negative layer colour only means the layer is off; its colour is the same.
    expect(colorOf({ kind: 'byLayer' }, layer({ color: { kind: 'aci', index: -1 } }))).toBe(
      '#ff0000',
    );
  });
});

describe('lineweight', () => {
  const weight = (e: Partial<Entity>, header: [string, HeaderValue][] = []) =>
    defaultPaint(entity(e), model(layer(), header))?.lineweight;

  it('converts hundredths of a millimetre, through ByLayer', () => {
    expect(weight({ lineweight: 50 })).toBe(0.5);
    expect(weight({})).toBe(0.35);
  });

  it('shows Default, and ByBlock outside a block, at LWDEFAULT', () => {
    // LWDEFAULT is a registry setting, not saved in the drawing; AutoCAD starts it at 0.25 mm.
    expect(weight({ lineweight: 'Default' })).toBe(0.25);
    expect(weight({ lineweight: 'ByBlock' })).toBe(0.25);
    const heavy = createPaint({ lwDefault: 50 });
    expect(heavy(entity({ lineweight: 'Default' }), model(layer()))?.lineweight).toBe(0.5);
  });
});

describe('linetype', () => {
  const lt = (e: Partial<Entity>, l = layer(), header: [string, HeaderValue][] = []) =>
    defaultPaint(entity(e), model(l, header))?.linetype;

  it('resolves ByLayer and a fixed linetype to the pattern', () => {
    expect(lt({}, layer({ linetype: '15' }))).toEqual({
      pattern: {
        name: 'DASHED',
        description: '',
        elements: [{ length: 0.5 }, { length: -0.25 }],
      },
      scale: 1,
    });
    expect(lt({ linetype: '15' })?.pattern.name).toBe('DASHED');
  });

  it('scales by LTSCALE times the object linetype scale', () => {
    expect(lt({ linetype: '15', ltScale: 3 }, layer(), [['$LTSCALE', 2]])?.scale).toBe(6);
    // A scale AutoCAD would refuse (zero or negative) reads as 1.
    expect(lt({ linetype: '15', ltScale: 3 }, layer(), [['$LTSCALE', 0]])?.scale).toBe(3);
  });

  it('draws Continuous, ByBlock outside a block and a missing linetype continuous', () => {
    expect(lt({})).toBeUndefined();
    expect(lt({ linetype: 'ByBlock' })).toBeUndefined();
    expect(lt({ linetype: '99' })).toBeUndefined();
  });

  it('reuses one pattern per linetype record', () => {
    const a = lt({ linetype: '15' });
    const b = lt({ linetype: '15', ltScale: 2 });
    expect(a?.pattern).toBe(b?.pattern);
  });
});

describe('visibility', () => {
  it('hides invisible entities and entities on layers that are off or frozen', () => {
    expect(defaultPaint(entity(), model(layer()))).toEqual({ color: '#ff0000', lineweight: 0.35 });
    expect(defaultPaint(entity({ visible: false }), model(layer()))).toBeUndefined();
    expect(defaultPaint(entity(), model(layer({ on: false })))).toBeUndefined();
    expect(defaultPaint(entity(), model(layer({ frozen: true })))).toBeUndefined();
  });
});
