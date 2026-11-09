import { describe, expect, it } from 'vitest';
import {
  PLOT_LINETYPES,
  POINTS_PER_MM,
  adaptDashes,
  dashPeriod,
  plotDashes,
} from '../src/linetypes';

const opts = { patternSize: 0.5, lineweight: 0.5, dotsVisible: true };

describe('plot style linetypes', () => {
  it('lists AutoCAD’s 31 plot style linetypes, Solid first and the ISO types last', () => {
    expect(PLOT_LINETYPES).toHaveLength(31);
    expect(PLOT_LINETYPES[0]!.name).toBe('Solid');
    expect(PLOT_LINETYPES[16]!.name).toBe('Sparse Dot');
    expect(PLOT_LINETYPES.slice(17).every((l) => l.iso && l.name.startsWith('ISO '))).toBe(true);
    expect(PLOT_LINETYPES.slice(0, 17).every((l) => !l.iso)).toBe(true);
    // Every pattern alternates dash (or dot) and gap, starting with a dash.
    for (const l of PLOT_LINETYPES) {
      expect(l.elements.length % 2).toBe(0);
      l.elements.forEach((e, i) => expect(i % 2 === 0 ? e >= 0 : e < 0).toBe(true));
    }
  });

  it('plots Solid and an unknown index continuous', () => {
    expect(plotDashes(0, opts)).toEqual([]);
    expect(plotDashes(31, opts)).toEqual([]);
  });

  it('sizes non-ISO patterns from the pattern size and the table’s scale factor', () => {
    // Dashed: 6 and 2 eighths of 0.5 in = 27 and 9 points.
    expect(plotDashes(1, opts)).toEqual([27, 9]);
    expect(plotDashes(1, { ...opts, patternSize: 1 })).toEqual([54, 18]);
    expect(plotDashes(1, { ...opts, nonIsoScale: 2 })).toEqual([54, 18]);
    // The lineweight does not change them.
    expect(plotDashes(1, { ...opts, lineweight: 2 })).toEqual([27, 9]);
  });

  it('sizes ISO patterns from the line width, ISO 128-20’s 12d dash and 3d gap', () => {
    const d = 0.5 * POINTS_PER_MM;
    const dashes = plotDashes(17, opts);
    expect(dashes[0]).toBeCloseTo(12 * d);
    expect(dashes[1]).toBeCloseTo(3 * d);
    // A thinner line than 0.13 mm takes 0.13 mm's pattern.
    expect(plotDashes(17, { ...opts, lineweight: 0 })[0]).toBeCloseTo(12 * 0.13 * POINTS_PER_MM);
  });

  it('draws dots as zero-length dashes, or the line’s width when the pen would not show one', () => {
    expect(plotDashes(2, opts)[0]).toBe(0);
    expect(plotDashes(2, { ...opts, dotsVisible: false })[0]).toBeCloseTo(0.5 * POINTS_PER_MM);
    expect(plotDashes(2, { ...opts, lineweight: 0, dotsVisible: false })[0]).toBe(0.5);
  });

  it('adapts a pattern so a subpath holds whole repetitions', () => {
    expect(dashPeriod([27, 9])).toBe(36);
    const a = adaptDashes([27, 9], 100);
    expect(dashPeriod(a) * 3).toBeCloseTo(100);
    // Shorter than half a repetition still holds one.
    expect(dashPeriod(adaptDashes([27, 9], 10))).toBeCloseTo(10);
    expect(adaptDashes([27, 9], 0)).toEqual([27, 9]);
  });
});
