// M5-05 part 3: the Layer Properties Manager's columns as AutoCAD's: shown or hidden, in an
// order of the user's (Customize Layer Columns), the Name column always shown, and the rows
// sorted by a column's header, a second click reversing it. The settings are the user's (kept
// with the preferences, as AutoCAD keeps them in its profile) and normalised as they load.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER_COLUMNS,
  LAYER_COLUMNS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  cutLayerColumns,
  frozenLayerColumns,
  layerColumnTracks,
  layerColumnWidth,
  maximizedWidths,
  moveLayerColumn,
  moveLayerColumnBefore,
  normalizeLayerColumns,
  sortAfterClick,
  sortLayerRows,
  visibleLayerColumns,
} from '../src/layer-columns';
import type { LayerRow } from '../src/layers';

const row = (name: string, extra: Partial<LayerRow> = {}): LayerRow => ({
  handle: name,
  name,
  current: false,
  on: true,
  frozen: false,
  locked: false,
  plot: true,
  color: { label: 'white', css: '#fff' },
  linetype: 'Continuous',
  lineweight: 'Default',
  description: '',
  transparency: '0',
  value: {
    color: { kind: 'aci', index: 7 },
    linetype: '14',
    lineweight: 'Default',
    transparency: { alpha: 255 },
  },
  ...extra,
});

const names = (rows: readonly LayerRow[]) => rows.map((r) => r.name);

describe('the manager’s columns (M5-05 part 3)', () => {
  it('lists AutoCAD’s columns in its order, VP Freeze in a layout only', () => {
    const keys = (inLayout: boolean) =>
      visibleLayerColumns(DEFAULT_LAYER_COLUMNS, inLayout).map((c) => c.title);
    expect(keys(false)).toEqual([
      'Status',
      'Name',
      'On',
      'Freeze',
      'Lock',
      'Plot',
      'Color',
      'Linetype',
      'Lineweight',
      'Transparency',
      'Description',
    ]);
    expect(keys(true)).toContain('VP Freeze');
  });

  it('hides the columns the user hid, never Name', () => {
    const s = normalizeLayerColumns({
      ...DEFAULT_LAYER_COLUMNS,
      hidden: ['lineweight', 'name', 'status', 'nonsense'],
    });
    expect(s.hidden).toEqual(['lineweight', 'status']);
    expect(visibleLayerColumns(s, false).map((c) => c.key)).not.toContain('lineweight');
    expect(visibleLayerColumns(s, false).map((c) => c.key)).toContain('name');
  });

  it('keeps the user’s order, and puts a column it lacks where it goes by default', () => {
    const order = ['description', 'name', 'status', 'color'];
    const s = normalizeLayerColumns({ order, hidden: [], sort: { key: 'color' } });
    expect(s.order.filter((k) => order.includes(k))).toEqual(order);
    expect(s.order).toHaveLength(LAYER_COLUMNS.length);
    expect(new Set(s.order).size).toBe(LAYER_COLUMNS.length);
    // On follows Name as it does by default; Linetype follows Color.
    expect(s.order.slice(0, 4)).toEqual(['description', 'name', 'on', 'frozen']);
    expect(s.order.indexOf('linetype')).toBe(s.order.indexOf('color') + 1);
    expect(s.sort).toEqual({ key: 'color', descending: false });
  });

  it('falls back to the defaults for anything not valid', () => {
    expect(normalizeLayerColumns(undefined)).toEqual(DEFAULT_LAYER_COLUMNS);
    expect(normalizeLayerColumns({ order: 3, hidden: 'x', sort: { key: 'z' } })).toEqual(
      DEFAULT_LAYER_COLUMNS,
    );
  });

  it('moves a column up or down, no further than the ends', () => {
    const order = DEFAULT_LAYER_COLUMNS.order;
    expect(moveLayerColumn(order, 'name', -1).slice(0, 2)).toEqual(['name', 'status']);
    expect(moveLayerColumn(order, 'status', -1)).toEqual(order);
    expect(moveLayerColumn(order, 'description', 1)).toEqual(order);
    expect(moveLayerColumn(order, 'on', 1).slice(2, 4)).toEqual(['frozen', 'on']);
  });
});

