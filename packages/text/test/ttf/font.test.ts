// TrueType/OpenType pipeline (M1-10): glyph outlines, exact advance widths and style flags,
// read through opentype.js. Acceptance: widths match opentype.js's own measurement.
import { describe, expect, it } from 'vitest';
import { parseTtf, TtfFont } from '../../src/index';
import { opentype } from '../../src/ttf/lib';
import { fontBytes, testFont } from './fonts';

const regular = parseTtf(fontBytes(testFont()));

describe('font info', () => {
  it('reads names, metrics and the cap height', () => {
    expect(regular.family).toBe('Triya Test Sans');
    expect(regular.subfamily).toBe('Regular');
    expect(regular.unitsPerEm).toBe(1000);
    expect(regular.ascender).toBe(800);
    expect(regular.descender).toBe(-200);
    expect(regular.capHeight).toBe(700);
  });

  it('reads bold and italic from the OS/2, head and post tables', () => {
    expect(regular.style).toEqual({ bold: false, italic: false, weight: 400, italicAngle: 0 });
    const bold = parseTtf(fontBytes(testFont({ styleName: 'Bold', weightClass: 700 })));
    expect(bold.style.bold).toBe(true);
    expect(bold.style.weight).toBe(700);
    const italic = parseTtf(fontBytes(testFont({ styleName: 'Italic', italicAngle: -12 })));
    expect(italic.style.italic).toBe(true);
    expect(italic.style.italicAngle).toBe(-12);
  });

  it('rejects bytes that are not a font', () => {
    expect(() => parseTtf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a TrueType/);
  });
});

describe('glyphs', () => {
  it('gives outlines in font units, y up, with lines, quadratics and cubics', () => {
    expect(regular.glyph(0x41).commands).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 300, y: 700 },
      { op: 'L', x: 600, y: 0 },
      { op: 'Z' },
    ]);
    // CFF outlines store quadratics as cubics; either way the curve ops carry control points.
    const b = regular.glyph(0x42).commands.map((c) => c.op);
    expect(b[0]).toBe('M');
    expect(b).toContain('C');
    const o = regular.glyph(0x6f);
    expect(o.commands.filter((c) => c.op === 'C')).toHaveLength(2);
    expect(o.advance).toBe(560);
    expect(o.name).toBe('o');
    expect(o.missing).toBe(false);
  });

  it('keeps quadratic curves as Q when the font has them', () => {
    const font = new TtfFont(testFont());
    const q = font.glyph(0x42).commands.find((c) => c.op === 'Q');
    expect(q).toEqual({ op: 'Q', x1: 560, y1: 700, x: 80, y: 350 });
  });

  it('falls back to .notdef for a missing character, and caches glyphs', () => {
    const z = regular.glyph(0x5a);
    expect(z.missing).toBe(true);
    expect(z.index).toBe(0);
    expect(z.advance).toBe(520);
    expect(regular.hasGlyph(0x5a)).toBe(false);
    expect(regular.hasGlyph(0x3a9)).toBe(true);
    expect(regular.glyph(0x41)).toBe(regular.glyph(0x41));
  });
});

describe('advance widths', () => {
  it('sums glyph advances exactly, by code point', () => {
    expect(regular.advance('')).toBe(0);
    expect(regular.advance('AB Ho')).toBe(600 + 640 + 250 + 700 + 560);
    // Astral characters count once, not per UTF-16 half; missing ones take .notdef's width.
    expect(regular.advance('A\u{1F600}Ω')).toBe(600 + 520 + 760);
  });

  it('matches opentype.js measurement (M1-10 acceptance)', () => {
    const reference = opentype.parse(fontBytes(testFont()).buffer as ArrayBuffer);
    for (const text of ['A', 'AB Ho', 'HoHoH', 'ΩA B', 'BAH  oo']) {
      expect(regular.advance(text)).toBe(reference.getAdvanceWidth(text, 1000, { kerning: false }));
    }
  });

  it('applies kerning pairs only when asked', () => {
    const raw = testFont();
    const a = raw.charToGlyphIndex('A');
    const b = raw.charToGlyphIndex('B');
    raw.kerningPairs = { [`${a},${b}`]: -80 };
    const font = new TtfFont(raw);
    expect(font.advance('AB')).toBe(1240);
    expect(font.advance('AB', { kerning: true })).toBe(1160);
    expect(raw.getKerningValue(a, b)).toBe(-80);
  });

  it('scales font units to a text height by the cap height', () => {
    expect(regular.scaleFor(7)).toBeCloseTo(0.01, 12);
    expect(regular.width('AB', 7)).toBeCloseTo(12.4, 12);
  });
});
