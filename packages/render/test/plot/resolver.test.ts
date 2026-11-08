// PlotResolver (M2-15): what an object plots with through a CTB or STB, per AutoCAD's Plot
// Style Table Editor help ("Table View and Form View Tabs"):
// - Color: "The default setting for plot style color is Use Object Color. If you assign a plot
//   style color, the color overrides the object's color at plot time."
// - Convert to Grayscale: "Converts the object's colors to grayscale".
// - Screening: "Selecting 0 reduces the color to white. Selecting 100 displays the color at its
//   full intensity. The Enable Dithering option must be selected for screening."
// - Linetype and lineweight: a plot style value "overrides the object's ... at plot time".
// - CTB: "Every red object in a drawing is plotted the same way" (About Plot Style Tables).
// - STB: "The first plot style in a named plot style table is NORMAL and represents an object's
//   default properties"; objects whose style is missing "plot as Normal".
import type { Color } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  OBJECT_COLOR,
  PlotResolver,
  bundledPlotStyleTable,
  newPlotStyle,
  type PlotStyle,
  type PlotStyleTable,
} from '../../src/index';

const aci = (index: number): Color => ({ kind: 'aci', index });
const rgb = (r: number, g: number, b: number): Color => ({ kind: 'rgb', r, g, b });

const LINEWEIGHTS = [0, 0.05, 0.09, 0.1, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.5, 0.7];

/** A CTB whose ACI `n` style is `edit(Color_n)`; the others use the object's properties. */
function ctb(edits: Record<number, Partial<PlotStyle>>): PlotStyleTable {
  return {
    kind: 'ctb',
    description: '',
    scaleFactor: 1,
    applyFactor: false,
    lineweightUnits: 'mm',
    lineweights: LINEWEIGHTS,
    styles: Array.from({ length: 255 }, (_, i) => ({
      ...newPlotStyle(`Color_${i + 1}`),
      ...edits[i + 1],
    })),
  };
}

function stb(...styles: PlotStyle[]): PlotStyleTable {
  return {
    kind: 'stb',
    description: '',
    scaleFactor: 1,
    applyFactor: false,
    lineweightUnits: 'mm',
    lineweights: LINEWEIGHTS,
    styles: [newPlotStyle('Normal'), ...styles],
  };
}

describe('PlotResolver without a plot style table (None)', () => {
  const none = new PlotResolver();

  it('plots the object’s own colour, ACI 7 black on paper', () => {
    expect(none.resolve({ color: aci(1), lineweight: 25 }).color).toEqual([255, 0, 0]);
    expect(none.resolve({ color: aci(7), lineweight: 25 }).color).toEqual([0, 0, 0]);
    expect(none.resolve({ color: rgb(10, 20, 30), lineweight: 25 }).color).toEqual([10, 20, 30]);
  });

  it('reads a colour that is not a plain colour (ByLayer, ByBlock, ACI 0) as colour 7', () => {
    for (const c of [aci(0), { kind: 'byLayer' } as Color, { kind: 'byBlock' } as Color]) {
      expect(none.resolve({ color: c, lineweight: 25 }).color).toEqual([0, 0, 0]);
    }
  });

  it('keeps the object’s lineweight (in millimetres), linetype and full intensity', () => {
    const p = none.resolve({ color: aci(3), lineweight: 50, linetype: '1A' });
    expect(p).toEqual({
      color: [0, 255, 0],
      screening: 100,
      lineweight: 0.5,
      linetype: { kind: 'object', handle: '1A' },
      endStyle: 'round',
      joinStyle: 'round',
      fillStyle: 'solid',
      physicalPen: 0,
      virtualPen: 0,
    });
  });
});

