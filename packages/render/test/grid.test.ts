// M2-04 part 2: GRID (F7) display. AutoCAD 2024 draws the 2D grid as lines (GRIDSTYLE 0) at
// GRIDUNIT, every GRIDMAJOR-th line a major line, and with adaptive display (GRIDDISPLAY bit 2)
// leaves out lines that would come closer than a few pixels apart, showing every GRIDMAJOR-th
// line instead. Help, "GRID (Command)", "GRIDDISPLAY", "GRIDMAJOR".
import { describe, expect, it } from 'vitest';
import { GRID_MIN_PX, gridLines } from '../src/grid';
import { Canvas2DRenderer } from '../src/index';
import { mixColors } from '../src/style/mix';
import { drawing, entity, line, MODEL, surface } from './fixtures';

const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

describe('gridLines', () => {
  it('draws a line every GRIDUNIT, every GRIDMAJOR-th a major one', () => {
    const g = gridLines({ spacing: { x: 10, y: 10 }, major: 5 }, box, 1)!;
    expect(g.xs).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(g.ys).toEqual([0, 10, 20, 30, 40, 50]);
    expect(g.majorXs).toEqual([0, 50, 100]);
    expect(g.majorYs).toEqual([0, 50]);
  });

  it('runs from SNAPBASE-like grid base and its own X and Y spacing', () => {
    const g = gridLines({ spacing: { x: 20, y: 5 }, base: { x: 3, y: 1 }, major: 2 }, box, 1)!;
    expect(g.xs).toEqual([3, 23, 43, 63, 83]);
    expect(g.ys[0]).toBe(1);
    expect(g.majorXs).toEqual([3, 43, 83]);
  });

  it('coarsens by GRIDMAJOR while lines would be closer than the minimum on screen', () => {
    // 10 units at 0.5 px a unit is 5 px: too dense; 50 units (25 px) is not.
    const g = gridLines({ spacing: { x: 10, y: 10 }, major: 5 }, box, 0.5)!;
    expect(10 * 0.5).toBeLessThan(GRID_MIN_PX);
    expect(g.xs).toEqual([0, 50, 100]);
    expect(g.majorXs).toEqual([0]);
    // Far too dense for any coarsening shows no grid rather than a grey wash.
    expect(gridLines({ spacing: { x: 1e-9, y: 1e-9 }, major: 5 }, box, 1)).toBeUndefined();
  });

  it('takes a GRIDMAJOR under 2 as 5 when coarsening (no major lines of its own)', () => {
    const g = gridLines({ spacing: { x: 10, y: 10 }, major: 1 }, box, 0.5)!;
    expect(g.xs).toEqual([0, 50, 100]);
    expect(g.majorXs).toEqual([]);
  });
});

describe('Canvas2DRenderer grid', () => {
  it('draws the grid on the scene only while RenderStyle.grid is set', () => {
    const d = drawing([entity('100', line(0, 0, 10, 0))]);
    const layers: ReturnType<typeof surface>[] = [];
    const style = { background: '#000000', foreground: '#ffffff', showLineweights: false };
    const r = new Canvas2DRenderer({
      model: d.model,
      index: d.index,
      block: MODEL,
      surface: surface('visible'),
      createLayer: () => {
        const s = surface(layers.length === 0 ? 'scene' : 'transient');
        layers.push(s);
        return s;
      },
      style,
      requestIdle: () => {},
    });
    r.resize(200, 100, 1);
    r.setView({ center: { x: 0, y: 0 }, scale: 2 });
    const strokes = () => {
      layers[0]!.ctx.clear();
      r.frame();
      return layers[0]!.ctx.calls.filter((c) => c[0] === 'stroke').length;
    };
    const plain = strokes();
    r.setStyle({ ...style, grid: { spacing: { x: 10, y: 10 }, major: 5 } });
    // Minor and major lines, each one stroke, under the line.
    expect(strokes()).toBe(plain + 2);
    r.setStyle(style);
    expect(strokes()).toBe(plain);
    // A grid colour from Settings (M2-20): the major lines in it, the minor ones half way.
    r.setStyle({ ...style, grid: { spacing: { x: 10, y: 10 }, major: 5, color: '#00ff00' } });
    layers[0]!.ctx.clear();
    r.frame();
    const colours = layers[0]!.ctx.calls.filter((c) => c[0] === 'strokeStyle').map((c) => c[1]);
    expect(colours.slice(0, 2)).toEqual([mixColors(style.background, '#00ff00', 0.5), '#00ff00']);
  });
});
