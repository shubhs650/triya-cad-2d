// M1-62: viewport layer overrides (VPLAYER colour, linetype, lineweight) and viewports clipped
// by an entity (DXF 340), checked on the calls the renderer makes to a recording context.
import type {
  EntityGeometry,
  EntityInit,
  LayerViewportOverride,
  LayoutPlot,
  ViewportGeometry,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import {
  change,
  DASHED,
  drawing,
  entity,
  LAYER_0,
  LAYER_RED,
  line,
  PAPER,
  surface,
  type Call,
  type DrawingExtra,
} from './fixtures';

const LIGHT: RenderStyle = {
  background: '#ffffff',
  foreground: '#000000',
  showLineweights: true,
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

function setup(entities: EntityInit[], extra: DrawingExtra = {}) {
  const d = drawing(entities, { layoutPlot: PLOT, ...extra });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
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

const strokes = (calls: Call[]) => calls.filter((c) => c[0] === 'stroke').map((c) => c[1]);
const widths = (calls: Call[]) => calls.filter((c) => c[0] === 'lineWidth').map((c) => c[1]);
const moves = (calls: Call[]) => calls.filter((c) => c[0] === 'moveTo').length;

const GREEN = '#00ff00';
const RED = '#ff0000';

describe('viewport layer overrides (M1-62)', () => {
  /** Two viewports side by side on the same view; overrides name the second, 31. */
  const twoViewports = [
    onPaper('30', viewport()),
    onPaper('31', viewport({ center: { x: 140, y: 40 } })),
  ];
  /**
   * 4 px per paper mm, over the inner edges of both frames: lineweights show wider than a pixel
   * and the dashes (0.75 at PSLTSCALE's 1 / 2) longer than one.
   */
  const zoomIn = (s: ReturnType<typeof setup>) =>
    s.r.setView({ center: { x: 100, y: 40 }, scale: 4 });

  function overrideRed(
    s: ReturnType<typeof setup>,
    o: readonly LayerViewportOverride[] | undefined,
  ): void {
    s.r.apply(
      change(s.d, (b) =>
        b.updateTableRecord('layers', LAYER_RED, o ? { viewportOverrides: o } : {}),
      ),
    );
  }

  it('draws a ByLayer entity in the overridden colour and lineweight in that viewport only', () => {
    const s = setup([...twoViewports, entity('21', line(0, 12, 20, 12), { layer: LAYER_RED })]);
    overrideRed(s, [{ viewport: '31', color: { kind: 'aci', index: 3 }, lineweight: 70 }]);
    zoomIn(s);
    s.r.frame();
    const [first, second] = clipped(s.scene.ctx.calls);
    expect(strokes(first!)).toEqual([RED]);
    expect(strokes(second!)).toEqual([GREEN]);
    // Paper lineweights follow the zoom: 0.70 mm is 2.8 px, the default 0.25 mm 1 px.
    expect(Math.max(...(widths(second!) as number[]))).toBeGreaterThan(
      Math.max(...(widths(first!) as number[])),
    );
  });

  it('keeps an entity with its own colour as it is', () => {
    const s = setup([
      ...twoViewports,
      entity('21', line(0, 12, 20, 12), { layer: LAYER_RED, color: { kind: 'aci', index: 5 } }),
    ]);
    overrideRed(s, [{ viewport: '31', color: { kind: 'aci', index: 3 } }]);
    s.r.frame();
    const [first, second] = clipped(s.scene.ctx.calls);
    expect(strokes(first!)).toEqual(strokes(second!));
  });

  it('dashes a line whose layer takes an overriding linetype', () => {
    const s = setup([...twoViewports, entity('21', line(0, 12, 20, 12), { layer: LAYER_RED })]);
    overrideRed(s, [{ viewport: '31', linetype: DASHED }]);
    zoomIn(s);
    s.r.frame();
    const [first, second] = clipped(s.scene.ctx.calls);
    expect(moves(first!)).toBe(1);
    expect(moves(second!)).toBeGreaterThan(10);
  });

  it('overrides block parts on the layer, and layer-0 parts of a reference on it', () => {
    const B = '40';
    const insert: EntityGeometry = {
      kind: 'INSERT',
      block: B,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    };
    const s = setup(
      [
        ...twoViewports,
        // A reference on 0 holding a RED line, and one on RED holding a line on 0.
        entity('20', insert),
        entity('22', line(0, 12, 20, 12), { owner: B, layer: LAYER_RED }),
        entity('23', insert, { layer: LAYER_RED }),
        entity('24', line(0, 14, 20, 14), { owner: B, layer: LAYER_0 }),
      ],
      { blocks: [{ handle: B, name: 'B' }] },
    );
    overrideRed(s, [{ viewport: '31', color: { kind: 'aci', index: 3 } }]);
    s.r.frame();
    const [first, second] = clipped(s.scene.ctx.calls);
    expect(strokes(first!).filter((c) => c === GREEN)).toEqual([]);
    expect(strokes(second!).filter((c) => c === RED)).toEqual([]);
    expect(strokes(second!)).toContain(GREEN);
  });

  it('draws the layer’s own values again once the override is removed', () => {
    const s = setup([...twoViewports, entity('21', line(0, 12, 20, 12), { layer: LAYER_RED })]);
    overrideRed(s, [{ viewport: '31', color: { kind: 'aci', index: 3 } }]);
    s.r.frame();
    s.r.apply(
      change(s.d, (b) => b.updateTableRecord('layers', LAYER_RED, { viewportOverrides: [] })),
    );
    s.scene.ctx.calls.length = 0;
    s.r.frame();
    const [, second] = clipped(s.scene.ctx.calls);
    expect(strokes(second!)).toEqual([RED]);
  });
});

describe('viewports clipped by an entity (M1-62)', () => {
  const NON_RECT = 0x10000;
  const circle: EntityGeometry = { kind: 'CIRCLE', center: { x: 60, y: 40 }, radius: 20 };
  const clippedBy = (clip: string) =>
    onPaper('30', viewport({ flags: NON_RECT, clipBoundary: clip }));

  it('clips the view to a circle, which draws as the frame', () => {
    const { r, scene } = setup([
      clippedBy('32'),
      onPaper('32', circle, { layer: LAYER_RED }),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.frame();
    const [inside] = clipped(scene.ctx.calls);
    const clip = inside!.findLastIndex((c) => c[0] === 'clip');
    const arc = inside!.findIndex((c) => c[0] === 'arc');
    expect(arc).toBeGreaterThanOrEqual(0);
    expect(arc).toBeLessThan(clip);
    expect(inside![clip]).toEqual(['clip', 'evenodd']);
    // The view is drawn (one line), the circle is stroked red on the sheet afterwards.
    expect(inside!.slice(clip).filter((c) => c[0] === 'moveTo')).toHaveLength(1);
    expect(strokes(scene.ctx.calls)).toContain(RED);
  });

  it('clips the view to a closed polyline', () => {
    const pline: EntityGeometry = {
      kind: 'LWPOLYLINE',
      vertices: [
        { x: 40, y: 20, bulge: 0 },
        { x: 80, y: 20, bulge: 0 },
        { x: 60, y: 60, bulge: 0 },
      ],
      closed: true,
    } as EntityGeometry;
    const { r, scene } = setup([
      clippedBy('32'),
      onPaper('32', pline),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.frame();
    const [inside] = clipped(scene.ctx.calls);
    const clip = inside!.findLastIndex((c) => c[0] === 'clip');
    expect(inside![clip]).toEqual(['clip', 'evenodd']);
    // The triangle's three corners are traced before the clip.
    const before = inside!.slice(0, clip).filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo');
    expect(before.length).toBeGreaterThanOrEqual(3);
  });

  it('still clips when the clip entity’s layer is off', () => {
    const { d, r, scene } = setup([
      clippedBy('32'),
      onPaper('32', circle, { layer: LAYER_RED }),
      entity('20', line(0, 10, 20, 10)),
    ]);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { on: false })));
    r.frame();
    const [inside] = clipped(scene.ctx.calls);
    expect(inside!.some((c) => c[0] === 'arc')).toBe(true);
    expect(strokes(scene.ctx.calls)).not.toContain(RED);
  });

  it('falls back to the frame rectangle when the clip entity is missing', () => {
    const { r, scene } = setup([clippedBy('99'), entity('20', line(0, 10, 20, 10))]);
    r.frame();
    const [inside] = clipped(scene.ctx.calls);
    expect(inside!.filter((c) => c[0] === 'rect')).toEqual([['rect', 50, 30, 40, 40]]);
    expect(inside!.some((c) => c[0] === 'arc')).toBe(false);
  });
});
