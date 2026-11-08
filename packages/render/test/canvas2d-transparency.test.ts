// M1-108: object transparency (DXF 440) as AutoCAD draws it: an object's own value, ByLayer from
// its layer (in a layout viewport, the layer's VP override), ByBlock from the INSERT that holds
// it, and TRANSPARENCYDISPLAY 0 drawing everything opaque. Checked on the alpha in force for each
// stroke and fill the renderer makes on a recording context.
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

const viewport: ViewportGeometry = {
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

function setup(entities: EntityInit[], o: { style?: RenderStyle; block?: string } = {}) {
  const d = drawing(entities, { blocks: [{ handle: B, name: 'B' }] });
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
const alphas = (c: FakeContext) => strokes(c).map((s) => s[2]);
/** The canvas is left at full strength after every frame. */
const ends = (c: FakeContext) => (c.calls as Call[]).filter((x) => x[0] === 'globalAlpha').at(-1);

describe('object transparency (M1-108)', () => {
  it('draws an object at its own transparency, opaque ones in full', () => {
    const { redraw } = setup([
      entity('20', line(0, 0, 10, 0)),
      // 50 % transparent, as AutoCAD files it: alpha 127 (0x0200007F).
      entity('21', line(0, 1, 10, 1), { transparency: { alpha: 127 } }),
    ]);
    const c = redraw();
    expect(strokes(c)).toEqual([
      ['stroke', '#ffffff', 1],
      ['stroke', '#ffffff', 127 / 255],
    ]);
    expect(ends(c)?.[1]).toBe(1);
  });

  it('draws fills transparent too', () => {
    const { redraw } = setup([entity('20', solid(0), { transparency: { alpha: 51 } })]);
    expect(marks(redraw()).filter((m) => m[0] === 'fill')).toEqual([['fill', '#ffffff', 0.2]]);
  });

  it('takes ByLayer from the layer, and follows a change to the layer', () => {
    const { d, r, redraw } = setup([entity('21', line(0, 1, 10, 1), { layer: LAYER_RED })]);
    expect(alphas(redraw())).toEqual([1]);
    r.apply(
      change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { transparency: { alpha: 102 } })),
    );
    expect(alphas(redraw())).toEqual([0.4]);
  });

  it('takes ByBlock from the INSERT; objects with values of their own keep them', () => {
    const inB = (h: string, geom: EntityGeometry, extra: Partial<EntityInit> = {}) =>
      entity(h, geom, { owner: B, ...extra });
    const { redraw } = setup([
      inB('50', line(0, 0, 1, 0), { transparency: 'ByBlock', color: { kind: 'aci', index: 1 } }),
      inB('51', line(0, 1, 1, 1), { transparency: 'ByLayer', color: { kind: 'aci', index: 3 } }),
      inB('52', line(0, 2, 1, 2), {
        transparency: { alpha: 204 },
        color: { kind: 'aci', index: 5 },
      }),
      entity('20', insertOf(B), { transparency: { alpha: 51 } }),
    ]);
    expect(strokes(redraw())).toEqual([
      ['stroke', '#ff0000', 0.2],
      ['stroke', '#00ff00', 1],
      ['stroke', '#0000ff', 0.8],
    ]);
  });

  it('gives objects on layer 0 in a block the INSERT layer’s transparency', () => {
    const { d, r, redraw } = setup([
      entity('50', line(0, 0, 1, 0), { owner: B, layer: LAYER_0 }),
      entity('20', insertOf(B), { layer: LAYER_RED }),
    ]);
    r.apply(
      change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { transparency: { alpha: 153 } })),
    );
    expect(alphas(redraw())).toEqual([0.6]);
  });

  it('draws everything opaque with TRANSPARENCYDISPLAY 0, and transparent again with 1', () => {
    const { r, redraw } = setup([
      entity('21', line(0, 1, 10, 1), { transparency: { alpha: 127 } }),
    ]);
    r.setStyle({ ...DARK, showTransparency: false });
    expect(alphas(redraw())).toEqual([1]);
    r.setStyle({ ...DARK, showTransparency: true });
    expect(alphas(redraw())).toEqual([127 / 255]);
  });

  it('compounds with locked-layer fading', () => {
    const { d, r, redraw } = setup([
      entity('21', line(0, 1, 10, 1), { layer: LAYER_RED, transparency: { alpha: 102 } }),
    ]);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { locked: true })));
    expect(alphas(redraw())[0]).toBeCloseTo(0.2);
  });

  it('takes a layer’s VP transparency override in that layout viewport only', () => {
    const { d, r, redraw } = setup(
      [
        entity('21', line(0, 1, 10, 1), { layer: LAYER_RED }),
        entity('30', viewport, { owner: PAPER }),
      ],
      { block: PAPER },
    );
    const red = () => strokes(redraw()).filter((s) => s[1] === '#ff0000');
    expect(red()).toEqual([['stroke', '#ff0000', 1]]);
    r.apply(
      change(d, (b) =>
        b.updateTableRecord('layers', LAYER_RED, {
          viewportOverrides: [{ viewport: '30', transparency: { alpha: 51 } }],
        }),
      ),
    );
    expect(red()).toEqual([['stroke', '#ff0000', 0.2]]);
  });
});
