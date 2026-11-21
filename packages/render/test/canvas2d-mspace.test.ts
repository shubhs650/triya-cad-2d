// M6-02 part 3: a layout viewport made current (MSPACE). Picks, windows and snaps take model
// space's objects through it; the selection, grips and previews are drawn through it, clipped
// to its frame, which is drawn bold.
import type { EntityInit, LayoutPlot, ViewportGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  MAXIMIZED_VIEWPORT_COLOR,
  modelViewOf,
  screenToWorld,
  type RenderStyle,
} from '../src/index';
import { drawing, entity, line, PAPER, surface, type Call } from './fixtures';

const LIGHT: RenderStyle = {
  background: '#ffffff',
  foreground: '#000000',
  showLineweights: false,
  layoutBackground: '#c0c0c0',
};

/** A 200 × 100 mm sheet with 10 mm margins all round: paper −10…190 × −10…90. */
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

/** Frame 40…80 × 20…60 on the sheet, showing model 0…20 × 0…20 (scale 2). */
const VIEWPORT: ViewportGeometry = {
  kind: 'VIEWPORT',
  center: { x: 60, y: 40 },
  width: 40,
  height: 40,
  id: 2,
  status: 1,
  flags: 0,
  viewCenter: { x: 10, y: 10 },
  viewHeight: 20,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
};

const VP = '30';
const VIEW = { center: { x: 90, y: 40 }, scale: 1 };

function setup(extra: EntityInit[] = []) {
  const d = drawing(
    [
      entity(VP, VIEWPORT, { owner: PAPER }),
      // Model space: a diagonal across the view; paper space: a line right of the viewport.
      entity('20', line(0, 0, 20, 20)),
      entity('31', line(100, 30, 120, 30), { owner: PAPER }),
      ...extra,
    ],
    { layoutPlot: PLOT },
  );
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
  // 1 CSS px per millimetre, paper point (90, 40) at the canvas centre.
  r.resize(200, 100, 1);
  r.setView(VIEW);
  const id = (h: string) => d.model.ids.idOf(h)!;
  return { d, r, scene: layers[0]!, transient: layers[1]!, id };
}

/** The calls between a `save` and its `restore`. */
function clipped(calls: Call[]): Call[][] {
  const out: Call[][] = [];
  let cur: Call[] | undefined;
  for (const c of calls) {
    if (c[0] === 'save') cur = [];
    else if (c[0] === 'restore') {
      if (cur) out.push(cur);
      cur = undefined;
    } else cur?.push(c);
  }
  return out;
}

