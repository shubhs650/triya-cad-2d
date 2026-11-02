// The bundled GD&T font (M1-54): our stand-in for AutoCAD's GDT font, which TOLERANCE frames
// and dimension text switch to with `{\Fgdt;x}`. AutoCAD's font draws a geometric-tolerance
// symbol for each lower-case letter and ordinary text for everything else, so `oet-gdt` is
// `oet-simplex` with the 26 lower-case letters replaced by symbols we drew (MIT) on the same
// grid (cap height 42, baseline 0, y up), never copied from `gdt.shx`.
//
// The letters: AutoCAD's Geometric Tolerance dialog writes a–n, p, r, s, t and u for its
// characteristic and modifier symbols (the TOLERANCE entity's DXF 1 holds `{\Fgdt;j}` for
// position, and so on). o, q and v–z are the dimensioning symbols the same font carries
// (square, centreline, counterbore, countersink, depth, conical taper, slope), as the
// published GDT font character charts list them; AutoCAD documents no chart itself.
//
// The shapes are the ASME Y14.5 / ISO 1101 symbol forms (angularity at 30°, parallelism,
// flatness and cylindricity at 60°, runout arrows at 45°, a 90° countersink). Their exact
// sizes in AutoCAD's font are not published: these proportions fill the cap height and are
// to be checked against the M1-26 reference plots.
//
// No runtime imports, so `scripts/build-fonts.ts` can run it under Node type stripping.

import type { StrokeGlyph, TriyaStrokeFont } from './convert';

/** The bundled GD&T font's name, as FontBook knows it. */
export const GDT_FONT = 'oet-gdt';

/** Each letter AutoCAD's GDT font draws as a symbol, and the symbol. */
export const GDT_SYMBOLS: Readonly<Record<string, string>> = {
  a: 'angularity',
  b: 'perpendicularity',
  c: 'flatness',
  d: 'profile of a surface',
  e: 'circularity',
  f: 'parallelism',
  g: 'cylindricity',
  h: 'circular runout',
  i: 'symmetry',
  j: 'position',
  k: 'profile of a line',
  l: 'least material condition',
  m: 'maximum material condition',
  n: 'diameter',
  o: 'square',
  p: 'projected tolerance zone',
  q: 'centreline',
  r: 'concentricity',
  s: 'regardless of feature size',
  t: 'total runout',
  u: 'straightness',
  v: 'counterbore',
  w: 'countersink',
  x: 'depth',
  y: 'conical taper',
  z: 'slope',
};

type Stroke = number[];

/** Half way up the cap height (42): where centred symbols sit. */
const MID = 21;
/** Side bearing either side of a symbol's ink. */
const SIDE = 4;

/** A closed polygon round a circle, starting and ending at its rightmost point. */
function circle(cx: number, cy: number, r: number, segments = 32): Stroke {
  return arc(cx, cy, r, 0, 2 * Math.PI, segments);
}

/** Points along an arc (counter-clockwise from a0 to a1, radians), on the integer grid. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, segments: number): Stroke {
  const out: Stroke = [];
  for (let k = 0; k <= segments; k++) {
    const a = a0 + ((a1 - a0) * k) / segments;
    out.push(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)));
  }
  return out.map((v) => v + 0); // no −0 in the JSON
}

/** A closed triangular arrowhead with its tip at (x, y), pointing along `angle`. */
function head(x: number, y: number, angle: number, length = 12, half = 4): Stroke {
  const bx = x - length * Math.cos(angle);
  const by = y - length * Math.sin(angle);
  const nx = -Math.sin(angle) * half;
  const ny = Math.cos(angle) * half;
  const p = [
    [x, y],
    [bx + nx, by + ny],
    [bx - nx, by - ny],
    [x, y],
  ];
  return p.flatMap(([px, py]) => [Math.round(px!), Math.round(py!)]);
}

/** An arrow from (x0, y0) to (x1, y1): its shaft and a closed head at (x1, y1). */
function arrow(x0: number, y0: number, x1: number, y1: number): Stroke[] {
  return [[x0, y0, x1, y1], head(x1, y1, Math.atan2(y1 - y0, x1 - x0))];
}

