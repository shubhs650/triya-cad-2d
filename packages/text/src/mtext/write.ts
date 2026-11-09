// MTEXT contents from formatted spans (M2-07): what the in-place MTEXT editor holds, written as
// AutoCAD 2024's "Format Codes for Multiline Text", and read back from parsed contents. The
// parser (M1-11, parse.ts) is the other half: `spansOf(parseMText(writeMText(s)))` gives `s`
// back in its normal form (`normalizeSpans`).
//
// Each run whose format differs from the entity's is one `{…}` group with its codes, so no
// format leaks into the next run; heights are absolute `\H`, bold and italic are the `|b|i`
// flags of a `\f` TrueType font change (SHX fonts have neither, as in AutoCAD's editor, where
// the buttons are off for them).
//
// Editing existing MTEXT (M2-07 part 2) keeps what the editor has no control for: width
// (`\W`), tracking (`\T`), obliquing (`\Q`) and alignment (`\A`) are run formats, a font's
// charset and pitch stay on it, column and dimension-line breaks stay what they were, and each
// paragraph keeps the `\p` values in effect for it, as written (`MTextParagraph.codes`).
import type { MTextColor, MTextDocument, MTextFont, MTextItem, MTextBase } from './parse';

/** A run's character format; an absent key is the entity's own (its style and height). */
export interface MTextFormat {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly overline?: boolean;
  readonly strike?: boolean;
  /** Text height in drawing units. */
  readonly height?: number;
  /** Another font: a TrueType family (or file) or an SHX file, with its `|c` and `|p` flags. */
  readonly font?: {
    readonly name: string;
    readonly kind: 'shx' | 'ttf';
    readonly charset?: number;
    readonly pitch?: number;
  };
  readonly color?: MTextColor;
  /** `\W`: width factor, absolute. */
  readonly widthFactor?: number;
  /** `\T`: tracking factor, absolute (1 is the font's own spacing). */
  readonly tracking?: number;
  /** `\Q`: obliquing angle in degrees, absolute. */
  readonly oblique?: number;
  /** `\A`: where a smaller run sits on its line (bottom is the default). */
  readonly valign?: 'middle' | 'top';
}

/**
 * A paragraph break. `end` is a column (`\N`) or dimension-line (`\X`) break kept from the
 * contents read; `paragraph` the `\p` values in effect for the paragraph after it (none: no
 * paragraph formatting).
 */
export interface MTextBreak {
  readonly type: 'break';
  readonly end?: 'column' | 'dimline';
  readonly paragraph?: readonly string[];
}

export type MTextSpan =
  /** Text; a tab is `\t`. No line breaks: a paragraph ends with a `break`. */
  | { readonly type: 'text'; readonly text: string; readonly format: MTextFormat }
  | MTextBreak
  /** A stacked fraction (`/`), diagonal fraction (`#`) or tolerance (`^`). */
  | {
      readonly type: 'stack';
      readonly upper: string;
      readonly lower: string;
      readonly kind: 'fraction' | 'diagonal' | 'tolerance';
      readonly format: MTextFormat;
    }
  /** A field: its code, without the `%<` `>%` around it. */
  | { readonly type: 'field'; readonly code: string; readonly format: MTextFormat };

const SEPARATOR = { fraction: '/', diagonal: '#', tolerance: '^' } as const;

/** Text as MTEXT literal: the code characters escaped, tabs as `^I`, a caret as `^ `. */
function literal(text: string): string {
  let out = '';
  for (const c of text) {
    if (c === '\\' || c === '{' || c === '}') out += `\\${c}`;
    else if (c === '^') out += '^ ';
    else if (c === '\t') out += '^I';
    else if (c === '\n') out += '\\P';
    else if (c !== '\r') out += c;
  }
  return out;
}

/**
 * A stack part: backslashes and separators escaped. A `;` ends the `\S` code whatever comes
 * before it, so it cannot be written and is left out.
 */
