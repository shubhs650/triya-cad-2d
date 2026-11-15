// M3-01 part 4: POINT objects shown by PDMODE and PDSIZE: the figure's lines, its size (absolute,
// or a share of the view's height), on the canvas (sized when drawn, redrawn when the variables
// change) and in a plot (sized by the view plotted).
import type { EntityGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  PATH_A,
  PATH_L,
  PATH_M,
  PATH_Z,
  PlotResolver,
  figureOf,
  figureSize,
  plotParts,
  pointFigurePath,
  pointHasDot,
  tessellate,
  type RenderStyle,
} from '../src/index';
import { change, drawing, entity, MODEL, surface, type DrawingExtra } from './fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const point = (x: number, y: number, xAxisAngle?: number): EntityGeometry => ({
  kind: 'POINT',
  position: { x, y },
  ...(xAxisAngle !== undefined && { xAxisAngle }),
});

describe('pointFigurePath', () => {
  it('draws nothing for a dot or PDMODE 1', () => {
    expect(pointFigurePath(0, 0, 0, 2)).toEqual([]);
    expect(pointFigurePath(0, 0, 1, 2)).toEqual([]);
    expect(pointHasDot(0)).toBe(true);
    expect(pointHasDot(32)).toBe(true);
    expect(pointHasDot(34)).toBe(false);
  });

  it('a plus, a cross and a tick, half the size from the point', () => {
    expect(pointFigurePath(1, 1, 2, 2).map(r6)).toEqual([
      PATH_M,
      0,
      1,
      PATH_L,
      2,
      1,
      PATH_M,
      1,
      0,
      PATH_L,
      1,
      2,
    ]);
    const h = r6(Math.SQRT1_2);
    expect(pointFigurePath(0, 0, 3, 2).map(r6)).toEqual([
      PATH_M,
      -h,
      -h,
      PATH_L,
      h,
      h,
      PATH_M,
      -h,
      h,
      PATH_L,
      h,
      -h,
    ]);
    expect(pointFigurePath(0, 0, 4, 2)).toEqual([PATH_M, 0, 0, PATH_L, 0, 1]);
  });

  it('adds the circle (32) and the square (64), turned with the point', () => {
    expect(pointFigurePath(0, 0, 33, 4)).toEqual([
      PATH_M,
      2,
      0,
      PATH_A,
      0,
      0,
      2,
      0,
      2 * Math.PI,
      1,
      PATH_Z,
    ]);
    expect(pointFigurePath(0, 0, 65, 2)).toEqual([
      PATH_M,
      -1,
      -1,
      PATH_L,
      1,
      -1,
      PATH_L,
      1,
      1,
      PATH_L,
      -1,
      1,
      PATH_Z,
    ]);
    // A plus turned 90°: the arms swap.
    expect(pointFigurePath(0, 0, 2, 2, Math.PI / 2).map(r6)).toEqual([
      PATH_M,
      0,
      -1,
      PATH_L,
      0,
      1,
      PATH_M,
      1,
      0,
      PATH_L,
      -1,
      0,
    ]);
  });

  it('sizes absolutely, 5% of the view at 0, a percentage when negative', () => {
    expect(figureSize(3, 100)).toBe(3);
    expect(figureSize(0, 100)).toBe(5);
    expect(figureSize(-10, 100)).toBe(10);
  });
});

describe('tessellate', () => {
  const paint = { color: 'foreground' as const };

  it('a dot without the variables or at PDMODE 0, a figure otherwise, nothing at 1', () => {
    expect(tessellate(point(1, 2), paint)).toEqual([
      { kind: 'point', x: 1, y: 2, color: 'foreground' },
    ]);
    expect(tessellate(point(1, 2), paint, { points: { mode: 0, size: 5 } })[0]).not.toHaveProperty(
      'figure',
    );
    expect(tessellate(point(1, 2, 0.5), paint, { points: { mode: 35, size: -5 } })).toEqual([
      {
        kind: 'point',
        x: 1,
        y: 2,
        color: 'foreground',
        figure: { mode: 35, size: -5, angle: 0.5 },
      },
    ]);
    expect(tessellate(point(1, 2), paint, { points: { mode: 1, size: 0 } })).toEqual([]);
    expect(tessellate(point(1, 2), paint, { points: { mode: 33, size: 0 } })).toHaveLength(1);
    expect(figureOf(undefined)).toBeUndefined();
  });
});

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };

