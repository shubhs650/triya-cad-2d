// Arc length dimensions (DIMARC, the ARC_DIMENSION entity), by AutoCAD's rules (DIMARC,
// DIMARCSYM) and, where AutoCAD is silent, what its files store (ezdxf's uncommon.dxf, read by
// M2-10's health comparison):
// - The measured arc is centred on DXF 15 and runs counter-clockwise from 13 to 14; the
//   measurement is its length. The dimension arc is concentric, through DXF 10.
// - Extension lines run parallel to the arc's bisector when it spans under 90° and radially
//   otherwise (DIMARC: "extension lines … are displayed orthogonally if the included angle is
//   less than 90 degrees"), from DIMEXO off the arc's end to DIMEXE past the dimension arc.
// - The dimension arc, its arrowheads and its text follow the angular dimension's rules
//   (angular.ts): arrows on the arc where it meets the extension lines, text on its middle
//   (outwards by DIMTAD) unless kept where the writer put it.
// - DIMARCSYM 0 puts the arc symbol before the text, 1 above it, 2 nowhere. AutoCAD files store
//   it as an ARC in Continuous: an upper half circle 0.817 text heights across the radius,
//   ending at the text's near edge with its centre half a radius below the text's middle.
//   (DXF 71's leader for a dimension of a long arc is not drawn yet.)

import type { AnnotationTables, DimensionGeometry, TextMeasure, Vec2 } from '@triya/engine';
import { arcLine } from './angular';
import { linearText } from './format';
import {
  add,
  angleOf,
  arcPart,
  defpoint,
  dist,
  dot,
  fromAngle,
  linePart,
  normAngle,
  perp,
  sub,
  textBox,
  textGeometry,
  upright,
  type DimPart,
} from './geometry';
import { fit } from './linear';
import { num, type DimStyle } from './style';

type ArcLength = Extract<DimensionGeometry, { dimType: 'arc' }>;

/** The arc symbol's radius in text heights, as AutoCAD files store it. */
const SYMBOL = 0.817;

/** Where the line from `o` along `d` meets the circle (`c`, `r`) nearest `o`. */
function toCircle(o: Vec2, d: Vec2, c: Vec2, r: number): number | undefined {
  const w = sub(o, c);
  const b = dot(w, d);
  const disc = b * b - (dot(w, w) - r * r);
  if (disc < 0) return undefined;
  const t1 = -b + Math.sqrt(disc);
  const t2 = -b - Math.sqrt(disc);
  return Math.abs(t1) <= Math.abs(t2) ? t1 : t2;
}

export function arcLengthParts(
  g: ArcLength,
  s: DimStyle,
  model: AnnotationTables,
  measure: TextMeasure,
  keepText: boolean,
): DimPart[] | undefined {
  const c = g.center;
  const r0 = dist(c, g.first);
  const r = dist(c, g.definitionPoint);
  if (!(r0 > 0) || !(r > 0)) return undefined;
  const a1 = angleOf(sub(g.first, c));
  const span = normAngle(angleOf(sub(g.second, c)) - a1) || 2 * Math.PI;
  const out: DimPart[] = [];

  // Extension lines, and where they meet the dimension arc (its ends).
  const bisector = fromAngle(a1 + span / 2);
  const ends = [g.first, g.second].map((o, i) => {
    const radial = fromAngle(i === 0 ? a1 : a1 + span);
    const parallel = span < Math.PI / 2 ? toCircle(o, bisector, c, r) : undefined;
    const d = parallel === undefined ? radial : bisector;
    const t = parallel ?? r - r0;
    const k = t < 0 ? -1 : 1;
    const tip = add(o, d, t);
    if (!(i === 0 ? s.se1 : s.se2) && Math.abs(t) > s.exo)
      out.push(linePart(add(o, d, k * s.exo), add(o, d, t + k * s.exe), i === 0 ? s.ext1 : s.ext2));
    return angleOf(sub(tip, c));
  });
  const a0 = ends[0]!;
  const sweep = normAngle(ends[1]! - a0) || span;

  // Text.
  const label = linearText(g.text, r0 * span, s.vars);
  const centred = s.tad === 0 && s.tvp === 0;
  let text: ReturnType<typeof textGeometry> | undefined;
  let width = 0;
  let placement = { textInside: true, arrowsInside: true };
  if (label !== undefined) {
    const probe = textGeometry((centred ? '\\A1;' : '') + label, g.textPosition, 0, s);
    const w = measure(probe);
    if (w === undefined) return undefined;
    width = w;
    placement = fit(r * sweep, width, centred, s, s.tsz > 0);
    const mid = fromAngle(a0 + sweep / 2);
    const lift =
      (s.tad === 0 ? s.tvp * s.textHeight : s.textHeight / 2 + s.gap) * (s.tad === 4 ? -1 : 1);
    const at = keepText ? g.textPosition : add(c, mid, r + lift);
    const inside = normAngle(angleOf(sub(at, c)) - a0) <= sweep;
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
  out.push(...arcLine(c, r, a0, sweep, placement.arrowsInside, box, [s.blk1, s.blk2], s, model));

  if (text) {
    out.push({ ...s.text, geom: text, textPosition: text.position });
    const sym = num(s.vars.DIMARCSYM);
    if (sym === 0 || sym === 1) {
      const rs = SYMBOL * s.textHeight;
      const dir = fromAngle(text.rotation);
      const up = perp(dir);
      const centre =
        sym === 0
          ? add(add(text.position, dir, -(width / 2 + rs)), up, -rs / 2)
          : add(text.position, up, s.textHeight / 2 + s.gap);
      const continuous = [...model.tables.linetypes.values()].find(
        (l) => l.name.toLowerCase() === 'continuous',
      );
      out.push({
        ...arcPart(centre, rs, text.rotation, text.rotation + Math.PI, s.text),
        ...(continuous ? { linetype: continuous.handle } : {}),
      });
    }
  }
  out.push(defpoint(c), defpoint(g.first), defpoint(g.second), defpoint(g.definitionPoint));
  return out;
}
