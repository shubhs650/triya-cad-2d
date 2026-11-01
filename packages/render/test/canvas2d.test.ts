// Canvas2DRenderer (M1-12): scene cache, culling, LOD, transient layer, DPR, colours and hit
// testing, checked on the calls it makes to a recording context.
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import { change, drawing, entity, LAYER_0, LAYER_RED, line, MODEL, surface } from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const LIGHT: RenderStyle = { background: '#ffffff', foreground: '#000000', showLineweights: false };

function setup(entities = [entity('20', line(0, 0, 10, 0))], opts: { now?: () => number } = {}) {
  const d = drawing(entities);
  const visible = surface('visible');
  const layers: ReturnType<typeof surface>[] = [];
  const idle: (() => void)[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: visible,
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: (cb) => idle.push(cb),
    ...(opts.now ? { now: opts.now } : {}),
  });
  r.resize(100, 50, 1);
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const [scene, transient] = layers as [ReturnType<typeof surface>, ReturnType<typeof surface>];
  return { d, r, visible, scene, transient, idle };
}

describe('frames', () => {
  it('fills the background and strokes entities in world coordinates about the view centre', () => {
    const { r, scene } = setup();
    r.frame();
    const c = scene.ctx;
    expect(c.named('fillRect')[0]).toEqual(['fillRect', 0, 0, 100, 50]);
    expect(c.calls).toContainEqual(['setTransform', 10, 0, 0, -10, 50, 25]);
    expect(c.named('moveTo')).toEqual([['moveTo', -5, 0]]);
    expect(c.named('lineTo')).toEqual([['lineTo', 5, 0]]);
    expect(c.named('stroke')).toEqual([['stroke', '#ffffff', 1]]);
  });

  it('composites the scene and transient layers onto the visible canvas', () => {
    const { r, visible } = setup();
    r.frame();
    expect(visible.ctx.named('drawImage')).toEqual([
      ['drawImage', 'scene', 0, 0],
      ['drawImage', 'transient', 0, 0],
    ]);
  });

  it('culls entities outside the view', () => {
    const { r, scene } = setup([
      entity('20', line(0, 0, 10, 0)),
      entity('21', line(500, 500, 510, 500)),
    ]);
    r.frame();
    expect(scene.ctx.named('moveTo')).toHaveLength(1);
  });

  it('batches consecutive strokes of one colour and width into one path', () => {
    const { r, scene } = setup([
      entity('20', line(0, 0, 10, 0)),
      entity('21', line(0, 1, 10, 1)),
      entity('22', line(0, 2, 10, 2), { layer: LAYER_RED }),
    ]);
    r.frame();
    expect(scene.ctx.named('stroke')).toEqual([
      ['stroke', '#ffffff', 1],
      ['stroke', '#ff0000', 1],
    ]);
  });

  it('draws in block order (draw order)', () => {
    const { r, scene } = setup([
      entity('20', line(0, 2, 1, 2), { layer: LAYER_RED }),
      entity('21', line(0, 0, 1, 0)),
    ]);
    r.frame();
    expect(scene.ctx.named('stroke').map((s) => s[1])).toEqual(['#ff0000', '#ffffff']);
  });
});

describe('colours and visibility', () => {
  it('draws ACI 7 in the foreground on dark and light canvases', () => {
    const { r, scene } = setup();
    r.frame();
    expect(scene.ctx.named('stroke')[0]![1]).toBe('#ffffff');
    scene.ctx.clear();
    r.setStyle(LIGHT);
    r.frame();
    expect(scene.ctx.named('fillRect')[0]).toEqual(['fillRect', 0, 0, 100, 50]);
    expect(scene.ctx.named('fillStyle')[0]![1]).toBe('#ffffff');
    expect(scene.ctx.named('stroke')[0]![1]).toBe('#000000');
  });

  it('resolves ByLayer, ACI and true colour', () => {
    const { r, scene } = setup([
      entity('20', line(0, 0, 1, 0), { layer: LAYER_RED }),
      entity('21', line(0, 1, 1, 1), { color: { kind: 'aci', index: 3 } }),
      entity('22', line(0, 2, 1, 2), { color: { kind: 'rgb', r: 1, g: 2, b: 255 } }),
    ]);
    r.frame();
    expect(scene.ctx.named('stroke').map((s) => s[1])).toEqual(['#ff0000', '#00ff00', '#0102ff']);
  });

  it('hides invisible entities and entities on layers that are off or frozen', () => {
    const { d, r, scene } = setup([
      entity('20', line(0, 0, 1, 0)),
      entity('21', line(0, 1, 1, 1), { visible: false }),
    ]);
    r.frame();
    expect(scene.ctx.named('moveTo')).toHaveLength(1);
    const cs = change(d, (b) => b.updateTableRecord('layers', LAYER_0, { on: false }));
    r.apply(cs);
    scene.ctx.clear();
    r.frame();
    expect(scene.ctx.named('moveTo')).toHaveLength(0);
  });
});

