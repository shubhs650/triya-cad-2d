// TrueType text in an SVG plot as SVG text (M2-39): the glyphs a plot places (`PlotGlyph`) are
// written as `<text>` runs whose characters a font embedded in the file shows, so the text can
// be found, copied and edited where the SVG opens, and draws as the PDF plot draws it.
//
// Rules encoded here:
// - Each OpenType font is embedded once per file as an `@font-face` whose source is a `data:`
//   URI of a subset holding the glyphs shown, with a cmap mapping each character to the glyph
//   the plot placed for it (an SVG selects glyphs by character, where a PDF selects them by
//   CID) and no layout tables (no kerning, ligatures or substitutions to move or merge them).
//   Its family name is the file's own (`triya-<n>`), then the font's family as installed, so an
//   editor that ignores embedded fonts (Inkscape loads only installed ones) shows the font by
//   name, then a fallback.
// - A run is consecutive glyphs of one font whose matrices differ only by a move along their
//   baseline: one `<text>` whose transform is the run's em frame at a font size of the em's
//   height in points, each character placed by its own `x` (SVG 1.1 §10.4), so no advance,
//   kerning or bidi reordering of the viewer's moves a glyph (`unicode-bidi: bidi-override`).
// - A text item plots as outlines, as the PDF plot does, when any of its fonts may not be
//   embedded (OS/2 fsType) or lacks a table a browser's font sanitiser requires (OS/2, name),
//   and also when any glyph cannot be selected by its character: .notdef, a character two
//   different glyphs show, one XML cannot hold, one a browser draws nothing for (controls, the
//   soft hyphen, format characters, variation selectors), or one above the Basic Multilingual
//   Plane (whose UTF-16 surrogates SVG 1.1 and SVG 2 address differently).
// No DOM here.

import { CffFont } from './cff';
import type { PlotFont } from './fonts';
import { compose, invertible, type PlotGlyph } from './plot';
import type { Affine } from './path';
import { base64 } from './png';
import { TrueTypeFont } from './truetype';

/** An OpenType font embedded in one SVG file, `triya-<n>` in its `@font-face`. */
export class SvgFont {
  /** Character → glyph of the font, as shown. */
  readonly #glyphs = new Map<number, number>();

  constructor(
    readonly name: string,
    readonly font: TrueTypeFont | CffFont,
  ) {}

  /** The font's family as installed (empty when the font names none). */
  get family(): string {
    return this.font.familyName;
  }

  /** The glyph `gid` can be selected by character `cp` in this file. */
  canShow(gid: number, cp: number): boolean {
    if (!(gid > 0 && gid < this.font.numGlyphs) || !showable(cp)) return false;
    const shown = this.#glyphs.get(cp);
    return shown === undefined || shown === gid;
  }

  /** Records that character `cp` shows glyph `gid` (`canShow` first). */
  show(gid: number, cp: number): void {
    this.#glyphs.set(cp, gid);
  }

