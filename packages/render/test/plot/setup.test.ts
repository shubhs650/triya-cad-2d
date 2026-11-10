// Plot placement (M2-17): paper, orientation, area, scale and offset → page and transform.
import { describe, expect, it } from 'vitest';
import { POINTS_PER_MM, applyAffine, plotSetup } from '../../src/index';

const A4 = { width: 210, height: 297 };
const area = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

describe('plotSetup', () => {
  it('fits the area to the paper and centres it', () => {
    const s = plotSetup({
      paper: A4,
      orientation: 'landscape',
      area,
      scale: 'fit',
      offset: 'center',
    });
    expect([s.width, s.height]).toEqual([297, 210]);
    // 297 / 100 = 2.97 across, 210 / 50 = 4.2 up: the width decides.
    expect(s.scale).toBeCloseTo(2.97, 12);
    expect(s.offset.x).toBeCloseTo(0, 12);
    expect(s.offset.y).toBeCloseTo((210 - 50 * 2.97) / 2, 12);
    const corner = applyAffine(s.toPaper, { x: 100, y: 50 });
    expect(corner.x / POINTS_PER_MM).toBeCloseTo(297, 9);
    expect(corner.y / POINTS_PER_MM).toBeCloseTo(s.offset.y + 50 * 2.97, 9);
  });

  it('places the area at a scale and offset from the paper’s corner', () => {
    const s = plotSetup({
      paper: A4,
      orientation: 'portrait',
      area: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
      scale: 0.5,
      offset: { x: 15, y: 25 },
    });
    expect([s.width, s.height]).toEqual([210, 297]);
    const p = applyAffine(s.toPaper, { x: 10, y: 20 });
    expect(p.x).toBeCloseTo(15 * POINTS_PER_MM, 9);
    expect(p.y).toBeCloseTo(25 * POINTS_PER_MM, 9);
    expect(s.clip.x).toBeCloseTo(15 * POINTS_PER_MM, 9);
    expect(s.clip.width).toBeCloseTo(50 * POINTS_PER_MM, 9);
    expect(s.clip.height).toBeCloseTo(25 * POINTS_PER_MM, 9);
  });

  it('turns the plot 180° upside down', () => {
    const s = plotSetup({
      paper: A4,
      orientation: 'landscape',
      upsideDown: true,
      area,
      scale: 1,
      offset: { x: 0, y: 0 },
    });
    const p = applyAffine(s.toPaper, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(297 * POINTS_PER_MM, 9);
    expect(p.y).toBeCloseTo(210 * POINTS_PER_MM, 9);
    expect(s.clip.x).toBeCloseTo(197 * POINTS_PER_MM, 9);
    expect(s.clip.y).toBeCloseTo(160 * POINTS_PER_MM, 9);
  });

  it('cuts the plot area to the paper', () => {
    const s = plotSetup({
      paper: A4,
      orientation: 'portrait',
      area,
      scale: 10,
      offset: { x: 0, y: 0 },
    });
    expect(s.clip.width).toBeCloseTo(210 * POINTS_PER_MM, 9);
    expect(s.clip.height).toBeCloseTo(297 * POINTS_PER_MM, 9);
  });

  it('refuses an empty area or a scale that is not positive', () => {
    const empty = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
    expect(() =>
      plotSetup({
        paper: A4,
        orientation: 'portrait',
        area: empty,
        scale: 'fit',
        offset: 'center',
      }),
    ).toThrow(/empty/);
    expect(() =>
      plotSetup({ paper: A4, orientation: 'portrait', area, scale: 0, offset: 'center' }),
    ).toThrow(/scale/);
  });
});
