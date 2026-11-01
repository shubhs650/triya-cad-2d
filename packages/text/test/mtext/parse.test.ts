// MTEXT formatting codes (M1-11): one test per code, from the AutoCAD 2024 "Format Codes for
// Multiline Text" table, plus `%%` control codes, caret codes, fields and grouping.
import { describe, expect, it } from 'vitest';
import {
  parseMText,
  type MTextBase,
  type MTextDocument,
  type MTextItem,
  type MTextParagraph,
} from '../../src/index';

const base: MTextBase = {
  font: { name: 'txt', kind: 'shx', bold: false, italic: false },
  height: 2.5,
  widthFactor: 1,
  oblique: 0,
};

const parse = (s: string, opts?: Parameters<typeof parseMText>[2]): MTextDocument =>
  parseMText(s, base, opts);
const items = (s: string): readonly MTextItem[] => parse(s).paragraphs[0]!.items;
/** The paragraphs' visible text, with stacks as `[up|down]`, tabs as `→`, fields as-is. */
const plain = (doc: MTextDocument): string[] =>
  doc.paragraphs.map((p: MTextParagraph) =>
    p.items
      .map((i) => {
        switch (i.type) {
          case 'text':
          case 'field':
            return i.text;
          case 'tab':
            return '→';
          case 'stack':
            return `[${i.upper}|${i.lower}]`;
          case 'mbcs':
            return `<${i.codepage}:${i.code.toString(16)}>`;
        }
      })
      .join(''),
  );
const text = (s: string): string[] => plain(parse(s));

describe('plain text and grouping', () => {
  it('gives one paragraph with the base style for text without codes', () => {
    const doc = parse('Hello world');
    expect(doc.paragraphs).toHaveLength(1);
    const [run] = doc.paragraphs[0]!.items;
    expect(run).toEqual({
      type: 'text',
      text: 'Hello world',
      style: {
        font: base.font,
        height: 2.5,
        widthFactor: 1,
        oblique: 0,
        tracking: 1,
        underline: false,
        overline: false,
        strike: false,
        valign: 'bottom',
      },
    });
    expect(doc.paragraphs[0]!.end).toBe('end');
  });

  it('gives one empty paragraph for empty contents', () => {
    expect(parse('').paragraphs).toEqual([expect.objectContaining({ items: [], end: 'end' })]);
  });

  it('restores the style at a closing brace and merges runs of the same style', () => {
    const r = items('a{\\H2x;b}c{}d');
    expect(r.map((i) => (i.type === 'text' ? i.text : '?'))).toEqual(['a', 'b', 'cd']);
    expect(r[0]!.style).toBe(r[2]!.style);
    expect(r[1]!.style.height).toBe(5);
  });

  it('ignores an unmatched closing brace and closes open groups at the end', () => {
    expect(text('a}b{c')).toEqual(['abc']);
  });

  it('keeps escaped backslashes and braces literal', () => {
    expect(text('a\\\\b\\{c\\}')).toEqual(['a\\b{c}']);
  });

  it('shows an unknown code literally', () => {
    expect(text('a\\Zb')).toEqual(['a\\Zb']);
    expect(text('end\\')).toEqual(['end\\']);
  });
});

describe('paragraph, column and line codes', () => {
  it('\\P starts a new paragraph', () => {
    const doc = parse('one\\Ptwo\\P');
    expect(plain(doc)).toEqual(['one', 'two', '']);
    expect(doc.paragraphs.map((p) => p.end)).toEqual(['paragraph', 'paragraph', 'end']);
  });

  it('\\N breaks to the next column and \\X splits dimension text at the dimension line', () => {
    expect(parse('a\\Nb').paragraphs.map((p) => p.end)).toEqual(['column', 'end']);
    expect(parse('above\\Xbelow').paragraphs.map((p) => p.end)).toEqual(['dimline', 'end']);
  });

  it('^J and a raw line feed start a paragraph; ^M and a raw CR are dropped', () => {
    expect(text('a^Jb\nc^Md\re')).toEqual(['a', 'b', 'cde']);
  });

  it('^I and a raw tab are tabs; caret-space is a caret', () => {
    const r = items('a^Ib\tc^ d');
    expect(r.map((i) => i.type)).toEqual(['text', 'tab', 'text', 'tab', 'text']);
    expect(text('a^ b')).toEqual(['a^b']);
  });

  it('\\~ is a non-breaking space', () => {
    expect(text('10\\~mm')).toEqual(['10\u00a0mm']);
  });
});