function setup(extra?: DrawingExtra) {
  const d = drawing([entity('20', point(0, 0))], extra);
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(`layer${layers.length}`);
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
  });
  // 200 × 100 CSS px at 10 px a unit: the view is 10 units tall.
  r.resize(200, 100, 1);
  const scene = layers[0]!.ctx;
  const redraw = (scale = 10) => {
    scene.clear();
    r.setView({ center: { x: 0, y: 0 }, scale });
    r.frame();
    return scene;
  };
  return { d, r, redraw };
}

/** The dots drawn: the fills but the background's. */
const dots = (c: ReturnType<typeof surface>['ctx']) =>
  c.named('fillRect').filter((f) => f[3] !== 200);

describe('Canvas2DRenderer', () => {
  it('draws a dot at PDMODE 0', () => {
    const c = setup().redraw();
    expect(dots(c)).toHaveLength(1);
    expect(c.named('stroke')).toEqual([]);
  });

  it('strokes the figure at PDMODE 34, sized by the view height, with no dot', () => {
    const s = setup({
      header: [
        ['$PDMODE', 34],
        ['$PDSIZE', -20],
      ],
    });
    let c = s.redraw();
    expect(dots(c)).toEqual([]);
    expect(c.named('stroke')).toHaveLength(1);
    // 20% of a 10-unit view: a circle of radius 1.
    expect(c.named('arc')[0]?.[3]).toBeCloseTo(1);
    // Zoomed out twice as far: 20% of 20 units.
    c = s.redraw(5);
    expect(c.named('arc')[0]?.[3]).toBeCloseTo(2);
    expect(s.r.viewHeight).toBe(20);
  });

  it('redraws when PDMODE or PDSIZE change', () => {
    const s = setup();
    expect(s.redraw().named('stroke')).toEqual([]);
    s.r.apply(change(s.d, (b) => b.setHeader('$PDMODE', 32)));
    let c = s.redraw();
    expect(c.named('stroke')).toHaveLength(1);
    // PDMODE 32 keeps the dot inside the circle.
    expect(dots(c)).toHaveLength(1);
    s.r.apply(change(s.d, (b) => b.setHeader('$PDSIZE', 3)));
    c = s.redraw(1);
    // An absolute size does not follow the view: radius 1.5 at any zoom.
    expect(c.named('arc')[0]?.[3]).toBeCloseTo(1.5);
  });
});

describe('plotParts', () => {
  const resolver = new PlotResolver();

  it('plots the figure as lines, sized by the view plotted', () => {
    const { model } = drawing([entity('20', point(0, 0))], {
      header: [
        ['$PDMODE', 2],
        ['$PDSIZE', 0],
      ],
    });
    const parts = plotParts(model, MODEL, { resolver, viewHeight: 40 });
    // 5% of 40: a plus 2 wide.
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      kind: 'stroke',
      path: [PATH_M, -1, 0, PATH_L, 1, 0, PATH_M, 0, -1, PATH_L, 0, 1],
    });
  });

  it('keeps the dot of PDMODE 32 and an absolute size without a view', () => {
    const { model } = drawing([entity('20', point(5, 5))], {
      header: [
        ['$PDMODE', 32],
        ['$PDSIZE', 2],
      ],
    });
    const parts = plotParts(model, MODEL, { resolver });
    expect(parts.map((p) => p.kind)).toEqual(['stroke', 'point']);
  });

  it('plots a relative size with no view to size it by as a dot', () => {
    const { model } = drawing([entity('20', point(5, 5))], {
      header: [
        ['$PDMODE', 3],
        ['$PDSIZE', -5],
      ],
    });
    expect(plotParts(model, MODEL, { resolver }).map((p) => p.kind)).toEqual(['point']);
  });
});
