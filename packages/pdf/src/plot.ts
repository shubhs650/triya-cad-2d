// Plotting onto a PDF page (ARCHITECTURE.md §12, the vector `PdfSink`): render paths with
// what each object plots with after the plot style table (`PlotResolver.resolve` in
// packages/render/src/plot gives it; `PlotPaint` is the part of its `PlotProperties` a page
// needs, so this package takes them without importing the renderer).
//
// AutoCAD's rules encoded here:
// - Lineweights plot at their width in millimetres on paper whatever the plot scale, unless
//   the plot scales lineweights ("Scale lineweights" in the Page Setup, `lineweightScale`).
//   0 is the thinnest line the device draws, PDF's zero-width line. "Plot object lineweights"
//   off plots every line at 0.
// - End and join styles plot as the style says. PDF has no diamond end or join: a diamond end
//   plots square (projecting, the nearest shape that reaches as far) and a diamond join miters
//   (the nearest that keeps a point). Ours; AutoCAD's help does not describe the shapes.
// - A plot style linetype replaces the object's (its continuous path dashed with the style's
//   pattern, `linetypes.ts`); "Use object linetype" keeps the dashes tessellation made.
// - Object transparency plots as PDF constant alpha (the "Plot transparency" option).
// - A plot style's fill style fills an object's filled areas with its pattern (`fills.ts`) in
//   the object's plot colour; gradient fills and raster images paint their own colours.
// - A POINT (PDMODE 0) plots as a dot, an XLINE or RAY as the part of it on the plot area.
// - TrueType text plots as text in its own font, embedded as a subset (`fonts.ts`), so it stays
//   searchable, unless the plot converts all text to geometry (AutoCAD's PDF option "Convert
//   all text to geometry") or the font cannot be embedded; then its glyph outlines are filled.
// - A PDF underlay plots its page's own content (`import.ts`: vectors stay vectors, text stays
//   text), clipped to its boundary while clipping is on, with its fade, contrast and monochrome
//   as the screen shows them on white paper. Plot style tables do not touch it: it keeps the
//   PDF's colours, as a raster image does (ours: AutoCAD's help is silent). A page the plot
//   cannot read (no file supplied, encrypted, damaged past reading) plots as the screen shows an
//   underlay without its page: the clip boundary while clipping is on, else nothing.

import { pdfNumber, type ContentStream, type LineCap, type LineJoin, type Rgb } from './content';
import type { PdfPage } from './document';
import type { FillStyle, GradientStop, PlotPixels } from './fills';
import type { PlotFont } from './fonts';
import { pdfReal } from './reader';
import { adaptDashes, dashPeriod, plotDashes, POINTS_PER_INCH, POINTS_PER_MM } from './linetypes';
import {
  emitSegments,
  PATH_L,
  PATH_M,
  PATH_Z,
  pathSegments,
  subpathLength,
  subpaths,
  type Affine,
} from './path';

/** What an object plots with: `PlotProperties` from the render package's `PlotResolver`. */
export interface PlotPaint {
  /** On paper, after grayscale and screening. */
  readonly color: Rgb;
  /** Millimetres. */
  readonly lineweight: number;
  readonly linetype:
    | { readonly kind: 'object' }
    | {
        readonly kind: 'plot';
        readonly index: number;
        readonly adaptive: boolean;
        readonly patternSize: number;
      };
  readonly endStyle: 'butt' | 'square' | 'round' | 'diamond';
  readonly joinStyle: 'miter' | 'bevel' | 'round' | 'diamond';
  /** The fill style a `fill` plots with; solid when absent. */
  readonly fillStyle?: 'solid' | FillStyle;
}

/** A gradient fill's ramp, colours resolved for the plot. */
export interface PlotGradient {
  /** `linear` runs along x from 0 to 1 of the unit frame; `radial` from its origin to radius 1. */
  readonly kind: 'linear' | 'radial';
  /** Unit frame → world (the renderer's `FillGradient.frame`). */
  readonly frame: Affine;
  readonly stops: readonly GradientStop[];
}

