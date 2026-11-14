// M2-16 part 4: CFF-flavoured OpenType text in a PDF plot, embedded as a CFF subset under a
// CIDFontType0. The fonts are the test font's CFF twins written in fonts/cff.ts (no third-party
// font is read): opentype.js reads them and the subsets, and pdf.js, an independent reader,
// must find the text, its font embedded (not substituted), and its characters.
import { inflateSync } from 'node:zlib';
import {
  CffFont,
  PdfDocument,
  TrueTypeFont,
  paperTransform,
  plotItems,
  writeSfnt,
  SFNT_CFF,
  readSfnt,
  type PlotGlyph,
  type PlotItem,
  type PlotPaint,
} from '@triya/pdf';
import { parseTtf, type TtfFont } from '@triya/text';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { testCid } from '../fonts/cff';
import { testTrueType } from '../fonts/truetype';

const PAINT: PlotPaint = {
  color: [0, 0, 0],
  lineweight: 0.25,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};

const TO_PAPER = paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 });

function textItem(font: TtfFont, text: string, x = 20, y = 100, height = 10): PlotItem {
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
      else if (c.op === 'C')
        path.push(
          6,
          pen + c.x1 * s,
          y + c.y1 * s,
          pen + c.x2 * s,
          y + c.y2 * s,
          pen + c.x * s,
          y + c.y * s,
        );
      else if (c.op === 'Q') path.push(5, pen + c.x1 * s, y + c.y1 * s, pen + c.x * s, y + c.y * s);
      else if (c.op === 'Z') path.push(4);
    }
    pen += g.advance * s;
  }
  return { kind: 'fill', path, paint: PAINT, glyphs };
}

function plot(items: readonly PlotItem[], pages = 1) {
  const doc = new PdfDocument({ compress: false });
  for (let i = 0; i < pages; i++) plotItems(doc.addPage(842, 595), items, { toPaper: TO_PAPER });
  const bytes = doc.bytes();
  return { bytes, latin: Buffer.from(bytes).toString('latin1') };
}

/** The embedded CFF program (FontFile3), inflated when compressed. */
function fontFile3(latin: string, bytes: Uint8Array): Uint8Array {
  const m = /\/Subtype \/CIDFontType0C \/Length (\d+)( \/Filter \/FlateDecode)? >>\nstream\n/.exec(
    latin,
  )!;
  const start = m.index + m[0].length;
  const data = bytes.subarray(start, start + Number(m[1]));
  return m[2] ? new Uint8Array(inflateSync(data)) : data;
}

/** A bare CFF program back in the OpenType file it came from, so opentype.js can read it. */
function withProgram(otf: Uint8Array, cff: Uint8Array): Uint8Array {
  const tables = new Map(readSfnt(otf)!.tables);
  tables.set('CFF ', cff);
  return writeSfnt(tables, SFNT_CFF);
}

/** A glyph's outline as opentype.js draws it, for comparing fonts. */
const outline = (font: TtfFont, cp: number) => JSON.stringify(font.glyph(cp).commands);

async function readBack(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), fontExtraProperties: true });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join('');
    const ops = await page.getOperatorList();
    const fontId = ops.argsArray[ops.fnArray.indexOf(OPS.setFont)]![0] as string;
    const font = page.commonObjs.get(fontId) as {
      missingFile: boolean;
      name: string;
      mimetype: string;
    };
    return { text, font, shows: ops.fnArray.includes(OPS.showText) };
  } finally {
    await task.destroy();
  }
}