  /** The font file: a subset of the glyphs shown with a cmap of their characters. */
  file(): Uint8Array {
    const f = this.font;
    if (f instanceof CffFont) return f.openType(this.#glyphs.values(), this.#glyphs);
    // A TrueType subset renumbers its glyphs: .notdef, then the glyphs shown by first use.
    const gids = f.noSubsetting
      ? Array.from({ length: f.numGlyphs }, (_, g) => g)
      : [0, ...new Set(this.#glyphs.values())];
    const index = new Map(gids.map((g, i) => [g, i]));
    const cmap = new Map([...this.#glyphs].map(([cp, g]) => [cp, index.get(g)!]));
    return f.subset(gids, cmap).bytes;
  }

  /** The `@font-face` rule. */
  css(): string {
    const cff = this.font instanceof CffFont;
    return `@font-face{font-family:'${this.name}';src:url(data:font/${cff ? 'otf' : 'ttf'};base64,${base64(
      this.file(),
    )}) format('${cff ? 'opentype' : 'truetype'}');font-weight:${this.weight};font-style:${this.style}}`;
  }

  /** usWeightClass as CSS takes it (1–1000). */
  get weight(): number {
    return Math.min(1000, Math.max(1, this.font.weightClass));
  }

  get style(): 'italic' | 'normal' {
    return this.font.italicAngle !== 0 ? 'italic' : 'normal';
  }
}

/** The fonts of one SVG file, each embedded once whichever items show it. */
export class SvgFonts {
  readonly #byFile = new Map<Uint8Array, SvgFont | null>();
  readonly embedded: SvgFont[] = [];

  /** The embedded font for `font`, or undefined when its text plots as outlines. */
  embed(font: PlotFont): SvgFont | undefined {
    const bytes = font.bytes;
    if (!bytes) return undefined;
    let e = this.#byFile.get(bytes);
    if (e === undefined) {
      const f = TrueTypeFont.parse(bytes) ?? CffFont.parse(bytes);
      e =
        f?.embeddable && f.table('OS/2') && f.table('name')
          ? new SvgFont(`triya-${this.embedded.length + 1}`, f)
          : null;
      if (e) this.embedded.push(e);
      this.#byFile.set(bytes, e);
    }
    return e ?? undefined;
  }

  /** The `<style>` holding every embedded font's `@font-face`, or nothing without fonts. */
  style(): string {
    if (this.embedded.length === 0) return '';
    return `<style type="text/css"><![CDATA[\n${this.embedded.map((f) => f.css()).join('\n')}\n]]></style>`;
  }
}

/**
 * A character a browser draws the selected glyph for and XML can hold, in the Basic
 * Multilingual Plane (see the header).
 */
function showable(cp: number): boolean {
  if (!(cp >= 0x20 && cp < 0xfffe)) return false;
  if (cp >= 0x7f && cp < 0xa0) return false; // DEL and the C1 controls
  if (cp >= 0xd800 && cp < 0xe000) return false; // surrogates
  if (cp === 0xad || cp === 0x34f || cp === 0x61c || cp === 0x180e) return false;
  if (cp >= 0x200b && cp <= 0x200f) return false; // zero width space, joiners, marks
  if (cp >= 0x2028 && cp <= 0x202e) return false; // separators, bidi embeddings
  if (cp >= 0x2060 && cp <= 0x206f) return false; // word joiner, invisible operators, isolates
  if (cp >= 0xfe00 && cp <= 0xfe0f) return false; // variation selectors
  if (cp === 0xfeff || (cp >= 0xfff0 && cp <= 0xfff8)) return false;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return false; // noncharacters
  return true;
}

/** Relative difference under which two glyphs' matrices share a run, as the PDF plot's. */
const SAME = 1e-9;

/** Three decimals, no trailing zeros, no `-0`. */
function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Six decimals: a matrix's linear part. */
function num6(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

/** CSS family names in a double-quoted attribute: quoted, quotes and backslashes dropped. */
function family(name: string): string {
  return `'${name.replace(/['"\\<>&]/g, '')}'`;
}

/**
 * Glyphs as SVG text (see the header), drawn with `fill` (a `fill="…"` attribute) and
 * `extra` attributes, by `toSvg` (world → SVG user units, y down): undefined, recording
 * nothing, when the item must plot as outlines.
 */
export function svgText(
  glyphs: readonly PlotGlyph[],
  toSvg: Affine,
  fonts: SvgFonts,
  fill: string,
  extra = '',
): string | undefined {
  const used = glyphs.map((g) => fonts.embed(g.font));
  // Each glyph must be selectable by its character, also against the glyphs before it.
  const pending = new Map<SvgFont, Map<number, number>>();
  for (let i = 0; i < glyphs.length; i++) {
    const f = used[i];
    const g = glyphs[i]!;
    if (!f || !f.canShow(g.index, g.codePoint)) return undefined;
    const mine = pending.get(f) ?? new Map<number, number>();
    if ((mine.get(g.codePoint) ?? g.index) !== g.index) return undefined;
    mine.set(g.codePoint, g.index);
    pending.set(f, mine);
  }

  type Run = { font: SvgFont; m: Affine; chars: string; xs: number[] };
  const runs: Run[] = [];
  glyphs.forEach((g, i) => {
    const f = used[i]!;
    const upm = f.font.unitsPerEm;
    // One em (y up) → SVG.
    const m = compose(toSvg, compose(g.m, { a: upm, b: 0, c: 0, d: upm, e: 0, f: 0 }));
    if (!invertible(m)) return;
    f.show(g.index, g.codePoint);
    const ch = String.fromCharCode(g.codePoint);
    const run = runs[runs.length - 1];
    if (run && run.font === f && sameLinear(run.m, m)) {
      // Where this glyph's origin lies in the run's em space.
      const r = run.m;
      const det = r.a * r.d - r.b * r.c;
      const dx = m.e - r.e;
      const dy = m.f - r.f;
      const u = (r.d * dx - r.c * dy) / det;
      const v = (-r.b * dx + r.a * dy) / det;
      if (Math.abs(v) < 1e-6) {
        run.chars += ch;
        run.xs.push(u);
        return;
      }
    }
    runs.push({ font: f, m, chars: ch, xs: [0] });
  });
  if (runs.length === 0) return '';

  const texts = runs.map((r) => {
    const { m } = r;
    // The font size: the em's height in points; the transform is the rest of the em frame,
    // y flipped, as text draws glyphs upright in a y-down space.
    const size = Number(num(Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)))) || 1;
    const t = { a: m.a / size, b: m.b / size, c: -m.c / size, d: -m.d / size, e: m.e, f: m.f };
    const f = r.font;
    const families = [f.name, ...(f.family ? [f.family] : [])].map(family).join(', ');
    const weight = f.weight !== 400 ? ` font-weight="${f.weight}"` : '';
    const style = f.style === 'italic' ? ' font-style="italic"' : '';
    return `<text transform="matrix(${num6(t.a)} ${num6(t.b)} ${num6(t.c)} ${num6(t.d)} ${num(t.e)} ${num(
      t.f,
    )})" x="${r.xs.map((x) => num(x * size)).join(' ')}" y="0" font-family="${families}" font-size="${num(
      size,
    )}"${weight}${style} xml:space="preserve">${escape(r.chars)}</text>`;
  });
  // xml:space on each text: Chromium reads it there only, not inherited from a group.
  return `<g ${fill} direction="ltr" unicode-bidi="bidi-override"${extra}>${texts.join('')}</g>`;
}

/** Character data: the characters `showable` lets through, with markup escaped. */
function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
