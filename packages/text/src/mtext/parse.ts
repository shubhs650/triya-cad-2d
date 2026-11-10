// MTEXT formatting-code parser (M1-11): an MTEXT's stored contents → paragraphs of styled
// items, ready for layout. Codes follow AutoCAD 2024's "Format Codes for Multiline Text"
// table and the `%%` control codes of "Control Codes and Special Characters".
//
// Where the documentation is silent, this follows the reading DXF libraries share, noted at
// each place: `\c` true colour has red in the low byte (Windows COLORREF, masked to 24 bits);
// an x suffix makes `\H`, `\W` and `\T` relative to the current value; paragraph properties
// carry into later paragraphs; an unknown code shows literally. See ezdxf's MTEXT notes:
// https://ezdxf.readthedocs.io/en/stable/dxfinternals/entities/mtext.html

/** An MTEXT colour override; undefined in a style means the entity's own colour. */
export type MTextColor =
  | { readonly kind: 'aci'; readonly index: number }
  | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };

export interface MTextFont {
  /** A TrueType family name, or an SHX file name as written (`romans.shx`, `romans`). */
  readonly name: string;
  readonly kind: 'shx' | 'ttf';
  readonly bold: boolean;
  readonly italic: boolean;
  /** Windows character set (`|c`), when stated. */
  readonly charset?: number;
  /** Windows pitch and family (`|p`), when stated. */
  readonly pitch?: number;
}

export interface MTextCharStyle {
  readonly font: MTextFont;
  /** Text height in drawing units. */
  readonly height: number;
  readonly widthFactor: number;
  /** Obliquing angle in degrees. */
  readonly oblique: number;
  /** Tracking factor: 1 is the font's own spacing. */
  readonly tracking: number;
  readonly color?: MTextColor;
  readonly underline: boolean;
  readonly overline: boolean;
  readonly strike: boolean;
  /** `\A`: where a smaller run sits on its line. */
  readonly valign: 'bottom' | 'middle' | 'top';
}

export interface MTextTabStop {
  readonly at: number;
  readonly kind: 'left' | 'center' | 'right' | 'decimal';
  /** A decimal stop's symbol, which it lines up: `.`, `,` or a space (M2-26 part 3). */
  readonly decimal?: string;
}

export type MTextAlign = 'left' | 'right' | 'center' | 'justified' | 'distributed';

/** `\p` paragraph properties, in the units the file states them (resolved by layout). */
export interface MTextParagraphStyle {
  /** First-line indent, relative to `indentLeft`. */
  readonly indentFirst: number;
  readonly indentLeft: number;
  readonly indentRight: number;
  /** Undefined: aligned by the entity's attachment point. */
  readonly align?: MTextAlign;
  readonly tabs: readonly MTextTabStop[];
  readonly spaceBefore?: number;
  readonly spaceAfter?: number;
}

export type MTextItem =
  | { readonly type: 'text'; readonly text: string; readonly style: MTextCharStyle }
  /** A field (`%<…>%`): its code, and the text shown for it. */
  | {
      readonly type: 'field';
      readonly code: string;
      readonly text: string;
      readonly style: MTextCharStyle;
    }
  /** `\M+nXXXX`: a double-byte character, looked up by its code in a big font. */
  | {
      readonly type: 'mbcs';
      readonly codepage: number;
      readonly code: number;
      readonly style: MTextCharStyle;
    }
  | {
      readonly type: 'stack';
      readonly upper: string;
      readonly lower: string;
      /** `/` fraction with a bar, `#` diagonal fraction, `^` tolerance (no bar). */
      readonly kind: 'fraction' | 'diagonal' | 'tolerance';
      readonly style: MTextCharStyle;
    }
  | { readonly type: 'tab'; readonly style: MTextCharStyle };

export interface MTextParagraph {
  readonly style: MTextParagraphStyle;
  readonly items: readonly MTextItem[];
  /** What ends it: `\P`, `\N` (column break), `\X` (dimension line) or the contents' end. */
  readonly end: 'paragraph' | 'column' | 'dimline' | 'end';
  /**
   * The `\p` values in effect for it, as written and in order (those carried in from earlier
   * paragraphs first); absent when none. The in-place editor keeps them as they are (M2-07),
   * since its `style` drops the keys layout does not draw (bullets, numbering, line spacing).
   */
  readonly codes?: readonly string[];
}

export interface MTextDocument {
  readonly paragraphs: readonly MTextParagraph[];
}

