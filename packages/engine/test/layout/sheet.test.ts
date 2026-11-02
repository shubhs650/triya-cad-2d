// M1-18: a layout's paper and printable area from its page setup.
import { describe, expect, it } from 'vitest';
import { layoutSheet, paperUnitsPerMm, type Layout, type LayoutPlot } from '../../src/index';

const plot = (extra: Partial<LayoutPlot> = {}): LayoutPlot => ({
  paperSize: 'ISO_A4_(210.00_x_297.00_MM)',
  paperWidth: 210,
  paperHeight: 297,
  margins: { left: 7.5, bottom: 20, right: 7.5, top: 20 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 688,
  ...extra,
});

const layout = (p?: LayoutPlot): Layout => ({
  handle: 'AB',
  name: 'Layout1',
  tabOrder: 1,
  blockRecord: '1E',
  ...(p ? { plot: p } : {}),
});

describe('layoutSheet', () => {
  it('puts the paper-space origin at the printable area’s lower-left corner', () => {
    expect(layoutSheet(layout(plot()))).toEqual({
      paper: { minX: -7.5, minY: -20, maxX: 202.5, maxY: 277 },
      printable: { minX: 0, minY: 0, maxX: 195, maxY: 257 },
      unitsPerMm: 1,
    });
  });

  it('turns the sheet and its margins for a landscape (90°) plot', () => {
    // VP4.dxf Layout1: A4 at 90°, LIMMIN -20,-7.5 and LIMMAX 277,202.5.
    const s = layoutSheet(layout(plot({ rotation: 1 })))!;
    expect(s.paper).toEqual({ minX: -20, minY: -7.5, maxX: 277, maxY: 202.5 });
    expect(s.printable).toEqual({ minX: 0, minY: 0, maxX: 257, maxY: 195 });
  });

  it('maps each stated margin to the displayed side it lands on', () => {
    const margins = { left: 1, bottom: 2, right: 3, top: 4 };
    const sides = (rotation: 0 | 1 | 2 | 3) => {
      const s = layoutSheet(layout(plot({ margins, rotation })))!;
      return [
        s.printable.minX - s.paper.minX,
        s.printable.minY - s.paper.minY,
        s.paper.maxX - s.printable.maxX,
        s.paper.maxY - s.printable.maxY,
      ].map((v) => Math.round(v * 1e9) / 1e9);
    };
    expect(sides(0)).toEqual([1, 2, 3, 4]);
    // sample_AC1032 MyLayout: the displayed left margin is the stated top one.
    expect(sides(1)).toEqual([4, 1, 2, 3]);
    expect(sides(2)).toEqual([3, 4, 1, 2]);
    expect(sides(3)).toEqual([2, 3, 4, 1]);
  });

  it('measures an inch layout in inches', () => {
    // sample_AC1032 Layout1: ANSI A landscape, quarter-inch margins.
    const s = layoutSheet(
      layout(
        plot({
          paperWidth: 215.9,
          paperHeight: 279.4,
          margins: { left: 6.35, bottom: 6.35, right: 6.35, top: 6.35 },
          paperUnits: 'inches',
          rotation: 1,
        }),
      ),
    )!;
    expect(s.unitsPerMm).toBeCloseTo(1 / 25.4, 12);
    expect(s.paper.minX).toBeCloseTo(-0.25, 12);
    expect(s.paper.minY).toBeCloseTo(-0.25, 12);
    expect(s.paper.maxX).toBeCloseTo(10.75, 12);
    expect(s.paper.maxY).toBeCloseTo(8.25, 12);
  });

  it('moves the paper by the plot offset and scales it by the plot scale', () => {
    const s = layoutSheet(
      layout(plot({ origin: { x: 10, y: 5 }, scale: { numerator: 1, denominator: 2 } })),
    )!;
    expect(s.unitsPerMm).toBe(2);
    expect(s.paper).toEqual({ minX: -35, minY: -50, maxX: 385, maxY: 544 });
    expect(s.printable.minX).toBe(-20);
  });

  it('gives no sheet for a layout without a paper size', () => {
    expect(layoutSheet(layout())).toBeUndefined();
    expect(layoutSheet(layout(plot({ paperWidth: 0, paperHeight: 0 })))).toBeUndefined();
  });

  it('never lets margins wider than the paper turn the printable area inside out', () => {
    const s = layoutSheet(
      layout(plot({ margins: { left: 150, bottom: 0, right: 150, top: -3 } })),
    )!;
    expect(s.printable.maxX).toBe(s.printable.minX);
    expect(s.printable.maxY).toBe(s.paper.maxY);
  });
});

describe('paperUnitsPerMm', () => {
  it('takes a broken scale as 1:1 and pixels as millimetres', () => {
    expect(paperUnitsPerMm(plot({ scale: { numerator: 0, denominator: 1 } }))).toBe(1);
    expect(paperUnitsPerMm(plot({ paperUnits: 'pixels' }))).toBe(1);
    expect(
      paperUnitsPerMm(plot({ paperUnits: 'inches', scale: { numerator: 1, denominator: 1 } })),
    ).toBeCloseTo(1 / 25.4, 15);
  });
});
