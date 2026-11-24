// M9-03 part 4: dimensional constraints drawn on the Model tab. A dynamic constraint keeps its
// size on screen as the view zooms and can be hidden (shown again while an object it constrains
// is selected, DYNCONSTRAINTMODE 1); an annotational one is sized by the drawing's DIMVARs.
import {
  constraintDisplays,
  type DimensionalConstraintObject,
  type HeaderValue,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  DYNAMIC_CONSTRAINT_PX,
  PATH_A,
  PATH_M,
  annotationalSizes,
  constraintPrimitives,
  sizesAt,
  type RenderPrimitive,
  type RenderStyle,
} from '../src/index';
import { change, drawing, entity, line, MODEL, PAPER, surface, type FakeContext } from './fixtures';

const BLUE = '#3399ff';
const DARK: RenderStyle = {
  background: '#000000',
  foreground: '#ffffff',
  showLineweights: false,
  constraints: { color: BLUE },
};

const dim = (
  handle: string,
  o: Partial<DimensionalConstraintObject> = {},
): DimensionalConstraintObject => ({
  handle,
  type: 'TRIYA_DIMCONSTRAINT',
  owner: '0',
  dimension: 'horizontal',
  refs: [{ entity: '20' }],
  parameter: 'd1',
  expression: '10',
  location: { x: 5, y: -2 },
  form: 'dynamic',
  ...o,
});

