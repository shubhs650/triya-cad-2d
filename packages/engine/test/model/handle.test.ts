import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareHandles,
  HandleAllocator,
  isHandle,
  NULL_HANDLE,
  normalizeHandle,
} from '../../src/model/index';

describe('normalizeHandle', () => {
  it.each([
    ['1f', '1F'],
    ['001F', '1F'],
    ['0', '0'],
    ['000', '0'],
    ['ffffffffffffffff', 'FFFFFFFFFFFFFFFF'],
    ['  2A ', '2A'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeHandle(input)).toBe(expected);
  });

  it.each(['', 'G1', '-1', '1 2', '0x1F', '10000000000000000'])('rejects %j', (input) => {
    expect(() => normalizeHandle(input)).toThrow(/handle/i);
  });

  it('is idempotent and accepts what isHandle accepts', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), (n) => {
        const h = normalizeHandle(n.toString(16));
        expect(isHandle(h)).toBe(true);
        expect(normalizeHandle(h)).toBe(h);
      }),
    );
  });
});

describe('isHandle', () => {
  it('accepts only canonical upper-case hex without leading zeros', () => {
    expect(isHandle('1F')).toBe(true);
    expect(isHandle('0')).toBe(true);
    expect(isHandle('1f')).toBe(false);
    expect(isHandle('01F')).toBe(false);
    expect(isHandle('')).toBe(false);
    expect(isHandle('10000000000000000')).toBe(false);
  });
});

describe('compareHandles', () => {
  it('orders numerically, not lexically', () => {
    expect(compareHandles('F', '10')).toBeLessThan(0);
    expect(compareHandles('10', 'F')).toBeGreaterThan(0);
    expect(compareHandles('2A', '2A')).toBe(0);
    expect(['10', '2', 'A', '1'].sort(compareHandles)).toEqual(['1', '2', 'A', '10']);
  });
});

describe('HandleAllocator', () => {
  it('hands out $HANDSEED first, then counts up in hex', () => {
    const a = new HandleAllocator('1F');
    expect(a.allocate()).toBe('1F');
    expect(a.allocate()).toBe('20');
    expect(a.handSeed).toBe('21');
  });

  it('never returns an existing handle when the file seed is stale', () => {
    // A $HANDSEED at or below a used handle happens in damaged files; AutoCAD's AUDIT raises
    // the seed rather than reusing a handle, so Triya does the same.
    const a = new HandleAllocator('10', ['5', '2A', 'C']);
    expect(a.seedWasRaised).toBe(true);
    expect(a.allocate()).toBe('2B');
  });

  it('keeps a correct seed as is', () => {
    const a = new HandleAllocator('2B', ['5', '2A']);
    expect(a.seedWasRaised).toBe(false);
    expect(a.handSeed).toBe('2B');
  });

  it('never allocates the null handle', () => {
    const a = new HandleAllocator(NULL_HANDLE);
    expect(a.allocate()).toBe('1');
  });

  it('observe() raises the seed above a handle that entered from elsewhere', () => {
    const a = new HandleAllocator('10');
    a.observe('40');
    a.observe('8');
    expect(a.allocate()).toBe('41');
  });

  it('refuses to run past the 64-bit handle space', () => {
    const a = new HandleAllocator('FFFFFFFFFFFFFFFF');
    expect(a.allocate()).toBe('FFFFFFFFFFFFFFFF');
    expect(() => a.allocate()).toThrow(/exhausted/);
  });

  it('allocates strictly increasing, unique handles above every existing one', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 2n ** 40n }), { maxLength: 20 }),
        fc.bigInt({ min: 0n, max: 2n ** 40n }),
        fc.integer({ min: 1, max: 50 }),
        (existing, seed, count) => {
          const hs = existing.map((n) => n.toString(16).toUpperCase());
          const a = new HandleAllocator(seed.toString(16).toUpperCase(), hs);
          const out = Array.from({ length: count }, () => a.allocate());
          expect(new Set(out).size).toBe(count);
          for (const h of out) {
            for (const e of hs) expect(compareHandles(h, e)).toBeGreaterThan(0);
            expect(compareHandles(h, a.handSeed)).toBeLessThan(0);
          }
          for (let i = 1; i < out.length; i++) {
            expect(compareHandles(out[i - 1]!, out[i]!)).toBeLessThan(0);
          }
        },
      ),
    );
  });
});
