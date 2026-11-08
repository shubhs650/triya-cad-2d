// The SHX stroke interpreter (M1-08): shape specification bytes → pen-down polylines with
// exact arcs (bulges) and the pen's end position, which is the character's advance.
// Codes per the AutoCAD Customization Guide, "Shape Descriptions" (codes 0–14).
import { describe, expect, it } from 'vitest';
import { parseShx, type ShxGlyph } from '../../src/index';
import { buildBigfont, buildShapes, buildUnifont, s8, type ShapeDef } from './builder';

const fontOf = (...shapes: ShapeDef[]) =>
  parseShx(buildShapes(shapes, { name: 'T', above: 10, below: 2 }));

function glyphOf(bytes: number[], extra: ShapeDef[] = []): ShxGlyph {
  const g = fontOf({ code: 65, name: 'A', bytes }, ...extra).glyph(65);
  if (!g) throw new Error('no glyph');
  return g;
}

/** Path vertices as [x, y, bulge] triples rounded to 1e-9. */
const pts = (g: ShxGlyph) =>
  g.paths.map((p) =>
    p.vertices.map((v) => [v.x, v.y, v.bulge].map((n) => Math.round(n * 1e9) / 1e9)),
  );

describe('vectors', () => {
  it('draws the 16 standard directions with their lengths', () => {
    // Directions 0..F at length 1, then length 2 east: the documented vector table.
    const g = glyphOf([...Array.from({ length: 16 }, (_, d) => 0x10 | d), 0x20, 0]);
    const v = g.paths[0]!.vertices;
    const steps = v.slice(1).map((p, i) => [p.x - v[i]!.x, p.y - v[i]!.y]);
    expect(steps).toEqual([
      [1, 0],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
      [0, 1],
      [-0.5, 1],
      [-1, 1],
      [-1, 0.5],
      [-1, 0],
      [-1, -0.5],
      [-1, -1],
      [-0.5, -1],
      [0, -1],
      [0.5, -1],
      [1, -1],
      [1, -0.5],
      [2, 0],
    ]);
  });

  it('starts with the pen down, splits paths at pen up and ends at the advance', () => {
    // Square, pen up, move 3 east, pen down, line north, pen up, move to the next cell.
    const g = glyphOf([0x14, 0x10, 0x1c, 0x18, 2, 0x30, 1, 0x24, 2, 0x10, 0x2c, 0]);
    expect(pts(g)).toEqual([
      [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
        [0, 0, 0],
      ],
      [
        [3, 0, 0],
        [3, 2, 0],
      ],
    ]);
    expect(g.advance).toEqual({ x: 4, y: 0 });
  });

  it('scales lengths by codes 3 (divide) and 4 (multiply), cumulatively', () => {
    const g = glyphOf([4, 6, 0x10, 3, 2, 0x14, 3, 3, 0x18, 0]);
    expect(pts(g)).toEqual([
      [
        [0, 0, 0],
        [6, 0, 0],
        [6, 3, 0],
        [5, 3, 0],
      ],
    ]);
  });

  it('pushes and pops the pen position (codes 5 and 6), popping as a move', () => {
    const g = glyphOf([5, 0x20, 6, 0x24, 0]);
    expect(pts(g)).toEqual([
      [
        [0, 0, 0],
        [2, 0, 0],
      ],
      [
        [0, 0, 0],
        [0, 2, 0],
      ],
    ]);
  });

  it('ignores a pop with nothing pushed', () => {
    expect(pts(glyphOf([6, 0x10, 0]))).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    ]);
  });

  it('moves by signed X-Y displacements (codes 8 and 9)', () => {
    const g = glyphOf([8, s8(-3), 4, 2, 9, 2, 0, 0, s8(-2), 0, 0, 0]);
    expect(pts(g)).toEqual([
      [
        // Code 2 lifts the pen before the code 9 moves, so they only move to the advance.
        [0, 0, 0],
        [-3, 4, 0],
      ],
    ]);
    expect(g.advance).toEqual({ x: -1, y: 2 });
  });
});

