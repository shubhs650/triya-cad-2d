// M3-04 part 7: FILTER's Select… button (AutoCAD 2024 Help, "Object Selection Filters Dialog
// Box": "Select... Displays a dialog box listing all items of the specified type in the
// drawing. Select the items to filter. For example, if you select Color, Select displays the
// Select Color dialog box"). The names chosen make one value, separated by commas (a wildcard
// list, as the filter matches it); a colour is its ACI number, 256 ByLayer and 0 ByBlock.
import { describe, expect, it } from 'vitest';
import { filterColor, listedNames, selectsFrom } from '../src/FilterDialog';

describe('FILTER’s Select…', () => {
  it('lists the drawing’s names for a name property, and the Select Color dialog for Color', () => {
    expect(selectsFrom('Layer')).toBe('names');
    expect(selectsFrom('Block Name')).toBe('names');
    expect(selectsFrom('Dimension Style')).toBe('names');
    expect(selectsFrom('Color')).toBe('color');
    // Text values and the rest have no list to choose from.
    expect(selectsFrom('Text Value')).toBeUndefined();
    expect(selectsFrom('Circle Radius')).toBeUndefined();
    expect(selectsFrom('type:LINE')).toBeUndefined();
    expect(selectsFrom('Begin AND')).toBeUndefined();
  });

  it('opens on the names the value lists, whatever their case', () => {
    const names = ['0', 'Walls', 'Doors'];
    expect(listedNames('walls,0', names)).toEqual(['0', 'Walls']);
    expect(listedNames(' Doors , Roof', names)).toEqual(['Doors']);
    expect(listedNames('', names)).toEqual([]);
    expect(listedNames('W*', names)).toEqual([]);
  });

  it('gives a colour as DXF 62 numbers it', () => {
    expect(filterColor({ kind: 'aci', index: 3 })).toBe(3);
    expect(filterColor({ kind: 'byLayer' })).toBe(256);
    expect(filterColor({ kind: 'byBlock' })).toBe(0);
    expect(filterColor({ kind: 'rgb', r: 1, g: 2, b: 3 })).toBeUndefined();
  });
});
