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
    // The lowest ink is the turned "!" of ¡ (an A here), hanging from the x-height (M1-59).
    expect(font.below).toBe(14);
  });

  it('builds Latin Extended-A letters from a base letter and an accent (M1-59)', () => {
    const [, c] = font.glyphs['67']!;
    const top = Math.max(...c.flatMap((s) => s.filter((_, k) => k % 2)));
    const xs = c.flatMap((s) => s.filter((_, k) => k % 2 === 0));
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    // Č: the caron, a v centred over the C's ink, 3 units above its top.
    const caron = font.glyphs[String(0x10c)]![1];
    expect(caron.slice(0, -1)).toEqual(c);
    expect(caron.at(-1)).toEqual([cx - 5, top + 8, cx, top + 3, cx + 5, top + 8]);
    // ı: i without its dot; ĭ loses it too, į keeps it under its ogonek.
    const i = font.glyphs['105']![1];
    expect(font.glyphs[String(0x131)]![1]).toEqual([i[1]]);
    expect(font.glyphs[String(0x12d)]![1]).toHaveLength(2);
    expect(font.glyphs[String(0x12f)]![1].slice(0, 2)).toEqual(i);
    // Ő: two acute marks over the O (centred at 22, top 42).
    expect(font.glyphs[String(0x150)]![1].slice(-2)).toEqual([
      [17, 45, 20, 51],
      [23, 45, 26, 51],
    ]);
  });

  it('builds ligatures and turned marks from whole letters (M1-59)', () => {
    // ĳ: i, then j (an A here) one i advance on.
    const [iAdvance, i] = font.glyphs['105']!;
    const [aAdvance] = font.glyphs['65']!;
    const ij = font.glyphs[String(0x133)]!;
    expect(ij[0]).toBe(iAdvance + aAdvance);
    expect(ij[1].slice(0, i.length)).toEqual(i);
    expect(ij[1][i.length]).toEqual([18 + iAdvance, 42, 2 + iAdvance, 0]);
    // Œ: the O cut at its middle, closed by the E's stem (an A's first leg here) put there.
    const xs = (s: readonly number[]) => s.filter((_, k) => k % 2 === 0);
    const oXs = font.glyphs['79']![1].flatMap(xs);
    const middle = Math.round((Math.min(...oXs) + Math.max(...oXs)) / 2);
    const oe = font.glyphs[String(0x152)]![1];
    const oPart = oe.slice(0, -3);
    expect(oPart.length).toBeGreaterThan(0);
    expect(Math.max(...oPart.flatMap(xs))).toBe(middle);
    // The A's first leg runs from x = 18 at the top to 2 at the baseline; at mid-height (21)
    // it is at 10, which lands on the O's middle.
    expect(oe.at(-3)).toEqual([middle + 8, 42, middle - 8, 0]);
    // ¡: the "!" (an A) turned half a turn, reaching up to the x-height of x.
    const turned = font.glyphs[String(0xa1)]![1];
    expect(turned[0]).toEqual([18, -14, 34, 28]);
  });

  it('leans upright glyphs to an italic face', () => {
    const slanted = buildStrokeFont(
      { ...def(), slanted: { glyphs: { 0x416: 501 }, slope: 0.5 } },
      parseHershey(SAMPLE),
    );
    expect(slanted.glyphs[String(0x416)]).toEqual([
      36,
      [
        [39, 42, 2, 0],
        [39, 42, 34, 0],
        [15, 14, 35, 14],
      ],
    ]);
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
