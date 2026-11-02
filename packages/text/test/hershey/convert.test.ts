// M1-09: Hershey data → Triya stroke fonts → SHX fonts, on glyph lines copied from the
// occidental Hershey file (assets/fonts/hershey/hershey.jhf).
import { describe, expect, it } from 'vitest';
import {
  buildStrokeFont,
  formatStrokeFont,
  loadStrokeFont,
  parseHershey,
  strokeShape,
  type HersheyFontDef,
  type TriyaStrokeFont,
} from '../../src/index';

// Space, A, C, O (Roman Simplex), and the small i, o, x; 3501 wraps onto a second line.
const SAMPLE = [
  '  699  1JZ',
  '  501  9I[RFJ[ RRFZ[ RMTWT',
  '  503 19H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZV',
  '  515 22G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF',
  '  609  9NVQFRGSFREQF RRMR[',
  '  615 18I\\QMONMPLSLUMXOZQ[T[VZXXYUYSXPVNTMQM',
  '  624  6J[MMX[ RXMM[',
  ' 3501 60G]LINGPFRFSGZW[X]X RQGRHYXZZ[YYX RNGPGQHXXYZZ[[[]X RLMMLOKPKQL R',
  'PLPM RMLOLPN RG[IYKXNXPY RJYNYOZ RG[JZMZN[PY RRJLX RNSVS',
  '',
].join('\n');

const at = (ch: string) => ch.codePointAt(0)! - 32;

/** Every ASCII code draws A, except space, C, O, i, o and x. */
function def(extra: Record<number, number> = {}): HersheyFontDef {
  const ascii = Array<number>(95).fill(501);
  ascii[at(' ')] = 699;
  ascii[at('C')] = 503;
  ascii[at('O')] = 515;
  ascii[at('i')] = 609;
  ascii[at('o')] = 615;
  ascii[at('x')] = 624;
  return { name: 'oet-test', description: 'test', ascii, extra };
}

describe('parseHershey', () => {
  it('reads edges, pen-up breaks and wrapped glyphs', () => {
    const g = parseHershey(SAMPLE);
    expect(g.get(501)).toEqual({
      left: -9,
      right: 9,
      strokes: [
        [
          [0, -12],
          [-8, 9],
        ],
        [
          [0, -12],
          [8, 9],
        ],
        [
          [-5, 2],
          [5, 2],
        ],
      ],
    });
    expect(g.get(699)).toEqual({ left: -8, right: 8, strokes: [] });
    // 60 pairs over two lines: the edge pair, 49 points and 10 pen lifts.
    const gothic = g.get(3501)!;
    expect(gothic.strokes.flat().length).toBe(49);
    expect(gothic.strokes.at(-1)).toEqual([
      [-4, 1],
      [4, 1],
    ]);
  });

  it('rejects a bad header or a truncated glyph', () => {
    expect(() => parseHershey('  5x1  9I[RF')).toThrow(/bad glyph header/);
    expect(() => parseHershey('  501  9I[RFJ[')).toThrow(/truncated/);
  });
});

