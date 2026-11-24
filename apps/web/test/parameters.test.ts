// M9-03 part 5: the Parameters Manager's rows as the engine sends them, per drawing, the Value
// column, and the search box narrowing the list. Part 12: the filter tree's filters, Invert
// filter, and the columns' sorting.
import type { ParameterGroupInfo, ParameterInfo } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  ParameterRows,
  filterParameters,
  parameterValueText,
  searchParameters,
  sortParameters,
  sortedGroups,
  usedInExpressions,
} from '../src/parameters';

const row = (o: Partial<ParameterInfo>): ParameterInfo => ({
  name: 'd1',
  expression: '10',
  value: 10,
  type: 'Aligned',
  description: '',
  reference: false,
  constraint: 'D1',
  ...o,
});

describe('the Parameters Manager rows', () => {
  it('keeps each drawing its rows and tells the palette when they change', () => {
    const store = new ParameterRows();
    let told = 0;
    const stop = store.subscribe(() => told++);
    store.set(1, [row({})], [{ handle: 'F1', name: 'Widths', members: ['D1'] }]);
    expect(store.get(1)).toHaveLength(1);
    expect(store.groups(1)).toEqual([{ handle: 'F1', name: 'Widths', members: ['D1'] }]);
    expect(store.groups(2)).toEqual([]);
    expect(store.get(2)).toBeUndefined();
    expect(store.get(undefined)).toBeUndefined();
    store.forget(2);
    expect(told).toBe(1);
    store.forget(1);
    expect(store.get(1)).toBeUndefined();
    expect(told).toBe(2);
    stop();
    store.set(1, [], []);
    expect(told).toBe(2);
  });

  it('shows a distance to four places, an angle in degrees, and why there is no value', () => {
    expect(parameterValueText(row({ value: 60 }))).toBe('60.0000');
    expect(parameterValueText(row({ value: 45, type: 'Angular' }))).toBe('45.0000°');
    expect(parameterValueText(row({ value: undefined, error: 'd9 is not defined' }))).toBe(
      'd9 is not defined',
    );
    expect(parameterValueText(row({ value: undefined }))).toBe('');
  });

  it('narrows the list to names, expressions or descriptions holding the search, any case', () => {
    const rows = [
      row({ name: 'width', expression: '20' }),
      row({ name: 'height', expression: 'width/2' }),
      row({ name: 'ang1', expression: '30', description: 'Roof pitch' }),
    ];
    expect(searchParameters(rows, '  ')).toBe(rows);
    expect(searchParameters(rows, 'WIDTH').map((r) => r.name)).toEqual(['width', 'height']);
    expect(searchParameters(rows, 'pitch').map((r) => r.name)).toEqual(['ang1']);
    expect(searchParameters(rows, 'none')).toEqual([]);
  });
});

const rows = [
  row({ name: 'width', expression: '20', value: 20, constraint: 'D1', type: 'Horizontal' }),
  row({ name: 'height', expression: 'width/2', value: 10, constraint: 'D2', type: 'Vertical' }),
  row({ name: 'ang1', expression: '30', value: 30, constraint: 'D3', type: 'Angular' }),
  row({ name: 'd10', expression: 'd9', value: undefined, constraint: 'D4', description: 'Gap' }),
  row({ name: 'user1', expression: '1', value: 1, constraint: 'E1', type: 'User', user: true }),
];
const groups: ParameterGroupInfo[] = [{ handle: 'F1', name: 'Widths', members: ['D1', 'E1'] }];
const names = (r: readonly ParameterInfo[]) => r.map((x) => x.name);

describe("the Parameters Manager's filter tree (M9-03 part 12)", () => {
  it('All Used in Expressions: parameters other expressions name, and those naming others', () => {
    // width is named by height; height names width; d10 names d9, which is no parameter here.
    expect([...usedInExpressions(rows)].sort()).toEqual(['height', 'width']);
    // A name is matched whole, case sensitive, as the expressions name parameters.
    const more = [row({ name: 'w', expression: '2' }), row({ name: 'x', expression: 'W+wide' })];
    expect(usedInExpressions(more).size).toBe(0);
    expect(usedInExpressions([...more, row({ name: 'y', expression: '2*w' })])).toEqual(
      new Set(['w', 'y']),
    );
  });

  it('narrows the rows to All, All Used in Expressions or a group, inverted when asked', () => {
    expect(filterParameters(rows, { kind: 'all' }, groups, false)).toBe(rows);
    expect(names(filterParameters(rows, { kind: 'all' }, groups, true))).toEqual([]);
    expect(names(filterParameters(rows, { kind: 'expressions' }, groups, false))).toEqual([
      'width',
      'height',
    ]);
    expect(names(filterParameters(rows, { kind: 'expressions' }, groups, true))).toEqual([
      'ang1',
      'd10',
      'user1',
    ]);
    const widths = { kind: 'group', group: 'F1' } as const;
    expect(names(filterParameters(rows, widths, groups, false))).toEqual(['width', 'user1']);
    expect(names(filterParameters(rows, widths, groups, true))).toEqual(['height', 'ang1', 'd10']);
    // A group that is gone shows them all.
    expect(filterParameters(rows, { kind: 'group', group: 'F9' }, groups, false)).toBe(rows);
  });

  it('lists the group filters by name, numbers in order', () => {
    const many: ParameterGroupInfo[] = [
      { handle: 'F1', name: 'Group Filter10', members: [] },
      { handle: 'F2', name: 'beams', members: [] },
      { handle: 'F3', name: 'Group Filter2', members: [] },
    ];
    expect(sortedGroups(many).map((g) => g.name)).toEqual([
      'beams',
      'Group Filter2',
      'Group Filter10',
    ]);
  });
});

describe("the Parameters Manager's column sorting (M9-03 part 12)", () => {
  it('keeps the drawing order until a column is picked', () => {
    expect(sortParameters(rows, undefined)).toBe(rows);
  });

  it('sorts by name, numbers in order and any case, up or down', () => {
    const r = [row({ name: 'd10' }), row({ name: 'D2' }), row({ name: 'd1' })];
    expect(names(sortParameters(r, { column: 'name', descending: false }))).toEqual([
      'd1',
      'D2',
      'd10',
    ]);
    expect(names(sortParameters(r, { column: 'name', descending: true }))).toEqual([
      'd10',
      'D2',
      'd1',
    ]);
  });

  it('sorts values as numbers, a row without one last either way', () => {
    expect(names(sortParameters(rows, { column: 'value', descending: false }))).toEqual([
      'user1',
      'height',
      'width',
      'ang1',
      'd10',
    ]);
    expect(names(sortParameters(rows, { column: 'value', descending: true }))).toEqual([
      'ang1',
      'width',
      'height',
      'user1',
      'd10',
    ]);
  });

  it('sorts by expression, type and description as text, ties by name', () => {
    expect(names(sortParameters(rows, { column: 'type', descending: false }))).toEqual([
      'd10',
      'ang1',
      'width',
      'user1',
      'height',
    ]);
    expect(names(sortParameters(rows, { column: 'description', descending: true }))[0]).toBe('d10');
    expect(names(sortParameters(rows, { column: 'expression', descending: false }))).toEqual([
      'user1',
      'width',
      'ang1',
      'd10',
      'height',
    ]);
  });
});
