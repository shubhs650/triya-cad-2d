// SpatialIndex (M1-07): one R-tree per block record (so one per layout, through the layout's
// block record), kept current by applying each ChangeSet after the model applies it. The
// invalidation tests check that an index updated change by change answers exactly like a
// fresh build and like a brute-force scan, including through nested block references.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  ChangeSetBuilder,
  DocumentModel,
  toleranceForSize,
  type Box,
  type EntityGeometry,
  type EntityId,
  type HeaderValue,
} from '../../src/index';
import { entityBounds, SpatialIndex, type BoundsContext } from '../../src/spatial/index';
import {
  blockRecord,
  circleGeom,
  entityInit,
  LAYER_0,
  layer,
  lineGeom,
  linetype,
  MODEL_SPACE,
  PAPER_SPACE,
} from '../model/fixtures';

const tol = toleranceForSize(1000);
const BLOCK_A = '30';
const BLOCK_B = '31';
const DIM_BLOCK = '32';
const CYCLE = '33';

const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({
  minX,
  minY,
  maxX,
  maxY,
});

const insertGeom = (block: string, x: number, y: number, extra = {}): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x, y },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
  ...extra,
});

/**
 * Model space and paper space, block A (a unit line), block B (holding an INSERT of A at
 * (10, 0)), a *D block, and a block that references itself.
 */
function blockModel(): DocumentModel {
  const blocks = [
    [MODEL_SPACE, '*Model_Space'],
    [PAPER_SPACE, '*Paper_Space'],
    [BLOCK_A, 'A'],
    [BLOCK_B, 'B'],
    [DIM_BLOCK, '*D1'],
    [CYCLE, 'LOOP'],
  ] as const;
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0')],
      linetypes: [linetype('14', 'Continuous')],
      blockRecords: blocks.map(([h, n]) => blockRecord(h, n)),
    },
    blocks: blocks.map(([handle, name]) => ({ handle, name, basePoint: { x: 0, y: 0 } })),
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE },
      { handle: '1E', name: 'Layout1', tabOrder: 1, blockRecord: PAPER_SPACE },
    ],
    entities: [
      entityInit('40', lineGeom(0, 0, 1, 0), { owner: BLOCK_A }),
      entityInit('41', insertGeom(BLOCK_A, 10, 0), { owner: BLOCK_B }),
      entityInit('42', lineGeom(-1, -1, 11, 7), { owner: DIM_BLOCK }),
      entityInit('43', insertGeom(CYCLE, 0, 0), { owner: CYCLE }),
      entityInit('50', lineGeom(0, 0, 10, 0)),
      entityInit('51', circleGeom(100, 100, 5)),
      entityInit('52', insertGeom(BLOCK_A, 200, 0)),
      entityInit('53', insertGeom(BLOCK_B, 300, 0)),
      entityInit('54', lineGeom(1, 1, 2, 2), { owner: PAPER_SPACE }),
    ],
  });
}

const idOf = (model: DocumentModel, handle: string): EntityId => {
  const id = model.ids.idOf(handle);
  if (id === undefined) throw new Error(`no entity ${handle}`);
  return id;
};

const sorted = (ids: readonly EntityId[]) => [...ids].sort((a, b) => a - b);

/** Brute force: bounds every entity of the block from scratch, block extents included. */
function bruteQuery(model: DocumentModel, block: string, q: Box): EntityId[] {
  const extents = (h: string, seen: Set<string>): Box | 'unknown' | undefined => {
    if (!model.hasBlock(h)) return undefined;
    if (seen.has(h)) return 'unknown';
    let acc: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const id of model.blockEntities(h)) {
      const b = entityBounds(model.entity(id)!.geom, ctx(new Set([...seen, h])));
      if (b.kind === 'unknown' || b.kind === 'infinite') return 'unknown';
      if (b.kind === 'box') {
        acc = {
          minX: Math.min(acc.minX, b.box.minX),
          minY: Math.min(acc.minY, b.box.minY),
          maxX: Math.max(acc.maxX, b.box.maxX),
          maxY: Math.max(acc.maxY, b.box.maxY),
        };
      }
    }
    return acc;
  };
  const ctx = (seen: Set<string>): BoundsContext => ({
    tol,
    blockExtents: (h) => extents(h, seen),
    basePoint: (h) => model.blocks.get(h)?.basePoint,
  });
  return model.blockEntities(block).filter((id) => {
    const b = entityBounds(model.entity(id)!.geom, ctx(new Set()));
    if (b.kind === 'unknown') return true;
    if (b.kind === 'box') return boxesOverlap(b.box, q, 0);
    return false; // no construction lines in the random edits
  });
}