describe('buildStrokeFont', () => {
  const font = buildStrokeFont(def({ 0x3b1: 615 }), parseHershey(SAMPLE));

  it('puts the baseline at y = 0 and the cap top at `above`, in half Hershey units', () => {
    expect(font.above).toBe(42);
    expect(font.glyphs['65']).toEqual([
      36,
      [
        [18, 42, 2, 0],
        [18, 42, 34, 0],
        [8, 14, 28, 14],
      ],
    ]);
    expect(font.glyphs['32']).toEqual([32, []]);
    expect(font.glyphs[String(0x3b1)]).toEqual(font.glyphs['111']);
  });

  it('builds Latin-1 letters from a base letter and an accent we drew', () => {
    const [advance, strokes] = font.glyphs[String(0xc1)]!; // Á
    expect(advance).toBe(36);
    expect(strokes.slice(0, 3)).toEqual(font.glyphs['65']![1]);
    // The acute mark, centred over the A's ink, 3 units above its top.
    expect(strokes[3]).toEqual([16, 45, 21, 51]);
    // í: the i's dot gives way to the accent.
    const i = font.glyphs['105']![1];
    const iAcute = font.glyphs[String(0xed)]![1];
    expect(i).toHaveLength(2);
    expect(iAcute).toHaveLength(2);
    expect(iAcute[0]).toEqual(i[1]);
    // Ø: the O with a stroke past its ink box corner to corner.
    const oStroke = font.glyphs[String(0xd8)]![1].at(-1)!;
    expect(oStroke[0]! < 6 && oStroke[2]! > 30).toBe(true);
    // Ç: the cedilla hangs below the baseline.
    expect(Math.min(...font.glyphs[String(0xc7)]![1].at(-1)!.filter((_, k) => k % 2))).toBe(-9);
    expect(font.below).toBe(9);
  });

  it('draws the diameter sign for %%c at both code points', () => {
    expect(font.glyphs[String(0x2205)]).toEqual(font.glyphs[String(0x2300)]);
    const [advance, [circle, slash]] = font.glyphs[String(0x2205)]!;
    expect(advance).toBe(36);
    expect(circle).toHaveLength(34);
    expect(slash).toEqual([4, 7, 32, 35]);
  });

  it('fails loudly on a glyph number the data lacks', () => {
    expect(() => buildStrokeFont(def({ 0xb0: 718 }), parseHershey(SAMPLE))).toThrow(
      /glyph 718 \(for U\+00B0\) is missing/,
    );
    expect(() => buildStrokeFont({ ...def(), ascii: [501] }, parseHershey(SAMPLE))).toThrow(
      /95 ASCII/,
    );
  });

  it('formats one glyph per line and parses back to the same font', () => {
    const text = formatStrokeFont(font);
    expect(text.split('\n')[1]).toBe('  "format": "triya-stroke-font",');
    expect(text).toContain('\n    "65": [36,[[18,42,2,0],[18,42,34,0],[8,14,28,14]]],\n');
    expect(JSON.parse(text)).toEqual(font);
  });
});

describe('loadStrokeFont', () => {
  const font = buildStrokeFont(def(), parseHershey(SAMPLE));
  const shx = loadStrokeFont(font);

  it('gives an SHX font with the same strokes and advances', () => {
    expect(shx.kind).toBe('unifont');
    expect(shx.name).toBe('oet-test');
    expect(shx.above).toBe(42);
    expect(shx.scaleFor(2.5)).toBe(2.5 / 42);
    const a = shx.glyph(65)!;
    expect(a.advance).toEqual({ x: 36, y: 0 });
    expect(a.paths.map((p) => p.vertices.flatMap((v) => [v.x, v.y]))).toEqual(
      font.glyphs['65']![1],
    );
    expect(shx.hasShape(0xc1)).toBe(true);
    expect(shx.glyph(32)!.paths).toEqual([]);
  });

  it('splits moves longer than a signed byte', () => {
    const bytes = strokeShape(300, [[0, 0, 200, -130]]);
    const shx2 = loadStrokeFont({ ...font, glyphs: { '65': [300, [[0, 0, 200, -130]]] } });
    expect(bytes.length).toBeGreaterThan(8);
    expect(shx2.glyph(65)!.advance).toEqual({ x: 300, y: 0 });
    const path = shx2.glyph(65)!.paths[0]!.vertices;
    expect(path.at(-1)).toMatchObject({ x: 200, y: -130 });
  });

  it('rejects anything but a version 1 stroke font', () => {
    const bad = { ...font, version: 2 } as unknown as TriyaStrokeFont;
    expect(() => loadStrokeFont(bad)).toThrow(/not a Triya stroke font/);
    expect(() => loadStrokeFont({ ...font, above: 300 })).toThrow(/font info bytes/);
  });
});