/** Bounding box of strokes. */
function box(strokes: readonly (readonly number[])[]) {
  const xs = strokes.flatMap((s) => s.filter((_, i) => i % 2 === 0));
  const ys = strokes.flatMap((s) => s.filter((_, i) => i % 2 === 1));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** A base-font glyph's strokes scaled about nothing and moved so their ink centres on (cx, cy). */
function centred(g: StrokeGlyph, scale: number, cx: number, cy: number): Stroke[] {
  const scaled = g[1].map((s) => s.map((v) => v * scale));
  const b = box(scaled);
  const dx = cx - (b.minX + b.maxX) / 2;
  const dy = cy - (b.minY + b.maxY) / 2;
  return scaled.map((s) => s.map((v, i) => Math.round(v + (i % 2 === 0 ? dx : dy)) + 0));
}

/** Strokes moved sideways so their leftmost ink lies at x. */
function uprightAt(strokes: Stroke[], x: number): Stroke[] {
  const dx = x - box(strokes).minX;
  return strokes.map((s) => s.map((v, i) => (i % 2 === 0 ? v + dx : v)));
}

/** Two lines at `angle` (radians) either side of (cx, cy), each `r` from it, from y0 to y1. */
function tangents(cx: number, cy: number, r: number, angle: number, y0: number, y1: number) {
  // A line at `angle` through the point r along its normal; x where it crosses height y.
  const run = Math.cos(angle) / Math.sin(angle);
  const line = (side: number): Stroke => {
    const px = cx + side * r * Math.sin(angle);
    const py = cy - side * r * Math.cos(angle);
    return [y0, y1].flatMap((y) => [Math.round(px + (y - py) * run), y]);
  };
  return [line(1), line(-1)];
}

/** The symbol strokes for each letter, before side bearings; `letter` reads the base font. */
function symbols(letter: (ch: string) => StrokeGlyph): Record<string, Stroke[]> {
  const deg = Math.PI / 180;
  const ringed = (ch: string): Stroke[] => [
    circle(20, MID, 20),
    ...centred(letter(ch), 0.5, 20, MID),
  ];
  // Parallelism and cylindricity lean at 60°: 20 across for 34 up (atan(34/20) = 59.5°).
  const cylinder = tangents(24, MID, 11, 60 * deg, 4, 38);
  return {
    // Angularity: a base and a leg rising from its left end at 30° (35 across, 20 up).
    a: [
      [0, 4, 40, 4],
      [0, 4, 35, 24],
    ],
    b: [
      [0, 4, 40, 4],
      [20, 4, 20, 40],
    ],
    c: [[0, 8, 28, 8, 40, 32, 12, 32, 0, 8]],
    d: [[...arc(20, 8, 20, 0, Math.PI, 16), 40, 8]],
    e: [circle(17, MID, 17)],
    f: [
      [0, 4, 20, 38],
      [14, 4, 34, 38],
    ],
    g: [circle(24, MID, 11), ...cylinder],
    h: arrow(0, 4, 32, 36),
    i: [
      [8, 31, 32, 31],
      [0, MID, 40, MID],
      [8, 11, 32, 11],
    ],
    j: [circle(20, MID, 12), [0, MID, 40, MID], [20, 1, 20, 41]],
    k: [arc(20, 8, 20, 0, Math.PI, 16)],
    l: ringed('L'),
    m: ringed('M'),
    n: [circle(16, MID, 14), [2, 4, 30, 38]],
    o: [[0, 5, 32, 5, 32, 37, 0, 37, 0, 5]],
    p: ringed('P'),
    // Centreline: a C with an L whose upright runs through the C's middle.
    q: [...centred(letter('C'), 1, 20, MID), ...uprightAt(centred(letter('L'), 1, 20, MID), 20)],
    r: [circle(18, MID, 18), circle(18, MID, 9)],
    s: ringed('S'),
    t: [...arrow(0, 4, 28, 32), ...arrow(16, 4, 44, 32), [0, 4, 16, 4]],
    u: [[0, MID, 40, MID]],
    v: [[0, 26, 0, 6, 34, 6, 34, 26]],
    w: [[0, 25, 19, 6, 38, 25]],
    x: [[16, 40, 16, 4], [0, 4, 32, 4], head(16, 4, -90 * deg)],
    y: [
      [6, 10, 38, 21, 6, 32, 6, 10],
      [0, MID, 44, MID],
    ],
    z: [[0, 4, 40, 4, 0, 24, 0, 4]],
  };
}

/**
 * The GD&T font from the built `oet-simplex` font: every glyph kept, the lower-case letters
 * replaced by their symbols, each shifted to start one side bearing in.
 */
export function buildGdtFont(simplex: TriyaStrokeFont): TriyaStrokeFont {
  const letter = (ch: string): StrokeGlyph => {
    const g = simplex.glyphs[String(ch.codePointAt(0))];
    if (!g) throw new Error(`${simplex.name} has no ${ch} for the GD&T font`);
    return g;
  };
  const glyphs: Record<string, StrokeGlyph> = { ...simplex.glyphs };
  for (const [ch, strokes] of Object.entries(symbols(letter))) {
    const b = box(strokes);
    const dx = SIDE - b.minX;
    // Adding 0 also turns a rounded −0 into 0.
    const moved = strokes.map((s) => s.map((v, i) => v + (i % 2 === 0 ? dx : 0)));
    glyphs[String(ch.codePointAt(0))] = [b.maxX - b.minX + 2 * SIDE, moved];
  }
  return {
    ...simplex,
    name: GDT_FONT,
    description: 'GD&T symbols on the lower-case letters (ours), Hershey Roman Simplex otherwise',
    notice: `${simplex.notice} The GD&T symbols are ours.`,
    glyphs,
  };
}
