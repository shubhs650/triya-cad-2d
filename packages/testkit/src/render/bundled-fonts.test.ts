// M1-09: the committed font files are exactly what `pnpm fonts:build` makes from the Hershey
// data, and every bundled font is complete and sits on the same baseline and cap line.
import { readFileSync } from 'node:fs';
import {
  buildGdtFont,
  buildStrokeFont,
  DEFAULT_BUNDLED_FONT,
  GDT_FONT,
  formatStrokeFont,
  HERSHEY_FONTS,
  loadStrokeFont,
  parseHershey,
  SHX_EQUIVALENTS,
  type TriyaStrokeFont,
} from '@triya/text';
import { describe, expect, it } from 'vitest';
import { bundledFontFiles, fontsDir } from './bundled-fonts.ts';

/** The bundled faces Hershey's Cyrillic Complex suits: the roman weights and the italic. */
const CYRILLIC_FACES = [
  'oet-simplex',
  'oet-duplex',
  'oet-complex',
  'oet-triplex',
  'oet-italic',
  'oet-gdt',
];

describe('bundled Hershey fonts (M1-09)', () => {
  const files = bundledFontFiles();

  it('match what `pnpm fonts:build` makes from assets/fonts/hershey/hershey.jhf', () => {
    const hershey = parseHershey(readFileSync(`${fontsDir}hershey/hershey.jhf`, 'latin1'));
    // The original occidental set: 1,597 glyphs.
    expect(hershey.size).toBe(1597);
    expect([...files.keys()].sort()).toEqual(
      [...HERSHEY_FONTS.map((d) => d.name), GDT_FONT].sort(),
    );
    const built = HERSHEY_FONTS.map((def) => buildStrokeFont(def, hershey));
    // M1-54: the GD&T font is oet-simplex with our symbols on the lower-case letters.
    built.push(buildGdtFont(built.find((f) => f.name === DEFAULT_BUNDLED_FONT)!));
    for (const font of built) {
      expect(files.get(font.name), `${font.name}.json is stale: run pnpm fonts:build`).toBe(
        formatStrokeFont(font),
      );
    }
  });

  it('cover printable ASCII, Latin-1 letters and the %%d %%p %%c symbols in every font', () => {
    const latin1 = [...'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöøùúûüýÿ'];
    for (const [name, text] of files) {
      const font = loadStrokeFont(JSON.parse(text) as TriyaStrokeFont);
      const lacking = [
        ...Array.from({ length: 95 }, (_, i) => String.fromCodePoint(32 + i)),
        ...latin1,
        '°',
        '±',
        '∅',
      ].filter((ch) => !font.hasShape(ch.codePointAt(0)!));
      expect(lacking, name).toEqual([]);
      // Capital H reaches the cap line, which text height maps to, and stands on the baseline
      // (Gothic German's swash dips below it).
      const h = font.glyph(0x48)!.paths.flatMap((p) => p.vertices.map((v) => v.y));
      expect(Math.max(...h), name).toBe(font.above);
      expect(Math.min(...h), name).toBe(name === 'oet-gothicg' ? -8 : 0);
    }
  });

  it('cover Latin Extended-A and the Latin-1 letters that are not a base letter plus accent (M1-59)', () => {
    const latinExtA = Array.from({ length: 0x80 }, (_, i) => String.fromCodePoint(0x100 + i));
    const latin1Extra = [...'ßÆæÞþð¡¿'];
    for (const [name, text] of files) {
      const font = loadStrokeFont(JSON.parse(text) as TriyaStrokeFont);
      const lacking = [...latinExtA, ...latin1Extra].filter(
        (ch) => !font.hasShape(ch.codePointAt(0)!),
      );
      expect(lacking, name).toEqual([]);
    }
  });

  it("draw Cyrillic with Hershey's complex Cyrillic in the roman and italic faces (M1-59)", () => {
    // U+0410–U+044F, plus Ё and ё from Е and е with a diaeresis.
    const cyrillic = [...Array.from({ length: 0x40 }, (_, i) => 0x410 + i), 0x401, 0x451];
    for (const [name, text] of files) {
      const font = loadStrokeFont(JSON.parse(text) as TriyaStrokeFont);
      const has = cyrillic.filter((c) => font.hasShape(c));
      expect(has.length, name).toBe(CYRILLIC_FACES.includes(name) ? cyrillic.length : 0);
    }
    // Hershey numbers its Cyrillic in alphabetical order without Ё: А = 2801, Я = 2832,
    // а = 2901, я = 2932 (checked against the glyph drawings).
    const complex = JSON.parse(files.get('oet-complex')!) as TriyaStrokeFont;
    const hershey = parseHershey(readFileSync(`${fontsDir}hershey/hershey.jhf`, 'latin1'));
    const strokesOf = (num: number) => {
      const g = hershey.get(num)!;
      return g.strokes.map((s) => s.flatMap(([x, y]) => [(x - g.left) * 2, (9 - y) * 2]));
    };
    expect(complex.glyphs[String(0x410)]![1]).toEqual(strokesOf(2801));
    expect(complex.glyphs[String(0x42f)]![1]).toEqual(strokesOf(2832));
    expect(complex.glyphs[String(0x430)]![1]).toEqual(strokesOf(2901));
    expect(complex.glyphs[String(0x44f)]![1]).toEqual(strokesOf(2932));
  });

  it('name only bundled fonts in the SHX name map', () => {
    const names = new Set([...HERSHEY_FONTS.map((d) => d.name), GDT_FONT]);
    expect(names.has(DEFAULT_BUNDLED_FONT)).toBe(true);
    for (const [shx, oet] of Object.entries(SHX_EQUIVALENTS))
      expect(names.has(oet), shx).toBe(true);
    // `{\Fgdt;j}` in TOLERANCE and dimension text draws with our GD&T symbols (M1-54).
    expect(SHX_EQUIVALENTS.gdt).toBe(GDT_FONT);
  });
});