describe('CFF-flavoured OpenType font files (M2-16 part 4)', () => {
  const plain = testTrueType({ outlines: 'cff' });
  const cid = testTrueType({ outlines: 'cid' });
  const ttfPlain = parseTtf(plain);
  const ttfCid = parseTtf(cid);

  it('writes test fonts opentype.js draws as the TrueType one, arcs raised to cubics', () => {
    // The same corners (contours may start at another one), and the same extremes of the O.
    const corners = (font: TtfFont, cp: number) =>
      font
        .glyph(cp)
        .commands.flatMap((c) => ('x' in c ? [`${c.x},${c.y}`] : []))
        .sort()
        .filter((v, i, a) => a.indexOf(v) === i);
    const glyf = parseTtf(testTrueType());
    for (const cp of [0x48, 0xc5, 0x31, 0x4f]) {
      expect(corners(ttfPlain, cp)).toEqual(corners(glyf, cp));
      expect(ttfPlain.glyph(cp).advance).toBe(glyf.glyph(cp).advance);
    }
    expect(ttfPlain.glyph(0x4f).commands.some((c) => c.op === 'C')).toBe(true);
    expect(outline(ttfCid, 0x48)).toBe(outline(ttfPlain, 0x48));
  });

  it('reads a CFF font’s metrics, names, CIDs and embedding permission; not TrueType', () => {
    const f = CffFont.parse(plain)!;
    expect(f.unitsPerEm).toBe(1000);
    expect(f.postScriptName).toBe('TriyaPixel');
    expect(f.capHeight).toBe(700);
    expect(f.numGlyphs).toBe(TrueTypeFont.parse(testTrueType())!.numGlyphs);
    expect(f.cidKeyed).toBe(false);
    expect([f.registry, f.ordering, f.supplement]).toEqual(['Adobe', 'Identity', 0]);
    expect(f.cid(5)).toBe(5);
    expect(f.embeddable).toBe(true);
    const c = CffFont.parse(cid)!;
    expect(c.cidKeyed).toBe(true);
    expect([c.registry, c.ordering, c.supplement]).toEqual(['Triya', 'Pixel', 0]);
    expect(c.cid(0)).toBe(0);
    expect(c.cid(5)).toBe(testCid(5));
    expect(CffFont.parse(testTrueType({ outlines: 'cff', fsType: 2 }))!.embeddable).toBe(false);
    expect(CffFont.parse(testTrueType({ outlines: 'cff', fsType: 0x0100 }))!.noSubsetting).toBe(
      true,
    );
    // Each reader takes only its own outlines.
    expect(CffFont.parse(testTrueType())).toBeUndefined();
    expect(TrueTypeFont.parse(plain)).toBeUndefined();
    expect(CffFont.parse(plain.slice(0, 300))).toBeUndefined();
    expect(CffFont.parse(new Uint8Array(3))).toBeUndefined();
  });

  for (const [kind, bytes, ttf] of [
    ['plain', plain, ttfPlain],
    ['CID-keyed', cid, ttfCid],
  ] as const) {
    it(`subsets a ${kind} CFF: glyphs keep their numbers, unused ones draw nothing`, () => {
      const font = CffFont.parse(bytes)!;
      const h = ttf.glyph(0x48).index;
      const ring = ttf.glyph(0xc5).index;
      const sub = font.subset([h, ring]);
      expect(sub.length).toBeLessThan(font.program.length / 2);
      const back = CffFont.parse(withProgram(bytes, sub))!;
      expect(back.numGlyphs).toBe(font.numGlyphs);
      expect(back.cidKeyed).toBe(font.cidKeyed);
      for (let g = 0; g < font.numGlyphs; g++) {
        expect(back.cid(g)).toBe(font.cid(g));
        const kept = g === 0 || g === h || g === ring;
        expect([...back.charString(g)]).toEqual(kept ? [...font.charString(g)] : [14]);
      }
      // opentype.js draws the kept glyphs as before, .notdef through both subroutines.
      const reread = parseTtf(withProgram(bytes, sub));
      expect(outline(reread, 0x48)).toBe(outline(ttf, 0x48));
      expect(outline(reread, 0xc5)).toBe(outline(ttf, 0xc5));
      expect(reread.glyph(0x41).commands).toEqual([]);
      expect(JSON.stringify(reread.glyph(0xe000).commands)).toBe(
        JSON.stringify(ttf.glyph(0xe000).commands),
      );
    });
  }
});

