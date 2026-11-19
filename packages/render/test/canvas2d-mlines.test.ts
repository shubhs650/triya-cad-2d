// Canvas2DRenderer with multilines (M3-14): an MLINE draws its elements in their own colours,
// its style's fill under them (left out with FILLMODE off), redraws when its style changes, and
// is picked and window-selected by what it draws.
import type { MLineGeometry, MLineStyleRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import { change, drawing, entity, MODEL, surface, type DrawingExtra } from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const STYLE = '30';

/** Fill on in yellow; a red top element 1 up and a blue bottom one 1 down. */
const walls: MLineStyleRecord = {
  handle: STYLE,
  name: 'WALLS',
  description: '',
  styleFlags: 1,
  fillColor: { kind: 'aci', index: 2 },
  startAngle: Math.PI / 2,
  endAngle: Math.PI / 2,
  elements: [
    { offset: 1, color: { kind: 'aci', index: 1 } },
    { offset: -1, color: { kind: 'aci', index: 5 } },
  ],
};

/** A straight multiline from (0, 0) to (10, 0). */
const mline: MLineGeometry = {
  kind: 'MLINE',
  style: STYLE,
  scale: 2,
  justification: 1,
  flags: 1,
  start: { x: 0, y: 0 },
  vertices: [0, 10].map((x) => ({
    position: { x, y: 0 },
    direction: { x: 1, y: 0 },
    miter: { x: 0, y: 1 },
    elements: [
      { parameters: [1, 0], fillParameters: [] },
      { parameters: [-1, 0], fillParameters: [] },
    ],
  })),
};

function setup(extra: Omit<DrawingExtra, 'mlineStyles'> = {}) {
  const d = drawing([entity('20', mline)], { mlineStyles: [walls], ...extra });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    now: () => 0,
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
  r.resize(200, 100, 1);
  // 10 px per unit, (5, 0) at the centre (100, 50).
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const scene = layers[0]!.ctx;
  const redraw = () => {
    scene.clear();
    r.frame();
    return scene;
  };
  return { d, r, redraw, id: d.model.ids.idOf('20')! };
}

const painted = (c: ReturnType<ReturnType<typeof setup>['redraw']>, name: string) =>
  c.calls.filter((k) => k[0] === name).map((k) => k[1]);

describe('multilines in the renderer', () => {
  it('draws its elements in their colours over its fill', () => {
    const c = setup().redraw();
    expect(painted(c, 'stroke').sort()).toEqual(['#0000ff', '#ff0000']);
    expect(painted(c, 'fill')).toEqual(['#ffff00']);
    // The fill is painted before the lines.
    const kinds = c.calls.map((k) => k[0]).filter((k) => k === 'fill' || k === 'stroke');
    expect(kinds[0]).toBe('fill');
  });

  it('leaves the fill out with FILLMODE off, and redraws when FILLMODE changes', () => {
    expect(painted(setup({ header: [['$FILLMODE', 0]] }).redraw(), 'fill')).toEqual([]);
    const s = setup();
    expect(painted(s.redraw(), 'fill')).toHaveLength(1);
    s.r.apply(change(s.d, (b) => b.setHeader('$FILLMODE', 0)));
    expect(painted(s.redraw(), 'fill')).toEqual([]);
  });

  it('redraws when its style changes', () => {
    const s = setup();
    s.redraw();
    s.r.apply(
      change(s.d, (b) =>
        b.updateTableRecord('mlineStyles', STYLE, {
          styleFlags: 0,
          elements: [
            { offset: 1, color: { kind: 'aci', index: 3 } },
            { offset: -1, color: { kind: 'aci', index: 3 } },
          ],
        }),
      ),
    );
    const c = s.redraw();
    expect(painted(c, 'fill')).toEqual([]);
    expect(painted(c, 'stroke')).toEqual(['#00ff00']);
  });

  it('is picked by its elements and taken by a window around them', () => {
    const { r, id } = setup({ header: [['$FILLMODE', 0]] });
    r.frame();
    // The top element at (5, 1) is screen (100, 40); the bottom one (5, -1) is (100, 60).
    expect(r.hitTest({ x: 100, y: 40 }, 2)).toEqual([id]);
    expect(r.hitTest({ x: 100, y: 60 }, 2)).toEqual([id]);
    // Between the elements, with no fill, nothing is drawn to pick.
    expect(r.hitTest({ x: 100, y: 50 }, 2)).toEqual([]);
    expect(r.hitTest({ x: 100, y: 10 }, 2)).toEqual([]);
    expect(r.select({ kind: 'window', box: { minX: -1, minY: -2, maxX: 11, maxY: 2 } })).toEqual([
      id,
    ]);
    // A window around the top element alone does not enclose the multiline; a crossing one takes it.
    const top = { minX: -1, minY: 0.5, maxX: 11, maxY: 2 };
    expect(r.select({ kind: 'window', box: top })).toEqual([]);
    expect(r.select({ kind: 'crossing', box: top })).toEqual([id]);
  });
});
