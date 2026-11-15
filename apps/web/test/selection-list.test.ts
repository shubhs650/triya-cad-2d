// M3-04 part 3: selection cycling's Selection list waits for the drafter: the object clicked,
// or none when the list is dismissed or another list replaces it.
import type { EntityId } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { listPlacement, selectionList } from '../src/selection-list';

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

// M3-04 part 7 (AutoCAD 2024 Help, "Selection Cycling Tab (Drafting Settings Dialog Box)"):
// Cursor dependent puts the list in the Quadrant of the pick, Distance in pixels away; Static
// keeps it where the drafter dragged it (by the pick until then); always inside the window.
describe('listPlacement', () => {
  const size = { width: 80, height: 40 };
  const view = { width: 1000, height: 600 };
  const at = { x: 100, y: 300 };
  it('goes in the quadrant of the pick, the distance away', () => {
    const cursor = { at, size, view, location: 0 as const, distance: 25 };
    expect(listPlacement({ ...cursor, quadrant: 'top-right' })).toEqual({ left: 125, top: 235 });
    expect(listPlacement({ ...cursor, quadrant: 'bottom-right' })).toEqual({
      left: 125,
      top: 325,
    });
    // Kept inside the window.
    expect(listPlacement({ ...cursor, quadrant: 'bottom-left' })).toEqual({ left: 0, top: 325 });
    expect(listPlacement({ ...cursor, at: { x: 990, y: 10 }, quadrant: 'top-right' })).toEqual({
      left: 920,
      top: 0,
    });
  });

  it('stays where it was dragged when static', () => {
    const fixed = { at, size, view, location: 1 as const, quadrant: 'top-right' as const };
    expect(listPlacement({ ...fixed, distance: 25, dragged: { left: 400, top: 50 } })).toEqual({
      left: 400,
      top: 50,
    });
    expect(listPlacement({ ...fixed, distance: 25 })).toEqual({ left: 125, top: 235 });
  });
});
