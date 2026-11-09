// Jogged radius dimensions (DIMJOGGED, the LARGE_RADIAL_DIMENSION entity), by AutoCAD's rules
// and, where AutoCAD is silent, what its files store (ezdxf's uncommon.dxf, read by M2-10's
// health comparison):
// - The radius is from the centre (DXF 10) to the chord point (15); the text is `R` and it.
// - The dimension line starts at the displaced centre (DXF 13) and runs parallel to the radius
//   until the jog, a segment through the jog point (14) at DIMJOGANG to the radius, which takes
//   it back onto the radius line; from there it runs along the radius to the arrowhead at the
//   chord point. The jog turns towards the side the displaced centre is on.
// - The arrowhead and the text follow the radius dimension's rules (radial.ts): from inside
//   when the text is inside the arc, else from outside with the line on to the text's far end;
//   text centred on the line breaks it (DIMGAP round its box); text the engine places goes two
//   DIMASZ beyond the chord point along the radius.

import type { AnnotationTables, DimensionGeometry, TextMeasure, Vec2 } from '@triya/engine';
import { num } from './style';
import { linearText } from './format';
import {
  add,
  angleOf,
  arrowParts,
  clipSegment,
  defpoint,
  dist,
  dot,
  fromAngle,
  linePart,
  perp,
  sub,
  textBox,
  textGeometry,
  unit,
  upright,
  type DimPart,
} from './geometry';
import { textOffset } from './linear';
import type { DimStyle } from './style';

type Jogged = Extract<DimensionGeometry, { dimType: 'jogged' }>;

/** Where the line through `p` along `d` meets the line through `q` along `u`. */
function meet(p: Vec2, d: Vec2, q: Vec2, u: Vec2): Vec2 | undefined {
  const den = d.x * u.y - d.y * u.x;
  if (Math.abs(den) < 1e-15) return undefined;
  const t = ((q.x - p.x) * u.y - (q.y - p.y) * u.x) / den;
  return add(p, d, t);
}

export function joggedParts(
  g: Jogged,
  s: DimStyle,
  model: AnnotationTables,
  measure: TextMeasure,
  keepText: boolean,
): DimPart[] | undefined {
  const c = g.definitionPoint;
  const p = g.chordPoint;
  const r = dist(c, p);
  const v = unit(sub(p, c));
  if (!v) return undefined;
  const out: DimPart[] = [];

  // The jog: through the jog point at DIMJOGANG to the radius, turned towards the displaced
  // centre, from the line through it back to the radius line.
  const side = dot(sub(g.overrideCenter, c), perp(v)) < 0 ? -1 : 1;
  const jogAngle = num(s.vars.DIMJOGANG, Math.PI / 4);
  const jogDir = fromAngle(angleOf(v) + side * jogAngle);
  const onCentreLine = meet(g.jogPoint, jogDir, g.overrideCenter, v) ?? g.jogPoint;
  const onRadius = meet(g.jogPoint, jogDir, c, v) ?? g.jogPoint;
  const lines: [Vec2, Vec2][] = [
    [g.overrideCenter, onCentreLine],
    [onCentreLine, onRadius],
  ];

  const label = linearText(g.text, r, s.vars, 'R');
  const centred = s.tad === 0 && s.tvp === 0;
  let text: ReturnType<typeof textGeometry> | undefined;
  let width = 0;
  let inside = false;
  if (label !== undefined) {
    const probe = textGeometry((centred ? '\\A1;' : '') + label, g.textPosition, 0, s);
    const w = measure(probe);
    if (w === undefined) return undefined;
    width = w;
    const at = keepText ? g.textPosition : add(p, v, 2 * s.asz + width / 2);
    inside = dot(sub(at, c), v) < r;
    const horizontal = inside ? s.tih : s.toh;
    const rotation = g.textRotation !== 0 ? g.textRotation : horizontal ? 0 : upright(angleOf(v));
    const up = perp(fromAngle(rotation));
    const position = keepText || horizontal ? at : add(at, textOffset(s, up, up));
    text = { ...probe, position, rotation };
  }
  const base = add(p, v, inside ? -s.asz : s.asz);
  if (inside || !text) lines.push([onRadius, base]);
  else lines.push([onRadius, add(c, v, dot(sub(text.position, c), v) + width / 2)]);
  const box = text && centred ? textBox(text, width, s) : undefined;
  for (const [a, b] of lines) {
    for (const [q, w] of clipSegment(a, b, box)) out.push(linePart(q, w, s.dimLine));
  }
  out.push(...arrowParts(p, base, s.blk1, s, model, unit(sub(p, base)) ?? v));
  if (text) out.push({ ...s.text, geom: text });
  out.push(defpoint(p), defpoint(g.overrideCenter), defpoint(g.jogPoint));
  return out;
}
