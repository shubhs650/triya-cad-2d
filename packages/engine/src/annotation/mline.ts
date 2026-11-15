// What an MLINE draws (M3-14): the renderer draws a multiline as these parts, and EXPLODE
// (M3-12 part 3) turns it into them, so the canvas shows what exploding leaves.
//
// The stored geometry is read the way ezdxf's `render/mline.py` (MIT) reads it: each element's
// point at a vertex lies along the vertex's miter at the element's first parameter (scale and
// justification are already in it), and each element runs from vertex to vertex in its colour and
// linetype. Square caps and displayed joints are lines from the outermost elements to the middle
// between them; round caps join the outermost elements with a half circle and inner arcs the
// next ones in, two quarter circles when the two elements' colours differ.
//
// Breaks (MLEDIT Cut, DXF 41 after the first): the remaining parameters are distances along the
// segment from the element's point, alternately where a visible piece starts and where it
// stops; the last piece runs to the next vertex (an element with only [offset, 0] is whole).
// Fill (style flag 1, AutoCAD's "Fill on") is the area between the outermost elements from the
// start to the end miter, in the style's fill colour and under the lines; caps are not filled
// (ezdxf fills the same area). Area-fill parameters (DXF 42) are not read: no drawing we have
// stores any, and the DXF reference does not say how they cut the fill.

import type { Vec2 } from '../geom/types';
import type {
  Color,
  EntityGeometry,
  HatchGeometry,
  MLineGeometry,
  PlanarProps,
} from '../model/types';
import { normalizeAngle } from '../geom/angle';
import { linetypeRef, type AnnotationPart, type AnnotationTables } from './multileader';

// MLINESTYLE DXF 70 bits (AutoCAD DXF reference, MLINESTYLE).
const MLS_FILL = 1;
const MLS_MITER = 2;
const MLS_START_SQUARE = 16;
const MLS_START_INNER = 32;
const MLS_START_ROUND = 64;
const MLS_END_SQUARE = 256;
const MLS_END_INNER = 512;
const MLS_END_ROUND = 1024;

// MLINE DXF 71 bits.
const ML_CLOSED = 2;
const ML_NO_START_CAPS = 4;
const ML_NO_END_CAPS = 8;

/** Why a multiline draws nothing, or undefined when it can be drawn. */
export function mlineProblem(g: MLineGeometry, model: AnnotationTables): string | undefined {
  const style = g.style === undefined ? undefined : model.tables.mlineStyles.get(g.style);
  if (!style || style.elements.length === 0) return 'the multiline has no style';
  if (g.vertices.length < 2) return 'the multiline has fewer than two vertices';
  const n = style.elements.length;
  if (g.vertices.some((v) => v.elements.length !== n)) {
    return 'the multiline does not match its style';
  }
  return undefined;
}

/** The plane a multiline's parts keep. */
export function planarOf(g: PlanarProps): PlanarProps {
  return {
    ...(g.elevation !== undefined && g.elevation !== 0 && { elevation: g.elevation }),
    ...(g.normal !== undefined && { normal: g.normal }),
  };
}

/** Arc angles in [0, 2π), as the file has them. */
export const fileArc = <T extends EntityGeometry>(g: T): T =>
  g.kind === 'ARC'
    ? { ...g, startAngle: normalizeAngle(g.startAngle), endAngle: normalizeAngle(g.endAngle) }
    : g;

const sameColor = (a: Color, c: Color): boolean => JSON.stringify(a) === JSON.stringify(c);

/**
 * A multiline's lines and arcs and, with `fill` and its style's fill on, the solid fill first;
 * empty when it cannot be drawn (`mlineProblem`).
 */
