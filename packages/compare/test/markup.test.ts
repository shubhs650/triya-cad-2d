// M8-06: the compare drawing COMPARE shows (DEC-092): the revision with every object coloured by
// what the compare found, and the original's removed objects and the previous versions of the
// modified ones pasted in red; and the filters that show part of it.
import { describe, expect, it } from 'vitest';
import type { Color, DocumentModel, EntityInit, Handle } from '@triya/engine';
import {
  COMPARE_COLORS,
  compareDrawings,
  compareMarkup,
  itemShown,
  marksShown,
  type CompareFilter,
} from '../src/index';
import { PAPER, WALLS, circle, drawing, ent, line, text } from './drawings';

const ORIGINAL: readonly EntityInit[] = [
  ent('A1', line(0, 0, 100, 0)),
  ent('A2', line(100, 0, 100, 50), { layer: WALLS }),
  ent('A3', circle(50, 25, 10)),
  ent('A4', circle(80, 25, 5)),
  ent('A5', text('REV A')),
];

/** A2 erased, A3 moved, A4 to another layer, A5 reworded, A6 drawn. */
const REVISION: readonly EntityInit[] = [
  ent('A1', line(0, 0, 100, 0)),
  ent('A3', circle(60, 25, 10)),
  ent('A4', circle(80, 25, 5), { layer: WALLS }),
  ent('A5', text('REV B')),
  ent('A6', line(0, 50, 100, 50)),
];

function markup(a: DocumentModel, b: DocumentModel) {
  const m = compareMarkup(a, b, compareDrawings(a, b));
  b.apply(m.change);
  return m;
}

const colorOf = (model: DocumentModel, h: Handle): Color | undefined =>
  model.entityByHandle(h)?.color;

const ALL: CompareFilter = { statuses: ['added', 'removed', 'modified'], unchanged: true };

