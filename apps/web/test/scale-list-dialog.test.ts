// M6-02 part 22: the Edit Drawing Scales dialog's list edits (Move Up/Down, Reset, Add/Edit
// Scale's fields) and SCALELISTEDIT waiting on it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALE_LIST, type ScaleListDialogRequest } from '@triya/engine';
import {
  moved,
  reset,
  scaleListDialog,
  scaleOf,
  unitText,
  type DialogScales,
} from '../src/scale-list-dialog';

const LIST: DialogScales = [
  { handle: 'A0', name: '1:1', paperUnits: 1, drawingUnits: 1, use: 'current' },
  { handle: 'A1', name: '1:50', paperUnits: 1, drawingUnits: 50 },
  { handle: 'A2', name: 'Site', paperUnits: 1, drawingUnits: 500, use: 'object' },
  { handle: 'A3', name: 'Mine', paperUnits: 1, drawingUnits: 7 },
];

describe('the Edit Drawing Scales dialog’s list', () => {
  it('moves a scale up or down, but not past an end', () => {
    expect(moved(LIST, 1, -1).map((s) => s.name)).toEqual(['1:50', '1:1', 'Site', 'Mine']);
    expect(moved(LIST, 1, 1).map((s) => s.name)).toEqual(['1:1', 'Site', '1:50', 'Mine']);
    expect(moved(LIST, 0, -1)).toBe(LIST);
    expect(moved(LIST, 3, 1)).toBe(LIST);
  });

  it('Reset restores the defaults, keeping the scales in use and deleting custom ones', () => {
    const out = reset(LIST, DEFAULT_SCALE_LIST);
    expect(out.map((s) => s.name)).toEqual([...DEFAULT_SCALE_LIST.map((s) => s.name), 'Site']);
    // 1:1 in use stays itself; unused 1:50 too, with the default's ratio; Mine is gone.
    expect(out[0]).toBe(LIST[0]);
    expect(out.find((s) => s.name === '1:50')).toMatchObject({ handle: 'A1' });
    expect(out.some((s) => s.handle === 'A3')).toBe(false);
  });

  it('Add and Edit Scale take a new name and two positive units', () => {
    const fields = (name: string, paperUnits = '1', drawingUnits = '20') => ({
      name,
      paperUnits,
      drawingUnits,
    });
    expect(scaleOf(LIST, fields(' 1:20 '))).toEqual({
      name: '1:20',
      paperUnits: 1,
      drawingUnits: 20,
    });
    expect(scaleOf(LIST, fields('site'))).toBe('A scale named "Site" already exists.');
    // The scale edited keeps its own name.
    expect(scaleOf(LIST, fields('Site', '1', '500'), 2)).toMatchObject({ name: 'Site' });
    expect(scaleOf(LIST, fields('x', '0'))).toBe(
      'Paper units and drawing units must be positive numbers.',
    );
    expect(scaleOf(LIST, fields('x', '1', 'ten'))).toBe(
      'Paper units and drawing units must be positive numbers.',
    );
    expect(unitText(1 / 3)).toBe('0.333333333333');
    expect(unitText(0.1 + 0.2)).toBe('0.3');
  });
});

describe('SCALELISTEDIT waiting on the dialog', () => {
  const request: ScaleListDialogRequest = { scales: LIST, defaults: DEFAULT_SCALE_LIST };

  it('answers OK with the list, Cancel without, and a dialog opened over another cancels it', async () => {
    const ok = scaleListDialog.show(1, request);
    expect(scaleListDialog.get()).toEqual({ doc: 1, request });
    scaleListDialog.close(LIST.slice(1));
    await expect(ok).resolves.toEqual({ ok: true, scaleList: LIST.slice(1) });
    expect(scaleListDialog.get()).toBeUndefined();

    const first = scaleListDialog.show(1, request);
    const second = scaleListDialog.show(2, request);
    await expect(first).resolves.toEqual({ ok: true });
    scaleListDialog.close();
    await expect(second).resolves.toEqual({ ok: true });
  });
});
