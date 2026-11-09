// MTEXT contents from formatted spans (M2-07): what the in-place MTEXT editor holds, written as
// AutoCAD 2024's "Format Codes for Multiline Text", and read back from parsed contents. The
// parser (M1-11, parse.ts) is the other half: `spansOf(parseMText(writeMText(s)))` gives `s`
// back in its normal form (`normalizeSpans`).
//
// Each run whose format differs from the entity's is one `{…}` group with its codes, so no
// format leaks into the next run; heights are absolute `\H`, bold and italic are the `|b|i`
// flags of a `\f` TrueType font change (SHX fonts have neither, as in AutoCAD's editor, where
// the buttons are off for them).
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
  /** Another font: a TrueType family (or file) or an SHX file. */
  readonly font?: { readonly name: string; readonly kind: 'shx' | 'ttf' };
  readonly color?: MTextColor;
}

export type MTextSpan =
  /** Text; a tab is `\t`. No line breaks: a paragraph ends with a `break`. */
  | { readonly type: 'text'; readonly text: string; readonly format: MTextFormat }
  | { readonly type: 'break' }
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
    ...(font && { font: { name: font.name, kind: font.kind } }),
    ...(f.color && { color: f.color }),
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
    sameColor(a.color, b.color)
  );
}

/**
 * The spans as the parser reads them back: formats normalized against the style's font, empty
 * text dropped, neighbouring text of one format joined, `;` left out of stacks.
 */
export function normalizeSpans(spans: readonly MTextSpan[], base: MTextFont): MTextSpan[] {
  const out: MTextSpan[] = [];
  for (const s of spans) {
    if (s.type === 'break') {
      out.push(s);
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
    if (font.kind === 'shx') {
      if (f.font) out += `\\F${font.name};`;
    } else {
      const bold = f.bold ?? base.bold;
      const italic = f.italic ?? base.italic;
      out += `\\f${font.name}|b${bold ? 1 : 0}|i${italic ? 1 : 0};`;
    }
  }
  if (f.height !== undefined) out += `\\H${f.height};`;
  if (f.color?.kind === 'aci') out += `\\C${f.color.index};`;
  else if (f.color) out += `\\c${f.color.r | (f.color.g << 8) | (f.color.b << 16)};`;
  if (f.underline) out += '\\L';
  if (f.overline) out += '\\O';
  if (f.strike) out += '\\K';
  return out;
}

/** MTEXT contents (DXF 1 and 3) for the spans, on a style whose font is `base`. */
export function writeMText(spans: readonly MTextSpan[], base: MTextFont): string {
  let out = '';
  let group: { codes: string; body: string } | undefined;
  const close = (): void => {
    if (!group) return;
    out += group.codes === '' ? group.body : `{${group.codes}${group.body}}`;
    group = undefined;
  };
  for (const s of normalizeSpans(spans, base)) {
    if (s.type === 'break') {
      close();
      out += '\\P';
      continue;
    }
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
  const sameFont = style.font.name === base.font.name && style.font.kind === base.font.kind;
  return normalFormat(
    {
      bold: style.font.bold,
      italic: style.font.italic,
      underline: style.underline,
      overline: style.overline,
      strike: style.strike,
      ...(style.height !== base.height && { height: style.height }),
      ...(!sameFont && { font: { name: style.font.name, kind: style.font.kind } }),
      ...(style.color && { color: style.color }),
    },
    base.font,
  );
}

/**
 * Parsed contents as editor spans. What the editor has no control for is dropped: paragraph
 * formatting, width, tracking, obliquing and alignment changes, and column and dimension-line
 * breaks (read as paragraph breaks).
 */
export function spansOf(doc: MTextDocument, base: MTextBase): MTextSpan[] {
  const spans: MTextSpan[] = [];
  doc.paragraphs.forEach((p, i) => {
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
    if (i < doc.paragraphs.length - 1) spans.push({ type: 'break' });
  });
  return normalizeSpans(spans, base.font);
}
