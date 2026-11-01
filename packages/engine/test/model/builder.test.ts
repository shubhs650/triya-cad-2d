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