/** A raster image's bitmap on a `fill`, drawn clipped to the fill's path. */
export interface PlotImage {
  /** Straight RGBA after the image's brightness, contrast and fade. */
  readonly pixels: PlotPixels;
  /** Bitmap space (pixels, y down from the top-left corner) → world. */
  readonly frame: Affine;
  /** The size in pixels the frame is laid out for; another bitmap size is stretched to it. */
  readonly width: number;
  readonly height: number;
}

interface PlotItemBase {
  readonly paint: PlotPaint;
  /** Below 1: object transparency. */
  readonly opacity?: number;
  /**
   * XCLIP polygons (flat world x, y pairs) the item shows inside of, every one (nonzero);
   * items sharing the same array are clipped once.
   */
  readonly clip?: readonly (readonly number[])[];
}

export interface PlotPathItem extends PlotItemBase {
  readonly kind: 'stroke' | 'fill';
  /** A packed render path in world units. */
  readonly path: readonly number[];
  /** Fill rule for `fill`: AutoCAD hatch loops use odd parity. */
  readonly evenOdd?: boolean;
  /** A `fill` painted with this ramp instead of the paint's colour. */
  readonly gradient?: PlotGradient;
  /** A `fill` showing this bitmap. */
  readonly image?: PlotImage;
  /**
   * A `fill` of TrueType glyphs (its `path` their outlines): each glyph of a font and the
   * matrix placing it, font units → world, so the text can plot as text.
   */
  readonly glyphs?: readonly PlotGlyph[];
  /** A `fill` showing a PDF underlay's page; its `path` is the clip boundary (empty unclipped). */
  readonly underlay?: PlotUnderlay;
}

/** A PDF underlay (render's `UnderlayFill` with its definition's file and page). */
export interface PlotUnderlay {
  /** The PDFDEFINITION's handle. */
  readonly definition: string;
  /** DXF 1: the file as the drawing names it (`..\\plans\\plan.pdf`). */
  readonly fileName: string;
  /** DXF 2: the page number from 1 (anything else shows the first page). */
  readonly page: string;
  /** Underlay space (inches from the displayed page's lower-left corner) → world. */
  readonly frame: Affine;
  readonly clipped: boolean;
  /** 0–100 (100 the page's own colours). */
  readonly contrast: number;
  /** 0–100 (0 none). */
  readonly fade: number;
  readonly monochrome: boolean;
}

/** A TrueType glyph placed in the drawing. */
export interface PlotGlyph {
  readonly font: PlotFont;
  /** Glyph number in the font file. */
  readonly index: number;
  /** The character it shows (for searching and copying the text). */
  readonly codePoint: number;
  /** Font units (y up, origin on the baseline) → world. */
  readonly m: Affine;
}

/** A POINT, plotted as a dot. */
export interface PlotPointItem extends PlotItemBase {
  readonly kind: 'point';
  readonly x: number;
  readonly y: number;
}

/** An XLINE (`both`) or RAY, plotted where it crosses the plot area. */
export interface PlotInfiniteItem extends PlotItemBase {
  readonly kind: 'infinite';
  readonly base: { readonly x: number; readonly y: number };
  readonly direction: { readonly x: number; readonly y: number };
  readonly both: boolean;
  /**
   * The object's linetype in world units (dash > 0, gap < 0, dot 0) and one repetition, laid
   * out from `base` both ways (the renderer's `dashes`); a plot style linetype replaces it.
   */
  readonly dashes?: { readonly lengths: readonly number[]; readonly period: number };
}

export type PlotItem = PlotPathItem | PlotPointItem | PlotInfiniteItem;

