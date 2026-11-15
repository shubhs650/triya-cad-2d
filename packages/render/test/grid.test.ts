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

// M3-06 part 6: Grid behavior and Grid style (AutoCAD 2024 Help, "GRIDDISPLAY", "GRIDSTYLE",
// "Snap and Grid Tab (Drafting Settings Dialog Box)").
// M3-06 part 7: a grid along a UCS turned by 90° from its base, or by SNAPANG.
describe('a turned grid', () => {
  it('lays its lines out in the frame turned about the base, over the view', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 40 };
    const g = gridLines(
      { spacing: { x: 10, y: 20 }, base: { x: 0, y: 0 }, major: 5, angle: Math.PI / 2 },
      box,
      1,
    )!;
    // The frame's X runs up the world's Y (0–40), its Y towards world −X (−100–0).
    expect(g.turned!.frame.minX).toBeCloseTo(0, 9);
    expect(g.turned!.frame.maxX).toBeCloseTo(40, 9);
    expect(g.turned!.frame.minY).toBeCloseTo(-100, 9);
    expect(g.turned!.frame.maxY).toBeCloseTo(0, 9);
    expect(g.xs).toEqual([0, 10, 20, 30, 40]);
    expect(g.ys).toEqual([-100, -80, -60, -40, -20, 0]);
    expect(g.extent).toBeUndefined();
  });

  it('draws each line slanted between the frame’s sides', () => {
    const style = { background: '#000000', foreground: '#ffffff', showLineweights: false };
    const d = drawing([]);
    const layers: ReturnType<typeof surface>[] = [];
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
      style: { ...style, grid: { spacing: { x: 10, y: 10 }, major: 5, angle: Math.PI / 4 } },
      requestIdle: () => {},
    });
    r.resize(200, 100, 1);
    r.setView({ center: { x: 0, y: 0 }, scale: 2 });
    layers[0]!.ctx.clear();
    r.frame();
    const moves = layers[0]!.ctx.calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo');
    expect(moves.length).toBeGreaterThan(0);
    // Not one line is horizontal or vertical on the device.
    for (let i = 0; i + 1 < moves.length; i += 2) {
      const [, x0, y0] = moves[i] as [string, number, number];
      const [, x1, y1] = moves[i + 1] as [string, number, number];
      expect(Math.abs(Math.abs(x1 - x0) - Math.abs(y1 - y0))).toBeLessThan(1e-6);
    }
  });
});

describe('gridLines behaviour', () => {
  it('without adaptive display shows no grid too dense to see, rather than coarsening', () => {
    expect(gridLines({ spacing: { x: 10, y: 10 }, major: 5, adaptive: false }, box, 0.5)).toBe(
      undefined,
    );
    const g = gridLines({ spacing: { x: 10, y: 10 }, major: 5, adaptive: false }, box, 1)!;
    expect(g.xs).toHaveLength(11);
  });

  it('subdivides below the grid spacing by GRIDMAJOR when zoomed in far enough', () => {
    const spec = { spacing: { x: 10, y: 10 }, major: 5, subdivide: true };
    // 10 units at 1 px is 10 px: a fifth of that (2 px) would be too dense.
    expect(gridLines(spec, box, 1)!.xs).toHaveLength(11);
    // At 10 px a unit, lines every 2 units are 20 px apart; the old lines stay major.
    const g = gridLines(spec, { minX: 0, minY: 0, maxX: 10, maxY: 4 }, 10)!;
    expect(g.xs).toEqual([0, 2, 4, 6, 8, 10]);
    expect(g.majorXs).toEqual([0, 10]);
    expect(g.ys).toEqual([0, 2, 4]);
    // Not adaptive: no subdivision.
    const plain = gridLines(
      { ...spec, adaptive: false },
      { minX: 0, minY: 0, maxX: 10, maxY: 4 },
      10,
    )!;
    expect(plain.xs).toEqual([0, 10]);
  });

  it('keeps the grid within the limits unless it runs beyond them', () => {
    const limits = { minX: 15, minY: 5, maxX: 62, maxY: 30 };
    const g = gridLines({ spacing: { x: 10, y: 10 }, major: 5, limits }, box, 1)!;
    expect(g.xs).toEqual([20, 30, 40, 50, 60]);
    expect(g.ys).toEqual([10, 20, 30]);
    expect(g.majorXs).toEqual([50]);
    expect(g.extent).toEqual(limits);
    // Limits wholly off the view: nothing to draw.
    const away = { minX: 500, minY: 500, maxX: 600, maxY: 600 };
    expect(gridLines({ spacing: { x: 10, y: 10 }, major: 5, limits: away }, box, 1)).toBe(
      undefined,
    );
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

  it('draws a dotted grid (GRIDSTYLE) as a dot where the lines cross, and lines only within the limits', () => {
    const d = drawing([]);
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
    const calls = () => {
      layers[0]!.ctx.clear();
      r.frame();
      return layers[0]!.ctx.calls;
    };
    // The view is 100 × 50 units about the origin: 11 × 5 crossings 10 apart.
    const spacing = { x: 10, y: 10 };
    r.setStyle({ ...style, grid: { spacing, major: 5, dots: true } });
    const dotted = calls();
    expect(dotted.filter((c) => c[0] === 'rect').length).toBe(11 * 5);
    expect(dotted.filter((c) => c[0] === 'moveTo').length).toBe(0);
    // Lines within limits from (0,0) to (20,20): three each way, as long as the limits.
    r.setStyle({
      ...style,
      grid: { spacing, major: 5, limits: { minX: 0, minY: 0, maxX: 20, maxY: 20 } },
    });
    const limited = calls().filter((c) => c[0] === 'lineTo');
    expect(limited.length).toBe(6);
    // Device pixels: the view's centre (0,0) is at (100,50), 2 px a unit, Y up; each line
    // runs from the limits' top or left edge to the other.
    expect(limited).toContainEqual(['lineTo', 100.5, 50]);
    expect(limited).toContainEqual(['lineTo', 140, 50.5]);
  });
});
