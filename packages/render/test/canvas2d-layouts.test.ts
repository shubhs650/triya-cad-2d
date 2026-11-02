// M1-18: a layout drawn on its sheet, with each viewport's view of model space clipped to its
// frame, checked on the calls the renderer makes to a recording context.
import type { EntityGeometry, EntityInit, LayoutPlot, ViewportGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import {
  change,
  drawing,
  entity,
  LAYER_0,
  LAYER_DASHED,
  LAYER_RED,
  line,
  MODEL,
  PAPER,
  surface,
  type Call,
  type DrawingExtra,
} from './fixtures';

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

const viewport = (extra: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  // Frame 40…80 × 20…60 on the sheet, showing model 0…20 × 0…20 (scale 2).
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
  ...extra,
});

const onPaper = (handle: string, geom: EntityInit['geom'], extra: Partial<EntityInit> = {}) =>
  entity(handle, geom, { owner: PAPER, ...extra });

function setup(
  entities: EntityInit[],
  o: { block?: string; extra?: DrawingExtra; style?: RenderStyle } = {},
) {
  const d = drawing(entities, { layoutPlot: PLOT, ...o.extra });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: o.block ?? PAPER,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: o.style ?? LIGHT,
    requestIdle: () => undefined,
  });
  // 1 CSS px per millimetre, paper point (90, 40) at the canvas centre.
  r.resize(200, 100, 1);
  r.setView({ center: { x: 90, y: 40 }, scale: 1 });
  return { d, r, scene: layers[0]! };
}

/** The calls between a `save` and its `restore`: one viewport's drawing. */
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

describe('layout sheet', () => {
  it('fills around the sheet, then the paper in the background colour, then dashes the printable area', () => {
    const { r, scene } = setup([]);
    r.frame();
    const c = scene.ctx;
    // Paper −10…190 × −10…90 → device x 0…200, y 0…100 (y down).
    expect(c.named('fillRect')).toEqual([
      ['fillRect', 0, 0, 200, 100],
      ['fillRect', 0, 0, 200, 100],
    ]);
    expect(c.named('fillStyle').map((f) => f[1])).toEqual(['#c0c0c0', '#ffffff']);
    // Printable area 0…180 × 0…80 → device x 10…190, y 10…90.
    expect(c.named('rect')).toEqual([['rect', 10.5, 10.5, 179, 79]]);
    expect(c.named('setLineDash')).toEqual([
      ['setLineDash', [6, 4]],
      ['setLineDash', []],
    ]);
  });

  it('defaults the surround to the background moved toward grey', () => {
    const { r, scene } = setup([], {
      style: { background: '#000000', foreground: '#ffffff', showLineweights: false },
    });
    r.frame();
    expect(scene.ctx.named('fillStyle')[0]![1]).toBe('#2b2b2b');
  });

  it('draws a layout without a page setup on the plain background, as before', () => {
    const d = drawing([]);
    const layers: ReturnType<typeof surface>[] = [];
    const r = new Canvas2DRenderer({
      model: d.model,
      index: d.index,
      block: PAPER,
      surface: surface('visible'),
      createLayer: () => {
        const s = surface('layer');
        layers.push(s);
        return s;
      },
      style: LIGHT,
    });
    r.resize(200, 100, 1);
    r.frame();
    expect(layers[0]!.ctx.named('fillRect')).toEqual([['fillRect', 0, 0, 200, 100]]);
    expect(layers[0]!.ctx.named('fillStyle').map((f) => f[1])).toEqual(['#ffffff']);
  });

  it('draws no sheet for model space', () => {
    const { r, scene } = setup([], { block: MODEL });
    r.frame();
    expect(scene.ctx.named('rect')).toEqual([]);
    expect(scene.ctx.named('fillStyle').map((f) => f[1])).toEqual(['#ffffff']);
  });
});

