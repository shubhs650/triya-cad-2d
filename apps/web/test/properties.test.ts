// M2-21: how the Properties palette shows a row's value, in the drawing's units.
import { describe, expect, it } from 'vitest';
import type { PropertyRow, PropertySheet, PropertyUnits } from '@triya/engine';
import { PropertySheets, editText, typeOptions, valueText } from '../src/properties';

const decimal: PropertyUnits = { lunits: 2, luprec: 4, aunits: 0, auprec: 0 };
const arch: PropertyUnits = { lunits: 4, luprec: 4, aunits: 1, auprec: 4 };
const row = (r: Partial<PropertyRow>): PropertyRow => ({
  key: 'k',
  label: 'K',
  kind: 'distance',
  ...r,
});

describe('Properties values', () => {
  it('shows distances by LUNITS and LUPREC', () => {
    expect(valueText(row({ value: 10 }), decimal)).toBe('10.0000');
    expect(valueText(row({ value: 30 }), arch)).toBe(`2'-6"`);
    expect(valueText(row({ value: 30.5 }), { ...arch, luprec: 1 })).toBe(`2'-6 1/2"`);
  });

  it('shows angles by AUNITS and AUPREC, decimal degrees without a sign', () => {
    expect(valueText(row({ kind: 'angle', value: Math.PI / 4 }), decimal)).toBe('45');
    expect(valueText(row({ kind: 'angle', value: Math.PI / 4 }), { ...decimal, auprec: 2 })).toBe(
      '45.00',
    );
    expect(valueText(row({ kind: 'angle', value: (45.5 * Math.PI) / 180 }), arch)).toBe(`45d30'0"`);
  });

  it('shows choices by their labels, *VARIES*, numbers and transparency', () => {
    const options = [
      { value: 'ByLayer', label: 'ByLayer' },
      { value: 'aci:1', label: 'Red' },
    ];
    expect(valueText(row({ kind: 'choice', value: 'aci:1', options }), decimal)).toBe('Red');
    expect(valueText(row({ kind: 'choice', varies: true, options }), decimal)).toBe('*VARIES*');
    expect(valueText(row({ kind: 'number', value: 1 }), decimal)).toBe('1.0000');
    expect(valueText(row({ kind: 'area', value: 12.56637 }), decimal)).toBe('12.5664');
    expect(valueText(row({ kind: 'transparency', value: 40, options }), decimal)).toBe('40');
    expect(valueText(row({ kind: 'text', value: 'NOTE' }), decimal)).toBe('NOTE');
  });

  it('starts a typed field with what the engine reads back', () => {
    expect(editText(row({ value: 10 }), decimal)).toBe('10.0000');
    // M2-35 part 7: the engine reads feet and inches and fractions, so the field starts as shown.
    expect(editText(row({ value: 30.5 }), arch)).toBe(`2'-6 1/2"`);
    expect(editText(row({ value: 30.5 }), { ...arch, lunits: 3 })).toBe(`2'-6.5000"`);
    expect(editText(row({ value: 30.5 }), { ...arch, lunits: 5 })).toBe('30 1/2');
    expect(editText(row({ value: 30.5 }), { ...arch, lunits: 1 })).toBe('3.0500E+01');
    expect(editText(row({ varies: true }), decimal)).toBe('');
    expect(editText(row({ kind: 'angle', value: Math.PI / 2 }), { ...decimal, aunits: 4 })).toBe(
      '90',
    );
  });
});

describe('the object list', () => {
  const sheet = (types: PropertySheet['types']): PropertySheet => ({
    count: types.reduce((n, t) => n + t.count, 0),
    types,
    sections: [],
    units: decimal,
  });
  it('lists All and each type with its count', () => {
    expect(
      typeOptions(
        sheet([
          { type: 'LINE', label: 'Line', count: 2 },
          { type: 'CIRCLE', label: 'Circle', count: 1 },
        ]),
      ).map((o) => o.label),
    ).toEqual(['All (3)', 'Line (2)', 'Circle (1)']);
    expect(typeOptions(sheet([{ type: 'LINE', label: 'Line', count: 1 }]))).toEqual([
      { value: '', label: 'Line (1)' },
    ]);
    expect(typeOptions(sheet([]))).toEqual([]);
    // M2-35: nothing selected shows the current settings under "No selection".
    expect(typeOptions({ ...sheet([]), current: true })).toEqual([
      { value: '', label: 'No selection' },
    ]);
  });

  it('keeps each drawing’s last sheet and tells listeners', () => {
    const sheets = new PropertySheets();
    let heard = 0;
    sheets.subscribe(() => heard++);
    sheets.set(1, sheet([]));
    expect(sheets.get(1)?.count).toBe(0);
    expect(sheets.get(2)).toBeUndefined();
    sheets.forget(1);
    sheets.forget(1);
    expect(heard).toBe(2);
  });
});
