// PlotResolver (M2-15, ARCHITECTURE.md §12): what an object plots with through a CTB or STB.
//
// AutoCAD's help (Plot Style Table Editor, "Table View and Form View Tabs"; "About Plot Style
// Tables") gives the rules encoded here:
// - A plot style colour, linetype, lineweight, end, join or fill style "overrides the object's
//   … at plot time"; "Use object …" keeps the object's.
// - CTB: "Every red object in a drawing is plotted the same way": the style is the one of the
//   object's ACI colour.
// - STB: "The first plot style in a named plot style table is NORMAL and represents an object's
//   default properties"; an object whose style the table lacks "plot[s] as Normal".
// - Convert to Grayscale "converts the object's colors to grayscale".
// - Screening: "Selecting 0 reduces the color to white. Selecting 100 displays the color at its
//   full intensity. The Enable Dithering option must be selected for screening."
//
// Where the help is silent, the common drafter expectation is encoded and marked as such.
// The caller resolves ByLayer and ByBlock first (`resolveColor` and friends do it for display),
// so the resolver sees the colour, lineweight, linetype and plot style name the object has.
// No DOM here (see plot-style-table.ts).

import type { Color, Handle } from '@triya/engine';
import { aciRgb, type Rgb } from '../style/aci';
import {
  OBJECT_COLOR,
  OBJECT_LINETYPE,
  type PlotStyle,
  type PlotStyleTable,
} from './plot-style-table';

/** An object as it plots before the plot style table, ByLayer and ByBlock already resolved. */
export interface PlotObject {
  /** ACI 1–255 or a true colour; anything else (ACI 0, ByLayer, ByBlock) plots as colour 7. */
  readonly color: Color;
  /** Hundredths of a millimetre, Default already replaced by `$LWDEFAULT`. */
  readonly lineweight: number;
  /** LTYPE handle, or undefined for Continuous. */
  readonly linetype?: Handle | undefined;
  /** Named tables: the plot style name; undefined plots as Normal. */
  readonly plotStyle?: string | undefined;
}

export type PlotLinetype =
  | { readonly kind: 'object'; readonly handle?: Handle }
  /** A plot style linetype (0–30): its dash pattern comes with the PDF writer (M2-16). */
  | {
      readonly kind: 'plot';
      readonly index: number;
      readonly adaptive: boolean;
      readonly patternSize: number;
    };

export type PlotEndStyle = 'butt' | 'square' | 'round' | 'diamond';
export type PlotJoinStyle = 'miter' | 'bevel' | 'round' | 'diamond';
export type PlotFillStyle =
  | 'solid'
  | 'checkerboard'
  | 'crosshatch'
  | 'diamonds'
  | 'horizontalBars'
  | 'slantLeft'
  | 'slantRight'
  | 'squareDots'
  | 'verticalBars';

export interface PlotProperties {
  /** The plot style applied; absent with no table (None) or a named table with no styles. */
  readonly style?: string;
  /** The colour on paper, after grayscale and screening. */
  readonly color: Rgb;
  /** The screening applied, 100 when none. */
  readonly screening: number;
  /** Millimetres; 0 is the thinnest line the device draws. */
  readonly lineweight: number;
  readonly linetype: PlotLinetype;
  readonly endStyle: PlotEndStyle;
  readonly joinStyle: PlotJoinStyle;
  readonly fillStyle: PlotFillStyle;
  /** 0 is Automatic. */
  readonly physicalPen: number;
  readonly virtualPen: number;
}

const END_STYLES: readonly PlotEndStyle[] = ['butt', 'square', 'round', 'diamond'];
const JOIN_STYLES: readonly PlotJoinStyle[] = ['miter', 'bevel', 'round', 'diamond'];
const FILL_STYLES: readonly PlotFillStyle[] = [
  'solid',
  'checkerboard',
  'crosshatch',
  'diamonds',
  'horizontalBars',
  'slantLeft',
  'slantRight',
  'squareDots',
  'verticalBars',
];

