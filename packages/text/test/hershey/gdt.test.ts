// M1-54: the bundled GD&T font. AutoCAD's GDT font draws a geometric-tolerance symbol for each
// lower-case letter (`{\Fgdt;j}` is the position symbol) and ordinary text for everything
// else; `oet-gdt` is our re-authored stand-in, on the stroke-font grid of `oet-simplex`.
import { describe, expect, it } from 'vitest';
import {
  buildGdtFont,
  buildStrokeFont,
  GDT_FONT,
  GDT_SYMBOLS,
  loadStrokeFont,
  parseHershey,
  type HersheyFontDef,
  type StrokeGlyph,
} from '../../src/index';

// Space, A, C, L, M, O, P, S (Roman Simplex) and x, copied from the occidental Hershey file.
const SAMPLE = [
  '  699  1JZ',
  '  501  9I[RFJ[ RRFZ[ RMTWT',
  '  503 19H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZV',
  '  512  6JWNFN[ RN[V[',
  '  513 12G]KFK[ RKFS[ RYFS[ RYFY[',
  '  515 22G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF',
  '  516 14G\\KFK[ RKFTFWGXHYJYMXOWPTQKQ',
  '  519 21H\\YIWGTFPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX',
  '  624  6J[MMX[ RXMM[',
  '',
].join('\n');

const at = (ch: string) => ch.codePointAt(0)! - 32;

function base() {
  const ascii = Array<number>(95).fill(501);
  ascii[at(' ')] = 699;
  for (const [ch, n] of [
    ['C', 503],
    ['L', 512],
    ['M', 513],
    ['O', 515],
    ['P', 516],
    ['S', 519],
    ['x', 624],
  ] as const)
    ascii[at(ch)] = n;
  const def: HersheyFontDef = { name: 'oet-simplex', description: 'test', ascii, extra: {} };
  return buildStrokeFont(def, parseHershey(SAMPLE));
}

const simplex = base();
const gdt = buildGdtFont(simplex);
const glyph = (ch: string): StrokeGlyph => gdt.glyphs[String(ch.codePointAt(0))]!;
const strokes = (ch: string) => glyph(ch)[1];

type P = readonly [number, number];
const points = (s: readonly number[]): P[] =>
  Array.from({ length: s.length / 2 }, (_, i) => [s[2 * i]!, s[2 * i + 1]!] as const);
const closed = (s: readonly number[]) =>
  s.length >= 6 && s[0] === s[s.length - 2] && s[1] === s[s.length - 1];
const centre = (s: readonly number[]): P => {
  const p = points(s);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
const radius = (s: readonly number[]) => {
  const p = points(s);
  return (Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]))) / 2;
};
/** A closed stroke whose points all lie on one circle (within the grid's rounding). */
function isCircle(s: readonly number[]): boolean {
  if (!closed(s) || s.length < 24) return false;
  const [cx, cy] = centre(s);
  const r = radius(s);
  return points(s).every(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= 1);
}
const slope = (s: readonly number[]) => {
  const p = points(s);
  const [a, b] = [p[0]!, p[p.length - 1]!];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
};
const isLine = (s: readonly number[]) => s.length === 4;
const deg = (rad: number) => (rad * 180) / Math.PI;

