// Canvas2DRenderer with hatches (M1-16 part 2): gradient fills drawn with canvas gradients in
// the ramp's frame, and the LOD tint: a pattern family whose lines are under a pixel apart is
// drawn as its area filled at the family's average ink, as AutoCAD's dense hatches look.
import type { HatchGeometry, HatchPatternLine } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import { drawing, entity, MODEL, surface, type FakeGradient } from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
type Gradient = NonNullable<HatchGeometry['gradient']>;

const hatch = (extra: Partial<HatchGeometry> = {}): HatchGeometry => ({
  kind: 'HATCH',
  pattern: 'USER',
  solid: false,
  associative: false,
  style: 0,
  patternType: 0,
  patternAngle: 0,
  patternScale: 1,
  double: false,
  seedPoints: [],
  loops: [
    {
      flags: 2,
      polyline: {
        closed: true,
        vertices: [
          { x: 0, y: 0.5, bulge: 0 },
          { x: 4, y: 0.5, bulge: 0 },
          { x: 4, y: 3.5, bulge: 0 },
          { x: 0, y: 3.5, bulge: 0 },
        ],
      },
    },
  ],
  patternLines: [],
  ...extra,
});
const gradient = (extra: Partial<Gradient> = {}): HatchGeometry =>
  hatch({
    solid: true,
    pattern: 'SOLID',
    gradient: {
      name: 'LINEAR',
      angle: 0,
      shift: 0,
      singleColor: false,
      tint: 0,
      colors: [
        { value: 0, color: { kind: 'rgb', r: 0, g: 0, b: 255 } },
        { value: 1, color: { kind: 'aci', index: 2 } },
      ],
      ...extra,
    },
  });
const family = (spacing: number, dashes: number[]): HatchPatternLine => ({
  angle: 0,
  base: { x: 0, y: 0 },
  offset: { x: 0, y: spacing },
  dashes,
});

function setup(geom: HatchGeometry, scale = 10) {
  const d = drawing([entity('20', geom)]);
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
  });
  r.resize(200, 100, 1);
  r.setView({ center: { x: 2, y: 2 }, scale });
  const scene = layers[0]!;
  scene.ctx.clear();
  r.frame();
  return scene.ctx;
}
const stops = (geom: HatchGeometry) => (setup(geom).gradient as FakeGradient | undefined)?.stops;

describe('gradient hatches', () => {
  it('fills the boundary with a canvas gradient laid out in the ramp’s frame', () => {
    const c = setup(gradient());
    const fills = c.named('fill');
    expect(fills).toHaveLength(1);
    expect(fills[0]![1]).toBe('gradient(linear,0,0,1,0)');
    // The ramp runs over the box's extents, x 0 → 4: unit x is 40 px, from x = 0 (80 px).
    const i = c.calls.findIndex((k) => k[0] === 'fill');
    const transform = c.calls
      .slice(0, i)
      .filter((k) => k[0] === 'setTransform')
      .at(-1);
    expect(transform).toEqual(['setTransform', 40, 0, 0, -30, 80, 65]);
    expect((c.gradient as FakeGradient).stops).toEqual([
      [0, '#0000ff'],
      [1, '#ffff00'],
    ]);
  });

  it('draws radial ramps with a radial gradient', () => {
    const c = setup(gradient({ name: 'INVSPHERICAL' }));
    expect(c.named('fill')[0]![1]).toBe('gradient(radial,0,0,0,0,0,1)');
  });

  it('mixes the two colours at the stops between them', () => {
    // CURVED: three quarters of colour 2 halfway up.
    expect(stops(gradient({ name: 'CURVED' }))).toContainEqual([0.5, '#bfbf40']);
  });

  it('makes a one-colour gradient’s second colour by shade (below 0.5) or tint', () => {
    const one = (tint: number, index = 5) =>
      gradient({ singleColor: true, tint, colors: [{ value: 0, color: { kind: 'aci', index } }] });
    expect(stops(one(1))).toEqual([
      [0, '#0000ff'],
      [1, '#ffffff'],
    ]);
    expect(stops(one(0))?.[1]).toEqual([1, '#000000']);
    expect(stops(one(0.5))?.[1]).toEqual([1, '#0000ff']);
    expect(stops(one(0.75))?.[1]).toEqual([1, '#8080ff']);
    // ACI 7 follows the background first: white on this dark canvas, shaded to black.
    expect(stops(one(0, 7))).toEqual([
      [0, '#ffffff'],
      [1, '#000000'],
    ]);
  });
});

describe('pattern hatch LOD', () => {
  // Spacing 1 with a dash of 1 every 10; at 0.5 px per unit the lines are half a pixel apart.
  const sparse = hatch({ patternLines: [family(1, [1, -9])] });

  it('draws the pattern lines while they are a pixel or more apart', () => {
    const c = setup(sparse, 10);
    expect(c.named('stroke')).toHaveLength(1);
    expect(c.named('fill')).toHaveLength(0);
  });

  it('fills the area at the family’s ink once its lines are under a pixel apart', () => {
    const c = setup(sparse, 0.5);
    expect(c.named('stroke')).toHaveLength(0);
    // A 1 px line is 2 units wide here: each dash inks 1 + 2 (its round caps) of every 10, and
    // lines 1 unit apart cover the area across them.
    const [fill] = c.named('fill');
    expect(fill![1]).toBe('#ffffff');
    expect(fill![2]).toBe('evenodd');
    expect(fill![3]).toBeCloseTo(0.3, 12);
    expect(c.globalAlpha).toBe(1);
  });

  it('tints each family on its own, so wider families keep their lines', () => {
    // Spacing 3 at 0.5 px per unit is 1.5 px: still drawn as lines.
    const c = setup(hatch({ patternLines: [family(1, []), family(3, [])] }), 0.5);
    expect(c.named('fill').map((f) => f[3])).toEqual([1]);
    expect(c.named('stroke')).toHaveLength(1);
  });
});
