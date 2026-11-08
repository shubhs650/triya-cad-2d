// Plot style tables on disk (M2-15):
// - the bundled tables in assets/plotstyles are the bytes `writePlotStyleTable` makes of
//   `BUNDLED_PLOT_STYLE_TABLES` (`pnpm plotstyles:build` rewrites them after a change);
// - a CTB and an STB laid out by another writer, ezdxf's `acadctb` add-on
//   (scripts/plotstyles/ezdxf-tables.py), read back as that script set them and plot as their
//   settings say.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_PLOT_STYLE_TABLES,
  OBJECT_COLOR,
  OBJECT_LINEWEIGHT,
  PlotResolver,
  parsePlotStyleTable,
  writePlotStyleTable,
} from '@triya/render';
import { describe, expect, it } from 'vitest';

const ASSETS = fileURLToPath(new URL('../../../../assets/plotstyles/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../fixtures/plotstyles/', import.meta.url));

if (process.env['TRIYA_UPDATE_PLOTSTYLES'] === '1') {
  for (const [name, table] of Object.entries(BUNDLED_PLOT_STYLE_TABLES)) {
    writeFileSync(ASSETS + name, writePlotStyleTable(table));
  }
}

describe('assets/plotstyles', () => {
  for (const [name, table] of Object.entries(BUNDLED_PLOT_STYLE_TABLES)) {
    it(`${name} is the bundled table as written`, () => {
      const bytes = new Uint8Array(readFileSync(ASSETS + name));
      expect(bytes).toEqual(writePlotStyleTable(table));
      expect(parsePlotStyleTable(bytes)).toEqual(table);
    });
  }
});

describe('tables written by ezdxf', () => {
  const ctb = parsePlotStyleTable(new Uint8Array(readFileSync(FIXTURES + 'ezdxf.ctb')));
  const stb = parsePlotStyleTable(new Uint8Array(readFileSync(FIXTURES + 'ezdxf.stb')));

  it('reads the CTB header and its 255 styles', () => {
    expect(ctb.kind).toBe('ctb');
    expect(ctb.description).toBe('Triya test pens');
    expect([ctb.scaleFactor, ctb.applyFactor]).toEqual([2, true]);
    expect(ctb.lineweights).toHaveLength(27);
    expect(ctb.lineweights[13]).toBe(0.5);
    expect(ctb.styles).toHaveLength(255);
    expect(ctb.styles[1]).toMatchObject({
      name: 'Color_2',
      color: OBJECT_COLOR,
      lineweight: OBJECT_LINEWEIGHT,
    });
  });

  it('reads each setting the script made', () => {
    expect(ctb.styles[0]).toMatchObject({ color: [0, 0, 0], lineweight: 13 });
    expect(ctb.styles[4]).toMatchObject({
      color: [0x12, 0x34, 0x56],
      grayscale: true,
      dither: false,
      screening: 40,
    });
    expect(ctb.styles[6]).toMatchObject({
      lineweight: 8,
      linetype: 2,
      adaptiveLinetype: false,
      linePatternSize: 0.75,
      endStyle: 0,
      joinStyle: 1,
      fillStyle: 66,
    });
    expect(ctb.styles[199]).toMatchObject({ physicalPen: 3, virtualPen: 12 });
  });

  it('plots through the CTB as its settings say', () => {
    const r = new PlotResolver(ctb);
    expect(r.resolve({ color: { kind: 'aci', index: 1 }, lineweight: 25 })).toMatchObject({
      color: [0, 0, 0],
      lineweight: 0.5,
    });
    // Grey of #123456; screening is not applied with dithering off.
    expect(r.resolve({ color: { kind: 'aci', index: 5 }, lineweight: 25 })).toMatchObject({
      color: [46, 46, 46],
      screening: 100,
      lineweight: 0.25,
    });
    expect(r.resolve({ color: { kind: 'aci', index: 7 }, lineweight: 50 })).toMatchObject({
      lineweight: 0.25,
      linetype: { kind: 'plot', index: 2, adaptive: false, patternSize: 0.75 },
      endStyle: 'butt',
      joinStyle: 'bevel',
      fillStyle: 'crosshatch',
    });
  });

  it('reads the STB’s named styles, Normal first', () => {
    expect(stb.kind).toBe('stb');
    expect(stb.description).toBe('Triya named styles');
    expect(stb.styles.map((s) => s.name)).toEqual(['Normal', 'Red', 'Screened', 'Thick']);
    expect(stb.styles[1]).toMatchObject({ color: [255, 0, 0], namedColor: true });
    expect(stb.styles[3]).toMatchObject({ description: '0.70 mm', lineweight: 17 });
    const r = new PlotResolver(stb);
    const blue = { kind: 'aci', index: 5 } as const;
    expect(r.resolve({ color: blue, lineweight: 25, plotStyle: 'Thick' }).lineweight).toBe(0.7);
    expect(r.resolve({ color: blue, lineweight: 25, plotStyle: 'Red' }).color).toEqual([255, 0, 0]);
    expect(r.resolve({ color: blue, lineweight: 25, plotStyle: 'Screened' }).color).toEqual([
      179, 179, 255,
    ]);
  });

  it('writes both back so that they read the same', () => {
    expect(parsePlotStyleTable(writePlotStyleTable(ctb))).toEqual(ctb);
    expect(parsePlotStyleTable(writePlotStyleTable(stb))).toEqual(stb);
  });
});
