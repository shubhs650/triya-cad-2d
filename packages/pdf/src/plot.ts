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

import type { ContentStream, LineCap, LineJoin, Rgb } from './content';
import type { PdfPage } from './document';
import { adaptDashes, plotDashes, POINTS_PER_MM } from './linetypes';
import { emitSegments, pathSegments, subpathLength, subpaths, type Affine } from './path';

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
}

export interface PlotItem {
  readonly kind: 'stroke' | 'fill';
  /** A packed render path in world units. */
  readonly path: readonly number[];
  readonly paint: PlotPaint;
  /** Fill rule for `fill`: AutoCAD hatch loops use odd parity. */
  readonly evenOdd?: boolean;
  /** Below 1: object transparency. */
  readonly opacity?: number;
  /**
   * XCLIP polygons (flat world x, y pairs) the item shows inside of, every one (nonzero);
   * items sharing the same array are clipped once.
   */
  readonly clip?: readonly (readonly number[])[];
}

export interface PlotPageOptions {
  /** World → page points. */
  readonly toPaper: Affine;
  /** "Plot object lineweights"; on when absent. Off plots every line at the thinnest width. */
  readonly lineweights?: boolean;
  /** "Scale lineweights": lineweights multiplied by the plot scale; 1 (paper mm) when absent. */
  readonly lineweightScale?: number;
  /** The plot style table's scale factor when it applies to non-ISO linetypes, else 1. */
  readonly nonIsoScale?: number;
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
    const segments = pathSegments(item.path, o.toPaper);
    if (segments.length === 0) continue;
    if (item.kind === 'fill') {
      cs.fillColor(item.paint.color);
      emitSegments(cs, segments);
      cs.fill(item.evenOdd ?? false);
      continue;
    }
    const p = item.paint;
    const mm = o.lineweights === false ? 0 : p.lineweight * (o.lineweightScale ?? 1);
    cs.strokeColor(p.color)
      .lineWidth(mm * POINTS_PER_MM)
      .lineCap(CAPS[p.endStyle])
      .lineJoin(JOINS[p.joinStyle]);
    const lt = p.linetype;
    const dashes =
      lt.kind === 'plot'
        ? plotDashes(lt.index, {
            patternSize: lt.patternSize,
            lineweight: mm,
            ...(o.nonIsoScale !== undefined ? { nonIsoScale: o.nonIsoScale } : {}),
            dotsVisible: mm > 0 && p.endStyle !== 'butt',
          })
        : [];
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