describe('sorting the manager’s rows (M5-05 part 3)', () => {
  it('sorts by name naturally, a second click on the header reversing it', () => {
    const rows = [row('Layer10'), row('Layer2'), row('0'), row('layer1')];
    const asc = sortAfterClick(DEFAULT_LAYER_COLUMNS.sort, 'status');
    expect(asc).toEqual({ key: 'status', descending: false });
    expect(sortAfterClick(asc, 'status')).toEqual({ key: 'status', descending: true });
    expect(sortAfterClick({ key: 'status', descending: true }, 'name')).toEqual({
      key: 'name',
      descending: false,
    });
    expect(names(sortLayerRows(rows, { key: 'name', descending: false }))).toEqual([
      '0',
      'layer1',
      'Layer2',
      'Layer10',
    ]);
    expect(names(sortLayerRows(rows, { key: 'name', descending: true }))).toEqual([
      'Layer10',
      'Layer2',
      'layer1',
      '0',
    ]);
  });

  it('puts the current layer first by Status', () => {
    const rows = [row('A'), row('B', { current: true }), row('C')];
    expect(names(sortLayerRows(rows, { key: 'status', descending: false }))).toEqual([
      'B',
      'A',
      'C',
    ]);
  });

  it('sorts a toggle by its state, the column’s own state first, ties by name', () => {
    const rows = [row('A'), row('B', { frozen: true }), row('C'), row('D', { frozen: true })];
    expect(names(sortLayerRows(rows, { key: 'frozen', descending: false }))).toEqual([
      'B',
      'D',
      'A',
      'C',
    ]);
    expect(names(sortLayerRows(rows, { key: 'frozen', descending: true }))).toEqual([
      'C',
      'A',
      'D',
      'B',
    ]);
    const off = [row('A'), row('B', { on: false })];
    expect(names(sortLayerRows(off, { key: 'on', descending: false }))).toEqual(['A', 'B']);
  });

  it('sorts colours by ACI number, true colours after', () => {
    const color = (label: string, c: LayerRow['value']['color']) => ({
      color: { label, css: '' },
      value: { ...row('x').value, color: c },
    });
    const rows = [
      row('A', color('10', { kind: 'aci', index: 10 })),
      row('B', color('red', { kind: 'aci', index: 1 })),
      row('C', color('1,2,3', { kind: 'rgb', r: 1, g: 2, b: 3 })),
      row('D', color('blue', { kind: 'aci', index: 5 })),
    ];
    expect(names(sortLayerRows(rows, { key: 'color', descending: false }))).toEqual([
      'B',
      'D',
      'A',
      'C',
    ]);
  });

  it('sorts lineweights and transparencies by value, Default first', () => {
    const lw = (w: LayerRow['value']['lineweight']) => ({
      value: { ...row('x').value, lineweight: w },
    });
    const rows = [row('A', lw(100)), row('B', lw('Default')), row('C', lw(9)), row('D', lw(0))];
    expect(names(sortLayerRows(rows, { key: 'lineweight', descending: false }))).toEqual([
      'B',
      'D',
      'C',
      'A',
    ]);
    const tr = [row('A', { transparency: '50' }), row('B', { transparency: '9' })];
    expect(names(sortLayerRows(tr, { key: 'transparency', descending: false }))).toEqual([
      'B',
      'A',
    ]);
  });

  it('sorts linetypes and descriptions as text, VP Freeze by viewports freezing', () => {
    const rows = [
      row('A', { linetype: 'HIDDEN', description: 'walls', vpFrozen: { frozen: 2, of: 2 } }),
      row('B', { linetype: 'CENTER', description: '', vpFrozen: { frozen: 0, of: 2 } }),
      row('C', { linetype: 'Continuous', description: 'Doors', vpFrozen: { frozen: 1, of: 2 } }),
    ];
    expect(names(sortLayerRows(rows, { key: 'linetype', descending: false }))).toEqual([
      'B',
      'C',
      'A',
    ]);
    expect(names(sortLayerRows(rows, { key: 'description', descending: false }))).toEqual([
      'B',
      'C',
      'A',
    ]);
    expect(names(sortLayerRows(rows, { key: 'vpFreeze', descending: true }))).toEqual([
      'A',
      'C',
      'B',
    ]);
  });

  it('leaves the rows it is given as they were', () => {
    const rows = [row('B'), row('A')];
    sortLayerRows(rows, { key: 'name', descending: false });
    expect(names(rows)).toEqual(['B', 'A']);
  });
});