describe('PlotResolver with a colour-dependent table (CTB)', () => {
  it('picks the style of the object’s ACI colour', () => {
    const r = new PlotResolver(ctb({ 1: { lineweight: 12 }, 3: { color: [0, 0, 255] } }));
    const red = r.resolve({ color: aci(1), lineweight: 25 });
    expect(red.style).toBe('Color_1');
    expect(red.color).toEqual([255, 0, 0]);
    expect(red.lineweight).toBe(0.7);
    const green = r.resolve({ color: aci(3), lineweight: 25 });
    expect(green.style).toBe('Color_3');
    expect(green.color).toEqual([0, 0, 255]);
    expect(green.lineweight).toBe(0.25);
  });

  it('plots a true-colour object with the colour 7 style, keeping its own colour', () => {
    // AutoCAD's help does not say which CTB style a true colour takes; colour 7 is the common
    // drafter expectation (monochrome.ctb plots it black, its lineweight is colour 7's).
    const r = new PlotResolver(ctb({ 7: { lineweight: 11 } }));
    const p = r.resolve({ color: rgb(200, 100, 50), lineweight: 25 });
    expect(p.style).toBe('Color_7');
    expect(p.color).toEqual([200, 100, 50]);
    expect(p.lineweight).toBe(0.5);
  });

  it('takes the lineweight from the table, or the object’s for "use object lineweight"', () => {
    const r = new PlotResolver(ctb({ 1: { lineweight: 0 }, 2: { lineweight: 255 } }));
    expect(r.resolve({ color: aci(1), lineweight: 100 }).lineweight).toBe(0);
    expect(r.resolve({ color: aci(2), lineweight: 100 }).lineweight).toBe(1);
    // An index past the end of the lineweight table is read as the object's.
    const past = new PlotResolver(ctb({ 1: { lineweight: 40 } }));
    expect(past.resolve({ color: aci(1), lineweight: 30 }).lineweight).toBe(0.3);
  });

  it('converts to grayscale (luma) after choosing the colour', () => {
    const r = new PlotResolver(
      ctb({ 1: { grayscale: true }, 2: { grayscale: true, color: [0, 0, 255] } }),
    );
    expect(r.resolve({ color: aci(1), lineweight: 25 }).color).toEqual([76, 76, 76]);
    expect(r.resolve({ color: aci(2), lineweight: 25 }).color).toEqual([29, 29, 29]);
  });

  it('screens toward white, only with dithering on', () => {
    const r = new PlotResolver(
      ctb({
        1: { screening: 50, color: [0, 0, 0] },
        2: { screening: 0 },
        3: { screening: 25, dither: false },
      }),
    );
    const half = r.resolve({ color: aci(1), lineweight: 25 });
    expect(half.screening).toBe(50);
    expect(half.color).toEqual([128, 128, 128]);
    expect(r.resolve({ color: aci(2), lineweight: 25 }).color).toEqual([255, 255, 255]);
    const undithered = r.resolve({ color: aci(3), lineweight: 25 });
    expect(undithered.screening).toBe(100);
    expect(undithered.color).toEqual([0, 255, 0]);
  });

  it('overrides linetype, ends, joins, fills and pens when the style sets them', () => {
    const r = new PlotResolver(
      ctb({
        5: {
          linetype: 2,
          adaptiveLinetype: false,
          linePatternSize: 0.75,
          endStyle: 0,
          joinStyle: 1,
          fillStyle: 66,
          physicalPen: 4,
          virtualPen: 9,
        },
      }),
    );
    const p = r.resolve({ color: aci(5), lineweight: 25, linetype: '2B' });
    expect(p.linetype).toEqual({ kind: 'plot', index: 2, adaptive: false, patternSize: 0.75 });
    expect(p.endStyle).toBe('butt');
    expect(p.joinStyle).toBe('bevel');
    expect(p.fillStyle).toBe('crosshatch');
    expect([p.physicalPen, p.virtualPen]).toEqual([4, 9]);
  });

  it('ignores a plot style name, which only a named table uses', () => {
    const r = new PlotResolver(ctb({ 1: { lineweight: 12 } }));
    expect(r.resolve({ color: aci(1), lineweight: 25, plotStyle: 'Color_2' }).lineweight).toBe(0.7);
  });
});

describe('PlotResolver with a named table (STB)', () => {
  const r = new PlotResolver(
    stb(
      { ...newPlotStyle('Thick'), lineweight: 12 },
      { ...newPlotStyle('Red pen'), color: [255, 0, 0], screening: 50 },
    ),
  );

  it('picks the style the object names, whatever its case', () => {
    const p = r.resolve({ color: aci(5), lineweight: 25, plotStyle: 'thick' });
    expect(p.style).toBe('Thick');
    expect(p.lineweight).toBe(0.7);
    expect(p.color).toEqual([0, 0, 255]);
    const red = r.resolve({ color: aci(5), lineweight: 25, plotStyle: 'Red pen' });
    expect(red.color).toEqual([255, 128, 128]);
  });

  it('plots an object with no style, or one missing from the table, as Normal', () => {
    for (const plotStyle of [undefined, 'Gone']) {
      const p = r.resolve({ color: aci(5), lineweight: 25, plotStyle });
      expect(p.style).toBe('Normal');
      expect(p.color).toEqual([0, 0, 255]);
      expect(p.lineweight).toBe(0.25);
    }
  });

  it('uses the object’s properties when the table has no style at all', () => {
    const empty = new PlotResolver({ ...stb(), styles: [] });
    const p = empty.resolve({ color: aci(1), lineweight: 35 });
    expect(p.style).toBeUndefined();
    expect(p.color).toEqual([255, 0, 0]);
  });
});

describe('the bundled tables through the resolver', () => {
  const objects: Color[] = [aci(1), aci(7), aci(254), rgb(0, 128, 255)];

  it('monochrome plots everything black at the object’s lineweight', () => {
    const r = new PlotResolver(bundledPlotStyleTable('monochrome.ctb'));
    for (const color of objects) {
      const p = r.resolve({ color, lineweight: 35 });
      expect(p.color).toEqual([0, 0, 0]);
      expect(p.lineweight).toBe(0.35);
    }
  });

  it('grayscale plots each colour as its grey', () => {
    const r = new PlotResolver(bundledPlotStyleTable('grayscale.ctb'));
    expect(r.resolve({ color: aci(1), lineweight: 25 }).color).toEqual([76, 76, 76]);
    expect(r.resolve({ color: aci(7), lineweight: 25 }).color).toEqual([0, 0, 0]);
  });

  it('the default tables plot every object as it is', () => {
    for (const name of ['acad.ctb', 'acad.stb']) {
      const r = new PlotResolver(bundledPlotStyleTable(name));
      expect(r.resolve({ color: aci(1), lineweight: 25 }).color).toEqual([255, 0, 0]);
      expect(r.resolve({ color: aci(1), lineweight: 25, plotStyle: 'Style 1' }).color).toEqual([
        255, 0, 0,
      ]);
    }
  });

  it('a style colour is never the object colour sentinel in the monochrome table', () => {
    for (const s of bundledPlotStyleTable('monochrome.ctb')!.styles) {
      expect(s.color).not.toBe(OBJECT_COLOR);
    }
  });
});
