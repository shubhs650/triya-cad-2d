// Radius and diameter dimensions, by AutoCAD's rules (DIMSTYLE reference; DIMCEN, DIMTOFL,
// DIMTIH/DIMTOH pages) and, where AutoCAD is silent, what its files store (the public corpus,
// read by M2-10's health comparison):
// - Radius: DXF 10 is the centre, 15 the chord point; diameter: 10 and 15 are the ends of the
//   diameter, the centre half way. The text is `R` or `%%c` before the measurement.
// - One arrowhead at the chord point: from inside the circle when the text is inside, from
//   outside when it is outside, its back along the radius.
// - Text aligned with the radius sits on (or, with DIMTAD, beside) a line along the radius from
//   the arrow's back to the far end of the text. Text kept horizontal (DIMTIH inside, DIMTOH
//   outside) is reached by a leader from the arrow's back and a DIMASZ landing along the text,
//   stopping DIMGAP short of it.
// - Text outside: DIMTOFL draws the line from the centre to the chord point (for a diameter,
//   across the circle with an arrowhead at each end); without it the centre gets DIMCEN's mark
//   (a cross DIMCEN either side; negative adds centre lines out past the circle).
// - DXF 11 is the text's middle; user-positioned text above an aligned line (DIMTAD) sits a
//   gap and half a text height above it.

import type { AnnotationTables, DimensionGeometry, TextMeasure, Vec2 } from '@triya/engine';
import { dimensionText, formatLinear } from './format';
import {
  add,
  angleOf,
  arrowParts,
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

type Radial = Extract<DimensionGeometry, { dimType: 'radius' | 'diameter' }>;

/** DIMCEN's centre mark (and centre lines when negative) for a circle of radius `r`. */
function centreMark(c: Vec2, r: number, s: DimStyle): DimPart[] {
  const size = Math.abs(s.cen);
  if (!(size > 0)) return [];
  const out: DimPart[] = [];
  for (const d of [fromAngle(0), fromAngle(Math.PI / 2)]) {
    out.push(linePart(add(c, d, -size), add(c, d, size), s.dimLine));
  }
  if (s.cen < 0 && r > 2 * size) {
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const d = fromAngle(a);
      out.push(linePart(add(c, d, 2 * size), add(c, d, r + size), s.dimLine));
    }
  }
  return out;
}

export function radialParts(
  g: Radial,
  s: DimStyle,
  model: AnnotationTables,
  measure: TextMeasure,
): DimPart[] | undefined {
  const diameter = g.dimType === 'diameter';
  const p = g.chordPoint;
  const c = diameter ? lerp(g.definitionPoint, p, 0.5) : g.definitionPoint;
  const r = dist(c, p);
  const v = unit(sub(p, c)) ?? fromAngle(0);
  const out: DimPart[] = [];
  const label = dimensionText(
    g.text,
    (diameter ? '%%c' : 'R') + formatLinear(diameter ? 2 * r : r, s.vars),
    s.vars,
  );
  const centred = s.tad === 0 && s.tvp === 0;
  const t = g.textPosition;
  const inside = dist(t, c) < r;
  const base = add(p, v, inside ? -s.asz : s.asz);
  const lines: [Vec2, Vec2][] = [];
  let text: ReturnType<typeof textGeometry> | undefined;
  let width = 0;
  if (label !== undefined) {
    const probe = textGeometry((centred ? '\\A1;' : '') + label, t, 0, s);
    const w = measure(probe);
    if (w === undefined) return undefined;
    width = w;
    const horizontal = inside ? s.tih : s.toh;
    if (horizontal && g.textRotation === 0) {
      // Leader from the arrow's back, then a landing along the text.
      const side = t.x < base.x ? -1 : 1;
      const landEnd = add(t, { x: 1, y: 0 }, -side * (width / 2 + s.gap));
      const landStart = add(landEnd, { x: 1, y: 0 }, -side * s.asz);
      lines.push([landEnd, landStart], [landStart, base]);
      text = probe;
    } else {
      const rotation = g.textRotation !== 0 ? g.textRotation : upright(angleOf(v));
      const up = perp(fromAngle(rotation));
      const middle = !centred && g.textUserPositioned ? add(t, up, s.gap + s.textHeight / 2) : t;
      text = { ...probe, position: middle, rotation };
      // Along the radius from the text's far end to the arrow's back.
      const k = dot(sub(t, c), v) + (inside ? -1 : 1) * (width / 2);
      lines.push([add(c, v, k), base]);
    }
  }
  if (!inside && s.tofl) {
    lines.push([diameter ? g.definitionPoint : c, p]);
  } else if (!inside) {
    out.push(...centreMark(c, r, s));
  }
  const box = text && centred ? textBox(text, width, s) : undefined;
  for (const [a, b] of lines) {
    for (const [q, w] of clipSegment(a, b, box)) out.push(linePart(q, w, s.dimLine));
  }
  // The chord point's arrowhead is the first one (as ezdxf draws it; AutoCAD does not say).
  out.push(...arrowParts(p, base, s.blk1, s, model, unit(sub(p, base)) ?? v));
  if (diameter && !inside && s.tofl) {
    // The far end's arrowhead, from inside the circle.
    const far = g.definitionPoint;
    out.push(...arrowParts(far, add(far, v, s.asz), s.blk2, s, model, v));
  }
  if (text) out.push({ ...s.text, geom: text });
  out.push(defpoint(g.definitionPoint), defpoint(p));
  return out;
}
