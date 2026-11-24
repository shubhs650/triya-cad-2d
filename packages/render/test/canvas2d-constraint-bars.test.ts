// M9-05 part 2: constraint bars drawn on the Model tab. Each constrained object's bar shows an
// icon per geometric constraint on it, the same size on screen at any zoom; CONSTRAINTBAR's Hide
// hides it (shown again while its object is selected, CONSTRAINTBARDISPLAY bit 2);
// CONSTRAINTBARMODE picks the kinds shown; Coincident constraints are small squares.
import { constraintBarKey, constraintBars, type GeometricConstraintObject } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_BAR_PX,
  Canvas2DRenderer,
  barBox,
  constraintBarAt,
  constraintBarHoverPrimitives,
  constraintBarPrimitives,
  type RenderStyle,
} from '../src/index';
import { drawing, entity, line, MODEL, PAPER, surface, type FakeContext } from './fixtures';

const BLUE = '#3399ff';
const PINK = '#ff00ff';
const STYLE: RenderStyle = {
  background: '#000000',
  foreground: '#ffffff',
  showLineweights: false,
  selection: PINK,
  constraintBars: { hidden: new Set(), color: BLUE },
};

const gc = (
  handle: string,
  kind: GeometricConstraintObject['kind'],
  refs: GeometricConstraintObject['refs'],
): GeometricConstraintObject => ({ handle, type: 'TRIYA_GEOMCONSTRAINT', owner: '0', kind, refs });

/** Line 20 (0,0)-(10,0) horizontal and parallel to line 21 (0,5)-(10,5), the two joined at 0,0. */
const CONSTRAINTS = [
  gc('E1', 'horizontal', [{ entity: '20' }]),
  gc('E2', 'parallel', [{ entity: '20' }, { entity: '21' }]),
  gc('E3', 'coincident', [
    { entity: '20', point: 'start' },
    { entity: '21', point: 'start' },
  ]),
];

function setup(o: { style?: RenderStyle; block?: string } = {}) {
  const d = drawing([entity('20', line(0, 0, 10, 0)), entity('21', line(0, 5, 10, 5))], {
    objects: CONSTRAINTS,
  });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    now: () => 0,
    model: d.model,
    index: d.index,
    block: o.block ?? MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: o.style ?? STYLE,
    requestIdle: () => {},
  });
  r.resize(200, 100, 1);
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  /** The transient layer's calls of the next frame. */
  const overlay = () => {
    const t = layers[1]!;
    t.ctx.clear();
    r.frame();
    return t.ctx;
  };
  return { d, r, redraw, overlay };
}

/** The strokes and fills drawn in `color`. */
function drawnIn(c: FakeContext, color: string): { strokes: number; fills: number } {
  let strokes = 0;
  let fills = 0;
  for (const call of c.calls) {
    if (call[0] === 'stroke' && call[1] === color) strokes++;
    if (call[0] === 'fill' && call[1] === color) fills++;
  }
  return { strokes, fills };
}

const look = { mode: 4095, color: BLUE, panel: 'background', opacity: 0.5 } as const;