export function mlineParts(
  g: MLineGeometry,
  model: AnnotationTables,
  options: { readonly fill: boolean },
): AnnotationPart[] {
  if (mlineProblem(g, model) !== undefined) return [];
  const style = model.tables.mlineStyles.get(g.style!)!;
  const n = style.elements.length;
  const planar = planarOf(g);
  const props = (k: number): Omit<AnnotationPart, 'geom'> => {
    const el = style.elements[k]!;
    const linetype = linetypeRef(model, el.linetype);
    return { color: el.color, ...(linetype !== undefined && { linetype }) };
  };
  const at = (v: MLineGeometry['vertices'][number], k: number): Vec2 => {
    const t = v.elements[k]!.parameters[0] ?? 0;
    return { x: v.position.x + v.miter.x * t, y: v.position.y + v.miter.y * t };
  };
  const miters = g.vertices.map((v) => style.elements.map((_, k) => at(v, k)));
  // Each segment's break parameters, element by element, from the vertex it starts at.
  const breaks = g.vertices.map((v) => v.elements.map((e) => e.parameters.slice(1)));
  const closed = (g.flags & ML_CLOSED) !== 0;
  if (closed) miters.push(miters[0]!);
  // Elements from the lowest offset (bottom) to the highest (top).
  const order = style.elements
    .map((_, k) => k)
    .sort((i, j) => style.elements[i]!.offset - style.elements[j]!.offset);
  const bottom = order[0]!;
  const top = order[n - 1]!;
  const line = (a: Vec2, c: Vec2, k: number): AnnotationPart[] =>
    a.x === c.x && a.y === c.y
      ? []
      : [{ ...props(k), geom: { kind: 'LINE', start: a, end: c, ...planar } }];
  const pieces = (a: Vec2, c: Vec2, k: number, cuts: readonly number[]): AnnotationPart[] => {
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    // [0] alone (or nothing) is the whole segment, the usual case, drawn exactly end to end.
    if (cuts.length === 0 || (cuts.length === 1 && cuts[0] === 0)) return line(a, c, k);
    if (!(len > 0)) return [];
    const ux = (c.x - a.x) / len;
    const uy = (c.y - a.y) / len;
    const point = (d: number): Vec2 =>
      d >= len ? c : d <= 0 ? a : { x: a.x + ux * d, y: a.y + uy * d };
    const out: AnnotationPart[] = [];
    for (let i = 0; i < cuts.length; i += 2) {
      const from = Math.max(0, cuts[i]!);
      const to = i + 1 < cuts.length ? Math.min(len, cuts[i + 1]!) : len;
      if (to > from) out.push(...line(point(from), point(to), k));
    }
    return out;
  };
  const joint = (m: readonly Vec2[]): AnnotationPart[] => {
    const mid = { x: (m[top]!.x + m[bottom]!.x) / 2, y: (m[top]!.y + m[bottom]!.y) / 2 };
    return [...line(m[top]!, mid, top), ...line(m[bottom]!, mid, bottom)];
  };
  const caps = (m: readonly Vec2[], from: number, to: number): AnnotationPart[] => {
    const a = m[from]!;
    const c = m[to]!;
    const center = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const radius = Math.hypot(c.x - a.x, c.y - a.y) / 2;
    if (!(radius > 0)) return [];
    const angle = Math.atan2(a.y - center.y, a.x - center.x);
    const arc = (a0: number, a1: number, k: number): AnnotationPart => ({
      ...props(k),
      geom: fileArc({ kind: 'ARC', center, radius, startAngle: a0, endAngle: a1, ...planar }),
    });
    const same = sameColor(style.elements[from]!.color, style.elements[to]!.color);
    return same
      ? [arc(angle, angle + Math.PI, from)]
      : [arc(angle, angle + Math.PI / 2, from), arc(angle + Math.PI / 2, angle + Math.PI, to)];
  };
  const out: AnnotationPart[] = [];
  const flags = style.styleFlags;
  if (options.fill && flags & MLS_FILL) {
    out.push({ geom: fillGeometry(miters, top, bottom, closed, planar), color: style.fillColor });
  }
  const first = miters[0]!;
  const last = miters[miters.length - 1]!;
  const startCaps = !closed && (g.flags & ML_NO_START_CAPS) === 0;
  const endCaps = !closed && (g.flags & ML_NO_END_CAPS) === 0;
  if (startCaps) {
    if (flags & MLS_START_SQUARE) out.push(...joint(first));
    if (flags & MLS_START_ROUND) out.push(...caps(first, top, bottom));
    if (flags & MLS_START_INNER && n > 3) out.push(...caps(first, order[n - 2]!, order[1]!));
  }
  for (let i = 1; i < miters.length; i++) {
    const cuts = breaks[i - 1]!;
    for (let k = 0; k < n; k++)
      out.push(...pieces(miters[i - 1]![k]!, miters[i]![k]!, k, cuts[k]!));
  }
  if (flags & MLS_MITER) {
    for (let i = closed ? 0 : 1; i < miters.length - 1; i++) out.push(...joint(miters[i]!));
  }
  if (endCaps) {
    if (flags & MLS_END_SQUARE) out.push(...joint(last));
    if (flags & MLS_END_ROUND) out.push(...caps(last, bottom, top));
    if (flags & MLS_END_INNER && n > 3) out.push(...caps(last, order[1]!, order[n - 2]!));
  }
  return out;
}

/**
 * The fill between the outermost elements: one loop down the bottom and back along the top, or
 * for a closed multiline the top and bottom rings, filled by odd parity so the inside stays out.
 */
function fillGeometry(
  miters: readonly (readonly Vec2[])[],
  top: number,
  bottom: number,
  closed: boolean,
  planar: PlanarProps,
): HatchGeometry {
  const ring = (k: number) => miters.slice(0, closed ? -1 : undefined).map((m) => m[k]!);
  const loop = (points: readonly Vec2[]) => ({
    // DXF 92: 1 external, 2 polyline.
    flags: 3,
    polyline: { vertices: points.map((p) => ({ x: p.x, y: p.y, bulge: 0 })), closed: true },
  });
  const loops = closed
    ? [loop(ring(bottom)), loop(ring(top))]
    : [loop([...ring(bottom), ...ring(top).reverse()])];
  return {
    kind: 'HATCH',
    pattern: 'SOLID',
    solid: true,
    associative: false,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops,
    patternLines: [],
    seedPoints: [],
    ...planar,
  };
}
