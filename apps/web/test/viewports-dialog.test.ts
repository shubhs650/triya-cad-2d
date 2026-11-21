// M6-02 part 11: the Viewports dialog's preview, its name checks, and VPORTS waiting on it.
import { describe, expect, it } from 'vitest';
import { ACTIVE_MODEL_CONFIGURATION, type ViewportsDialogRequest } from '@triya/engine';
import {
  CURRENT_VIEW,
  nameProblem,
  namedPreview,
  newPreview,
  viewCount,
  viewportsDialog,
} from '../src/viewports-dialog';

const LEFT = { minX: 0, minY: 0, maxX: 0.5, maxY: 1 };
const RIGHT = { minX: 0.5, minY: 0, maxX: 1, maxY: 1 };

const request = (o: Partial<ViewportsDialogRequest> = {}): ViewportsDialogRequest => ({
  layout: false,
  current: '*Active',
  configurations: [{ name: 'Two', tiles: [LEFT, RIGHT] }],
  // The right tile is current: it comes first.
  active: [RIGHT, LEFT],
  views: ['Detail'],
  ...o,
});

describe('the Viewports dialog’s preview', () => {
  it('shows the current configuration for *Active Model Configuration, each tile’s view', () => {
    const tiles = newPreview(request(), {
      standard: ACTIVE_MODEL_CONFIGURATION,
      applyTo: 'Display',
      views: [null, 'Detail'],
    });
    expect(tiles).toEqual([
      { corners: RIGHT, label: CURRENT_VIEW, index: 0 },
      { corners: LEFT, label: 'Detail', index: 1 },
    ]);
  });

  it('divides the display, or under Current Viewport the current tile alone', () => {
    const display = newPreview(request(), {
      standard: 'Two: Horizontal',
      applyTo: 'Display',
      views: [],
    });
    expect(display.map((t) => t.corners)).toEqual([
      { minX: 0, minY: 0.5, maxX: 1, maxY: 1 },
      { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
    ]);
    const current = newPreview(request(), {
      standard: 'Two: Horizontal',
      applyTo: 'Current viewport',
      views: [],
    });
    expect(current).toEqual([
      { corners: { minX: 0.5, minY: 0.5, maxX: 1, maxY: 1 }, label: CURRENT_VIEW, index: 0 },
      { corners: { minX: 0.5, minY: 0, maxX: 1, maxY: 0.5 }, label: CURRENT_VIEW, index: 1 },
      // The other tile stays as it is: nothing to choose a view for.
      { corners: LEFT, label: '' },
    ]);
    expect(
      viewCount(request(), { standard: 'Two: Horizontal', applyTo: 'Current viewport', views: [] }),
    ).toBe(2);
  });

  it('divides the whole area in a layout, which has no Apply to', () => {
    const tiles = newPreview(request({ layout: true }), {
      standard: 'Four: Equal',
      applyTo: 'Current viewport',
      views: [],
    });
    expect(tiles).toHaveLength(4);
    expect(tiles[0]!.corners).toEqual({ minX: 0, minY: 0.5, maxX: 0.5, maxY: 1 });
  });

  it('shows a named configuration’s tiles on Named Viewports', () => {
    expect(namedPreview(request(), 'Two').map((t) => t.corners)).toEqual([LEFT, RIGHT]);
    expect(namedPreview(request(), 'Gone')).toEqual([]);
  });
});

describe('the Viewports dialog’s names', () => {
  it('refuses names AutoCAD would not take and names already used', () => {
    expect(nameProblem('Plan', ['Two'])).toBeUndefined();
    expect(nameProblem('a|b', [])).toBe('"a|b" is not a valid viewport configuration name.');
    expect(nameProblem('*active', [])).toBe(
      '"*active" is not a valid viewport configuration name.',
    );
    expect(nameProblem(' two ', ['Two'])).toBe(
      'A viewport configuration named "two" already exists.',
    );
  });
});

describe('VPORTS waiting on the dialog', () => {
  it('answers OK’s choice, and Cancel with none', async () => {
    const r = request();
    const first = viewportsDialog.show(1, r);
    expect(viewportsDialog.get()).toEqual({ doc: 1, request: r });
    viewportsDialog.close({ renamed: [], deleted: ['Two'] });
    expect(await first).toEqual({ ok: true, viewports: { renamed: [], deleted: ['Two'] } });
    expect(viewportsDialog.get()).toBeUndefined();
    const second = viewportsDialog.show(1, r);
    viewportsDialog.close();
    expect(await second).toEqual({ ok: true });
  });
});
