// Plotting to SVG (M2-18, ARCHITECTURE.md §12's `SvgSink`, PRD FR-F7/FR-P4): the same plot
// items the PDF writer draws (`plot.ts`), painted the same way, written as an SVG 1.1 file whose
// size is the paper's. Each drawing layer is an Inkscape layer (a top-level `<g>` with
// `inkscape:groupmode="layer"` and the layer's name as its label), so the file opens in Inkscape
// with the drawing's layers, and in a browser as a plain picture.
//
// Rules encoded here, beyond what plot.ts already says:
// - Draw order is the plot's. A layer is one group where it can be: a part joins its layer's
//   earlier group only when no filled area it would move under or over lies across it (bounding
//   boxes), else the layer starts another group with the same label (Inkscape shows both).
// - Lineweight 0 is the thinnest line the device draws: one device pixel at any zoom
//   (`vector-effect: non-scaling-stroke`), as the PDF's zero-width line.
// - Plot style fill styles are SVG patterns of the PDF writer's 6 pt cells (`fills.ts`), laid on
//   the paper from its lower-left corner as the PDF lays them; gradients are SVG gradients over
//   the same unit frame; raster images are PNG `data:` URIs clipped to their boundary.
// - TrueType text plots as its glyph outlines (SVG `<text>` would need the font installed
//   wherever the file opens).
// - A PDF underlay plots its clip boundary while clipping is on, as an underlay whose page the
//   plot cannot read (its content in SVG is a leftover, roadmap M2-18).
// No DOM here.

import type { Rgb } from './content';
import { FILL_CELL, type FillStyle, type GradientStop } from './fills';
import { adaptDashes, POINTS_PER_MM } from './linetypes';
import {
  compose,
  infiniteStroke,
  invertible,
  plottedWeight,
  POINT_MIN_MM,
  styleDashes,
  type PlotItem,
  type PlotPageOptions,
  type PlotPathItem,
} from './plot';
import { pathSegments, subpathLength, subpaths, type Affine, type Segment } from './path';
import { base64, encodePng } from './png';

export interface SvgPlotOptions extends PlotPageOptions {
  /** The paper, points (as `PdfDocument.addPage` takes it). */
  readonly width: number;
  readonly height: number;
  /** The file's `<title>`. */
  readonly title?: string;
  /** A sheet of this colour under the plot; none (transparent) when absent. */
  readonly background?: Rgb;
}

/** Three decimals of a point (0.35 µm), no trailing zeros, no `-0`. */
function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

const hex = (c: Rgb): string =>
  `#${c
    .map((v) =>
      Math.min(255, Math.max(0, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** XML character data and attribute values. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .split('')
    .filter((c) => !notXml(c.charCodeAt(0)))
    .join('');
}

/** Control characters XML 1.0 cannot hold (§2.2): all below space but tab, LF and CR. */
const notXml = (c: number) => c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d;

const matrix = (m: Affine) =>
  `matrix(${num6(m.a)} ${num6(m.b)} ${num6(m.c)} ${num6(m.d)} ${num(m.e)} ${num(m.f)})`;
/** Six decimals: a matrix's linear part (a world-unit frame can be far smaller than a point). */
function num6(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

function pathData(segments: readonly Segment[]): string {
  let d = '';
  for (const s of segments) {
    if (s.op === 'Z') d += 'Z';
    else if (s.op === 'C')
      d += `C${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)}`;
    else d += `${s.op}${num(s.x)} ${num(s.y)}`;
  }
  return d;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

function segmentsBox(segments: readonly Segment[]): Box {
  const b = { ...EMPTY };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const s of segments) {
    if (s.op === 'Z') continue;
    if (s.op === 'C') {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    }
    add(s.x, s.y);
  }
  return b;
}

const union = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

const meets = (a: Box, b: Box) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** The pattern cell of each fill style in SVG, y up as the PDF cell (the pattern flips it). */
function cellSvg(style: FillStyle, color: string): string {
  const s = FILL_CELL;
  const rect = (x: number, y: number, w: number, h: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
  const slants = (dir: 1 | -1, w: number) =>
    [-s, 0, s]
      .map((k) =>
        dir === 1 ? `M${k - 1} -1L${k + s + 1} ${s + 1}` : `M${k - 1} ${s + 1}L${k + s + 1} -1`,
      )
      .map((d) => `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none"/>`)
      .join('');
  switch (style) {
    case 'checkerboard':
      return rect(0, 0, 3, 3) + rect(3, 3, 3, 3);
    case 'crosshatch':
      return rect(0, 0, 6, 1) + rect(0, 0, 1, 6);
    case 'diamonds':
      return slants(1, 0.75) + slants(-1, 0.75);
    case 'horizontalBars':
      return rect(0, 0, 6, 2);
    case 'slantLeft':
      return slants(-1, 1);
    case 'slantRight':
      return slants(1, 1);
    case 'squareDots':
      return rect(2, 2, 2, 2);
    case 'verticalBars':
      return rect(0, 0, 2, 6);
  }
}

