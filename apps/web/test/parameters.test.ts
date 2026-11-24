// M9-03 part 5: the Parameters Manager's rows as the engine sends them, per drawing, the Value
// column, and the search box narrowing the list.
import type { ParameterInfo } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { ParameterRows, parameterValueText, searchParameters } from '../src/parameters';

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
    store.set(1, [row({})]);
    expect(store.get(1)).toHaveLength(1);
    expect(store.get(2)).toBeUndefined();
    expect(store.get(undefined)).toBeUndefined();
    store.forget(2);
    expect(told).toBe(1);
    store.forget(1);
    expect(store.get(1)).toBeUndefined();
    expect(told).toBe(2);
    stop();
    store.set(1, []);
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