function setup(
  dims: readonly DimensionalConstraintObject[],
  o: { style?: RenderStyle; block?: string; header?: [string, HeaderValue][] } = {},
) {
  const d = drawing([entity('20', line(0, 0, 10, 0))], {
    objects: dims,
    ...(o.header ? { header: o.header } : {}),
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
    style: o.style ?? DARK,
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
  /** The transient layer's calls of a frame drawn afresh (grips, rubber bands). */
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

/** The extent of a fill's points along x, as drawn. */
const spanX = (p: RenderPrimitive) => {
  if (p.kind !== 'fill') return 0;
  const xs = [p.path[1]!, p.path[4]!, p.path[7]!];
  return Math.max(...xs) - Math.min(...xs);
};

describe('constraintPrimitives (M9-03 part 4)', () => {
  const d = setup([dim('D1')]).d;
  const [shown] = constraintDisplays(d.model, 2);

  it('draws a linear constraint as two extension lines, the dimension line and two arrows', () => {
    const prims = constraintPrimitives(shown!, sizesAt(DYNAMIC_CONSTRAINT_PX, 10), BLUE, undefined);
    expect(prims.filter((p) => p.kind === 'stroke')).toHaveLength(3);
    const arrows = prims.filter((p) => p.kind === 'fill');
    expect(arrows).toHaveLength(2);
    // The first arrow's tip at the dimension line's start, pointing out along it.
    const a = arrows[0]!;
    if (a.kind !== 'fill') throw new Error('fill');
    expect(a.path.slice(0, 3)).toEqual([PATH_M, 0, -2]);
    expect(spanX(a)).toBeCloseTo(DYNAMIC_CONSTRAINT_PX.arrow / 10, 9);
    // The extension line starts its offset away from the point and runs past the line.
    const ext = prims[0]!;
    if (ext.kind !== 'stroke') throw new Error('stroke');
    expect(ext.path[2]).toBeCloseTo(-DYNAMIC_CONSTRAINT_PX.offset / 10, 9);
    expect(ext.path[5]).toBeCloseTo(-2 - DYNAMIC_CONSTRAINT_PX.extend / 10, 9);
  });

  it('keeps a dynamic constraint the same size on screen at any zoom', () => {
    const near = constraintPrimitives(shown!, sizesAt(DYNAMIC_CONSTRAINT_PX, 40), BLUE, undefined);
    const far = constraintPrimitives(shown!, sizesAt(DYNAMIC_CONSTRAINT_PX, 4), BLUE, undefined);
    const arrow = (ps: RenderPrimitive[]) => spanX(ps.find((p) => p.kind === 'fill')!);
    expect(arrow(near) * 40).toBeCloseTo(arrow(far) * 4, 9);
  });

  it('sizes an annotational constraint by DIMASZ, DIMTXT and the rest times DIMSCALE', () => {
    const s = annotationalSizes(
      new Map<string, unknown>([
        ['$DIMASZ', 2.5],
        ['$DIMTXT', 3.5],
        ['$DIMSCALE', 2],
        ['$DIMGAP', -1],
      ]),
    );
    expect(s).toEqual({ text: 7, arrow: 5, offset: 0.125, extend: 0.36, gap: 2 });
    expect(annotationalSizes(new Map([['$DIMSCALE', 0]])).arrow).toBe(0.18);
  });

  it('draws angular constraints as arcs and radial ones as leaders', () => {
    const { model } = drawing([entity('20', line(0, 0, 10, 0)), entity('21', line(0, 0, 0, 10))], {
      objects: [
        dim('D1', {
          dimension: 'angular',
          refs: [{ entity: '20' }, { entity: '21' }],
          location: { x: 3, y: 3 },
        }),
      ],
    });
    const prims = constraintPrimitives(
      constraintDisplays(model, 2)[0]!,
      sizesAt(DYNAMIC_CONSTRAINT_PX, 10),
      BLUE,
      undefined,
    );
    const arc = prims.find((p) => p.kind === 'stroke' && p.path.includes(PATH_A));
    expect(arc).toBeDefined();
    expect(prims.filter((p) => p.kind === 'fill')).toHaveLength(2);
  });
});

describe('Canvas2DRenderer draws dimensional constraints', () => {
  it('draws a dynamic constraint in its colour on the Model tab', () => {
    const { redraw } = setup([dim('D1')]);
    // One path for the lines (strokes of a colour are batched), one fill per arrow.
    expect(drawnIn(redraw(), BLUE)).toEqual({ strokes: 1, fills: 2 });
  });

  it('draws nothing on a layout and nothing for a drawing without constraints', () => {
    expect(drawnIn(setup([dim('D1')], { block: PAPER }).redraw(), BLUE).strokes).toBe(0);
    expect(drawnIn(setup([]).redraw(), BLUE).strokes).toBe(0);
  });

  it('hides dynamic constraints, showing one while its object is selected', () => {
    const hidden: RenderStyle = { ...DARK, constraints: { color: BLUE, dynamic: false } };
    const { d, r, redraw } = setup([dim('D1')], { style: hidden });
    expect(drawnIn(redraw(), BLUE).strokes).toBe(0);
    r.setHighlight([d.model.entityByHandle('20')!.id]);
    expect(drawnIn(redraw(), BLUE).fills).toBe(2);
    // DYNCONSTRAINTMODE 0 keeps it hidden.
    r.setStyle({ ...hidden, constraints: { color: BLUE, dynamic: false, showSelected: false } });
    expect(drawnIn(redraw(), BLUE).strokes).toBe(0);
  });

  it('hides a constraint DCDISPLAY hid, showing it while its object is selected', () => {
    // M9-03 part 7: D1 hidden on its own, D2 shown, Show Dynamic Constraints on.
    const { d, r, redraw } = setup([dim('D1', { hidden: true }), dim('D2', { parameter: 'd2' })]);
    expect(drawnIn(redraw(), BLUE).fills).toBe(2);
    r.setHighlight([d.model.entityByHandle('20')!.id]);
    expect(drawnIn(redraw(), BLUE).fills).toBe(4);
    // DYNCONSTRAINTMODE 0 keeps it hidden while selected.
    r.setStyle({ ...DARK, constraints: { color: BLUE, showSelected: false } });
    expect(drawnIn(redraw(), BLUE).fills).toBe(2);
  });

  it('draws an annotational constraint in the foreground even with dynamic ones hidden', () => {
    const hidden: RenderStyle = { ...DARK, constraints: { color: BLUE, dynamic: false } };
    const { redraw } = setup([dim('D1', { form: 'annotational' })], { style: hidden });
    const c = redraw();
    expect(drawnIn(c, BLUE).strokes).toBe(0);
    expect(drawnIn(c, '#ffffff').fills).toBe(2);
  });

  it('follows its object when it moves and goes when the constraint is removed', () => {
    const { d, r, redraw } = setup([dim('D1')]);
    redraw();
    const moved = change(d, (b) =>
      b.updateEntity(d.model.entityByHandle('20')!.id, { geom: line(0, 0, 20, 0) }),
    );
    r.apply(moved);
    const c = redraw();
    // The second arrow's tip is now at x = 20, drawn relative to the view's centre (5).
    const tips = c.calls.filter((call) => call[0] === 'moveTo').map((call) => call[1]);
    expect(tips).toContain(15);
    const gone = change(d, (b) => b.removeObject('D1'));
    r.apply(gone);
    expect(drawnIn(redraw(), BLUE).strokes).toBe(0);
  });
});

// M9-03 part 10: a constraint is picked by what it draws (its text, dimension line or arc and
// arrows; not its extension lines, which start at the objects' points) and drawn selected.
describe('Canvas2DRenderer picks and highlights dimensional constraints', () => {
  /** Where world point (x, y) shows: the view's centre (5, 0) at the canvas's, 10 px a unit. */
  const screenOf = (x: number, y: number) => ({ x: (x - 5) * 10 + 100, y: 50 - y * 10 });

  it('finds the constraint drawn under the pickbox, nearest first', () => {
    const { r } = setup([dim('D1'), dim('D2', { parameter: 'd2', location: { x: 5, y: -5 } })]);
    expect(r.constraintAt(screenOf(5, -2), 3)).toBe('D1');
    expect(r.constraintAt(screenOf(3, -2.2), 3)).toBe('D1');
    expect(r.constraintAt(screenOf(5, -4.9), 3)).toBe('D2');
    // On the object and on an extension line, none.
    expect(r.constraintAt(screenOf(5, 0), 3)).toBeNull();
    expect(r.constraintAt(screenOf(0, -1), 3)).toBeNull();
  });

  it('finds none where none is drawn: hidden, or on a layout', () => {
    const hidden: RenderStyle = { ...DARK, constraints: { color: BLUE, dynamic: false } };
    expect(setup([dim('D1')], { style: hidden }).r.constraintAt(screenOf(5, -2), 3)).toBeNull();
    expect(setup([dim('D1', { hidden: true })]).r.constraintAt(screenOf(5, -2), 3)).toBeNull();
    expect(setup([dim('D1')], { block: PAPER }).r.constraintAt(screenOf(5, -2), 3)).toBeNull();
    // An annotational one shows, so it is found with dynamic ones hidden.
    const annotational = setup([dim('D1', { form: 'annotational' })], { style: hidden });
    expect(annotational.r.constraintAt(screenOf(5, -2), 3)).toBe('D1');
  });

  it('draws a selected constraint with the selection glow and dashes', () => {
    const { r, redraw } = setup([dim('D1'), dim('D2', { parameter: 'd2' })]);
    const SELECTION = '#4da3ff';
    expect(drawnIn(redraw(), SELECTION).strokes).toBe(0);
    r.setHighlight([], ['D1']);
    const c = redraw();
    // The glow and the dashed line over it, one path for the constraint's strokes and arrows.
    expect(drawnIn(c, SELECTION).strokes).toBe(2);
    expect(
      c.calls.some((call) => call[0] === 'setLineDash' && (call[1] as number[]).length > 0),
    ).toBe(true);
    r.setHighlight([]);
    expect(drawnIn(redraw(), SELECTION).strokes).toBe(0);
  });
});

// M9-03 part 11: a selected constraint's grips, triangles at its dimension line's ends that set
// its value and a square at its text that moves it, drawn as objects' grips are.
describe("Canvas2DRenderer draws a selected constraint's grips", () => {
  const moves = (c: FakeContext) =>
    c.calls.filter((call) => call[0] === 'moveTo').map((call) => [call[1], call[2]] as number[]);
  const rects = (c: FakeContext) =>
    c.calls.filter((call) => call[0] === 'fillRect').map((call) => call.slice(1) as number[]);

  it('a distance: triangles pointing out at the dimension line ends, a square at the text', () => {
    const { r, overlay } = setup([dim('D1')]);
    expect(rects(overlay())).toEqual([]);
    r.setGrips([], undefined, [], ['D1']);
    const c = overlay();
    // The square at the text, (5, -2): device (100, 70), its contour then its fill.
    expect(rects(c)).toEqual([
      [95, 65, 10, 10],
      [96, 66, 8, 8],
    ]);
    // The triangles' tips, 1.4 half sizes out from (0, -2) and (10, -2): (50, 70), (150, 70).
    const tips = moves(c).map(([x, y]) => [Math.round(x! * 10) / 10, y]);
    expect(tips).toEqual([
      [43, 70],
      [44.4, 70],
      [157, 70],
      [155.6, 70],
    ]);
    r.setGrips([]);
    expect(moves(overlay())).toEqual([]);
  });

  it('the hot grip and the one under the cursor take their colours', () => {
    const { r, overlay } = setup([dim('D1')]);
    r.setGrips([], { x: 10, y: -2 }, [], ['D1']);
    const fills = (c: FakeContext) =>
      c.calls.filter((call) => call[0] === 'fillStyle').map((call) => call[1]);
    const hot = fills(overlay());
    r.setGrips([], undefined, [], ['D1']);
    const cold = fills(overlay());
    expect(hot).not.toEqual(cold);
    r.setGripHover({ x: 5, y: -2 }, 0.5);
    expect(fills(overlay())).not.toEqual(cold);
  });

  it('none for a constraint gone or not shown on this tab', () => {
    const { r, overlay } = setup([dim('D1')], { block: PAPER });
    r.setGrips([], undefined, [], ['D1', 'GONE']);
    expect(rects(overlay())).toEqual([]);
  });
});
