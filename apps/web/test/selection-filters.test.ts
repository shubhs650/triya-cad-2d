// M3-04 part 4: FILTER's named and unnamed filters, and the Object Selection Filters dialog's
// Select Filter as it makes a list line and takes one back (Edit Item).
import type { FilterItem } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { entryOf, itemOf } from '../src/FilterDialog';
import {
  UNNAMED,
  normalizeFilters,
  selectionFilters,
  validName,
  type NamedFilters,
} from '../src/selection-filters';

const CIRCLES: FilterItem[] = [{ key: 'Object', op: '=', value: 'CIRCLE' }];

describe('named filters', () => {
  it('keep only valid names (up to 18 characters) and filter lines', () => {
    expect(normalizeFilters(undefined)).toEqual({});
    expect(
      normalizeFilters({
        Circles: CIRCLES,
        'A name far too long for it': CIRCLES,
        '*unnamed': CIRCLES,
        Broken: [{ key: 'Nonsense' }],
        NotAList: 3,
      }),
    ).toEqual({ Circles: CIRCLES });
    expect(validName('Circles')).toBe(true);
    expect(validName('   ')).toBe(false);
    expect(validName('x'.repeat(19))).toBe(false);
  });

  it('are saved and deleted through the settings, the unnamed one kept for the session', () => {
    let stored: NamedFilters = {};
    selectionFilters.bind({}, (n) => (stored = n));
    selectionFilters.unnamed = [{ key: 'Layer', op: '=', value: 'WALLS' }];
    selectionFilters.save('Circles', CIRCLES);
    expect(stored).toEqual({ Circles: CIRCLES });
    expect(selectionFilters.list('Circles')).toEqual(CIRCLES);
    expect(selectionFilters.list(UNNAMED)).toEqual(selectionFilters.unnamed);
    expect(selectionFilters.list('Gone')).toEqual(selectionFilters.unnamed);
    selectionFilters.remove('Circles');
    expect(stored).toEqual({});
    expect(selectionFilters.named).toEqual({});
  });
});

describe('Select Filter', () => {
  const blank = {
    op: '=' as const,
    value: '',
    xyz: [
      ['=', '0'],
      ['=', '0'],
      ['=', '0'],
    ] as const,
  };

  it('makes the list line of an object type, a property or an operator', () => {
    expect(itemOf({ ...blank, entry: 'type:CIRCLE' })).toEqual(CIRCLES[0]);
    expect(itemOf({ ...blank, entry: 'type:LINE', op: '!=' })).toEqual({
      key: 'Object',
      op: '!=',
      value: 'LINE',
    });
    expect(itemOf({ ...blank, entry: 'Layer', value: ' W* ' })).toEqual({
      key: 'Layer',
      op: '=',
      value: 'W*',
    });
    // A name left empty takes any name.
    expect(itemOf({ ...blank, entry: 'Layer' })).toMatchObject({ value: '*' });
    expect(itemOf({ ...blank, entry: 'Circle Radius', op: '>=', value: '1' })).toEqual({
      key: 'Circle Radius',
      op: '>=',
      value: 1,
    });
    expect(itemOf({ ...blank, entry: 'Circle Radius', value: 'big' })).toBeUndefined();
    expect(itemOf({ ...blank, entry: 'Circle Radius', value: '' })).toBeUndefined();
    expect(itemOf({ ...blank, entry: 'Color', op: '*', value: '' })).toEqual({
      key: 'Color',
      op: '*',
      value: 0,
    });
    expect(
      itemOf({
        ...blank,
        entry: 'Circle Center',
        xyz: [
          ['>=', '1'],
          ['<', '2.5'],
          ['*', ''],
        ],
      }),
    ).toEqual({
      key: 'Circle Center',
      x: { op: '>=', value: 1 },
      y: { op: '<', value: 2.5 },
      z: { op: '*', value: 0 },
    });
    expect(
      itemOf({
        ...blank,
        entry: 'Line Start',
        xyz: [
          ['=', 'x'],
          ['=', '0'],
          ['=', '0'],
        ],
      }),
    ).toBeUndefined();
    expect(itemOf({ ...blank, entry: 'Begin NOT' })).toEqual({ key: 'Begin', logic: 'NOT' });
    expect(itemOf({ ...blank, entry: 'End XOR' })).toEqual({ key: 'End', logic: 'XOR' });
  });

  it('takes a list line back for Edit Item', () => {
    const lines: FilterItem[] = [
      { key: 'Object', op: '!=', value: 'ARC' },
      { key: 'Layer', op: '!=', value: 'WALLS' },
      { key: 'Text Height', op: '<=', value: 2.5 },
      {
        key: 'Line End',
        x: { op: '>', value: 3 },
        y: { op: '=', value: 4 },
        z: { op: '*', value: 0 },
      },
      { key: 'Begin', logic: 'OR' },
    ];
    for (const line of lines) expect(itemOf(entryOf(line))).toEqual(line);
    // A coordinate left out comes back as any value.
    expect(itemOf(entryOf({ key: 'Point Position', x: { op: '=', value: 1 } }))).toEqual({
      key: 'Point Position',
      x: { op: '=', value: 1 },
      y: { op: '*', value: 0 },
      z: { op: '*', value: 0 },
    });
  });
});