const stops = (list: readonly GradientStop[]) =>
  [...list]
    .sort((a, b) => a.offset - b.offset)
    .map(
      (s) =>
        `<stop offset="${num6(Math.min(1, Math.max(0, s.offset)))}" stop-color="${hex(s.color)}"/>`,
    )
    .join('');

/** One item ready to place: its markup, its layer and what it covers on the paper. */
interface Placed {
  readonly layer: string;
  readonly markup: string;
  readonly clip: PlotItem['clip'];
  readonly box: Box;
  /** Paints an area (a fill, an image), so moving other items under or over it shows. */
  readonly area: boolean;
}

interface Group {
  readonly layer: string;
  readonly placed: Placed[];
  box: Box;
  areaBox: Box;
}

/** The drawing layer the SVG puts items without one on. */
const DEFAULT_LAYER = '0';

/** A plot of `items` on one sheet of paper as an SVG document. */
export function plotSvg(items: readonly PlotItem[], o: SvgPlotOptions): string {
  const W = o.width;
  const H = o.height;
  // Paper points (y up) → SVG user units (points, y down).
  const m = compose({ a: 1, b: 0, c: 0, d: -1, e: 0, f: H }, o.toPaper);
  const pageBox: Box = { minX: 0, minY: 0, maxX: W, maxY: H };
  const area = o.area
    ? { x: o.area.x, y: H - o.area.y - o.area.height, width: o.area.width, height: o.area.height }
    : { x: 0, y: 0, width: W, height: H };
  const defs: string[] = [];
  const ids = new Map<string, string>();
  /** The id of a definition, made the first time it is used. */
  const def = (key: string, make: (id: string) => string): string => {
    let id = ids.get(key);
    if (!id) {
      id = `d${ids.size + 1}`;
      ids.set(key, id);
      defs.push(make(id));
    }
    return id;
  };
  const images = new Map<PlotItem, string>();

  const stroke = (p: PlotItem['paint'], extra = ''): string => {
    const mm = plottedWeight(p, o);
    const width =
      mm > 0
        ? ` stroke-width="${num(mm * POINTS_PER_MM)}"`
        : ' stroke-width="1" vector-effect="non-scaling-stroke"';
    const cap =
      p.endStyle === 'round'
        ? ' stroke-linecap="round"'
        : p.endStyle === 'butt'
          ? ''
          : ' stroke-linecap="square"';
    const join =
      p.joinStyle === 'round'
        ? ' stroke-linejoin="round"'
        : p.joinStyle === 'bevel'
          ? ' stroke-linejoin="bevel"'
          : '';
    return `fill="none" stroke="${hex(p.color)}"${width}${cap}${join}${extra}`;
  };
  const dashAttr = (dash: readonly number[], phase = 0) =>
    dash.length > 0 && dash.some((d) => d > 0)
      ? ` stroke-dasharray="${dash.map(num).join(' ')}"${phase !== 0 ? ` stroke-dashoffset="${num(phase)}"` : ''}`
      : '';

  const place = (item: PlotItem): Omit<Placed, 'layer' | 'clip'> | undefined => {
    const alpha =
      item.opacity !== undefined && item.opacity < 1 ? ` opacity="${num6(item.opacity)}"` : '';
    if (item.kind === 'point') {
      const x = m.a * item.x + m.c * item.y + m.e;
      const y = m.b * item.x + m.d * item.y + m.f;
      const r = (Math.max(plottedWeight(item.paint, o), POINT_MIN_MM) * POINTS_PER_MM) / 2;
      return {
        markup: `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" fill="${hex(item.paint.color)}"${alpha}/>`,
        box: { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r },
        area: false,
      };
    }
    if (item.kind === 'infinite') {
      const p = item.paint;
      const s = infiniteStroke(item, m, area, styleDashes(p, plottedWeight(p, o), o));
      if (!s || s.lines.length === 0) return undefined;
      const d = s.lines
        .map(([x0, y0, x1, y1]) => `M${num(x0)} ${num(y0)}L${num(x1)} ${num(y1)}`)
        .join('');
      return {
        markup: `<path d="${d}" ${stroke(p, dashAttr(s.dash, s.phase))}${alpha}/>`,
        box: pageBox,
        area: false,
      };
    }
    const segments = pathSegments(item.path, m);
    if (item.underlay) {
      // The boundary while clipping is on; the page's content is a leftover (see the header).
      if (!item.underlay.clipped || segments.length === 0) return undefined;
      return {
        markup: `<path d="${pathData(segments)}" ${stroke(item.paint)}${alpha}/>`,
        box: segmentsBox(segments),
        area: false,
      };
    }
    if (segments.length === 0) return undefined;
    const box = segmentsBox(segments);
    const d = pathData(segments);
    const rule = item.evenOdd ? ' fill-rule="evenodd"' : '';
    if (item.kind === 'fill') return { markup: fill(item, d, rule, alpha), box, area: true };
    const p = item.paint;
    const dashes = styleDashes(p, plottedWeight(p, o), o);
    if (dashes.length > 0 && p.linetype.kind === 'plot' && p.linetype.adaptive) {
      // Each subpath completes its own pattern, as the PDF writer strokes it.
      const markup = subpaths(segments)
        .map((sub) => {
          const own = adaptDashes(dashes, subpathLength(sub));
          return `<path d="${pathData(sub)}" ${stroke(p, dashAttr(own))}${alpha}/>`;
        })
        .join('');
      return { markup, box, area: false };
    }
    return { markup: `<path d="${d}" ${stroke(p, dashAttr(dashes))}${alpha}/>`, box, area: false };
  };

  const fill = (item: PlotPathItem, d: string, rule: string, alpha: string): string => {
    const g = item.gradient;
    if (g && g.stops.length > 0) {
      const gm = compose(m, g.frame);
      if (!invertible(gm))
        return `<path d="${d}" fill="${hex(g.stops[0]!.color)}"${rule}${alpha}/>`;
      const id = def(`g${ids.size}`, (id) =>
        g.kind === 'linear'
          ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="${matrix(gm)}">${stops(g.stops)}</linearGradient>`
          : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="${matrix(gm)}">${stops(g.stops)}</radialGradient>`,
      );
      return `<path d="${d}" fill="url(#${id})"${rule}${alpha}/>`;
    }
    const img = item.image;
    if (img) {
      const im = compose(m, img.frame);
      if (!invertible(im) || img.pixels.width * img.pixels.height === 0) return '';
      let href = images.get(item);
      if (!href) {
        href = `data:image/png;base64,${base64(encodePng(img.pixels))}`;
        images.set(item, href);
      }
      const clip = def(
        `c${ids.size}`,
        (id) =>
          `<clipPath id="${id}"><path d="${d}"${item.evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`,
      );
      return `<g clip-path="url(#${clip})"${alpha}><image width="${num(img.width)}" height="${num(img.height)}" preserveAspectRatio="none" image-rendering="optimizeSpeed" style="image-rendering:pixelated" transform="${matrix(im)}" xlink:href="${href}"/></g>`;
    }
    const p = item.paint;
    const color = hex(p.color);
    if (p.fillStyle && p.fillStyle !== 'solid') {
      const style = p.fillStyle;
      // The PDF's pattern space is the page's, origin at its lower-left corner, y up.
      const id = def(
        `fs:${style}:${color}`,
        (id) =>
          `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${FILL_CELL}" height="${FILL_CELL}" patternTransform="matrix(1 0 0 -1 0 ${num(H)})">${cellSvg(style, color)}</pattern>`,
      );
      return `<path d="${d}" fill="url(#${id})"${rule}${alpha}/>`;
    }
    return `<path d="${d}" fill="${color}"${rule}${alpha}/>`;
  };

  // Items placed, then gathered into layer groups keeping the plot's order where it shows.
  const groups: Group[] = [];
  for (const item of items) {
    const p = place(item);
    if (!p || p.markup === '') continue;
    const placed: Placed = { ...p, layer: item.layer ?? DEFAULT_LAYER, clip: item.clip };
    const areaBox = placed.area ? placed.box : EMPTY;
    const last = groups[groups.length - 1];
    if (last?.layer === placed.layer) {
      last.placed.push(placed);
      last.box = union(last.box, placed.box);
      last.areaBox = union(last.areaBox, areaBox);
      continue;
    }
    // The layer's latest group, if moving this item back into it changes nothing visible.
    let target: Group | undefined;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]!;
      if (g.layer === placed.layer) {
        target = g;
        break;
      }
      if (meets(placed.box, g.areaBox) || meets(areaBox, g.box)) break;
    }
    if (target) {
      target.placed.push(placed);
      target.box = union(target.box, placed.box);
      target.areaBox = union(target.areaBox, areaBox);
    } else groups.push({ layer: placed.layer, placed: [placed], box: placed.box, areaBox });
  }

  const clipIds = new Map<readonly (readonly number[])[], string[]>();
  const clipsOf = (clip: readonly (readonly number[])[]): string[] => {
    let list = clipIds.get(clip);
    if (!list) {
      list = clip.map((polygon) =>
        def(`p${ids.size}`, (id) => {
          let d = '';
          for (let i = 0; i + 1 < polygon.length; i += 2) {
            const x = polygon[i]!;
            const y = polygon[i + 1]!;
            d += `${i === 0 ? 'M' : 'L'}${num(m.a * x + m.c * y + m.e)} ${num(m.b * x + m.d * y + m.f)}`;
          }
          return `<clipPath id="${id}"><path d="${d}Z"/></clipPath>`;
        }),
      );
      clipIds.set(clip, list);
    }
    return list;
  };

  const areaClip = o.area
    ? ` clip-path="url(#${def('area', (id) => `<clipPath id="${id}"><rect x="${num(area.x)}" y="${num(area.y)}" width="${num(area.width)}" height="${num(area.height)}"/></clipPath>`)})"`
    : '';
  const body: string[] = [];
  groups.forEach((g, n) => {
    body.push(
      `<g id="layer${n + 1}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(g.layer)}" stroke-miterlimit="10"${areaClip}>`,
    );
    let i = 0;
    while (i < g.placed.length) {
      const clip = g.placed[i]!.clip;
      let j = i;
      while (j < g.placed.length && g.placed[j]!.clip === clip) j++;
      const wrap = clip ? clipsOf(clip) : [];
      body.push(
        wrap.map((id) => `<g clip-path="url(#${id})">`).join('') +
          g.placed
            .slice(i, j)
            .map((p) => p.markup)
            .join('\n') +
          '</g>'.repeat(wrap.length),
      );
      i = j;
    }
    body.push('</g>');
  });

  const mmW = num(W / POINTS_PER_MM);
  const mmH = num(H / POINTS_PER_MM);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${mmW}mm" height="${mmH}mm" viewBox="0 0 ${num(W)} ${num(H)}">`,
    ...(o.title !== undefined ? [`<title>${xmlEscape(o.title)}</title>`] : []),
    ...(defs.length > 0 ? ['<defs>', ...defs, '</defs>'] : []),
    ...(o.background
      ? [`<rect width="${num(W)}" height="${num(H)}" fill="${hex(o.background)}"/>`]
      : []),
    ...body,
    '</svg>',
    '',
  ].join('\n');
}
