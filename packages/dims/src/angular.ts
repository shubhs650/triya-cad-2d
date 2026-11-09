// Angular dimensions, two-line and three-point, by AutoCAD's rules (DIMSTYLE reference,
// DIMANGULAR) and, where AutoCAD is silent, what its files store (the public corpus, read by
// M2-10's health comparison):
// - Two-line: the lines 13→14 and 15→10 meet at the centre; the arc (through 16) spans the
//   one of the four angles they make that holds 16, so it is never more than 180°.
//   Three-point: the vertex 15 is the centre, the arc (through 10) runs from the ray through 13
//   to the ray through 14 on the side that holds 10, and may pass 180°.
// - An extension line is drawn where the arc ends off its line segment: from DIMEXO beyond the
//   segment's nearer end to DIMEXE beyond the arc, along the ray.
// - Arrowheads sit on the arc's ends with their back on the arc a DIMASZ chord away (inside the angle
//   when they fit, else outside it with a DIMASZ tail of arc beyond); arrows not drawn about
//   their tip trim the arc to their backs.
// - The text's middle is DXF 11 (the arc's middle, outwards by DIMTAD, when the engine places
//   it); aligned text runs along the arc's tangent there, upright. The
//   arc stays out of the text's box widened by DIMGAP.

import type { AnnotationTables, DimensionGeometry, Handle, TextMeasure, Vec2 } from '@triya/engine';
import { dimensionText, formatAngle } from './format';
import {
  add,
  angleOf,
  arcPart,
  arrowParts,
  atTip,
  clipArc,
  defpoint,
  dist,
  dot,
  fromAngle,
  linePart,
  normAngle,
  sub,
  textBox,
  textGeometry,
  unit,
  upright,
  type DimPart,
  type TextBox,
} from './geometry';
import { fit } from './linear';
import type { DimStyle } from './style';

type Angular = Extract<DimensionGeometry, { dimType: 'angular' | 'angular3pt' }>;

/** Where the lines through `a` along `u` and through `b` along `v` meet. */
function intersect(a: Vec2, u: Vec2, b: Vec2, v: Vec2): Vec2 | undefined {
  const den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((b.x - a.x) * v.y - (b.y - a.y) * v.x) / den;
  return add(a, u, t);
}

/** One end of the arc: its ray and the line segment it extends. */
interface End {
  readonly dir: Vec2;
  readonly seg: readonly [Vec2, Vec2];
}

/** The centre and the two ends, `first` the end the arc starts from (counter-clockwise). */
function frame(
  g: Angular,
):
  | { centre: Vec2; arcPoint: Vec2; ends: [End & { first: boolean }, End & { first: boolean }] }
  | undefined {
  if (g.dimType === 'angular3pt') {
    const d1 = unit(sub(g.first, g.vertex));
    const d2 = unit(sub(g.second, g.vertex));
    if (!d1 || !d2) return undefined;
    const e1 = { dir: d1, seg: [g.vertex, g.first] as const };
    const e2 = { dir: d2, seg: [g.vertex, g.second] as const };
    const a = normAngle(angleOf(sub(g.definitionPoint, g.vertex)) - angleOf(d1));
    const inside = a <= normAngle(angleOf(d2) - angleOf(d1));
    return {
      centre: g.vertex,
      arcPoint: g.definitionPoint,
      ends: inside
        ? [
            { ...e1, first: true },
            { ...e2, first: false },
          ]
        : [
            { ...e1, first: false },
            { ...e2, first: true },
          ],
    };
  }
  const u = unit(sub(g.line1End, g.line1Start));
  const v = unit(sub(g.definitionPoint, g.line2Start));
  if (!u || !v) return undefined;
  const centre = intersect(g.line1Start, u, g.line2Start, v);
  if (!centre) return undefined;
  const at = angleOf(sub(g.arcPoint, centre));
  // Of the four angles, the one (under 180°) the arc point lies in.
  for (const a of [u, { x: -u.x, y: -u.y }]) {
    for (const b of [v, { x: -v.x, y: -v.y }]) {
      const ab = normAngle(angleOf(b) - angleOf(a));
      const ba = normAngle(angleOf(a) - angleOf(b));
      const e1 = { dir: a, seg: [g.line1Start, g.line1End] as const };
      const e2 = { dir: b, seg: [g.line2Start, g.definitionPoint] as const };
      if (ab <= Math.PI && normAngle(at - angleOf(a)) <= ab)
        return {
          centre,
          arcPoint: g.arcPoint,
          ends: [
            { ...e1, first: true },
            { ...e2, first: false },
          ],
        };
      if (ba < Math.PI && normAngle(at - angleOf(b)) <= ba)
        return {
          centre,
          arcPoint: g.arcPoint,
          ends: [
            { ...e1, first: false },
            { ...e2, first: true },
          ],
        };
    }
  }
  return undefined;
}

/**
 * A dimension arc from `a0` counter-clockwise by `sweep` with its arrowheads: inside (backs a
 * DIMASZ chord in, the arc trimmed to them unless drawn about the tip) or outside (a chord out,
 * a DIMASZ tail of arc beyond); DIMSOXD drops outside arrows. The arc stays out of `box`.
 */
