// Where TEXTALIGN (M4-09 part 3) puts each text: AutoCAD 2024 Help, "TEXTALIGN (Command)",
// "Aligns multiple text objects vertically, horizontally, or obliquely", along the line from a
// base point (the alignment point of the text aligned to, or a first point) through a second
// point. Each text moves whole, by the alignment point TEXTALIGNMODE names on it as drawn
// ("the alignment point is the Left of the selected Text, regardless of the Text Justification"),
// so its own justification is kept; JUSTIFYTEXT is what changes that.
//
// The spacing is TEXTALIGNSPACING's (AutoCAD 2024 Help):
//   0 Distribute: the texts spaced evenly along the line, up to the second point;
//   1 Set spacing: the given gap between the extents of the texts along the line;
//   2 Current vertical: each text keeps its height on the page (its Y), the line giving its X;
//   3 Current horizontal: each text keeps its X, the line giving its Y.
// Where the help is silent: Distribute and Set spacing place the texts in the order they lie
// along the line now (by their alignment points); the text aligned to stays where it is and
// comes first; Current vertical on a horizontal line (where every point
// has the base's Y) keeps each text's X instead, and Current horizontal on a vertical line keeps
// its Y, rather than piling the texts onto one point.
import type { Vec2 } from '../geom/types';
import type { Justification } from './text-justify';
import { TEXT_JUSTIFICATIONS } from './text-justify';

/** TEXTALIGNMODE's values 0–11, AutoCAD's keyword for each (TL … BR, then Left, Center, Right). */
export const TEXTALIGN_MODES: readonly string[] = [
  'TL',
  'TC',
  'TR',
  'ML',
  'MC',
  'MR',
  'BL',
  'BC',
  'BR',
  'Left',
  'Center',
  'Right',
];

/** The justification point TEXTALIGNMODE `mode` aligns texts by (9, Left, otherwise). */
export function textAlignJustification(mode: number): Justification {
  return TEXT_JUSTIFICATIONS[TEXTALIGN_MODES[mode] ?? 'Left']!;
}

/** TEXTALIGNSPACING's values. */
export const TEXTALIGN_DISTRIBUTE = 0;
export const TEXTALIGN_SET_SPACING = 1;
export const TEXTALIGN_CURRENT_VERTICAL = 2;
export const TEXTALIGN_CURRENT_HORIZONTAL = 3;

/** A text TEXTALIGN moves: its alignment point and the corners of its box, as drawn. */
export interface AlignedText {
  readonly at: Vec2;
  readonly corners: readonly Vec2[];
}

/** How the texts are spaced: TEXTALIGNSPACING, with Set spacing's gap. */
export interface TextAlignSpacing {
  readonly mode: number;
  readonly gap: number;
}

/** The line the texts are aligned along. */
export interface TextAlignLine {
  readonly from: Vec2;
  readonly to: Vec2;
  /** The corners of the text aligned to, at `from`; none when the line was given by Points. */
  readonly base?: readonly Vec2[];
}

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Where each of `texts` goes (the point its alignment point moves to), in their order; undefined
 * when the two points of the line are the same.
 */
export function textAlignTargets(
  texts: readonly AlignedText[],
  line: TextAlignLine,
  spacing: TextAlignSpacing,
): Vec2[] | undefined {
  const { from, to, base } = line;
  const d = minus(to, from);
  const length = Math.hypot(d.x, d.y);
  if (!(length > 0)) return undefined;
  const u = { x: d.x / length, y: d.y / length };
  const along = (s: number): Vec2 => ({ x: from.x + u.x * s, y: from.y + u.y * s });
  // How far along the line (in its direction) the tiniest tilt still counts as level.
  const level = 1e-9;
  const keepX = (t: AlignedText) => along((t.at.x - from.x) / u.x);
  const keepY = (t: AlignedText) => along((t.at.y - from.y) / u.y);
  if (spacing.mode === TEXTALIGN_CURRENT_VERTICAL) {
    return texts.map((t) => (Math.abs(u.y) > level ? keepY(t) : keepX(t)));
  }
  if (spacing.mode === TEXTALIGN_CURRENT_HORIZONTAL) {
    return texts.map((t) => (Math.abs(u.x) > level ? keepX(t) : keepY(t)));
  }
  // Distribute and Set spacing place the texts in the order they lie along the line.
  const order = texts
    .map((t, i) => ({ i, s: dot(minus(t.at, from), u) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((o) => o.i);
  const out: Vec2[] = new Array<Vec2>(texts.length);
  if (spacing.mode === TEXTALIGN_DISTRIBUTE) {
    // After the text aligned to, the last text at the second point; between the two points
    // given by Points, the first text at the first.
    const steps = base ? order.length : order.length - 1;
    order.forEach((i, k) => {
      out[i] = along(steps === 0 ? 0 : (length * (base ? k + 1 : k)) / steps);
    });
    return out;
  }
  // Set spacing: each text's extent along the line starts the gap after the last one's end.
  const extent = (corners: readonly Vec2[], at: Vec2) => {
    const s = corners.map((c) => dot(minus(c, at), u));
    return { lo: Math.min(...s), hi: Math.max(...s) };
  };
  let end: number | undefined = base ? extent(base, from).hi : undefined;
  for (const i of order) {
    const t = texts[i]!;
    const e = extent(t.corners, t.at);
    const s = end === undefined ? 0 : end + spacing.gap - e.lo;
    out[i] = along(s);
    end = s + e.hi;
  }
  return out;
}
