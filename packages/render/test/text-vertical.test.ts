// Vertical text (M1-110): TEXT in a vertical STYLE (DXF 70 bit 4) and MTEXT drawn top to
// bottom (DXF 72 = 3, or 5 with a vertical style) stack their characters down a column, only
// when the font is an SHX font that supports vertical text (font info mode 2); in a Hershey or
// TrueType font they draw horizontally, as AutoCAD does. The test font is made up in memory
// (Autodesk's fonts are never committed): A is a 4 × 6 box that hangs centred below the pen in
// vertical text and steps 9 down to the next character.
import type { MTextGeometry, TextGeometry, TextStyleRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  primitivesBox,
  tessellate,
  textBounds,
  type Paint,
  type RenderPrimitive,
  type TextContext,
} from '../src/index';
import { fontBook } from './text-fonts';

const paint: Paint = { color: '#ff0000' };
const VERTICAL = 4; // STYLE DXF 70 bit: vertical text
const style = (handle: string, font: string, flags = 0): TextStyleRecord => ({
  handle,
  name: handle,
  font,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
  ...(flags ? { flags } : {}),
});
const STYLES = new Map(
  [
    style('V', 'vert.shx', VERTICAL),
    style('H', 'vert.shx'),
    style('FLAT', 'flat.shx', VERTICAL),
    style('FLATH', 'flat.shx'),
    style('ROMANS', 'romans.shx', VERTICAL),
    style('ROMANSH', 'romans.shx'),
    style('TTF', 'testsans.ttf', VERTICAL),
    style('TTFH', 'testsans.ttf'),
  ].map((s) => [s.handle, s]),
);
const ctx: TextContext = { fonts: fontBook(), style: (h) => STYLES.get(h) };

const text = (value: string, extra: Partial<TextGeometry> = {}): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: 'V',
  position: { x: 10, y: 20 },
  height: 6,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  ...extra,
});

const mtext = (contents: string, extra: Partial<MTextGeometry> = {}): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: 'H',
  position: { x: 0, y: 0 },
  height: 6,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 3,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  ...extra,
});

const r = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
type PathPrim = Extract<RenderPrimitive, { path: readonly number[] }>;
const draw = (g: TextGeometry | MTextGeometry) => tessellate(g, paint, { text: ctx });
const glyphs = (g: TextGeometry | MTextGeometry): number[][] => {
  const prims = draw(g);
  expect(prims).toHaveLength(1);
  return points((prims[0] as PathPrim).path);
};
function points(path: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    const n = { [PATH_M]: 2, [PATH_L]: 2, [PATH_A]: 6, [PATH_E]: 8, [PATH_Q]: 4, [PATH_C]: 6 }[op];
    if (op === PATH_M || op === PATH_L) out.push([r(path[i + 1]!), r(path[i + 2]!)]);
    i += 1 + (n ?? 0);
  }
  return out;
}
/** The 4 × 6 box glyph with its lower left corner at (x, y), as the font strokes it. */
const box = (x: number, y: number) => [
  [x, y],
  [x + 4, y],
  [x + 4, y + 6],
  [x, y + 6],
  [x, y],
];
/** The same box turned a quarter left (TEXT rotated 90°). */
const turned = (x: number, y: number) => [
  [x, y],
  [x, y + 4],
  [x - 6, y + 4],
  [x - 6, y],
  [x, y],
];