describe('constraintBarPrimitives (M9-05 part 2)', () => {
  const bars = constraintBars(setup().d.model);

  it('draws each bar as a panel, framed, and its icons; Coincident as a square', () => {
    const prims = constraintBarPrimitives(bars, () => true, 10, look);
    const panels = prims.filter((p) => p.kind === 'fill' && p.color === 'background');
    // Line 20's bar (Horizontal, Parallel) and line 21's (Parallel).
    expect(panels).toHaveLength(2);
    expect(panels.every((p) => p.kind === 'fill' && p.opacity === 0.5)).toBe(true);
    const squares = prims.filter((p) => p.kind === 'fill' && p.color === BLUE);
    expect(squares).toHaveLength(1);
  });

  it('keeps a bar the same size on screen at any zoom, off its object on its side', () => {
    const bar = bars.bars[0]!;
    const near = barBox(bar, 2, 40);
    const far = barBox(bar, 2, 4);
    expect((near.max.x - near.min.x) * 40).toBeCloseTo((far.max.x - far.min.x) * 4, 9);
    const { icon, pad, offset } = CONSTRAINT_BAR_PX;
    expect((near.max.x - near.min.x) * 40).toBeCloseTo(2 * icon + 3 * pad, 9);
    // Below line 20's midpoint, its top edge `offset` pixels under the line.
    expect(near.max.y * 40).toBeCloseTo(-offset, 9);
    expect((near.min.x + near.max.x) / 2).toBeCloseTo(5, 9);
    expect(near.icons).toHaveLength(2);
  });

  it("shows only CONSTRAINTBARMODE's kinds, a bar with none left out", () => {
    // 8: Parallel alone; no Coincident square either.
    const prims = constraintBarPrimitives(bars, () => true, 10, { ...look, mode: 8 });
    expect(prims.filter((p) => p.kind === 'fill' && p.color === 'background')).toHaveLength(2);
    expect(prims.filter((p) => p.kind === 'fill' && p.color === BLUE)).toHaveLength(0);
    // 1: Horizontal alone, which only line 20 has.
    const h = constraintBarPrimitives(bars, () => true, 10, { ...look, mode: 1 });
    expect(h.filter((p) => p.kind === 'fill' && p.color === 'background')).toHaveLength(1);
  });

  it('leaves out the bars of objects not shown, and squares joining only those', () => {
    const prims = constraintBarPrimitives(bars, (h) => h === '21', 10, look);
    expect(prims.filter((p) => p.kind === 'fill' && p.color === 'background')).toHaveLength(1);
    // The square joins 20 and 21; 21's bar shows, so it does.
    expect(prims.filter((p) => p.kind === 'fill' && p.color === BLUE)).toHaveLength(1);
    const none = constraintBarPrimitives(bars, () => false, 10, look);
    expect(none).toEqual([]);
  });
});

describe('Canvas2DRenderer draws constraint bars', () => {
  it('draws them on the Model tab, none on a layout or without a bar style', () => {
    expect(drawnIn(setup().redraw(), BLUE).fills).toBe(1);
    expect(drawnIn(setup().redraw(), BLUE).strokes).toBeGreaterThan(0);
    expect(drawnIn(setup({ block: PAPER }).redraw(), BLUE)).toEqual({ strokes: 0, fills: 0 });
    const plain: RenderStyle = { ...STYLE };
    delete (plain as { constraintBars?: unknown }).constraintBars;
    expect(drawnIn(setup({ style: plain }).redraw(), BLUE)).toEqual({ strokes: 0, fills: 0 });
  });

  it('hides a hidden bar, showing it while its object is selected (CONSTRAINTBARDISPLAY 2)', () => {
    const hidden: RenderStyle = {
      ...STYLE,
      constraintBars: { hidden: new Set(['20', '21']), color: BLUE },
    };
    const { d, r, redraw } = setup({ style: hidden });
    expect(drawnIn(redraw(), BLUE)).toEqual({ strokes: 0, fills: 0 });
    r.setHighlight([d.model.entityByHandle('20')!.id]);
    expect(drawnIn(redraw(), BLUE).fills).toBe(1);
    r.setStyle({
      ...hidden,
      constraintBars: { hidden: new Set(['20', '21']), color: BLUE, showSelected: false },
    });
    expect(drawnIn(redraw(), BLUE)).toEqual({ strokes: 0, fills: 0 });
  });
});

/** A drawing point on the 200 x 100 canvas centred on 5,0 at 10 pixels a unit. */
const screenOf = (p: { x: number; y: number }) => ({ x: (p.x - 5) * 10 + 100, y: 50 - p.y * 10 });

