// Canvas2DRenderer with tables (M1-17): an ACAD_TABLE draws its stored `*T` block as AutoCAD
// last drew it, at its insertion point (the table's top-left corner) along its direction,
// mirrored on a −Z plane, handing its colour and layer down as an INSERT does; a table without
// a block draws nothing until the table engine (M4-05) generates one.
import type { EntityInit, TableGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, referenceOf, type RenderStyle } from '../src/index';
import { change, drawing, entity, LAYER_RED, line, MODEL, surface } from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
/** *T1 holds a 2 × 1 grid, 4 wide and 2 tall, hanging down from its origin. */
const T1 = '40';

const table = (extra: Partial<TableGeometry> = {}): TableGeometry => ({
  kind: 'ACAD_TABLE',
  block: T1,
  position: { x: 10, y: 5 },
  direction: { x: 1, y: 0 },
  rowHeights: [1, 1],
  columnWidths: [4],
  cells: [],
  ...extra,
});

/** The grid's top edge on layer 0 and its bottom edge ByBlock. */
const tableBlock = (): EntityInit[] => [
  entity('50', line(0, 0, 4, 0), { owner: T1 }),
  entity('51', line(0, -2, 4, -2), { owner: T1, color: { kind: 'byBlock' } }),
];

function setup(entities: EntityInit[], basePoint = { x: 0, y: 0 }) {
  const d = drawing(entities, { blocks: [{ handle: T1, name: '*T1', basePoint }] });
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
  r.setView({ center: { x: 10, y: 5 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, redraw };
}

const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
/** Path points in world coordinates (paths are relative to the view centre, (10, 5)). */
const points = (c: ReturnType<ReturnType<typeof setup>['redraw']>) =>
  c.calls
    .filter((k) => k[0] === 'moveTo' || k[0] === 'lineTo')
    .map((k) => [round((k[1] as number) + 10), round((k[2] as number) + 5)]);

describe('tables', () => {
  it('draws the stored block from the insertion point down along the direction', () => {
    const { redraw } = setup([...tableBlock(), entity('20', table())]);
    expect(points(redraw())).toEqual([
      [10, 5],
      [14, 5],
      [10, 3],
      [14, 3],
    ]);
  });

  it('turns with the direction and mirrors on a −Z plane', () => {
    const turned = setup([...tableBlock(), entity('20', table({ direction: { x: 0, y: 2 } }))]);
    // x along +y; y along normal × direction = (−1, 0), so the grid hangs to the right.
    expect(points(turned.redraw())).toEqual([
      [10, 5],
      [10, 9],
      [12, 5],
      [12, 9],
    ]);
    const mirrored = setup([
      ...tableBlock(),
      entity('20', table({ normal: { x: 0, y: 0, z: -1 } })),
    ]);
    expect(points(mirrored.redraw())).toEqual([
      [10, 5],
      [14, 5],
      [10, 7],
      [14, 7],
    ]);
  });

  it('places the block’s base point at the insertion point', () => {
    const { redraw } = setup([...tableBlock(), entity('20', table())], { x: 1, y: 0 });
    expect(points(redraw())[0]).toEqual([9, 5]);
  });

  it('hands the table’s colour to ByBlock contents and its layer to layer 0', () => {
    const { redraw } = setup([
      ...tableBlock(),
      entity('20', table(), { layer: LAYER_RED, color: { kind: 'aci', index: 3 } }),
    ]);
    expect(
      redraw()
        .named('stroke')
        .map((s) => s[1]),
    ).toEqual(['#ff0000', '#00ff00']);
  });

  it('hides a table on a frozen layer and shows it again when thawed', () => {
    const { d, r, redraw } = setup([...tableBlock(), entity('20', table(), { layer: LAYER_RED })]);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { frozen: true })));
    expect(redraw().named('moveTo')).toHaveLength(0);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { frozen: false })));
    expect(redraw().named('moveTo')).toHaveLength(2);
  });

  it('draws nothing for a table without a block', () => {
    const { block: _, ...bare } = table();
    const { d, redraw } = setup([entity('20', bare)]);
    expect(redraw().named('moveTo')).toHaveLength(0);
    expect(
      referenceOf(d.model.entity(d.model.ids.idOf('20')!)!, (h) => d.model.blocks.get(h)),
    ).toBeUndefined();
  });

  it('redraws when the stored graphics change, and picks the table by them', () => {
    const { d, r, redraw } = setup([...tableBlock(), entity('20', table())]);
    // World (12, 5), on the top edge: screen (100 + 2·10, 50).
    expect(r.hitTest({ x: 120, y: 50 }, 2).map((id) => d.model.ids.handleOf(id))).toEqual(['20']);
    r.apply(change(d, (b) => b.removeEntity(d.model.ids.idOf('50')!)));
    expect(redraw().named('moveTo')).toHaveLength(1);
    expect(r.hitTest({ x: 120, y: 50 }, 2)).toEqual([]);
  });
});
