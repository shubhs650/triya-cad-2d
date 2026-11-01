// ACI palette, ByLayer/ByBlock resolution, linetype scale and lineweight display (M1-13).
import type { Color, Handle, LayerRecord, LinetypeRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  aciRgb,
  blockContext,
  lineweightPixels,
  linetypeScale,
  patternLength,
  patternOf,
  resolveColor,
  resolveLineweight,
  resolveLinetype,
  type StyleSource,
  type Styled,
} from '../../src/index';

const aci = (index: number): Color => ({ kind: 'aci', index });
const BY_LAYER: Color = { kind: 'byLayer' };
const BY_BLOCK: Color = { kind: 'byBlock' };

function layer(
  handle: Handle,
  name: string,
  color: Color,
  more: Partial<LayerRecord> = {},
): LayerRecord {
  return {
    handle,
    name,
    color,
    linetype: `LT-${name}`,
    lineweight: 'Default',
    transparency: { alpha: 255 },
    plot: true,
    on: true,
    frozen: false,
    locked: false,
    ...more,
  } as LayerRecord;
}

const L0 = layer('10', '0', aci(7));
const RED = layer('11', 'RED', aci(1), { lineweight: 50 });
const OFF = layer('12', 'OFF', aci(-3));
const TRUE = layer('13', 'TRUE', { kind: 'rgb', r: 18, g: 52, b: 86 });
const src: StyleSource = {
  layers: new Map([L0, RED, OFF, TRUE].map((l) => [l.handle, l])),
  lwDefault: 25,
};
const ent = (over: Partial<Styled> = {}): Styled => ({
  color: BY_LAYER,
  layer: L0.handle,
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  ...over,
});

describe('ACI palette', () => {
  it('has the named colours, the hue rows and the greys', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(aciRgb)).toEqual([
      [255, 0, 0],
      [255, 255, 0],
      [0, 255, 0],
      [0, 255, 255],
      [0, 0, 255],
      [255, 0, 255],
      [255, 255, 255],
      [128, 128, 128],
      [192, 192, 192],
    ]);
    // Hue 0°: five values, each at full then half saturation.
    expect([10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(aciRgb)).toEqual([
      [255, 0, 0],
      [255, 127, 127],
      [165, 0, 0],
      [165, 82, 82],
      [127, 0, 0],
      [127, 63, 63],
      [76, 0, 0],
      [76, 38, 38],
      [38, 0, 0],
      [38, 19, 19],
    ]);
    // Hues 15° apart: 20 is 15°, 160 is 225°, 240 is 345°.
    expect([20, 30, 40, 50, 60, 130, 160, 170, 210, 240].map(aciRgb)).toEqual([
      [255, 63, 0],
      [255, 127, 0],
      [255, 191, 0],
      [255, 255, 0],
      [191, 255, 0],
      [0, 255, 255],
      [0, 63, 255],
      [0, 0, 255],
      [255, 0, 255],
      [255, 0, 63],
    ]);
    expect([250, 251, 252, 253, 254, 255].map((i) => aciRgb(i)[0])).toEqual([
      51, 91, 132, 173, 214, 255,
    ]);
  });

  it('rejects an index outside 0–255', () => {
    expect(() => aciRgb(256)).toThrow(RangeError);
    expect(() => aciRgb(1.5)).toThrow(RangeError);
  });
});

describe('resolveColor', () => {
  it('shows ACI 7 and top-level ByBlock as the background-dependent foreground', () => {
    expect(resolveColor(ent({ color: aci(7) }), src)).toBe('foreground');
    expect(resolveColor(ent({ color: BY_BLOCK }), src)).toBe('foreground');
    expect(resolveColor(ent({ color: aci(1) }), src)).toBe('#ff0000');
    expect(resolveColor(ent({ color: { kind: 'rgb', r: 1, g: 2, b: 255 } }), src)).toBe('#0102ff');
  });

  it('takes ByLayer from the layer, ignoring the minus sign of a layer that is off', () => {
    expect(resolveColor(ent({ layer: RED.handle }), src)).toBe('#ff0000');
    expect(resolveColor(ent({ layer: OFF.handle }), src)).toBe('#00ff00');
    expect(resolveColor(ent({ layer: TRUE.handle }), src)).toBe('#123456');
    expect(resolveColor(ent({ layer: L0.handle }), src)).toBe('foreground');
    expect(resolveColor(ent({ layer: 'FFFF' }), src)).toBe('foreground');
  });

  it('takes ByBlock from the INSERT, and ByLayer on layer 0 from the INSERT’s layer', () => {
    const insert = blockContext(ent({ layer: RED.handle, color: aci(5) }), src);
    expect(resolveColor(ent({ color: BY_BLOCK }), src, insert)).toBe('#0000ff');
    // On layer 0 the object takes the INSERT's layer (RED); on its own layer it keeps it.
    expect(resolveColor(ent({ layer: L0.handle }), src, insert)).toBe('#ff0000');
    expect(resolveColor(ent({ layer: TRUE.handle }), src, insert)).toBe('#123456');
  });

  it('passes ByBlock down through nested inserts', () => {
    const outer = blockContext(ent({ layer: TRUE.handle, color: aci(3) }), src);
    const inner = blockContext(ent({ color: BY_BLOCK, layer: L0.handle }), src, outer);
    expect(inner.color).toBe('#00ff00');
    expect(inner.layer).toBe(TRUE);
    expect(resolveColor(ent({ color: BY_BLOCK }), src, inner)).toBe('#00ff00');
    expect(resolveColor(ent(), src, inner)).toBe('#123456');
  });
});

