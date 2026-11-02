// M1-22: document tabs. Opening adds a tab that shows; closing the showing tab shows the one
// to its right, else the one to its left, as AutoCAD's file tabs do.
import type { OpenResult } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../src/documents';

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

describe('DocumentStore spaces and saved views', () => {
  const v = (x: number) => ({ center: { x, y: 0 }, scale: 1 });

  it('switches a document between model space and a layout', () => {
    const s = storeWith('a.dwg');
    const id = s.getSnapshot().docs[0]!.id;
    s.showSpace(id, '58');
    expect(s.getSnapshot().docs[0]!.block).toBe('58');
  });

  it('saves views in the space shown, a new view replacing one of the same name', () => {
    const s = storeWith('a.dwg');
    const id = s.getSnapshot().docs[0]!.id;
    s.saveView(id, 'Front', v(1));
    s.showSpace(id, '58');
    s.saveView(id, 'Sheet', v(2));
    s.saveView(id, 'FRONT', v(3));
    expect(s.getSnapshot().docs[0]!.savedViews).toEqual([
      { name: 'Sheet', block: '58', view: v(2) },
      { name: 'FRONT', block: '58', view: v(3) },
    ]);
  });
});
