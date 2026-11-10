// M1-22: document tabs. Opening adds a tab that shows; closing the showing tab shows the one
// to its right, else the one to its left, as AutoCAD's file tabs do.
import type { ChangeSet, Layout } from '@triya/engine';
import type { OpenResult } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { DocumentStore, layoutsOf, spacesOf, type OpenDocument } from '../src/documents';

const opened = {} as OpenResult;

function storeWith(...names: string[]): DocumentStore {
  const s = new DocumentStore();
  for (const n of names) {
    s.startOpening(n);
    s.opened(n, opened, '1F');
  }
  return s;
}

const names = (s: DocumentStore) => s.getSnapshot().docs.map((d) => d.name);
const showing = (s: DocumentStore) =>
  s.getSnapshot().docs.find((d) => d.id === s.getSnapshot().active)?.name;

describe('DocumentStore', () => {
  it('shows each drawing as it opens', () => {
    const s = storeWith('a.dwg', 'b.dxf');
    expect(names(s)).toEqual(['a.dwg', 'b.dxf']);
    expect(showing(s)).toBe('b.dxf');
    expect(s.getSnapshot().opening).toEqual([]);
  });

  it('closing the showing tab shows its right neighbour, else its left', () => {
    const s = storeWith('a', 'b', 'c');
    const [a, b] = s.getSnapshot().docs;
    s.activate(b!.id);
    s.close(b!.id);
    expect(showing(s)).toBe('c');
    s.close(s.getSnapshot().active!);
    expect(showing(s)).toBe('a');
    s.close(a!.id);
    expect(s.getSnapshot().active).toBeUndefined();
    expect(names(s)).toEqual([]);
  });

  it('closing another tab keeps the showing one', () => {
    const s = storeWith('a', 'b');
    s.close(s.getSnapshot().docs[0]!.id);
    expect(showing(s)).toBe('b');
  });

  it('moves a dragged tab to its new place, keeping the tab that shows (M1-22 part 5)', () => {
    const s = storeWith('a', 'b', 'c', 'd');
    const [a, , c] = s.getSnapshot().docs;
    s.move(a!.id, 2);
    expect(names(s)).toEqual(['b', 'c', 'a', 'd']);
    s.move(c!.id, 0);
    expect(names(s)).toEqual(['c', 'b', 'a', 'd']);
    expect(showing(s)).toBe('d');
    // Past either end goes to that end; an unknown tab or no move changes nothing.
    s.move(c!.id, 99);
    expect(names(s)).toEqual(['b', 'a', 'd', 'c']);
    s.move(c!.id, -5);
    expect(names(s)).toEqual(['c', 'b', 'a', 'd']);
    const before = s.getSnapshot();
    s.move(c!.id, 0);
    s.move(12345, 1);
    expect(s.getSnapshot()).toBe(before);
    // Closing after a move still shows the right neighbour in the new order.
    s.activate(a!.id);
    s.close(a!.id);
    expect(showing(s)).toBe('d');
  });

  it('reports a failed open and clears it on the next open', () => {
    const s = new DocumentStore();
    s.startOpening('x.dwg');
    s.failed('x.dwg', 'x.dwg could not be opened: bad');
    expect(s.getSnapshot()).toMatchObject({ opening: [], error: 'x.dwg could not be opened: bad' });
    s.startOpening('y.dwg');
    expect(s.getSnapshot().error).toBeUndefined();
  });

  it('notifies subscribers until they unsubscribe', () => {
    const s = new DocumentStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.startOpening('a');
    off();
    s.startOpening('b');
    expect(calls).toBe(1);
  });
});

describe('DocumentStore spaces', () => {
  it('switches a document between model space and a layout', () => {
    const s = storeWith('a.dwg');
    const id = s.getSnapshot().docs[0]!.id;
    s.showSpace(id, '58');
    expect(s.getSnapshot().docs[0]!.block).toBe('58');
  });
});

describe('spacesOf (M1-97)', () => {
  const layouts = [
    { handle: 'A', name: 'Model', tabOrder: 0, blockRecord: '1F' },
    { handle: 'B', name: 'Layout1', tabOrder: 1, blockRecord: '1B' },
    { handle: 'C', name: 'Layout2', tabOrder: 2, blockRecord: '50' },
  ];
  const doc = {
    opened: { modelSpace: '1F', init: { layouts } } as unknown as OpenResult,
  } as OpenDocument;
  /** A change set updating layouts, each from its state after the change sets before. */
  const current = new Map<string, Layout>();
  const update = (...patches: [string, Partial<Layout>][]): ChangeSet => ({
    layouts: {
      updated: patches.map(([handle, patch]) => {
        const before = current.get(handle) ?? layouts.find((l) => l.handle === handle)!;
        const after = { ...before, ...patch };
        current.set(handle, after);
        return { before, after };
      }),
    },
  });

  it('lists Model, then the layouts in tab order as opened', () => {
    expect(spacesOf(doc, [])).toEqual([
      { name: 'Model', block: '1F' },
      { name: 'Layout1', block: '1B' },
      { name: 'Layout2', block: '50' },
    ]);
  });

  it('follows the layouts the engine renamed and reordered since', () => {
    const changes = [
      update(['C', { name: 'Plan' }]),
      update(['B', { tabOrder: 2 }], ['C', { tabOrder: 1 }]),
    ];
    expect(spacesOf(doc, changes).map((s) => s.name)).toEqual(['Model', 'Plan', 'Layout1']);
    expect(layoutsOf(doc.opened.init, changes).map((l) => `${l.tabOrder}:${l.name}`)).toEqual([
      '0:Model',
      '1:Plan',
      '2:Layout1',
    ]);
  });

  it('follows the layouts the engine added and removed since (LAYOUT New and Delete)', () => {
    const sheet = { handle: 'D', name: 'Sheet', tabOrder: 3, blockRecord: '60' };
    const changes: ChangeSet[] = [
      { layouts: { added: [sheet] } },
      { layouts: { removed: [layouts[1]!] } },
    ];
    expect(spacesOf(doc, changes)).toEqual([
      { name: 'Model', block: '1F' },
      { name: 'Layout2', block: '50' },
      { name: 'Sheet', block: '60' },
    ]);
  });
});