describe('queries', () => {
  it('returns the entities of one block record whose bounds overlap the box', () => {
    const model = blockModel();
    const index = SpatialIndex.build(model, { tol });
    expect(sorted(index.query(MODEL_SPACE, box(-1, -1, 5, 5)))).toEqual([idOf(model, '50')]);
    expect(index.query(MODEL_SPACE, box(94, 94, 95.5, 95.5))).toEqual([idOf(model, '51')]);
    expect(index.query(MODEL_SPACE, box(500, 500, 600, 600))).toEqual([]);
    // Touching counts: the box is closed.
    expect(index.query(MODEL_SPACE, box(10, 0, 12, 1))).toEqual([idOf(model, '50')]);
  });

  it('keeps layouts apart: paper space has its own tree', () => {
    const model = blockModel();
    const index = SpatialIndex.build(model, { tol });
    expect(index.query(MODEL_SPACE, box(1.5, 1.5, 1.6, 1.6))).toEqual([]);
    expect(index.query(PAPER_SPACE, box(1.5, 1.5, 1.6, 1.6))).toEqual([idOf(model, '54')]);
    expect(index.queryLayout('1E', box(1.5, 1.5, 1.6, 1.6))).toEqual([idOf(model, '54')]);
    expect(index.queryLayout('22', box(1.5, 1.5, 1.6, 1.6))).toEqual([]);
    expect(() => index.queryLayout('99', box(0, 0, 1, 1))).toThrow(/layout 99/);
    expect(index.query('77', box(0, 0, 1, 1))).toEqual([]);
  });

  it('finds block references by their placed block extents, nested ones included', () => {
    const model = blockModel();
    const index = SpatialIndex.build(model, { tol });
    expect(index.query(MODEL_SPACE, box(200.5, -0.1, 200.6, 0.1))).toEqual([idOf(model, '52')]);
    // B places A at (10, 0); B is inserted at (300, 0), so A's line spans x 310..311.
    expect(index.query(MODEL_SPACE, box(310.2, -0.1, 310.3, 0.1))).toEqual([idOf(model, '53')]);
    expect(index.query(MODEL_SPACE, box(301, -0.1, 309, 0.1))).toEqual([]);
    expect(index.extents(BLOCK_B)).toEqual(box(10, 0, 11, 0));
    expect(index.extents('77')).toBeUndefined();
  });

  it('treats a self-referencing block as unknown instead of looping', () => {
    const model = blockModel();
    const index = SpatialIndex.build(model, { tol });
    expect(index.extents(CYCLE)).toBe('unknown');
    expect(index.bounds(idOf(model, '43'))).toEqual({ kind: 'unknown' });
  });

  it('always returns entities with unknown bounds, and tests construction lines exactly', () => {
    const model = blockModel();
    const b = new ChangeSetBuilder(model);
    const text = b.addEntity({
      owner: MODEL_SPACE,
      layer: LAYER_0,
      geom: {
        kind: 'MTEXT',
        contents: 'NOTE',
        style: '11',
        position: { x: 0, y: 0 },
        height: 2.5,
        width: 0,
        rotation: 0,
        attachment: 1,
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      },
    });
    const xline = b.addEntity({
      owner: MODEL_SPACE,
      layer: LAYER_0,
      geom: { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 1 } },
    });
    const ray = b.addEntity({
      owner: MODEL_SPACE,
      layer: LAYER_0,
      geom: { kind: 'RAY', base: { x: 0, y: -50 }, direction: { x: 1, y: 0 } },
    });
    const cs = b.build();
    model.apply(cs);
    const index = SpatialIndex.build(model, { tol });
    expect(sorted(index.query(MODEL_SPACE, box(1000, 990, 1001, 1010)))).toEqual(
      sorted([text.id, xline.id]),
    );
    expect(sorted(index.query(MODEL_SPACE, box(1000, -1010, 1001, -990)))).toEqual([text.id]);
    expect(sorted(index.query(MODEL_SPACE, box(1000, -51, 1001, -49)))).toEqual(
      sorted([text.id, ray.id]),
    );
    // Behind the ray's base.
    expect(sorted(index.query(MODEL_SPACE, box(-1001, -51, -1000, -49)))).toEqual([text.id]);
    // Vertical and horizontal construction lines take the axis-parallel paths.
    const b2 = new ChangeSetBuilder(model);
    const vertical = b2.addEntity({
      owner: MODEL_SPACE,
      layer: LAYER_0,
      geom: { kind: 'RAY', base: { x: 500, y: 0 }, direction: { x: 0, y: -1 } },
    });
    const cs2 = b2.build();
    model.apply(cs2);
    index.apply(cs2);
    expect(index.query(MODEL_SPACE, box(499, -20, 501, -10))).toContain(vertical.id);
    expect(index.query(MODEL_SPACE, box(499, 10, 501, 20))).not.toContain(vertical.id);
    expect(index.query(MODEL_SPACE, box(502, -20, 503, -10))).not.toContain(vertical.id);
    // A block holding a construction line has unknown extents.
    const b3 = new ChangeSetBuilder(model);
    b3.addEntity({
      owner: BLOCK_A,
      layer: LAYER_0,
      geom: { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 0, y: 1 } },
    });
    const cs3 = b3.build();
    model.apply(cs3);
    index.apply(cs3);
    expect(index.extents(BLOCK_A)).toBe('unknown');
    expect(index.bounds(idOf(model, '52'))).toEqual({ kind: 'unknown' });
  });

  it('uses injected annotation bounds for text', () => {
    const model = blockModel();
    const b = new ChangeSetBuilder(model);
    const text = b.addEntity({
      owner: MODEL_SPACE,
      layer: LAYER_0,
      geom: {
        kind: 'TEXT',
        value: 'A',
        style: '11',
        position: { x: 40, y: 40 },
        height: 2,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
      },
    });
    model.apply(b.build());
    const index = SpatialIndex.build(model, {
      tol,
      annotationBounds: (g) =>
        'kind' in g && g.kind === 'TEXT' ? box(40, 40, 41.5, 42) : undefined,
    });
    expect(index.query(MODEL_SPACE, box(41, 41, 45, 45))).toEqual([text.id]);
    expect(index.query(MODEL_SPACE, box(42, 41, 45, 45))).toEqual([]);
  });

  it('re-bounds text and the inserts holding it when fonts or text styles change (M1-35)', () => {
    const model = blockModel();
    const b = new ChangeSetBuilder(model);
    const style = b.addTableRecord('textStyles', {
      name: 'Standard',
      font: 'romans',
      height: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      lastHeight: 2.5,
      generation: 0,
      trueTypeFlags: 0,
    });
    const text = b.addEntity({
      owner: BLOCK_A,
      layer: LAYER_0,
      geom: {
        kind: 'TEXT',
        value: 'A',
        style: style.handle,
        position: { x: 0, y: 0 },
        height: 1,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
      },
    });
    model.apply(b.build());
    // What the injected text engine reports: nothing until a font loads, then `width` wide.
    let width: number | undefined;
    const index = SpatialIndex.build(model, {
      tol,
      annotationBounds: (g) =>
        'kind' in g && g.kind === 'TEXT' && width !== undefined ? box(0, 0, width, 1) : undefined,
    });
    const insert = idOf(model, '52'); // BLOCK_A at (200, 0)
    expect(index.bounds(text.id)).toEqual({ kind: 'unknown' });
    expect(index.bounds(insert)).toEqual({ kind: 'unknown' });

    width = 3; // a font arrived
    index.reboundAnnotations();
    expect(index.bounds(text.id)).toEqual({ kind: 'box', box: box(0, 0, 3, 1) });
    expect(index.bounds(insert)).toEqual({ kind: 'box', box: box(200, 0, 203, 1) });

    width = 5; // the style got wider: applying its change re-bounds on its own
    const b2 = new ChangeSetBuilder(model);
    b2.updateTableRecord('textStyles', style.handle, { widthFactor: 5 / 3 });
    const cs = b2.build();
    model.apply(cs);
    index.apply(cs);
    expect(index.bounds(insert)).toEqual({ kind: 'box', box: box(200, 0, 205, 1) });
    expect(index.query(MODEL_SPACE, box(204, 0.5, 210, 2))).toEqual([insert]);
  });
});