function stackPart(text: string): string {
  return text.replace(/;/g, '').replace(/[\\/#^]/g, (c) => `\\${c}`);
}

const VALIGN = { middle: 1, top: 2 } as const;

/** A number as MTEXT writes it: no exponent for the sizes drawings use. */
function num(v: number): string {
  return String(Number(v.toPrecision(12)));
}

function sameColor(a: MTextColor | undefined, b: MTextColor | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'aci' || b.kind === 'aci') {
    return a.kind === b.kind && (a as { index: number }).index === (b as { index: number }).index;
  }
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * A format with only what differs from the entity's font kept: no font equal to the style's,
 * no bold or italic on an SHX font or equal to the font's own, no false decorations.
 */
function normalFormat(f: MTextFormat, base: MTextFont): MTextFormat {
  const font =
    f.font && !(f.font.name === base.name && f.font.kind === base.kind) ? f.font : undefined;
  const ttf = (font ?? base).kind === 'ttf';
  return {
    ...(ttf && f.bold !== undefined && f.bold !== base.bold && { bold: f.bold }),
    ...(ttf && f.italic !== undefined && f.italic !== base.italic && { italic: f.italic }),
    ...(f.underline && { underline: true }),
    ...(f.overline && { overline: true }),
    ...(f.strike && { strike: true }),
    ...(f.height !== undefined && { height: f.height }),
    ...(font && {
      font: {
        name: font.name,
        kind: font.kind,
        ...(font.charset !== undefined && { charset: font.charset }),
        ...(font.pitch !== undefined && { pitch: font.pitch }),
      },
    }),
    ...(f.color && { color: f.color }),
    ...(f.widthFactor !== undefined && { widthFactor: f.widthFactor }),
    ...(f.tracking !== undefined && { tracking: f.tracking }),
    ...(f.oblique !== undefined && { oblique: f.oblique }),
    ...(f.valign !== undefined && { valign: f.valign }),
  };
}

function sameFormat(a: MTextFormat, b: MTextFormat): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.overline === b.overline &&
    a.strike === b.strike &&
    a.height === b.height &&
    a.font?.name === b.font?.name &&
    a.font?.kind === b.font?.kind &&
    a.font?.charset === b.font?.charset &&
    a.font?.pitch === b.font?.pitch &&
    sameColor(a.color, b.color) &&
    a.widthFactor === b.widthFactor &&
    a.tracking === b.tracking &&
    a.oblique === b.oblique &&
    a.valign === b.valign
  );
}

const sameCodes = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((c, i) => c === b[i]);

/** Whether `chain` starts with `head`. */
const extendsCodes = (chain: readonly string[], head: readonly string[]): boolean =>
  head.length <= chain.length && head.every((c, i) => c === chain[i]);

/** A break as written: no empty paragraph codes. */
function normalBreak(b: MTextBreak): MTextBreak {
  return {
    type: 'break',
    ...(b.end && { end: b.end }),
    ...(b.paragraph && b.paragraph.length > 0 && { paragraph: [...b.paragraph] }),
  };
}

/**
 * The spans as the parser reads them back: formats normalized against the style's font, empty
 * text dropped, neighbouring text of one format joined, `;` left out of stacks.
 */
export function normalizeSpans(spans: readonly MTextSpan[], base: MTextFont): MTextSpan[] {
  const out: MTextSpan[] = [];
  for (const s of spans) {
    if (s.type === 'break') {
      out.push(normalBreak(s));
      continue;
    }
    const format = normalFormat(s.format, base);
    if (s.type === 'text') {
      const text = s.text.replace(/\r/g, '');
      if (text === '') continue;
      const last = out.at(-1);
      if (last?.type === 'text' && sameFormat(last.format, format)) {
        out[out.length - 1] = { ...last, text: last.text + text };
      } else out.push({ type: 'text', text, format });
    } else if (s.type === 'stack') {
      out.push({
        ...s,
        upper: s.upper.replace(/;/g, ''),
        lower: s.lower.replace(/;/g, ''),
        format,
      });
    } else out.push({ ...s, format });
  }
  return out;
}

