// M2-39 part 3: TrueType text in an SVG plot as SVG text in an embedded subset of its font. The
// font is the test font written in fonts/truetype.ts; opentype.js (through @triya/text's
// parseTtf), an independent reader, must read the embedded font and find each character's
// glyph drawn as the original font draws it. Chromium draws the plot sheet's text pages from
// these files in tests/e2e/fidelity/svg.spec.ts.
import {
  plotSvg,
  readSfnt,
  type Affine,
  type PlotGlyph,
  type PlotItem,
  type PlotPaint,
} from '@triya/pdf';
import { parseTtf, type TtfFont } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { testTrueType } from '../fonts/truetype';

const PAINT: PlotPaint = {
  color: [0, 0, 0],
  lineweight: 0.25,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** The SVG's paper: 200 × 100 points. */
const H = 100;

/** `text` laid out from (x, y) along `dir` (radians), `size` units per em, `tracking` × advance. */
function line(
  font: TtfFont,
  text: string,
  o: {
    x?: number;
    y?: number;
    size?: number;
    dir?: number;
    tracking?: number;
    mirror?: boolean;
  } = {},
): PlotItem {
  const s = (o.size ?? 10) / font.unitsPerEm;
  const cos = Math.cos(o.dir ?? 0);
  const sin = Math.sin(o.dir ?? 0);
  const glyphs: PlotGlyph[] = [];
  const path: number[] = [];
  let pen = 0;
  const x0 = o.x ?? 20;
  const y0 = o.y ?? 50;
  const flip = o.mirror ? -1 : 1;
  for (const ch of text) {
    const g = font.glyph(ch.codePointAt(0)!);
    // Font units → world: scaled, mirrored in x when asked, rotated, moved to the pen.
    const m: Affine = {
      a: s * cos * flip,
      b: s * sin * flip,
      c: -s * sin,
      d: s * cos,
      e: x0 + pen * cos,
      f: y0 + pen * sin,
    };
    glyphs.push({ font, index: g.index, codePoint: g.codePoint, m });
    for (const c of g.commands) {
      const at = (x: number, y: number) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
      if (c.op === 'M') path.push(0, ...at(c.x, c.y));
      else if (c.op === 'L') path.push(1, ...at(c.x, c.y));
      else if (c.op === 'Q') path.push(5, ...at(c.x1, c.y1), ...at(c.x, c.y));
      else if (c.op === 'Z') path.push(4);
    }
    pen += g.advance * s * (o.tracking ?? 1) * flip;
  }
  return { kind: 'fill', path, paint: PAINT, glyphs };
}

function svg(items: readonly PlotItem[], textAsGeometry = false): string {
  return plotSvg(items, {
    toPaper: IDENTITY,
    width: 200,
    height: H,
    ...(textAsGeometry && { textAsGeometry: true }),
  });
}

/** The embedded fonts' files, by family name. */
function embedded(out: string): Map<string, Uint8Array> {
  const fonts = new Map<string, Uint8Array>();
  for (const m of out.matchAll(
    /@font-face\{font-family:'([^']+)';src:url\(data:font\/(?:ttf|otf);base64,([^)]+)\)/g,
  ))
    fonts.set(m[1]!, new Uint8Array(Buffer.from(m[2]!, 'base64')));
  return fonts;
}

interface Text {
  readonly matrix: number[];
  readonly xs: number[];
  readonly family: string;
  readonly size: number;
  readonly chars: string;
}

function texts(out: string): Text[] {
  return [
    ...out.matchAll(
      /<text transform="matrix\(([^)]+)\)" x="([^"]+)" y="0" font-family="([^"]+)" font-size="([^"]+)"[^>]*>([^<]*)<\/text>/g,
    ),
  ].map((m) => ({
    matrix: m[1]!.split(' ').map(Number),
    xs: m[2]!.split(' ').map(Number),
    family: m[3]!,
    size: Number(m[4]),
    chars: m[5]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  }));
}

