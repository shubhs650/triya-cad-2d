// Canvas2DRenderer with wide polylines (M1-46): filled while FILLMODE is on (AutoCAD's
// initial value), outlined when the header turns it off, and redrawn when it changes. With a
// linetype (M1-66) each dash is a filled piece of the outline, continuous under a pixel.
import type { EntityGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import {
  change,
  drawing,
  entity,
  LAYER_DASHED,
  MODEL,
  surface,
  type DrawingExtra,
} from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };

const wide: EntityGeometry = {
  kind: 'LWPOLYLINE',
  closed: false,
  constantWidth: 2,
  vertices: [
    { x: 0, y: 0, bulge: 0 },
    { x: 10, y: 0, bulge: 0 },
  ],
};

function setup(extra?: DrawingExtra, layer?: string) {
  const d = drawing([entity('20', wide, layer ? { layer } : {})], extra);
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(`layer${layers.length}`);
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
  });
  r.resize(200, 100, 1);
  const scene = layers[0]!.ctx;
  const redraw = (scale = 10) => {
    scene.clear();
    r.setView({ center: { x: 5, y: 0 }, scale });
    r.frame();
    return scene;
  };
  return { d, r, redraw };
}

describe('wide polylines', () => {
  it('fill with FILLMODE on, and when the header does not say', () => {
    const c = setup().redraw();
    expect(c.named('fill')).toHaveLength(1);
    expect(c.named('stroke')).toEqual([]);
    expect(
      setup({ header: [['$FILLMODE', 1]] })
        .redraw()
        .named('fill'),
    ).toHaveLength(1);
  });

  it('draw their outlines with FILLMODE off', () => {
    const c = setup({ header: [['$FILLMODE', 0]] }).redraw();
    expect(c.named('fill')).toEqual([]);
    expect(c.named('stroke')).toHaveLength(1);
    expect(
      setup({ header: [['$FILLMODE', false]] })
        .redraw()
        .named('fill'),
    ).toEqual([]);
  });

  it('redraw when FILLMODE changes', () => {
    const s = setup();
    expect(s.redraw().named('fill')).toHaveLength(1);
    s.r.apply(change(s.d, (b) => b.setHeader('$FILLMODE', 0)));
    const c = s.redraw();
    expect(c.named('fill')).toEqual([]);
    expect(c.named('stroke')).toHaveLength(1);
  });

  it('fill each dash on a dashed layer, and the whole outline once a pattern is under a pixel', () => {
    const s = setup(undefined, LAYER_DASHED);
    // 10 units of DASHED (0.5, -0.25): 14 dashes, as a thin line has.
    let c = s.redraw();
    expect(c.named('fill')).toHaveLength(1);
    expect(c.named('moveTo')).toHaveLength(14);
    c = s.redraw(1); // 0.75 px per pattern
    expect(c.named('fill')).toHaveLength(1);
    expect(c.named('moveTo')).toHaveLength(1);
  });
});