export interface PlotPageOptions {
  /** World → page points. */
  readonly toPaper: Affine;
  /** "Plot object lineweights"; on when absent. Off plots every line at the thinnest width. */
  readonly lineweights?: boolean;
  /** "Scale lineweights": lineweights multiplied by the plot scale; 1 (paper mm) when absent. */
  readonly lineweightScale?: number;
  /** The plot style table's scale factor when it applies to non-ISO linetypes, else 1. */
  readonly nonIsoScale?: number;
  /** "Convert all text to geometry": TrueType text plots as filled outlines, not as text. */
  readonly textAsGeometry?: boolean;
  /** The PDF file an underlay shows, as supplied this session; none plots its boundary only. */
  readonly underlays?: (underlay: PlotUnderlay) => Uint8Array | undefined;
  /** Paper area the plot may draw on, points (the printable area); the whole page when absent. */
  readonly area?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

const CAPS: Record<PlotPaint['endStyle'], LineCap> = { butt: 0, round: 1, square: 2, diamond: 2 };
const JOINS: Record<PlotPaint['joinStyle'], LineJoin> = {
  miter: 0,
  round: 1,
  bevel: 2,
  diamond: 0,
};

/** Draws `items` in order on `page`. */
export function plotItems(page: PdfPage, items: readonly PlotItem[], o: PlotPageOptions): void {
  const cs = page.content;
  cs.save();
  if (o.area) cs.rect(o.area.x, o.area.y, o.area.width, o.area.height).clip();
  let clip: PlotItem['clip'];
  for (const item of items) {
    if (item.clip !== clip) {
      if (clip) cs.restore();
      clip = item.clip;
      if (clip) {
        cs.save();
        for (const polygon of clip) {
          emitPolygon(cs, polygon, o.toPaper);
          cs.clip();
        }
      }
    }
    cs.graphicsState(page.alpha(item.opacity ?? 1));
    if (item.kind === 'point') {
      plotPoint(cs, item, o);
      continue;
    }
    if (item.kind === 'infinite') {
      plotInfinite(page, item, o);
      continue;
    }
    if (item.kind === 'fill' && item.underlay) {
      plotUnderlay(page, item, item.underlay, o);
      continue;
    }
    const segments = pathSegments(item.path, o.toPaper);
    if (segments.length === 0) continue;
    if (item.kind === 'fill') {
      plotFill(page, item, segments, o);
      continue;
    }
    const p = item.paint;
    const mm = plottedWeight(p, o);
    pen(cs, p, mm);
    const lt = p.linetype;
    const dashes = lt.kind === 'plot' ? styleDashes(p, mm, o) : [];
    if (dashes.length > 0 && lt.kind === 'plot' && lt.adaptive) {
      // Each subpath completes its own pattern, so each is stroked with its own dashes.
      for (const sub of subpaths(segments)) {
        cs.dash(adaptDashes(dashes, subpathLength(sub)));
        emitSegments(cs, sub);
        cs.stroke();
      }
      continue;
    }
    cs.dash(dashes);
    emitSegments(cs, segments);
    cs.stroke();
  }
  if (clip) cs.restore();
  cs.restore();
}

/** Millimetres a stroke plots at. */
function plottedWeight(p: PlotPaint, o: PlotPageOptions): number {
  return o.lineweights === false ? 0 : p.lineweight * (o.lineweightScale ?? 1);
}

function pen(cs: ContentStream, p: PlotPaint, mm: number): void {
  cs.strokeColor(p.color)
    .lineWidth(mm * POINTS_PER_MM)
    .lineCap(CAPS[p.endStyle])
    .lineJoin(JOINS[p.joinStyle]);
}

/** A plot style linetype's dash array in points; empty for none. */
function styleDashes(p: PlotPaint, mm: number, o: PlotPageOptions): number[] {
  const lt = p.linetype;
  if (lt.kind !== 'plot') return [];
  return plotDashes(lt.index, {
    patternSize: lt.patternSize,
    lineweight: mm,
    ...(o.nonIsoScale !== undefined ? { nonIsoScale: o.nonIsoScale } : {}),
    dotsVisible: mm > 0 && p.endStyle !== 'butt',
  });
}

/** `m` after `n`: first `n`, then `m`. */
function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

const invertible = (m: Affine) => Math.abs(m.a * m.d - m.b * m.c) > 1e-12;

function plotUnderlay(
  page: PdfPage,
  item: PlotPathItem,
  u: PlotUnderlay,
  o: PlotPageOptions,
): void {
  const cs = page.content;
  const segments = pathSegments(item.path, o.toPaper);
  const bytes = o.underlays?.(u);
  const form =
    bytes && page.underlay(bytes, u.page, { contrast: u.contrast, monochrome: u.monochrome });
  // The frame, as PDFFRAME's initial value 1 shows and plots it (the screen draws it too): the
  // boundary while clipping is on, else the page's edge, in the object's plot properties.
  const outline = (s: ReturnType<typeof pathSegments>) => {
    if (s.length === 0) return;
    pen(cs, item.paint, plottedWeight(item.paint, o));
    cs.dash([]);
    emitSegments(cs, s);
    cs.stroke();
  };
  if (!form) {
    if (u.clipped) outline(segments);
    return;
  }
  // The displayed page's points → underlay inches → world → paper.
  const k = 1 / POINTS_PER_INCH;
  const m = compose(o.toPaper, compose(u.frame, { a: k, b: 0, c: 0, d: k, e: 0, f: 0 }));
  if (!invertible(m) || (u.clipped && segments.length === 0)) return;
  const keep = 1 - Math.min(100, Math.max(0, u.fade)) / 100;
  cs.save();
  if (u.clipped) {
    emitSegments(cs, segments);
    cs.clip();
  }
  cs.graphicsState(page.alpha((item.opacity ?? 1) * keep));
  // Ten decimals: a page's thousands of points ride on this matrix.
  cs.transform(m, pdfReal).xobject(form.name);
  cs.restore();
  if (u.clipped) outline(segments);
  else {
    const { width: w, height: h } = form.view;
    outline(pathSegments([PATH_M, 0, 0, PATH_L, w, 0, PATH_L, w, h, PATH_L, 0, h, PATH_Z], m));
  }
}

function plotFill(
  page: PdfPage,
  item: PlotPathItem,
  segments: ReturnType<typeof pathSegments>,
  o: PlotPageOptions,
): void {
  const cs = page.content;
  const g = item.gradient;
  const img = item.image;
  if (g && g.stops.length > 0) {
    const m = compose(o.toPaper, g.frame);
    if (!invertible(m)) {
      // No ramp to lay out: the fill takes the ramp's first colour.
      cs.fillColor(g.stops[0]!.color);
      emitSegments(cs, segments);
      cs.fill(item.evenOdd ?? false);
      return;
    }
    const name = page.shading(g.kind, g.stops);
    cs.save();
    emitSegments(cs, segments);
    cs.clip(item.evenOdd ?? false);
    cs.transform(m).shade(name);
    cs.restore();
    return;
  }
  if (img) {
    // Unit square (an image's space, its first row at the top) → bitmap → world → paper.
    const unit: Affine = { a: img.width, b: 0, c: 0, d: -img.height, e: 0, f: img.height };
    const m = compose(o.toPaper, compose(img.frame, unit));
    if (!invertible(m) || img.pixels.width * img.pixels.height === 0) return;
    const name = page.image(img.pixels);
    cs.save();
    emitSegments(cs, segments);
    cs.clip(item.evenOdd ?? false);
    cs.transform(m).xobject(name);
    cs.restore();
    return;
  }
  const p = item.paint;
  if (p.fillStyle && p.fillStyle !== 'solid') {
    const [r, gr, b] = p.color;
    const space = page.patternSpace(r === gr && gr === b);
    cs.fillPattern(space, page.pattern(p.fillStyle), p.color);
  } else cs.fillColor(p.color);
  if (item.glyphs && item.glyphs.length > 0 && !o.textAsGeometry && plotText(page, item.glyphs, o))
    return;
  emitSegments(cs, segments);
  cs.fill(item.evenOdd ?? false);
}

/** Relative difference under which two glyphs' matrices share a text run. */
const SAME = 1e-9;

/**
 * TrueType glyphs as text, in the fill colour already set: false, writing nothing, when a font
 * cannot be embedded. Consecutive glyphs of one font whose matrices differ only by a move
 * along their baseline share a text matrix, with `TJ` adjustments for the difference between
 * where the next glyph stands and where the font's advance would put it (tracking, a width
 * factor's rounding, kerning none); other glyphs start a new run.
 */
function plotText(page: PdfPage, glyphs: readonly PlotGlyph[], o: PlotPageOptions): boolean {
  const fonts = glyphs.map((g) => page.font(g.font));
  if (fonts.some((f) => f === undefined)) return false;
  type Run = { m: Affine; show: (number | { code: number })[]; pen: number };
  const byFont: { name: string; runs: Run[] }[] = [];
  let run: Run | undefined;
  let font: string | undefined;
  glyphs.forEach((g, i) => {
    const f = fonts[i]!;
    const upm = f.font.unitsPerEm;
    // One em of the font (size 1 text space) → paper.
    const m = compose(o.toPaper, compose(g.m, { a: upm, b: 0, c: 0, d: upm, e: 0, f: 0 }));
    if (!invertible(m)) return;
    const code = f.cid(g.index, g.codePoint);
    const width = f.width(code) / 1000;
    if (run && font === f.name && sameLinear(run.m, m)) {
      // Where this glyph's origin lies in the run's text space.
      const r = run.m;
      const det = r.a * r.d - r.b * r.c;
      const dx = m.e - r.e;
      const dy = m.f - r.f;
      const u = (r.d * dx - r.c * dy) / det;
      const v = (-r.b * dx + r.a * dy) / det;
      if (Math.abs(v) < 1e-6) {
        const adjust = Number(pdfNumber((run.pen - u) * 1000));
        if (adjust !== 0) run.show.push(adjust);
        run.show.push({ code });
        run.pen = run.pen - adjust / 1000 + width;
        return;
      }
    }
    run = { m, show: [{ code }], pen: width };
    if (font !== f.name || byFont.length === 0) byFont.push({ name: f.name, runs: [] });
    font = f.name;
    byFont[byFont.length - 1]!.runs.push(run);
  });
  for (const { name, runs } of byFont) page.content.text(name, runs);
  return true;
}

function sameLinear(p: Affine, q: Affine): boolean {
  const k = Math.max(Math.abs(p.a), Math.abs(p.b), Math.abs(p.c), Math.abs(p.d)) * SAME;
  return (
    Math.abs(p.a - q.a) <= k &&
    Math.abs(p.b - q.b) <= k &&
    Math.abs(p.c - q.c) <= k &&
    Math.abs(p.d - q.d) <= k
  );
}

/** The smallest dot a point plots as, millimetres (ours: AutoCAD's default lineweight). */
const POINT_MIN_MM = 0.25;

/** Bézier handle length of a quarter circle of radius 1. */
const KAPPA = (4 / 3) * Math.tan(Math.PI / 8);

/**
 * A point as a round dot as wide as its lineweight, filled as a circle of four cubics. AutoCAD
 * plots a PDMODE 0 point as a dot and does not say how big; under 0.25 mm (and at the thinnest
 * width) it would hardly show. A zero-length round-capped subpath is what PDF itself offers
 * (§8.5.3.2), but viewers drawing through a canvas drop those (pdf.js in Chromium does).
 */
function plotPoint(cs: ContentStream, item: PlotPointItem, o: PlotPageOptions): void {
  const m = o.toPaper;
  const x = m.a * item.x + m.c * item.y + m.e;
  const y = m.b * item.x + m.d * item.y + m.f;
  const r = (Math.max(plottedWeight(item.paint, o), POINT_MIN_MM) * POINTS_PER_MM) / 2;
  const k = r * KAPPA;
  cs.fillColor(item.paint.color)
    .moveTo(x + r, y)
    .curveTo(x + r, y + k, x + k, y + r, x, y + r)
    .curveTo(x - k, y + r, x - r, y + k, x - r, y)
    .curveTo(x - r, y - k, x - k, y - r, x, y - r)
    .curveTo(x + k, y - r, x + r, y - k, x + r, y)
    .closePath()
    .fill();
}

/** Below this many points per repetition a linetype plots continuous (it would be a blur). */
const MIN_PERIOD_POINTS = 0.1;

/**
 * An XLINE or RAY over the plot area (Liang–Barsky on paper). A plot style linetype is phased
 * so its pattern starts at the base point, and an object linetype is laid out from the base
 * point both ways in world units, as the screen draws it (canvas2d `dashInfinite`): where the
 * plot area falls does not move the dashes.
 */
function plotInfinite(page: PdfPage, item: PlotInfiniteItem, o: PlotPageOptions): void {
  const m = o.toPaper;
  const wl = Math.hypot(item.direction.x, item.direction.y);
  if (!(wl > 0)) return;
  // Unit world direction, and its image on paper (k points per world unit).
  const ux = item.direction.x / wl;
  const uy = item.direction.y / wl;
  const px = m.a * ux + m.c * uy;
  const py = m.b * ux + m.d * uy;
  const k = Math.hypot(px, py);
  if (!(k > 0)) return;
  const dx = px / k;
  const dy = py / k;
  const bx = m.a * item.base.x + m.c * item.base.y + m.e;
  const by = m.b * item.base.x + m.d * item.base.y + m.f;
  const box = o.area ?? { x: 0, y: 0, width: page.width, height: page.height };
  let t0 = item.both ? -Infinity : 0;
  let t1 = Infinity;
  const clip = (q: number, d: number, lo: number, hi: number): boolean => {
    if (d === 0) return q >= lo && q <= hi;
    let a = (lo - q) / d;
    let b = (hi - q) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (
    !clip(bx, dx, box.x, box.x + box.width) ||
    !clip(by, dy, box.y, box.y + box.height) ||
    !(t1 > t0)
  )
    return;
  const cs = page.content;
  const p = item.paint;
  const mm = plottedWeight(p, o);
  pen(cs, p, mm);
  const at = (t: number): [number, number] => [bx + dx * t, by + dy * t];
  const styled = styleDashes(p, mm, o);
  const period = dashPeriod(styled);
  if (p.linetype.kind === 'plot' && period > 0) {
    // Adaptive adjustment has no length to complete a pattern on: the pattern plots as is.
    cs.dash(styled, ((t0 % period) + period) % period);
    cs.moveTo(...at(t0))
      .lineTo(...at(t1))
      .stroke();
    return;
  }
  cs.dash([]);
  const d = p.linetype.kind === 'object' ? item.dashes : undefined;
  const count = d && d.period > 0 ? (t1 - t0) / k / d.period : 0;
  if (!d || d.period * k < MIN_PERIOD_POINTS || count > 100_000) {
    cs.moveTo(...at(t0))
      .lineTo(...at(t1))
      .stroke();
    return;
  }
  // World parameters along the line from the base point.
  const w0 = t0 / k;
  const w1 = t1 / k;
  let any = false;
  for (let r = Math.floor(w0 / d.period); r * d.period <= w1; r++) {
    let s = r * d.period;
    for (const len of d.lengths) {
      const e = s + Math.abs(len);
      if (len >= 0) {
        const a = Math.max(s, w0);
        const b = Math.min(e, w1);
        // A dot as a zero-length subpath, which the cap draws.
        if (b > a || (len === 0 && s >= w0 && s <= w1)) {
          cs.moveTo(...at(a * k)).lineTo(...at((len === 0 ? a : b) * k));
          any = true;
        }
      }
      s = e;
    }
  }
  if (any) cs.stroke();
}

function emitPolygon(cs: ContentStream, flat: readonly number[], m: Affine): void {
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i]!;
    const y = flat[i + 1]!;
    const px = m.a * x + m.c * y + m.e;
    const py = m.b * x + m.d * y + m.f;
    if (i === 0) cs.moveTo(px, py);
    else cs.lineTo(px, py);
  }
  cs.closePath();
}

