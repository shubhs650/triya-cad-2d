// The 'CFF ' table of the test font's CFF-flavoured OpenType twins (M2-16 part 4), written here
// so no third-party font is committed or read: the same glyphs as fonts/truetype.ts as Type 2
// charstrings (Adobe Technical Notes #5176 and #5177), quadratic arcs raised to cubics exactly
// and composite glyphs drawn out. .notdef draws its outer contour through a global subroutine
// and its counter through a local one, so a subset that dropped either would show. Written
// plain (glyph names in the charset) or CID-keyed (ROS Triya-Pixel-0, CIDs offset from the
// glyph numbers so a reader that confuses the two shows the wrong glyphs).
import { cffDict, cffIndex } from '@triya/pdf';

type Point = readonly [x: number, y: number, on: boolean];

export interface CffGlyph {
  readonly name: string;
  readonly advance: number;
  /** TrueType contours: on-curve points and quadratic off-curve ones. */
  readonly contours: readonly (readonly Point[])[];
}

/** CID of glyph `gid` in the CID-keyed font (.notdef stays 0). */
export const testCid = (gid: number) => (gid === 0 ? 0 : gid + 100);

/** Bias of a subroutine INDEX of fewer than 1240 items: subroutine 0 is called as -107. */
const BIAS = 107;

const enc = new TextEncoder();

/** A Type 2 charstring number: integers in the short forms, others as 16.16 fixed. */
function num(v: number): number[] {
  if (Number.isInteger(v)) {
    if (v >= -107 && v <= 107) return [v + 139];
    if (v >= 108 && v <= 1131) return [((v - 108) >> 8) + 247, (v - 108) & 255];
    if (v >= -1131 && v <= -108) return [((-v - 108) >> 8) + 251, (-v - 108) & 255];
    return [28, (v >> 8) & 255, v & 255];
  }
  const f = Math.round(v * 65536) | 0;
  return [255, (f >>> 24) & 255, (f >>> 16) & 255, (f >>> 8) & 255, f & 255];
}

const RMOVETO = 21;
const RLINETO = 5;
const RRCURVETO = 8;
const CALLSUBR = 10;
const CALLGSUBR = 29;
const RETURN = 11;
const ENDCHAR = 14;

/** A contour's drawing after its moveto, relative to its first point, and that point. */
function contourOps(c: readonly Point[]): { start: readonly [number, number]; ops: number[] } {
  const ops: number[] = [];
  let [px, py] = c[0]!;
  const start = [px, py] as const;
  const n = c.length;
  for (let i = 1; i <= n; i++) {
    const p = c[i % n]!;
    if (p[2]) {
      // A closing line back to the start is implied by the next moveto or endchar.
      if (i === n) break;
      ops.push(...num(p[0] - px), ...num(p[1] - py), RLINETO);
      [px, py] = p;
      continue;
    }
    const q = c[++i % n]!; // the on-curve point after an off-curve one (all test arcs have one)
    const c1x = px + ((p[0] - px) * 2) / 3;
    const c1y = py + ((p[1] - py) * 2) / 3;
    const c2x = q[0] + ((p[0] - q[0]) * 2) / 3;
    const c2y = q[1] + ((p[1] - q[1]) * 2) / 3;
    ops.push(
      ...num(c1x - px),
      ...num(c1y - py),
      ...num(c2x - c1x),
      ...num(c2y - c1y),
      ...num(q[0] - c2x),
      ...num(q[1] - c2y),
      RRCURVETO,
    );
    [px, py] = q;
  }
  return { start, ops };
}

/** A glyph's charstring; .notdef's two contours call subroutine 0 (global, then local). */
function charString(g: CffGlyph, subrs: boolean): number[] {
  const out: number[] = [...num(g.advance)];
  let px = 0;
  let py = 0;
  g.contours.forEach((c, i) => {
    const { start, ops } = contourOps(c);
    out.push(...num(start[0] - px), ...num(start[1] - py), RMOVETO);
    if (subrs && i < 2) out.push(...num(-BIAS), i === 0 ? CALLGSUBR : CALLSUBR);
    else out.push(...ops);
    // The pen ends where the contour's drawing ended.
    [px, py] = end(c);
  });
  out.push(ENDCHAR);
  return out;
}