describe('the bundled GD&T font (M1-54)', () => {
  it("maps every lower-case letter the way AutoCAD's GDT font does", () => {
    expect(GDT_FONT).toBe('oet-gdt');
    expect(GDT_SYMBOLS).toEqual({
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
    });
    expect(gdt.name).toBe('oet-gdt');
    expect(gdt.above).toBe(simplex.above);
    expect(gdt.notice).toContain('Hershey');
  });

  it('draws a symbol, not the letter, for each lower-case letter and keeps every other character', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      expect(glyph(ch), ch).not.toEqual(simplex.glyphs[String(ch.codePointAt(0))]);
    }
    for (const [code, g] of Object.entries(simplex.glyphs)) {
      const cp = Number(code);
      if (cp >= 0x61 && cp <= 0x7a) continue;
      expect(gdt.glyphs[code], code).toEqual(g);
    }
  });

  it('sets each symbol between the baseline and the cap line, inside its advance', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      const [advance, ss] = glyph(ch);
      const p = ss.flatMap(points);
      expect(p.length, ch).toBeGreaterThan(1);
      expect(Math.min(...p.map((q) => q[1])), ch).toBeGreaterThanOrEqual(0);
      expect(Math.max(...p.map((q) => q[1])), ch).toBeLessThanOrEqual(gdt.above);
      expect(Math.min(...p.map((q) => q[0])), ch).toBeGreaterThan(0);
      expect(Math.max(...p.map((q) => q[0])), ch).toBeLessThan(advance);
      expect(
        p.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)),
        ch,
      ).toBe(true);
    }
  });

  it('loads as an SHX font that draws every symbol', () => {
    const font = loadStrokeFont(gdt);
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      const g = font.glyph(ch.codePointAt(0)!)!;
      expect(g.paths.length, ch).toBe(strokes(ch).length);
      expect(g.advance.x, ch).toBe(glyph(ch)[0]);
    }
  });

  it('draws the form symbols: straightness, flatness, circularity, cylindricity', () => {
    // u: one horizontal line half way up the cap height.
    expect(strokes('u')).toHaveLength(1);
    expect(isLine(strokes('u')[0]!) && slope(strokes('u')[0]!)).toBe(0);
    // c: a closed parallelogram, its long sides horizontal, leaning to the right.
    const [c] = strokes('c');
    expect(strokes('c')).toHaveLength(1);
    expect(closed(c!) && points(c!).length).toBe(5);
    const q = points(c!);
    expect(q[0]![1]).toBe(q[1]![1]);
    expect(q[2]![1]).toBe(q[3]![1]);
    expect(q[3]![0]).toBeGreaterThan(q[0]![0]);
    // e: one circle, centred half way up.
    expect(strokes('e')).toHaveLength(1);
    expect(isCircle(strokes('e')[0]!)).toBe(true);
    expect(centre(strokes('e')[0]!)[1]).toBe(gdt.above / 2);
    // g: a circle between two parallel lines at 60°, each touching it.
    const g = strokes('g');
    const circle = g.find(isCircle)!;
    const lines = g.filter(isLine);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(deg(slope(l))).toBeCloseTo(60, -0.5);
      const [[x0, y0], [x1, y1]] = points(l) as [P, P];
      const [cx, cy] = centre(circle);
      const d =
        Math.abs((x1 - x0) * (y0 - cy) - (x0 - cx) * (y1 - y0)) / Math.hypot(x1 - x0, y1 - y0);
      expect(Math.abs(d - radius(circle))).toBeLessThanOrEqual(1);
    }
  });

  it('draws the profile symbols: k an open half circle, d the same closed by its chord', () => {
    expect(strokes('k')).toHaveLength(1);
    expect(closed(strokes('k')[0]!)).toBe(false);
    expect(strokes('d')).toHaveLength(1);
    expect(closed(strokes('d')[0]!)).toBe(true);
    expect(points(strokes('d')[0]!).slice(0, -1)).toEqual(points(strokes('k')[0]!));
  });

  it('draws the orientation symbols: angularity, perpendicularity, parallelism', () => {
    const [base, leg] = strokes('a') as [number[], number[]];
    expect(slope(base)).toBe(0);
    expect(points(leg)[0]).toEqual(points(base)[0]);
    expect(deg(slope(leg))).toBeCloseTo(30, -0.5);
    const [floor, upright] = strokes('b') as [number[], number[]];
    expect(slope(floor)).toBe(0);
    expect(deg(slope(upright))).toBe(90);
    expect(upright[0]).toBe((floor[0]! + floor[2]!) / 2);
    const f = strokes('f');
    expect(f).toHaveLength(2);
    expect(slope(f[0]!)).toBeCloseTo(slope(f[1]!), 10);
    expect(deg(slope(f[0]!))).toBeCloseTo(60, -0.5);
  });

  it('draws the location symbols: position, concentricity, symmetry', () => {
    const j = strokes('j');
    const circle = j.find(isCircle)!;
    const [cx, cy] = centre(circle);
    const lines = j.filter(isLine);
    expect(lines.map((l) => deg(slope(l))).sort()).toEqual([0, 90]);
    for (const l of lines) {
      const p = points(l);
      // Each line passes through the centre and reaches beyond the circle on both sides.
      expect(p.some(([x, y]) => x === cx || y === cy)).toBe(true);
      expect(Math.hypot(p[0]![0] - cx, p[0]![1] - cy)).toBeGreaterThan(radius(circle));
      expect(Math.hypot(p[1]![0] - cx, p[1]![1] - cy)).toBeGreaterThan(radius(circle));
    }
    const r = strokes('r');
    expect(r.every(isCircle)).toBe(true);
    expect(r).toHaveLength(2);
    expect(centre(r[0]!)).toEqual(centre(r[1]!));
    expect(radius(r[0]!)).not.toBe(radius(r[1]!));
    const i = strokes('i');
    expect(i.every((l) => isLine(l) && slope(l) === 0)).toBe(true);
    const lengths = i.map((l) => l[2]! - l[0]!);
    expect(lengths).toHaveLength(3);
    expect(lengths[1]).toBeGreaterThan(lengths[0]!);
    expect(lengths[0]).toBe(lengths[2]);
  });

  it('draws the runout symbols: one arrow at 45°, two joined at their tails', () => {
    // An arrow: a shaft and a closed triangular head at its upper end.
    const h = strokes('h');
    expect(h.filter(isLine)).toHaveLength(1);
    expect(h.filter(closed)).toHaveLength(1);
    expect(deg(slope(h.find(isLine)!))).toBeCloseTo(45, 0);
    const t = strokes('t');
    expect(t.filter(closed)).toHaveLength(2);
    const shafts = t.filter((l) => isLine(l) && slope(l) !== 0);
    expect(shafts).toHaveLength(2);
    const join = t.find((l) => isLine(l) && slope(l) === 0)!;
    expect(points(join)).toEqual([points(shafts[0]!)[0], points(shafts[1]!)[0]]);
  });

  it('draws the modifiers as a circle round their letter: Ⓛ Ⓜ Ⓟ Ⓢ', () => {
    for (const [ch, letter] of [
      ['l', 'L'],
      ['m', 'M'],
      ['p', 'P'],
      ['s', 'S'],
    ] as const) {
      const ss = strokes(ch);
      const circle = ss[0]!;
      expect(isCircle(circle), ch).toBe(true);
      const inner = ss.slice(1);
      expect(inner.length, ch).toBe(simplex.glyphs[String(letter.codePointAt(0))]![1].length);
      const [cx, cy] = centre(circle);
      const r = radius(circle);
      expect(
        inner.flatMap(points).every(([x, y]) => Math.hypot(x - cx, y - cy) < r - 2),
        ch,
      ).toBe(true);
      // The letter is centred in the circle.
      const [lx, ly] = centre(inner.flat());
      expect(Math.abs(lx - cx), ch).toBeLessThanOrEqual(1);
      expect(Math.abs(ly - cy), ch).toBeLessThanOrEqual(1);
    }
  });

  it('draws the diameter sign as a circle crossed by one slash through its centre', () => {
    const n = strokes('n');
    const circle = n.find(isCircle)!;
    const slash = n.find(isLine)!;
    expect(n).toHaveLength(2);
    const angle = deg(slope(slash));
    expect(angle).toBeGreaterThan(40);
    expect(angle).toBeLessThan(70);
    const [cx, cy] = centre(circle);
    const [[x0, y0], [x1, y1]] = points(slash) as [P, P];
    expect(Math.abs((x0 + x1) / 2 - cx)).toBeLessThanOrEqual(1);
    expect(Math.abs((y0 + y1) / 2 - cy)).toBeLessThanOrEqual(1);
  });

  it('draws the dimensioning symbols: square, centreline, counterbore, countersink, depth, taper, slope', () => {
    // o: a closed square.
    const [o] = strokes('o') as [number[]];
    const op = points(o);
    expect(closed(o) && op.length).toBe(5);
    expect(op[2]![0] - op[0]![0]).toBe(op[2]![1] - op[0]![1]);
    // q: C and L laid over each other, both centred on the same vertical.
    const cl = [
      ...simplex.glyphs[String('C'.codePointAt(0))]![1],
      ...simplex.glyphs[String('L'.codePointAt(0))]![1],
    ];
    expect(strokes('q')).toHaveLength(cl.length);
    // The L's upright runs through the middle of the C.
    const q = strokes('q');
    const cBox = centre(q.slice(0, -simplex.glyphs[String('L'.codePointAt(0))]![1].length).flat());
    const lLeft = Math.min(
      ...q.slice(-simplex.glyphs['76']![1].length).flatMap((l) => points(l).map((p) => p[0])),
    );
    expect(Math.abs(lLeft - cBox[0])).toBeLessThanOrEqual(1);
    // v: an open box, two uprights on a floor.
    const [v] = strokes('v') as [number[]];
    const vp = points(v);
    expect(vp).toHaveLength(4);
    expect(vp[1]![1]).toBe(vp[2]![1]);
    expect(vp[0]![0]).toBe(vp[1]![0]);
    expect(vp[2]![0]).toBe(vp[3]![0]);
    // w: a V with a 90° included angle.
    const [w] = strokes('w') as [number[]];
    const [w0, w1, w2] = points(w) as [P, P, P];
    const a = Math.atan2(w0[1] - w1[1], w0[0] - w1[0]) - Math.atan2(w2[1] - w1[1], w2[0] - w1[0]);
    expect(Math.abs(deg(a))).toBeCloseTo(90, 0);
    // x: a downward arrow standing on a floor line.
    const x = strokes('x');
    expect(x.filter(closed)).toHaveLength(1);
    expect(
      x
        .filter(isLine)
        .map((l) => Math.abs(deg(slope(l))))
        .sort(),
    ).toEqual([0, 90]);
    // y: a closed triangle pointing right, with its axis.
    const y = strokes('y');
    expect(y.filter(closed)).toHaveLength(1);
    expect(y.filter(isLine).map((l) => slope(l))).toEqual([0]);
    // z: a closed right triangle whose hypotenuse falls to the right.
    const [z] = strokes('z') as [number[]];
    expect(closed(z) && points(z).length).toBe(4);
  });
});