// M5-05 part 5: the header menu's Maximize/Optimize/Freeze Column, and dragging a header (or its
// edge) to move (or size) a column. The widths and the frozen column are the user's too.
describe('the rows’ column tracks and the columns that cut their contents (M5-13)', () => {
  const visible = visibleLayerColumns(DEFAULT_LAYER_COLUMNS, false);

  it('lays the rows out on the columns’ widths, in the order shown', () => {
    const s = { ...DEFAULT_LAYER_COLUMNS, widths: { name: 250 } };
    const shown = visibleLayerColumns(s, false);
    expect(layerColumnTracks(s, shown)).toBe(
      shown.map((c) => `${layerColumnWidth(s, c.key)}px`).join(' '),
    );
    expect(layerColumnTracks(s, shown).split(' ')[1]).toBe('250px');
  });

  it('cuts the columns whose text can be any length, the others only once narrowed', () => {
    // A name, a colour (a colour book's name), a linetype or a description can be wider than
    // any width; a toggle, the status, a lineweight or a transparency fits its default width.
    expect(cutLayerColumns(DEFAULT_LAYER_COLUMNS, visible)).toEqual([
      'name',
      'color',
      'linetype',
      'description',
    ]);
    const narrowed = { ...DEFAULT_LAYER_COLUMNS, widths: { on: 40, lineweight: 110, name: 600 } };
    expect(cutLayerColumns(narrowed, visible)).toEqual([
      'name',
      'on',
      'color',
      'linetype',
      'description',
    ]);
    // Only the columns shown.
    const hidden = { ...narrowed, hidden: ['on' as const, 'description' as const] };
    expect(cutLayerColumns(hidden, visibleLayerColumns(hidden, false))).toEqual([
      'name',
      'color',
      'linetype',
    ]);
  });
});

describe('column widths, moving and freezing (M5-05 part 5)', () => {
  it('gives every column a default width, the user’s width when set', () => {
    for (const c of LAYER_COLUMNS) expect(c.width).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(layerColumnWidth(DEFAULT_LAYER_COLUMNS, 'name')).toBe(
      LAYER_COLUMNS.find((c) => c.key === 'name')!.width,
    );
    expect(layerColumnWidth({ ...DEFAULT_LAYER_COLUMNS, widths: { name: 321 } }, 'name')).toBe(321);
  });

  it('keeps stored widths within bounds and the frozen column when it is a column', () => {
    const s = normalizeLayerColumns({
      order: ['name'],
      widths: { name: 250.6, color: 2, linetype: 99999, plot: 'wide', nope: 40 },
      frozen: 'name',
    });
    expect(s.widths).toEqual({ name: 251, color: MIN_COLUMN_WIDTH, linetype: MAX_COLUMN_WIDTH });
    expect(s.frozen).toBe('name');
    expect(normalizeLayerColumns({ frozen: 'nope' }).frozen).toBeUndefined();
    expect(normalizeLayerColumns({ widths: [1, 2] }).widths).toEqual({});
    // Older preferences have neither.
    expect(normalizeLayerColumns({ order: ['name'] })).toMatchObject({ widths: {} });
  });

  it('moves a dragged column before the column it is dropped on, or last', () => {
    const order = DEFAULT_LAYER_COLUMNS.order;
    const moved = moveLayerColumnBefore(order, 'description', 'on');
    expect(moved.slice(0, 4)).toEqual(['status', 'name', 'description', 'on']);
    expect(moved).toHaveLength(order.length);
    expect(moveLayerColumnBefore(order, 'status', undefined).at(-1)).toBe('status');
    // Dropped on itself: nothing moves.
    expect(moveLayerColumnBefore(order, 'color', 'color')).toEqual(order);
  });

  it('shares the list’s free width among the columns maximized', () => {
    const fitted = { name: 100, on: 50, color: 60 };
    // 300 wide: 90 left over, all three get 30.
    expect(maximizedWidths(fitted, ['name', 'on', 'color'], 300)).toEqual({
      name: 130,
      on: 80,
      color: 90,
    });
    // Only Name maximized: it takes all 90; a pixel left by the division goes to the last.
    expect(maximizedWidths(fitted, ['name'], 300)).toEqual({ name: 190, on: 50, color: 60 });
    expect(maximizedWidths(fitted, ['name', 'on'], 211)).toEqual({ name: 100, on: 51, color: 60 });
    // No room left: the fitted widths as they are.
    expect(maximizedWidths(fitted, ['name'], 150)).toEqual(fitted);
  });

  it('freezes the columns up to and including the frozen one, each after the ones before it', () => {
    const s = {
      ...DEFAULT_LAYER_COLUMNS,
      widths: { status: 40, name: 150 },
      frozen: 'name' as const,
    };
    const visible = visibleLayerColumns(s, false);
    expect([...frozenLayerColumns(s, visible)]).toEqual([
      ['status', 0],
      ['name', 40],
    ]);
    // Status hidden: Name is frozen at the left edge.
    const hidden = { ...s, hidden: ['status' as const] };
    expect([...frozenLayerColumns(hidden, visibleLayerColumns(hidden, false))]).toEqual([
      ['name', 0],
    ]);
    // The frozen column hidden, or none frozen: nothing is.
    expect(frozenLayerColumns({ ...s, frozen: 'vpFreeze' }, visible).size).toBe(0);
    expect(frozenLayerColumns(DEFAULT_LAYER_COLUMNS, visible).size).toBe(0);
  });
});
