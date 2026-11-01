// Canvas2DRenderer with blocks (M1-14 part 1): INSERTs draw their block's entities placed by
// the insert, through nesting and MINSERT arrays, with ByBlock and layer-0 inheritance, the
// insert layer's on/off and freeze rules, the block's own draw order, linetypes that scale with
// the block, and re-drawing when a block definition changes.
import type { EntityGeometry, EntityInit, InsertGeometry, SortEntsTable } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import { change, drawing, entity, LAYER_DASHED, LAYER_RED, line, MODEL, surface } from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
/** Block definitions: B holds a line on layer 0; N holds an insert of B. */
const B = '40';
const N = '41';
const SELF = '42';
const CONTINUOUS = '14';

const insertOf = (block: string, extra: Partial<InsertGeometry> = {}): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
  ...extra,
});

function setup(entities: EntityInit[], objects: SortEntsTable[] = []) {
  const d = drawing(entities, {
    blocks: [
      { handle: B, name: 'B', basePoint: { x: 0, y: 0 } },
      { handle: N, name: 'N' },
      { handle: SELF, name: 'SELF' },
    ],
    objects,
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

const inB = (handle: string, geom: EntityGeometry, extra: Partial<EntityInit> = {}) =>
  entity(handle, geom, { owner: B, ...extra });
const lineInB = (extra: Partial<EntityInit> = {}) => inB('50', line(0, 0, 1, 0), extra);

describe('inserts', () => {
  it('draws the block’s entities moved, turned and scaled by the insert', () => {
    const { redraw } = setup([
      lineInB(),
      entity(
        '20',
        insertOf(B, {
          position: { x: 5, y: 0 },
          scale: { x: 2, y: 2, z: 1 },
          rotation: Math.PI / 2,
        }),
      ),
    ]);
    const c = redraw();
    // World (5, 0) → (2, 0) after the turn and scale; paths are relative to the view centre (5, 0).
    expect(c.named('moveTo')).toEqual([['moveTo', 0, 0]]);
    const [, x, y] = c.named('lineTo')[0]!;
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(2, 12);
  });

  it('draws nested inserts and every MINSERT cell', () => {
    const { redraw } = setup([
      lineInB(),
      entity('51', insertOf(B, { position: { x: 1, y: 0 } }), { owner: N }),
      entity(
        '20',
        insertOf(N, { array: { columns: 3, rows: 1, columnSpacing: 2, rowSpacing: 0 } }),
      ),
    ]);
    const moves = redraw()
      .named('moveTo')
      .map((m) => (m[1] as number) + 5);
    expect(moves).toEqual([1, 3, 5]);
  });

  it('resolves ByBlock and layer 0 from the insert, through nesting', () => {
    const { redraw } = setup([
      lineInB({ color: { kind: 'byBlock' } }),
      inB('52', line(0, 1, 1, 1)), // layer 0, ByLayer: takes the insert's layer
      inB('53', line(0, 2, 1, 2), { color: { kind: 'aci', index: 3 } }),
      entity('51', insertOf(B), { owner: N, color: { kind: 'byBlock' } }),
      entity('20', insertOf(N), { layer: LAYER_RED, color: { kind: 'aci', index: 5 } }),
    ]);
    expect(
      redraw()
        .named('stroke')
        .map((s) => s[1]),
    ).toEqual(['#0000ff', '#ff0000', '#00ff00']);
  });

  it('hides layer-0 contents when the insert’s layer is off, and everything when it is frozen', () => {
    // 50 is on layer 0, so it shows on the insert's layer RED; 52 is on its own layer.
    const { d, r, redraw } = setup([
      lineInB(),
      inB('52', line(0, 1, 1, 1), { layer: LAYER_DASHED, linetype: CONTINUOUS }),
      entity('20', insertOf(B), { layer: LAYER_RED }),
    ]);
    expect(
      redraw()
        .named('stroke')
        .map((s) => s[1]),
    ).toEqual(['#ff0000', '#ffffff']);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { on: false })));
    expect(
      redraw()
        .named('stroke')
        .map((s) => s[1]),
    ).toEqual(['#ffffff']);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { on: true, frozen: true })));
    expect(redraw().named('moveTo')).toHaveLength(0);
  });

  it('draws a block’s entities in its own SORTENTSTABLE order', () => {
    const table: SortEntsTable = {
      handle: '60',
      type: 'SORTENTSTABLE',
      owner: '61',
      block: B,
      entries: [{ entity: '50', sort: '99' }],
    };
    const { redraw } = setup(
      [lineInB({ layer: LAYER_RED }), inB('52', line(0, 1, 1, 1)), entity('20', insertOf(B))],
      [table],
    );
    expect(
      redraw()
        .named('stroke')
        .map((s) => s[1]),
    ).toEqual(['#ffffff', '#ff0000']);
  });

  it('scales linetypes with the block', () => {
    // DASHED (0.75 per repetition) on the block's 1-unit line gives two end dashes of 0.375.
    // The block's linetypes are generated in its own units and scaled with it, so at scale 5
    // the 5-unit line keeps those two dashes, now 1.875 long.
    const { redraw } = setup([
      lineInB({ layer: LAYER_DASHED }),
      entity('20', insertOf(B, { scale: { x: 5, y: 5, z: 1 } })),
    ]);
    const c = redraw();
    expect(c.named('moveTo')).toHaveLength(2);
    expect((c.named('lineTo')[0]![1] as number) + 5).toBeCloseTo(1.875, 9);
  });

  it('redraws an insert when its block changes, including through nesting', () => {
    const { d, r, redraw } = setup([
      lineInB(),
      entity('51', insertOf(B), { owner: N }),
      entity('20', insertOf(N)),
    ]);
    expect(redraw().named('moveTo')).toHaveLength(1);
    r.apply(change(d, (b) => b.addEntity(inB('54', line(0, 3, 1, 3)))));
    expect(redraw().named('moveTo')).toHaveLength(2);
    r.apply(
      change(d, (b) =>
        b.updateEntity(d.model.ids.idOf('50')!, { color: { kind: 'aci', index: 1 } }),
      ),
    );
    expect(
      redraw()
        .named('stroke')
        .map((s) => s[1]),
    ).toContain('#ff0000');
  });

  it('survives a block that contains itself', () => {
    const { redraw } = setup([
      entity('55', line(0, 0, 1, 0), { owner: SELF }),
      entity('56', insertOf(SELF, { position: { x: 1, y: 0 } }), { owner: SELF }),
      entity('20', insertOf(SELF)),
    ]);
    expect(redraw().named('moveTo').length).toBeGreaterThan(0);
  });

  it('picks an insert by its contents', () => {
    const { d, r } = setup([lineInB(), entity('20', insertOf(B, { position: { x: 5, y: 0 } }))]);
    // Screen (55, 25) is world (5.5, 0), on the inserted line.
    expect(r.hitTest({ x: 55, y: 25 }, 2).map((id) => d.model.ids.handleOf(id))).toEqual(['20']);
    expect(r.hitTest({ x: 80, y: 25 }, 2)).toEqual([]);
  });

  it('draws nothing for an invisible insert', () => {
    const { redraw } = setup([lineInB(), entity('20', insertOf(B), { visible: false })]);
    expect(redraw().named('moveTo')).toHaveLength(0);
  });
});