// "Use object end/join/fill style": objects carry none, and the help does not say what the
// device then does. Round ends and joins are how AutoCAD shows lineweights on screen and what
// drafters expect on paper; a fill is solid.
const OBJECT_END: PlotEndStyle = 'round';
const OBJECT_JOIN: PlotJoinStyle = 'round';
const OBJECT_FILL: PlotFillStyle = 'solid';

/** AutoCAD plots colour 7 black on paper (white on a dark screen). */
const COLOR_7: Rgb = [0, 0, 0];

export class PlotResolver {
  private readonly byName = new Map<string, PlotStyle>();

  /** With no table, objects plot with their own properties (the page setup's "None"). */
  constructor(readonly table?: PlotStyleTable) {
    if (table?.kind === 'stb') {
      for (const s of table.styles) {
        const key = s.name.toUpperCase();
        if (!this.byName.has(key)) this.byName.set(key, s);
      }
    }
  }

  /** The plot style an object takes, or undefined when nothing overrides its properties. */
  styleOf(o: PlotObject): PlotStyle | undefined {
    const t = this.table;
    if (!t) return undefined;
    if (t.kind === 'ctb') return t.styles[plotAci(o.color) - 1];
    // Normal is the first style; a missing name plots as Normal (AutoCAD keeps the name).
    return (o.plotStyle && this.byName.get(o.plotStyle.toUpperCase())) || t.styles[0];
  }

  resolve(o: PlotObject): PlotProperties {
    const s = this.styleOf(o);
    const own = objectRgb(o.color);
    if (!s) {
      return {
        color: own,
        screening: 100,
        lineweight: o.lineweight / 100,
        linetype: { kind: 'object', ...(o.linetype ? { handle: o.linetype } : {}) },
        endStyle: OBJECT_END,
        joinStyle: OBJECT_JOIN,
        fillStyle: OBJECT_FILL,
        physicalPen: 0,
        virtualPen: 0,
      };
    }
    let color = s.color === OBJECT_COLOR ? own : s.color;
    if (s.grayscale) color = gray(color);
    const screening = s.dither ? Math.min(100, Math.max(0, s.screening)) : 100;
    if (screening < 100) color = screen(color, screening);
    const weights = this.table!.lineweights;
    const lineweight =
      s.lineweight >= 0 && s.lineweight < weights.length
        ? weights[s.lineweight]!
        : o.lineweight / 100;
    return {
      style: s.name,
      color,
      screening,
      lineweight,
      linetype:
        s.linetype >= 0 && s.linetype < OBJECT_LINETYPE
          ? {
              kind: 'plot',
              index: s.linetype,
              adaptive: s.adaptiveLinetype,
              patternSize: s.linePatternSize,
            }
          : { kind: 'object', ...(o.linetype ? { handle: o.linetype } : {}) },
      endStyle: END_STYLES[s.endStyle] ?? OBJECT_END,
      joinStyle: JOIN_STYLES[s.joinStyle] ?? OBJECT_JOIN,
      fillStyle: FILL_STYLES[s.fillStyle - 64] ?? OBJECT_FILL,
      physicalPen: s.physicalPen,
      virtualPen: s.virtualPen,
    };
  }
}

/**
 * The ACI whose CTB style an object takes. A true colour takes colour 7's: AutoCAD's help does
 * not say which style a true or colour book colour takes in a CTB, and colour 7 is the common
 * drafter expectation (monochrome plots it black; the lineweight is colour 7's).
 */
function plotAci(c: Color): number {
  return c.kind === 'aci' && c.index >= 1 && c.index <= 255 ? c.index : 7;
}

function objectRgb(c: Color): Rgb {
  if (c.kind === 'rgb') return [c.r, c.g, c.b];
  const i = plotAci(c);
  return i === 7 ? COLOR_7 : aciRgb(i);
}

/**
 * Luma with the ITU-R BT.601 weights, the usual grey of a colour; AutoCAD does not document its
 * conversion.
 */
function gray([r, g, b]: Rgb): Rgb {
  const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  return [y, y, y];
}

/** Toward white: 0 is white, 100 the colour itself. */
function screen(c: Rgb, screening: number): Rgb {
  const k = screening / 100;
  const s = (v: number) => Math.round(255 - (255 - v) * k);
  return [s(c[0]), s(c[1]), s(c[2])];
}
