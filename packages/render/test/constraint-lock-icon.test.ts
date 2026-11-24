// M9-05 part 9: the lock icon beside a dimensional constraint's text. AutoCAD 2024 Help,
// "DIMCONSTRAINTICON (System Variable)": "Controls the display of the lock icon for
// dimensional constraints", a bitcode, initially 3: 1 the icon for dynamic constraints, 2 for
// annotational ones, 0 for neither. The Constraint Settings' Dimensional tab's "Show lock icon
// for annotational constraints" is its bit 2.
import {
  constraintDisplays,
  type DimensionalConstraintObject,
  type HeaderValue,
} from '@triya/engine';
import { FontBook, parseShx } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { buildShapes } from '../../text/test/shx/builder';
import {
  Canvas2DRenderer,
  DYNAMIC_CONSTRAINT_PX,
  PATH_Z,
  constraintPrimitives,
  sizesAt,
  type RenderPrimitive,
  type RenderStyle,
} from '../src/index';
import { labelWidth } from '../src/text';
import { drawing, entity, line, MODEL, surface, type FakeContext } from './fixtures';

const BLUE = '#3399ff';
const WHITE = '#ffffff';
const DARK: RenderStyle = {
  background: '#000000',
  foreground: WHITE,
  showLineweights: false,
  constraints: { color: BLUE },
};

/**
 * The labels' bundled stroke font, built in memory: every character a label can hold is the
 * same square (a pen-down 1×1 cell), advancing 2, so glyphs are strokes and only arrows and the
 * lock's body are fills.
 */
function labelFont(): FontBook {
  const cell = [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0];
  const codes = [...'0123456789.=-()dA'].map((c) => c.charCodeAt(0));
  const book = new FontBook();
  book.addShx(
    'oet-simplex.shx',
    parseShx(
      buildShapes(
        codes.map((code) => ({ code, name: `c${code}`, bytes: cell })),
        { name: 'Label', above: 1, below: 0 },
      ),
    ),
  );
  return book;
}

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

function setup(dims: readonly DimensionalConstraintObject[], style: RenderStyle = DARK) {
  // Annotational text 0.9 units tall (DIMTXT 0.18 × 5): 9 px at the view's scale, as the dynamic
  // one's, so neither is greeked to a filled box.
  const header: [string, HeaderValue][] = [['$DIMSCALE', 5]];
  const d = drawing([entity('20', line(0, 0, 10, 0))], { objects: dims, header });
  const fonts = labelFont();
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    now: () => 0,
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style,
    fonts,
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
  const text = { fonts, style: (h: string) => d.model.tables.textStyles.get(h) };
  return { d, r, redraw, text };
}

/** The fills drawn in `color`: one per arrow, and one for a lock's body. */
const fillsIn = (c: FakeContext, color: string) =>
  c.calls.filter((call) => call[0] === 'fill' && call[1] === color).length;

/** A primitive's x and y extents. */
function box(ps: readonly RenderPrimitive[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of ps) {
    if (p.kind !== 'fill' && p.kind !== 'stroke') continue;
    for (let i = 0; i < p.path.length;) {
      const op = p.path[i]!;
      // The lock draws moves, lines and a close only: a point each but the close.
      const n = op === PATH_Z ? 0 : 2;
      if (n === 2) {
        xs.push(p.path[i + 1]!);
        ys.push(p.path[i + 2]!);
      }
      i += 1 + n;
    }
  }
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

describe('constraintPrimitives draws a lock icon (M9-05 part 9)', () => {
  const { d, text } = setup([dim('D1')]);
  const [shown] = constraintDisplays(d.model, 2);
  const sizes = sizesAt(DYNAMIC_CONSTRAINT_PX, 10);

  it('adds a filled body and a shackle with `lock`, nothing without', () => {
    const plain = constraintPrimitives(shown!, sizes, BLUE, text);
    const locked = constraintPrimitives(shown!, sizes, BLUE, text, true, true);
    const added = locked.slice(plain.length);
    expect(added.map((p) => p.kind)).toEqual(['fill', 'stroke']);
    expect(added.every((p) => p.kind === 'fill' || p.kind === 'stroke')).toBe(true);
    expect(added.every((p) => (p.kind === 'fill' || p.kind === 'stroke') && p.color === BLUE)).toBe(
      true,
    );
  });

  it('puts it left of the text, no taller than the text, beside it', () => {
    const plain = constraintPrimitives(shown!, sizes, BLUE, text);
    const locked = constraintPrimitives(shown!, sizes, BLUE, text, true, true);
    const lock = box(locked.slice(plain.length));
    // The label "d1=10" is centred on its text point (x 5), so it starts half its width left.
    const half = (labelWidth(shown!.label, text)! * sizes.text) / 2;
    expect(lock.x1).toBeLessThan(shown!.textAt.x - half);
    expect(lock.x1).toBeGreaterThan(shown!.textAt.x - half - sizes.text);
    expect(lock.y1 - lock.y0).toBeLessThanOrEqual(sizes.text + 1e-9);
    // Above the dimension line (y -2), level with the text.
    expect(lock.y0).toBeGreaterThan(shown!.textAt.y);
  });

  it('draws no lock where the text cannot be drawn', () => {
    const plain = constraintPrimitives(shown!, sizes, BLUE, undefined);
    expect(constraintPrimitives(shown!, sizes, BLUE, undefined, true, true)).toEqual(plain);
  });
});

describe('Canvas2DRenderer and DIMCONSTRAINTICON (M9-05 part 9)', () => {
  const both = [dim('D1'), dim('D2', { parameter: 'd2', form: 'annotational' })];
  const style = (lockIcon?: number): RenderStyle => ({
    ...DARK,
    constraints: { color: BLUE, ...(lockIcon !== undefined && { lockIcon }) },
  });

  it('locks dynamic and annotational constraints initially (3)', () => {
    const c = setup(both).redraw();
    // Two arrows and a lock each.
    expect(fillsIn(c, BLUE)).toBe(3);
    expect(fillsIn(c, WHITE)).toBe(3);
  });

  it('follows each bit: 1 dynamic only, 2 annotational only, 0 neither', () => {
    const { r, redraw } = setup(both, style(1));
    let c = redraw();
    expect([fillsIn(c, BLUE), fillsIn(c, WHITE)]).toEqual([3, 2]);
    r.setStyle(style(2));
    c = redraw();
    expect([fillsIn(c, BLUE), fillsIn(c, WHITE)]).toEqual([2, 3]);
    r.setStyle(style(0));
    c = redraw();
    expect([fillsIn(c, BLUE), fillsIn(c, WHITE)]).toEqual([2, 2]);
  });

  it('picks a constraint by its lock too', () => {
    const { d, r, text } = setup([dim('D1')], style(1));
    const [shown] = constraintDisplays(d.model, 2);
    const sizes = sizesAt(DYNAMIC_CONSTRAINT_PX, 10);
    const plain = constraintPrimitives(shown!, sizes, BLUE, text);
    const lock = box(
      constraintPrimitives(shown!, sizes, BLUE, text, true, true).slice(plain.length),
    );
    // The middle of its body, on screen: the view centred on (5, 0) at 10 px a unit, 200 × 100.
    const mid = { x: (lock.x0 + lock.x1) / 2, y: lock.y0 + (lock.y1 - lock.y0) / 4 };
    const at = { x: 100 + (mid.x - 5) * 10, y: 50 - mid.y * 10 };
    expect(r.constraintAt(at, 1)).toBe('D1');
    r.setStyle(style(0));
    expect(r.constraintAt(at, 1)).toBeNull();
  });
});