describe('arcs', () => {
  const t225 = Math.tan(Math.PI / 8); // bulge of a 90° arc

  it('draws an octant arc (code 10) counter-clockwise from its start octant', () => {
    // Radius 2, start octant 0, two octants: a quarter circle about (-2, 0) ending at (-2, 2).
    const g = glyphOf([10, 2, 0x02, 0]);
    expect(pts(g)).toEqual([
      [
        [0, 0, round(t225)],
        [-2, 2, 0],
      ],
    ]);
  });

  it('draws clockwise when the octant byte is negative, and a full circle for span 0', () => {
    const cw = glyphOf([10, 1, s8(-0x42), 0]); // from octant 4 (west), clockwise 2 octants
    // Centre is (1, 0); clockwise from 180° to 90°: ends at (1, 1).
    expect(pts(cw)).toEqual([
      [
        [0, 0, -round(t225)],
        [1, 1, 0],
      ],
    ]);
    const full = glyphOf([10, 1, 0x00, 0]);
    expect(full.paths[0]!.vertices.length).toBe(5); // four 90° pieces, back at the start
    expect(full.advance.x).toBeCloseTo(0, 12);
    expect(full.advance.y).toBeCloseTo(0, 12);
  });

  it('draws a fractional arc (code 11) from and to offsets within octants', () => {
    // Start 128/256 into octant 0 (22.5°), radius 0x0100 = 256, span 2 octants ending 128/256
    // into octant 1 (67.5°): a 45° arc.
    const g = glyphOf([11, 128, 128, 1, 0, 0x02, 0]);
    const a0 = Math.PI / 8;
    const a1 = (3 * Math.PI) / 8;
    const c = { x: -256 * Math.cos(a0), y: -256 * Math.sin(a0) };
    const [start, end] = pts(g)[0]!;
    expect(start).toEqual([0, 0, round(Math.tan((a1 - a0) / 4))]);
    expect(end![0]).toBeCloseTo(c.x + 256 * Math.cos(a1), 9);
    expect(end![1]).toBeCloseTo(c.y + 256 * Math.sin(a1), 9);
  });

  it('ends a fractional arc on the octant boundary when its end offset is 0', () => {
    // Start at 0°, span 1, end offset 0: exactly one octant (45°).
    const g = glyphOf([11, 0, 0, 0, 10, 0x01, 0]);
    expect(g.advance.x).toBeCloseTo(-10 + 10 * Math.cos(Math.PI / 4), 9);
    expect(g.advance.y).toBeCloseTo(10 * Math.sin(Math.PI / 4), 9);
  });

  it('draws bulge arcs (codes 12 and 13): 127 is a semicircle, 0 a straight line', () => {
    const g = glyphOf([12, 4, 0, 127, 13, 0, 4, s8(-127), 2, 0, 0, 0, 0, 0]);
    expect(pts(g)).toEqual([
      [
        [0, 0, 1],
        [4, 0, -1],
        [4, 4, 0],
        [6, 4, 0],
      ],
    ]);
  });

  it('scales arc radii and bulge chords with the current scale', () => {
    expect(pts(glyphOf([4, 3, 10, 2, 0x02, 0]))).toEqual([
      [
        [0, 0, round(t225)],
        [-6, 6, 0],
      ],
    ]);
    expect(pts(glyphOf([4, 2, 12, 1, 1, 0, 0]))).toEqual([
      [
        [0, 0, 0],
        [2, 2, 0],
      ],
    ]);
  });
});