/** The entity's own character format, from its text style and height. */
export interface MTextBase {
  readonly font: MTextFont;
  readonly height: number;
  readonly widthFactor: number;
  readonly oblique: number;
}

export interface MTextParseOptions {
  /**
   * `mtext` (default) reads every formatting code; `text` reads TEXT/ATTRIB contents, which
   * have only `%%` codes, where `%%u` and `%%o` toggle underline and overline.
   */
  readonly mode?: 'mtext' | 'text';
  /** A field's current value; undefined shows `----`, AutoCAD's unevaluated-field text. */
  readonly evaluateField?: (code: string) => string | undefined;
}

/** `\M+n`: the code page of each big-font index. */
export const MBCS_CODEPAGES: Readonly<Record<string, number>> = {
  '1': 932, // Japanese (Shift-JIS)
  '2': 950, // Traditional Chinese (Big5)
  '3': 949, // Korean (Wansung)
  '4': 1361, // Korean (Johab)
  '5': 936, // Simplified Chinese (GB2312)
};

/** AutoCAD's symbols for %%c, %%d, %%p ("Unicode Character Strings for Text Symbols"). */
const PERCENT_SYMBOLS: Readonly<Record<string, string>> = {
  c: '∅',
  d: '°',
  p: '±',
};

const ALIGN: Readonly<Record<string, MTextAlign>> = {
  l: 'left',
  r: 'right',
  c: 'center',
  j: 'justified',
  d: 'distributed',
};

const DEFAULT_PARAGRAPH: MTextParagraphStyle = {
  indentFirst: 0,
  indentLeft: 0,
  indentRight: 0,
  tabs: [],
};

const HEX4 = /^[0-9a-fA-F]{4}$/;

function num(s: string): number | undefined {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return undefined;
  return Number(s);
}

/** A factor with an optional x suffix. */
function factor(value: string): { v: number; relative: boolean } | undefined {
  const relative = /[xX]$/.test(value);
  const v = num(relative ? value.slice(0, -1) : value);
  return v === undefined ? undefined : { v, relative };
}

function parseFont(value: string, upper: boolean): MTextFont {
  const [name = '', ...flags] = value.split('|');
  let bold = false;
  let italic = false;
  let charset: number | undefined;
  let pitch: number | undefined;
  for (const f of flags) {
    const v = num(f.slice(1));
    if (v === undefined) continue;
    if (f[0] === 'b') bold = v !== 0;
    else if (f[0] === 'i') italic = v !== 0;
    else if (f[0] === 'c') charset = v;
    else if (f[0] === 'p') pitch = v;
  }
  // \F names a font file (SHX); \f a TrueType family. Files carry either case, so a .shx
  // extension also means SHX.
  const kind = upper || /\.shx$/i.test(name) ? 'shx' : 'ttf';
  return {
    name,
    kind,
    bold,
    italic,
    ...(charset === undefined ? {} : { charset }),
    ...(pitch === undefined ? {} : { pitch }),
  };
}

/**
 * A tab stop: n (left), cn (centre), rn (right) or D<symbol>n (decimal, lining up the symbol at
 * n; ODA's "MTEXT format codes": `\\pxtD.25`). AutoCAD's decimal styles are period, comma and
 * space; `_` (ODA's example) is read as the space, which a `\\p` value cannot hold safely.
 */
function tabStop(tok: string): MTextTabStop | undefined {
  const d = /^D(.)(.+)$/s.exec(tok);
  if (d) {
    const at = num(d[2]!);
    if (at === undefined) return undefined;
    return { at, kind: 'decimal', decimal: d[1] === '_' ? ' ' : d[1]! };
  }
  const m = /^([cr]?)(.+)$/.exec(tok);
  const at = m ? num(m[2]!) : undefined;
  if (!m || at === undefined) return undefined;
  return { at, kind: m[1] === 'c' ? 'center' : m[1] === 'r' ? 'right' : 'left' };
}

/**
 * A `\\p` value's comma-separated keys, the leading x (extended form) dropped. A comma right
 * after a decimal stop's `D` is its symbol, not a separator.
 */
export function paragraphKeys(value: string): string[] {
  return value.replace(/^x/, '').split(/(?<!D),/);
}

/**
 * The paragraph properties a chain of `\p` values sets (`MTextParagraph.codes`), each on top of
 * the ones before it, from the defaults.
 */
export function paragraphStyleOf(codes: readonly string[]): MTextParagraphStyle {
  return codes.reduce((style, v) => parseParagraph(v, style), DEFAULT_PARAGRAPH);
}

