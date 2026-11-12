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
//
// Vertical text (M1-110, "Text Style Dialog Box", "MTEXT (DXF)"): TEXT in a STYLE with the
// vertical flag (DXF 70 bit 4), and MTEXT drawn top to bottom (DXF 72 = 3, or 5 "by style"
// with that flag), stack their characters down a column, but only in an SHX font that supports
// both orientations (font info mode 2): AutoCAD offers vertical text for no other font, so text
// in any other font (Hershey, TrueType, a mode-0 SHX) draws horizontally. The font's own code 14
// commands place each character, which classic fonts hang centred below the pen. AutoCAD does
// not document the rest; these are our readings, the common drafter expectation:
// - a vertical TEXT starts its column at its point for Left (and Top) justification, centres
//   it there for Center and Middle, and ends it there for Right (and Bottom); Aligned and Fit
//   scale it between its two points, Aligned the characters too;
// - a vertical MTEXT turns each line into a column and sets the columns right to left, the way
//   vertical (East Asian) writing reads; its attachment point places the block of columns, and
//   it does not wrap, as the reference width (DXF 41) is a horizontal measure;
// - an MTEXT with a run in a font without vertical text, or with a stacked fraction, draws
//   horizontally as a whole rather than mixing orientations.

import {
  bulgeArc,
  type AttributeFields,
  type Handle,
  type MTextGeometry,
  type TextGeometry,
  type TextMeasure,
  type TextStyleRecord,
} from '@triya/engine';
import {
  DEFAULT_BUNDLED_FONT,
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
  verticalAdvance,
  verticalFace,
} from '@triya/text';
import { composeAffine, transformPath, type Affine } from './affine';
import type { EmbedPlacement } from './style/dash';
import { colorValue } from './style/resolve';
import type { Paint } from './tessellate';
import {
  PATH_A,
  PATH_C,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  type PlacedGlyph,
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
/** The same for SHX glyphs in vertical text. */
const verticalShapes = new WeakMap<object, Map<number, GlyphShape>>();

function cached(
  font: object,
  key: number,
  build: () => GlyphShape,
  cache: WeakMap<object, Map<number, GlyphShape>> = shapes,
): GlyphShape {
  let m = cache.get(font);
  if (!m) cache.set(font, (m = new Map()));
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

/** A shape's glyph in vertical text, from a font that supports it. */
function verticalShape(font: ShxFont, code: number | undefined): GlyphShape | undefined {
  if (code === undefined) return undefined;
  const g = font.verticalGlyph(code);
  return g && cached(font, code, () => shxPath(g), verticalShapes);
}

interface Group {
  readonly fill: boolean;
  readonly color: PrimitiveColor;
  readonly path: number[];
  /** One box per run, cap height tall, for the greeking LOD; and the tallest run's height. */
  readonly greek: number[];
  /** TrueType glyphs, as a PDF plot writes them as text. */
  readonly glyphs: PlacedGlyph[];
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

  /**
   * A TrueType glyph: its outline (when it has one) and, for a PDF plot, the glyph itself, so
   * a space between words is kept too.
   */
  ttf(face: TextFace & { kind: 'ttf' }, glyph: TtfGlyph, m: Affine, color: PrimitiveColor): void {
    const shape = cached(face.font, glyph.codePoint, () => ttfPath(glyph));
    if (shape.path.length > 0) this.add(shape, m, color);
    this.#group(true, color).glyphs.push({
      font: face.font,
      index: glyph.index,
      codePoint: glyph.codePoint,
      m,
    });
  }

  /** A shape (complex linetypes): its strokes, and its height for the greeking LOD. */
  shape(shape: GlyphShape, m: Affine, height: number, color: PrimitiveColor): void {
    this.add(shape, m, color);
    const g = this.#group(false, color);
    g.height = Math.max(g.height, height);
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
    if (!g)
      this.#groups.set(key, (g = { fill, color, path: [], greek: [], glyphs: [], height: 0 }));
    return g;
  }

  primitives(): RenderPrimitive[] {
    const glyphs = [...this.#groups.values()]
      .filter((g) => g.path.length > 0)
      .map(({ fill, color, path, greek, glyphs, height }): RenderPrimitive => {
        const text = { height, greek, ...(glyphs.length > 0 ? { glyphs } : {}) };
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
export function placeText(
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
    const m = composeAffine(frame, { a: sx, b: 0, c: shear, d: s, e: pen, f: y });
    if (face.kind === 'ttf') out.ttf(face, face.font.glyph(cp), m, color);
    else {
      const shape = glyphShape(face, cp);
      if (shape && shape.path.length > 0) out.add(shape, m, color);
    }
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

/**
 * Vertical text is laid out as horizontal text whose x runs down the column and whose y runs
 * across the columns; this turns those layout coordinates into the upright text frame.
 */
const DOWN: Affine = { a: 0, b: -1, c: 1, d: 0, e: 0, f: 0 };

/** STYLE DXF 70 bit: vertical text. */
const VERTICAL_STYLE = 4;

/** Whether every run of a layout can draw vertically (see the header). */
function verticalLayout(layout: MTextLayout, fonts: TextFonts, bigFont?: ShxFont): boolean {
  return layout.lines.every((line) =>
    line.runs.every((run) =>
      run.kind === 'text'
        ? verticalFace(fonts.face(run.style.font))
        : run.kind === 'mbcs' && bigFont !== undefined && bigFont.supportsVertical,
    ),
  );
}

/**
 * Draws a string down its column in vertical text, from `along` down the column, on the
 * column line `pen` across, in the upright frame.
 */
function placeVertical(
  out: Collector,
  fonts: TextFonts,
  frame: Affine,
  text: string,
  along: number,
  pen: number,
  style: MTextCharStyle,
): void {
  const face = fonts.face(style.font);
  if (face?.kind !== 'shx') return;
  const s = face.font.scaleFor(style.height);
  const shear = Math.tan((style.oblique * Math.PI) / 180) * s;
  const color = runColor(style.color, out.paint);
  let y = along;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const shape = verticalShape(face.font, shxCode(face.font, cp));
    if (shape && shape.path.length > 0) {
      const m = { a: s * style.widthFactor, b: 0, c: shear, d: s, e: pen, f: -y };
      out.add(shape, composeAffine(frame, m), color);
    }
    y += verticalAdvance(face, cp) * s * style.tracking;
  }
  // Greeking: the column the run fills, a height wide.
  const box = { x0: along, x1: y, y: pen - style.height / 2, height: style.height };
  out.run(face, composeAffine(frame, DOWN), color, box);
}

/**
 * Every run and decoration of a vertical layout. A line's column runs along the line's
 * baseline (TEXT, whose font centres characters on it) or half its height above it (MTEXT, so
 * the columns sit inside the block like lines inside the box).
 */
function drawVerticalLayout(
  out: Collector,
  layout: MTextLayout,
  frame: Affine,
  fonts: TextFonts,
  bigFont: ShxFont | undefined,
  centred: boolean,
): void {
  for (const line of layout.lines) {
    const lift = centred ? line.height / 2 : 0;
    for (const run of line.runs) {
      if (run.kind === 'text') {
        placeVertical(out, fonts, frame, run.text, run.x, run.y + lift, run.style);
      } else if (run.kind === 'mbcs' && bigFont) {
        const shape = verticalShape(bigFont, bigFont.hasShape(run.code) ? run.code : undefined);
        if (!shape) continue;
        const s = bigFont.scaleFor(run.style.height);
        const m = { a: s * run.style.widthFactor, b: 0, c: 0, d: s, e: run.y + lift, f: -run.x };
        out.add(shape, composeAffine(frame, m), runColor(run.style.color, out.paint));
      }
    }
    // Decorations keep their place beside the characters, which sit `lift` above the baseline
    // instead of filling the height above it.
    const turned = composeAffine(frame, { ...DOWN, e: lift - line.height / 2 });
    for (const d of line.decorations) out.line(turned, d.x1, d.y, d.x2, d.y, out.paint.color);
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
  const out = new Collector(paint);
  drawText(out, g, ctx);
  return out.primitives();
}

/** Lays a TEXT out and adds its glyphs to `out`. */
function drawText(out: Collector, g: TextGeometry, ctx: TextContext): void {
  const placed = placedText(g, ctx);
  if (!placed) return;
  if (placed.vertical) return drawVerticalText(out, g, placed.layout, ctx);
  drawLayout(out, placed.layout, placed.frame, ctx.fonts, undefined);
}

/**
 * A TEXT laid out in the fonts loaded now and placed by its justification: the frame taking
 * its baseline start to the origin of the layout, the advance of its line and how far its font
 * reaches below the baseline. A vertical style's column is placed by `drawVerticalText`.
 */
export function placedText(
  g: TextGeometry,
  ctx: TextContext,
):
  | { readonly vertical: true; readonly layout: MTextLayout }
  | {
      readonly vertical: false;
      readonly layout: MTextLayout;
      readonly frame: Affine;
      readonly width: number;
      readonly below: number;
    }
  | undefined {
  if (!(g.height > 0) || g.value === '') return undefined;
  const { base, record } = baseOf(ctx, g.style, g.height);
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
  if (((record?.flags ?? 0) & VERTICAL_STYLE) !== 0) {
    const measure = fontMeasure(ctx.fonts, undefined, { vertical: true });
    const layout = layoutMText(doc, measure, options);
    if (verticalLayout(layout, ctx.fonts)) return { vertical: true, layout };
  }
  const layout = layoutMText(doc, fontMeasure(ctx.fonts), options);
  const width = layout.lines[0]?.width ?? 0;
  const h = g.height;
  const below = descent(ctx.fonts.face(charBase.font), h);
  let local: Affine;
  let at = g.position;
  if ((g.halign === 3 || g.halign === 5) && g.alignmentPoint) {
    const len = Math.hypot(g.alignmentPoint.x - g.position.x, g.alignmentPoint.y - g.position.y);
    const k = width > 0 && len > 0 ? len / width : 1;
    local = { a: k, b: 0, c: 0, d: g.halign === 3 ? k : 1, e: 0, f: 0 };
  } else {
    if ((g.halign !== 0 || g.valign !== 0) && g.alignmentPoint) at = g.alignmentPoint;
    const dx = g.halign === 1 || g.halign === 4 ? -width / 2 : g.halign === 2 ? -width : 0;
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
  return { vertical: false, layout, frame, width, below };
}

/** A vertical TEXT's column placed by its justification (see the header). */
function drawVerticalText(
  out: Collector,
  g: TextGeometry,
  layout: MTextLayout,
  ctx: TextContext,
): void {
  const length = layout.lines[0]?.width ?? 0;
  let at = g.position;
  let local: Affine;
  if ((g.halign === 3 || g.halign === 5) && g.alignmentPoint) {
    const len = Math.hypot(g.alignmentPoint.x - g.position.x, g.alignmentPoint.y - g.position.y);
    const k = length > 0 && len > 0 ? len / length : 1;
    local = { a: g.halign === 3 ? k : 1, b: 0, c: 0, d: k, e: 0, f: 0 };
  } else {
    if ((g.halign !== 0 || g.valign !== 0) && g.alignmentPoint) at = g.alignmentPoint;
    // How much of the column lies above the point: none from the start, half, or all of it.
    const part =
      g.valign === 3
        ? 0
        : g.valign === 2 || g.halign === 1 || g.halign === 4
          ? 0.5
          : g.valign === 1 || g.halign === 2
            ? 1
            : 0;
    local = { a: 1, b: 0, c: 0, d: 1, e: 0, f: part * length };
  }
  const frame = composeAffine(textFrame(at, g.rotation, g.backward, g.upsideDown), local);
  drawVerticalLayout(out, layout, frame, ctx.fonts, undefined, false);
}

function mtextPrimitives(g: MTextGeometry, paint: Paint, ctx: TextContext): RenderPrimitive[] {
  if (!(g.height > 0) || g.contents === '') return [];
  const frame = textFrame(g.position, g.rotation, false, !!g.upsideDown);
  const out = new Collector(paint);
  const vertical = verticalMText(g, ctx);
  if (vertical) {
    const turned = composeAffine(frame, DOWN);
    background(out, g, vertical.layout, turned);
    drawVerticalLayout(out, vertical.layout, frame, ctx.fonts, vertical.bigFont, true);
    return out.primitives();
  }
  const { layout, bigFont } = mtextLayout(g, ctx);
  background(out, g, layout, frame);
  drawLayout(out, layout, frame, ctx.fonts, bigFont);
  return out.primitives();
}

/**
 * An MTEXT drawn top to bottom, laid out with lines as columns, or undefined when it draws
 * horizontally (see the header). The attachment point of the block of columns becomes the
 * attachment of the turned layout: its top, middle and bottom are the layout's left, centre
 * and right, and its left, centre and right the layout's bottom, middle and top.
 */
function verticalMText(g: MTextGeometry, ctx: TextContext) {
  const record = ctx.style(g.style);
  const byStyle = g.direction === 5 && ((record?.flags ?? 0) & VERTICAL_STYLE) !== 0;
  if (g.direction !== 3 && !byStyle) return undefined;
  const a = Math.min(9, Math.max(1, Math.round(g.attachment))) - 1;
  const attachment = 3 * (2 - (a % 3)) + Math.floor(a / 3) + 1;
  const v = mtextLayout({ ...g, width: 0, attachment, columns: undefined }, ctx, true);
  return verticalLayout(v.layout, ctx.fonts, v.bigFont) ? v : undefined;
}

/** Dynamic columns counted up to this many: the limit `dynamicColumnCount` (@triya/text) uses. */
const MAX_DYNAMIC_COLUMNS = 100;

/**
 * How many dynamic columns an MTEXT's text takes as laid out now (M2-26 part 2: a column grip
 * changed their width, gutter or height), its own count for static columns, or undefined while
 * its style's font is not loaded. A column past the manual heights takes the last one's, as
 * TEXTEDIT gives it.
 */
export function columnCounter(ctx: TextContext): (g: MTextGeometry) => number | undefined {
  return (g) => {
    const c = g.columns;
    if (!c || c.count < 1) return undefined;
    if (c.type !== 2) return c.count;
    const record = ctx.style(g.style);
    if (!ctx.fonts.face(record ? styleFont(record) : STANDARD_FONT)) return undefined;
    if (!(g.height > 0) || g.contents === '') return 1;
    const heights =
      c.heights.length > 0
        ? Array.from(
            { length: MAX_DYNAMIC_COLUMNS },
            (_, i) => c.heights[Math.min(i, c.heights.length - 1)]!,
          )
        : [];
    const columns = { ...c, count: MAX_DYNAMIC_COLUMNS, heights };
    return mtextLayout({ ...g, columns }, ctx).layout.columnsUsed ?? c.count;
  };
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

function mtextLayout(
  g: Omit<MTextGeometry, 'columns'> & { readonly columns?: MTextGeometry['columns'] | undefined },
  ctx: TextContext,
  vertical = false,
) {
  const { base, record } = baseOf(ctx, g.style, g.height);
  const doc = parseMText(g.contents, base, {
    ...(ctx.evaluateField ? { evaluateField: ctx.evaluateField } : {}),
  });
  const bigFont = record?.bigFont ? ctx.fonts.bigFont(record.bigFont) : undefined;
  const layout = layoutMText(doc, fontMeasure(ctx.fonts, bigFont, { vertical }), {
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
  if ((bg.flags & 16) === 0) return;
  // A multileader's frame keeps its landing gap where its mask has a scale of its own (M2-44).
  if (bg.frameScale === undefined || bg.frameScale === bg.scale || boxes.length !== 1) {
    for (const p of paths) out.frame(p);
    return;
  }
  const b = layout.bounds;
  const k = (bg.frameScale - 1) * g.height;
  out.frame(transformPath(rect(b.minX - k, b.minY - k, b.maxX + k, b.maxY + k), frame));
}

/**
 * What an attribute draws (M1-14 part 2): its value as a TEXT in the attribute's own frame,
 * or a multiline attribute's embedded MTEXT. For an ATTRIB the value is what the user typed;
 * for a constant ATTDEF inside a reference, the default value AutoCAD shows for it.
 */
export function attributeText(a: AttributeFields): TextGeometry | MTextGeometry {
  return a.mtext ?? { ...a, kind: 'TEXT' };
}

/**
 * Whether ATTMODE (ATTDISP) shows an attribute with these DXF 70 flags: 0 shows none, 2 shows
 * every one, and 1 (normal, AutoCAD's initial value, also taken for anything else) shows those
 * without the invisible bit.
 */
export function attributeShown(flags: number, attMode: number | undefined): boolean {
  if (attMode === 0) return false;
  if (attMode === 2) return true;
  return (flags & 1) === 0;
}

/** The glyphs of a TEXT or MTEXT, in drawing coordinates. */
export function textPrimitives(
  g: TextGeometry | MTextGeometry,
  paint: Paint,
  ctx: TextContext,
): RenderPrimitive[] {
  return g.kind === 'TEXT' ? textPrimitivesOf(g, paint, ctx) : mtextPrimitives(g, paint, ctx);
}

/**
 * The text and shapes a complex linetype places along an entity (M1-45), in the entity's
 * colour and lineweight, as glyph primitives with the usual greeking.
 *
 * AutoCAD ("Text in Custom Linetypes", "Shapes in Custom Linetypes"): text is drawn in the
 * named text style, `S=` multiplying the style's fixed height, or giving the height itself
 * when the style's height is 0; it starts at the placement, left on its baseline, with the
 * style's width factor and obliquing. A shape is the numbered shape of the shape file the
 * STYLE record names, at `S=` (times the linetype scale, already in `scale`). A style that is
 * missing, or a shape file that is not loaded, leaves the gap empty: it is listed in
 * `FontBook.missing` for the health report, and no other font stands in for a shape file,
 * as its shape numbers mean nothing in another file.
 */
export function linetypeEmbedPrimitives(
  embeds: readonly EmbedPlacement[],
  paint: Paint,
  ctx: TextContext,
): RenderPrimitive[] {
  const out = new Collector(paint);
  for (const p of embeds) {
    const e = p.embed;
    const style = e.style === undefined ? undefined : ctx.style(e.style);
    if (!style) continue;
    if (e.kind === 'text') {
      drawText(
        out,
        {
          kind: 'TEXT',
          value: e.text ?? '',
          style: style.handle,
          position: p.at,
          height: (style.height > 0 ? style.height : 1) * p.scale,
          rotation: p.angle,
          widthFactor: style.widthFactor,
          oblique: style.obliqueAngle,
          halign: 0,
          valign: 0,
          backward: false,
          upsideDown: false,
        },
        ctx,
      );
      continue;
    }
    if (e.shapeNumber === undefined) continue;
    const font = ctx.fonts.bigFont(style.font);
    const shape = font && font.hasShape(e.shapeNumber) ? shxShape(font, e.shapeNumber) : undefined;
    if (!font || !shape) continue;
    const k = font.scaleFor(p.scale);
    const c = Math.cos(p.angle) * k;
    const s = Math.sin(p.angle) * k;
    out.shape(shape, { a: c, b: s, c: -s, d: c, e: p.at.x, f: p.at.y }, p.scale, paint.color);
  }
  return out.primitives();
}

/** A label's font (M1-109): the bundled default, so it reads the same whatever the styles. */
const LABEL_FONT = { name: DEFAULT_BUNDLED_FONT, kind: 'shx', bold: false, italic: false } as const;

/** A frame label's width per unit of height, or undefined when it cannot be drawn. */
export function labelWidth(label: string, ctx: TextContext): number | undefined {
  const face = label === '' ? undefined : ctx.fonts.face(LABEL_FONT);
  if (!face) return undefined;
  let advance = 0;
  for (const ch of label) advance += charAdvance(face, ch.codePointAt(0)!);
  const unit = advance * face.font.scaleFor(1);
  return unit > 0 ? unit : undefined;
}

/**
 * A label (M1-109: a missing image's file name) `height` tall, centred on the origin of
 * `frame`, which maps label coordinates (x along the label, y up, unit scale) to drawing ones;
 * in the paint's colour and lineweight, in the bundled default font. AutoCAD documents that a
 * missing image shows its file name in its frame, but not the font or size.
 */
export function frameLabelPrimitives(
  label: string,
  frame: Affine,
  height: number,
  paint: Paint,
  ctx: TextContext,
): RenderPrimitive[] {
  const unit = labelWidth(label, ctx);
  if (unit === undefined || !(height > 0)) return [];
  const out = new Collector(paint);
  const style: MTextCharStyle = {
    font: LABEL_FONT,
    height,
    widthFactor: 1,
    oblique: 0,
    tracking: 1,
    underline: false,
    overline: false,
    strike: false,
    valign: 'bottom',
  };
  placeText(out, ctx.fonts, frame, label, (-unit * height) / 2, -height / 2, style);
  return out.primitives();
}
