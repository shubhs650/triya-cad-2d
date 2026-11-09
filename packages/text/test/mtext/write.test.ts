// MTEXT contents from the in-place editor (M2-07): the editor's formatted spans are written as
// AutoCAD's MTEXT format codes ("Format Codes for Multiline Text", AutoCAD 2024 Help), and the
// parser (M1-11) reads back exactly what was written.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeSpans,
  parseMText,
  spansOf,
  writeMText,
  type MTextBase,
  type MTextFormat,
  type MTextSpan,
} from '../../src/index';

const base: MTextBase = {
  font: { name: 'arial.ttf', kind: 'ttf', bold: false, italic: false },
  height: 2.5,
  widthFactor: 1,
  oblique: 0,
};
const shxBase: MTextBase = {
  ...base,
  font: { name: 'txt', kind: 'shx', bold: false, italic: false },
};

const text = (t: string, format: MTextFormat = {}): MTextSpan => ({
  type: 'text',
  text: t,
  format,
});
const write = (spans: readonly MTextSpan[], b: MTextBase = base) => writeMText(spans, b.font);
const back = (contents: string, b: MTextBase = base) => spansOf(parseMText(contents, b), b);

describe('writeMText', () => {
  it('writes plain text as it is, with paragraphs as \\P', () => {
    expect(write([text('Hello'), { type: 'break' }, text('world')])).toBe('Hello\\Pworld');
  });

  it('escapes backslashes, braces and carets, and writes tabs as ^I', () => {
    expect(write([text('a\\b{c}d^e\tf')])).toBe('a\\\\b\\{c\\}d^ e^If');
  });

  it('groups formatted runs in braces with their codes', () => {
    expect(write([text('plain '), text('under', { underline: true }), text(' end')])).toBe(
      'plain {\\Lunder} end',
    );
    expect(write([text('o', { overline: true }), text('k', { strike: true })])).toBe(
      '{\\Oo}{\\Kk}',
    );
  });

  it('writes bold and italic as a \\f font change of the style font, and a font override', () => {
    expect(write([text('B', { bold: true })])).toBe('{\\farial.ttf|b1|i0;B}');
    expect(write([text('BI', { bold: true, italic: true })])).toBe('{\\farial.ttf|b1|i1;BI}');
    expect(write([text('S', { font: { name: 'Segoe UI', kind: 'ttf' }, italic: true })])).toBe(
      '{\\fSegoe UI|b0|i1;S}',
    );
    expect(write([text('R', { font: { name: 'romans.shx', kind: 'shx' } })])).toBe(
      '{\\Fromans.shx;R}',
    );
  });

  it('ignores bold and italic on an SHX font, which has neither', () => {
    expect(write([text('B', { bold: true })], shxBase)).toBe('B');
  });

  it('writes heights as absolute \\H and colours as \\C (ACI) or \\c (true colour)', () => {
    expect(write([text('big', { height: 5 })])).toBe('{\\H5;big}');
    expect(write([text('r', { color: { kind: 'aci', index: 1 } })])).toBe('{\\C1;r}');
    expect(write([text('t', { color: { kind: 'rgb', r: 0x12, g: 0x34, b: 0x56 } })])).toBe(
      `{\\c${0x563412};t}`,
    );
  });

  it('writes stacks as \\S with the separator of their kind, escaping separators', () => {
    expect(
      write([text('x'), { type: 'stack', upper: '1', lower: '2', kind: 'fraction', format: {} }]),
    ).toBe('x\\S1/2;');
    expect(write([{ type: 'stack', upper: '3', lower: '4', kind: 'diagonal', format: {} }])).toBe(
      '\\S3#4;',
    );
    expect(
      write([{ type: 'stack', upper: '+0.1', lower: '-0.2', kind: 'tolerance', format: {} }]),
    ).toBe('\\S+0.1^ -0.2;');
    expect(write([{ type: 'stack', upper: 'a/b', lower: 'c', kind: 'fraction', format: {} }])).toBe(
      '\\Sa\\/b/c;',
    );
  });

  it('writes fields as %<code>%', () => {
    expect(write([text('Date: '), { type: 'field', code: '\\AcVar Date', format: {} }])).toBe(
      'Date: %<\\AcVar Date>%',
    );
  });

  it('merges neighbouring runs of one format into one group', () => {
    expect(write([text('a', { underline: true }), text('b', { underline: true })])).toBe('{\\Lab}');
  });
});