/** The codes that set `f` on top of the entity's format. */
function codes(f: MTextFormat, base: MTextFont): string {
  let out = '';
  if (f.font || f.bold !== undefined || f.italic !== undefined) {
    const font = f.font ?? base;
    const flags =
      (font.charset !== undefined ? `|c${font.charset}` : '') +
      (font.pitch !== undefined ? `|p${font.pitch}` : '');
    if (font.kind === 'shx') {
      if (f.font) out += `\\F${font.name}${flags};`;
    } else {
      const bold = f.bold ?? base.bold;
      const italic = f.italic ?? base.italic;
      out += `\\f${font.name}|b${bold ? 1 : 0}|i${italic ? 1 : 0}${flags};`;
    }
  }
  if (f.height !== undefined) out += `\\H${num(f.height)};`;
  if (f.widthFactor !== undefined) out += `\\W${num(f.widthFactor)};`;
  if (f.tracking !== undefined) out += `\\T${num(f.tracking)};`;
  if (f.oblique !== undefined) out += `\\Q${num(f.oblique)};`;
  if (f.valign !== undefined) out += `\\A${VALIGN[f.valign]};`;
  if (f.color?.kind === 'aci') out += `\\C${f.color.index};`;
  else if (f.color) out += `\\c${f.color.r | (f.color.g << 8) | (f.color.b << 16)};`;
  if (f.underline) out += '\\L';
  if (f.overline) out += '\\O';
  if (f.strike) out += '\\K';
  return out;
}

/** One paragraph's runs and what ends it. */
interface Paragraph {
  readonly codes: readonly string[];
  readonly spans: Exclude<MTextSpan, MTextBreak>[];
  /** The break after it; none for the last. */
  readonly end?: MTextBreak;
}

function paragraphsOf(spans: readonly MTextSpan[], first: readonly string[]): Paragraph[] {
  const out: {
    codes: readonly string[];
    spans: Exclude<MTextSpan, MTextBreak>[];
    end?: MTextBreak;
  }[] = [{ codes: first, spans: [] }];
  for (const s of spans) {
    if (s.type === 'break') {
      out.at(-1)!.end = s;
      out.push({ codes: s.paragraph ?? [], spans: [] });
    } else out.at(-1)!.spans.push(s);
  }
  return out;
}

/**
 * MTEXT contents (DXF 1 and 3) for the spans, on a style whose font is `base`. `paragraph` is
 * the first paragraph's `\p` values (`MTextContent.paragraph`); each break carries the next's.
 *
 * Paragraph properties carry into later paragraphs, so a paragraph's values are written as
 * what they add to those already in effect. A paragraph whose values some later paragraph does
 * not start with is written in braces, which end them with it.
 */
export function writeMText(
  spans: readonly MTextSpan[],
  base: MTextFont,
  paragraph: readonly string[] = [],
): string {
  const paragraphs = paragraphsOf(normalizeSpans(spans, base), paragraph);
  let out = '';
  let outer: readonly string[] = [];
  paragraphs.forEach((p, i) => {
    const later = paragraphs.slice(i + 1);
    // Every paragraph's values start with those in effect outside it (`outer`), since a
    // paragraph's values become `outer` only when all later ones start with them.
    const scoped = !later.every((q) => extendsCodes(q.codes, p.codes));
    const added = p.codes.slice(outer.length);
    const head = added.map((c) => `\\p${c};`).join('');
    const body = runs(p.spans, base);
    out += scoped && head !== '' ? `{${head}${body}}` : `${head}${body}`;
    if (!scoped) outer = p.codes;
    if (p.end) out += p.end.end === 'column' ? '\\N' : p.end.end === 'dimline' ? '\\X' : '\\P';
  });
  return out;
}

