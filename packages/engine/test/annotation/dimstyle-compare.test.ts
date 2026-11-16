// M4-03 part 2: Compare Dimension Styles, the sub-styles' names and the kinds they apply to, and
// the dialog fields for the settings a style keeps in xdata.
import { describe, expect, it } from 'vitest';
import {
  DIMSTYLE_FIELDS,
  DIMSTYLE_USES,
  childStyleName,
  childStyleOf,
  childStyleUse,
  compareDimStyles,
  dialogVars,
  dimStyleUseOf,
  drawnDimStyle,
  formatDimStyleVar,
  setField,
  type DimStyleRecord,
  type Entity,
} from '../../src/index';

const names = (name: string, h: string) =>
  name === 'DIMTXSTY' ? (h === '11' ? 'Standard' : 'Notes') : h === '' ? 'ClosedFilled' : 'Dot';

describe('Compare Dimension Styles', () => {
  it('lists the variables two styles set differently, with descriptions, by name', () => {
    const rows = compareDimStyles(
      { DIMASZ: 0.18, DIMTOL: false, DIMTXSTY: '11', DIMJAG: 1.5 },
      { DIMASZ: 2.5, DIMTOL: true, DIMTXSTY: '12', DIMBLK: '30' },
      names,
    );
    expect(rows).toEqual([
      { variable: 'DIMASZ', description: 'Arrow size', values: ['0.1800', '2.5000'] },
      { variable: 'DIMBLK', description: 'Arrow block name', values: ['ClosedFilled', 'Dot'] },
      { variable: 'DIMTOL', description: 'Tolerance dimensioning', values: ['Off', 'On'] },
      { variable: 'DIMTXSTY', description: 'Text style', values: ['Standard', 'Notes'] },
    ]);
    // A switch read as a number from a header or override compares as the boolean does.
    expect(compareDimStyles({ DIMTOL: 0 }, { DIMTOL: false }, names)).toEqual([]);
  });

  it('With <none>: every variable of the one style, AutoCAD’s defaults for what it does not state', () => {
    const rows = compareDimStyles({ DIMASZ: 2.5 }, undefined, names);
    expect(rows.length).toBeGreaterThan(80);
    expect(rows.find((r) => r.variable === 'DIMASZ')!.values).toEqual(['2.5000']);
    expect(rows.find((r) => r.variable === 'DIMJAG')!.values).toEqual(['1.5000']);
    expect(rows.some((r) => r.variable === 'DIMFIT' || r.variable === 'DIMUNIT')).toBe(false);
  });

  it('shows values as AutoCAD lists them', () => {
    expect(formatDimStyleVar('DIMCLRD', 0, names)).toBe('BYBLOCK');
    expect(formatDimStyleVar('DIMCLRT', 256, names)).toBe('BYLAYER');
    expect(formatDimStyleVar('DIMCLRE', 1, names)).toBe('1');
    expect(formatDimStyleVar('DIMDEC', 4, names)).toBe('4');
    expect(formatDimStyleVar('DIMTALN', 1, names)).toBe('1');
    expect(formatDimStyleVar('DIMJOGANG', Math.PI / 4, names)).toBe('45');
    expect(formatDimStyleVar('DIMDSEP', 44, names)).toBe(',');
    expect(formatDimStyleVar('DIMDSEP', '.', names)).toBe('.');
    expect(formatDimStyleVar('DIMPOST', '', names)).toBe('""');
    expect(formatDimStyleVar('DIMMZS', 'cm', names)).toBe('"cm"');
    expect(formatDimStyleVar('DIMSAH', 1, names)).toBe('On');
    expect(formatDimStyleVar('DIMTAD', true, names)).toBe('1');
    expect(formatDimStyleVar('DIMLTYPE', '0', names)).toBe('ClosedFilled');
    expect(formatDimStyleVar('DIMASZ', undefined, names)).toBe('');
  });
});

