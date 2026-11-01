// M1-41 part 1: font resolution and the font-backed MTextMeasure, on self-built fonts.
import { describe, expect, it } from 'vitest';
import {
  FontBook,
  fontMeasure,
  layoutMText,
  parseMText,
  parseShx,
  parseTtf,
  shxCode,
  styleFont,
  type MTextCharStyle,
} from '../../src/index';
import { buildBigfont, buildShapes, buildUnifont } from '../shx/builder';
import { fontBytes, testFont } from '../ttf/fonts';

// A 1×1 square from the pen, then pen up and 2 units east: advance 2 font units.
const cell = [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0];
const wide = [0x14, 0x10, 0x1c, 0x18, 2, 0x40, 0]; // advance 4

const romans = () =>
  parseShx(
    buildShapes(
      [
        { code: 32, name: 'space', bytes: [2, 0x10, 0] }, // advance 1
        { code: 63, name: 'question', bytes: wide },
        { code: 65, name: 'UCA', bytes: cell },
        { code: 127, name: 'degree', bytes: cell },
        { code: 129, name: 'diameter', bytes: wide },
      ],
      { name: 'Test roman', above: 10, below: 3 },
    ),
  );
const ttf = (styleName = 'Regular', weightClass = 400) =>
  parseTtf(fontBytes(testFont({ styleName, weightClass })));

const style = (font: MTextCharStyle['font'], height = 5, widthFactor = 1): MTextCharStyle => ({
  font,
  height,
  widthFactor,
  oblique: 0,
  tracking: 1,
  underline: false,
  overline: false,
  strike: false,
  valign: 'bottom',
});
const shx = (name: string) => ({ name, kind: 'shx' as const, bold: false, italic: false });

describe('styleFont', () => {
  it('reads a TrueType style from its file extension and its ACAD xdata bits', () => {
    expect(styleFont({ font: 'romans.shx', trueTypeFlags: 0 })).toEqual(shx('romans.shx'));
    expect(styleFont({ font: 'Arial.TTF', trueTypeFlags: 3 })).toEqual({
      name: 'Arial.TTF',
      kind: 'ttf',
      bold: true,
      italic: true,
    });
  });
});

describe('FontBook', () => {
  it('finds SHX fonts by file name without case, folder or extension', () => {
    const book = new FontBook();
    const f = romans();
    book.addShx('ROMANS.SHX', f);
    expect(book.face(shx('romans'))?.font).toBe(f);
    expect(book.face(shx('C:\\fonts\\Romans.shx'))?.font).toBe(f);
    expect(book.face(shx('txt'))).toBeUndefined();
    expect([...book.missing]).toEqual(['txt']);
  });

  it('finds TrueType fonts by file name or family, best style first', () => {
    const book = new FontBook();
    const regular = ttf();
    const bold = ttf('Bold', 700);
    book.addTtf(regular, 'testsans.ttf');
    book.addTtf(bold);
    const family = { name: 'Triya Test Sans', kind: 'ttf' as const, bold: true, italic: false };
    expect(book.face(family)?.font).toBe(bold);
    expect(book.face({ ...family, bold: false })?.font).toBe(regular);
    expect(book.face(styleFont({ font: 'TESTSANS.ttf', trueTypeFlags: 0 }))?.font).toBe(regular);
    // \Ftestsans.ttf names the file with the SHX code; the extension says TrueType.
    expect(book.face(shx('testsans.ttf'))?.font).toBe(regular);
  });

  it('draws a font that is not loaded with the alternate font (FONTALT)', () => {
    const book = new FontBook({ alternate: 'simplex.shx' });
    const f = romans();
    book.addShx('simplex', f);
    expect(book.face(shx('isocp'))).toEqual({ kind: 'shx', font: f });
    expect(book.missing.has('isocp')).toBe(true);
  });
});

describe('shxCode', () => {
  it('maps the %% symbols to the non-Unicode codes, and anything missing to "?"', () => {
    const f = romans();
    expect(shxCode(f, 65)).toBe(65);
    expect(shxCode(f, 0xb0)).toBe(127); // %%d
    expect(shxCode(f, 0x2205)).toBe(129); // %%c
    expect(shxCode(f, 0xb1)).toBe(63); // %%p: no shape 128 in this font
    expect(shxCode(f, 66)).toBe(63);
  });

  it('keeps Unicode fonts to their own codes', () => {
    const uni = parseShx(
      buildUnifont(
        [
          { code: 0x2205, name: 'dia', bytes: cell },
          { code: 129, name: 'x', bytes: cell },
        ],
        { name: 'Test unicode', above: 10, below: 3 },
      ),
    );
    expect(shxCode(uni, 0x2205)).toBe(0x2205);
    expect(shxCode(uni, 0xb0)).toBeUndefined();
  });
});

describe('fontMeasure', () => {
  it('measures SHX text exactly: pen advances × height / above × width factor', () => {
    const book = new FontBook();
    book.addShx('romans', romans());
    const m = fontMeasure(book);
    // A (2) + space (1) + B, missing, as ? (4) = 7 units; 5 / 10 per unit; width factor 0.8.
    expect(m.advance('A B', style(shx('romans'), 5, 0.8))).toBeCloseTo(7 * 0.5 * 0.8, 12);
    expect(m.advance('%', style(shx('romans')))).toBe(2); // missing → ? (4 units × 0.5)
  });

  it('measures TrueType text by its advances over the cap height', () => {
    const book = new FontBook();
    const f = ttf();
    book.addTtf(f, 'testsans.ttf');
    const m = fontMeasure(book);
    const s = style({ name: 'Triya Test Sans', kind: 'ttf', bold: false, italic: false }, 7);
    expect(m.advance('AH', s)).toBeCloseTo(((600 + 700) * 7) / f.capHeight, 9);
  });

  it('measures a font that is not loaded as height-wide cells', () => {
    const m = fontMeasure(new FontBook());
    expect(m.advance('abc', style(shx('nope'), 2, 0.5))).toBe(3);
  });

  it('measures big-font characters from the style big font, else a square cell', () => {
    const big = parseShx(
      buildBigfont([{ code: 0x8140, name: '', bytes: wide }], { name: 'B', above: 8, below: 0 }, [
        [0x81, 0x9f],
      ]),
    );
    const s = style(shx('romans'), 4);
    expect(fontMeasure(new FontBook(), big).mbcs!(932, 0x8140, s)).toBe(2); // 4 units × 4/8
    expect(fontMeasure(new FontBook()).mbcs!(932, 0x8140, s)).toBe(4);
  });

  it('lays out MTEXT with the real widths', () => {
    const book = new FontBook();
    book.addShx('romans', romans());
    const doc = parseMText('AA', { font: shx('romans'), height: 10, widthFactor: 1, oblique: 0 });
    const layout = layoutMText(doc, fontMeasure(book), {
      height: 10,
      width: 0,
      attachment: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    });
    expect(layout.lines[0]!.width).toBeCloseTo(4, 12); // 2 × 2 units × 10 / 10
  });
});
