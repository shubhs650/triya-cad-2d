// M3-04 part 3: selection cycling's Selection list waits for the drafter: the object clicked,
// or none when the list is dismissed or another list replaces it.
import type { EntityId } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { selectionList } from '../src/selection-list';

const request = {
  candidates: [
    { id: 4 as EntityId, label: 'Line' },
    { id: 9 as EntityId, label: 'Circle' },
  ],
  at: { x: 100, y: 80 },
};

describe('selectionList', () => {
  it('answers with the object chosen, and closes', async () => {
    const seen: unknown[] = [];
    const off = selectionList.subscribe(() => seen.push(selectionList.get()?.doc));
    const reply = selectionList.show(2, request);
    expect(selectionList.get()).toEqual({ doc: 2, request });
    selectionList.close(9 as EntityId);
    expect(await reply).toEqual({ ok: true, ids: [9] });
    expect(selectionList.get()).toBeUndefined();
    expect(seen).toEqual([2, undefined]);
    off();
  });

  it('answers none when dismissed, or when another list opens', async () => {
    const first = selectionList.show(1, request);
    const second = selectionList.show(1, request);
    expect(await first).toEqual({ ok: true, ids: [] });
    selectionList.close();
    expect(await second).toEqual({ ok: true, ids: [] });
  });
});
