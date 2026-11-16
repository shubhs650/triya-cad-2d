// M4-11: the Geometric Tolerance dialog's fields and the TOLERANCE text they stand for, written
// as AutoCAD writes it (the acadsharp corpus samples' three frames) and read back.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_GDT_FRAME,
  GDT_CHARACTERISTICS,
  GDT_MATERIALS,
  toleranceFrame,
  toleranceText,
  type GdtFrame,
  type GdtRow,
} from '../../src/index';

const row = (r: Partial<GdtRow>): GdtRow => ({ ...EMPTY_GDT_FRAME.rows[0], ...r });
const frame = (f: Partial<GdtFrame>): GdtFrame => ({ ...EMPTY_GDT_FRAME, ...f });

describe('toleranceText', () => {
  it('writes the corpus samples’ frames as AutoCAD wrote them', () => {
    // Position with a diameter symbol; profile of a surface; zone height .5; identifier 5.
    const sample = frame({
      rows: [
        row({ symbol: 'j', tolerance1: { diameter: true, value: '', material: '' } }),
        row({ symbol: 'd' }),
      ],
      height: '.5',
      datumIdentifier: '5',
    });
    expect(toleranceText(sample)).toBe(
      '{\\Fgdt;j}%%v{\\Fgdt;n}%%v%%v%%v%%v\n{\\Fgdt;d}%%v%%v%%v%%v%%v\n.5\n5',
    );
    expect(toleranceText(frame({ height: '99', datumIdentifier: 'a' }))).toBe('99\na');
    expect(toleranceText(frame({ projectedZone: true }))).toBe('{\\Fgdt;p}');
  });

  it('writes every field: diameters, values, material conditions, datums and the zone', () => {
    const full = frame({
      rows: [
        row({
          symbol: 'j',
          tolerance1: { diameter: true, value: '0.1', material: 'm' },
          tolerance2: { diameter: false, value: '0.05', material: 'l' },
          datum1: { value: 'A', material: '' },
          datum2: { value: 'B', material: 'm' },
          datum3: { value: 'C', material: 's' },
        }),
        row({ symbol: 'j', tolerance1: { diameter: true, value: '0.02', material: '' } }),
      ],
      height: '12',
      projectedZone: true,
      datumIdentifier: 'D',
    });
    const text = toleranceText(full);
    expect(text).toBe(
      [
        '{\\Fgdt;j}%%v{\\Fgdt;n}0.1{\\Fgdt;m}%%v0.05{\\Fgdt;l}%%vA%%vB{\\Fgdt;m}%%vC{\\Fgdt;s}',
        '{\\Fgdt;j}%%v{\\Fgdt;n}0.02%%v%%v%%v%%v',
        '12{\\Fgdt;p}',
        'D',
      ].join('\n'),
    );
    expect(toleranceFrame(text)).toEqual(full);
  });

  it('leaves empty lines out but keeps an empty first row before a second', () => {
    expect(toleranceText(EMPTY_GDT_FRAME)).toBe('');
    const second = frame({ rows: [EMPTY_GDT_FRAME.rows[0], row({ symbol: 'c' })] });
    expect(toleranceText(second)).toBe('%%v%%v%%v%%v%%v\n{\\Fgdt;c}%%v%%v%%v%%v%%v');
    expect(toleranceFrame(toleranceText(second))).toEqual(second);
    expect(toleranceText(frame({ datumIdentifier: 'A' }))).toBe('A');
  });
});

describe('toleranceFrame', () => {
  it('reads the corpus samples’ frames, with ^J or newlines between lines', () => {
    expect(
      toleranceFrame('{\\Fgdt;j}%%v{\\Fgdt;n}%%v%%v%%v%%v^J{\\Fgdt;d}%%v%%v%%v%%v%%v^J.5^J5'),
    ).toEqual(
      frame({
        rows: [
          row({ symbol: 'j', tolerance1: { diameter: true, value: '', material: '' } }),
          row({ symbol: 'd' }),
        ],
        height: '.5',
        datumIdentifier: '5',
      }),
    );
    expect(toleranceFrame('99\na')).toEqual(frame({ height: '99', datumIdentifier: 'a' }));
    expect(toleranceFrame('{\\Fgdt;p}')).toEqual(frame({ projectedZone: true }));
  });

  it('reads one line after the rows as the zone when it is a number or has the symbol', () => {
    expect(toleranceFrame('A')).toEqual(frame({ datumIdentifier: 'A' }));
    expect(toleranceFrame('12')).toEqual(frame({ height: '12' }));
    expect(toleranceFrame('x{\\Fgdt;p}')).toEqual(frame({ height: 'x', projectedZone: true }));
    expect(toleranceFrame('')).toEqual(EMPTY_GDT_FRAME);
  });

  it('takes font switches without braces or in capitals, and keeps other text as values', () => {
    const f = toleranceFrame('\\fGDT;J%%v\\Fgdt;n0.1\\Fgdt;M%%vx{\\Fgdt;q}%%vA{\\Fgdt;z}');
    expect(f.rows[0]).toEqual(
      row({
        symbol: 'j',
        tolerance1: { diameter: true, value: '0.1', material: 'm' },
        tolerance2: { diameter: false, value: 'x{\\Fgdt;q}', material: '' },
        datum1: { value: 'A{\\Fgdt;z}', material: '' },
      }),
    );
    // A symbol compartment with more than the symbol is not a symbol the dialog offers.
    expect(toleranceFrame('{\\Fgdt;j}x%%v%%v%%v%%v%%v').rows[0].symbol).toBe('');
  });

  it('lists the Symbol and Material Condition dialogs’ choices', () => {
    expect(GDT_CHARACTERISTICS.map((c) => c.letter).join('')).toBe('jrifbagceudkht');
    expect(GDT_MATERIALS.map((m) => m.letter)).toEqual(['m', 'l', 's']);
  });
});