describe('dimension sub-styles', () => {
  it('are named after their parent and the kind they are for', () => {
    expect(DIMSTYLE_USES.map((u) => u.label)).toEqual([
      'All dimensions',
      'Linear dimensions',
      'Angular dimensions',
      'Radius dimensions',
      'Diameter dimensions',
      'Ordinate dimensions',
      'Leaders and Tolerances',
    ]);
    expect(childStyleName('ISO-25', 'linear')).toBe('ISO-25$0');
    expect(childStyleName('ISO-25', 'leader')).toBe('ISO-25$7');
    expect(childStyleUse('ISO-25$3')).toEqual({ parent: 'ISO-25', use: 'diameter' });
    expect(childStyleUse('ISO-25$5')).toBeUndefined();
    expect(childStyleUse('$0')).toBeUndefined();
    expect(childStyleUse('A$B$0')).toBeUndefined();
    expect(childStyleUse('Standard')).toBeUndefined();
  });

  it('apply to their kind of dimension, leader and tolerance', () => {
    const dim = (dimType: string) => ({ kind: 'DIMENSION', dimType }) as Entity['geom'];
    expect(dimStyleUseOf(dim('linear'))).toBe('linear');
    expect(dimStyleUseOf(dim('aligned'))).toBe('linear');
    expect(dimStyleUseOf(dim('angular3pt'))).toBe('angular');
    expect(dimStyleUseOf(dim('angular'))).toBe('angular');
    expect(dimStyleUseOf(dim('radius'))).toBe('radius');
    expect(dimStyleUseOf(dim('diameter'))).toBe('diameter');
    expect(dimStyleUseOf(dim('ordinate'))).toBe('ordinate');
    expect(dimStyleUseOf({ kind: 'LARGE_RADIAL_DIMENSION' } as Entity['geom'])).toBe('radius');
    expect(dimStyleUseOf({ kind: 'ARC_DIMENSION' } as Entity['geom'])).toBeUndefined();
    expect(dimStyleUseOf({ kind: 'LEADER' } as Entity['geom'])).toBe('leader');
    expect(dimStyleUseOf({ kind: 'TOLERANCE' } as Entity['geom'])).toBe('leader');
    expect(dimStyleUseOf({ kind: 'LINE' } as Entity['geom'])).toBeUndefined();
  });

  it('give the style an object is drawn with', () => {
    const styles = new Map<string, DimStyleRecord>([
      ['27', { handle: '27', name: 'Standard', vars: {} }],
      ['28', { handle: '28', name: 'STANDARD$4', vars: {} }],
      ['29', { handle: '29', name: 'Other$4', vars: {} }],
    ]);
    const model = { tables: { dimStyles: styles } } as never;
    const radius = { kind: 'DIMENSION', dimType: 'radius', style: '27' } as never;
    expect(drawnDimStyle(model, radius)).toBe('28');
    expect(
      drawnDimStyle(model, { kind: 'DIMENSION', dimType: 'linear', style: '27' } as never),
    ).toBe('27');
    // A sub-style has none of its own; an unknown style is drawn as named.
    expect(childStyleOf(model, '28', 'radius')).toBeUndefined();
    expect(drawnDimStyle(model, { ...(radius as object), style: '99' } as never)).toBe('99');
  });
});

describe('the dialog fields for the xdata settings', () => {
  const field = (key: string) => DIMSTYLE_FIELDS.find((f) => f.key === key)!;

  it('sit on the tabs and in the groups AutoCAD has them', () => {
    expect(field('DIMBREAK')).toMatchObject({ tab: 'symbols', group: 'Dimension Break' });
    expect(field('DIMJAG')).toMatchObject({ tab: 'symbols', group: 'Linear jog dimension' });
    expect(field('DIMTALN')).toMatchObject({ tab: 'tolerances', kind: 'radio' });
    expect(field('DIMMZF')).toMatchObject({ tab: 'primary', label: 'Sub-units factor' });
    expect(field('DIMMZS')).toMatchObject({ tab: 'primary', label: 'Sub-unit suffix' });
    expect(field('DIMALTMZF')).toMatchObject({ tab: 'alternate', label: 'Sub-units factor' });
    expect(field('DIMALTMZS')).toMatchObject({ tab: 'alternate', kind: 'text' });
  });

  it('take sub-units once leading zeros are suppressed, alternate ones with alternate units on', () => {
    let v = dialogVars({});
    expect(field('DIMMZF').enabled!(v)).toBe(false);
    v = setField(v, 'DIMZIN.leading', true);
    expect(field('DIMMZF').enabled!(v)).toBe(true);
    v = setField(setField(v, 'DIMMZF', '10'), 'DIMMZS', 'mm');
    expect(v).toMatchObject({ DIMMZF: 10, DIMMZS: 'mm' });
    expect(setField(v, 'DIMMZF', '0')).toBe(v);
    expect(field('DIMALTMZS').enabled!(setField(v, 'DIMALTZ.leading', true))).toBe(false);
    const alt = setField(setField(v, 'DIMALT', true), 'DIMALTZ.leading', true);
    expect(field('DIMALTMZS').enabled!(alt)).toBe(true);
    expect(setField(v, 'DIMJAG', '0')).toBe(v);
    expect(setField(v, 'DIMJAG', '2')).toMatchObject({ DIMJAG: 2 });
    expect(setField(v, 'DIMBREAK', '0')).toMatchObject({ DIMBREAK: 0 });
    expect(setField(v, 'DIMTALN', '1')).toMatchObject({ DIMTALN: 1 });
  });
});