/** One paragraph's runs, each format change a `{…}` group. */
function runs(spans: readonly Exclude<MTextSpan, MTextBreak>[], base: MTextFont): string {
  let out = '';
  let group: { codes: string; body: string } | undefined;
  const close = (): void => {
    if (!group) return;
    out += group.codes === '' ? group.body : `{${group.codes}${group.body}}`;
    group = undefined;
  };
  for (const s of spans) {
    const c = codes(s.format, base);
    if (group?.codes !== c) {
      close();
      group = { codes: c, body: '' };
    }
    if (s.type === 'text') group.body += literal(s.text);
    else if (s.type === 'field') group.body += `%<${s.code}>%`;
    else {
      // After ^ the parser drops one space (it keeps the lower part from reading as a caret
      // code), so one is always written.
      const sep = s.kind === 'tolerance' ? '^ ' : SEPARATOR[s.kind];
      group.body += `\\S${stackPart(s.upper)}${sep}${stackPart(s.lower)};`;
    }
  }
  close();
  return out;
}

/** The format of a parsed run, relative to the entity's. */
function formatOf(style: MTextItem['style'], base: MTextBase): MTextFormat {
  const sameFont =
    style.font.name === base.font.name &&
    style.font.kind === base.font.kind &&
    style.font.charset === base.font.charset &&
    style.font.pitch === base.font.pitch;
  return normalFormat(
    {
      bold: style.font.bold,
      italic: style.font.italic,
      underline: style.underline,
      overline: style.overline,
      strike: style.strike,
      ...(style.height !== base.height && { height: style.height }),
      ...(!sameFont && { font: style.font }),
      ...(style.color && { color: style.color }),
      ...(style.widthFactor !== base.widthFactor && { widthFactor: style.widthFactor }),
      ...(style.tracking !== 1 && { tracking: style.tracking }),
      ...(style.oblique !== base.oblique && { oblique: style.oblique }),
      ...(style.valign !== 'bottom' && { valign: style.valign }),
    },
    base.font,
  );
}

/** MTEXT contents as the editor holds them: the first paragraph's `\p` values and the spans. */
export interface MTextContent {
  readonly paragraph: readonly string[];
  readonly spans: MTextSpan[];
}

/**
 * Parsed contents as editor spans, with everything the editor has no control for kept (see the
 * file comment), so that `writeMText` gives contents that read back the same. Not kept: a
 * double-byte `\M+` character is read as the character of its code.
 */
export function contentOf(doc: MTextDocument, base: MTextBase): MTextContent {
  const spans: MTextSpan[] = [];
  doc.paragraphs.forEach((p, i) => {
    if (i > 0) {
      const prev = doc.paragraphs[i - 1]!;
      spans.push({
        type: 'break',
        ...(prev.end === 'column' && { end: 'column' as const }),
        ...(prev.end === 'dimline' && { end: 'dimline' as const }),
        ...(p.codes && { paragraph: p.codes }),
      });
    }
    for (const item of p.items) {
      const format = formatOf(item.style, base);
      switch (item.type) {
        case 'text':
          spans.push({ type: 'text', text: item.text, format });
          break;
        case 'tab':
          spans.push({ type: 'text', text: '\t', format });
          break;
        case 'mbcs':
          spans.push({ type: 'text', text: String.fromCharCode(item.code), format });
          break;
        case 'field':
          spans.push({ type: 'field', code: item.code, format });
          break;
        case 'stack':
          spans.push({
            type: 'stack',
            upper: item.upper,
            lower: item.lower,
            kind: item.kind,
            format,
          });
          break;
      }
    }
  });
  return {
    paragraph: doc.paragraphs[0]?.codes ?? [],
    spans: normalizeSpans(spans, base.font),
  };
}

/** The spans of parsed contents (`contentOf` without the first paragraph's values). */
export function spansOf(doc: MTextDocument, base: MTextBase): MTextSpan[] {
  return contentOf(doc, base).spans;
}

/** Whether two contents are the same once normalized (an edit that changed nothing). */
export function sameContent(a: MTextContent, b: MTextContent, base: MTextFont): boolean {
  return (
    sameCodes(a.paragraph, b.paragraph) &&
    JSON.stringify(normalizeSpans(a.spans, base)) === JSON.stringify(normalizeSpans(b.spans, base))
  );
}