describe('constraintBarAt (M9-05 part 4)', () => {
  const bars = constraintBars(setup().d.model);
  const bar20 = bars.bars.find((b) => b.entity === '20')!;
  const box = barBox(bar20, 2, 10);

  it("finds the icon under a point: its constraint, kind and objects, and the bar's object", () => {
    expect(constraintBarAt(bars, () => true, 10, 4095, box.icons[0]!)).toEqual({
      entity: '20',
      constraint: 'E1',
      kind: 'horizontal',
      entities: ['20'],
    });
    expect(constraintBarAt(bars, () => true, 10, 4095, box.icons[1]!)).toMatchObject({
      entity: '20',
      constraint: 'E2',
      kind: 'parallel',
      entities: ['20', '21'],
    });
  });

  it('finds the bar alone on its margin, and nothing off it', () => {
    // The panel's left margin, between its edge and the first icon.
    const edge = { x: box.min.x + 0.05, y: box.icons[0]!.y };
    expect(constraintBarAt(bars, () => true, 10, 4095, edge)).toEqual({
      entity: '20',
      entities: ['20'],
    });
    expect(constraintBarAt(bars, () => true, 10, 4095, { x: 5, y: 1.5 })).toBeUndefined();
  });

  it("finds a Coincident square's constraint", () => {
    expect(constraintBarAt(bars, () => true, 10, 4095, { x: 0.1, y: -0.1 })).toMatchObject({
      constraint: 'E3',
      kind: 'coincident',
      entities: ['20', '21'],
    });
    // CONSTRAINTBARMODE without Coincident shows no squares to find.
    expect(constraintBarAt(bars, () => true, 10, 4095 - 64, { x: 0.1, y: -0.1 })).toBeUndefined();
  });

  it("follows the icons shown: CONSTRAINTBARMODE's kinds, bars not shown left out", () => {
    // Parallel alone: line 20's bar holds one icon, where its first was laid out.
    const one = barBox(bar20, 1, 10);
    expect(constraintBarAt(bars, () => true, 10, 8, one.icons[0]!)?.constraint).toBe('E2');
    expect(constraintBarAt(bars, (h) => h !== '20', 10, 4095, box.icons[0]!)).toBeUndefined();
  });

  it("frames every icon of the constraint under the cursor, on each object's bar", () => {
    const hit = constraintBarAt(bars, () => true, 10, 4095, box.icons[1]!)!;
    const prims = constraintBarHoverPrimitives(bars, () => true, 10, 4095, hit, PINK);
    // Parallel's icons on line 20's bar and line 21's.
    expect(prims.filter((p) => p.kind === 'stroke' && p.color === PINK)).toHaveLength(2);
    const square = constraintBarAt(bars, () => true, 10, 4095, { x: 0, y: 0 })!;
    expect(constraintBarHoverPrimitives(bars, () => true, 10, 4095, square, PINK)).toHaveLength(1);
    // A bar's margin frames no icon.
    const edge = { x: box.min.x + 0.05, y: box.icons[0]!.y };
    const panel = constraintBarAt(bars, () => true, 10, 4095, edge)!;
    expect(constraintBarHoverPrimitives(bars, () => true, 10, 4095, panel, PINK)).toEqual([]);
  });
});

describe('Canvas2DRenderer: the cursor over a constraint bar (M9-05 part 4)', () => {
  it("answers what is under the cursor and highlights the constraint's icons and objects", () => {
    const { d, r, overlay } = setup();
    const bars = constraintBars(d.model);
    const icon = barBox(
      bars.bars.find((b) => b.entity === '20')!,
      2,
      10,
    ).icons[1]!;
    expect(drawnIn(overlay(), PINK).strokes).toBe(0);
    expect(r.hoverConstraintBar(screenOf(icon))).toMatchObject({ constraint: 'E2' });
    // Both lines' outlines (one path, its glow and its line) and the two Parallel icons'
    // frames (one path of the same colour).
    expect(drawnIn(overlay(), PINK).strokes).toBe(3);
    expect(r.hoverConstraintBar(screenOf({ x: 5, y: 1.5 }))).toBeNull();
    expect(drawnIn(overlay(), PINK).strokes).toBe(0);
  });

  it('answers nothing on a layout, without a bar style, or for a hidden bar', () => {
    const { d } = setup();
    const at = screenOf(barBox(constraintBars(d.model).bars[0]!, 2, 10).icons[0]!);
    expect(setup({ block: PAPER }).r.hoverConstraintBar(at)).toBeNull();
    const plain: RenderStyle = { ...STYLE };
    delete (plain as { constraintBars?: unknown }).constraintBars;
    expect(setup({ style: plain }).r.hoverConstraintBar(at)).toBeNull();
    const hidden: RenderStyle = {
      ...STYLE,
      constraintBars: { hidden: new Set(['20']), color: BLUE },
    };
    expect(setup({ style: hidden }).r.hoverConstraintBar(at)).toBeNull();
  });

  it('forgets the hover when asked with no cursor', () => {
    const { d, r, overlay } = setup();
    const at = screenOf(barBox(constraintBars(d.model).bars[0]!, 2, 10).icons[0]!);
    expect(r.hoverConstraintBar(at)).toMatchObject({ constraint: 'E1' });
    expect(drawnIn(overlay(), PINK).strokes).toBeGreaterThan(0);
    expect(r.hoverConstraintBar(undefined)).toBeNull();
    expect(drawnIn(overlay(), PINK).strokes).toBe(0);
  });
});

