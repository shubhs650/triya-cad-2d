// M9-14: a block's constraints shown in the Block Editor. M9-13 keeps the constraints among a
// block definition's objects in the drawing, acting only where the objects are edited; AutoCAD
// shows them in the Block Editor alone (AutoCAD 2024 Help, "About Constraints in Blocks"). The
// render worker's drawing is its own copy, which the engine's Block Editor state never reaches,
// so a canvas draws the constraints among the objects of the space it shows: the Block Editor's
// canvas (a block that is neither model space nor a layout) its block's, the Model tab model
// space's, and a layout's viewports model space's.
import {
  constraintBars,
  constraintDisplays,
  constraintsIn,
  type DimensionalConstraintObject,
  type GeometricConstraintObject,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, barBox, type RenderStyle } from '../src/index';
import { drawing, entity, line, MODEL, PAPER, surface, type FakeContext } from './fixtures';

const BLUE = '#3399ff';
const GREEN = '#00ff00';
const STYLE: RenderStyle = {
  background: '#000000',
  foreground: '#ffffff',
  showLineweights: false,
  constraints: { color: GREEN },
  constraintBars: { hidden: new Set(), color: BLUE },
};

/** The block definition "L", whose objects 20 and 21 hold constraints. */
const BLOCK = '80';

const gc = (
  handle: string,
  kind: GeometricConstraintObject['kind'],
  refs: GeometricConstraintObject['refs'],
): GeometricConstraintObject => ({ handle, type: 'TRIYA_GEOMCONSTRAINT', owner: '0', kind, refs });

const dim = (handle: string, entity: string, parameter: string): DimensionalConstraintObject => ({
  handle,
  type: 'TRIYA_DIMCONSTRAINT',
  owner: '0',
  dimension: 'horizontal',
  refs: [{ entity }],
  parameter,
  expression: '10',
  location: { x: 5, y: -2 },
  form: 'dynamic',
});

/**
 * Lines 20 (0,0)-(10,0) and 21 (0,0)-(0,5) in block L, 20 horizontal, the two perpendicular and
 * 20 dimensioned d1; line 30 (0,20)-(10,20) in model space, vertical-free, horizontal and d2.
 */
const OBJECTS = [
  gc('E1', 'horizontal', [{ entity: '20' }]),
  gc('E2', 'perpendicular', [{ entity: '20' }, { entity: '21' }]),
  dim('D1', '20', 'd1'),
  gc('E3', 'horizontal', [{ entity: '30' }]),
  dim('D2', '30', 'd2'),
];

function setup(block: string) {
  const d = drawing(
    [
      entity('20', line(0, 0, 10, 0), { owner: BLOCK }),
      entity('21', line(0, 0, 0, 5), { owner: BLOCK }),
      entity('30', line(0, 20, 10, 20)),
    ],
    { blocks: [{ handle: BLOCK, name: 'L', basePoint: { x: 0, y: 0 } }], objects: OBJECTS },
  );
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    now: () => 0,
    model: d.model,
    index: d.index,
    block,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: STYLE,
    requestIdle: () => {},
  });
  r.resize(200, 100, 1);
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const redraw = (): FakeContext => {
    const scene = layers[0]!;
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, redraw };
}

/** The fills drawn in `color`: arrows of a dimensional constraint, a bar's icons and squares. */
const fills = (c: FakeContext, color: string) =>
  c.calls.filter((call) => call[0] === 'fill' && call[1] === color).length;
const strokes = (c: FakeContext, color: string) =>
  c.calls.filter((call) => call[0] === 'stroke' && call[1] === color).length;

/** Where world point (x, y) shows: the view's centre (5, 0) at the canvas's, 10 px a unit. */
const screenOf = (x: number, y: number) => ({ x: (x - 5) * 10 + 100, y: 50 - y * 10 });

describe('constraintsIn (M9-14)', () => {
  const { d } = setup(MODEL);

  it("takes the constraints among a space's objects, wherever the drawing holds them", () => {
    expect(constraintsIn(d.model, BLOCK).map((c) => c.handle)).toEqual(['E1', 'E2', 'D1']);
    expect(constraintsIn(d.model, MODEL).map((c) => c.handle)).toEqual(['E3', 'D2']);
    expect(constraintsIn(d.model, PAPER)).toEqual([]);
  });

  it("gives the block's bars and dimensional constraints to draw", () => {
    const held = constraintsIn(d.model, BLOCK);
    const bars = constraintBars(
      d.model,
      held.filter((c) => c.type === 'TRIYA_GEOMCONSTRAINT'),
    );
    expect(bars.bars.map((b) => b.entity).sort()).toEqual(['20', '21']);
    const dims = held.filter((c) => c.type === 'TRIYA_DIMCONSTRAINT');
    expect(constraintDisplays(d.model, 2, dims).map((s) => s.handle)).toEqual(['D1']);
    // Out of the editor the drawing's own (acting) constraints leave the block's out.
    expect(constraintDisplays(d.model, 2).map((s) => s.handle)).toEqual(['D2']);
  });
});

describe('Canvas2DRenderer draws a block’s constraints in the Block Editor (M9-14)', () => {
  it("draws the block's bars and dimensional constraint on the Block Editor's canvas", () => {
    const c = setup(BLOCK).redraw();
    // Two bars (20: Horizontal and Perpendicular; 21: Perpendicular) framed in the bar colour.
    expect(strokes(c, BLUE)).toBeGreaterThan(0);
    // d1's two arrows, and its lines.
    expect(fills(c, GREEN)).toBe(2);
    expect(strokes(c, GREEN)).toBe(1);
  });

  it("draws only model space's on the Model tab, and none of the block's on a layout", () => {
    const model = setup(MODEL).redraw();
    // d2 alone: two arrows.
    expect(fills(model, GREEN)).toBe(2);
    const layout = setup(PAPER).redraw();
    expect(fills(layout, GREEN)).toBe(0);
    expect(strokes(layout, BLUE)).toBe(0);
  });

  it("picks the block's dimensional constraint and hovers its bars in the Block Editor", () => {
    const { d, r } = setup(BLOCK);
    expect(r.constraintAt(screenOf(5, -2), 3)).toBe('D1');
    // Model space's d2, at 5,-2 too, is not the Block Editor's.
    expect(setup(MODEL).r.constraintAt(screenOf(5, -2), 3)).toBe('D2');
    // Line 20's bar, under its midpoint: its first icon is Horizontal.
    const bars = constraintBars(d.model, [gc('E1', 'horizontal', [{ entity: '20' }])]);
    const icon = barBox(bars.bars[0]!, 2, 10).icons[0]!;
    expect(r.hoverConstraintBar(screenOf(icon.x, icon.y))).toMatchObject({ constraint: 'E1' });
  });
});
