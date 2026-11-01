// Canvas2DRenderer with dimensions (M1-15 part 1): a DIMENSION draws its stored `*D` block as
// AutoCAD last drew it, in place, with the dimension handing its colour and layer down to the
// block's ByBlock and layer-0 contents, arrowhead blocks nested inside, and no drawing for a
// dimension that has no block yet (the dimension engine, M5, generates one).
import type { DimensionGeometry, EntityGeometry, EntityInit, InsertGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import { change, drawing, entity, LAYER_RED, line, MODEL, surface } from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
/** Blocks: *D1 holds a dimension's graphics; TICK is an arrowhead block nested in it. */
const D1 = '40';
const TICK = '41';
const D2 = '42';

const linear = (block?: string): DimensionGeometry => ({
  kind: 'DIMENSION',
  dimType: 'linear',
  style: '0',
  ...(block === undefined ? {} : { block }),
  definitionPoint: { x: 10, y: 2 },
  textPosition: { x: 5, y: 2 },
  textUserPositioned: false,
  text: '',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  first: { x: 0, y: 0 },
  second: { x: 10, y: 0 },
  rotation: 0,
});

const arcDim = (block: string): EntityGeometry => ({
  kind: 'ARC_DIMENSION',
  dimType: 'arc',
  style: '0',
  block,
  definitionPoint: { x: 0, y: 3 },
  textPosition: { x: 0, y: 3 },
  textUserPositioned: false,
  text: '',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  first: { x: 2, y: 0 },
  second: { x: -2, y: 0 },
  center: { x: 0, y: 0 },
  startAngle: 0,
  endAngle: Math.PI,
  partial: false,
});

const tickInsert = (x: number): InsertGeometry => ({
  kind: 'INSERT',
  block: TICK,
  position: { x, y: 2 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

function setup(entities: EntityInit[]) {
  const d = drawing(entities, {
    blocks: [
      { handle: D1, name: '*D1', basePoint: { x: 0, y: 0 } },
      { handle: TICK, name: '_ArchTick' },
      { handle: D2, name: '*D2' },
    ],
  });
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
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, redraw };
}

/** The `*D1` graphics: the dimension line on layer 0, ByBlock extension line, two ticks. */
const dimBlock = (): EntityInit[] => [
  entity('50', line(0, 2, 10, 2), { owner: D1 }),
  entity('51', line(0, 0, 0, 2.5), { owner: D1, color: { kind: 'byBlock' } }),
  entity('52', tickInsert(0), { owner: D1 }),
  entity('53', tickInsert(10), { owner: D1 }),
  entity('54', line(-0.2, -0.2, 0.2, 0.2), { owner: TICK }),
];

/** moveTo points in world coordinates (paths are relative to the view centre, (5, 0)). */
const moves = (c: ReturnType<ReturnType<typeof setup>['redraw']>) =>
  c.named('moveTo').map((m) => [round((m[1] as number) + 5), round(m[2] as number)]);
const round = (v: number) => Math.round(v * 1e9) / 1e9;

describe('dimensions', () => {
  it('draws the stored block in place, with its nested arrowheads', () => {
    const { redraw } = setup([...dimBlock(), entity('20', linear(D1))]);
    const c = redraw();
    expect(moves(c)).toEqual([
      [0, 2],
      [0, 0],
      [-0.2, 1.8],
      [9.8, 1.8],
    ]);
  });

  it('hands the dimension’s colour to ByBlock contents and its layer to layer 0', () => {
    const { redraw } = setup([
      ...dimBlock(),
      entity('20', linear(D1), { layer: LAYER_RED, color: { kind: 'aci', index: 3 } }),
    ]);
    // Line 50 is ByLayer on layer 0: the dimension's layer, red. Line 51 is ByBlock: green.
    // The ticks are ByLayer on layer 0 inside a ByLayer insert: red.
    expect(
      redraw()
        .named('stroke')
        .map((s) => s[1]),
    ).toEqual(['#ff0000', '#00ff00', '#ff0000']);
  });

  it('hides a dimension on a frozen layer and shows it again when thawed', () => {
    const { d, r, redraw } = setup([...dimBlock(), entity('20', linear(D1), { layer: LAYER_RED })]);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { frozen: true })));
    expect(redraw().named('moveTo')).toHaveLength(0);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { frozen: false })));
    expect(redraw().named('moveTo')).toHaveLength(4);
  });

  it('draws arc-length dimensions from their block too', () => {
    const { redraw } = setup([
      entity('55', line(-2, 3, 2, 3), { owner: D2 }),
      entity('21', arcDim(D2)),
    ]);
    expect(moves(redraw())).toEqual([[-2, 3]]);
  });

  it('draws nothing for a dimension without a block', () => {
    const { redraw } = setup([entity('20', linear())]);
    expect(redraw().named('moveTo')).toHaveLength(0);
  });

  it('draws a dimension inside a block once per insert', () => {
    const { redraw } = setup([
      ...dimBlock(),
      entity('20', linear(D1), { owner: D2 }),
      entity('21', { ...tickInsert(0), block: D2, position: { x: 0, y: -5 } }),
    ]);
    expect(moves(redraw())[0]).toEqual([0, -3]);
  });

  it('redraws when the stored graphics change', () => {
    const { d, r, redraw } = setup([...dimBlock(), entity('20', linear(D1))]);
    expect(redraw().named('moveTo')).toHaveLength(4);
    r.apply(change(d, (b) => b.removeEntity(d.model.ids.idOf('51')!)));
    expect(redraw().named('moveTo')).toHaveLength(3);
  });

  it('picks a dimension by its graphics', () => {
    const { d, r } = setup([...dimBlock(), entity('20', linear(D1))]);
    // World (5, 2), on the dimension line: screen (100 + 0·10, 50 − 2·10).
    expect(r.hitTest({ x: 100, y: 30 }, 2).map((id) => d.model.ids.handleOf(id))).toEqual(['20']);
    expect(r.hitTest({ x: 100, y: 80 }, 2)).toEqual([]);
  });
});
