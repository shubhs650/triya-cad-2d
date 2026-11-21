// M6-02 part 15: a twisted layout viewport made current. Its model space shows turned on the
// canvas, so the view the cursor works in carries a rotation (`ViewTransform.rotation`): picks
// map through it, and the grid of model space runs along the turned axes through the frame.
import type { LayoutPlot, ViewportGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  modelViewOf,
  screenToWorld,
  visibleBox,
  worldToScreen,
  type RenderStyle,
  type ViewTransform,
} from '../src/index';
import { drawing, entity, line, PAPER, surface } from './fixtures';

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe('a turned view', () => {
  const turned: ViewTransform = { center: { x: 10, y: 20 }, scale: 2, rotation: Math.PI / 2 };

  it('maps world and screen both ways, world +X up the screen for a quarter turn', () => {
    // The centre at the canvas middle (100, 50); world +X runs up the screen.
    close(worldToScreen(turned, 200, 100, { x: 10, y: 20 }), 100, 50);
    close(worldToScreen(turned, 200, 100, { x: 15, y: 20 }), 100, 40);
    close(worldToScreen(turned, 200, 100, { x: 10, y: 25 }), 90, 50);
    close(screenToWorld(turned, 200, 100, { x: 100, y: 40 }), 15, 20);
    close(screenToWorld(turned, 200, 100, { x: 90, y: 50 }), 10, 25);
    const p = { x: 37, y: -4 };
    close(screenToWorld(turned, 200, 100, worldToScreen(turned, 200, 100, p)), p.x, p.y);
  });

  it('shows the box holding the turned canvas', () => {
    // 200 × 100 px at 2 px a unit, turned a quarter: 50 units of Y across, 100 of X up.
    const b = visibleBox(turned, 200, 100);
    expect(b.minX).toBeCloseTo(-15, 9);
    expect(b.maxX).toBeCloseTo(35, 9);
    expect(b.minY).toBeCloseTo(-30, 9);
    expect(b.maxY).toBeCloseTo(70, 9);
  });

  it('leaves an unturned view as it was', () => {
    const plain = { center: { x: 10, y: 20 }, scale: 2 };
    expect(worldToScreen(plain, 200, 100, { x: 15, y: 20 })).toEqual({ x: 110, y: 50 });
    expect(screenToWorld({ ...plain, rotation: 0 }, 200, 100, { x: 110, y: 50 })).toEqual({
      x: 15,
      y: 20,
    });
  });
});

const LIGHT: RenderStyle = {
  background: '#ffffff',
  foreground: '#000000',
  showLineweights: false,
  layoutBackground: '#c0c0c0',
};

const PLOT: LayoutPlot = {
  paperSize: 'custom',
  paperWidth: 200,
  paperHeight: 100,
  margins: { left: 10, bottom: 10, right: 10, top: 10 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 0,
};

/**
 * Frame 40…80 × 20…60 on the sheet, showing model 0…20 × 0…20 (scale 2) turned a quarter turn
 * counterclockwise about model (10, 10) at the frame centre: the view centre is in the twisted
 * display coordinates, where model (10, 10) is (−10, 10).
 */
const TWISTED: ViewportGeometry = {
  kind: 'VIEWPORT',
  center: { x: 60, y: 40 },
  width: 40,
  height: 40,
  id: 2,
  status: 1,
  flags: 0,
  viewCenter: { x: -10, y: 10 },
  viewHeight: 20,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: Math.PI / 2,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
};

const VP = '30';
const VIEW = { center: { x: 90, y: 40 }, scale: 1 };

function setup() {
  const d = drawing([entity(VP, TWISTED, { owner: PAPER }), entity('20', line(0, 0, 20, 20))], {
    layoutPlot: PLOT,
  });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    now: () => 0,
    model: d.model,
    index: d.index,
    block: PAPER,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: LIGHT,
    requestIdle: () => undefined,
  });
  r.resize(200, 100, 1);
  r.setView(VIEW);
  const id = (h: string) => d.model.ids.idOf(h)!;
  return { d, r, scene: layers[0]!, id };
}

describe('a twisted layout viewport made current', () => {
  it('gives the cursor model space turned by the twist', () => {
    const v = modelViewOf(VIEW, TWISTED);
    expect(v.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(v.scale).toBeCloseTo(2, 12);
    // Model (5, 5) is paper (70, 30): device (80, 60). Model (5, 15) is paper (50, 30).
    close(screenToWorld(v, 200, 100, { x: 80, y: 60 }), 5, 5);
    close(screenToWorld(v, 200, 100, { x: 60, y: 60 }), 5, 15);
    close(worldToScreen(v, 200, 100, { x: 10, y: 10 }), 70, 50);
  });

  it('picks model space’s objects where the turned view shows them', () => {
    const { r, id } = setup();
    r.setActiveViewport(VP);
    const v = modelViewOf(VIEW, TWISTED);
    expect(r.hitTest({ x: 80, y: 60 }, 3, v)).toEqual([id('20')]);
    // Device (60, 60) is model (5, 15): off the diagonal, where an untwisted view had it.
    expect(r.hitTest({ x: 60, y: 60 }, 3, v)).toEqual([]);
  });

  it('runs model space’s grid along the turned axes, clipped to the frame', () => {
    const { r, scene } = setup();
    r.setStyle({ ...LIGHT, grid: { spacing: { x: 10, y: 10 }, major: 0, adaptive: false } });
    r.setActiveViewport(VP);
    r.frame();
    const calls = scene.ctx.calls;
    // The grid is stroked between a save/clip to the frame (device 50…90 × 30…70) and a restore.
    const start = calls.findIndex((c) => c[0] === 'rect' && c[1] === 50 && c[2] === 30);
    expect(start).toBeGreaterThan(-1);
    const segments: [number, number, number, number][] = [];
    for (let i = start; i < calls.length - 1 && calls[i]![0] !== 'restore'; i++) {
      const [a, b] = [calls[i]!, calls[i + 1]!];
      if (a[0] === 'moveTo' && b[0] === 'lineTo') {
        segments.push([a[1], a[2], b[1], b[2]] as [number, number, number, number]);
      }
    }
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    // Model X = 0, 10, 20 turned a quarter: horizontal lines at device y 70, 50, 30.
    const horizontal = segments.filter((s) => near(s[1], s[3]) && !near(s[0], s[2]));
    for (const y of [70, 50, 30]) expect(horizontal.some((s) => near(s[1], y))).toBe(true);
    // Model Y = 0, 10, 20: vertical lines at device x 90, 70, 50.
    const vertical = segments.filter((s) => near(s[0], s[2]) && !near(s[1], s[3]));
    for (const x of [90, 70, 50]) expect(vertical.some((s) => near(s[0], x))).toBe(true);
    // Every grid segment is one or the other: none slants.
    expect(horizontal.length + vertical.length).toBe(segments.length);
  });
});