describe('TEXT in a vertical style', () => {
  it('stacks the characters down from the insertion point, each centred on it', () => {
    // A hangs 2 either side of x = 10 and 6 below y = 20; the next A starts 9 lower.
    expect(glyphs(text('AA'))).toEqual([...box(8, 14), ...box(8, 5)]);
  });

  it('draws horizontally without the style flag, as before', () => {
    expect(glyphs(text('AA', { style: 'H' }))).toEqual([...box(10, 20), ...box(16, 20)]);
  });

  it('draws horizontally when the font has no vertical mode: SHX mode 0, Hershey, TrueType', () => {
    expect(draw(text('AA', { style: 'FLAT' }))).toEqual(draw(text('AA', { style: 'FLATH' })));
    expect(draw(text('AB', { style: 'ROMANS' }))).toEqual(draw(text('AB', { style: 'ROMANSH' })));
    expect(draw(text('AB', { style: 'TTF' }))).toEqual(draw(text('AB', { style: 'TTFH' })));
    expect(draw(text('AA', { style: 'FLAT' }))).not.toEqual(draw(text('AA')));
  });

  it('centres the column on the alignment point for Center and Middle, ends it there for Right', () => {
    // The column is 18 long (two steps of 9).
    const at = { alignmentPoint: { x: 10, y: 20 }, position: { x: 0, y: 0 } };
    expect(glyphs(text('AA', { ...at, halign: 1 }))).toEqual([...box(8, 23), ...box(8, 14)]);
    expect(glyphs(text('AA', { ...at, halign: 4 }))).toEqual([...box(8, 23), ...box(8, 14)]);
    expect(glyphs(text('AA', { ...at, halign: 2 }))).toEqual([...box(8, 32), ...box(8, 23)]);
  });

  it('turns the column with the rotation, the characters with it', () => {
    // Rotated 90°: "down" the column is +x; each A turns a quarter left.
    expect(glyphs(text('AA', { rotation: Math.PI / 2 }))).toEqual([
      ...turned(16, 18),
      ...turned(25, 18),
    ]);
  });

  it('fits Aligned text between its points, scaling the characters too', () => {
    // 18 long, the points 36 apart: everything doubles.
    const g = text('AA', { halign: 3, alignmentPoint: { x: 10, y: -16 } });
    expect(glyphs(g)).toEqual([
      [6, 8],
      [14, 8],
      [14, 20],
      [6, 20],
      [6, 8],
      [6, -10],
      [14, -10],
      [14, 2],
      [6, 2],
      [6, -10],
    ]);
  });

  it('turns underlines with the column: a line beside it, as long as the column', () => {
    const prims = draw(text('%%uA'));
    const path = (prims[0] as PathPrim).path;
    const lines = points(path).slice(5); // after the box: the underline
    expect(lines).toHaveLength(2);
    const [[x1, y1], [x2, y2]] = lines as [[number, number], [number, number]];
    expect(x1).toBe(x2);
    expect(x1).toBeLessThan(8); // left of the column: below the baseline, turned
    expect([y1, y2].sort((a, b) => a - b)).toEqual([11, 20]); // one step of 9 from the point
  });

  it('is bounded in the spatial index by what it draws, its greeking box included', () => {
    const b = textBounds(ctx)(text('AA'));
    expect(b).toEqual(primitivesBox(draw(text('AA'))));
    // Glyphs x 8..12, y 5..20; the greeking box is the column, a height wide: x 7..13, y 2..20.
    expect(b).toEqual({ minX: 7, minY: 2, maxX: 13, maxY: 20 });
  });
});

describe('MTEXT drawn top to bottom', () => {
  it('turns each line into a column, the first on the right, from the top-left corner', () => {
    // Lines 10 apart (5/3 × 6): columns centred at x = 13 and x = 3 of a box 16 wide.
    expect(glyphs(mtext('A\\PA'))).toEqual([...box(11, -6), ...box(1, -6)]);
  });

  it('places the column block by its attachment point, bottom right here', () => {
    // Columns 9 long (one step), block 16 wide: it ends at the insertion point.
    expect(glyphs(mtext('A\\PA', { attachment: 9 }))).toEqual([...box(-5, 3), ...box(-15, 3)]);
  });

  it('draws "by style" (DXF 72 = 5) vertically only in a vertical style', () => {
    expect(draw(mtext('A\\PA', { direction: 5, style: 'V' }))).toEqual(draw(mtext('A\\PA')));
    expect(draw(mtext('A\\PA', { direction: 5 }))).toEqual(draw(mtext('A\\PA', { direction: 1 })));
  });

  it('draws horizontally, as before, when the font has no vertical mode', () => {
    for (const s of ['FLATH', 'ROMANSH', 'TTFH']) {
      const vertical = draw(mtext('A\\PB', { style: s }));
      expect(vertical).toEqual(draw(mtext('A\\PB', { style: s, direction: 1 })));
      expect(vertical.length).toBeGreaterThan(0);
    }
  });

  it('draws horizontally when a run switches to a font without vertical mode', () => {
    const mixed = 'A{\\Fromans.shx;A}';
    expect(draw(mtext(mixed))).toEqual(draw(mtext(mixed, { direction: 1 })));
  });

  it('turns the background fill with the block of columns', () => {
    const g = mtext('A\\PA', {
      background: { flags: 1, color: { kind: 'aci', index: 1 }, scale: 1.5 },
    });
    const fill = draw(g)[0] as PathPrim;
    expect(fill.kind).toBe('fill');
    // The block x 0..16, y -9..0, grown by (1.5 − 1) × 6 = 3 each side.
    const p = points(fill.path);
    const xs = p.map(([x]) => x!);
    const ys = p.map(([, y]) => y!);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([
      -3, 19, -12, 3,
    ]);
  });

  it('is bounded in the spatial index by what it draws', () => {
    const g = mtext('A\\PA');
    expect(textBounds(ctx)(g)).toEqual(primitivesBox(draw(g)));
    // Glyphs x 1..15, y -6..0; the greeking boxes are the columns, 9 long and 6 wide.
    expect(textBounds(ctx)(g)).toEqual({ minX: 0, minY: -9, maxX: 16, maxY: 0 });
  });
});