/**
 * World → paper for a plot at `scale` paper millimetres per drawing unit (1:100 in a metric
 * drawing is 0.01), with the world point `origin` placed at `at` (points from the page's
 * lower-left corner), turned `rotation` radians counter-clockwise on the paper (0, 90, 180 or
 * 270° for the Page Setup's orientation and "upside-down").
 */
export function paperTransform(
  scale: number,
  origin: { readonly x: number; readonly y: number },
  at: { readonly x: number; readonly y: number },
  rotation = 0,
): Affine {
  const k = scale * POINTS_PER_MM;
  // Exact quarter turns: no 6e-17 in a 90° plot's matrix.
  const quarter = Math.round(rotation / (Math.PI / 2));
  const exact = Math.abs(rotation - (quarter * Math.PI) / 2) < 1e-12;
  const cos = exact ? [1, 0, -1, 0][((quarter % 4) + 4) % 4]! : Math.cos(rotation);
  const sin = exact ? [0, 1, 0, -1][((quarter % 4) + 4) % 4]! : Math.sin(rotation);
  const a = k * cos;
  const b = k * sin;
  const c = -k * sin;
  const d = k * cos;
  return {
    a,
    b,
    c,
    d,
    e: at.x - (a * origin.x + c * origin.y),
    f: at.y - (b * origin.x + d * origin.y),
  };
}