describe('character codes', () => {
  it('\\L \\l underline, \\O \\o overline, \\K \\k strike-through', () => {
    const r = items('\\La\\lb\\Oc\\od\\Ke\\kf');
    const flags = r.map((i) => [i.style.underline, i.style.overline, i.style.strike]);
    expect(flags).toEqual([
      [true, false, false],
      [false, false, false],
      [false, true, false],
      [false, false, false],
      [false, false, true],
      [false, false, false],
    ]);
  });

  it('\\H sets the height, absolute or relative with x', () => {
    const r = items('\\H5;a\\H0.5x;b\\H.5X;c');
    expect(r.map((i) => i.style.height)).toEqual([5, 2.5, 1.25]);
  });

  it('\\W sets the width factor, \\Q the oblique angle, \\T the tracking', () => {
    const [w, q, t] = items('\\W0.8;a\\Q15;b\\T1.5;c');
    expect(w!.style.widthFactor).toBe(0.8);
    expect(q!.style.oblique).toBe(15);
    expect(t!.style.tracking).toBe(1.5);
    // AutoCAD also writes these with an x suffix; the value is still the factor itself.
    expect(items('\\W2x;a')[0]!.style.widthFactor).toBe(2);
  });

  it('\\A sets the vertical alignment within the line', () => {
    const r = items('\\A0;a\\A1;b\\A2;c');
    expect(r.map((i) => i.style.valign)).toEqual(['bottom', 'middle', 'top']);
  });

  it('\\C sets an ACI colour, 0 and 256 being ByBlock and ByLayer', () => {
    const r = items('\\C1;a\\C0;b\\C256;c');
    expect(r.map((i) => i.style.color)).toEqual([
      { kind: 'aci', index: 1 },
      { kind: 'aci', index: 0 },
      { kind: 'aci', index: 256 },
    ]);
    expect(items('a')[0]!.style.color).toBeUndefined();
  });

  it('\\c sets a true colour, stored with red in the low byte', () => {
    expect(items('\\c255;a')[0]!.style.color).toEqual({ kind: 'rgb', r: 255, g: 0, b: 0 });
    expect(items('\\c16744448;a')[0]!.style.color).toEqual({ kind: 'rgb', r: 0, g: 128, b: 255 });
  });

  it('\\f sets a TrueType family with bold, italic, charset and pitch', () => {
    const [run] = items('\\fArial|b1|i0|c0|p34;a');
    expect(run!.style.font).toEqual({
      name: 'Arial',
      kind: 'ttf',
      bold: true,
      italic: false,
      charset: 0,
      pitch: 34,
    });
    expect(items('\\fTimes New Roman|i1;x')[0]!.style.font).toMatchObject({
      name: 'Times New Roman',
      italic: true,
      bold: false,
    });
  });

  it('\\F names an SHX font file', () => {
    expect(items('\\Fromans.shx;a')[0]!.style.font).toEqual({
      name: 'romans.shx',
      kind: 'shx',
      bold: false,
      italic: false,
    });
    expect(items('\\Fromans|c0;a')[0]!.style.font.kind).toBe('shx');
    // A lowercase \f with a .shx file is still an SHX font.
    expect(items('\\fisocp.shx;a')[0]!.style.font.kind).toBe('shx');
  });

  it('takes the rest of the contents as the value when the ; is missing', () => {
    expect(items('\\H5')).toEqual([]);
    expect(parse('a\\C3').paragraphs[0]!.items).toHaveLength(1);
  });

  it('ignores a value that is not a number', () => {
    expect(items('\\Hbig;a')[0]!.style.height).toBe(2.5);
    expect(items('\\C;a')[0]!.style.color).toBeUndefined();
  });
});

describe('unicode and multibyte codes', () => {
  it('\\U+nnnn is a Unicode character', () => {
    expect(text('\\U+00B0C \\U+2205')).toEqual(['\u00b0C \u2205']);
  });

  it('keeps a malformed \\U+ literal', () => {
    expect(text('\\U+12G4')).toEqual(['\\U+12G4']);
  });

  it('\\M+nXXXX is a multibyte character in a code page, kept for the big font', () => {
    const [m] = items('\\M+18140');
    expect(m).toMatchObject({ type: 'mbcs', codepage: 932, code: 0x8140 });
    expect(text('a\\M+5B0A1b')).toEqual(['a<936:b0a1>b']);
    expect(text('\\M+9ABCD')).toEqual(['\\M+9ABCD']);
  });
});