/** `\p` value: comma-separated keys, an optional leading x (extended form). */
function parseParagraph(value: string, current: MTextParagraphStyle): MTextParagraphStyle {
  const out: {
    -readonly [K in keyof MTextParagraphStyle]: MTextParagraphStyle[K];
  } = { ...current };
  const tokens = paragraphKeys(value);
  let inTabs = false;
  let tabs: MTextTabStop[] | undefined;
  for (const tok of tokens) {
    // Tab stops follow t until a token that is not one: n, cn, rn or D<symbol>n.
    if (inTabs) {
      const stop = tabStop(tok);
      if (stop) {
        tabs!.push(stop);
        continue;
      }
      inTabs = false;
    }
    const key = tok.startsWith('sa') || tok.startsWith('sb') ? tok.slice(0, 2) : tok[0];
    const rest = tok.slice(key?.length ?? 0);
    switch (key) {
      case 'i':
      case 'l':
      case 'r': {
        const v = num(rest);
        if (v === undefined) break;
        if (key === 'i') out.indentFirst = v;
        else if (key === 'l') out.indentLeft = v;
        else out.indentRight = v;
        break;
      }
      case 'q': {
        const a = ALIGN[rest];
        if (a) out.align = a;
        else delete out.align;
        break;
      }
      case 't': {
        tabs = [];
        out.tabs = tabs;
        if (rest === 'z') break;
        const stop = tabStop(rest);
        if (stop) tabs.push(stop);
        inTabs = true;
        break;
      }
      case 'sa':
      case 'sb': {
        const v = num(rest);
        if (v === undefined) break;
        if (key === 'sa') out.spaceAfter = v;
        else out.spaceBefore = v;
        break;
      }
      default:
        // Bullets, numbering and line-spacing keys are not drawn by v1 layout; skipped.
        break;
    }
  }
  return out;
}

/**
 * Decodes the `%%` symbol codes in a piece of text. `%%u` and `%%o` (TEXT only) are split
 * out by the caller and never reach here; any other `%%` sequence stays as written.
 */
function percentCodes(s: string): string {
  if (!s.includes('%%')) return s;
  let out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] !== '%' || s[i + 1] !== '%' || i + 2 >= s.length) {
      out += s[i++];
      continue;
    }
    const c = s[i + 2]!;
    const lower = c.toLowerCase();
    const digits = /^\d{3}/.exec(s.slice(i + 2));
    if (PERCENT_SYMBOLS[lower]) {
      out += PERCENT_SYMBOLS[lower];
      i += 3;
    } else if (c === '%') {
      out += '%';
      i += 3;
    } else if (digits) {
      out += String.fromCharCode(Number(digits[0]));
      i += 5;
    } else {
      out += '%%';
      i += 2;
    }
  }
  return out;
}

/** The end of a field opened at `start` (`%<`), allowing nested fields; -1 if unclosed. */
function fieldEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '%' && s[i + 1] === '<') {
      depth++;
      i++;
    } else if (s[i] === '>' && s[i + 1] === '%') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

interface Context {
  char: MTextCharStyle;
  para: MTextParagraphStyle;
  /** The `\p` values `para` was made from. */
  codes: readonly string[];
}

class Builder {
  readonly paragraphs: MTextParagraph[] = [];
  items: MTextItem[] = [];
  paraStyle: MTextParagraphStyle;
  paraCodes: readonly string[] = [];
  pending = '';
  pendingStyle: MTextCharStyle | undefined;

  constructor(para: MTextParagraphStyle) {
    this.paraStyle = para;
  }

  text(s: string, style: MTextCharStyle): void {
    if (s === '') return;
    if (this.pendingStyle !== style) this.flush();
    this.pending += s;
    this.pendingStyle = style;
  }

  flush(): void {
    if (this.pending === '' || !this.pendingStyle) return;
    const last = this.items[this.items.length - 1];
    if (last?.type === 'text' && last.style === this.pendingStyle) {
      this.items[this.items.length - 1] = { ...last, text: last.text + this.pending };
    } else {
      this.items.push({ type: 'text', text: this.pending, style: this.pendingStyle });
    }
    this.pending = '';
  }

  item(i: MTextItem): void {
    this.flush();
    this.items.push(i);
  }

  end(kind: MTextParagraph['end'], next: Context): void {
    this.flush();
    this.paragraphs.push({
      style: this.paraStyle,
      items: this.items,
      end: kind,
      ...(this.paraCodes.length > 0 && { codes: this.paraCodes }),
    });
    this.items = [];
    this.paraStyle = next.para;
    this.paraCodes = next.codes;
  }
}