describe('spansOf', () => {
  it('reads formatting back relative to the entity', () => {
    expect(back('plain {\\Lunder} {\\H5;\\C1;big red}')).toEqual([
      text('plain '),
      text('under', { underline: true }),
      text(' '),
      text('big red', { height: 5, color: { kind: 'aci', index: 1 } }),
    ]);
    expect(back('a\\Pb')).toEqual([text('a'), { type: 'break' }, text('b')]);
    expect(back('{\\farial.ttf|b1|i0;B}')).toEqual([text('B', { bold: true })]);
  });
});

// Text a drafter can type: anything but the `%%` and `%<` sequences, which are codes in
// MTEXT whatever the editor does with them, and the carriage return, which MTEXT drops.
const typed = fc
  .string({
    unit: fc.constantFrom(
      'a',
      'Z',
      ' ',
      '1',
      '\\',
      '{',
      '}',
      '^',
      '\t',
      '/',
      '#',
      ';',
      '%',
      'é',
      '°',
      '<',
      '>',
    ),
  })
  .filter((s) => s.length > 0 && !s.includes('%%') && !s.includes('%<') && !s.endsWith('%'));
const stackPart = fc
  .string({ unit: fc.constantFrom('1', '2', 'x', '.', '+', '-', '/', '#', '^', '\\', ' ') })
  .filter((s) => s.length > 0 && !s.startsWith(' ') && !s.endsWith('\\'));
const format: fc.Arbitrary<MTextFormat> = fc.record(
  {
    bold: fc.boolean(),
    italic: fc.boolean(),
    underline: fc.constant(true),
    overline: fc.constant(true),
    strike: fc.constant(true),
    height: fc.constantFrom(1, 3.5, 5, 0.125),
    font: fc.constantFrom(
      { name: 'Segoe UI', kind: 'ttf' as const },
      { name: 'romans.shx', kind: 'shx' as const },
    ),
    color: fc.oneof(
      fc.integer({ min: 1, max: 255 }).map((index) => ({ kind: 'aci' as const, index })),
      fc
        .tuple(fc.nat(255), fc.nat(255), fc.nat(255))
        .map(([r, g, b]) => ({ kind: 'rgb' as const, r, g, b })),
    ),
  },
  { requiredKeys: [] },
);
const span: fc.Arbitrary<MTextSpan> = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(typed, format).map(([t, f]) => text(t, f)) },
  { weight: 1, arbitrary: fc.constant<MTextSpan>({ type: 'break' }) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(stackPart, stackPart, fc.constantFrom('fraction', 'diagonal', 'tolerance'), format)
      .map(
        ([upper, lower, kind, f]) =>
          ({ type: 'stack', upper, lower, kind, format: f }) as MTextSpan,
      ),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        fc.constantFrom('\\AcVar Date \\f "M/d/yyyy"', '\\AcVar Filename', '\\AcVar Author'),
        format,
      )
      .map(([code, f]) => ({ type: 'field', code, format: f }) as MTextSpan),
  },
);

describe('write then parse', () => {
  it('reads back every span the editor can make, on a TrueType and an SHX style', () => {
    fc.assert(
      fc.property(fc.array(span, { maxLength: 12 }), fc.boolean(), (spans, shx) => {
        const b = shx ? shxBase : base;
        expect(back(write(spans, b), b)).toEqual(normalizeSpans(spans, b.font));
      }),
      { numRuns: 1000 },
    );
  });
});
