import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DocumentModel } from '../../src/model/index';
import {
  ChangeSetBuilder,
  invertChangeSet,
  isEmptyChangeSet,
  type ChangeSet,
} from '../../src/model/index';
import {
  circleGeom,
  entityAt,
  LAYER_0,
  LAYER_WALLS,
  layer,
  lineGeom,
  MODEL_SPACE,
  PAPER_SPACE,
  sampleModel,
  snapshot,
} from './fixtures';

describe('ChangeSetBuilder', () => {
  it('allocates handles above $HANDSEED and appends to the owner block', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    const e = b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: circleGeom(0, 0, 3) });
    expect(e.handle).toBe('40');
    expect(e.id).toBe(5);
    expect(e.type).toBe('CIRCLE');
    expect(e.color).toEqual({ kind: 'byLayer' });
    expect(e.linetype).toBe('ByLayer');
    expect(e.lineweight).toBe('ByLayer');
    expect(e.transparency).toBe('ByLayer');
    expect(e.ltScale).toBe(1);
    expect(e.visible).toBe(true);
    const cs = b.build();
    expect(cs.entities?.added).toEqual([{ entity: e, index: 3 }]);
    m.apply(cs);
    expect(m.blockEntities(MODEL_SPACE)).toEqual([1, 2, 3, 5]);
    expect(m.handSeed).toBe('41');
  });

  it('indexes several additions against the block after removals', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    b.removeEntity(1);
    const x = b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: lineGeom(0, 0, 1, 0) });
    const y = b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: lineGeom(0, 0, 2, 0) });
    const cs = b.build();
    expect(cs.entities?.removed).toEqual([{ entity: entityAt(m, MODEL_SPACE, 0), index: 0 }]);
    expect(cs.entities?.added?.map((a) => a.index)).toEqual([2, 3]);
    m.apply(cs);
    expect(m.blockEntities(MODEL_SPACE)).toEqual([2, 3, x.id, y.id]);
  });

  it('folds an update of a new entity into its addition', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    const e = b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: circleGeom(0, 0, 3) });
    const e2 = b.updateEntity(e.id, { layer: LAYER_WALLS });
    const cs = b.build();
    expect(cs.entities?.added).toEqual([{ entity: e2, index: 3 }]);
    expect(cs.entities?.updated ?? []).toEqual([]);
  });

  it('drops an entity added and removed in the same change set', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    const e = b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: circleGeom(0, 0, 3) });
    b.removeEntity(e.id);
    expect(isEmptyChangeSet(b.build())).toBe(true);
    // The handle stays burned, as in AutoCAD.
    expect(m.handSeed).toBe('41');
  });

  it('keeps the first "before" across repeated updates, and removal wins over update', () => {
    const m = sampleModel();
    const original = entityAt(m, MODEL_SPACE, 1);
    const b = new ChangeSetBuilder(m);
    b.updateEntity(original.id, { ltScale: 2 });
    const last = b.updateEntity(original.id, { ltScale: 3 });
    expect(b.entity(original.id)).toBe(last);
    let cs = b.build();
    expect(cs.entities?.updated).toEqual([{ before: original, after: last }]);

    const b2 = new ChangeSetBuilder(m);
    b2.updateEntity(original.id, { ltScale: 2 });
    b2.removeEntity(original.id);
    expect(b2.entity(original.id)).toBeUndefined();
    cs = b2.build();
    expect(cs.entities?.updated ?? []).toEqual([]);
    expect(cs.entities?.removed).toEqual([{ entity: original, index: 1 }]);
  });

  it('moves an entity between blocks keeping its handle and id', () => {
    const m = sampleModel();
    const e = entityAt(m, MODEL_SPACE, 0);
    const b = new ChangeSetBuilder(m);
    const moved = b.moveEntity(e.id, PAPER_SPACE);
    m.apply(b.build());
    expect(moved.handle).toBe(e.handle);
    expect(moved.id).toBe(e.id);
    expect(m.blockEntities(PAPER_SPACE)).toEqual([4, e.id]);
    expect(m.blockEntities(MODEL_SPACE)).toEqual([2, 3]);
  });

  it('records header changes once, and drops a change set back to the original value', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    b.setHeader('$LTSCALE', 2);
    b.setHeader('$LTSCALE', 3);
    b.setHeader('$CLAYER', undefined);
    b.setHeader('$EXTMIN', { x: 0, y: 0, z: 0 });
    expect(b.build().header).toEqual([
      { name: '$LTSCALE', before: 1, after: 3 },
      { name: '$CLAYER', before: 'WALLS', after: undefined },
    ]);
  });

  it('adds, updates and removes table records and objects by handle', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    const hidden = b.addTableRecord('layers', { ...layer('', 'HIDDEN') });
    expect(hidden.handle).toBe('40');
    b.updateTableRecord('layers', LAYER_WALLS, { locked: true });
    const xr = b.addObject({ type: 'XRECORD', owner: 'C' });
    b.updateObject(xr.handle, { owner: '0' });
    b.removeObject('C');
    const cs = b.build();
    m.apply(cs);
    expect(m.tables.layers.get('40')?.name).toBe('HIDDEN');
    expect(m.tables.layers.get(LAYER_WALLS)?.locked).toBe(true);
    expect(m.objects.get(xr.handle)?.owner).toBe('0');
    expect(m.objects.has('C')).toBe(false);
    m.apply(invertChangeSet(cs));
    expect(m.tables.layers.has('40')).toBe(false);
    expect(m.objects.has('C')).toBe(true);
  });

  it('updates layouts by handle, keeps them in tab order, and undoes the update', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    expect(b.layout('1E')?.name).toBe('Layout1');
    b.updateLayout('1E', { name: 'Sheet A' });
    b.updateLayout('1E', { limits: { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } } });
    expect(b.layout('1E')).toMatchObject({ name: 'Sheet A', tabOrder: 1 });
    const cs = b.build();
    expect(cs.layouts?.updated).toHaveLength(1);
    expect(cs.layouts!.updated![0]!.before.name).toBe('Layout1');
    const before = snapshot(m);
    m.apply(cs);
    expect(m.layouts.map((l) => l.name)).toEqual(['Model', 'Sheet A']);
    expect(m.layouts[1]!.limits?.max).toEqual({ x: 420, y: 297 });
    m.apply(invertChangeSet(cs));
    expect(snapshot(m)).toEqual(before);
    expect(isEmptyChangeSet({ layouts: { updated: [] } })).toBe(true);
    expect(isEmptyChangeSet(cs)).toBe(false);
  });

  it('reorders layouts when their tab order changes', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    // Tab order is what orders them; Model stays first only by its own tab order.
    b.updateLayout('22', { tabOrder: 2 });
    m.apply(b.build());
    expect(m.layouts.map((l) => l.name)).toEqual(['Layout1', 'Model']);
  });

  it('adds a layout with its own paper space block and undoes it (LAYOUT New)', () => {
    const m = sampleModel();
    const before = snapshot(m);
    const b = new ChangeSetBuilder(m);
    const limits = { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } };
    const sheet = b.addLayout({ name: 'Sheet 2', limits });
    // The block record first, then the layout: AutoCAD numbers the next paper space block
    // after the ones the drawing has, and the record links back to its layout.
    expect(sheet).toEqual({
      handle: '41',
      name: 'Sheet 2',
      tabOrder: 2,
      blockRecord: '40',
      flags: 1,
      limits,
    });
    expect(b.layout('41')).toBe(sheet);
    expect(b.tableRecord('blockRecords', '40')).toEqual({
      handle: '40',
      name: '*Paper_Space0',
      layout: '41',
      units: 0,
      explodable: true,
      scalable: true,
    });
    expect(b.block('40')).toEqual({
      handle: '40',
      name: '*Paper_Space0',
      basePoint: { x: 0, y: 0 },
    });
    const third = b.addLayout({ name: 'Sheet 3', tabOrder: 1 });
    expect(third).toMatchObject({ tabOrder: 1, blockRecord: '42' });
    expect(b.tableRecord('blockRecords', '42')?.name).toBe('*Paper_Space1');
    const e = b.addEntity({ owner: '40', layer: LAYER_0, geom: circleGeom(0, 0, 1) });
    const cs = b.build();
    expect(cs.layouts?.added).toEqual([sheet, third]);
    expect(cs.blocks?.added?.map((d) => d.handle)).toEqual(['40', '42']);
    m.apply(cs);
    expect(m.layouts.map((l) => l.name)).toEqual(['Model', 'Layout1', 'Sheet 3', 'Sheet 2']);
    expect(m.blockEntities('40')).toEqual([e.id]);
    m.apply(invertChangeSet(cs));
    expect(snapshot(m)).toEqual(before);
  });

  it('removes a layout with its block and everything on it, and undoes it (LAYOUT Delete)', () => {
    const m = sampleModel();
    const before = snapshot(m);
    const b = new ChangeSetBuilder(m);
    b.removeLayout('1E');
    expect(b.layout('1E')).toBeUndefined();
    expect(b.block(PAPER_SPACE)).toBeUndefined();
    expect(b.tableRecord('blockRecords', PAPER_SPACE)).toBeUndefined();
    expect(() => b.removeLayout('1E')).toThrow(/layout 1E/);
    // Model is not a layout one can delete.
    expect(() => b.removeLayout('22')).toThrow(/the Model layout cannot be removed/);
    const cs = b.build();
    expect(cs.layouts?.removed?.map((l) => l.handle)).toEqual(['1E']);
    expect(cs.entities?.removed?.map((r) => r.entity.handle)).toEqual(['24']);
    m.apply(cs);
    expect(m.layouts.map((l) => l.name)).toEqual(['Model']);
    expect(m.hasBlock(PAPER_SPACE)).toBe(false);
    m.apply(invertChangeSet(cs));
    expect(snapshot(m)).toEqual(before);
  });

  it('moves the tabs after a removed layout up one', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    const two = b.addLayout({ name: 'Sheet 2' });
    b.addLayout({ name: 'Sheet 3' });
    m.apply(b.build());
    const b2 = new ChangeSetBuilder(m);
    b2.removeLayout(two.handle);
    // Its block name stays taken in this change set, so a new sheet does not reuse it.
    expect(m.tables.blockRecords.get(b2.addLayout({ name: 'Sheet 4' }).blockRecord)?.name).toBe(
      undefined,
    );
    m.apply(b2.build());
    expect(m.layouts.map((l) => `${l.tabOrder}:${l.name}`)).toEqual([
      '0:Model',
      '1:Layout1',
      '2:Sheet 3',
      '3:Sheet 4',
    ]);
    expect(m.tables.blockRecords.get(m.layouts[3]!.blockRecord)?.name).toBe('*Paper_Space2');
  });

  it('takes back a layout added in the same change set', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    const sheet = b.addLayout({ name: 'Sheet 2' });
    b.addEntity({ owner: sheet.blockRecord, layer: LAYER_0, geom: circleGeom(0, 0, 1) });
    b.removeLayout(sheet.handle);
    expect(isEmptyChangeSet(b.build())).toBe(true);
  });

  it('adds a block with its record, fills it and undoes it (BLOCK)', () => {
    const m = sampleModel();
    const before = snapshot(m);
    const b = new ChangeSetBuilder(m);
    const def = b.addBlock({ name: 'DOOR', basePoint: { x: 1, y: 2 } });
    expect(def).toEqual({ handle: '40', name: 'DOOR', basePoint: { x: 1, y: 2 } });
    expect(b.block('40')).toBe(def);
    expect(b.tableRecord('blockRecords', '40')).toEqual({
      handle: '40',
      name: 'DOOR',
      units: 0,
      explodable: true,
      scalable: true,
    });
    const e = b.addEntity({ owner: def.handle, layer: LAYER_0, geom: circleGeom(0, 0, 1) });
    expect(b.blockEntities(def.handle)).toEqual([e.id]);
    const cs = b.build();
    expect(cs.blocks?.added).toEqual([def]);
    expect(cs.entities?.added).toEqual([{ entity: e, index: 0 }]);
    m.apply(cs);
    expect(m.blocks.get('40')).toBe(def);
    expect(m.tables.blockRecords.get('40')?.name).toBe('DOOR');
    expect(m.blockEntities('40')).toEqual([e.id]);
    m.apply(invertChangeSet(cs));
    expect(snapshot(m)).toEqual(before);
  });

  it('moves a block base point, renames a block with its record, and removes an empty one', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    const made = b.addBlock({ name: 'TEMP', basePoint: { x: 0, y: 0 }, units: 4, scalable: false });
    expect(b.tableRecord('blockRecords', made.handle)).toMatchObject({ units: 4, scalable: false });
    b.updateBlock(made.handle, { name: 'TEMP2' });
    expect(b.tableRecord('blockRecords', made.handle)?.name).toBe('TEMP2');
    b.removeBlock(made.handle);
    expect(b.block(made.handle)).toBeUndefined();
    b.updateBlock(PAPER_SPACE, { basePoint: { x: 3, y: 4 } });
    b.updateBlock(PAPER_SPACE, { name: '*Paper_Space9' });
    // A block that holds entities cannot go until they do.
    expect(() => b.removeBlock(PAPER_SPACE)).toThrow(/block 1B still holds entities/);
    const cs = b.build();
    expect(cs.blocks?.added).toEqual([]);
    expect(cs.tables?.blockRecords?.added).toEqual([]);
    m.apply(cs);
    expect(m.blocks.get(PAPER_SPACE)).toMatchObject({
      name: '*Paper_Space9',
      basePoint: { x: 3, y: 4 },
    });
    expect(m.tables.blockRecords.get(PAPER_SPACE)?.name).toBe('*Paper_Space9');
    const b2 = new ChangeSetBuilder(m);
    b2.removeEntity(m.blockEntities(PAPER_SPACE)[0]!);
    b2.removeBlock(PAPER_SPACE);
    expect(() =>
      b2.addEntity({ owner: PAPER_SPACE, layer: LAYER_0, geom: circleGeom(0, 0, 1) }),
    ).toThrow(/owner block 1B/);
    m.apply(b2.build());
    expect(m.hasBlock(PAPER_SPACE)).toBe(false);
    expect(m.tables.blockRecords.has(PAPER_SPACE)).toBe(false);
  });

  it('fails fast on unknown targets and after build()', () => {
    const m = sampleModel();
    const b = new ChangeSetBuilder(m);
    expect(() => b.updateEntity(99, { ltScale: 2 })).toThrow(/entity 99/);
    expect(() => b.removeEntity(99)).toThrow(/entity 99/);
    expect(() => b.addEntity({ owner: 'AB', layer: LAYER_0, geom: circleGeom(0, 0, 1) })).toThrow(
      /owner block AB/,
    );
    expect(() => b.updateObject('99', {})).toThrow(/object 99/);
    expect(() => b.removeTableRecord('layers', '99')).toThrow(/layers record 99/);
    expect(() => b.updateLayout('99', { name: 'X' })).toThrow(/layout 99/);
    expect(() => b.updateBlock('99', { name: 'X' })).toThrow(/block 99/);
    expect(() => b.removeBlock('99')).toThrow(/block 99/);
    b.build();
    expect(() => b.setHeader('$X', 1)).toThrow(/already built/);
  });
});

