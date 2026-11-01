// TEXT and MTEXT as glyphs (M1-41 part 1, ARCHITECTURE.md §8): the text engine lays a string
// out with exact widths from the loaded fonts (`fontMeasure`), and each character's glyph is
// placed through its run's height, width factor and obliquing, then the entity's frame. SHX
// glyphs are strokes (arcs kept exact); TrueType glyphs are filled outlines with their Béziers
// kept exact (TEXTFILL on, AutoCAD's default), filled non-zero as TrueType defines.
//
// Fonts come in through `TextContext`, already loaded: a text whose font is not loaded and has
// no alternate draws nothing (the font is listed in `FontBook.missing` for the health report).
//
// AutoCAD rules encoded here, with sources ("TEXT (Command)", "Justify"):
// - Left-baseline TEXT sits on DXF 10; any other justification on DXF 11, AutoCAD recomputing
//   DXF 10 from it, so a substituted font keeps centred text centred.
// - Bottom is the font's descender line, Middle half the cap height, Top the cap height.
// - Aligned (72 = 3) scales the text, height too, to fit between DXF 10 and 11; Fit (5)
//   stretches only its width.
// - Backward and upside-down mirror the glyphs about the alignment point.
// - "Middle" (72 = 4) centres on "the vertical middle of the text"; the docs do not say whether
//   that is the glyphs drawn or the font's lines. This uses the middle between the descender
//   line and the cap height, which keeps the anchor fixed as the string changes.

import {
  bulgeArc,
  type Handle,
  type MTextGeometry,
  type TextGeometry,
  type TextMeasure,
  type TextStyleRecord,
} from '@triya/engine';
import {
  charAdvance,
  fontMeasure,
  layoutMText,
  parseMText,
  shxCode,
  styleFont,
  type MTextBase,
  type MTextCharStyle,
  type MTextColor,
  type MTextLayout,
  type MTextLayoutOptions,
  type ShxFont,
  type ShxGlyph,
  type TextFace,
  type TextFonts,
  type TtfGlyph,
} from '@triya/text';
import { composeAffine, transformPath, type Affine } from './affine';
import { colorValue } from './style/resolve';
import type { Paint } from './tessellate';
import {
  PATH_A,
  PATH_C,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  type PrimitiveColor,
  type RenderPrimitive,
} from './types';

/** What drawing text needs beyond its geometry. */
export interface TextContext {
  readonly fonts: TextFonts;
  /** A STYLE record by handle. */
  readonly style: (handle: Handle) => TextStyleRecord | undefined;
  /** A field's current value; undefined shows `----`. */
  readonly evaluateField?: (code: string) => string | undefined;
}

/** AutoCAD's STANDARD style font, for text whose style record is missing. */
export const STANDARD_FONT = { name: 'txt', kind: 'shx', bold: false, italic: false } as const;

/** A glyph's path in font units, and whether it fills (TrueType) or strokes (SHX). */
interface GlyphShape {
  readonly path: readonly number[];
  readonly fill: boolean;
}

/** Glyph paths per font object and shape number (SHX) or code point (TrueType), built once. */
const shapes = new WeakMap<object, Map<number, GlyphShape>>();

function cached(font: object, key: number, build: () => GlyphShape): GlyphShape {
  let m = shapes.get(font);
  if (!m) shapes.set(font, (m = new Map()));
  let s = m.get(key);
  if (!s) m.set(key, (s = build()));
  return s;
}

function shxPath(g: ShxGlyph): GlyphShape {
  const path: number[] = [];
  for (const p of g.paths) {
    const v = p.vertices;
    if (v.length === 0) continue;
    path.push(PATH_M, v[0]!.x, v[0]!.y);
    // A single pen-down point is a dot: a zero-length segment the round cap draws.
    if (v.length === 1) path.push(PATH_L, v[0]!.x, v[0]!.y);
    for (let i = 1; i < v.length; i++) {
      const a = v[i - 1]!;
      const b = v[i]!;
      if (a.bulge === 0 || (a.x === b.x && a.y === b.y)) {
        path.push(PATH_L, b.x, b.y);
        continue;
      }
      const arc = bulgeArc(a, b, a.bulge);
      const end = arc.startAngle + arc.sweep;
      path.push(PATH_A, arc.center.x, arc.center.y, arc.radius, arc.startAngle, end);
      path.push(arc.sweep > 0 ? 1 : 0);
    }
  }
  return { path, fill: false };
}