describe('control', () => {
  it('skips the command after code 14 in horizontal text, multi-byte commands included', () => {
    const g = glyphOf([14, 9, 5, 5, 1, 1, 0, 0, 14, 8, 1, 1, 14, 10, 1, 0x02, 14, 0x24, 0x10, 0]);
    expect(pts(g)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    ]);
  });

  it('draws a subshape (code 7) at the pen, sharing pen and scale', () => {
    const tick = { code: 200, name: 'TICK', bytes: [0x14, 0] };
    const g = glyphOf([0x10, 7, 200, 0x10, 0], [tick]);
    expect(pts(g)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [2, 1, 0],
      ],
    ]);
  });

  it('takes a 16-bit subshape number in a unifont', () => {
    const font = parseShx(
      buildUnifont(
        [
          { code: 0x0301, name: 'acute', bytes: [0x16, 0] },
          { code: 0x00e1, name: 'aacute', bytes: [0x10, 7, 0x03, 0x01, 0] },
        ],
        { name: 'U', above: 10, below: 2 },
      ),
    );
    expect(pts(font.glyph(0xe1)!)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ]);
  });

  it('stops at a subshape cycle instead of recursing forever', () => {
    const font = fontOf(
      { code: 65, name: 'A', bytes: [0x10, 7, 66, 0] },
      { code: 66, name: 'B', bytes: [0x14, 7, 65, 0] },
    );
    expect(pts(font.glyph(65)!)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ],
    ]);
  });

  it('places an extended big-font subshape in its cell, scaled from the character height', () => {
    const font = parseShx(
      buildBigfont(
        [
          { code: 0x8141, name: '', bytes: [0x14, 0] },
          // Code 7, 0: subshape 0x8141 at (1, 2) in a 4×4 cell of an 8-unit font.
          { code: 0x8140, name: '', bytes: [7, 0, 0x81, 0x41, 1, 2, 4, 4, 0] },
        ],
        { name: 'B', above: 8, below: 0 },
        [[0x81, 0x81]],
      ),
    );
    const g = font.glyph(0x8140)!;
    expect(pts(g)).toEqual([
      [
        [1, 2, 0],
        [1, 2.5, 0],
      ],
    ]);
    expect(g.advance).toEqual({ x: 4, y: 0 });
    // A plain (non-zero) subshape number in a big font is a one-byte number, as in shapes.
    const plain = parseShx(
      buildBigfont(
        [
          { code: 0x41, name: '', bytes: [0x14, 0] },
          { code: 0x8140, name: '', bytes: [0x10, 7, 0x41, 0] },
        ],
        { name: 'B', above: 8, below: 0 },
        [[0x81, 0x81]],
      ),
    );
    expect(pts(plain.glyph(0x8140)!)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ],
    ]);
  });

  it('keeps at most four pushed locations, as AutoCAD does', () => {
    // Five pushes at x = 0..4; the fifth is dropped, so the pops return to 3, 2, 1, 0.
    const g = glyphOf([2, 5, 0x10, 5, 0x10, 5, 0x10, 5, 0x10, 5, 6, 1, 0x14, 6, 6, 6, 0]);
    expect(pts(g)).toEqual([
      [
        [3, 0, 0],
        [3, 1, 0],
      ],
    ]);
    expect(g.advance).toEqual({ x: 0, y: 0 });
  });

  it('treats the undefined code 15 as the end of the shape', () => {
    expect(pts(glyphOf([0x10, 15, 0x10, 0]))).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    ]);
  });

  it('caches glyphs and returns undefined for a missing shape', () => {
    const font = fontOf({ code: 65, name: 'A', bytes: [0x10, 0] });
    expect(font.glyph(65)).toBe(font.glyph(65));
    expect(font.glyph(90)).toBeUndefined();
  });

  it('reports a shape that runs off its end', () => {
    const font = fontOf(
      { code: 65, name: 'A', bytes: [8, 1] },
      { code: 66, name: '', bytes: [0x10] },
    );
    expect(() => font.glyph(65)).toThrow(/shape 65 .* ends inside a command/);
    expect(() => font.glyph(66)).toThrow(/shape 66 has no end/);
  });

  it('gives the scale that maps font units to a text height', () => {
    expect(fontOf({ code: 65, name: 'A', bytes: [0] }).scaleFor(2.5)).toBe(0.25);
  });
});

function round(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

describe('vertical text (M1-110)', () => {
  // A dual-orientation character the way classic .shp text fonts write one: in vertical text
  // code 14 moves the pen half a width left and a cap height down first, so the character
  // hangs centred below the pen, and moves it to the next character's top at the end.
  const A = [
    2,
    14,
    8,
    s8(-2),
    s8(-6),
    1,
    0x40,
    0x64,
    0x48,
    0x6c,
    2,
    0x60,
    14,
    8,
    s8(-4),
    s8(-3),
    0,
  ];
  const font = (modes: number) =>
    parseShx(
      buildShapes([{ code: 65, name: 'A', bytes: A }], { name: 'V', above: 6, below: 2, modes }),
    );
  const box = (x: number, y: number) => [
    [
      [x, y, 0],
      [x + 4, y, 0],
      [x + 4, y + 6, 0],
      [x, y + 6, 0],
      [x, y, 0],
    ],
  ];

  it('says a font supports vertical text when its font info has mode 2', () => {
    expect(font(2).supportsVertical).toBe(true);
    expect(font(0).supportsVertical).toBe(false);
  });

  it('runs the commands after code 14 in a vertical glyph, and skips them in a horizontal one', () => {
    const f = font(2);
    const h = f.glyph(65)!;
    expect(pts(h)).toEqual(box(0, 0));
    expect(h.advance).toEqual({ x: 6, y: 0 });
    const v = f.verticalGlyph(65)!;
    expect(pts(v)).toEqual(box(-2, -6));
    expect(v.advance).toEqual({ x: 0, y: -9 });
    expect(f.verticalGlyph(66)).toBeUndefined();
  });

  it('has no vertical glyphs in a horizontal-only font', () => {
    expect(font(0).verticalGlyph(65)).toBeUndefined();
  });
});