describe('viewports', () => {
  it('draws model space through the viewport’s view, clipped to its frame', () => {
    const { r, scene } = setup([onPaper('30', viewport()), entity('20', line(0, 10, 20, 10))]);
    r.frame();
    const [inside] = clipped(scene.ctx.calls);
    // Frame 40…80 × 20…60 → device x 50…90, y 30…70.
    expect(inside!.filter((c) => c[0] === 'rect')).toEqual([['rect', 50, 30, 40, 40]]);
    expect(inside!.some((c) => c[0] === 'clip')).toBe(true);
    // Model (10, 10) is the frame centre, paper (60, 40), device (70, 50); 2 px per model unit.
    expect(inside).toContainEqual(['setTransform', 2, -0, 0, -2, 70, 50]);
    expect(inside!.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toEqual([
      ['moveTo', -10, 0],
      ['lineTo', 10, 0],
    ]);
  });

  it('strokes the viewport frame as a paper-space entity, after the views', () => {
    const { r, scene } = setup([
      onPaper('30', viewport(), { layer: LAYER_RED }),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.frame();
    const strokes = scene.ctx.named('stroke').map((s) => s[1]);
    // The printable area, the model line inside the viewport, then the red frame.
    expect(strokes.slice(1)).toEqual(['#000000', '#ff0000']);
    const c = scene.ctx.calls;
    const restore = c.findIndex((x) => x[0] === 'restore');
    const frame = c.findIndex((x, i) => i > restore && x[0] === 'moveTo' && x[1] === -50);
    expect(frame).toBeGreaterThan(restore);
  });

  it('culls model space to what the viewport shows', () => {
    const { r, scene } = setup([
      onPaper('30', viewport()),
      entity('20', line(0, 10, 20, 10)),
      // On the sheet's scale this is inside the visible paper, but far outside the view.
      entity('21', line(500, 500, 510, 500)),
    ]);
    r.frame();
    const [inside] = clipped(scene.ctx.calls);
    expect(inside!.filter((c) => c[0] === 'moveTo')).toHaveLength(1);
  });

  it('draws no view through the paper-space viewport or one turned off', () => {
    for (const vp of [viewport({ id: 1 }), viewport({ flags: 0x20000 })]) {
      const { r, scene } = setup([onPaper('30', vp), entity('20', line(0, 10, 20, 10))]);
      r.frame();
      expect(clipped(scene.ctx.calls)).toEqual([]);
    }
  });

  it('draws the view of a viewport whose status (68) is 0, as in a layout that is not current', () => {
    const { r, scene } = setup([
      onPaper('30', viewport({ status: 0 })),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.frame();
    expect(clipped(scene.ctx.calls)).toHaveLength(1);
  });

  it('still draws the frame of an off viewport, never the paper-space viewport’s', () => {
    const off = setup([onPaper('30', viewport({ flags: 0x20000 }))]);
    off.r.frame();
    expect(off.scene.ctx.named('moveTo')).toEqual([['moveTo', -50, -20]]);
    const own = setup([onPaper('30', viewport({ id: 1 }))]);
    own.r.frame();
    expect(own.scene.ctx.named('moveTo')).toEqual([]);
  });

  it('shows the view of a viewport whose layer is off, without its frame', () => {
    const { d, r, scene } = setup([
      onPaper('30', viewport(), { layer: LAYER_RED }),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { on: false })));
    r.frame();
    expect(clipped(scene.ctx.calls)).toHaveLength(1);
    expect(scene.ctx.named('stroke').map((s) => s[1])).toEqual(['#808080', '#000000']);
  });

  it('draws each viewport in stacking order through its own scale', () => {
    const { r, scene } = setup([
      onPaper('30', viewport()),
      onPaper(
        '31',
        viewport({ center: { x: 140, y: 40 }, viewHeight: 40, viewCenter: { x: 0, y: 0 } }),
      ),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.frame();
    const views = clipped(scene.ctx.calls);
    expect(views).toHaveLength(2);
    expect(views[1]).toContainEqual(['setTransform', 1, -0, 0, -1, 150, 50]);
  });

  it('turns a twisted view on the sheet', () => {
    const { r, scene } = setup([
      // Model (10, 10) is at DCS (−10, 10) once turned a quarter.
      onPaper('30', viewport({ twist: Math.PI / 2, viewCenter: { x: -10, y: 10 } })),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.frame();
    const t = clipped(scene.ctx.calls)[0]!.find((c) => c[0] === 'setTransform' && c[1] !== 1)!;
    expect(t.slice(1).map((v) => Math.round(Number(v) * 1e9) / 1e9 + 0)).toEqual([
      0, -2, -2, 0, 70, 50,
    ]);
  });

  it('shows a model-space edit in the layout and a moved viewport’s new view', () => {
    const { d, r, scene } = setup([onPaper('30', viewport())]);
    r.frame();
    expect(clipped(scene.ctx.calls)).toEqual([]);
    r.apply(change(d, (b) => b.addEntity(entity('20', line(0, 10, 20, 10)))));
    scene.ctx.clear();
    r.frame();
    expect(clipped(scene.ctx.calls)).toHaveLength(1);
    const vp = d.model.ids.idOf('30')!;
    r.apply(
      change(d, (b) => b.updateEntity(vp, { geom: viewport({ viewCenter: { x: 500, y: 500 } }) })),
    );
    scene.ctx.clear();
    r.frame();
    expect(clipped(scene.ctx.calls)).toEqual([]);
  });

  it('skips a viewport scrolled out of the canvas', () => {
    const { r, scene } = setup([onPaper('30', viewport()), entity('20', line(0, 10, 20, 10))]);
    r.setView({ center: { x: 1000, y: 1000 }, scale: 1 });
    r.frame();
    expect(clipped(scene.ctx.calls)).toEqual([]);
  });

  it('shows lineweights in viewports as paper millimetres at the layout zoom', () => {
    const { r, scene } = setup(
      [onPaper('30', viewport()), entity('20', line(0, 10, 20, 10), { lineweight: 100 })],
      { style: { ...LIGHT, showLineweights: true } },
    );
    r.setView({ center: { x: 90, y: 40 }, scale: 4 });
    r.frame();
    // 1 mm at 4 px per paper millimetre, whatever the viewport's own scale.
    const inside = clipped(scene.ctx.calls)[0]!;
    expect(inside.find((c) => c[0] === 'stroke')).toEqual(['stroke', '#000000', 4]);
  });

  it('measures an inch layout’s lineweights by its paper units', () => {
    const { r, scene } = setup(
      [onPaper('30', viewport()), onPaper('31', line(0, 0, 10, 0), { lineweight: 100 })],
      {
        extra: { layoutPlot: { ...PLOT, paperUnits: 'inches' } },
        style: { ...LIGHT, showLineweights: true },
      },
    );
    r.setView({ center: { x: 0, y: 0 }, scale: 254 });
    r.frame();
    // 254 px per inch is 10 px per millimetre.
    expect(scene.ctx.named('stroke').at(-1)).toEqual(['stroke', '#000000', 10]);
  });

  it('greeks and thins model content by its size on screen, not on the sheet', () => {
    // At 1/100 scale a 50-unit line is half a pixel: a dot.
    const { r, scene } = setup([
      onPaper('30', viewport({ viewHeight: 4000, viewCenter: { x: 0, y: 0 } })),
      entity('20', line(0, 0, 50, 0)),
    ]);
    r.frame();
    const inside = clipped(scene.ctx.calls)[0]!;
    expect(inside.filter((c) => c[0] === 'fillRect')).toHaveLength(1);
    expect(inside.filter((c) => c[0] === 'moveTo')).toEqual([]);
  });
});

describe('viewport layer freeze (M1-18 part 2)', () => {
  const B = '40';
  const INNER = '41';
  const insertOf = (block: string): EntityGeometry => ({
    kind: 'INSERT',
    block,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    attributes: [],
  });
  const blocks: DrawingExtra = {
    blocks: [
      { handle: B, name: 'B' },
      { handle: INNER, name: 'INNER' },
    ],
  };
  /** Two viewports side by side on the same view; the second freezes RED. */
  const twoViewports = [
    onPaper('30', viewport()),
    onPaper('31', viewport({ center: { x: 140, y: 40 }, frozenLayers: [LAYER_RED] })),
  ];
  const lines = (calls: Call[]) => calls.filter((c) => c[0] === 'moveTo').length;

  it('hides model-space entities on a layer frozen in that viewport only', () => {
    const { r, scene } = setup([
      ...twoViewports,
      entity('20', line(0, 10, 20, 10)),
      entity('21', line(0, 12, 20, 12), { layer: LAYER_RED }),
    ]);
    r.frame();
    const [first, second] = clipped(scene.ctx.calls);
    expect(lines(first!)).toBe(2);
    expect(lines(second!)).toBe(1);
  });

  it('hides a reference on a frozen layer, and the block parts and nested references on it', () => {
    const { r, scene } = setup(
      [
        ...twoViewports,
        // INSERT on 0 holding: a line on 0, a RED line, and a nested INSERT on RED of a line on 0.
        entity('20', insertOf(B)),
        entity('22', line(0, 10, 20, 10), { owner: B }),
        entity('23', line(0, 12, 20, 12), { owner: B, layer: LAYER_RED }),
        entity('24', insertOf(INNER), { owner: B, layer: LAYER_RED }),
        entity('25', line(0, 14, 20, 14), { owner: INNER, layer: LAYER_0 }),
        // An INSERT on RED disappears whole.
        entity('26', insertOf(INNER), { layer: LAYER_RED }),
      ],
      { extra: blocks },
    );
    r.frame();
    const [first, second] = clipped(scene.ctx.calls);
    expect(lines(first!)).toBe(4);
    expect(lines(second!)).toBe(1);
  });

  it('keeps the frozen layers on screen in model space and on the sheet', () => {
    const { r, scene } = setup([
      ...twoViewports,
      onPaper('27', line(0, 0, 10, 0), { layer: LAYER_RED }),
    ]);
    r.frame();
    expect(scene.ctx.named('stroke').map((s) => s[1])).toContain('#ff0000');
  });
});

describe('viewport linetype scale (PSLTSCALE, M1-18 part 2)', () => {
  /** The first dash's length in model units, from a viewport at scale 2. */
  function firstDash(flags: number | undefined): number {
    const { r, scene } = setup(
      [onPaper('30', viewport()), entity('20', line(0, 10, 20, 10), { layer: LAYER_DASHED })],
      { extra: flags === undefined ? {} : { layoutFlags: flags } },
    );
    r.setView({ center: { x: 90, y: 40 }, scale: 8 });
    r.frame();
    const inside = clipped(scene.ctx.calls)[0]!;
    const m = inside.findIndex((c) => c[0] === 'moveTo');
    return Number(inside[m + 1]![1]) - Number(inside[m]![1]);
  }

  it('draws dashes in paper units under PSLTSCALE 1 (the default)', () => {
    // DASHED: 0.5 dash, 0.25 gap. At 2 paper units per model unit a 0.5-unit paper dash is
    // 0.25 model units; the first dash of a fitted line is half a dash plus half the leftover.
    const ps = firstDash(1);
    expect(firstDash(undefined)).toBeCloseTo(ps, 12);
    const ms = firstDash(0);
    // 20 / 0.75 leaves 0.5 over (26 patterns + 0.5): first dash 0.25 + 0.25 = 0.5 at scale 1;
    // 20 / 0.375 leaves 0.125 over: first dash 0.125 + 0.0625 = 0.1875 at scale 1/2.
    expect(ms).toBeCloseTo(0.5, 9);
    expect(ps).toBeCloseTo(0.1875, 9);
  });

  it('draws model space through PSLTSCALE 0 viewports at the model linetype scale', () => {
    expect(firstDash(0)).toBeGreaterThan(firstDash(1));
  });
});