describe('resolveLinetype and resolveLineweight', () => {
  it('resolves linetypes by layer, by block and directly', () => {
    expect(resolveLinetype(ent({ layer: RED.handle }), src)).toBe('LT-RED');
    expect(resolveLinetype(ent({ linetype: 'ByBlock' }), src)).toBeUndefined();
    expect(resolveLinetype(ent({ linetype: 'AB' }), src)).toBe('AB');
    const insert = blockContext(ent({ layer: RED.handle, linetype: 'CD' }), src);
    expect(resolveLinetype(ent({ linetype: 'ByBlock' }), src, insert)).toBe('CD');
    expect(resolveLinetype(ent(), src, insert)).toBe('LT-RED');
  });

  it('replaces Default with $LWDEFAULT, top-level ByBlock included', () => {
    expect(resolveLineweight(ent({ lineweight: 'Default' }), src)).toBe(25);
    expect(resolveLineweight(ent({ lineweight: 'ByBlock' }), src)).toBe(25);
    expect(resolveLineweight(ent({ lineweight: 35 }), src)).toBe(35);
    expect(resolveLineweight(ent({ lineweight: 0 }), src)).toBe(0);
    expect(resolveLineweight(ent(), src)).toBe(25);
    expect(resolveLineweight(ent({ layer: RED.handle }), src)).toBe(50);
    const insert = blockContext(ent({ lineweight: 70 }), src);
    expect(resolveLineweight(ent({ lineweight: 'ByBlock' }), src, insert)).toBe(70);
  });
});

describe('linetypeScale', () => {
  it('multiplies LTSCALE by the object scale', () => {
    // "A line created with CELTSCALE = 2 in a drawing with LTSCALE set to 0.5 would appear the
    // same as a line created with CELTSCALE = 1 in a drawing with LTSCALE = 1."
    expect(linetypeScale({ ltscale: 0.5, objectScale: 2 })).toBe(
      linetypeScale({ ltscale: 1, objectScale: 1 }),
    );
  });

  it('keeps paper-unit dash lengths in a viewport with PSLTSCALE 1, and follows MSLTSCALE', () => {
    // A 1:50 viewport shows 0.02 paper units per model unit.
    expect(linetypeScale({ ltscale: 1, objectScale: 1, viewportScale: 0.02 })).toBeCloseTo(50, 12);
    expect(linetypeScale({ ltscale: 2, objectScale: 1, annotationScale: 50 })).toBe(100);
  });
});

describe('patternOf', () => {
  it('reads an LTYPE record, its text and shape elements and the absolute-rotation bit', () => {
    const record = {
      handle: '20',
      name: 'GAS',
      description: 'Gas',
      alignment: 'A',
      patternLength: 0.95,
      elements: [
        {
          length: 0.5,
          shapeFlags: 0,
          shapeNumber: 0,
          offset: { x: 0, y: 0 },
          rotation: 0,
          scale: 1,
        },
        {
          length: -0.2,
          shapeFlags: 2 | 1,
          shapeNumber: 0,
          style: '11',
          offset: { x: -0.1, y: -0.05 },
          rotation: 0.5,
          scale: 0.1,
          text: 'GAS',
        },
        {
          length: -0.25,
          shapeFlags: 4,
          shapeNumber: 132,
          offset: { x: 0, y: 0 },
          rotation: 0,
          scale: 1,
        },
      ],
    } as LinetypeRecord;
    const p = patternOf(record);
    expect(patternLength(p)).toBeCloseTo(record.patternLength, 12);
    expect(p.elements[0]).toEqual({ length: 0.5 });
    expect(p.elements[1]!.embed).toEqual({
      kind: 'text',
      text: 'GAS',
      style: '11',
      scale: 0.1,
      rotation: 0.5,
      rotationMode: 'absolute',
      offset: { x: -0.1, y: -0.05 },
    });
    expect(p.elements[2]!.embed).toMatchObject({
      kind: 'shape',
      shapeNumber: 132,
      rotationMode: 'relative',
    });
  });
});

describe('lineweightPixels', () => {
  it('draws one pixel with LWDISPLAY off, and for lineweight 0', () => {
    expect(lineweightPixels(100, { show: false, space: 'model' })).toBe(1);
    expect(lineweightPixels(0, { show: true, space: 'model' })).toBe(1);
  });

  it('uses fixed proportional pixels on the Model tab, whatever the zoom', () => {
    expect(
      [13, 25, 35, 50, 100, 211].map((w) => lineweightPixels(w, { show: true, space: 'model' })),
    ).toEqual([1, 1, 1, 2, 4, 8]);
    expect(lineweightPixels(50, { show: true, space: 'model', displayScale: 2 })).toBe(4);
  });

  it('uses real paper millimetres in a layout, at least one pixel', () => {
    expect(lineweightPixels(50, { show: true, space: 'paper', pixelsPerMillimetre: 10 })).toBe(5);
    expect(lineweightPixels(50, { show: true, space: 'paper', pixelsPerMillimetre: 0.5 })).toBe(1);
  });
});
