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

  it('name only bundled fonts in the SHX name map', () => {
    const names = new Set([...HERSHEY_FONTS.map((d) => d.name), GDT_FONT]);
    expect(names.has(DEFAULT_BUNDLED_FONT)).toBe(true);
    for (const [shx, oet] of Object.entries(SHX_EQUIVALENTS))
      expect(names.has(oet), shx).toBe(true);
    // `{\Fgdt;j}` in TOLERANCE and dimension text draws with our GD&T symbols (M1-54).
    expect(SHX_EQUIVALENTS.gdt).toBe(GDT_FONT);
  });
});
