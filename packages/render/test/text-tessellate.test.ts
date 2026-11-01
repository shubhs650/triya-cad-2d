// TEXT and MTEXT glyphs (M1-41 part 1): exact SHX strokes and TrueType outlines placed by the
// text engine with AutoCAD's justification, width factor, obliquing and mirroring.
import type { MTextGeometry, TextGeometry, TextStyleRecord } from '@triya/engine';
import { FontBook } from '@triya/text';
import { describe, expect, it } from 'vitest';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  tessellate,
  transformPath,
  type Paint,
  type RenderPrimitive,
  type TextContext,
} from '../src/index';
import { fontBook, sans } from './text-fonts';

const paint: Paint = { color: '#ff0000', lineweight: 0.35 };
const style = (handle: string, font: string, extra: Partial<TextStyleRecord> = {}) =>
  ({
    handle,
    name: handle,
    font,
    height: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    lastHeight: 2.5,
    generation: 0,
    trueTypeFlags: 0,
    ...extra,
  }) satisfies TextStyleRecord;
const STYLES = new Map([
  ['S1', style('S1', 'romans.shx')],
  ['S2', style('S2', 'testsans.ttf')],
  ['S3', style('S3', 'romans', { widthFactor: 0.5, bigFont: 'big.shx' })],
]);
const ctx = (fonts = fontBook()): TextContext => ({ fonts, style: (h) => STYLES.get(h) });

const text = (value: string, extra: Partial<TextGeometry> = {}): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: 'S1',
  position: { x: 10, y: 20 },
  height: 5,
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
  style: 'S1',
  position: { x: 0, y: 0 },
  height: 10,
  width: 0,
  rotation: 0,
  attachment: 7,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  ...extra,
});

const r = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
type PathPrim = Extract<RenderPrimitive, { path: readonly number[] }>;
const only = (prims: RenderPrimitive[]): PathPrim => {
  expect(prims).toHaveLength(1);
  return prims[0] as PathPrim;
};
/** Move and line targets of a path, rounded. */
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
/** The square glyph at (x, y), side s. */
const square = (x: number, y: number, s: number) => [
  [x, y],
  [x, y + s],
  [x + s, y + s],
  [x + s, y],
  [x, y],
];