describe('scene cache and transient layer', () => {
  it('applies added, updated and removed entities', () => {
    const { d, r, scene } = setup();
    const id = d.model.ids.idOf('20')!;
    let cs = change(d, (b) => {
      b.addEntity({ owner: MODEL, layer: LAYER_RED, geom: line(0, 1, 2, 1) });
      b.updateEntity(id, { geom: line(1, 0, 3, 0) });
    });
    r.apply(cs);
    r.frame();
    expect(scene.ctx.named('moveTo')).toEqual([
      ['moveTo', -4, 0],
      ['moveTo', -5, 1],
    ]);
    cs = change(d, (b) => b.removeEntity(id));
    r.apply(cs);
    scene.ctx.clear();
    r.frame();
    expect(scene.ctx.named('moveTo')).toEqual([['moveTo', -5, 1]]);
  });

  it('redraws only the transient layer when only the transient primitives change', () => {
    const { r, scene, transient } = setup();
    r.frame();
    expect(r.sceneDraws).toBe(1);
    r.setTransient([{ kind: 'stroke', path: [0, 0, 0, 1, 5, 5], color: '#00ff00' }]);
    r.frame();
    expect(r.sceneDraws).toBe(1);
    expect(transient.ctx.named('stroke')).toEqual([['stroke', '#00ff00', 1]]);
    expect(transient.ctx.named('clearRect')).toHaveLength(2);
    void scene;
  });

  it('redraws the scene after a view change', () => {
    const { r } = setup();
    r.frame();
    r.setView({ center: { x: 0, y: 0 }, scale: 1 });
    r.frame();
    expect(r.sceneDraws).toBe(2);
  });
});

describe('device pixels and lineweights', () => {
  it('sizes backing stores by the device pixel ratio and scales line widths', () => {
    const { r, visible, scene } = setup();
    r.resize(100, 50, 2);
    r.frame();
    expect(visible.canvas).toEqual({ width: 200, height: 100 });
    expect(scene.ctx.calls).toContainEqual(['setTransform', 20, 0, 0, -20, 100, 50]);
    expect(scene.ctx.named('stroke')[0]![2]).toBe(2);
  });

  it('draws lineweights at 96 dpi with LWT on, and 1 px with it off', () => {
    const { r, scene } = setup([entity('20', line(0, 0, 10, 0), { lineweight: 50 })]);
    r.frame();
    expect(scene.ctx.named('stroke')[0]![2]).toBe(1);
    r.setStyle({ ...DARK, showLineweights: true });
    scene.ctx.clear();
    r.frame();
    // Model tab: 0.5 mm at 96 dpi is 1.89 px, shown as a whole 2 px (M1-13 `lineweightPixels`).
    expect(scene.ctx.named('stroke')[0]![2]).toBe(2);
  });
});

describe('level of detail and the frame budget', () => {
  it('draws an entity smaller than a pixel as a dot', () => {
    const { r, scene } = setup([
      entity('20', line(0, 0, 10, 0)),
      entity('21', line(2, 2, 2.01, 2.01)),
    ]);
    r.frame();
    expect(scene.ctx.named('moveTo')).toHaveLength(1);
    expect(scene.ctx.named('fillRect')).toEqual([
      ['fillRect', 0, 0, 100, 50],
      ['fillRect', 20, 4, 1, 1],
    ]);
  });

  it('skips sub-pixel entities after a slow frame, then draws in full when idle', () => {
    let t = 0;
    const times = [0, 20, 100, 101, 200, 201];
    const { r, scene, idle } = setup(
      [entity('20', line(0, 0, 10, 0)), entity('21', line(2, 2, 2.01, 2.01))],
      {
        now: () => times[t++] ?? 0,
      },
    );
    r.frame(); // 20 ms: over budget
    scene.ctx.clear();
    r.frame(); // reduced
    expect(scene.ctx.named('fillRect')).toHaveLength(1);
    expect(idle).toHaveLength(1);
    scene.ctx.clear();
    idle[0]!();
    expect(scene.ctx.named('fillRect')).toHaveLength(2);
  });
});

describe('infinite lines and hit testing', () => {
  it('clips an XLINE to the view', () => {
    const { r, scene } = setup([
      entity('20', { kind: 'XLINE', base: { x: 5, y: 0 }, direction: { x: 1, y: 0 } }),
    ]);
    r.frame();
    expect(scene.ctx.named('moveTo')).toEqual([['moveTo', -5, 0]]);
    expect(scene.ctx.named('lineTo')).toEqual([['lineTo', 5, 0]]);
  });

  it('passes the arc direction to the canvas', () => {
    const { r, scene } = setup([
      entity('20', {
        kind: 'ARC',
        center: { x: 5, y: 0 },
        radius: 1,
        startAngle: 0,
        endAngle: Math.PI,
      }),
    ]);
    r.frame();
    expect(scene.ctx.named('arc')).toEqual([['arc', 0, 0, 1, 0, Math.PI, false]]);
  });

  it('finds entities within the aperture, nearest first', () => {
    const { r, d } = setup([
      entity('20', line(0, 0, 10, 0)),
      entity('21', line(0, 0.3, 10, 0.3)),
      entity('22', { kind: 'CIRCLE', center: { x: 8, y: 0 }, radius: 1 }),
    ]);
    // Screen (50, 25) is world (5, 0); the aperture of 5 px is 0.5 units.
    const ids = r.hitTest({ x: 50, y: 25 }, 5);
    expect(ids.map((id) => d.model.ids.handleOf(id))).toEqual(['20', '21']);
    expect(r.hitTest({ x: 80, y: 15 }, 2).map((id) => d.model.ids.handleOf(id))).toEqual(['22']);
    expect(r.hitTest({ x: 50, y: 0 }, 2)).toEqual([]);
  });

  it('hits the inside of a fill', () => {
    const { r, d } = setup([
      entity('20', {
        kind: 'SOLID',
        corners: [
          { x: 0, y: -2 },
          { x: 10, y: -2 },
          { x: 0, y: 2 },
          { x: 10, y: 2 },
        ],
      }),
    ]);
    expect(r.hitTest({ x: 50, y: 25 }, 1).map((id) => d.model.ids.handleOf(id))).toEqual(['20']);
  });
});
