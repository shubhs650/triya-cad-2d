import { describe, expect, it } from 'vitest';
import { createEntity, updateEntity, updateRecord, type EntityPatch } from '../../src/model/index';
import { circleGeom, entityInit, layer, lineGeom } from './fixtures';

describe('createEntity', () => {
  it('builds a deeply frozen entity', () => {
    const e = createEntity(7, entityInit('2A', lineGeom(0, 0, 1, 1)));
    expect(e.id).toBe(7);
    expect(e.handle).toBe('2A');
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.geom)).toBe(true);
    if (e.geom.kind !== 'LINE') throw new Error('expected LINE');
    expect(Object.isFrozen(e.geom.start)).toBe(true);
  });

  it('carries binary xdata without trying to freeze typed arrays', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const e = createEntity(
      1,
      entityInit('2A', lineGeom(0, 0, 1, 1), {
        xdata: [{ appId: '12', values: [{ code: 1004, value: bytes }] }],
      }),
    );
    expect(e.xdata?.[0]?.values[0]?.value).toBe(bytes);
    expect(Object.isFrozen(e.xdata)).toBe(true);
  });

  it('rejects a type that does not match the geometry', () => {
    expect(() =>
      createEntity(1, { ...entityInit('2A', lineGeom(0, 0, 1, 1)), type: 'CIRCLE' }),
    ).toThrow(/type CIRCLE does not match geometry LINE/);
  });

  it('rejects non-canonical, null, and bad ids', () => {
    expect(() => createEntity(1, entityInit('2a', lineGeom(0, 0, 1, 1)))).toThrow(/canonical/);
    expect(() => createEntity(1, entityInit('0', lineGeom(0, 0, 1, 1)))).toThrow(/null handle/);
    expect(() => createEntity(0, entityInit('2A', lineGeom(0, 0, 1, 1)))).toThrow(/EntityId/);
    expect(() => createEntity(1.5, entityInit('2A', lineGeom(0, 0, 1, 1)))).toThrow(/EntityId/);
  });
});

describe('updateEntity', () => {
  const base = createEntity(
    3,
    entityInit('2A', lineGeom(0, 0, 1, 1), { xdata: [{ appId: '12', values: [] }] }),
  );

  it('replaces instead of mutating', () => {
    const next = updateEntity(base, { layer: '11', geom: lineGeom(0, 0, 5, 5) });
    expect(next).not.toBe(base);
    expect(next.layer).toBe('11');
    expect(base.layer).toBe('10');
    expect(next.id).toBe(base.id);
    expect(next.handle).toBe(base.handle);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.geom)).toBe(true);
  });

  it('shares untouched values with the previous version', () => {
    const next = updateEntity(base, { color: { kind: 'aci', index: 1 } });
    expect(next.geom).toBe(base.geom);
    expect(next.xdata).toBe(base.xdata);
  });

  it('removes an optional property patched to undefined', () => {
    const next = updateEntity(base, { xdata: undefined });
    expect('xdata' in next).toBe(false);
  });

  it('refuses to change identity, owner or type', () => {
    for (const patch of [{ id: 9 }, { handle: 'FF' }, { owner: '1B' }, { type: 'CIRCLE' }]) {
      expect(() => updateEntity(base, patch as unknown as EntityPatch)).toThrow(/cannot change/);
    }
    expect(() => updateEntity(base, { geom: circleGeom(0, 0, 1) })).toThrow(/does not match/);
  });
});

describe('updateRecord', () => {
  it('replaces a table record and keeps its handle', () => {
    const l = layer('11', 'WALLS');
    const next = updateRecord(l, { frozen: true });
    expect(next).not.toBe(l);
    expect(next.frozen).toBe(true);
    expect(l.frozen).toBe(false);
    expect(Object.isFrozen(next)).toBe(true);
    expect(() => updateRecord(l, { handle: '99' } as never)).toThrow(/cannot change/);
  });
});
