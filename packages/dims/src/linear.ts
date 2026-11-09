// Linear (rotated) and aligned dimensions, by AutoCAD's rules (DIMSTYLE reference; DIMATFIT,
// DIMTOFL, DIMTMOVE, DIMSOXD, DIMDLE, DIMFXL pages). Where AutoCAD is silent the rule follows
// what its files store, as read from the public corpus (acadsharp and ezdxf samples, M2-10's
// health comparison):
// - The dimension line runs through DXF 10 along the rotation (linear) or the measured points
//   (aligned); it meets each extension line, which runs from its origin (13, 14) offset by
//   DIMEXO to DIMEXE past the dimension line, along the oblique angle (DXF 52) when one is set.
// - Arrowheads sit on the extension lines. Arrows not drawn about their tip trim the dimension
//   line by DIMASZ; ticks and tip-drawn blocks leave it whole and let DIMDLE extend it.
// - Fit: arrows need 2 × DIMASZ + DIMGAP between the extension lines; text centred on the line
//   needs its width plus a gap either side (plus the arrows to share the room). DIMATFIT then
//   moves arrows, text or both outside; DIMTIX keeps the text in; DIMSOXD drops outside arrows.
//   Outside arrows get a DIMASZ tail beyond their back.
// - The line between the extension lines is drawn when the arrows are inside, DIMTOFL is on,
//   or text moved out with a leader (DIMTMOVE 1) hangs its leader from the line's middle.
// - While the dimension keeps the graphics its writer stored (or its text was moved by the
//   user, DXF 70 bit 128), its text stays where the writer put it: DXF 11 is the text's middle,
//   except for text moved out with a leader, where DXF 11 is the middle of the text's near edge: a leader runs from the dimension line's middle to DIMASZ +
//   DIMGAP short of it, its last DIMASZ along the text (the landing). Otherwise the engine
//   places it (`defaultTextAt`).
// - Text moved out without a leader (DIMTMOVE 0) takes the dimension line with it: the line
//   goes on from the nearer extension line to the text.
// - Dimension lines stay out of the text's box widened by DIMGAP.
// - DIMJUST 3 and 4 put the text over the first or second extension line: turned along it
//   (upright), its middle DIMGAP and half its width beyond the dimension line, beside the line
//   by DIMTAD as text beside a dimension line is; the extension line stays out of its box. The
//   text then takes no room between the extension lines.

import type { AnnotationTables, DimensionGeometry, TextMeasure, Vec2 } from '@triya/engine';
import { linearText } from './format';
import {
  add,
  angleOf,
  arrowParts,
  atTip,
  clipSegment,
  defpoint,
  dist,
  dot,
  fromAngle,
  lerp,
  linePart,
  perp,
  sub,
  textBox,
  textGeometry,
  unit,
  upright,
  type DimPart,
} from './geometry';
import type { DimStyle } from './style';

type Linear = Extract<DimensionGeometry, { dimType: 'linear' | 'aligned' }>;

/** Where line `p + t·d` meets the line through `q` along `u`. */
function meet(p: Vec2, d: Vec2, q: Vec2, u: Vec2): Vec2 {
  const den = d.x * u.y - d.y * u.x;
  if (Math.abs(den) < 1e-15) return p;
  const t = ((q.x - p.x) * u.y - (q.y - p.y) * u.x) / den;
  return add(p, d, t);
}

/** How text and arrows share the room between the extension lines (DIMATFIT, DIMTIX). */
export function fit(
  room: number,
  textWidth: number,
  centred: boolean,
  s: DimStyle,
  ticks: boolean,
): { textInside: boolean; arrowsInside: boolean } {
  const arrowsNeed = ticks ? 0 : 2 * s.asz + s.gap;
  const textNeeds = centred ? textWidth + 2 * s.gap : textWidth;
  const arrowsFit = room >= arrowsNeed;
  const textFits = room >= textNeeds;
  const bothFit = room >= (centred ? textNeeds + arrowsNeed : Math.max(textNeeds, arrowsNeed));
  if (bothFit) return { textInside: true, arrowsInside: true };
  if (s.tix) return { textInside: true, arrowsInside: false };
  switch (s.atfit) {
    case 0:
      return { textInside: false, arrowsInside: false };
    case 1:
      return { textInside: textFits, arrowsInside: false };
    case 2:
      return { textInside: false, arrowsInside: arrowsFit };
    default:
      if (textFits) return { textInside: true, arrowsInside: false };
      return { textInside: false, arrowsInside: arrowsFit };
  }
}

/**
 * The side of the dimension line text sits on for DIMTAD (and DIMTVP with DIMTAD 0): above
 * is the text's up side; DIMTAD 2 the side away from the measured points; 4 below.
 */
export function textOffset(s: DimStyle, normal: Vec2, away: Vec2): Vec2 {
  if (s.tad === 0)
    return { x: normal.x * s.tvp * s.textHeight, y: normal.y * s.tvp * s.textHeight };
  const k = s.textHeight / 2 + s.gap;
  const sign = s.tad === 4 ? -1 : s.tad === 2 && dot(normal, away) < 0 ? -1 : 1;
  return { x: normal.x * k * sign, y: normal.y * k * sign };
}

