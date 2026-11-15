// M2-06 part 2: the objects a command drags with the cursor, drawn on the transient layer over
// their originals: cached primitives through the drag's motion (a move, turn, scale or
// mirror), and stretched objects tessellated from their stretched geometry.
import { rotation, translation, type EntityId, type MTextGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, COMMAND_PREVIEW_FADE, gripHalfSize } from '../src/index';
import { aciRgb, rgbHex } from '../src/style/aci';
import { drawing, entity, LAYER_0, line, MODEL, surface, type Call } from './fixtures';

const aciHex = (aci: number) => rgbHex(aciRgb(aci));

/** Static columns 3 wide, gutter 1, 2 high, inserted top left at (0, 4) (M2-26 part 2). */
const columned: MTextGeometry = {
  kind: 'MTEXT',
  contents: 'A',
  style: 'S',
  position: { x: 0, y: 4 },
  height: 0.5,
  width: 3,
  definedHeight: 2,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  columns: {
    type: 1,
    count: 2,
    flowReversed: false,
    autoHeight: false,
    width: 3,
    gutter: 1,
    heights: [],
  },
};

function setup() {
  const d = drawing([
    entity('20', line(0, 0, 10, 0)),
    entity('21', line(0, 20, 0, 30)),
    entity('22', columned),
  ]);
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

describe('Canvas2DRenderer command preview (M3-12 part 6, COMMANDPREVIEW)', () => {
  const props = {
    layer: LAYER_0,
    color: { kind: 'aci', index: 1 },
    linetype: 'ByLayer',
    lineweight: 'ByLayer',
    transparency: 'ByLayer',
    ltScale: 1,
  } as const;

  it('fades the objects a pick would change and draws the shapes they would take', () => {
    const { r, id, transient, scene } = setup();
    transient().clear();
    scene().clear();
    r.setDrag({
      ids: [],
      m: translation(0, 0),
      preview: { faded: [id('20')], shapes: [{ geom: line(0, 0, 5, 0), props }] },
    });
    r.frame();
    // The scene is drawn again without the faded line …
    expect(scene().calls.some((c) => c[0] === 'fillRect')).toBe(true);
    expect(devicePoints(scene().calls)).not.toContainEqual([100, 50]);
    // … which the transient layer draws faded, under the shape in its own colour.
    const t = transient().calls;
    expect(devicePoints(t)).toEqual([
      [0, 50],
      [100, 50],
      [0, 50],
      [50, 50],
    ]);
    expect(t).toContainEqual(['globalAlpha', COMMAND_PREVIEW_FADE]);
    expect(t.filter((c) => c[0] === 'stroke').at(-1)).toEqual(['stroke', aciHex(1), 1]);
  });

  it('shows the faded objects in the scene again once the preview goes', () => {
    const { r, id, scene } = setup();
    r.setDrag({ ids: [], m: translation(0, 0), preview: { faded: [id('20')], shapes: [] } });
    r.frame();
    scene().clear();
    r.setDrag(undefined);
    r.frame();
    expect(devicePoints(scene().calls)).toContainEqual([100, 50]);
  });

  it('does not draw the scene again while the faded objects stay the same', () => {
    const { r, id, scene } = setup();
    const at = (x: number) =>
      r.setDrag({
        ids: [],
        m: translation(0, 0),
        preview: { faded: [id('20')], shapes: [{ geom: line(0, 0, x, 0), props }] },
      });
    at(5);
    r.frame();
    scene().clear();
    at(6);
    r.frame();
    expect(scene().calls).toEqual([]);
  });
});

describe('Canvas2DRenderer grips', () => {
  const squares = (calls: readonly Call[]) => {
    const out: [string, number, number, number][] = [];
    let fill = '';
    for (const c of calls) {
      if (c[0] === 'fillStyle') fill = String(c[1]);
      if (c[0] === 'fillRect' && fill !== aciHex(251)) {
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

  it("draws grips at GRIPSIZE, AutoCAD's 5 a 4 px half size (M2-59 part 3)", () => {
    expect(gripHalfSize(undefined)).toBe(4);
    expect(gripHalfSize(5)).toBe(4);
    expect(gripHalfSize(10)).toBe(8);
    const { r, id, transient } = setup();
    r.setStyle({
      background: '#000000',
      foreground: '#ffffff',
      showLineweights: false,
      gripSize: 10,
    });
    r.setGrips([id('20')]);
    transient().clear();
    r.frame();
    expect(squares(transient().calls).map(([, , , w]) => w)).toEqual([16, 16, 16]);
    // Never under a device pixel, however small.
    r.setStyle({
      background: '#000000',
      foreground: '#ffffff',
      showLineweights: false,
      gripSize: 1,
    });
    transient().clear();
    r.frame();
    expect(squares(transient().calls).map(([, , , w]) => w)).toEqual([2, 2, 2]);
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

  it('draws an MTEXT’s column grips as triangles pointing the way they size', () => {
    const { r, id, transient } = setup();
    transient().clear();
    r.setGrips([id('22')]);
    r.frame();
    // The insertion point (0, 4) stays a square, at device (0, 10).
    expect(squares(transient().calls).map(([, x, y]) => [x, y])).toEqual([[0, 10]]);
    // Each triangle drawn twice (its dark edge, then the grip): the tip first.
    const tips = devicePoints(transient().calls)
      .filter((_, i) => i % 3 === 0)
      .filter((_, i) => i % 2 === 1)
      .map(([x, y]) => [Math.round(x!), Math.round(y!)]);
    expect(tips).toEqual([
      // Column width (3, 4) and gutter (4, 4) point right; the height (1.5, 2) points down.
      [36, 10],
      [46, 10],
      [15, 36],
    ]);
  });

  it('draws the grip under the cursor in GRIPHOVER, the hot one staying GRIPHOT (M3-05 part 2)', () => {
    const { r, id, transient } = setup();
    r.setGrips([id('20')]);
    r.frame();
    const plain = squares(transient().calls)[0]![0];
    transient().clear();
    // Within 0.5 drawing units of the line's end grip at (10, 0): it takes the hover colour.
    r.setGripHover({ x: 10.3, y: 0.2 }, 0.5);
    r.frame();
    const [a, b, c] = squares(transient().calls);
    expect(a![0]).toBe(plain);
    expect(b![0]).toBe(plain);
    expect(c![0]).toBe(aciHex(11));
    // Away from every grip, or none: all plain again.
    transient().clear();
    r.setGripHover({ x: 3, y: 3 }, 0.5);
    r.frame();
    expect(squares(transient().calls).map(([f]) => f)).toEqual([plain, plain, plain]);
    r.setGrips([id('20')], { x: 10, y: 0 });
    r.setGripHover({ x: 10, y: 0 }, 0.5);
    transient().clear();
    r.frame();
    expect(squares(transient().calls)[2]![0]).toBe(aciHex(12));
    r.setGripHover(undefined, 0);
    transient().clear();
    r.frame();
    expect(squares(transient().calls)[2]![0]).toBe(aciHex(12));
  });

  it('draws grips in the style’s GRIPCOLOR, GRIPHOVER, GRIPHOT and GRIPCONTOUR (M3-05 part 5)', () => {
    const { r, id, transient } = setup();
    r.setStyle({
      background: '#000000',
      foreground: '#ffffff',
      showLineweights: false,
      gripColors: { unselected: 3, hover: 4, selected: 5, contour: 6 },
    });
    r.setGrips([id('20')], { x: 10, y: 0 });
    r.setGripHover({ x: 5, y: 0 }, 0.5);
    transient().clear();
    r.frame();
    const fills: string[] = [];
    for (const c of transient().calls) if (c[0] === 'fillStyle') fills.push(String(c[1]));
    // Each grip: its contour, then its fill.
    expect(fills).toEqual([aciHex(6), aciHex(3), aciHex(6), aciHex(4), aciHex(6), aciHex(5)]);
  });

  it('draws the grip contour in ACI 251 by default, AutoCAD’s GRIPCONTOUR', () => {
    const { r, id, transient } = setup();
    r.setGrips([id('20')]);
    transient().clear();
    r.frame();
    const fills: string[] = [];
    for (const c of transient().calls) if (c[0] === 'fillStyle') fills.push(String(c[1]));
    expect(fills.filter((_, i) => i % 2 === 0)).toEqual([aciHex(251), aciHex(251), aciHex(251)]);
    expect(fills.filter((_, i) => i % 2 === 1)).toEqual([aciHex(150), aciHex(150), aciHex(150)]);
  });

  it('draws a selected group’s one grip at its centre, and its bounding box (M3-13)', () => {
    const { r, id, transient } = setup();
    transient().clear();
    // Line 20, (0,0)-(10,0), a group shown by one grip: its centre (5, 0) is device (50, 50).
    r.setGrips([id('21')], undefined, [{ ids: [id('20')], box: true }]);
    r.frame();
    const plain = squares(transient().calls)[0]![0];
    expect(squares(transient().calls).map(([, x, y]) => [x, y])).toEqual([
      [50, 50],
      [0, -150],
      [0, -200],
      [0, -250],
    ]);
    // The box round the group's extents, drawn before the grips.
    // A device pixel wide, on pixel centres.
    expect(devicePoints(transient().calls)).toEqual([
      [0.5, 50.5],
      [100.5, 50.5],
      [100.5, 50.5],
      [0.5, 50.5],
    ]);
    // No box at GROUPDISPLAYMODE 1; the centre grip takes the hover and hot colours.
    r.setGrips([], undefined, [{ ids: [id('20')] }]);
    r.setGripHover({ x: 5.2, y: 0.1 }, 0.5);
    transient().clear();
    r.frame();
    expect(devicePoints(transient().calls)).toEqual([]);
    expect(squares(transient().calls)).toEqual([[aciHex(11), 50, 50, 8]]);
    r.setGrips([], { x: 5, y: 0 }, [{ ids: [id('20')] }]);
    transient().clear();
    r.frame();
    expect(squares(transient().calls)[0]![0]).toBe(aciHex(12));
    expect(plain).not.toBe(aciHex(12));
    // A group whose objects have no extents shows nothing.
    r.setGrips([], undefined, [{ ids: [], box: true }]);
    transient().clear();
    r.frame();
    expect(squares(transient().calls)).toEqual([]);
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
