// M2-16 part 3: TrueType text in a PDF plot as an embedded subset font. The font is the test
// font written in fonts/truetype.ts (no third-party font is read); pdf.js, an independent
// reader, must find the text, its font embedded (not substituted), and its characters.
import { inflateSync } from 'node:zlib';
import {
  PdfDocument,
  TrueTypeFont,
  paperTransform,
  plotItems,
  type PlotGlyph,
  type PlotItem,
  type PlotPaint,
} from '@triya/pdf';
import { tessellate, type RenderPrimitive } from '@triya/render';
import { FontBook, parseTtf, type TtfFont } from '@triya/text';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { testTrueType } from '../fonts/truetype';

const PAINT: PlotPaint = {
  color: [0, 0, 0],
  lineweight: 0.25,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};

const TO_PAPER = paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 });

/** Big-endian 32-bit word sum, as OpenType checksums add. */
function sum32(b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < b.length; i += 4)
    s =
      (s +
        (((b[i]! << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>>
          0)) >>>
      0;
  return s;
}

/** A string laid out along the baseline from (x, y) mm, `height` mm capitals, `tracking` × advance. */
function line(font: TtfFont, text: string, x: number, y: number, height: number, tracking = 1) {
  const s = font.scaleFor(height);
  const glyphs: PlotGlyph[] = [];
  const path: number[] = [];
  let pen = x;
  for (const ch of text) {
    const g = font.glyph(ch.codePointAt(0)!);
    glyphs.push({
      font,
      index: g.index,
      codePoint: g.codePoint,
      m: { a: s, b: 0, c: 0, d: s, e: pen, f: y },
    });
    for (const c of g.commands) {
      if (c.op === 'M') path.push(0, pen + c.x * s, y + c.y * s);
      else if (c.op === 'L') path.push(1, pen + c.x * s, y + c.y * s);
      else if (c.op === 'Q') path.push(5, pen + c.x1 * s, y + c.y1 * s, pen + c.x * s, y + c.y * s);
      else if (c.op === 'Z') path.push(4);
    }
    pen += g.advance * s * tracking;
  }
  return { glyphs, path };
}

function plot(
  items: readonly PlotItem[],
  options: { textAsGeometry?: boolean; pages?: number } = {},
) {
  const doc = new PdfDocument({ compress: false });
  for (let i = 0; i < (options.pages ?? 1); i++) {
    const page = doc.addPage(842, 595);
    plotItems(page, items, {
      toPaper: TO_PAPER,
      ...(options.textAsGeometry ? { textAsGeometry: true } : {}),
    });
  }
  return { bytes: doc.bytes(), latin: Buffer.from(doc.bytes()).toString('latin1') };
}

function textItem(font: TtfFont, text: string, tracking = 1): PlotItem {
  const { glyphs, path } = line(font, text, 20, 100, 10, tracking);
  return { kind: 'fill', path, paint: PAINT, glyphs };
}

/** The embedded font file (FontFile2), inflated. */
function fontFile(latin: string, bytes: Uint8Array): Uint8Array {
  const m = /\/Length1 (\d+) \/Length (\d+)( \/Filter \/FlateDecode)? >>\nstream\n/.exec(latin)!;
  const start = m.index + m[0].length;
  const data = bytes.subarray(start, start + Number(m[2]));
  return m[3] ? new Uint8Array(inflateSync(data)) : data;
}

describe('TrueType font files (M2-16 part 3)', () => {
  const bytes = testTrueType();
  const font = TrueTypeFont.parse(bytes)!;
  const ttf = parseTtf(bytes);

  it('reads a TrueType font’s metrics, names and embedding permission', () => {
    expect(font.unitsPerEm).toBe(1000);
    expect(font.postScriptName).toBe('TriyaPixel');
    expect(font.capHeight).toBe(700);
    expect(font.ascender).toBe(1000);
    expect(font.descender).toBe(-250);
    expect(font.embeddable).toBe(true);
    expect(font.noSubsetting).toBe(false);
    expect(font.advance(ttf.glyph(65).index)).toBe(600);
    expect(TrueTypeFont.parse(testTrueType({ fsType: 2 }))!.embeddable).toBe(false);
    expect(TrueTypeFont.parse(testTrueType({ fsType: 0x0200 }))!.embeddable).toBe(false);
    expect(TrueTypeFont.parse(testTrueType({ fsType: 0x0108 }))!.noSubsetting).toBe(true);
  });

  it('reads no CFF-flavoured or broken file', () => {
    const otto = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(TrueTypeFont.parse(otto)).toBeUndefined();
    expect(TrueTypeFont.parse(new Uint8Array(3))).toBeUndefined();
    expect(TrueTypeFont.parse(bytes.slice(0, 200))).toBeUndefined();
  });

  it('writes a subset with only the glyphs asked for and the components they are built from', () => {
    const ring = ttf.glyph(0xc5).index;
    const a = ttf.glyph(65).index;
    const o = ttf.glyph(0x4f).index;
    expect(font.components(ring).length).toBe(2);
    const { bytes: sub, order } = font.subset([0, ring, o]);
    // Å brings A and the unencoded ring glyph.
    expect(order.slice(0, 3)).toEqual([0, ring, o]);
    expect(order.slice(3)).toEqual(font.components(ring));
    expect(order).toContain(a);
    const back = TrueTypeFont.parse(sub)!;
    expect(back.numGlyphs).toBe(order.length);
    // Simple glyphs are copied byte for byte; the composite names its parts in the subset.
    expect(back.glyph(2)).toEqual(font.glyph(o));
    expect(back.components(1)).toEqual([3, 4]);
    order.forEach((g, i) => expect(back.advance(i)).toBe(font.advance(g)));
    // Every table's checksum, and the whole file's adjustment.
    expect(sum32(sub)).toBe(0xb1b0afba);
    // opentype.js reads it, and the glyphs draw as they did.
    const reread = parseTtf(sub);
    expect(reread.unitsPerEm).toBe(1000);
    expect(sub.length).toBeLessThan(bytes.length / 2);
  });
});

describe('TrueType text in a PDF plot (M2-16 part 3)', () => {
  const ttf = parseTtf(testTrueType());

  it('writes the text in a Type 0 font over an embedded CIDFontType2 subset', async () => {
    const { bytes, latin } = plot([textItem(ttf, 'HELLO ÅÄ 1:100')]);
    expect(latin).toMatch(
      /\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+TriyaPixel \/Encoding \/Identity-H/,
    );
    expect(latin).toMatch(/\/Subtype \/CIDFontType2 .*\/CIDToGIDMap \/Identity/);
    expect(latin).toMatch(/\/FontFile2 \d+ 0 R/);
    expect(latin).toMatch(/\/ToUnicode \d+ 0 R/);
    expect(latin).toMatch(/^BT\n\/F1 1 Tf\n.* Tm\n\[<[0-9A-F]+>\] TJ\nET$/m);
    // No glyph outline is filled.
    expect(latin).not.toMatch(/^f$/m);
    // Eleven distinct characters (H E L O space Å Ä 1 : 0) and .notdef, plus A and the ring
    // and dieresis Å and Ä are built from.
    const sub = TrueTypeFont.parse(fontFile(latin, bytes))!;
    expect(sub.numGlyphs).toBe(1 + 10 + 3);

    const task = getDocument({ data: bytes.slice(), fontExtraProperties: true });
    const doc = await task.promise;
    try {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map((i) => ('str' in i ? i.str : '')).join('');
      expect(text).toBe('HELLO ÅÄ 1:100');
      const ops = await page.getOperatorList();
      expect(ops.fnArray).toContain(OPS.showText);
      const fontId = ops.argsArray[ops.fnArray.indexOf(OPS.setFont)]![0] as string;
      const loaded = page.commonObjs.get(fontId) as { missingFile: boolean; name: string };
      expect(loaded.missingFile).toBe(false);
      expect(loaded.name).toMatch(/^[A-Z]{6}\+TriyaPixel$/);
    } finally {
      await task.destroy();
    }
  });

  it('keeps a string in one run and moves tracked glyphs with TJ adjustments', () => {
    const plain = plot([textItem(ttf, 'HELLO')]).latin;
    expect(plain.match(/ Tm$/gm)).toHaveLength(1);
    expect(plain).toMatch(/^\[<00010002000300030004>\] TJ$/m);
    // Tracking 1.5 opens each gap by half an advance: 300 thousandths of an em.
    const tracked = plot([textItem(ttf, 'HELLO', 1.5)]).latin;
    expect(tracked.match(/ Tm$/gm)).toHaveLength(1);
    expect(tracked).toMatch(/^\[<0001> -300 <0002> -300 <0003> -300 <0003> -300 <0004>\] TJ$/m);
  });

  it('places the run by the glyph matrix: one em of the font to paper points', () => {
    const { latin } = plot([textItem(ttf, 'H')]);
    // 10 mm capitals over a 700-unit cap height: an em of 1000/700 × 10 mm.
    const em = ((10 / 700) * 1000 * 72) / 25.4;
    const at = (v: number) => ((v * 72) / 25.4).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    const k = em.toFixed(4).replace(/0+$/, '');
    expect(latin).toContain(`${k} 0 0 ${k} ${at(20)} ${at(100)} Tm`);
  });

  it('starts a new run when glyphs leave the baseline or turn', () => {
    const a = line(ttf, 'AB', 20, 100, 10);
    const b = line(ttf, 'CD', 20, 80, 10);
    const turned = line(ttf, 'EF', 20, 60, 10).glyphs.map((g) => ({
      ...g,
      m: { a: 0, b: g.m.a, c: -g.m.d, d: 0, e: g.m.e, f: g.m.f },
    }));
    const item: PlotItem = {
      kind: 'fill',
      path: [...a.path, ...b.path],
      paint: PAINT,
      glyphs: [...a.glyphs, ...b.glyphs, ...turned],
    };
    const { latin } = plot([item]);
    expect(latin.match(/ Tm$/gm)).toHaveLength(4);
    expect(latin.match(/^BT$/gm)).toHaveLength(1);
  });

  it('embeds each font once for the whole document, however many pages show it', () => {
    const { latin } = plot([textItem(ttf, 'AB')], { pages: 2 });
    expect(latin.match(/\/FontFile2/g)).toHaveLength(1);
    expect(latin.match(/\/Font << \/F1 (\d+) 0 R >>/g)).toHaveLength(2);
  });

  it('fills the outlines when text is converted to geometry or the font may not be embedded', () => {
    const geometry = plot([textItem(ttf, 'AB')], { textAsGeometry: true }).latin;
    expect(geometry).not.toMatch(/^BT$/m);
    expect(geometry).toMatch(/^f$/m);
    expect(geometry).not.toContain('/FontFile2');
    const restricted = parseTtf(testTrueType({ fsType: 2 }));
    const locked = plot([textItem(restricted, 'AB')]).latin;
    expect(locked).not.toMatch(/^BT$/m);
    expect(locked).toMatch(/^f$/m);
    // A font read from no file (built in memory) is outlined too.
    const { glyphs, path } = line(ttf, 'AB', 0, 0, 5);
    const memory = glyphs.map((g) => ({ ...g, font: {} }));
    expect(plot([{ kind: 'fill', path, paint: PAINT, glyphs: memory }]).latin).toMatch(/^f$/m);
  });

  it('embeds a font that forbids subsetting whole, glyphs keeping their numbers', () => {
    const whole = parseTtf(testTrueType({ fsType: 0x0100 }));
    const { bytes, latin } = plot([textItem(whole, 'H')]);
    const h = whole.glyph(72).index;
    expect(latin).toMatch(
      new RegExp(`^\\[<${h.toString(16).toUpperCase().padStart(4, '0')}>\\] TJ$`, 'm'),
    );
    expect(TrueTypeFont.parse(fontFile(latin, bytes))!.numGlyphs).toBe(
      TrueTypeFont.parse(testTrueType())!.numGlyphs,
    );
  });

  it('maps every glyph shown back to its character in the ToUnicode CMap', () => {
    const { latin } = plot([textItem(ttf, 'A°')]);
    expect(latin).toContain('2 beginbfchar\n<0001> <0041>\n<0002> <00B0>\nendbfchar');
  });
});

describe('TrueType glyphs from the renderer (M2-16 part 3)', () => {
  const ttf = parseTtf(testTrueType());
  const book = new FontBook();
  book.addTtf(ttf, 'triya-pixel.ttf');
  const style = {
    handle: 'S1',
    name: 'PIXEL',
    font: 'triya-pixel.ttf',
    bigFont: '',
    height: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    flags: 0,
    lastHeight: 2.5,
  };
  const ctx = { text: { fonts: book, style: () => style as never } };
  const text = (value: string) =>
    ({
      kind: 'TEXT',
      value,
      position: { x: 10, y: 20 },
      height: 7,
      rotation: 0,
      widthFactor: 1,
      oblique: 0,
      style: 'S1',
      halign: 0,
      valign: 0,
      backward: false,
      upsideDown: false,
    }) as never;
  const paint = { color: 'foreground', lineweight: undefined } as never;

  it('hands each glyph, spaces too, with the matrix placing it', () => {
    const prims = tessellate(text('AB C'), paint, ctx) as RenderPrimitive[];
    const fill = prims.find((p) => p.kind === 'fill' && p.text?.glyphs)!;
    const glyphs = fill.kind === 'fill' ? fill.text!.glyphs! : [];
    expect(glyphs.map((g) => String.fromCodePoint(g.codePoint)).join('')).toBe('AB C');
    expect(glyphs[0]!.font).toBe(ttf);
    expect(glyphs[0]!.index).toBe(ttf.glyph(65).index);
    // 7 units capitals over 700 font units: 0.01 per unit; each advance 600 units.
    expect(glyphs[0]!.m).toEqual({ a: 0.01, b: 0, c: 0, d: 0.01, e: 10, f: 20 });
    expect(glyphs[3]!.m.e).toBeCloseTo(10 + 3 * 6, 9);
  });
});