describe('TEXT with an SHX font', () => {
  it('strokes each glyph from the baseline start, height / above per font unit', () => {
    const p = only(tessellate(text('AA'), paint, { text: ctx() }));
    expect(p.kind).toBe('stroke');
    expect(p.color).toBe('#ff0000');
    expect(p.lineweight).toBe(0.35);
    // Height 5 over above 10: the 1-unit square is 0.5 wide, and each A advances 1.
    expect(points(p.path)).toEqual([...square(10, 20, 0.5), ...square(11, 20, 0.5)]);
  });

  it('draws nothing without fonts, and nothing for empty text', () => {
    expect(tessellate(text('A'), paint)).toEqual([]);
    expect(tessellate(text(''), paint, { text: ctx() })).toEqual([]);
    expect(tessellate(text('A', { style: 'S2' }), paint, { text: ctx(new FontBook()) })).toEqual(
      [],
    );
  });

  it('draws a character the font lacks as "?"', () => {
    const p = only(tessellate(text('Z'), paint, { text: ctx() }));
    expect(points(p.path)).toEqual(square(10, 20, 0.5));
  });

  it('keeps bulge arcs exact, and obliqued ones as exact ellipses', () => {
    const arc = only(tessellate(text('B'), paint, { text: ctx() }));
    expect(arc.path[3]).toBe(PATH_A);
    expect(arc.path.slice(4, 7).map(r)).toEqual([10.5, 20, 0.5]);
    const leaning = only(tessellate(text('B', { oblique: 0.3 }), paint, { text: ctx() }));
    expect(leaning.path[3]).toBe(PATH_E);
  });

  it('applies width factor, obliquing and rotation through the glyph frame', () => {
    const p = only(
      tessellate(
        text('A', { widthFactor: 2, oblique: Math.PI / 4, rotation: Math.PI / 2 }),
        paint,
        {
          text: ctx(),
        },
      ),
    );
    // Local square: (0,0) (0.5,0.5)→ leaned: top corners shift right by 0.5; x doubled.
    // Then turned 90°: local (x, y) → (10 − y, 20 + x).
    expect(points(p.path)).toEqual([
      [10, 20],
      [9.5, 20.5],
      [9.5, 21.5],
      [10, 21],
      [10, 20],
    ]);
  });

  it('justifies on the alignment point: centre, right, middle, top, bottom', () => {
    const at = { alignmentPoint: { x: 100, y: 50 } };
    const first = (g: TextGeometry) => points(only(tessellate(g, paint, { text: ctx() })).path)[0];
    // "AA" is 2 wide (the second square ends at 1.5, the advance at 2).
    expect(first(text('AA', { ...at, halign: 1 }))).toEqual([99, 50]);
    expect(first(text('AA', { ...at, halign: 2 }))).toEqual([98, 50]);
    expect(first(text('AA', { ...at, valign: 3 }))).toEqual([100, 45]); // top: cap height 5
    expect(first(text('AA', { ...at, valign: 2 }))).toEqual([100, 47.5]);
    expect(first(text('AA', { ...at, valign: 1 }))).toEqual([100, 52]); // below 4 × 0.5
    // Middle (72 = 4): between the descender line (−2) and the cap height (5).
    expect(first(text('AA', { ...at, halign: 4 }))).toEqual([99, 48.5]);
    // Left baseline ignores DXF 11.
    expect(first(text('AA', at))).toEqual([10, 20]);
  });

  it('fits (stretches) and aligns (scales) between the two points', () => {
    const two = { position: { x: 0, y: 0 }, alignmentPoint: { x: 4, y: 0 } };
    const fit = only(tessellate(text('AA', { ...two, halign: 5 }), paint, { text: ctx() }));
    expect(points(fit.path).slice(0, 3)).toEqual([
      [0, 0],
      [0, 0.5],
      [1, 0.5],
    ]);
    const aligned = only(tessellate(text('AA', { ...two, halign: 3 }), paint, { text: ctx() }));
    expect(points(aligned.path).slice(0, 3)).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('mirrors backward and upside-down text about the insertion point', () => {
    const back = only(tessellate(text('A', { backward: true }), paint, { text: ctx() }));
    expect(points(back.path)).toEqual(square(10, 20, 0.5).map(([x, y]) => [r(20 - x!), y!]));
    const down = only(tessellate(text('A', { upsideDown: true }), paint, { text: ctx() }));
    expect(points(down.path)).toEqual(square(10, 20, 0.5).map(([x, y]) => [x!, r(40 - y!)]));
  });

  it('underlines with %%u', () => {
    const p = only(tessellate(text('%%uA'), paint, { text: ctx() }));
    const pts = points(p.path);
    expect(pts.slice(0, 5)).toEqual(square(10, 20, 0.5));
    expect(pts).toHaveLength(7);
    expect(pts[5]![1]).toBe(pts[6]![1]);
    expect(pts[5]![1]).toBeLessThan(20);
  });
});

describe('TEXT with a TrueType font', () => {
  it('fills the outlines non-zero with their Béziers exact', () => {
    const f = sans();
    const prims = tessellate(text('AB', { style: 'S2', height: 7 }), paint, { text: ctx() });
    const p = only(prims);
    expect(p.kind).toBe('fill');
    expect(p.evenOdd).toBe(false);
    // opentype.js writes CFF outlines, so B's curve comes back cubic.
    expect(p.path).toContain(PATH_C);
    expect(p.path).toContain(PATH_Z);
    const k = 7 / f.capHeight;
    // A's apex (300, 700) and B's stem start, 600 units on.
    expect(points(p.path)).toContainEqual([r(10 + 300 * k), r(20 + 700 * k)]);
    expect(points(p.path)).toContainEqual([r(10 + 680 * k), 20]);
  });
});

describe('MTEXT', () => {
  it('lays out lines and draws each at its baseline in the entity frame', () => {
    const p = only(tessellate(mtext('A\\PA'), paint, { text: ctx() }));
    const pts = points(p.path);
    // Bottom-left attachment: the last line's baseline on the insertion point; spacing 5/3 × 10.
    expect(pts.slice(0, 5)).toEqual(square(0, r(50 / 3), 1));
    expect(pts.slice(5)).toEqual(square(0, 0, 1));
  });

  it('splits colour overrides into their own primitives', () => {
    // Red (1) is the entity's own colour here and ByLayer (256) keeps it: one primitive.
    const same = tessellate(mtext('A{\\C1;A}{\\C256;A}'), paint, { text: ctx() });
    expect(same.map((p) => p.color)).toEqual(['#ff0000']);
    const blue = tessellate(mtext('A{\\C5;A}'), paint, { text: ctx() });
    expect(blue.map((p) => p.color)).toEqual(['#ff0000', '#0000ff']);
  });

  it('switches fonts mid-text, stroking SHX and filling TrueType', () => {
    const prims = tessellate(mtext('A{\\fTriya Test Sans;A}'), paint, { text: ctx() });
    expect(prims.map((p) => p.kind)).toEqual(['stroke', 'fill']);
  });

  it('draws stacks with their bar, the style width factor, and big-font characters', () => {
    const stack = tessellate(mtext('\\SA/A;'), paint, { text: ctx() });
    expect(points(only(stack).path).length).toBe(12); // two squares and the bar
    const wide = only(tessellate(mtext('A', { style: 'S3' }), paint, { text: ctx() }));
    expect(points(wide.path)).toEqual([
      [0, 0],
      [0, 1],
      [0.5, 1],
      [0.5, 0],
      [0, 0],
    ]);
    const big = only(tessellate(mtext('\\M+18140', { style: 'S3' }), paint, { text: ctx() }));
    // Height 10 over above 8, width factor 0.5.
    expect(points(big.path)).toEqual([
      [0, 0],
      [0, 1.25],
      [0.625, 1.25],
      [0.625, 0],
      [0, 0],
    ]);
  });

  it('turns with its rotation and flips upside down on a −Z plane', () => {
    const turned = only(tessellate(mtext('A', { rotation: Math.PI }), paint, { text: ctx() }));
    expect(points(turned.path)).toEqual(square(0, 0, 1).map(([x, y]) => [r(-x!), r(-y!)]));
    const down = only(tessellate(mtext('A', { upsideDown: true }), paint, { text: ctx() }));
    expect(points(down.path)).toEqual(square(0, 0, 1).map(([x, y]) => [x!, r(-y!)]));
  });

  it('shows an unevaluated field as ---- and an evaluated one as its value', () => {
    const contents = '%<\\AcVar Date>%';
    const none = tessellate(mtext(contents), paint, { text: ctx() });
    expect(points(only(none).path)).toHaveLength(20); // four "?" squares for ----
    const one = tessellate(mtext(contents), paint, {
      text: { ...ctx(), evaluateField: () => 'A' },
    });
    expect(points(only(one).path)).toEqual(square(0, 0, 1));
  });
});

describe('Bézier path commands', () => {
  it('carry through an affine map by their control points', () => {
    const path = [PATH_M, 0, 0, PATH_Q, 1, 1, 2, 0, PATH_C, 3, 1, 4, 1, 5, 0];
    expect(transformPath(path, { a: 2, b: 0, c: 0, d: 3, e: 1, f: 1 })).toEqual([
      PATH_M,
      1,
      1,
      PATH_Q,
      3,
      4,
      5,
      1,
      PATH_C,
      7,
      4,
      9,
      4,
      11,
      1,
    ]);
  });
});