describe('invalidation', () => {
  it('moves an entity in the tree when it is updated, and drops it when removed', () => {
    const model = blockModel();
    const index = SpatialIndex.build(model, { tol });
    const line = idOf(model, '50');
    const b = new ChangeSetBuilder(model);
    b.updateEntity(line, { geom: lineGeom(1000, 1000, 1001, 1001) });
    const cs = b.build();
    model.apply(cs);
    index.apply(cs);
    expect(index.query(MODEL_SPACE, box(-1, -1, 5, 5))).toEqual([]);
    expect(index.query(MODEL_SPACE, box(1000.5, 1000.5, 1002, 1002))).toEqual([line]);
    const b2 = new ChangeSetBuilder(model);
    b2.removeEntity(line);
    const cs2 = b2.build();
    model.apply(cs2);
    index.apply(cs2);
    expect(index.query(MODEL_SPACE, box(1000.5, 1000.5, 1002, 1002))).toEqual([]);
    expect(index.bounds(line)).toBeUndefined();
  });

  it('re-bounds every reference, through nesting, when a block definition changes', () => {
    const model = blockModel();
    const index = SpatialIndex.build(model, { tol });
    const b = new ChangeSetBuilder(model);
    // Stretch A's line to x = 50: A at (200, 0) now reaches 250; B (A at +10) at 300 reaches 360.
    b.updateEntity(idOf(model, '40'), { geom: lineGeom(0, 0, 50, 0) });
    const cs = b.build();
    model.apply(cs);
    index.apply(cs);
    expect(index.query(MODEL_SPACE, box(240, -1, 241, 1))).toEqual([idOf(model, '52')]);
    expect(index.query(MODEL_SPACE, box(355, -1, 356, 1))).toEqual([idOf(model, '53')]);
    expect(index.extents(BLOCK_B)).toEqual(box(10, 0, 60, 0));
    // Undo: the inverse change set puts every bound back.
    const undo = new ChangeSetBuilder(model);
    undo.updateEntity(idOf(model, '40'), { geom: lineGeom(0, 0, 1, 0) });
    const ucs = undo.build();
    model.apply(ucs);
    index.apply(ucs);
    expect(index.query(MODEL_SPACE, box(240, -1, 241, 1))).toEqual([]);
    expect(index.query(MODEL_SPACE, box(355, -1, 356, 1))).toEqual([]);
  });

  it('re-bounds a dimension when its *D block changes', () => {
    const model = blockModel();
    const b = new ChangeSetBuilder(model);
    const dim = b.addEntity({
      owner: MODEL_SPACE,
      layer: LAYER_0,
      geom: {
        kind: 'DIMENSION',
        dimType: 'linear',
        style: '27',
        block: DIM_BLOCK,
        definitionPoint: { x: 0, y: 5 },
        textPosition: { x: 5, y: 6 },
        textUserPositioned: false,
        text: '',
        textRotation: 0,
        horizontalDirection: 0,
        attachment: 5,
        lineSpacingStyle: 1,
        lineSpacing: 1,
        first: { x: 0, y: 0 },
        second: { x: 10, y: 0 },
      },
    });
    model.apply(b.build());
    const index = SpatialIndex.build(model, { tol });
    expect(index.query(MODEL_SPACE, box(10.5, 6.5, 10.6, 6.6))).toEqual([dim.id]);
    const b2 = new ChangeSetBuilder(model);
    b2.updateEntity(idOf(model, '42'), { geom: lineGeom(-1, -1, 5, 3) });
    const cs = b2.build();
    model.apply(cs);
    index.apply(cs);
    expect(index.query(MODEL_SPACE, box(10.5, 6.5, 10.6, 6.6))).toEqual([]);
  });

  it('re-bounds a table when its *T block changes (M1-17)', () => {
    // The block (here the *D1 block's line, (−1, −1)–(11, 7)) placed at the table's insertion
    // point (100, 0); shrinking the line to (5, 3) pulls the table's far corner in.
    const model = blockModel();
    const b = new ChangeSetBuilder(model);
    const table = b.addEntity({
      owner: MODEL_SPACE,
      layer: LAYER_0,
      geom: {
        kind: 'ACAD_TABLE',
        block: DIM_BLOCK,
        position: { x: 100, y: 0 },
        direction: { x: 1, y: 0 },
        rowHeights: [1],
        columnWidths: [1],
        cells: [],
      },
    });
    model.apply(b.build());
    const index = SpatialIndex.build(model, { tol });
    expect(index.bounds(table.id)).toEqual({ kind: 'box', box: box(99, -1, 111, 7) });
    const b2 = new ChangeSetBuilder(model);
    b2.updateEntity(idOf(model, '42'), { geom: lineGeom(-1, -1, 5, 3) });
    const cs = b2.build();
    model.apply(cs);
    index.apply(cs);
    expect(index.bounds(table.id)).toEqual({ kind: 'box', box: box(99, -1, 105, 3) });
  });

  it('follows an entity moved to another block', () => {
    const model = blockModel();
    const index = SpatialIndex.build(model, { tol });
    const b = new ChangeSetBuilder(model);
    b.moveEntity(idOf(model, '51'), PAPER_SPACE);
    const cs = b.build();
    model.apply(cs);
    index.apply(cs);
    expect(index.query(MODEL_SPACE, box(99, 99, 101, 101))).toEqual([]);
    expect(index.query(PAPER_SPACE, box(99, 99, 101, 101))).toEqual([idOf(model, '51')]);
  });

  it('matches a fresh build and a brute-force scan after any sequence of edits', () => {
    type Op =
      | { op: 'add'; block: number; geom: EntityGeometry }
      | {
          op: 'addInsert';
          block: number;
          ref: number;
          x: number;
          y: number;
          rotation: number;
          sx: number;
        }
      | { op: 'move'; pick: number; dx: number; dy: number }
      | { op: 'remove'; pick: number }
      | { op: 'reown'; pick: number; block: number };
    const coord = fc.integer({ min: -500, max: 500 });
    const geomArb: fc.Arbitrary<EntityGeometry> = fc.oneof(
      fc.tuple(coord, coord, coord, coord).map(([a, b, c, d]) => lineGeom(a, b, c, d)),
      fc
        .tuple(coord, coord, fc.integer({ min: 0, max: 50 }))
        .map(([x, y, r]) => circleGeom(x, y, r)),
    );
    const anyBlock = fc.integer({ min: 0, max: 3 }); // MS, PS, A, B
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ op: fc.constant('add' as const), block: anyBlock, geom: geomArb }),
      fc.record({
        op: fc.constant('addInsert' as const),
        block: fc.integer({ min: 0, max: 1 }),
        ref: fc.integer({ min: 0, max: 1 }),
        x: coord,
        y: coord,
        rotation: fc.double({ min: 0, max: 6.3, noNaN: true }),
        sx: fc.constantFrom(1, 2, -1),
      }),
      fc.record({ op: fc.constant('move' as const), pick: fc.nat(), dx: coord, dy: coord }),
      fc.record({ op: fc.constant('remove' as const), pick: fc.nat() }),
      fc.record({ op: fc.constant('reown' as const), pick: fc.nat(), block: anyBlock }),
    );
    const blocks = [MODEL_SPACE, PAPER_SPACE, BLOCK_A, BLOCK_B];
    const queryArb = fc
      .tuple(coord, coord, fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }))
      .map(([x, y, w, h]) => box(x, y, x + w, y + h));

    fc.assert(
      fc.property(
        fc.array(fc.array(opArb, { minLength: 1, maxLength: 4 }), { maxLength: 12 }),
        fc.array(queryArb, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 1, max: 8 }),
        (steps, queries, maxPending) => {
          const model = blockModel();
          const index = SpatialIndex.build(model, { tol, maxPending });
          for (const step of steps) {
            const b = new ChangeSetBuilder(model);
            for (const o of step) {
              // Only plain curves are edited or moved, so no block can come to contain itself.
              const editable = blocks
                .flatMap((h) => b.blockEntities(h))
                .filter((id) => b.entity(id)?.geom.kind !== 'INSERT');
              const pick = (n: number) => editable[n % editable.length];
              if (o.op === 'add') {
                b.addEntity({ owner: blocks[o.block]!, layer: LAYER_0, geom: o.geom });
              } else if (o.op === 'addInsert') {
                b.addEntity({
                  owner: blocks[o.block]!,
                  layer: LAYER_0,
                  geom: insertGeom(o.ref === 0 ? BLOCK_A : BLOCK_B, o.x, o.y, {
                    rotation: o.rotation,
                    scale: { x: o.sx, y: 1, z: 1 },
                  }),
                });
              } else if (editable.length > 0) {
                const id = pick(o.pick)!;
                if (o.op === 'remove') b.removeEntity(id);
                else if (o.op === 'reown') b.moveEntity(id, blocks[o.block]!);
                else {
                  const g = b.entity(id)!.geom;
                  const geom =
                    g.kind === 'LINE'
                      ? lineGeom(g.start.x + o.dx, g.start.y + o.dy, g.end.x + o.dx, g.end.y + o.dy)
                      : g.kind === 'CIRCLE'
                        ? circleGeom(g.center.x + o.dx, g.center.y + o.dy, g.radius)
                        : g;
                  b.updateEntity(id, { geom });
                }
              }
            }
            const cs = b.build();
            model.apply(cs);
            index.apply(cs);
          }
          const fresh = SpatialIndex.build(model, { tol });
          for (const h of blocks) {
            expect(index.extents(h)).toEqual(fresh.extents(h));
            for (const q of queries) {
              const expected = sorted(bruteQuery(model, h, q));
              expect(sorted(index.query(h, q))).toEqual(expected);
              expect(sorted(fresh.query(h, q))).toEqual(expected);
            }
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});
