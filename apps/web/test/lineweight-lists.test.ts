// M5-12: the dialogs' lineweight lists in LWUNITS' units, as AutoCAD lists every lineweight
// (AutoCAD 2024 Help, "LWUNITS": 0 inches, 1 millimetres): Table Style's border lineweight and
// Edit Attributes' (the Enhanced Attribute Editor's and BATTMAN's Properties tab, and BATTMAN's
// Lineweight column). The values stay hundredths of a millimetre.
import { describe, expect, it } from 'vitest';
import { attributeLineweightOptions, lineweightLabel } from '../src/AttributeDialogs';
import { lineweightUnitsOf } from '../src/lineweight-units';
import { tableLineweightOptions } from '../src/TableStyleDialog';

const shown = (o: readonly { value: string; label: string }[]) =>
  o.map((x) => `${x.value}=${x.label}`);

describe('lineweight lists under LWUNITS', () => {
  it('reads LWUNITS 0 as inches and anything else as millimetres', () => {
    expect(lineweightUnitsOf(0)).toBe('in');
    expect(lineweightUnitsOf(1)).toBe('mm');
  });

  it('lists Table Style’s border lineweights in inches under LWUNITS 0', () => {
    const inches = shown(tableLineweightOptions(lineweightUnitsOf(0)));
    expect(inches.slice(0, 4)).toEqual([
      'ByBlock=ByBlock',
      'ByLayer=ByLayer',
      '0=0.000"',
      '5=0.002"',
    ]);
    expect(inches).toContain('30=0.012"');
    expect(inches.some((l) => l.endsWith(' mm'))).toBe(false);
    expect(shown(tableLineweightOptions('mm'))).toContain('30=0.30 mm');
  });

  it('lists Edit Attributes’ lineweights in inches under LWUNITS 0', () => {
    const inches = shown(attributeLineweightOptions(lineweightUnitsOf(0)));
    expect(inches.slice(0, 4)).toEqual([
      'ByLayer=ByLayer',
      'ByBlock=ByBlock',
      'Default=Default',
      '0=0.000"',
    ]);
    expect(inches).toContain('211=0.083"');
    expect(inches.some((l) => l.endsWith(' mm'))).toBe(false);
    expect(shown(attributeLineweightOptions('mm'))).toContain('25=0.25 mm');
    // BATTMAN's Lineweight column.
    expect(lineweightLabel(50, 'in')).toBe('0.020"');
    expect(lineweightLabel(50)).toBe('0.50 mm');
    expect(lineweightLabel('ByBlock', 'in')).toBe('ByBlock');
  });
});