/** Where a contour's drawing leaves the pen: its last on-curve point before the closing line. */
function end(c: readonly Point[]): readonly [number, number] {
  const last = c[c.length - 1]!;
  return last[2] ? [last[0], last[1]] : [c[0]![0], c[0]![1]];
}

export interface TestCffOptions {
  readonly postScriptName: string;
  readonly glyphs: readonly CffGlyph[];
  readonly cidKeyed: boolean;
}

/** The 'CFF ' table of `glyphs` (.notdef first). */
export function testCffTable(o: TestCffOptions): Uint8Array {
  const notdef = o.glyphs[0]!;
  const charStrings = o.glyphs.map((g, i) => new Uint8Array(charString(g, i === 0)));
  const [outer, inner] = notdef.contours.map((c) => contourOps(c).ops);
  const globalSubrs = cffIndex([new Uint8Array([...outer!, RETURN])]);
  const localSubrs = cffIndex([new Uint8Array([...inner!, RETURN])]);

  const strings = o.cidKeyed ? ['Triya', 'Pixel'] : o.glyphs.slice(1).map((g) => g.name);
  const sid = (i: number) => 391 + i;
  const charset = [0];
  o.glyphs.slice(1).forEach((_, i) => {
    const id = o.cidKeyed ? testCid(i + 1) : sid(i);
    charset.push(id >> 8, id & 255);
  });
  const n = o.glyphs.length;
  const fdSelect = [3, 0, 1, 0, 0, 0, n >> 8, n & 255];

  // Private DICT: widths are written in every charstring (nominal 0), then the local subrs.
  const privateOf = (size: number) =>
    cffDict([
      [20, [0]],
      [21, [0]],
      [19, [size]],
    ]);
  let privateDict = privateOf(0);
  privateDict = privateOf(privateDict.length);

  const names = cffIndex([enc.encode(o.postScriptName)]);
  const stringIndex = cffIndex(strings.map((s) => enc.encode(s)));
  const csIndex = cffIndex(charStrings);
  // Offsets change the DICTs' sizes: lay out until they hold still.
  let at = { charset: 0, fdSelect: 0, charStrings: 0, fdArray: 0, private: 0 };
  let top: Uint8Array = new Uint8Array(0);
  let fdArray: Uint8Array = new Uint8Array(0);
  for (let pass = 0; pass < 6; pass++) {
    const entries: [number, number[]][] = o.cidKeyed
      ? [
          [1230, [sid(0), sid(1), 0]],
          [1234, [testCid(n - 1) + 1]],
        ]
      : [];
    entries.push([15, [at.charset]], [17, [at.charStrings]]);
    if (o.cidKeyed) entries.push([1236, [at.fdArray]], [1237, [at.fdSelect]]);
    else entries.push([18, [privateDict.length, at.private]]);
    top = cffIndex([cffDict(entries)]);
    fdArray = cffIndex([cffDict([[18, [privateDict.length, at.private]]])]);
    let off = 4 + names.length + top.length + stringIndex.length + globalSubrs.length;
    const next = { ...at };
    next.charset = off;
    off += charset.length;
    next.fdSelect = off;
    if (o.cidKeyed) off += fdSelect.length;
    next.charStrings = off;
    off += csIndex.length;
    next.fdArray = off;
    if (o.cidKeyed) off += fdArray.length;
    next.private = off;
    if (JSON.stringify(next) === JSON.stringify(at)) break;
    at = next;
  }
  const pieces = [
    new Uint8Array([1, 0, 4, 4]),
    names,
    top,
    stringIndex,
    globalSubrs,
    new Uint8Array(charset),
    ...(o.cidKeyed ? [new Uint8Array(fdSelect)] : []),
    csIndex,
    ...(o.cidKeyed ? [fdArray] : []),
    privateDict,
    localSubrs,
  ];
  let size = 0;
  for (const p of pieces) size += p.length;
  const out = new Uint8Array(size);
  let k = 0;
  for (const p of pieces) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}