describe('%% control codes', () => {
  it('%%c, %%d and %%p are diameter, degree and plus-minus, in any case', () => {
    expect(text('%%c50 %%D %%p0.1')).toEqual(['\u220550 \u00b0 \u00b10.1']);
  });

  it('%%% is a percent sign and %%nnn a character code', () => {
    expect(text('50%%% %%065')).toEqual(['50% A']);
  });

  it('leaves other %% sequences as written in MTEXT', () => {
    expect(text('%%uUnder %%x 5%')).toEqual(['%%uUnder %%x 5%']);
  });

  it('toggles underline and overline with %%u and %%o in TEXT mode', () => {
    const doc = parseMText('a%%ub%%uc%%od', base, { mode: 'text' });
    const r = doc.paragraphs[0]!.items;
    expect(plain(doc)).toEqual(['abcd']);
    expect(r.map((i) => [i.style.underline, i.style.overline])).toEqual([
      [false, false],
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  it('reads TEXT contents without MTEXT codes', () => {
    expect(plain(parseMText('a\\Pb{c}', base, { mode: 'text' }))).toEqual(['a\\Pb{c}']);
  });
});

describe('stacking (\\S)', () => {
  it('/ is a horizontal fraction, # a diagonal one and ^ a tolerance stack', () => {
    const [f, , d, , t] = items('\\S1/2;x\\S3#4;y\\S+0.1^-0.2;');
    expect(f).toMatchObject({ type: 'stack', upper: '1', lower: '2', kind: 'fraction' });
    expect(d).toMatchObject({ type: 'stack', upper: '3', lower: '4', kind: 'diagonal' });
    expect(t).toMatchObject({ type: 'stack', upper: '+0.1', lower: '-0.2', kind: 'tolerance' });
  });

  it('allows an empty part, escaped separators, %% codes and a missing ;', () => {
    expect(text('\\S^2;')).toEqual(['[|2]']);
    expect(text('\\S1\\/2#3;')).toEqual(['[1/2|3]']);
    expect(text('\\S%%p0.1^0;')).toEqual(['[\u00b10.1|0]']);
    expect(text('\\S1/2')).toEqual(['[1|2]']);
  });

  it('shows a stack with no separator as plain text', () => {
    expect(text('\\Sabc;')).toEqual(['abc']);
  });
});

describe('paragraph properties (\\p)', () => {
  it('reads indents, alignment, tabs and spacing', () => {
    const doc = parse('\\pxi-3,l3,r1,qc,t3,c6,r9,sa1.5,sb0.5;Item');
    expect(doc.paragraphs[0]!.style).toEqual({
      indentFirst: -3,
      indentLeft: 3,
      indentRight: 1,
      align: 'center',
      tabs: [
        { at: 3, kind: 'left' },
        { at: 6, kind: 'center' },
        { at: 9, kind: 'right' },
      ],
      spaceBefore: 0.5,
      spaceAfter: 1.5,
    });
  });

  it('maps every alignment letter', () => {
    const align = (q: string) => parse(`\\pxq${q};a`).paragraphs[0]!.style.align;
    expect(['l', 'r', 'c', 'j', 'd'].map(align)).toEqual([
      'left',
      'right',
      'center',
      'justified',
      'distributed',
    ]);
    expect(align('?')).toBeUndefined();
  });

  it('carries into later paragraphs, and a change mid-paragraph applies to all of it', () => {
    const doc = parse('a\\pqr;b\\Pc{\\pqc;d}\\Pe');
    expect(doc.paragraphs.map((p) => p.style.align)).toEqual(['right', 'center', 'right']);
  });

  it('tz clears the tabs and unknown keys are skipped', () => {
    const doc = parse('\\pt4,8;a\\P\\ptz,w2,i1;b');
    expect(doc.paragraphs[0]!.style.tabs).toHaveLength(2);
    expect(doc.paragraphs[1]!.style).toMatchObject({ tabs: [], indentFirst: 1 });
  });

  it('defaults to no indents, tabs or alignment override', () => {
    expect(parse('a').paragraphs[0]!.style).toEqual({
      indentFirst: 0,
      indentLeft: 0,
      indentRight: 0,
      tabs: [],
    });
  });
});

describe('fields', () => {
  it('shows an unevaluated field as ---- and keeps its code', () => {
    const [, f, after] = items('Date: %<\\AcVar Date \\f "M/d/yyyy">% ok');
    expect(f).toMatchObject({ type: 'field', code: '\\AcVar Date \\f "M/d/yyyy"', text: '----' });
    expect(after).toMatchObject({ type: 'text', text: ' ok' });
  });

  it('asks the evaluator for the value, including nested fields', () => {
    const doc = parse('%<\\AcExpr (%<\\AcVar Filename>%)>%', {
      evaluateField: (code) => (code.startsWith('\\AcExpr') ? 'plan.dwg' : undefined),
    });
    expect(doc.paragraphs[0]!.items[0]).toMatchObject({
      type: 'field',
      code: '\\AcExpr (%<\\AcVar Filename>%)',
      text: 'plan.dwg',
    });
  });

  it('leaves an unclosed field as text', () => {
    expect(text('5%<x >')).toEqual(['5%<x >']);
  });
});