describe('compareMarkup (M8-06)', () => {
  it('colours the revision and pastes what it removed and the previous versions in red', () => {
    const a = drawing({ entities: ORIGINAL });
    const b = drawing({ entities: REVISION });
    const m = markup(a, b);
    expect(colorOf(b, 'A1')).toEqual(COMPARE_COLORS.unchanged);
    expect(colorOf(b, 'A3')).toEqual(COMPARE_COLORS.modified);
    expect(colorOf(b, 'A4')).toEqual(COMPARE_COLORS.modified);
    expect(colorOf(b, 'A5')).toEqual(COMPARE_COLORS.modified);
    expect(colorOf(b, 'A6')).toEqual(COMPARE_COLORS.added);
    expect(COMPARE_COLORS).toEqual({
      added: { kind: 'aci', index: 3 },
      removed: { kind: 'aci', index: 1 },
      modified: { kind: 'aci', index: 40 },
      previous: { kind: 'aci', index: 1 },
      unchanged: { kind: 'aci', index: 8 },
    });

    const byA = new Map(m.items.map((i) => [i.a ?? i.b, i]));
    // The erased line is back as a red copy, on its own layer, with a handle of the revision's.
    const removed = byA.get('A2')!;
    expect(removed.status).toBe('removed');
    expect(removed.layer).toBe('Walls');
    expect(removed.marks).toHaveLength(1);
    const copy = b.entityByHandle(removed.marks[0]!)!;
    expect(copy.geom).toEqual(line(100, 0, 100, 50));
    expect(copy.color).toEqual(COMPARE_COLORS.removed);
    expect(b.tables.layers.get(copy.layer)?.name).toBe('Walls');
    // Moved and reworded: the revision's in amber, the original's beside it in red.
    for (const h of ['A3', 'A5']) {
      const item = byA.get(h)!;
      expect(item.marks[0]).toBe(h);
      expect(item.marks).toHaveLength(2);
      const previous = b.entityByHandle(item.marks[1]!)!;
      // (These drawings have no text style table, so the copy's style reference goes.)
      const { style: _style, ...geom } = a.entityByHandle(h)!.geom as { style?: string };
      expect(previous.geom).toMatchObject(geom);
      expect(previous.color).toEqual(COMPARE_COLORS.previous);
    }
    // Only its layer changed: nothing to show beside it.
    expect(byA.get('A4')!.marks).toEqual(['A4']);
    expect(byA.get('A4')!.layer).toBe('Walls');
    expect(byA.get('A6')!.marks).toEqual(['A6']);
    // Every object the drawing shows is marked once: four of the revision's, the three copies.
    expect(m.marks.map((k) => k.status).sort()).toEqual(
      [
        'added',
        'modified',
        'modified',
        'modified',
        'previous',
        'previous',
        'removed',
        'unchanged',
      ].sort(),
    );
  });

  it('never renumbers the revision: copies take handles above its seed', () => {
    const a = drawing({ entities: ORIGINAL });
    const b = drawing({ entities: REVISION });
    const before = [...b.entities()].map((e) => e.handle).sort();
    const m = markup(a, b);
    const copies = m.marks.filter((k) => k.status === 'removed' || k.status === 'previous');
    for (const k of copies) {
      expect(before).not.toContain(k.handle);
      expect(parseInt(k.handle, 16)).toBeGreaterThanOrEqual(0x9000);
    }
    for (const h of before) expect(b.entityByHandle(h)?.handle).toBe(h);
  });

  it('pastes what a layout lost into the revision’s layout of that name, and lists what it cannot show', () => {
    const paper = (h: string, x: number) => ent(h, line(x, 0, x, 10), { owner: PAPER });
    const a = drawing({ entities: [paper('C1', 0), paper('C2', 5)], layouts: ['Sheet'] });
    const b = drawing({ entities: [paper('C1', 0)], layouts: ['SHEET'] });
    const m = markup(a, b);
    expect(m.items).toHaveLength(1);
    const lost = m.items[0]!;
    expect(lost.space).toBe('Sheet');
    expect(b.entityByHandle(lost.marks[0]!)?.owner).toBe(PAPER);

    const gone = drawing({ entities: [], layouts: ['Other'] });
    const g = markup(a, gone);
    // The revision has no layout Sheet to show them in.
    expect(g.items.map((i) => [i.status, i.marks.length])).toEqual([
      ['removed', 0],
      ['removed', 0],
    ]);
  });

  it('keeps the drawings it was given untouched', () => {
    const a = drawing({ entities: ORIGINAL });
    const b = drawing({ entities: REVISION });
    const m = compareMarkup(a, b, compareDrawings(a, b));
    expect(Object.keys(m.change).length).toBeGreaterThan(0);
    expect(colorOf(b, 'A6')).toEqual({ kind: 'byLayer' });
    expect([...a.entities()]).toHaveLength(5);
  });
});

describe('compare filters (M8-06)', () => {
  const a = drawing({ entities: ORIGINAL });
  const b = drawing({ entities: REVISION });
  const m = markup(a, b);
  const shown = (f: CompareFilter) => new Set(marksShown(m, f).shown);

  it('shows everything with every status on', () => {
    const r = marksShown(m, ALL);
    expect(r.hidden).toEqual([]);
    expect(r.shown).toHaveLength(m.marks.length);
    expect(m.items.every((i) => itemShown(i, ALL))).toBe(true);
  });

  it('narrows by status: the previous versions go with the modified objects', () => {
    const f: CompareFilter = { statuses: ['modified'], unchanged: false };
    const s = shown(f);
    for (const k of m.marks) {
      expect(s.has(k.handle)).toBe(k.status === 'modified' || k.status === 'previous');
    }
    expect(m.items.filter((i) => itemShown(i, f)).map((i) => i.b)).toEqual(['A3', 'A4', 'A5']);
    expect(marksShown(m, f).hidden).toContain('A1');
  });

  it('narrows by layer, the case aside, and by type', () => {
    const walls: CompareFilter = { ...ALL, layer: 'WALLS' };
    expect(m.items.filter((i) => itemShown(i, walls)).map((i) => i.a ?? i.b)).toEqual(['A2', 'A4']);
    expect(shown(walls).has('A1')).toBe(false);
    const circles: CompareFilter = { ...ALL, type: 'CIRCLE' };
    expect(m.items.filter((i) => itemShown(i, circles)).map((i) => i.b)).toEqual(['A3', 'A4']);
    // The moved circle's previous version is a circle too.
    expect(shown(circles).size).toBe(3);
  });
});