// Random edit scripts: every change set must apply, invert back to the exact starting model,
// and re-apply to the exact same result. Several change sets undo in reverse order.
const op = fc.oneof(
  fc.record({
    kind: fc.constant('add' as const),
    owner: fc.boolean(),
    r: fc.integer({ min: 1, max: 9 }),
  }),
  fc.record({
    kind: fc.constant('update' as const),
    pick: fc.nat(),
    s: fc.integer({ min: 1, max: 9 }),
  }),
  fc.record({ kind: fc.constant('remove' as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant('move' as const), pick: fc.nat() }),
  fc.record({
    kind: fc.constant('header' as const),
    v: fc.option(fc.integer(), { nil: undefined }),
  }),
  fc.record({ kind: fc.constant('layer' as const), frozen: fc.boolean() }),
  fc.record({ kind: fc.constant('block' as const), r: fc.integer({ min: 1, max: 9 }) }),
  fc.record({ kind: fc.constant('base' as const), s: fc.integer({ min: 1, max: 9 }) }),
);

type Op = { kind: string; [k: string]: unknown };

function run(b: ChangeSetBuilder, ops: readonly Op[]): ChangeSetBuilder {
  for (const o of ops) {
    const live = [MODEL_SPACE, PAPER_SPACE].flatMap((h) => b.blockEntities(h));
    const target = live.length ? live[(o.pick as number) % live.length] : undefined;
    switch (o.kind) {
      case 'add':
        b.addEntity({
          owner: o.owner ? MODEL_SPACE : PAPER_SPACE,
          layer: LAYER_0,
          geom: circleGeom(0, 0, o.r as number),
        });
        break;
      case 'update':
        if (target !== undefined) b.updateEntity(target, { ltScale: o.s as number });
        break;
      case 'remove':
        if (target !== undefined) b.removeEntity(target);
        break;
      case 'move':
        if (target !== undefined) {
          const e = b.entity(target)!;
          b.moveEntity(target, e.owner === MODEL_SPACE ? PAPER_SPACE : MODEL_SPACE);
        }
        break;
      case 'header':
        b.setHeader('$LTSCALE', o.v as number | undefined);
        break;
      case 'layer':
        b.updateTableRecord('layers', LAYER_WALLS, { frozen: o.frozen as boolean });
        break;
      case 'block': {
        // BLOCK: a new definition holding one circle.
        const def = b.addBlock({ name: `B${o.r as number}`, basePoint: { x: 0, y: 0 } });
        b.addEntity({ owner: def.handle, layer: LAYER_0, geom: circleGeom(0, 0, o.r as number) });
        break;
      }
      case 'base':
        b.updateBlock(PAPER_SPACE, { basePoint: { x: o.s as number, y: 0 } });
        break;
    }
  }
  return b;
}

const script = (m: DocumentModel, ops: readonly Op[]): ChangeSet =>
  run(new ChangeSetBuilder(m), ops).build();

describe('ChangeSet properties', () => {
  it('apply → invert restores the model exactly; apply again reproduces the result', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        const m = sampleModel();
        const before = snapshot(m);
        const cs = script(m, ops);
        m.apply(cs);
        const after = snapshot(m);
        m.apply(invertChangeSet(cs));
        expect(snapshot(m)).toEqual(before);
        m.apply(cs);
        expect(snapshot(m)).toEqual(after);
      }),
      { numRuns: 300 },
    );
  });

  it('builder view matches the applied model', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        const m = sampleModel();
        const b = run(new ChangeSetBuilder(m), ops);
        const view = [MODEL_SPACE, PAPER_SPACE].map((h) =>
          b.blockEntities(h).map((id) => b.entity(id)),
        );
        m.apply(b.build());
        expect(
          [MODEL_SPACE, PAPER_SPACE].map((h) => m.blockEntities(h).map((id) => m.entity(id))),
        ).toEqual(view);
      }),
      { numRuns: 100 },
    );
  });

  it('a stack of change sets undoes in reverse order', () => {
    fc.assert(
      fc.property(fc.array(fc.array(op, { maxLength: 8 }), { maxLength: 6 }), (scripts) => {
        const m = sampleModel();
        const states = [snapshot(m)];
        const done: ChangeSet[] = [];
        for (const s of scripts) {
          const cs = script(m, s);
          m.apply(cs);
          done.push(cs);
          states.push(snapshot(m));
        }
        for (let i = done.length - 1; i >= 0; i--) {
          m.apply(invertChangeSet(done[i]!));
          expect(snapshot(m)).toEqual(states[i]);
        }
      }),
      { numRuns: 150 },
    );
  });
});