/** Parses MTEXT (or, with `mode: 'text'`, TEXT) contents into styled paragraphs. */
export function parseMText(
  contents: string,
  base: MTextBase,
  options: MTextParseOptions = {},
): MTextDocument {
  const mode = options.mode ?? 'mtext';
  const initial: MTextCharStyle = {
    font: base.font,
    height: base.height,
    widthFactor: base.widthFactor,
    oblique: base.oblique,
    tracking: 1,
    underline: false,
    overline: false,
    strike: false,
    valign: 'bottom',
  };
  let ctx: Context = { char: initial, para: DEFAULT_PARAGRAPH, codes: [] };
  const stack: Context[] = [];
  const out = new Builder(ctx.para);
  const s = contents;

  const setChar = (patch: Partial<MTextCharStyle>): void => {
    ctx = { ...ctx, char: { ...ctx.char, ...patch } };
  };
  /** Text with `%%` codes decoded; in TEXT mode %%u/%%o split it into styled runs. */
  const emit = (t: string): void => {
    if (mode === 'mtext') {
      out.text(percentCodes(t), ctx.char);
      return;
    }
    let piece = '';
    const toggle = (code: 'u' | 'o'): void => {
      out.text(piece, ctx.char);
      piece = '';
      setChar(code === 'u' ? { underline: !ctx.char.underline } : { overline: !ctx.char.overline });
    };
    // Decode piece by piece so each toggle lands between the runs it separates.
    for (let i = 0; i < t.length;) {
      const m = /^%%[uUoO]/.exec(t.slice(i));
      if (m) {
        toggle(m[0][2]!.toLowerCase() as 'u' | 'o');
        i += 3;
        continue;
      }
      const next = t.slice(i + 1).search(/%%[uUoO]/);
      const end = next < 0 ? t.length : i + 1 + next;
      piece += percentCodes(t.slice(i, end));
      i = end;
    }
    out.text(piece, ctx.char);
  };

  /** Reads a code's value up to `;` (or the end); returns [value, index after]. */
  const value = (from: number): [string, number] => {
    const semi = s.indexOf(';', from);
    return semi < 0 ? [s.slice(from), s.length] : [s.slice(from, semi), semi + 1];
  };

  let i = 0;
  let literal = '';
  const flushLiteral = (): void => {
    if (literal !== '') emit(literal);
    literal = '';
  };
  const newParagraph = (kind: MTextParagraph['end']): void => {
    flushLiteral();
    out.end(kind, ctx);
  };

  while (i < s.length) {
    const c = s[i]!;

    if (c === '%' && s[i + 1] === '<') {
      const end = fieldEnd(s, i);
      if (end > 0) {
        flushLiteral();
        const code = s.slice(i + 2, end - 2);
        out.item({
          type: 'field',
          code,
          text: options.evaluateField?.(code) ?? '----',
          style: ctx.char,
        });
        i = end;
        continue;
      }
    }

    if (c === '\n') {
      newParagraph('paragraph');
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\t') {
      flushLiteral();
      out.item({ type: 'tab', style: ctx.char });
      i++;
      continue;
    }
    if (c === '^' && mode === 'mtext' && i + 1 < s.length) {
      // Caret codes are control characters: ^I tab, ^J line feed, ^M carriage return, and
      // caret-space a literal caret. Other control characters draw nothing.
      const n = s[i + 1]!;
      if (n === 'I') {
        flushLiteral();
        out.item({ type: 'tab', style: ctx.char });
      } else if (n === 'J') {
        newParagraph('paragraph');
      } else if (n === ' ') {
        literal += '^';
      }
      i += 2;
      continue;
    }

    if (mode === 'text' || (c !== '\\' && c !== '{' && c !== '}')) {
      literal += c;
      i++;
      continue;
    }

    if (c === '{') {
      flushLiteral();
      stack.push(ctx);
      i++;
      continue;
    }
    if (c === '}') {
      flushLiteral();
      const prev = stack.pop();
      if (prev) ctx = prev;
      i++;
      continue;
    }

    // A backslash code.
    const code = s[i + 1];
    if (code === undefined) {
      literal += '\\';
      i++;
      continue;
    }
    switch (code) {
      case '\\':
      case '{':
      case '}':
        literal += code;
        i += 2;
        continue;
      case '~':
        literal += ' ';
        i += 2;
        continue;
      case 'P':
        newParagraph('paragraph');
        i += 2;
        continue;
      case 'N':
        newParagraph('column');
        i += 2;
        continue;
      case 'X':
        newParagraph('dimline');
        i += 2;
        continue;
      case 'L':
      case 'l':
      case 'O':
      case 'o':
      case 'K':
      case 'k': {
        flushLiteral();
        const on = code === code.toUpperCase();
        const key =
          code.toUpperCase() === 'L'
            ? 'underline'
            : code.toUpperCase() === 'O'
              ? 'overline'
              : 'strike';
        setChar({ [key]: on });
        i += 2;
        continue;
      }
      case 'U': {
        const hex = s.slice(i + 3, i + 7);
        if (s[i + 2] === '+' && HEX4.test(hex)) {
          literal += String.fromCharCode(parseInt(hex, 16));
          i += 7;
          continue;
        }
        break;
      }
      case 'M': {
        const cp = MBCS_CODEPAGES[s[i + 3] ?? ''];
        const hex = s.slice(i + 4, i + 8);
        if (s[i + 2] === '+' && cp !== undefined && HEX4.test(hex)) {
          flushLiteral();
          out.item({ type: 'mbcs', codepage: cp, code: parseInt(hex, 16), style: ctx.char });
          i += 8;
          continue;
        }
        break;
      }
      case 'H':
      case 'W':
      case 'T':
      case 'Q':
      case 'A':
      case 'C':
      case 'c':
      case 'F':
      case 'f':
      case 'p': {
        flushLiteral();
        const [v, next] = value(i + 2);
        i = next;
        applyCode(code, v);
        continue;
      }
      case 'S': {
        flushLiteral();
        const [v, next] = value(i + 2);
        i = next;
        stackItem(v);
        continue;
      }
      default:
        break;
    }
    // Not a code AutoCAD defines: shown as written.
    literal += '\\';
    i++;
  }
  flushLiteral();
  out.end('end', ctx);
  return { paragraphs: out.paragraphs };

  function applyCode(code: string, v: string): void {
    switch (code) {
      case 'H': {
        const f = factor(v);
        if (f) setChar({ height: f.relative ? ctx.char.height * f.v : f.v });
        return;
      }
      case 'W':
      case 'T': {
        const f = factor(v);
        if (!f) return;
        if (code === 'W') setChar({ widthFactor: f.relative ? ctx.char.widthFactor * f.v : f.v });
        else setChar({ tracking: f.relative ? ctx.char.tracking * f.v : f.v });
        return;
      }
      case 'Q': {
        const a = num(v);
        if (a !== undefined) setChar({ oblique: a });
        return;
      }
      case 'A': {
        const a = num(v);
        if (a === 0 || a === 1 || a === 2)
          setChar({ valign: (['bottom', 'middle', 'top'] as const)[a] });
        return;
      }
      case 'C': {
        const a = num(v);
        if (a !== undefined) setChar({ color: { kind: 'aci', index: a } });
        return;
      }
      case 'c': {
        const a = num(v);
        if (a !== undefined)
          setChar({ color: { kind: 'rgb', r: a & 0xff, g: (a >> 8) & 0xff, b: (a >> 16) & 0xff } });
        return;
      }
      case 'F':
      case 'f':
        setChar({ font: parseFont(v, code === 'F') });
        return;
      case 'p': {
        ctx = { ...ctx, para: parseParagraph(v, ctx.para), codes: [...ctx.codes, v] };
        // A paragraph's properties are those last set in it, wherever in it they are set.
        out.paraStyle = ctx.para;
        out.paraCodes = ctx.codes;
        return;
      }
    }
  }

  function stackItem(v: string): void {
    // The first separator not escaped by a backslash splits the stack.
    let upper = '';
    let j = 0;
    let sep: string | undefined;
    for (; j < v.length; j++) {
      const ch = v[j]!;
      if (ch === '\\' && j + 1 < v.length) {
        upper += v[++j];
        continue;
      }
      if (ch === '/' || ch === '#' || ch === '^') {
        sep = ch;
        break;
      }
      upper += ch;
    }
    if (sep === undefined) {
      emit(upper);
      return;
    }
    // After ^ a space keeps the denominator from reading as a caret code; it is not drawn.
    const rest = sep === '^' ? v.slice(j + 1).replace(/^ /, '') : v.slice(j + 1);
    const lower = rest.replace(/\\(.)/g, '$1');
    out.item({
      type: 'stack',
      upper: percentCodes(upper),
      lower: percentCodes(lower),
      kind: sep === '/' ? 'fraction' : sep === '#' ? 'diagonal' : 'tolerance',
      style: ctx.char,
    });
  }
}
