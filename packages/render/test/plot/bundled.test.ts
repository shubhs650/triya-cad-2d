// The bundled plot style tables (M2-15; PRD FR-P1 "bundled monochrome/grayscale/default"):
// re-authored for Triya, found by the sheet name a layout or page setup gives.
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_PLOT_STYLE_TABLES,
  OBJECT_COLOR,
  OBJECT_LINETYPE,
  OBJECT_LINEWEIGHT,
  bundledPlotStyleTable,
} from '../../src/index';

describe('bundledPlotStyleTable', () => {
  it('lists the bundled files', () => {
    expect(Object.keys(BUNDLED_PLOT_STYLE_TABLES)).toEqual([
      'triya-default.ctb',
      'triya-monochrome.ctb',
      'triya-grayscale.ctb',
      'triya-default.stb',
      'triya-monochrome.stb',
    ]);
  });

  it('finds a table by its file name or by the name AutoCAD gives its own, in any case or folder', () => {
    const mono = BUNDLED_PLOT_STYLE_TABLES['triya-monochrome.ctb'];
    expect(bundledPlotStyleTable('triya-monochrome.ctb')).toBe(mono);
    expect(bundledPlotStyleTable('monochrome.ctb')).toBe(mono);
    expect(bundledPlotStyleTable('C:\\Plot Styles\\Monochrome.CTB')).toBe(mono);
    expect(bundledPlotStyleTable('/home/me/monochrome.ctb')).toBe(mono);
    expect(bundledPlotStyleTable('grayscale.ctb')).toBe(
      BUNDLED_PLOT_STYLE_TABLES['triya-grayscale.ctb'],
    );
    for (const name of ['acad.ctb', 'acadlt.ctb', 'default.ctb']) {
      expect(bundledPlotStyleTable(name)).toBe(BUNDLED_PLOT_STYLE_TABLES['triya-default.ctb']);
    }
    for (const name of ['acad.stb', 'acadlt.stb', 'default.stb']) {
      expect(bundledPlotStyleTable(name)).toBe(BUNDLED_PLOT_STYLE_TABLES['triya-default.stb']);
    }
    expect(bundledPlotStyleTable('monochrome.stb')).toBe(
      BUNDLED_PLOT_STYLE_TABLES['triya-monochrome.stb'],
    );
  });

  it('finds nothing for a table it does not bundle, or no name', () => {
    expect(bundledPlotStyleTable('vendor-pens.ctb')).toBeUndefined();
    expect(bundledPlotStyleTable('monochrome')).toBeUndefined();
    expect(bundledPlotStyleTable('')).toBeUndefined();
  });

  it('gives each colour-dependent table 255 styles, Color_1 to Color_255', () => {
    for (const name of ['triya-default.ctb', 'triya-monochrome.ctb', 'triya-grayscale.ctb']) {
      const t = BUNDLED_PLOT_STYLE_TABLES[name]!;
      expect(t.kind).toBe('ctb');
      expect(t.styles.map((s) => s.name)).toEqual(
        Array.from({ length: 255 }, (_, i) => `Color_${i + 1}`),
      );
    }
  });

  it('starts each named table with Normal', () => {
    for (const name of ['triya-default.stb', 'triya-monochrome.stb']) {
      const t = BUNDLED_PLOT_STYLE_TABLES[name]!;
      expect(t.kind).toBe('stb');
      expect(t.styles.map((s) => s.name)).toEqual(['Normal', 'Style 1']);
    }
  });

  it('overrides only colour (monochrome) or the grayscale flag (grayscale)', () => {
    const all = Object.values(BUNDLED_PLOT_STYLE_TABLES).flatMap((t) => t.styles);
    for (const s of all) {
      expect(s.linetype).toBe(OBJECT_LINETYPE);
      expect(s.lineweight).toBe(OBJECT_LINEWEIGHT);
      expect(s.screening).toBe(100);
      expect([s.fillStyle, s.endStyle, s.joinStyle]).toEqual([73, 4, 5]);
    }
    for (const s of BUNDLED_PLOT_STYLE_TABLES['triya-grayscale.ctb']!.styles) {
      expect([s.color, s.grayscale]).toEqual([OBJECT_COLOR, true]);
    }
    for (const s of BUNDLED_PLOT_STYLE_TABLES['triya-default.ctb']!.styles) {
      expect([s.color, s.grayscale]).toEqual([OBJECT_COLOR, false]);
    }
  });
});
