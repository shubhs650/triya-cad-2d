// M1-69: objects on locked layers draw faded by LAYLOCKFADECTL, as AutoCAD does: at 50 (its
// initial value) they show at half strength, at 0 or below they draw normally, and the fade
// stops at 90. The fade follows a Lock toggle without re-tessellating, reaches block contents
// (the reference's layer or a nested object's own) and model space seen through a viewport.
import type { EntityGeometry, EntityInit, ViewportGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import {
  change,
  drawing,
  entity,
  LAYER_0,
  LAYER_RED,
  line,
  MODEL,
  PAPER,
  surface,
  type Call,
  type FakeContext,
} from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const B = '40';

const insertOf = (block: string): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

const solid = (x: number): EntityGeometry => ({
  kind: 'SOLID',
  corners: [
    { x, y: 0 },
    { x: x + 1, y: 0 },
    { x, y: 1 },
    { x: x + 1, y: 1 },
  ],
});

function setup(
  entities: EntityInit[],
  o: { style?: RenderStyle; block?: string; lockRed?: boolean } = {},
) {
  const d = drawing(entities, { blocks: [{ handle: B, name: 'B' }] });
  if (o.lockRed !== false)
    change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { locked: true }));
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
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
  r.resize(100, 50, 1);
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, redraw };
}

/** Each stroke and fill with the colour it drew in and the alpha in force at the time. */
function marks(c: FakeContext): [string, string, number][] {
  const out: [string, string, number][] = [];
  let alpha = 1;
  let stroke = '';
  let fill = '';
  for (const call of c.calls as Call[]) {
    const [name, v] = call;
    if (name === 'globalAlpha') alpha = v as number;
    else if (name === 'strokeStyle') stroke = String(v);
    else if (name === 'fillStyle') fill = String(v);
    else if (name === 'stroke') out.push(['stroke', stroke, alpha]);
    else if (name === 'fill' || name === 'fillRect') out.push([name, fill, alpha]);
  }
  return out;
}
const strokes = (c: FakeContext) => marks(c).filter((m) => m[0] === 'stroke');
/** The canvas is left at full strength after every frame. */
const ends = (c: FakeContext) => (c.calls as Call[]).filter((x) => x[0] === 'globalAlpha').at(-1);

describe('locked-layer fading (M1-69)', () => {
  it('draws objects on a locked layer at LAYLOCKFADECTL 50 by default, others in full', () => {
    const { redraw } = setup([
      entity('20', line(0, 0, 10, 0)),
      entity('21', line(0, 1, 10, 1), { layer: LAYER_RED }),
    ]);
    const c = redraw();
    expect(strokes(c)).toEqual([
      ['stroke', '#ffffff', 1],
      ['stroke', '#ff0000', 0.5],
    ]);
    expect(ends(c)?.[1]).toBe(1);
  });

  it('fades fills too', () => {
    const { redraw } = setup([
      entity('20', solid(0), { layer: LAYER_RED }),
      entity('21', solid(3)),
    ]);
    expect(marks(redraw()).filter((m) => m[0] === 'fill')).toEqual([
      ['fill', '#ff0000', 0.5],
      ['fill', '#ffffff', 1],
    ]);
  });

  it('follows the style: other amounts, 0 or negative for none, at most 90', () => {
    const { r, redraw } = setup([entity('21', line(0, 1, 10, 1), { layer: LAYER_RED })]);
    const alphaAt = (layLockFade: number) => {
      r.setStyle({ ...DARK, layLockFade });
      return strokes(redraw()).map((s) => s[2]);
    };
    expect(alphaAt(20)).toEqual([0.8]);
    expect(alphaAt(0)).toEqual([1]);
    // AutoCAD keeps a negative value to turn fading off without losing the amount.
    expect(alphaAt(-50)).toEqual([1]);
    expect(alphaAt(95)[0]).toBeCloseTo(0.1);
  });

  it('fades and unfades when Lock toggles', () => {
    const { d, r, redraw } = setup([entity('21', line(0, 1, 10, 1), { layer: LAYER_RED })], {
      lockRed: false,
    });
    expect(strokes(redraw()).map((s) => s[2])).toEqual([1]);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { locked: true })));
    expect(strokes(redraw()).map((s) => s[2])).toEqual([0.5]);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { locked: false })));
    expect(strokes(redraw()).map((s) => s[2])).toEqual([1]);
  });

  it('fades all of a block reference on a locked layer, and a nested object on its own', () => {
    // AutoCAD treats a reference on a locked layer as locked as a whole. For a nested object on
    // a locked layer inside a reference that is not, its help does not say; it fades here, as
    // the object's own layer is locked (the common drafter expectation).
    const inB = (h: string, geom: EntityGeometry, extra: Partial<EntityInit> = {}) =>
      entity(h, geom, { owner: B, ...extra });
    const whole = setup([
      inB('50', line(0, 0, 1, 0)),
      entity('20', insertOf(B), { layer: LAYER_RED }),
    ]);
    expect(strokes(whole.redraw()).map((s) => s[2])).toEqual([0.5]);

    const nested = setup([
      inB('50', line(0, 0, 1, 0), { layer: LAYER_0 }),
      inB('51', line(0, 1, 1, 1), { layer: LAYER_RED }),
      entity('20', insertOf(B)),
    ]);
    expect(strokes(nested.redraw())).toEqual([
      ['stroke', '#ffffff', 1],
      ['stroke', '#ff0000', 0.5],
    ]);
  });

  it('fades model space seen through a layout viewport', () => {
    const vp: ViewportGeometry = {
      kind: 'VIEWPORT',
      center: { x: 5, y: 0 },
      width: 10,
      height: 5,
      id: 2,
      status: 1,
      flags: 0,
      viewCenter: { x: 5, y: 0 },
      viewHeight: 5,
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
    const { redraw } = setup(
      [entity('21', line(0, 1, 10, 1), { layer: LAYER_RED }), entity('30', vp, { owner: PAPER })],
      { block: PAPER },
    );
    expect(strokes(redraw()).filter((s) => s[1] === '#ff0000')).toEqual([
      ['stroke', '#ff0000', 0.5],
    ]);
  });
});
