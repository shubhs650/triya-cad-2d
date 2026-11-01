import { describe, expect, it } from 'vitest';
import { PINNED_INSTANT, withPinnedClock } from './clock.ts';

describe('withPinnedClock', () => {
  it('pins argument-less dates and Date.now while the callback runs', () => {
    const [d, now] = withPinnedClock(() => [new Date(), Date.now()] as const);
    expect(d.getTime()).toBe(PINNED_INSTANT);
    expect(now).toBe(PINNED_INSTANT);
  });

  it('leaves explicit dates and instanceof intact', () => {
    const d = withPinnedClock(() => new Date(Date.UTC(2022, 1, 21)));
    expect(d.toISOString()).toBe('2022-02-21T00:00:00.000Z');
    expect(d instanceof Date).toBe(true);
  });

  it('restores the real clock afterwards, also when the callback throws', () => {
    expect(() =>
      withPinnedClock(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(Date.now()).toBeGreaterThan(PINNED_INSTANT);
    expect(new Date().getTime()).toBeGreaterThan(PINNED_INSTANT);
  });
});
