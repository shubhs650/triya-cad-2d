// M2-06 part 2: the objects a command drags with the cursor, drawn on the transient layer over
// their originals: cached primitives through the drag's motion (a move, turn, scale or
// mirror), and stretched objects tessellated from their stretched geometry.
import { rotation, translation, type EntityId } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer } from '../src/index';
import { drawing, entity, LAYER_0, line, MODEL, surface, type Call } from './fixtures';

function setup() {
  const d = drawing([entity('20', line(0, 0, 10, 0)), entity('21', line(0, 20, 0, 30))]);
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
    style: { background: '#000000', foreground: '#ffffff', showLineweights: false },
    requestIdle: () => {},
  });
  // 10 px per unit, (10, 0) in the middle of 200 × 100: world (x, y) is device
  // (10x, 50 − 10y).
  r.resize(200, 100, 1);
  r.setView({ center: { x: 10, y: 0 }, scale: 10 });
  r.frame();
  const id = (h: string): EntityId => d.model.ids.idOf(h)!;
  return { r, id, transient: () => layers[1]!.ctx, scene: () => layers[0]!.ctx };
}

/** The device points the path calls reach, through the transform set before each. */
function devicePoints(calls: readonly Call[]): number[][] {
  let m = [1, 0, 0, 1, 0, 0];
  const out: number[][] = [];
  for (const c of calls) {
    if (c[0] === 'setTransform') m = c.slice(1) as number[];
    if (c[0] === 'moveTo' || c[0] === 'lineTo') {
      const [x, y] = c.slice(1) as [number, number];
      const r = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
      out.push([r(m[0]! * x + m[2]! * y + m[4]!), r(m[1]! * x + m[3]! * y + m[5]!)]);
    }
  }
  return out;
}

describe('Canvas2DRenderer.setDrag', () => {
  it('draws the dragged objects moved, on the transient layer only', () => {
    const { r, id, transient, scene } = setup();
    transient().clear();
    scene().clear();
    r.setDrag({ ids: [id('20')], m: translation(5, 5) });
    r.frame();
    expect(devicePoints(transient().calls)).toEqual([
      [50, 0],
      [150, 0],
    ]);
    expect(scene().calls).toEqual([]);
  });

  it('turns them about the base point', () => {
    const { r, id, transient } = setup();
    transient().clear();
    r.setDrag({ ids: [id('20')], m: rotation(Math.PI / 2, { x: 0, y: 0 }) });
    r.frame();
    // (0,0)–(10,0) turned a quarter: (0,0)–(0,10).
    expect(devicePoints(transient().calls)).toEqual([
      [0, 50],
      [0, -50],
    ]);
  });

  it('draws a stretched object from its stretched geometry', () => {
    const { r, id, transient } = setup();
    transient().clear();
    r.setDrag({
      ids: [id('21')],
      m: translation(0, 5),
      stretch: {
        ids: [id('20')],
        window: { minX: 9, minY: -1, maxX: 11, maxY: 1 },
        d: { x: 0, y: 5 },
      },
    });
    r.frame();
    expect(devicePoints(transient().calls)).toEqual([
      [0, -200],
      [0, -300],
      [0, 50],
      [100, 0],
    ]);
  });

  it('draws an object a command is placing, not yet in the drawing (M2-11)', () => {
    const { r, transient, scene } = setup();
    transient().clear();
    scene().clear();
    r.setDrag({
      ids: [],
      m: translation(0, 0),
      adding: { layer: LAYER_0, geom: line(0, 1, 5, 1) },
    });
    r.frame();
    expect(devicePoints(transient().calls)).toEqual([
      [0, 40],
      [50, 40],
    ]);
    expect(scene().calls).toEqual([]);
  });

  it('stops drawing them when the drag ends', () => {
    const { r, id, transient } = setup();
    r.setDrag({ ids: [id('20')], m: translation(5, 5) });
    r.frame();
    transient().clear();
    r.setDrag(undefined);
    r.frame();
    expect(devicePoints(transient().calls)).toEqual([]);
  });
});

describe('Canvas2DRenderer grips', () => {
  const squares = (calls: readonly Call[]) => {
    const out: [string, number, number, number][] = [];
    let fill = '';
    for (const c of calls) {
      if (c[0] === 'fillStyle') fill = String(c[1]);
      if (c[0] === 'fillRect' && fill !== '#1a1a1a') {
        const [x, y, w] = c.slice(1) as number[];
        out.push([fill, x! + w! / 2, y! + w! / 2, w!]);
      }
    }
    return out;
  };

  it('draws a line’s grips, the hot one in GRIPHOT', () => {
    const { r, id, transient } = setup();
    transient().clear();
    r.setGrips([id('20')], { x: 10, y: 0 });
    r.frame();
    expect(squares(transient().calls).map(([, x, y]) => [x, y])).toEqual([
      [0, 50],
      [50, 50],
      [100, 50],
    ]);
    const [a, b, c] = squares(transient().calls);
    expect(a![0]).toBe(b![0]);
    expect(c![0]).not.toBe(a![0]);
    expect(a![3]).toBe(8);
  });

  it('draws a grip dragged in the STRETCH grip mode from the stretched object', () => {
    const { r, id, transient } = setup();
    transient().clear();
    r.setDrag({
      ids: [],
      m: translation(0, 0),
      grip: { ids: [id('20'), id('21')], from: { x: 10, y: 0 }, to: { x: 10, y: 5 } },
    });
    r.frame();
    expect(devicePoints(transient().calls)).toEqual([
      [0, 50],
      [100, 0],
    ]);
  });

  it('hides them with none', () => {
    const { r, id, transient } = setup();
    r.setGrips([id('20')]);
    r.frame();
    transient().clear();
    r.setGrips([]);
    r.frame();
    expect(squares(transient().calls)).toEqual([]);
  });
});