export function arcLine(
  c: Vec2,
  r: number,
  a0: number,
  sweep: number,
  inside: boolean,
  box: TextBox | undefined,
  [blkStart, blkEnd]: readonly [Handle | undefined, Handle | undefined],
  s: DimStyle,
  model: AnnotationTables,
): DimPart[] {
  const out: DimPart[] = [];
  const showArrows = inside || !s.soxd;
  // The arrow's back is a chord of DIMASZ from its tip.
  const step = s.asz < 2 * r ? 2 * Math.asin(s.asz / (2 * r)) : Math.PI;
  const tipStart = atTip(blkStart, s, model);
  const tipEnd = atTip(blkEnd, s, model);
  const k = inside ? 1 : -1;
  const baseStart = a0 + k * step;
  const baseEnd = a0 + sweep - k * step;
  let from = a0;
  let to = a0 + sweep;
  if (inside && showArrows && s.asz > 0) {
    if (!tipStart) from = baseStart;
    if (!tipEnd) to = baseEnd;
  }
  const arcs: [number, number][] = [];
  if (to > from) arcs.push([from, to]);
  if (!inside && showArrows) {
    if (!tipStart) arcs.push([baseStart - step, baseStart]);
    if (!tipEnd) arcs.push([baseEnd, baseEnd + step]);
  }
  for (const [a, b] of arcs) {
    for (const [p, q] of clipArc(c, r, a, b, box)) out.push(arcPart(c, r, p, q, s.dimLine));
  }
  if (showArrows) {
    const at = (a: number): Vec2 => add(c, fromAngle(a), r);
    const pStart = at(a0);
    const pEnd = at(a0 + sweep);
    const bStart = at(baseStart);
    const bEnd = at(baseEnd);
    out.push(
      ...arrowParts(pStart, bStart, blkStart, s, model, unit(sub(bStart, pStart)) ?? fromAngle(0)),
    );
    out.push(...arrowParts(pEnd, bEnd, blkEnd, s, model, unit(sub(bEnd, pEnd)) ?? fromAngle(0)));
  }
  return out;
}

/** The angle an angular dimension measures, radians; undefined for a degenerate one. */
export function angularSweep(g: Angular): number | undefined {
  const f = frame(g);
  if (!f) return undefined;
  const startEnd = f.ends[0].first ? f.ends[0] : f.ends[1];
  const endEnd = f.ends[0].first ? f.ends[1] : f.ends[0];
  return normAngle(angleOf(endEnd.dir) - angleOf(startEnd.dir));
}

export function angularParts(
  g: Angular,
  s: DimStyle,
  model: AnnotationTables,
  measure: TextMeasure,
  keepText: boolean,
): DimPart[] | undefined {
  const f = frame(g);
  if (!f) return undefined;
  const { centre: c } = f;
  const r = dist(c, f.arcPoint);
  if (!(r > 0)) return undefined;
  const startEnd = f.ends[0].first ? f.ends[0] : f.ends[1];
  const endEnd = f.ends[0].first ? f.ends[1] : f.ends[0];
  const a0 = angleOf(startEnd.dir);
  const sweep = normAngle(angleOf(endEnd.dir) - a0);
  const out: DimPart[] = [];

  // Extension lines.
  f.ends.forEach((e, i) => {
    if (i === 0 ? s.se1 : s.se2) return;
    const t1 = dot(sub(e.seg[0], c), e.dir);
    const t2 = dot(sub(e.seg[1], c), e.dir);
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    const props = i === 0 ? s.ext1 : s.ext2;
    if (r > hi) out.push(linePart(add(c, e.dir, hi + s.exo), add(c, e.dir, r + s.exe), props));
    else if (r < lo) out.push(linePart(add(c, e.dir, lo - s.exo), add(c, e.dir, r - s.exe), props));
  });

  // Text.
  const label = dimensionText(g.text, formatAngle(sweep, s.vars), s.vars);
  const centred = s.tad === 0 && s.tvp === 0;
  let text: ReturnType<typeof textGeometry> | undefined;
  let width = 0;
  const ticks = s.tsz > 0;
  let placement = { textInside: true, arrowsInside: true };
  if (label !== undefined) {
    const probe = textGeometry((centred ? '\\A1;' : '') + label, g.textPosition, 0, s);
    const w = measure(probe);
    if (w === undefined) return undefined;
    width = w;
    placement = fit(r * sweep, width, centred, s, ticks);
    // Placed by the engine: on the arc's middle, outwards by DIMTAD.
    const mid = fromAngle(a0 + sweep / 2);
    const at = keepText
      ? g.textPosition
      : add(
          c,
          mid,
          r +
            (s.tad === 0 ? s.tvp * s.textHeight : s.textHeight / 2 + s.gap) *
              (s.tad === 4 ? -1 : 1),
        );
    const ta = normAngle(angleOf(sub(at, c)) - a0);
    const inside = ta <= sweep;
    const horizontal = inside ? s.tih : s.toh;
    const rotation =
      g.textRotation !== 0
        ? g.textRotation
        : horizontal
          ? 0
          : upright(angleOf(sub(at, c)) + Math.PI / 2);
    text = { ...probe, position: at, rotation };
  }
  const box = text ? textBox(text, width, s) : undefined;

  // Arrowheads and the arc.
  const [blkStart, blkEnd] = f.ends[0].first ? [s.blk1, s.blk2] : [s.blk2, s.blk1];
  out.push(...arcLine(c, r, a0, sweep, placement.arrowsInside, box, [blkStart, blkEnd], s, model));
  if (text) out.push({ ...s.text, geom: text, textPosition: text.position });
  if (g.dimType === 'angular') {
    out.push(
      defpoint(g.line1Start),
      defpoint(g.line1End),
      defpoint(g.line2Start),
      defpoint(g.definitionPoint),
      defpoint(g.arcPoint),
    );
  } else {
    out.push(
      defpoint(g.first),
      defpoint(g.second),
      defpoint(g.vertex),
      defpoint(g.definitionPoint),
    );
  }
  return out;
}
