// M9-05 part 2: constraint bars drawn on the Model tab. Each constrained object's bar shows an
// icon per geometric constraint on it, the same size on screen at any zoom; CONSTRAINTBAR's Hide
// hides it (shown again while its object is selected, CONSTRAINTBARDISPLAY bit 2);
// CONSTRAINTBARMODE picks the kinds shown; Coincident constraints are small squares.
import { constraintBars, type GeometricConstraintObject } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_BAR_PX,
  Canvas2DRenderer,
  barBox,
  constraintBarPrimitives,
  type RenderStyle,
} from '../src/index';
import { drawing, entity, line, MODEL, PAPER, surface, type FakeContext } from './fixtures';

const BLUE = '#3399ff';
const STYLE: RenderStyle = {
  background: '#000000',
  foreground: '#ffffff',
  showLineweights: false,
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
  return { d, r, redraw };
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