describe('CFF text in a PDF plot (M2-16 part 4)', () => {
  const ttf = parseTtf(testTrueType({ outlines: 'cff' }));
  const cidTtf = parseTtf(testTrueType({ outlines: 'cid' }));

  it('writes the text in a Type 0 font over an embedded CIDFontType0 CFF subset', async () => {
    const { bytes, latin } = plot([textItem(ttf, 'HELLO ÅÄ 1:100')]);
    expect(latin).toMatch(
      /\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+TriyaPixel \/Encoding \/Identity-H/,
    );
    expect(latin).toMatch(
      /\/Subtype \/CIDFontType0 \/BaseFont \/[A-Z]{6}\+TriyaPixel \/CIDSystemInfo << \/Registry \(Adobe\) \/Ordering \(Identity\) \/Supplement 0 >>/,
    );
    expect(latin).not.toContain('/CIDToGIDMap');
    expect(latin).toMatch(/\/FontFile3 \d+ 0 R/);
    expect(latin).not.toContain('/FontFile2');
    expect(latin).not.toMatch(/^f$/m);
    // The codes are the glyph numbers, and /W lists only the glyphs shown.
    const h = ttf.glyph(0x48).index;
    expect(latin).toContain(`<${h.toString(16).toUpperCase().padStart(4, '0')}`);
    const w = /\/W \[([^\]]*(?:\][^\]]*)*?)\] >>/.exec(latin)![1]!;
    expect(w.match(/\[/g)!.length).toBeLessThanOrEqual(11);
    const program = fontFile3(latin, bytes);
    const back = CffFont.parse(withProgram(testTrueType({ outlines: 'cff' }), program))!;
    const drawn = [...Array(back.numGlyphs).keys()].filter((g) => back.charString(g).length > 1);
    // .notdef and the ten distinct characters (H E L O space Å Ä 1 : 0); space draws nothing
    // but keeps its width operand.
    expect(drawn.length).toBe(11);

    const read = await readBack(bytes);
    expect(read.text).toBe('HELLO ÅÄ 1:100');
    expect(read.shows).toBe(true);
    expect(read.font.missingFile).toBe(false);
    expect(read.font.name).toMatch(/^[A-Z]{6}\+TriyaPixel$/);
  });

  it('shows a CID-keyed font’s glyphs by their CIDs, under its own character collection', async () => {
    const { bytes, latin } = plot([textItem(cidTtf, 'HELLO')]);
    expect(latin).toMatch(/\/Registry \(Triya\) \/Ordering \(Pixel\) \/Supplement 0/);
    const code = (cp: number) =>
      testCid(cidTtf.glyph(cp).index).toString(16).toUpperCase().padStart(4, '0');
    expect(latin).toContain(
      `[<${code(0x48)}${code(0x45)}${code(0x4c)}${code(0x4c)}${code(0x4f)}>] TJ`,
    );
    const h = testCid(cidTtf.glyph(0x48).index);
    expect(latin).toMatch(new RegExp(`/W \\[.*\\b${h} \\[600\\]`));
    const read = await readBack(bytes);
    expect(read.text).toBe('HELLO');
    expect(read.font.missingFile).toBe(false);
  });

  // M2-51: a CFF font's CIDs are its own (glyph numbers or the charset's CIDs), so a second
  // character on one glyph takes a code above every CID the font has, read through the
  // embedded CMap as that glyph's CID.
  it('copies characters that share a glyph as typed, plain and CID-keyed', async () => {
    for (const font of [ttf, cidTtf]) {
      const item = textItem(font, 'HE text \u0397E');
      const h = font.glyph(0x48).index;
      // As a font mapping Greek Eta to its Latin H hands it (Triya Pixel maps no U+0397).
      const glyphs = (item.kind === 'fill' ? item.glyphs! : []).map((g) =>
        g.codePoint === 0x397 ? { ...g, index: h } : g,
      );
      const { bytes, latin } = plot([{ ...item, glyphs } as PlotItem]);
      expect(latin).toMatch(/\/Encoding \d+ 0 R/);
      expect(latin).toMatch(/begincidrange/);
      const read = await readBack(bytes);
      expect(read.text).toBe('HE text \u0397E');
      expect(read.font.missingFile).toBe(false);
    }
  });

  it('embeds a CFF that forbids subsetting whole and without a subset tag', () => {
    const whole = parseTtf(testTrueType({ outlines: 'cff', fsType: 0x0100 }));
    const { bytes, latin } = plot([textItem(whole, 'H')]);
    expect(latin).toMatch(/\/BaseFont \/TriyaPixel /);
    expect([...fontFile3(latin, bytes)]).toEqual([...CffFont.parse(whole.bytes!)!.program]);
  });

  it('outlines a CFF font whose licence forbids embedding, and embeds a font once per document', () => {
    const locked = parseTtf(testTrueType({ outlines: 'cff', fsType: 2 }));
    const out = plot([textItem(locked, 'AB')]).latin;
    expect(out).not.toMatch(/^BT$/m);
    expect(out).toMatch(/^f$/m);
    const twice = plot([textItem(ttf, 'AB')], 2).latin;
    expect(twice.match(/\/FontFile3/g)).toHaveLength(1);
  });
});
