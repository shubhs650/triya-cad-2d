// M4-16 part 2: table cell data formats, as AutoCAD's Table Cell Format dialog sets them. The
// format strings are those acadsharp's AC1021–AC1032 samples hold (table A35).
import { describe, expect, it } from 'vitest';
import {
  DECIMAL_UNITS,
  cellWithDataFormat,
  cellWithTypedText,
  tableDataFormatOf,
  tableDataPreview,
  tableFormatString,
  tableTypedValue,
  tableValueText,
  withCellText,
  withCellsDataFormat,
  type DrawingUnits,
  type TableCell,
  type TableDataFormat,
  type TableGeometry,
} from '../../src/index';

const cell = (text: string, more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

const U = DECIMAL_UNITS;
const ARCH: DrawingUnits = { ...U, lunits: 4, luprec: 4 };

describe('the format strings a data format states', () => {
  it('are those the sample tables hold', () => {
    expect(tableFormatString({ type: 'angle', format: 0 })).toBe('%au0');
    expect(tableFormatString({ type: 'currency', symbol: '$', precision: 2 })).toBe(
      '%lu2%pr2%ps[$,]',
    );
    expect(tableFormatString({ type: 'percentage', precision: 2 })).toBe('%lu2%pr2%ps[,%]');
    expect(tableFormatString({ type: 'text', format: 1 })).toBe('%tc1');
  });

  it('state the other choices', () => {
    expect(tableFormatString({ type: 'angle', format: 1, precision: 3 })).toBe('%au1%pr3');
    expect(tableFormatString({ type: 'currency', symbol: '€', appendSymbol: true })).toBe(
      '%lu2%pr2%ps[,€]',
    );
    expect(tableFormatString({ type: 'decimal' })).toBe('');
    expect(tableFormatString({ type: 'decimal', format: 4, precision: 3 })).toBe('%lu4%pr3');
    expect(tableFormatString({ type: 'point', format: 2, precision: 1 })).toBe('%lu2%pr1');
    expect(tableFormatString({ type: 'date', date: 'dd/MM/yyyy' })).toBe('dd/MM/yyyy');
    expect(tableFormatString({ type: 'date' })).toBe('M/d/yyyy');
    expect(tableFormatString({ type: 'text', format: 0 })).toBe('');
    expect(tableFormatString({ type: 'text' })).toBe('');
    expect(tableFormatString({ type: 'general' })).toBe('');
    expect(tableFormatString({ type: 'whole' })).toBe('');
  });
});

describe('the data type a cell has', () => {
  const of = (more: Partial<TableCell>) => tableDataFormatOf(cell('x', more));
  it('reads the sample table’s cells', () => {
    expect(of({ value: { kind: 'double', n: 1.0472, units: 2 }, valueFormat: '%au0' })).toEqual({
      type: 'angle',
      format: 0,
    });
    expect(
      of({ value: { kind: 'double', n: 100, units: 16 }, valueFormat: '%lu2%pr2%ps[$,]' }),
    ).toEqual({ type: 'currency', symbol: '$', precision: 2 });
    expect(
      of({ value: { kind: 'double', n: 35, units: 32 }, valueFormat: '%lu2%pr2%ps[,%]' }),
    ).toEqual({ type: 'percentage', precision: 2 });
    expect(of({ value: { kind: 'date', time: 0 } })).toEqual({ type: 'date', date: 'M/d/yyyy' });
    expect(of({ value: { kind: 'point', point: [0, 0, 0], dimensions: 3 } })).toEqual({
      type: 'point',
    });
    expect(of({ value: { kind: 'long', n: 5 } })).toEqual({ type: 'whole' });
    expect(of({ valueFormat: '%tc1' })).toEqual({ type: 'text', format: 1 });
    expect(of({ value: { kind: 'double', n: 0.5, units: 0 } })).toEqual({ type: 'decimal' });
    expect(of({})).toEqual({ type: 'general' });
  });

  it('reads a format string alone, on text that did not read as the type', () => {
    expect(of({ valueFormat: '%lu2%pr2%ps[,€]' })).toEqual({
      type: 'currency',
      symbol: '€',
      appendSymbol: true,
      precision: 2,
    });
    expect(of({ valueFormat: '%au2%pr1' })).toEqual({ type: 'angle', format: 2, precision: 1 });
    expect(of({ valueFormat: '%lu4%pr3' })).toEqual({ type: 'decimal', format: 4, precision: 3 });
    expect(of({ valueFormat: 'dd/MM/yyyy' })).toEqual({ type: 'date', date: 'dd/MM/yyyy' });
    expect(
      of({ value: { kind: 'point', point: [1, 2, 0], dimensions: 2 }, valueFormat: '%lu2%pr1' }),
    ).toEqual({ type: 'point', format: 2, precision: 1 });
  });

  it('round-trips through its format string', () => {
    const formats: TableDataFormat[] = [
      { type: 'angle', format: 3, precision: 2 },
      { type: 'currency', symbol: '£', precision: 0 },
      { type: 'percentage', precision: 1 },
      { type: 'date', date: 'yyyy-MM-dd' },
      { type: 'decimal', format: 5, precision: 4 },
      { type: 'text', format: 4 },
      { type: 'general' },
    ];
    for (const f of formats) {
      expect(tableDataFormatOf(cell('', { valueFormat: tableFormatString(f) }))).toEqual(f);
    }
  });
});

describe('a value as its format shows it', () => {
  it('matches the sample table’s shown texts', () => {
    expect(tableValueText({ kind: 'double', n: 1.0471975511966, units: 2 }, '%au0', U)).toBe('60');
    expect(tableValueText({ kind: 'double', n: 100, units: 16 }, '%lu2%pr2%ps[$,]', U)).toBe(
      '$100.00',
    );
    expect(tableValueText({ kind: 'double', n: 35, units: 32 }, '%lu2%pr2%ps[,%]', U)).toBe(
      '35.00%',
    );
    expect(tableValueText({ kind: 'long', n: 5 }, '', U)).toBe('5');
    const nov15 = new Date(2024, 10, 15).getTime();
    expect(tableValueText({ kind: 'date', time: nov15 }, '', U)).toBe('11/15/2024');
  });

  it('shows the other formats', () => {
    expect(tableValueText({ kind: 'double', n: 0.5, units: 0 }, '', U)).toBe('0.5');
    expect(tableValueText({ kind: 'double', n: 18, units: 0 }, '%lu4%pr4', U)).toBe('1\'-6"');
    expect(tableValueText({ kind: 'double', n: Math.PI / 2, units: 2 }, '%au2%pr1', U)).toBe(
      '100.0g',
    );
    const nov15 = new Date(2024, 10, 15).getTime();
    expect(tableValueText({ kind: 'date', time: nov15 }, 'dd/MM/yyyy', U)).toBe('15/11/2024');
    expect(
      tableValueText({ kind: 'point', point: [1, 2.5, 3], dimensions: 3 }, '%lu2%pr2', U),
    ).toBe('1.00, 2.50, 3.00');
    expect(tableValueText({ kind: 'point', point: [1, 2.5, 3], dimensions: 2 }, '', U)).toBe(
      '1, 2.5',
    );
  });
});

describe('text read as a data type', () => {
  it('reads numbers with their signs and separators', () => {
    expect(tableTypedValue('$1,234.5', { type: 'currency' }, U)).toEqual({
      kind: 'double',
      n: 1234.5,
      units: 16,
    });
    expect(tableTypedValue('35%', { type: 'percentage' }, U)).toEqual({
      kind: 'double',
      n: 35,
      units: 32,
    });
    expect(tableTypedValue('7.6', { type: 'whole' }, U)).toEqual({ kind: 'long', n: 8 });
    expect(tableTypedValue('2*3', { type: 'decimal' }, U)).toEqual({
      kind: 'double',
      n: 6,
      units: 0,
    });
    expect(tableTypedValue('1\'6"', { type: 'decimal' }, ARCH)).toEqual({
      kind: 'double',
      n: 18,
      units: 0,
    });
    expect(tableTypedValue('abc', { type: 'decimal' }, U)).toBeUndefined();
    expect(tableTypedValue('', { type: 'currency' }, U)).toBeUndefined();
  });

  it('reads angles in the format’s units, or as typed with a unit', () => {
    const rad = (t: string, format?: number) => {
      const v = tableTypedValue(t, { type: 'angle', ...(format !== undefined && { format }) }, U);
      return v?.kind === 'double' ? Number(v.n.toFixed(6)) : undefined;
    };
    expect(rad('90')).toBe(Number((Math.PI / 2).toFixed(6)));
    expect(rad('100', 2)).toBe(Number((Math.PI / 2).toFixed(6)));
    expect(rad('1.5', 3)).toBe(1.5);
    expect(rad("45d30'")).toBe(Number(((45.5 * Math.PI) / 180).toFixed(6)));
    expect(rad('45°')).toBe(Number((Math.PI / 4).toFixed(6)));
    expect(rad('north')).toBeUndefined();
  });

  it('reads dates in the picture’s order', () => {
    const t = (text: string, date?: string) =>
      tableTypedValue(text, { type: 'date', ...(date && { date }) }, U);
    const nov15 = { kind: 'date', time: new Date(2024, 10, 15).getTime() };
    expect(t('11/15/2024')).toEqual(nov15);
    expect(t('15/11/2024', 'dd/MM/yyyy')).toEqual(nov15);
    expect(t('2024-11-15')).toEqual(nov15);
    expect(t('11/15/24')).toEqual(nov15);
    expect(t('1/2/99')).toEqual({ kind: 'date', time: new Date(1999, 0, 2).getTime() });
    expect(t('November 15, 2024')).toEqual(nov15);
    expect(t('13/45/2024')).toBeUndefined();
    expect(t('12345')).toBeUndefined();
    expect(t('soon')).toBeUndefined();
  });

  it('reads points of two or three coordinates', () => {
    expect(tableTypedValue('1, 2', { type: 'point' }, U)).toEqual({
      kind: 'point',
      point: [1, 2, 0],
      dimensions: 2,
    });
    expect(tableTypedValue('1;2;3', { type: 'point' }, U)).toEqual({
      kind: 'point',
      point: [1, 2, 3],
      dimensions: 3,
    });
    expect(tableTypedValue('1', { type: 'point' }, U)).toBeUndefined();
    expect(tableTypedValue('1,a', { type: 'point' }, U)).toBeUndefined();
  });

  it('keeps text for General and Text', () => {
    expect(tableTypedValue('12', { type: 'general' }, U)).toBeUndefined();
    expect(tableTypedValue('12', { type: 'text', format: 1 }, U)).toBeUndefined();
  });
});

describe('a cell given a data format', () => {
  it('reads its text as the type, shown in the format', () => {
    const c = cellWithDataFormat(cell('12.5'), { type: 'currency', symbol: '$' }, U);
    expect(c).toEqual(
      cell('$12.50', {
        value: { kind: 'double', n: 12.5, units: 16 },
        valueFormat: '%lu2%pr2%ps[$,]',
      }),
    );
  });

  it('keeps a value of the type’s kind, shown again', () => {
    const money = cell('$100.00', {
      value: { kind: 'double', n: 100, units: 16 },
      valueFormat: '%lu2%pr2%ps[$,]',
    });
    expect(cellWithDataFormat(money, { type: 'percentage', precision: 0 }, U)).toMatchObject({
      text: '100%',
      value: { kind: 'double', n: 100, units: 32 },
    });
    expect(cellWithDataFormat(money, { type: 'whole' }, U)).toEqual(
      cell('100', { value: { kind: 'long', n: 100 } }),
    );
    expect(cellWithDataFormat(money, { type: 'decimal', precision: 1 }, U)).toMatchObject({
      text: '100.0',
      value: { kind: 'double', n: 100, units: 0 },
    });
    const angle = cell('60', {
      value: { kind: 'double', n: Math.PI / 3, units: 2 },
      valueFormat: '%au0',
    });
    expect(cellWithDataFormat(angle, { type: 'angle', format: 3, precision: 3 }, U).text).toBe(
      '1.047r',
    );
    // An angle is not a plain number: its text is read again.
    expect(cellWithDataFormat(angle, { type: 'decimal' }, U).value).toEqual({
      kind: 'double',
      n: 60,
      units: 0,
    });
    const day = cell('11/15/2024', { value: { kind: 'date', time: 1 } });
    expect(cellWithDataFormat(day, { type: 'date', date: 'yyyy' }, U)).toMatchObject({
      value: { kind: 'date', time: 1 },
      valueFormat: 'yyyy',
    });
    const at = cell('1, 2', { value: { kind: 'point', point: [1, 2, 0], dimensions: 2 } });
    expect(cellWithDataFormat(at, { type: 'point', precision: 1 }, U).text).toBe('1.0, 2.0');
    expect(cellWithDataFormat(at, { type: 'whole' }, U).value).toBeUndefined();
  });

  it('keeps text that does not read, with the format for what is typed later', () => {
    const c = cellWithDataFormat(cell('TBD'), { type: 'decimal', precision: 2 }, U);
    expect(c).toEqual(cell('TBD', { valueFormat: '%pr2' }));
    expect(cellWithDataFormat(cell(''), { type: 'whole' }, U)).toEqual(cell(''));
  });

  it('turns a value back into text for General and Text', () => {
    const money = cell('$100.00', {
      value: { kind: 'double', n: 100, units: 16 },
      valueFormat: '%lu2%pr2%ps[$,]',
    });
    expect(cellWithDataFormat(money, { type: 'general' }, U)).toEqual(cell('$100.00'));
    expect(cellWithDataFormat(cell('pump'), { type: 'text', format: 1 }, U)).toEqual(
      cell('pump', { valueFormat: '%tc1' }),
    );
  });

  it('leaves block cells and covered cells alone', () => {
    const block = cell('', { type: 'block', block: 'A1' });
    expect(cellWithDataFormat(block, { type: 'whole' }, U)).toBe(block);
    const covered = cell('', { merged: true });
    expect(cellWithDataFormat(covered, { type: 'whole' }, U)).toBe(covered);
  });

  it('is given to every cell of a range', () => {
    const g = {
      cells: [
        [cell('1'), cell('2')],
        [cell('3'), cell('4')],
      ],
    } as unknown as TableGeometry;
    const out = withCellsDataFormat(g, { r0: 0, c0: 1, r1: 1, c1: 1 }, { type: 'whole' }, U);
    expect(out.cells.map((r) => r.map((c) => c.value?.kind ?? 'text'))).toEqual([
      ['text', 'long'],
      ['text', 'long'],
    ]);
  });
});

describe('text typed into a cell', () => {
  const money = cell('$100.00', {
    value: { kind: 'double', n: 100, units: 16 },
    valueFormat: '%lu2%pr2%ps[$,]',
  });

  it('is read by the cell’s data format', () => {
    expect(cellWithTypedText(money, '12.5', U)).toMatchObject({
      text: '$12.50',
      value: { kind: 'double', n: 12.5, units: 16 },
    });
    // Text that does not read is kept, a string again.
    expect(cellWithTypedText(money, 'n/a', U)).toEqual(
      cell('n/a', { valueFormat: '%lu2%pr2%ps[$,]' }),
    );
    expect(cellWithTypedText(money, '', U)).toEqual(cell('', { valueFormat: '%lu2%pr2%ps[$,]' }));
    expect(cellWithTypedText(cell('a'), '12', U)).toEqual(cell('12'));
  });

  it('goes through the cell editor’s withCellText, a block cell becoming text', () => {
    const g = {
      cells: [[money, cell('', { type: 'block', block: 'B' })]],
    } as unknown as TableGeometry;
    let out = withCellText(g, 0, 0, '7', U);
    expect(out.cells[0]![0]).toMatchObject({ text: '$7.00', value: { n: 7 } });
    out = withCellText(out, 0, 1, '5');
    expect(out.cells[0]![1]).toEqual(cell('5'));
  });
});

describe('the dialog’s Preview', () => {
  const now = new Date(2026, 10, 17).getTime();
  it('shows the first cell as OK would leave it', () => {
    expect(tableDataPreview(cell('12.5'), { type: 'currency', symbol: '£' }, U, now)).toBe(
      '£12.50',
    );
    expect(tableDataPreview(cell('pump'), { type: 'text', format: 1 }, U, now)).toBe('PUMP');
    expect(tableDataPreview(cell('pump'), { type: 'general' }, U, now)).toBe('pump');
  });

  it('shows a sample where the cell holds nothing of the type', () => {
    const p = (f: TableDataFormat) => tableDataPreview(cell('TBD'), f, U, now);
    expect(p({ type: 'decimal', precision: 2 })).toBe('1234.50');
    expect(p({ type: 'percentage', precision: 1 })).toBe('1234.5%');
    expect(p({ type: 'angle', format: 0, precision: 1 })).toBe('45.0');
    expect(p({ type: 'date', date: 'yyyy-MM-dd' })).toBe('2026-11-17');
    expect(p({ type: 'point', precision: 1 })).toBe('1234.5, 100.0, 0.0');
    expect(p({ type: 'whole' })).toBe('1234');
    expect(tableDataPreview(cell(''), { type: 'text', format: 1 }, U, now)).toBe('SAMPLE TEXT');
    expect(tableDataPreview(cell(''), { type: 'general' }, U, now)).toBe('');
  });
});

// M4-16 part 3: the Table Cell Format dialog's Additional Format... (conversion factor, prefix and
// suffix, decimal and thousands separators, leading and trailing zeros) and a point's X, Y and Z
// boxes, in the field format codes (`%ct8[f]`, `%ps[p,s]`, `%ds<c>`, `%th<c>`, `%zs<bits>`,
// `%pt<bits>`) the Field dialog writes.
describe('Additional Format and a point’s coordinates', () => {
  const metres: TableDataFormat = {
    type: 'decimal',
    format: 2,
    precision: 2,
    additional: { prefix: 'L=', suffix: ' m', decimal: ',', thousands: '.' },
  };

  it('are stated in the format string', () => {
    expect(
      tableFormatString({ type: 'decimal', format: 2, precision: 2, additional: { factor: 25.4 } }),
    ).toBe('%lu2%pr2%ct8[25.4]');
    expect(tableFormatString(metres)).toBe('%lu2%pr2%ps[L=, m]%ds44%th46');
    expect(
      tableFormatString({
        type: 'decimal',
        precision: 3,
        additional: { leading: true, trailing: true },
      }),
    ).toBe('%pr3%zs12');
    expect(
      tableFormatString({ type: 'angle', format: 0, precision: 2, additional: { trailing: true } }),
    ).toBe('%au0%pr2%zs8');
    expect(tableFormatString({ type: 'point', format: 2, precision: 1, coordinates: 3 })).toBe(
      '%lu2%pr1%pt3',
    );
    // All three coordinates are the default and state nothing.
    expect(tableFormatString({ type: 'point', precision: 1, coordinates: 7 })).toBe('%pr1');
    // Currency and Percentage keep %ps for their symbol: the Additional text is theirs.
    expect(
      tableFormatString({
        type: 'currency',
        symbol: '$',
        precision: 2,
        additional: { prefix: 'x', thousands: ',' },
      }),
    ).toBe('%lu2%pr2%ps[$,]%th44');
    expect(
      tableFormatString({ type: 'percentage', precision: 1, additional: { decimal: ',' } }),
    ).toBe('%lu2%pr1%ps[,%]%ds44');
    // A factor of 1, a period and no thousands separator are the defaults and state nothing.
    expect(
      tableFormatString({
        type: 'decimal',
        precision: 2,
        additional: { factor: 1, decimal: '.', prefix: '', suffix: '' },
      }),
    ).toBe('%pr2');
  });

  it('read back from the format string', () => {
    const formats: TableDataFormat[] = [
      metres,
      { type: 'decimal', format: 2, precision: 2, additional: { factor: 25.4, trailing: true } },
      { type: 'decimal', precision: 3, additional: { leading: true, thousands: ' ' } },
      { type: 'angle', format: 0, precision: 2, additional: { factor: 2, trailing: true } },
      { type: 'point', format: 2, precision: 1, coordinates: 3, additional: { suffix: ' m' } },
      {
        type: 'currency',
        symbol: '€',
        appendSymbol: true,
        precision: 2,
        additional: { decimal: ',' },
      },
      { type: 'percentage', precision: 1, additional: { thousands: ',' } },
    ];
    for (const f of formats) {
      expect(tableDataFormatOf(cell('', { valueFormat: tableFormatString(f) }))).toEqual(f);
    }
    // A number with a prefix or suffix is not a currency: its value says so.
    expect(
      tableDataFormatOf(
        cell('$12.00', {
          value: { kind: 'double', n: 12, units: 0 },
          valueFormat: '%lu2%pr2%ps[$,]',
        }),
      ),
    ).toEqual({ type: 'decimal', format: 2, precision: 2, additional: { prefix: '$' } });
  });

  it('show a value', () => {
    const d = (n: number) => ({ kind: 'double', n, units: 0 }) as const;
    expect(tableValueText(d(1234567.5), tableFormatString(metres), U)).toBe('L=1.234.567,50 m');
    expect(tableValueText(d(10), '%lu2%pr2%ct8[25.4]', U)).toBe('254.00');
    expect(tableValueText(d(10), '%lu2%pr2%ct8[25.4]%zs8', U)).toBe('254');
    expect(tableValueText(d(0.5), '%lu2%pr2%zs4', U)).toBe('.50');
    expect(tableValueText(d(1234.5), '%lu2%pr2%th32', U)).toBe('1 234.50');
    const p = { kind: 'point', point: [1, 2, 3], dimensions: 3 } as const;
    expect(tableValueText(p, '%lu2%pr1%pt3', U)).toBe('1.0, 2.0');
    expect(tableValueText(p, '%lu2%pr1%pt4', U)).toBe('3.0');
    expect(tableValueText(p, '%lu2%pr1%pt5', U)).toBe('1.0, 3.0');
    // The prefix and suffix go round the point, not each coordinate.
    expect(tableValueText(p, '%lu2%pr1%ps[(,)]%pt3', U)).toBe('(1.0, 2.0)');
    expect(tableValueText(p, '%lu2%pr1%ds44', U)).toBe('1,0; 2,0; 3,0');
  });

  it('read typed text back', () => {
    expect(tableTypedValue('L=1.234,5 m', metres, U)).toEqual({
      kind: 'double',
      n: 1234.5,
      units: 0,
    });
    expect(tableTypedValue('1234,5', metres, U)).toEqual({ kind: 'double', n: 1234.5, units: 0 });
    expect(tableTypedValue('L=x', metres, U)).toBeUndefined();
    const spaced: TableDataFormat = { type: 'decimal', additional: { thousands: ' ' } };
    expect(tableTypedValue('1 234.5', spaced, U)).toEqual({ kind: 'double', n: 1234.5, units: 0 });
    const comma: TableDataFormat = { type: 'point', precision: 1, additional: { decimal: ',' } };
    expect(tableTypedValue('1,5; 2,5', comma, U)).toEqual({
      kind: 'point',
      point: [1.5, 2.5, 0],
      dimensions: 2,
    });
    const currency: TableDataFormat = {
      type: 'currency',
      symbol: '€',
      appendSymbol: true,
      precision: 2,
      additional: { decimal: ',', thousands: '.' },
    };
    expect(tableTypedValue('1.200,50€', currency, U)).toEqual({
      kind: 'double',
      n: 1200.5,
      units: 16,
    });
  });

  it('format a cell, the typed number kept and the factor applied as it is shown', () => {
    const inches: TableDataFormat = {
      type: 'decimal',
      format: 2,
      precision: 1,
      additional: { factor: 1 / 25.4, suffix: '"' },
    };
    const c = cellWithDataFormat(cell('254'), inches, U);
    expect(c.value).toEqual({ kind: 'double', n: 254, units: 0 });
    expect(c.text).toBe('10.0"');
    expect(cellWithTypedText(c, '508', U).text).toBe('20.0"');
    const pt = cellWithDataFormat(
      cell('1,2,3'),
      { type: 'point', precision: 0, coordinates: 3 },
      U,
    );
    expect(pt.value).toEqual({ kind: 'point', point: [1, 2, 3], dimensions: 3 });
    expect(pt.text).toBe('1, 2');
  });

  it('show in the Preview', () => {
    expect(tableDataPreview(cell(''), metres, U, 0)).toBe('L=1.234,50 m');
    expect(tableDataPreview(cell(''), { type: 'point', precision: 1, coordinates: 6 }, U, 0)).toBe(
      '100.0, 0.0',
    );
  });
});
