// Ordinate dimensions, by AutoCAD's rules (DIMORDINATE) and, where AutoCAD is silent, what its
// files store (the acadsharp samples, read by M2-10's health comparison):
// - The measurement is the feature's (DXF 13) distance from the origin (DXF 10) along X (DXF 70
//   bit 64) or Y, unsigned, along the axes of the UCS the dimension was drawn in: DXF 51 is
//   "the negative of the angle between the OCS X axis and the UCS X axis" (DXF reference,
//   DIMENSION), so the UCS's X runs at −DXF 51 (M2-30; 0 in every corpus file).
// - The leader runs from DIMEXO off the feature along the other axis towards the leader end
//   (DXF 14). When the leader end is off the feature's line, the leader jogs: straight to
//   4 × DIMASZ short of the end, across to 2 × DIMASZ short of it on the end's line, then on.
// - "The dimension text is aligned with the ordinate leader line regardless of the orientation
//   defined by the current dimension style" (DIMORDINATE): along the leader, upright, its near
//   edge DIMGAP past the leader end, beside the leader by DIMTAD. With the text beside it, the
//   leader goes on under the text to its far end.
// - No arrowheads.

import type { AnnotationTables, DimensionGeometry, TextMeasure, Vec2 } from '@triya/engine';
import { linearText, textAlign } from './format';
import {
  add,
  angleOf,
  clipSegment,
  defpoint,
  dot,
  fromAngle,
  linePart,
  perp,
  sub,
  textBox,
  textGeometry,
  upright,
  type DimPart,
} from './geometry';
import { textOffset } from './linear';
import type { DimStyle } from './style';

type Ordinate = Extract<DimensionGeometry, { dimType: 'ordinate' }>;

export function ordinateParts(
  g: Ordinate,
  s: DimStyle,
  _model: AnnotationTables,
  measure: TextMeasure,
  keepText: boolean,
): DimPart[] | undefined {
  const xAxis = g.axis === 'x';
  const ucsX = fromAngle(-g.horizontalDirection);
  const ucsY = perp(ucsX);
  // The leader runs across the measured axis.
  const along = xAxis ? ucsY : ucsX;
  const run = dot(sub(g.leaderEnd, g.feature), along);
  const dir = run < 0 ? { x: -along.x, y: -along.y } : along;
  const length = Math.abs(run);
  const offset = dot(sub(g.leaderEnd, g.feature), perp(dir));
  const value = Math.abs(dot(sub(g.feature, g.definitionPoint), xAxis ? ucsX : ucsY));
  const label = linearText(g.text, value, s.vars);
  const out: DimPart[] = [];

  // The leader, jogged when its end is off the feature's line.
  const start = add(g.feature, dir, s.exo);
  const lines: [Vec2, Vec2][] = [];
  let lastFrom = start;
  if (Math.abs(offset) > 1e-9 * Math.max(1, length)) {
    const jogStart = add(g.feature, dir, Math.max(s.exo, length - 4 * s.asz));
    const jogEnd = add(g.leaderEnd, dir, -Math.min(length - s.exo, 2 * s.asz));
    lines.push([start, jogStart], [jogStart, jogEnd]);
    lastFrom = jogEnd;
  }
  let lastTo = g.leaderEnd;

  let text: ReturnType<typeof textGeometry> | undefined;
  let width = 0;
  const centred = s.tad === 0 && s.tvp === 0;
  if (label !== undefined) {
    const probe = textGeometry(textAlign(centred, s.vars) + label, g.textPosition, 0, s);
    const w = measure(probe);
    if (w === undefined) return undefined;
    width = w;
    const rotation = g.textRotation !== 0 ? g.textRotation : upright(angleOf(dir));
    const up = perp(fromAngle(rotation));
    const at = keepText
      ? g.textPosition
      : add(add(g.leaderEnd, dir, s.gap + width / 2), textOffset(s, up, up));
    text = { ...probe, position: at, rotation };
    if (!centred) {
      // On under the text to its far end.
      const far = dot(sub(at, g.leaderEnd), dir) + width / 2;
      if (far > 0) lastTo = add(g.leaderEnd, dir, far);
    }
  }
  lines.push([lastFrom, lastTo]);
  const box = text && centred ? textBox(text, width, s) : undefined;
  for (const [a, b] of lines) {
    for (const [p, q] of clipSegment(a, b, box)) out.push(linePart(p, q, s.dimLine));
  }
  if (text) out.push({ ...s.text, geom: text, textPosition: text.position });
  out.push(defpoint(g.feature), defpoint(g.leaderEnd), defpoint(g.definitionPoint));
  return out;
}