/**
 * Where AutoCAD puts the text's middle (DXF 11) when it places it: on the middle of the line
 * (DIMJUST 1 and 2 next to the first or second extension line), or, when it does not fit,
 * beyond the second extension line (and its arrow); DIMTMOVE 1 hangs it over the middle, DXF 11
 * then being its near edge. Off the line by DIMTAD.
 */
function defaultTextAt(
  g: Linear,
  s: DimStyle,
  f: {
    s1: Vec2;
    s2: Vec2;
    along: Vec2;
    width: number;
    outside: boolean;
    textDir: Vec2;
    arrowsInside: boolean;
  },
): Vec2 {
  const room = dist(f.s1, f.s2);
  // The dimension line's normal on the text's up side (none for text across the line).
  let normal = perp(f.along);
  const up = perp(f.textDir);
  if (dot(normal, up) < 0) normal = { x: -normal.x, y: -normal.y };
  const across = Math.abs(dot(normal, up)) < 1e-9;
  const off = across ? { x: 0, y: 0 } : textOffset(s, normal, sub(f.s1, g.first));
  if (f.outside && s.tmove === 1) {
    const m = lerp(f.s1, f.s2, 0.5);
    const lift = across ? s.textHeight + s.asz : s.asz + s.textHeight / 2 + s.gap;
    return add(add(m, normal, lift), f.textDir, s.asz + s.gap);
  }
  let along: number;
  if (f.outside) along = room + (f.arrowsInside ? 1 : 2) * s.asz + s.gap + f.width / 2;
  else if (s.just === 1) along = s.asz + s.gap + f.width / 2;
  else if (s.just === 2) along = room - s.asz - s.gap - f.width / 2;
  else along = room / 2;
  return add(add(f.s1, f.along, along), off);
}

/**
 * DXF 10 of a linear or aligned dimension as AutoCAD writes it when it regenerates: where the
 * dimension line meets the second extension line. STRETCH moves the points inside its window
 * one by one; regeneration puts DXF 10 back on the second extension line (M2-10 part 3).
 */
export function linearDefinitionPoint(g: Linear): Vec2 {
  const u =
    g.dimType === 'aligned'
      ? (unit(sub(g.second, g.first)) ?? fromAngle(0))
      : fromAngle(g.rotation ?? 0);
  const extDir = g.oblique !== undefined && g.oblique !== 0 ? fromAngle(g.oblique) : perp(u);
  return meet(g.second, extDir, g.definitionPoint, u);
}

