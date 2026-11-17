// M5-05 part 3: the Layer Properties Manager's columns as AutoCAD's: shown or hidden, in an
// order of the user's (Customize Layer Columns), the Name column always shown, and the rows
// sorted by a column's header, a second click reversing it. The settings are the user's (kept
// with the preferences, as AutoCAD keeps them in its profile) and normalised as they load.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER_COLUMNS,
  LAYER_COLUMNS,
  moveLayerColumn,
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
