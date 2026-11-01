import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EntityIdMap, NO_ENTITY } from '../../src/model/index';

describe('EntityIdMap', () => {
  it('assigns dense ids from 1 in first-seen order; 0 means "no entity"', () => {
    const m = new EntityIdMap();
    expect(m.assign('2A')).toBe(1);
    expect(m.assign('1F')).toBe(2);
    expect(m.assign('2A')).toBe(1);
    expect(m.size).toBe(2);
    expect(NO_ENTITY).toBe(0);
  });

  it('maps both ways', () => {
    const m = new EntityIdMap();
    const id = m.assign('2A');
    expect(m.idOf('2A')).toBe(id);
    expect(m.handleOf(id)).toBe('2A');
    expect(m.idOf('99')).toBeUndefined();
    expect(m.handleOf(0)).toBeUndefined();
    expect(m.handleOf(77)).toBeUndefined();
  });

  it('rejects non-canonical handles so lookups cannot silently miss', () => {
    const m = new EntityIdMap();
    expect(() => m.assign('2a')).toThrow(/canonical/);
    expect(() => m.assign('0')).toThrow(/null handle/);
  });

  it('is a bijection and never reuses an id', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: 1n, max: 5000n }), { maxLength: 200 }), (ns) => {
        const m = new EntityIdMap();
        const hs = ns.map((n) => n.toString(16).toUpperCase());
        const ids = hs.map((h) => m.assign(h));
        const distinct = new Set(hs);
        expect(m.size).toBe(distinct.size);
        expect(new Set(ids).size).toBe(distinct.size);
        hs.forEach((h, i) => {
          expect(m.handleOf(ids[i]!)).toBe(h);
          expect(m.idOf(h)).toBe(ids[i]);
        });
        expect(Math.max(0, ...ids)).toBe(distinct.size);
      }),
    );
  });
});