export function linearParts(
  g: Linear,
  s: DimStyle,
  model: AnnotationTables,
  measure: TextMeasure,
  keepText: boolean,
): DimPart[] | undefined {
  const u =
    g.dimType === 'aligned'
      ? (unit(sub(g.second, g.first)) ?? fromAngle(0))
      : fromAngle(g.rotation ?? 0);
  const extDir = g.oblique !== undefined && g.oblique !== 0 ? fromAngle(g.oblique) : perp(u);
  const s1 = meet(g.first, extDir, g.definitionPoint, u);
  const s2 = meet(g.second, extDir, g.definitionPoint, u);
  const room = dist(s1, s2);
  // Along the line from the first extension line to the second.
  const along = unit(sub(s2, s1)) ?? u;
  const out: DimPart[] = [];

  // Extension lines.
  const extLines: [Vec2, Vec2, DimStyle['ext1']][] = [];
  const ext = (p: Vec2, at: Vec2, props: DimStyle['ext1']) => {
    const v = unit(sub(at, p)) ?? extDir;
    const len = dist(p, at);
    const start = s.fxlon && s.fxl < len - s.exo ? add(at, v, -s.fxl) : add(p, v, s.exo);
    extLines.push([start, add(at, v, s.exe), props]);
  };
  if (!s.se1) ext(g.first, s1, s.ext1);
  if (!s.se2) ext(g.second, s2, s.ext2);

  // Text.
  const label = linearText(g.text, room, s.vars);
  // DIMJUST 3/4: over the first or second extension line.
  const overExt =
    s.just === 3
      ? { origin: g.first, at: s1 }
      : s.just === 4
        ? { origin: g.second, at: s2 }
        : undefined;
  const centred = s.tad === 0 && s.tvp === 0;
  const ticks = s.tsz > 0;
  let width = 0;
  let placement = { textInside: true, arrowsInside: true };
  let text: ReturnType<typeof textGeometry> | undefined;
  let leader: Vec2[] | undefined;
  let dxf11: Vec2 | undefined;
  if (label !== undefined) {
    const lineAngle = angleOf(along);
    const probe = textGeometry((centred ? '\\A1;' : '') + label, g.textPosition, 0, s);
    const w = measure(probe);
    if (w === undefined) return undefined;
    width = w;
    if (overExt) {
      const outward = unit(sub(overExt.at, overExt.origin)) ?? extDir;
      const rotation = g.textRotation !== 0 ? g.textRotation : upright(angleOf(outward));
      const up = perp(fromAngle(rotation));
      const at = keepText
        ? g.textPosition
        : add(add(overExt.at, outward, s.gap + width / 2), textOffset(s, up, up));
      text = { ...probe, position: at, rotation };
      dxf11 = at;
    }
    placement = fit(room, overExt ? 0 : width, overExt ? false : centred, s, ticks);
    if (!overExt) {
      let at = g.textPosition;
      let outside: boolean;
      if (keepText) {
        const t = dot(sub(at, s1), along) / (room || 1);
        const offLine = t < -1e-9 || t > 1 + 1e-9;
        outside = !placement.textInside || (g.textUserPositioned && offLine);
      } else {
        outside = !placement.textInside;
      }
      const horizontal = outside ? s.toh : s.tih;
      const rotation = g.textRotation !== 0 ? g.textRotation : horizontal ? 0 : upright(lineAngle);
      const textDir = fromAngle(rotation);
      if (!keepText)
        at = defaultTextAt(g, s, {
          s1,
          s2,
          along,
          width,
          outside,
          textDir,
          arrowsInside: placement.arrowsInside,
        });
      let middle = at;
      if (outside && s.tmove === 1) {
        // Leader from the line's middle to the text's near edge (DXF 11).
        const m = lerp(s1, s2, 0.5);
        const side = dot(sub(at, m), textDir) < 0 ? -1 : 1;
        const landEnd = add(at, textDir, -side * s.gap);
        const landStart = add(landEnd, textDir, -side * s.asz);
        leader = [m, landStart, landEnd];
        middle = add(at, textDir, side * (width / 2));
      }
      text = { ...probe, position: middle, rotation };
      dxf11 = at;
      placement = { textInside: !outside, arrowsInside: placement.arrowsInside };
    }
  }
  const box = text ? textBox(text, width, s) : undefined;
  for (const [a, b, props] of extLines) {
    for (const [p, q] of clipSegment(a, b, overExt ? box : undefined))
      out.push(linePart(p, q, props));
  }
  // Text over an extension line leaves the dimension line whole.
  const lineBox = overExt ? undefined : box;

  // Arrowheads and the dimension line.
  const arrowsInside = placement.arrowsInside;
  const showArrows = arrowsInside || !s.soxd;
  const tip1 = atTip(s.blk1, s, model);
  const tip2 = atTip(s.blk2, s, model);
  const dir1 = arrowsInside ? along : { x: -along.x, y: -along.y };
  const base1 = add(s1, dir1, s.asz);
  const base2 = add(s2, dir1, -s.asz);
  let lineStart = s1;
  let lineEnd = s2;
  if (arrowsInside) {
    if (showArrows && !tip1 && s.asz > 0) lineStart = base1;
    if (showArrows && !tip2 && s.asz > 0) lineEnd = base2;
    if (tip1) lineStart = add(lineStart, along, -s.dle);
    if (tip2) lineEnd = add(lineEnd, along, s.dle);
  }
  const lines: [Vec2, Vec2][] = [];
  const inner = arrowsInside || s.tofl || (!placement.textInside && s.tmove === 1);
  if (inner) {
    // DIMSD1/DIMSD2 drop the half of the line on each side of the text (or the middle).
    const tMid = text && !overExt ? dot(sub(text.position, s1), along) : room / 2;
    const split = add(s1, along, Math.min(room, Math.max(0, tMid)));
    if (s.sd1 && s.sd2) {
      // Both halves suppressed.
    } else if (s.sd1) lines.push([split, lineEnd]);
    else if (s.sd2) lines.push([lineStart, split]);
    else lines.push([lineStart, lineEnd]);
  }
  if (!arrowsInside && showArrows) {
    // Tails beyond outside arrows' backs.
    if (!tip1 && !s.sd1) lines.push([base1, add(base1, dir1, s.asz)]);
    if (!tip2 && !s.sd2) lines.push([base2, add(base2, dir1, -s.asz)]);
  }
  if (text && !placement.textInside && s.tmove === 0) {
    // The dimension line follows outside text, under it (or to its box when centred).
    const t = dot(sub(text.position, s1), along);
    const near = t < room / 2 ? s1 : s2;
    const k = t < room / 2 ? -1 : 1;
    const far = add(text.position, along, centred ? 0 : k * (width / 2));
    const reach = dot(sub(far, near), along) * k;
    if (reach > 0) lines.push([near, add(near, along, k * reach)]);
  }
  for (const [a, b] of lines) {
    for (const [p, q] of clipSegment(a, b, lineBox)) out.push(linePart(p, q, s.dimLine));
  }
  if (leader) {
    for (let i = 0; i + 1 < leader.length; i++)
      out.push(linePart(leader[i]!, leader[i + 1]!, s.dimLine));
  }
  if (showArrows) {
    out.push(...arrowParts(s1, base1, s.blk1, s, model, along));
    out.push(...arrowParts(s2, base2, s.blk2, s, model, along));
  }
  if (text) out.push({ ...s.text, geom: text, textPosition: dxf11 ?? text.position });
  out.push(defpoint(g.first), defpoint(g.second), defpoint(g.definitionPoint));
  return out;
}