/** A text's character `i` origin and its em's up vector, SVG units. */
function placed(t: Text, i: number) {
  const [a, b, c, d, e, f] = t.matrix as [number, number, number, number, number, number];
  const x = t.xs[i]!;
  return {
    x: a * x + e,
    y: b * x + f,
    // Text local y is down: up one em is (0, -size).
    upX: -c * t.size,
    upY: -d * t.size,
  };
}

/** World (y up) → the SVG's user space (y down). */
const svgPoint = (x: number, y: number) => ({ x, y: H - y });

describe('TrueType text in an SVG plot (M2-39 part 3)', () => {
  const bytes = testTrueType();
  const ttf = parseTtf(bytes);

  it('writes text as SVG text in a subset of its font, embedded with a cmap of its characters', () => {
    const out = svg([line(ttf, 'HÅ10')]);
    expect(out).not.toMatch(/<path d="[^"]*" fill="#000000"/);
    const [t, ...more] = texts(out);
    expect(more).toEqual([]);
    expect(t!.chars).toBe('HÅ10');
    expect(t!.family).toBe("'triya-1', 'Triya Pixel'");
    expect(out).toContain('direction="ltr" unicode-bidi="bidi-override"');
    expect(out).toContain('xml:space="preserve">HÅ10</text>');

    const file = embedded(out).get('triya-1')!;
    const tables = [...readSfnt(file)!.tables.keys()].sort();
    // What a browser's sanitiser asks of a TrueType font; nothing for layout.
    expect(tables).toEqual(
      expect.arrayContaining([
        'OS/2',
        'cmap',
        'glyf',
        'head',
        'hhea',
        'hmtx',
        'loca',
        'maxp',
        'name',
        'post',
      ]),
    );
    expect(tables.filter((t) => ['GSUB', 'GPOS', 'kern', 'GDEF'].includes(t))).toEqual([]);

    // An independent reader finds each character's glyph, drawn as the original draws it,
    // the composite Å with its components renumbered into the subset.
    const sub = parseTtf(file);
    for (const ch of 'HÅ10') {
      const cp = ch.codePointAt(0)!;
      expect(sub.hasGlyph(cp), ch).toBe(true);
      expect(sub.glyph(cp).commands, ch).toEqual(ttf.glyph(cp).commands);
      expect(sub.glyph(cp).advance, ch).toBe(ttf.glyph(cp).advance);
    }
    // Only the glyphs shown: no other character maps to a glyph.
    expect(sub.hasGlyph('B'.codePointAt(0)!)).toBe(false);
  });

  it('places each character where the plot placed its glyph, at a font size of the em in points', () => {
    for (const o of [
      { dir: 0, tracking: 1.5 },
      { dir: Math.PI / 6, tracking: 1 },
      { dir: -2, tracking: 0.8, mirror: true },
    ]) {
      const item = line(ttf, 'ABC', { ...o, size: 12 });
      const [t] = texts(svg([item]));
      expect(t!.size).toBe(12);
      if (item.kind !== 'fill') throw new Error('fill');
      item.glyphs!.forEach((g, i) => {
        const at = placed(t!, i);
        const want = svgPoint(g.m.e, g.m.f);
        expect(at.x).toBeCloseTo(want.x, 2);
        expect(at.y).toBeCloseTo(want.y, 2);
        // The em's up vector: world (c, d) per font unit, y flipped.
        expect(at.upX).toBeCloseTo(g.m.c * ttf.unitsPerEm, 3);
        expect(at.upY).toBeCloseTo(-g.m.d * ttf.unitsPerEm, 3);
      });
    }
  });

  it('starts a new run where glyphs leave the baseline', () => {
    const a = line(ttf, 'AB', { y: 50 });
    const b = line(ttf, 'CD', { y: 30 });
    if (a.kind !== 'fill' || b.kind !== 'fill') throw new Error('fill');
    const out = svg([{ ...a, glyphs: [...a.glyphs!, ...b.glyphs!], path: [...a.path, ...b.path] }]);
    expect(texts(out).map((t) => t.chars)).toEqual(['AB', 'CD']);
  });

  it('embeds each font once per file, keeps spaces and escapes markup characters', () => {
    // The test font has no < or &: show its B and C glyphs for them.
    const as = (item: PlotItem, i: number, ch: string): PlotItem => {
      if (item.kind !== 'fill') throw new Error('fill');
      const glyphs = item.glyphs!.map((g, k) =>
        k === i ? { ...g, codePoint: ch.codePointAt(0)! } : g,
      );
      return { ...item, glyphs };
    };
    const out = svg([as(line(ttf, 'A B'), 2, '<'), as(line(ttf, 'A C', { y: 20 }), 2, '&')]);
    expect(embedded(out).size).toBe(1);
    expect(texts(out).map((t) => t.chars)).toEqual(['A <', 'A &']);
    expect(out).toContain('A &lt;');
    const sub = parseTtf(embedded(out).get('triya-1')!);
    expect(sub.glyph('<'.codePointAt(0)!).commands).toEqual(ttf.glyph(66).commands);
    expect(sub.glyph('&'.codePointAt(0)!).commands).toEqual(ttf.glyph(67).commands);
    expect(sub.hasGlyph(32)).toBe(true);
  });

  it('plots outlines where the PDF plot would, or a glyph cannot be selected by its character', () => {
    const outlines = (out: string) => texts(out).length === 0 && /<path d="M/.test(out);
    // "Convert all text to geometry".
    expect(outlines(svg([line(ttf, 'AB')], true))).toBe(true);
    // A font whose licence forbids embedding (OS/2 fsType 2).
    expect(outlines(svg([line(parseTtf(testTrueType({ fsType: 2 })), 'AB')]))).toBe(true);
    // A character the font lacks shows .notdef: not selectable by that character.
    expect(outlines(svg([line(ttf, 'A中')]))).toBe(true);
    // A control character and a soft hyphen draw nothing as text.
    for (const ch of ['\u0001', '­']) {
      const item = line(ttf, 'AB');
      if (item.kind !== 'fill') throw new Error('fill');
      const glyphs = item.glyphs!.map((g, i) =>
        i === 1 ? { ...g, codePoint: ch.codePointAt(0)! } : g,
      );
      expect(outlines(svg([{ ...item, glyphs }])), JSON.stringify(ch)).toBe(true);
    }
    // One character shown by two glyphs: the second item keeps its outlines.
    const a = line(ttf, 'A');
    const b = line(ttf, 'B', { y: 20 });
    if (a.kind !== 'fill' || b.kind !== 'fill') throw new Error('fill');
    const other = { ...b, glyphs: b.glyphs!.map((g) => ({ ...g, codePoint: 65 })) };
    const out = svg([a, other]);
    expect(texts(out).map((t) => t.chars)).toEqual(['A']);
    expect(out).toMatch(/<path d="M[^"]+" fill="#000000"/);
  });

  it('embeds CFF-flavoured fonts, plain and CID-keyed, as OpenType with a cmap', () => {
    for (const outlines of ['cff', 'cid'] as const) {
      const otf = parseTtf(testTrueType({ outlines }));
      const out = svg([line(otf, 'HÅ1')]);
      expect(
        texts(out).map((t) => t.chars),
        outlines,
      ).toEqual(['HÅ1']);
      expect(out).toContain("format('opentype')");
      const file = embedded(out).get('triya-1')!;
      const tables = [...readSfnt(file)!.tables.keys()].sort();
      expect(tables, outlines).toEqual([
        'CFF ',
        'OS/2',
        'cmap',
        'head',
        'hhea',
        'hmtx',
        'maxp',
        'name',
        'post',
      ]);
      const sub = parseTtf(file);
      for (const ch of 'HÅ1') {
        const cp = ch.codePointAt(0)!;
        expect(sub.glyph(cp).index, `${outlines} ${ch}`).toBe(otf.glyph(cp).index);
        expect(sub.glyph(cp).commands, `${outlines} ${ch}`).toEqual(otf.glyph(cp).commands);
      }
    }
  });

  it('writes the same file for the same plot', () => {
    const items = [line(ttf, 'HELLO'), line(ttf, 'Å', { y: 10 })];
    expect(svg(items)).toBe(svg(items));
  });
});
