// M9-03 part 13: dimensional constraints in a layout's viewports. Annotational ones show through
// every viewport that shows the objects they constrain, as dimensions in model space do; dynamic
// ones, which AutoCAD keeps for editing and never plots, only through the viewport made current
// (MSPACE), where model space is worked in. Picks and grips take them through that viewport.
import type {
  DimensionalConstraintObject,
  EntityInit,
  LayoutPlot,
  ViewportGeometry,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, modelViewOf, type RenderStyle } from '../src/index';
import { drawing, entity, LAYER_RED, line, PAPER, surface, type FakeContext } from './fixtures';

const BLUE = '#3399ff';
const LIGHT: RenderStyle = {
  background: '#ffffff',
  foreground: '#000000',
  showLineweights: false,
  layoutBackground: '#c0c0c0',
  constraints: { color: BLUE },
};

/** A 200 × 100 mm sheet with 10 mm margins all round. */
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
const viewport = (extra: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
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
  ...extra,
});

const VP = '30';
const VIEW = { center: { x: 90, y: 40 }, scale: 1 };
const MODEL_VIEW = modelViewOf(VIEW, viewport());

/** A distance along the line (2, 10)-(18, 10), its dimension line at y = 5. */
const dim = (o: Partial<DimensionalConstraintObject> = {}): DimensionalConstraintObject => ({
  handle: 'D1',
  type: 'TRIYA_DIMCONSTRAINT',
  owner: '0',
  dimension: 'horizontal',
  refs: [{ entity: '20' }],
  parameter: 'd1',
  expression: '16',
  location: { x: 10, y: 5 },
  form: 'annotational',
  ...o,
});

function setup(
  dims: readonly DimensionalConstraintObject[],
  o: { vp?: ViewportGeometry; line?: Partial<EntityInit> } = {},
) {
  const d = drawing(
    [entity(VP, o.vp ?? viewport(), { owner: PAPER }), entity('20', line(2, 10, 18, 10), o.line)],
    { objects: dims, layoutPlot: PLOT },
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
  const draw = (layer: 0 | 1) => {
    const s = layers[layer]!;
    s.ctx.clear();
    r.frame();
    return s.ctx;
  };
  return { d, r, scene: () => draw(0), overlay: () => draw(1) };
}

/** The fills drawn in `color` (a constraint's arrows) and strokes, inside a viewport's clip. */
function clippedIn(c: FakeContext, color: string): { strokes: number; fills: number } {
  let depth = 0;
  let strokes = 0;
  let fills = 0;
  for (const call of c.calls) {
    if (call[0] === 'save') depth++;
    else if (call[0] === 'restore') depth--;
    else if (depth > 0 && call[0] === 'stroke' && call[1] === color) strokes++;
    else if (depth > 0 && call[0] === 'fill' && call[1] === color) fills++;
  }
  return { strokes, fills };
}

/** Where model point (x, y) shows: paper (40 + 2x, 20 + 2y), paper (90, 40) at (100, 50). */
const screenOf = (x: number, y: number) => ({ x: 50 + 2 * x, y: 70 - 2 * y });

describe("dimensional constraints in a layout's viewports (M9-03 part 13)", () => {
  it('draws an annotational constraint through the viewport, clipped to it', () => {
    const { scene } = setup([dim()]);
    // Its two arrows, in the foreground; the line and the constraint's lines one batch.
    expect(clippedIn(scene(), '#000000').fills).toBe(2);
    expect(clippedIn(setup([]).scene(), '#000000').fills).toBe(0);
  });

  it('draws a dynamic constraint only through the viewport made current', () => {
    const { r, scene } = setup([dim({ form: 'dynamic' })]);
    expect(clippedIn(scene(), BLUE)).toEqual({ strokes: 0, fills: 0 });
    r.setActiveViewport(VP);
    expect(clippedIn(scene(), BLUE).fills).toBe(2);
    r.setActiveViewport(undefined);
    expect(clippedIn(scene(), BLUE).fills).toBe(0);
  });

  it('draws none whose objects are all on layers frozen in the viewport', () => {
    const frozen = viewport({ frozenLayers: [LAYER_RED] });
    const { scene } = setup([dim()], { vp: frozen, line: { layer: LAYER_RED } });
    expect(clippedIn(scene(), '#000000').fills).toBe(0);
  });

  it('picks one through the viewport made current only', () => {
    const { r } = setup([dim()]);
    const at = screenOf(10, 5);
    expect(r.constraintAt(at, 3, VIEW)).toBeNull();
    r.setActiveViewport(VP);
    expect(r.constraintAt(at, 3, MODEL_VIEW)).toBe('D1');
    expect(r.constraintAt(screenOf(10, 8), 3, MODEL_VIEW)).toBeNull();
    // A dynamic one too, as it shows there.
    const dynamic = setup([dim({ form: 'dynamic' })]);
    dynamic.r.setActiveViewport(VP);
    expect(dynamic.r.constraintAt(at, 3, MODEL_VIEW)).toBe('D1');
  });

  // M9-03 part 14: a window at `Command:` takes them there too, in model space's units.
  it('a window takes a constraint only through the viewport made current', () => {
    const { r } = setup([dim()]);
    const crossing = { kind: 'crossing' as const, box: { minX: 9, minY: 4, maxX: 11, maxY: 6 } };
    expect(r.constraintsIn(crossing, MODEL_VIEW)).toEqual([]);
    r.setActiveViewport(VP);
    expect(r.constraintsIn(crossing, MODEL_VIEW)).toEqual(['D1']);
  });

  it("draws a selected constraint's glow and grips through the viewport made current", () => {
    const SELECTION = '#4da3ff';
    const { r, scene, overlay } = setup([dim()]);
    r.setActiveViewport(VP);
    r.setHighlight([], ['D1']);
    expect(clippedIn(scene(), SELECTION).strokes).toBe(2);
    r.setGrips([], undefined, [], ['D1']);
    // The square at its text, model (10, 5): device (70, 60).
    const rects = overlay()
      .calls.filter((call) => call[0] === 'fillRect')
      .map((call) => call.slice(1, 3));
    expect(rects).toContainEqual([65, 55]);
    r.setActiveViewport(undefined);
    expect(overlay().calls.filter((call) => call[0] === 'fillRect')).toEqual([]);
  });
});