describe('a layout viewport made current', () => {
  it('shows model space at the screen point its sheet point is at', () => {
    const v = modelViewOf(VIEW, VIEWPORT);
    expect(v).toEqual({ center: { x: 25, y: 10 }, scale: 2 });
    // Model (0, 0) is paper (40, 20): device (50, 70).
    expect(screenToWorld(v, 200, 100, { x: 50, y: 70 })).toEqual({ x: 0, y: 0 });
  });

  it('picks and windows take model space’s objects through it, paper space’s again after', () => {
    const { r, id } = setup();
    const model = modelViewOf(VIEW, VIEWPORT);
    // Device (60, 60) is model (5, 5), on the diagonal.
    expect(r.hitTest({ x: 60, y: 60 }, 3, VIEW)).toEqual([]);
    r.setActiveViewport(VP);
    expect(r.pickBlock).toBe('1F');
    expect(r.hitTest({ x: 60, y: 60 }, 3, model)).toEqual([id('20')]);
    expect(r.select({ kind: 'window', box: { minX: -1, minY: -1, maxX: 21, maxY: 21 } })).toEqual([
      id('20'),
    ]);
    // The paper-space line is not taken while the viewport is current.
    expect(r.hitTest({ x: 110, y: 60 }, 3, model)).toEqual([]);
    r.setActiveViewport(undefined);
    expect(r.pickBlock).toBe(PAPER);
    expect(r.hitTest({ x: 110, y: 60 }, 3, VIEW)).toEqual([id('31')]);
  });

  it('draws previews through it, clipped to its frame, and its frame bold', () => {
    const { r, transient } = setup();
    r.setActiveViewport(VP);
    r.setTransient([{ kind: 'stroke', path: [0, 0, 0, 1, 20, 0], color: '#ff0000' }]);
    r.frame();
    const [inside] = clipped(transient.ctx.calls);
    // Frame 40…80 × 20…60 → device x 50…90, y 30…70.
    expect(inside!.filter((c) => c[0] === 'rect')).toEqual([['rect', 50, 30, 40, 40]]);
    // Model (10, 10) is the frame centre, device (70, 50); 2 px per model unit.
    expect(inside).toContainEqual(['setTransform', 2, -0, 0, -2, 70, 50]);
    expect(inside!.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toEqual([
      ['moveTo', -10, -10],
      ['lineTo', 10, -10],
    ]);
    // After the clip, the frame: 3 px in the foreground colour.
    const after = transient.ctx.calls.slice(
      transient.ctx.calls.findLastIndex((c) => c[0] === 'restore'),
    );
    expect(after).toContainEqual(['lineWidth', 3]);
    expect(after).toContainEqual(['strokeStyle', '#000000']);
    expect(after.filter((c) => c[0] === 'lineTo')).toHaveLength(3);
  });

  it('draws the selection of model space’s objects through it', () => {
    const { r, scene, id } = setup();
    r.setActiveViewport(VP);
    r.setHighlight([id('20')]);
    r.frame();
    const views = clipped(scene.ctx.calls);
    // The viewport's view, then the selection through it.
    expect(views).toHaveLength(2);
    const selection = views[1]!;
    expect(selection).toContainEqual(['setTransform', 2, -0, 0, -2, 70, 50]);
    expect(selection.filter((c) => c[0] === 'stroke')).toHaveLength(2);
  });

  it('is none once its viewport is off: the layout is worked in on paper again', () => {
    const { r, d } = setup();
    r.setActiveViewport(VP);
    const vp = d.model.entity(d.model.ids.idOf(VP)!)!;
    const off = { ...vp, geom: { ...VIEWPORT, flags: 0x20000 } };
    d.model.apply({ entities: { updated: [{ before: vp, after: off }] } });
    r.apply({ entities: { updated: [{ before: vp, after: off }] } });
    expect(r.pickBlock).toBe(PAPER);
  });
});

/**
 * M6-02 part 7 (VPMAX): the viewport maximized, framed by the whole canvas (paper −10…190 ×
 * −10…90 at VIEW), showing model space about (10, 10), 50 high: 2 px per model unit.
 */
const MAXIMIZED: ViewportGeometry = {
  ...VIEWPORT,
  center: { x: 90, y: 40 },
  width: 200,
  height: 100,
  viewHeight: 50,
};

describe('a layout viewport maximized', () => {
  it('fills the canvas with its model space alone: no sheet, paper objects or frame', () => {
    const { r, scene } = setup();
    r.setActiveViewport(VP, MAXIMIZED);
    r.frame();
    const calls = scene.ctx.calls;
    // The viewport's view, then what is selected through it.
    const views = clipped(calls);
    expect(views).toHaveLength(2);
    expect(views[0]!.filter((c) => c[0] === 'rect')).toEqual([['rect', 0, 0, 200, 100]]);
    // Model (10, 10) at the canvas centre, 2 px per model unit.
    expect(views[0]).toContainEqual(['setTransform', 2, -0, 0, -2, 100, 50]);
    // Nothing is stroked outside the viewport: not the sheet, nor the paper-space line.
    const outside = calls.filter((c, i) => {
      const opened = calls.slice(0, i).filter((x) => x[0] === 'save').length;
      const closed = calls.slice(0, i).filter((x) => x[0] === 'restore').length;
      return opened === closed;
    });
    expect(outside.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toEqual([]);
    // The canvas is filled with the sheet's colour, as the viewport shows model space on it.
    expect(scene.ctx.calls).toContainEqual(['fillStyle', '#ffffff']);
  });

  it('picks and windows take model space’s objects all over the canvas', () => {
    const { r, id } = setup();
    r.setActiveViewport(VP, MAXIMIZED);
    const model = modelViewOf(VIEW, MAXIMIZED);
    // Model (18, 18) is device (116, 34): outside the viewport's own frame on the sheet.
    expect(r.hitTest({ x: 116, y: 34 }, 3, model)).toEqual([id('20')]);
    const all = () => r.entitiesIn({ x: 0, y: 0, width: 200, height: 100 }).map((e) => e.handle);
    expect(all()).toEqual(['20']);
    r.setActiveViewport(VP);
    expect(all().sort()).toEqual(['20', '30', '31']);
  });

  it('draws a red border round the canvas in place of the bold frame', () => {
    const { r, transient } = setup();
    r.setActiveViewport(VP, MAXIMIZED);
    r.setTransient([{ kind: 'stroke', path: [0, 0, 0, 1, 20, 0], color: '#ff0000' }]);
    r.frame();
    const [inside] = clipped(transient.ctx.calls);
    expect(inside!.filter((c) => c[0] === 'rect')).toEqual([['rect', 0, 0, 200, 100]]);
    const after = transient.ctx.calls.slice(
      transient.ctx.calls.findLastIndex((c) => c[0] === 'restore'),
    );
    expect(after).toContainEqual(['strokeStyle', MAXIMIZED_VIEWPORT_COLOR]);
    expect(after).toContainEqual(['rect', 1, 1, 198, 98]);
    expect(after.filter((c) => c[0] === 'lineTo')).toHaveLength(0);
  });
});
