// M7-04: the Options dialog's state. OPTIONS waits until it closes, it opens on the tab shown
// last, and its tab list moves with the arrow keys, Home and End.
import { describe, expect, it } from 'vitest';
import { OPTIONS_TABS, createOptionsDialog, nextTab } from '../src/options-dialog';

describe('the Options dialog', () => {
  it("has AutoCAD's tabs in AutoCAD's order, without 3D Modeling and Profiles", () => {
    expect(OPTIONS_TABS.map((t) => t.label)).toEqual([
      'Files',
      'Display',
      'Open and Save',
      'Plot and Publish',
      'System',
      'User Preferences',
      'Drafting',
      'Selection',
    ]);
  });

  it('resolves what waits for it when it closes, and keeps the tab shown', async () => {
    const d = createOptionsDialog();
    let heard = 0;
    d.subscribe(() => heard++);
    let closed = false;
    const waiting = d.show().then(() => (closed = true));
    expect(d.get()).toEqual({ open: true, tab: 'files' });
    d.showTab('selection');
    d.showTab('selection');
    await Promise.resolve();
    expect(closed).toBe(false);
    d.close();
    await waiting;
    expect(closed).toBe(true);
    expect(d.get()).toEqual({ open: false, tab: 'selection' });
    expect(heard).toBe(3);
    // Opened again, on the tab shown last; a second show while open adds a waiter only.
    const again = d.show();
    const twice = d.show();
    expect(d.get().tab).toBe('selection');
    expect(heard).toBe(4);
    d.close();
    await Promise.all([again, twice]);
    d.close();
    expect(heard).toBe(5);
  });

  it('moves along the tab list with the arrow keys, Home and End, wrapping around', () => {
    expect(nextTab('files', 'ArrowRight')).toBe('display');
    expect(nextTab('files', 'ArrowLeft')).toBe('selection');
    expect(nextTab('selection', 'ArrowRight')).toBe('files');
    expect(nextTab('drafting', 'Home')).toBe('files');
    expect(nextTab('files', 'End')).toBe('selection');
    expect(nextTab('files', 'Enter')).toBeUndefined();
  });
});
