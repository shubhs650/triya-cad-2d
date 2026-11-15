// M3-04 part 7: selection cycling's badge follows the cursor of the drawing whose canvas says
// it rests over overlapping objects; another drawing's canvas cannot take it away.
import { describe, expect, it } from 'vitest';
import { cyclingBadge } from '../src/cycling-badge';

describe('cyclingBadge', () => {
  it('shows by the cursor of one drawing, and only that drawing hides it', () => {
    const seen: unknown[] = [];
    const off = cyclingBadge.subscribe(() => seen.push(cyclingBadge.get()));
    cyclingBadge.set(1, { x: 10, y: 20 });
    expect(cyclingBadge.get()).toEqual({ doc: 1, x: 10, y: 20 });
    cyclingBadge.set(2, undefined);
    expect(cyclingBadge.get()).toEqual({ doc: 1, x: 10, y: 20 });
    cyclingBadge.set(1, undefined);
    expect(cyclingBadge.get()).toBeUndefined();
    expect(seen).toEqual([{ doc: 1, x: 10, y: 20 }, undefined]);
    off();
  });
});
