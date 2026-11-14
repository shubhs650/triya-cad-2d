// M2-47 part 2: the View Manager's tree (Current, Model Views, Layout Views), the properties it
// shows for a view, the window the New View dialog's Define window picks, and its dialog state
// kept while VIEW asks for that window.
import type { ViewRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  currentRows,
  pickedWindow,
  viewManager,
  viewRows,
  viewTree,
  type ManagerState,
} from '../src/view-manager';

const view = (name: string, more: Partial<ViewRecord> = {}): ViewRecord =>
  ({
    handle: name,
    name,
    center: { x: 10, y: 5 },
    height: 20,
    width: 40,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    twist: 0,
    ...more,
  }) as ViewRecord;

describe('viewTree', () => {
  it("splits model and paper views and sorts each by name, case ignored, as AutoCAD's tree", () => {
    const t = viewTree([
      view('front'),
      view('Sheet B', { flags: 1 }),
      view('Back'),
      view('sheet a', { flags: 1 | 16 }),
    ]);
    expect(t.model.map((v) => v.name)).toEqual(['Back', 'front']);
    expect(t.layout.map((v) => v.name)).toEqual(['sheet a', 'Sheet B']);
  });
});

describe('viewRows', () => {
  it('shows General and View rows, the centre in world coordinates', () => {
    const rows = viewRows(view('Front', { target: { x: 1, y: 2, z: 0 }, twist: Math.PI / 2 }));
    expect(rows).toEqual([
      { group: 'General', label: 'Name', value: 'Front' },
      { group: 'View', label: 'Center X', value: '11.0000' },
      { group: 'View', label: 'Center Y', value: '7.0000' },
      { group: 'View', label: 'Height', value: '20.0000' },
      { group: 'View', label: 'Width', value: '40.0000' },
      { group: 'View', label: 'Roll angle', value: '90' },
      { group: 'View', label: 'Perspective', value: 'Off' },
    ]);
  });

  it('says when a view is not a plan view', () => {
    const rows = viewRows(view('Iso', { direction: { x: 1, y: -1, z: 1 } }));
    expect(rows.at(-1)).toEqual({
      group: 'View',
      label: 'View direction',
      value: 'Not a plan view: Set Current waits for 3D views',
    });
  });

  it('shows the current view', () => {
    expect(currentRows({ center: { x: 1, y: -2 }, height: 3, width: 4.5, paper: false })).toEqual([
      { group: 'View', label: 'Center X', value: '1.0000' },
      { group: 'View', label: 'Center Y', value: '-2.0000' },
      { group: 'View', label: 'Height', value: '3.0000' },
      { group: 'View', label: 'Width', value: '4.5000' },
    ]);
  });
});

describe('pickedWindow', () => {
  it('is the view two corners frame, in the space shown', () => {
    expect(pickedWindow({ a: { x: 10, y: 20 }, b: { x: 0, y: 0 } }, true)).toEqual({
      center: { x: 5, y: 10 },
      width: 10,
      height: 20,
      paper: true,
    });
    expect(pickedWindow({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, false)).toBeUndefined();
  });
});

describe('viewManager', () => {
  const state: ManagerState = {
    selected: 'model:Front',
    current: undefined,
    creating: { name: 'Detail', boundary: 'window' },
  };

  it('opens, and resolves when closed', async () => {
    const shown = viewManager.show(3);
    expect(viewManager.get()).toBe(3);
    viewManager.close();
    expect(viewManager.get()).toBeUndefined();
    await expect(shown).resolves.toBe(false);
  });

  it("keeps the dialog's state while VIEW asks for a window, with the window then picked", async () => {
    const shown = viewManager.show(3);
    viewManager.pickWindow(3, 'B1', state);
    expect(viewManager.get()).toBeUndefined();
    await expect(shown).resolves.toBe(true);

    const window = { a: { x: 0, y: 0 }, b: { x: 4, y: 2 } };
    const again = viewManager.show(3, { resume: true, window });
    expect(viewManager.resume(3, 'B1')).toEqual({
      ...state,
      creating: { ...state.creating, window },
    });
    expect(viewManager.resume(3, 'B2')).toBeUndefined();
    viewManager.close();
    await expect(again).resolves.toBe(false);
    // Opened afresh (VIEW again), it starts over.
    void viewManager.show(3);
    expect(viewManager.resume(3, 'B1')).toBeUndefined();
    viewManager.close();
  });

  it('shows it again as it was on Esc at the corners (no window)', () => {
    void viewManager.show(4);
    viewManager.pickWindow(4, 'B1', state);
    void viewManager.show(4, { resume: true });
    expect(viewManager.resume(4, 'B1')).toEqual(state);
    viewManager.close();
  });
});
