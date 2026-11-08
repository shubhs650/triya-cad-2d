// M1-62: the layers a viewport shows, its VPLAYER-style overrides applied.
import { describe, expect, it } from 'vitest';
import { viewportLayers, type LayerRecord } from '../../src/index';

const layer = (handle: string, extra: Partial<LayerRecord> = {}): LayerRecord => ({
  handle,
  name: `L${handle}`,
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

describe('viewportLayers', () => {
  const walls = layer('20', {
    viewportOverrides: [
      { viewport: '44', color: { kind: 'aci', index: 3 }, lineweight: 70 },
      { viewport: '45', transparency: { alpha: 127 } },
    ],
  });
  const piping = layer('21', {
    viewportOverrides: [
      { viewport: '44', linetype: '2F', color: { kind: 'rgb', r: 255, g: 128, b: 0 } },
    ],
  });
  const grid = layer('22');
  const layers = new Map([walls, piping, grid].map((l) => [l.handle, l]));

  it('applies the overrides of one viewport and leaves other layers as they are', () => {
    const shown = viewportLayers(layers, '44');
    expect(shown).toBeDefined();
    expect(shown!.layers.get('20')).toMatchObject({
      color: { kind: 'aci', index: 3 },
      lineweight: 70,
      linetype: '14',
      transparency: { alpha: 255 },
    });
    expect(shown!.layers.get('21')).toMatchObject({
      color: { kind: 'rgb', r: 255, g: 128, b: 0 },
      linetype: '2F',
      lineweight: 35,
    });
    expect(shown!.layers.get('22')).toBe(grid);
    expect([...shown!.overridden].sort()).toEqual(['20', '21']);
  });

  it('keeps the overrides of each viewport to that viewport', () => {
    const other = viewportLayers(layers, '45');
    expect([...other!.overridden]).toEqual(['20']);
    expect(other!.layers.get('20')).toMatchObject({
      color: { kind: 'aci', index: 1 },
      transparency: { alpha: 127 },
    });
  });

  it('is undefined for a viewport no layer overrides', () => {
    expect(viewportLayers(layers, '46')).toBeUndefined();
  });
});