// M9-05 part 6: a bar dragged keeps its place beside its object, the drag's offset in screen
// pixels from where the bar is laid out (so the same at any zoom, and following its object);
// CONSTRAINTBAR Reset puts it back.
describe('a constraint bar dragged (M9-05 part 6)', () => {
  const bars = constraintBars(setup().d.model);
  const bar20 = bars.bars.find((b) => b.entity === '20')!;
  const key20 = constraintBarKey('20');
  const moved = new Map([[key20, { x: 30, y: -20 }]]);

  it('names each bar by its object and polyline segment', () => {
    expect(constraintBarKey('20')).toBe('20');
    expect(constraintBarKey('2A', 3)).toBe('2A:3');
  });

  it('lays a dragged bar out its offset in screen pixels, y down, from its own place', () => {
    const home = barBox(bar20, 2, 10);
    const there = barBox(bar20, 2, 10, { x: 30, y: -20 });
    // 30 px right and 20 px up at 10 px a unit.
    expect(there.min.x - home.min.x).toBeCloseTo(3);
    expect(there.min.y - home.min.y).toBeCloseTo(2);
    expect(there.icons[1]!.x - home.icons[1]!.x).toBeCloseTo(3);
    // The same pixels at any zoom.
    const far = barBox(bar20, 2, 2, { x: 30, y: -20 });
    expect(far.min.x - barBox(bar20, 2, 2).min.x).toBeCloseTo(15);
  });

  it('draws, finds and frames the bar where it was dragged', () => {
    const home = barBox(bar20, 2, 10);
    const there = barBox(bar20, 2, 10, { x: 30, y: -20 });
    const prims = constraintBarPrimitives(bars, () => true, 10, look, moved);
    const panel = prims.find((p) => p.kind === 'fill' && p.color === 'background')!;
    expect(panel.kind === 'fill' && panel.path[1]).toBeCloseTo(there.min.x);
    expect(constraintBarAt(bars, () => true, 10, 4095, there.icons[0]!, moved)).toMatchObject({
      entity: '20',
      constraint: 'E1',
    });
    // Nothing is left where it was.
    expect(constraintBarAt(bars, () => true, 10, 4095, home.icons[0]!, moved)).toBeUndefined();
    const hit = constraintBarAt(bars, () => true, 10, 4095, there.icons[1]!, moved)!;
    const frames = constraintBarHoverPrimitives(bars, () => true, 10, 4095, hit, PINK, moved);
    const first = frames[0]!;
    expect(first.kind === 'stroke' && first.path[1]).toBeCloseTo(there.icons[1]!.x - 0.8);
  });

  it("the renderer draws and answers the cursor by the style's offsets", () => {
    const style: RenderStyle = {
      ...STYLE,
      constraintBars: { hidden: new Set(), color: BLUE, moved },
    };
    const { r } = setup({ style });
    const there = barBox(bar20, 2, 10, { x: 30, y: -20 });
    expect(r.hoverConstraintBar(screenOf(there.icons[0]!))).toMatchObject({ constraint: 'E1' });
    const home = barBox(bar20, 2, 10);
    expect(r.hoverConstraintBar(screenOf(home.icons[0]!))).toBeNull();
  });
});