function ttfPath(g: TtfGlyph): GlyphShape {
  const path: number[] = [];
  for (const c of g.commands) {
    if (c.op === 'M') path.push(PATH_M, c.x, c.y);
    else if (c.op === 'L') path.push(PATH_L, c.x, c.y);
    else if (c.op === 'Q') path.push(PATH_Q, c.x1, c.y1, c.x, c.y);
    else if (c.op === 'C') path.push(PATH_C, c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else path.push(PATH_Z);
  }
  return { path, fill: true };
}

function glyphShape(face: TextFace, codePoint: number): GlyphShape | undefined {
  if (face.kind === 'ttf')
    return cached(face.font, codePoint, () => ttfPath(face.font.glyph(codePoint)));
  return shxShape(face.font, shxCode(face.font, codePoint));
}

function shxShape(font: ShxFont, code: number | undefined): GlyphShape | undefined {
  if (code === undefined) return undefined;
  const g = font.glyph(code);
  return g && cached(font, code, () => shxPath(g));
}

interface Group {
  readonly fill: boolean;
  readonly color: PrimitiveColor;
  readonly path: number[];
  /** One box per run, cap height tall, for the greeking LOD; and the tallest run's height. */
  readonly greek: number[];
  height: number;
}

/** Collects one entity's glyph paths, one stroke or fill per colour. */
class Collector {
  readonly #groups = new Map<string, Group>();
  /** The mask, drawn under the glyphs; the frame, over them. */
  readonly #under: RenderPrimitive[] = [];
  readonly #over: RenderPrimitive[] = [];
  constructor(readonly paint: Paint) {}

  add(shape: GlyphShape, m: Affine, color: PrimitiveColor): void {
    const path = this.#group(shape.fill, color).path;
    for (const v of transformPath(shape.path, m)) path.push(v);
  }

  /** A straight line in the text frame: a decoration or a stack's fraction bar. */
  line(frame: Affine, x1: number, y1: number, x2: number, y2: number, color: PrimitiveColor) {
    this.add({ path: [PATH_M, x1, y1, PATH_L, x2, y2], fill: false }, frame, color);
  }

  /** A run's box (x0..x1 along the baseline y, `height` tall) for greeking. */
  run(face: TextFace, frame: Affine, color: PrimitiveColor, box: RunBox): void {
    const g = this.#group(face.kind === 'ttf', color);
    const k = Math.sqrt(Math.abs(frame.a * frame.d - frame.b * frame.c));
    g.height = Math.max(g.height, box.height * k);
    if (!(box.x1 > box.x0)) return;
    for (const v of transformPath(rect(box.x0, box.y, box.x1, box.y + box.height), frame))
      g.greek.push(v);
  }

  /** The background mask (or fill) under the glyphs. */
  mask(path: number[], color: PrimitiveColor): void {
    this.#under.push({ kind: 'fill', path, color, evenOdd: false });
  }

  /** The text frame over the glyphs, in the entity's colour and lineweight. */
  frame(path: number[]): void {
    this.#over.push(this.#stroke(path, this.paint.color));
  }

  #stroke(path: number[], color: PrimitiveColor): RenderPrimitive & { kind: 'stroke' } {
    const lw = this.paint.lineweight;
    return { kind: 'stroke', path, color, ...(lw === undefined ? {} : { lineweight: lw }) };
  }

  #group(fill: boolean, color: PrimitiveColor): Group {
    const key = `${fill ? 'f' : 's'}${color}`;
    let g = this.#groups.get(key);
    if (!g) this.#groups.set(key, (g = { fill, color, path: [], greek: [], height: 0 }));
    return g;
  }

  primitives(): RenderPrimitive[] {
    const glyphs = [...this.#groups.values()]
      .filter((g) => g.path.length > 0)
      .map(({ fill, color, path, greek, height }): RenderPrimitive => {
        const text = { height, greek };
        return fill
          ? { kind: 'fill', path, color, evenOdd: false, text }
          : { ...this.#stroke(path, color), text };
      });
    return [...this.#under, ...glyphs, ...this.#over];
  }
}

interface RunBox {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
  readonly height: number;
}

/** A closed rectangle path. */
const rect = (x0: number, y0: number, x1: number, y1: number): number[] => [
  PATH_M,
  x0,
  y0,
  PATH_L,
  x1,
  y0,
  PATH_L,
  x1,
  y1,
  PATH_L,
  x0,
  y1,
  PATH_Z,
];

/** An MTEXT colour override: ByLayer and ByBlock (0, 256) keep the entity's own. */
function runColor(c: MTextColor | undefined, paint: Paint): PrimitiveColor {
  if (!c) return paint.color;
  if (c.kind === 'aci') return c.index === 0 || c.index >= 256 ? paint.color : colorValue(c);
  return colorValue({ kind: 'rgb', r: c.r, g: c.g, b: c.b });
}

/** Draws a string from its baseline start (x, y) in the text frame, in its character style. */
function placeText(
  out: Collector,
  fonts: TextFonts,
  frame: Affine,
  text: string,
  x: number,
  y: number,
  style: MTextCharStyle,
): void {
  const face = fonts.face(style.font);
  if (!face) return;
  const s = face.font.scaleFor(style.height);
  const sx = s * style.widthFactor;
  const shear = Math.tan((style.oblique * Math.PI) / 180) * s;
  const color = runColor(style.color, out.paint);
  let pen = x;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const shape = glyphShape(face, cp);
    if (shape && shape.path.length > 0)
      out.add(shape, composeAffine(frame, { a: sx, b: 0, c: shear, d: s, e: pen, f: y }), color);
    pen += charAdvance(face, cp) * sx * style.tracking;
  }
  out.run(face, frame, color, { x0: x, x1: pen, y, height: style.height });
}

/** Every run, stack part and decoration of a layout, drawn in the text frame. */
function drawLayout(
  out: Collector,
  layout: MTextLayout,
  frame: Affine,
  fonts: TextFonts,
  bigFont: ShxFont | undefined,
): void {
  for (const line of layout.lines) {
    for (const run of line.runs) {
      if (run.kind === 'text') {
        placeText(out, fonts, frame, run.text, run.x, run.y, run.style);
      } else if (run.kind === 'stack') {
        for (const part of [run.upper, run.lower])
          placeText(out, fonts, frame, part.text, part.x, part.y, part.style);
        if (run.bar) out.line(frame, ...run.bar, runColor(run.style.color, out.paint));
      } else if (bigFont) {
        const shape = shxShape(bigFont, bigFont.hasShape(run.code) ? run.code : undefined);
        if (!shape) continue;
        const s = bigFont.scaleFor(run.style.height);
        const m = { a: s * run.style.widthFactor, b: 0, c: 0, d: s, e: run.x, f: run.y };
        out.add(shape, composeAffine(frame, m), runColor(run.style.color, out.paint));
      }
    }
    for (const d of line.decorations) out.line(frame, d.x1, d.y, d.x2, d.y, out.paint.color);
  }
}

/** Font units below the baseline to the descender line, in drawing units. */
function descent(face: TextFace | undefined, height: number): number {
  if (!face) return 0;
  const below = face.kind === 'shx' ? face.font.below : -face.font.descender;
  return below * face.font.scaleFor(height);
}

/** The frame turning text coordinates into drawing ones: baseline along x, mirrors applied. */
function textFrame(
  at: { readonly x: number; readonly y: number },
  rotation: number,
  backward: boolean,
  upsideDown: boolean,
): Affine {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const mx = backward ? -1 : 1;
  const my = upsideDown ? -1 : 1;
  return { a: cos * mx, b: sin * mx, c: -sin * my, d: cos * my, e: at.x, f: at.y };
}

function baseOf(
  ctx: TextContext,
  style: Handle,
  height: number,
): { base: MTextBase; record?: TextStyleRecord } {
  const record = ctx.style(style);
  const font = record ? styleFont(record) : STANDARD_FONT;
  return {
    base: {
      font,
      height,
      widthFactor: record?.widthFactor || 1,
      oblique: ((record?.obliqueAngle ?? 0) * 180) / Math.PI,
    },
    ...(record ? { record } : {}),
  };
}

function textPrimitivesOf(g: TextGeometry, paint: Paint, ctx: TextContext): RenderPrimitive[] {
  if (!(g.height > 0) || g.value === '') return [];
  const { base } = baseOf(ctx, g.style, g.height);
  const charBase: MTextBase = {
    ...base,
    widthFactor: g.widthFactor || base.widthFactor,
    oblique: (g.oblique * 180) / Math.PI,
  };
  const doc = parseMText(g.value, charBase, {
    mode: 'text',
    ...(ctx.evaluateField ? { evaluateField: ctx.evaluateField } : {}),
  });
  const options: MTextLayoutOptions = {
    height: g.height,
    width: 0,
    attachment: 7, // bottom left: the baseline start at the origin
    lineSpacingStyle: 1,
    lineSpacing: 1,
  };
  const layout = layoutMText(doc, fontMeasure(ctx.fonts), options);
  const width = layout.lines[0]?.width ?? 0;
  const h = g.height;
  let local: Affine;
  let at = g.position;
  if ((g.halign === 3 || g.halign === 5) && g.alignmentPoint) {
    const len = Math.hypot(g.alignmentPoint.x - g.position.x, g.alignmentPoint.y - g.position.y);
    const k = width > 0 && len > 0 ? len / width : 1;
    local = { a: k, b: 0, c: 0, d: g.halign === 3 ? k : 1, e: 0, f: 0 };
  } else {
    if ((g.halign !== 0 || g.valign !== 0) && g.alignmentPoint) at = g.alignmentPoint;
    const dx = g.halign === 1 || g.halign === 4 ? -width / 2 : g.halign === 2 ? -width : 0;
    const below = descent(ctx.fonts.face(charBase.font), h);
    const dy =
      g.halign === 4
        ? -(h - below) / 2
        : g.valign === 1
          ? below
          : g.valign === 2
            ? -h / 2
            : g.valign === 3
              ? -h
              : 0;
    local = { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
  }
  const frame = composeAffine(textFrame(at, g.rotation, g.backward, g.upsideDown), local);
  const out = new Collector(paint);
  drawLayout(out, layout, frame, ctx.fonts, undefined);
  return out.primitives();
}

function mtextPrimitives(g: MTextGeometry, paint: Paint, ctx: TextContext): RenderPrimitive[] {
  if (!(g.height > 0) || g.contents === '') return [];
  const { layout, bigFont } = mtextLayout(g, ctx);
  const frame = textFrame(g.position, g.rotation, false, !!g.upsideDown);
  const out = new Collector(paint);
  background(out, g, layout, frame);
  drawLayout(out, layout, frame, ctx.fonts, bigFont);
  return out.primitives();
}

/**
 * `TextMeasure` for TOLERANCE frames (M1-52 part 4): the width the renderer lays an MTEXT out
 * at, its widest line's advance, or undefined while its style's font is not loaded.
 */
export function textMeasure(ctx: TextContext): TextMeasure {
  return (g) => {
    const record = ctx.style(g.style);
    if (!ctx.fonts.face(record ? styleFont(record) : STANDARD_FONT)) return undefined;
    if (!(g.height > 0) || g.contents === '') return 0;
    return mtextLayout(g, ctx).layout.lines.reduce((w, l) => Math.max(w, l.width), 0);
  };
}

function mtextLayout(g: MTextGeometry, ctx: TextContext) {
  const { base, record } = baseOf(ctx, g.style, g.height);
  const doc = parseMText(g.contents, base, {
    ...(ctx.evaluateField ? { evaluateField: ctx.evaluateField } : {}),
  });
  const bigFont = record?.bigFont ? ctx.fonts.bigFont(record.bigFont) : undefined;
  const layout = layoutMText(doc, fontMeasure(ctx.fonts, bigFont), {
    height: g.height,
    width: g.width,
    attachment: g.attachment,
    lineSpacingStyle: g.lineSpacingStyle,
    lineSpacing: g.lineSpacing,
    ...(g.columns && g.columns.count > 0
      ? {
          columns: {
            type: g.columns.type === 1 ? 'static' : 'dynamic',
            count: g.columns.count,
            width: g.columns.width,
            gutter: g.columns.gutter,
            heights: g.columns.heights,
            flowReversed: g.columns.flowReversed,
            ...(g.definedHeight === undefined ? {} : { height: g.definedHeight }),
          },
        }
      : {}),
    ...(g.background ? { background: { scale: g.background.scale } } : {}),
  });
  return { layout, bigFont };
}

/**
 * The MTEXT background (DXF 90): bit 1 fills with its colour (63/421), bit 2 with the drawing
 * window colour (a mask), bit 16 draws a frame. The fill reaches (scale − 1) × height beyond
 * the text box on each side ("Background Mask Dialog Box"); a multi-column MTEXT fills each
 * column on its own (our reading). AutoCAD does not document where the frame goes; this draws
 * it on the fill's edge, so a frame with the default 1.5 scale clears the text by half its
 * height, to be checked against reference plots (M1-24 with M1-26).
 */
function background(out: Collector, g: MTextGeometry, layout: MTextLayout, frame: Affine): void {
  const bg = g.background;
  if (!bg || !layout.mask || (bg.flags & 0x13) === 0) return;
  const pad = (bg.scale - 1) * g.height;
  const columns = layout.columns.filter((c) => Number.isFinite(c.minY));
  const boxes =
    columns.length > 0 && columns.length === layout.columns.length
      ? columns.map((c) => ({
          minX: c.minX - pad,
          minY: c.minY - pad,
          maxX: c.maxX + pad,
          maxY: c.maxY + pad,
        }))
      : [layout.mask];
  const paths = boxes.map((b) => transformPath(rect(b.minX, b.minY, b.maxX, b.maxY), frame));
  if (bg.flags & 3) {
    const color: PrimitiveColor = bg.flags & 2 || !bg.color ? 'background' : colorValue(bg.color);
    for (const p of paths) out.mask(p, color);
  }
  if (bg.flags & 16) for (const p of paths) out.frame(p);
}

/** The glyphs of a TEXT or MTEXT, in drawing coordinates. */
export function textPrimitives(
  g: TextGeometry | MTextGeometry,
  paint: Paint,
  ctx: TextContext,
): RenderPrimitive[] {
  return g.kind === 'TEXT' ? textPrimitivesOf(g, paint, ctx) : mtextPrimitives(g, paint, ctx);
}
