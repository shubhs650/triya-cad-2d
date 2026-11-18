// M1-22: document tabs. Opening adds a tab that shows; closing the showing tab shows the one
// to its right, else the one to its left, as AutoCAD's file tabs do.
import type { ChangeSet, Layout } from '@triya/engine';
import type { OpenResult } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  DocumentStore,
  inLayout,
  layoutsOf,
  spacesOf,
  tabBlock,
  type OpenDocument,
} from '../src/documents';

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

// M2-45 part 2: PUBLISH's Add Sheets opens a drawing that is not open for the publish only: it
// gets no tab, the drawing shown stays shown, and closing it leaves the tabs as they were.
describe('DocumentStore drawings opened in the background', () => {
  it('opens one without a tab and closes it again', () => {
    const s = storeWith('a.dwg');
    const shown = s.getSnapshot().active;
    const id = s.openedInBackground('b.dxf', opened, '1F');
    expect(names(s)).toEqual(['a.dwg']);
    expect(s.getSnapshot().active).toBe(shown);
    expect(s.getSnapshot().background.map((d) => [d.id, d.name])).toEqual([[id, 'b.dxf']]);
    // Its engine's edits reach it, as an open drawing's do.
    s.edited(id);
    expect(s.getSnapshot().background[0]!.revision).toBe(1);
    s.close(id);
    expect(s.getSnapshot().background).toEqual([]);
    expect(names(s)).toEqual(['a.dwg']);
    expect(s.getSnapshot().active).toBe(shown);
  });
});

// M2-59 part 5: SETVAR CTAB and TILEMODE show a tab: the one named, or for TILEMODE 0 the layout
// tab last shown (AutoCAD 2024 Help, "TILEMODE": "Makes the last active layout tab active"),
// which before any is the drawing's current layout, the one *Paper_Space holds.
describe('tabBlock (M2-59 part 5)', () => {
  const layouts = [
    { handle: 'A', name: 'Model', tabOrder: 0, blockRecord: '1F' },
    { handle: 'B', name: 'Layout1', tabOrder: 1, blockRecord: '50' },
    { handle: 'C', name: 'Layout2', tabOrder: 2, blockRecord: '1B' },
  ];
  const opened = {
    modelSpace: '1F',
    init: {
      layouts,
      tables: {
        blockRecords: [
          { handle: '1F', name: '*Model_Space' },
          { handle: '50', name: '*Paper_Space0' },
          { handle: '1B', name: '*PAPER_SPACE' },
        ],
      },
    },
  } as unknown as OpenResult;

  it('finds the tab a name names, as the drawing spells it', () => {
    const doc = { opened } as OpenDocument;
    expect(tabBlock(doc, [], 'Layout1')).toBe('50');
    expect(tabBlock(doc, [], 'Model')).toBe('1F');
    expect(tabBlock(doc, [], 'Sheet9')).toBeUndefined();
  });

  it('without a name, the layout tab shown last, else the current layout', () => {
    const s = new DocumentStore();
    s.startOpening('a.dxf');
    const id = s.opened('a.dxf', opened, '1F');
    const doc = () => s.getSnapshot().docs.find((d) => d.id === id)!;
    expect(tabBlock(doc(), [], undefined)).toBe('1B');
    s.showSpace(id, '50');
    s.showSpace(id, '1F');
    expect(doc().lastLayout).toBe('50');
    expect(tabBlock(doc(), [], undefined)).toBe('50');
    // A layout deleted since is not shown again.
    const removed: ChangeSet = { layouts: { removed: [layouts[1]!] } };
    expect(tabBlock(doc(), [removed], undefined)).toBe('1B');
  });
});

// M5-02 part 1: BEDIT shows a block definition in the Block Editor; BCLOSE shows again the space
// shown before. The editor works as model space does, and no tab is shown while it is open.
describe('the Block Editor', () => {
  it('shows the block, keeps the space it came from and goes back to it', () => {
    const s = new DocumentStore();
    s.startOpening('a.dxf');
    const id = s.opened('a.dxf', { modelSpace: '1F' } as OpenResult, '1F');
    const doc = () => s.getSnapshot().docs.find((d) => d.id === id)!;
    s.showSpace(id, '58');
    expect(inLayout(doc())).toBe(true);
    s.openBlockEditor(id, '50', 'DOOR');
    expect(doc().block).toBe('50');
    expect(doc().blockEditor).toEqual({ block: '50', name: 'DOOR', from: '58' });
    expect(inLayout(doc())).toBe(false);
    // No tab is shown while it is open; the layout shown last stays the one before it.
    s.showSpace(id, '1F');
    expect(doc().block).toBe('50');
    expect(doc().lastLayout).toBe('58');
    s.closeBlockEditor(id);
    expect(doc().block).toBe('58');
    expect(doc().blockEditor).toBeUndefined();
    // Closing a closed editor changes nothing.
    s.closeBlockEditor(id);
    expect(doc().block).toBe('58');
  });
});
