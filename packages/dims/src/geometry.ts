// What every dimension type draws with: vectors, arrowheads, the text and the text's box, and
// the clipping that keeps dimension lines and arcs out of that box.

import type {
  AnnotationPart,
  AnnotationTables,
  EntityGeometry,
  Handle,
  MTextGeometry,
  TextMeasure,
  Vec2,
} from '@triya/engine';
import type { DimStyle, PartProps } from './style';

/** One thing a dimension draws; `defpoint` POINTs go on the DEFPOINTS layer. */
export interface DimPart extends AnnotationPart {
  readonly defpoint?: true;
}

export const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const perp = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });
export const fromAngle = (a: number): Vec2 => ({ x: Math.cos(a), y: Math.sin(a) });
export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export function unit(v: Vec2): Vec2 | undefined {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : undefined;
}

const TWO_PI = 2 * Math.PI;
export const normAngle = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

/**
 * A text angle turned to read left to right or bottom to top, as AutoCAD keeps dimension text:
 * within (−90°, 90°].
 */
export function upright(a: number): number {
  let t = normAngle(a);
  if (t > Math.PI / 2 + 1e-9 && t <= (3 * Math.PI) / 2 + 1e-9) t -= Math.PI;
  return t > Math.PI ? t - TWO_PI : t;
}

export function linePart(a: Vec2, b: Vec2, props: PartProps): DimPart {
  return { ...props, geom: { kind: 'LINE', start: a, end: b } };
}

export const defpoint = (p: Vec2): DimPart => ({
  geom: { kind: 'POINT', position: p },
  defpoint: true,
});

/** Arrowhead blocks drawn about the tip: the dimension line runs to the tip, and DIMDLE applies. */
const DRAWN_AT_TIP = new Set([
  '_archtick',
  '_oblique',
  '_dotsmall',
  '_small',
  '_integral',
  '_none',
]);

/** Whether the arrowhead `block` is drawn about the tip (ticks are; closed filled is not). */
export function atTip(block: Handle | undefined, s: DimStyle, model: AnnotationTables): boolean {
  if (s.tsz > 0) return true;
  if (block === undefined) return false;
  const name = model.blocks.get(block)?.name.toLowerCase();
  return name !== undefined && DRAWN_AT_TIP.has(name);
}

/**
 * The arrowhead at `tip` whose back is towards `base` (a size away, along the line or the
 * arc): a tick stroke when DIMTSZ is set, else the block, else closed filled, a SOLID AutoCAD
 * writes as base + n, base − n, tip, tip with n a sixth of the size across the dimension line.
 */
export function arrowParts(
  tip: Vec2,
  base: Vec2,
  block: Handle | undefined,
  s: DimStyle,
  model: AnnotationTables,
  dimLineDir: Vec2,
): DimPart[] {
  const back = unit(sub(base, tip));
  if (!back) return [];
  // Arrowheads take the dimension line's colour and lineweight but not its linetype.
  const { linetype: _linetype, ...props } = s.dimLine;
  if (s.tsz > 0) {
    // DIMTSZ: an oblique stroke through the tip at 45° to the dimension line, DIMTSZ along
    // and across it either side (the `_OBLIQUE` block at twice DIMTSZ).
    const d = add(dimLineDir, perp(dimLineDir));
    return [linePart(add(tip, d, -s.tsz), add(tip, d, s.tsz), s.dimLine)];
  }
  if (!(s.asz > 0)) return [];
  if (block !== undefined && model.blocks.get(block)) {
    const geom: EntityGeometry = {
      kind: 'INSERT',
      block,
      position: tip,
      scale: { x: s.asz, y: s.asz, z: s.asz },
      rotation: angleOf({ x: -back.x, y: -back.y }),
      attributes: [],
    };
    return [{ ...props, geom }];
  }
  // AutoCAD writes the base corners across the dimension line's own direction.
  const n = perp(dimLineDir);
  const k = s.asz / 6;
  return [
    {
      ...props,
      geom: { kind: 'SOLID', corners: [add(base, n, k), add(base, n, -k), tip, tip] },
    },
  ];
}

/** The dimension text as AutoCAD writes it: an MTEXT about its middle (attachment 5). */
export function textGeometry(
  contents: string,
  position: Vec2,
  rotation: number,
  s: DimStyle,
): MTextGeometry {
  // Text centred on the dimension line is written vertically centred (`\A1;`).
  const fill =
    s.fill.mode === 1
      ? { background: { flags: 3, scale: 1.25 } }
      : s.fill.mode === 2 && s.fill.color
        ? { background: { flags: 1, color: s.fill.color, scale: 1.25 } }
        : {};
  return {
    kind: 'MTEXT',
    contents,
    style: s.textStyle ?? '',
    position,
    height: s.textHeight,
    width: 0,
    rotation,
    attachment: 5,
    direction: 1,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    ...fill,
  };
}

/** The text's box widened by DIMGAP: what dimension lines and arcs stay out of. */
export interface TextBox {
  readonly center: Vec2;
  readonly dir: Vec2;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export function textBox(text: MTextGeometry, width: number, s: DimStyle): TextBox {
  return {
    center: text.position,
    dir: fromAngle(text.rotation),
    halfWidth: width / 2 + s.gap,
    halfHeight: s.textHeight / 2 + s.gap,
  };
}

/** `p` in the box's frame. */
function local(box: TextBox, p: Vec2): Vec2 {
  const d = sub(p, box.center);
  return { x: dot(d, box.dir), y: dot(d, perp(box.dir)) };
}

/** Strictly inside, so a line the box only touches (text above it) stays whole. */
export function inBox(box: TextBox, p: Vec2): boolean {
  const q = local(box, p);
  const eps = 1e-9 * (box.halfWidth + box.halfHeight);
  return Math.abs(q.x) < box.halfWidth - eps && Math.abs(q.y) < box.halfHeight - eps;
}

/** The parts of segment a→b outside the box (Liang–Barsky in the box's frame). */
export function clipSegment(a: Vec2, b: Vec2, box: TextBox | undefined): [Vec2, Vec2][] {
  if (!box) return [[a, b]];
  const p = local(box, a);
  const q = local(box, b);
  const d = sub(q, p);
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-d.x, p.x + box.halfWidth],
    [d.x, box.halfWidth - p.x],
    [-d.y, p.y + box.halfHeight],
    [d.y, box.halfHeight - p.y],
  ];
  for (const [pk, qk] of edges) {
    if (pk === 0) {
      if (qk <= 0) return [[a, b]];
      continue;
    }
    const t = qk / pk;
    if (pk < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (t0 >= t1 || !inBox(box, lerp(a, b, (t0 + t1) / 2))) return [[a, b]];
  const out: [Vec2, Vec2][] = [];
  if (t0 > 1e-12) out.push([a, lerp(a, b, t0)]);
  if (t1 < 1 - 1e-12) out.push([lerp(a, b, t1), b]);
  return out;
}

/** The parts of the arc (counter-clockwise from `start` to `end`) outside the box. */
export function clipArc(
  center: Vec2,
  r: number,
  start: number,
  end: number,
  box: TextBox | undefined,
): [number, number][] {
  const sweep = normAngle(end - start) || TWO_PI;
  if (!box) return [[start, start + sweep]];
  // Where the circle crosses the box's edges, as sweeps from `start`.
  const cuts: number[] = [0, sweep];
  const c = local(box, center);
  const edge = (fixed: number, vertical: boolean, half: number) => {
    // Points on the circle with x (vertical edge) or y fixed in the box frame.
    const off = fixed - (vertical ? c.x : c.y);
    if (Math.abs(off) > r) return;
    const other = Math.sqrt(r * r - off * off);
    for (const o of [other, -other]) {
      const along = (vertical ? c.y : c.x) + o;
      if (Math.abs(along) > half + 1e-12) continue;
      const lx = vertical ? off : o;
      const ly = vertical ? o : off;
      // Back to the drawing frame's angle.
      const a = angleOf(add({ x: box.dir.x * lx, y: box.dir.y * lx }, perp(box.dir), ly));
      const t = normAngle(a - start);
      if (t > 0 && t < sweep) cuts.push(t);
    }
  };
  edge(box.halfWidth, true, box.halfHeight);
  edge(-box.halfWidth, true, box.halfHeight);
  edge(box.halfHeight, false, box.halfWidth);
  edge(-box.halfHeight, false, box.halfWidth);
  cuts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    if (b - a < 1e-12) continue;
    const mid = start + (a + b) / 2;
    if (inBox(box, add(center, fromAngle(mid), r))) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - (start + a)) < 1e-12) last[1] = start + b;
    else out.push([start + a, start + b]);
  }
  return out;
}

export function arcPart(
  center: Vec2,
  r: number,
  from: number,
  to: number,
  props: PartProps,
): DimPart {
  return {
    ...props,
    geom: { kind: 'ARC', center, radius: r, startAngle: normAngle(from), endAngle: normAngle(to) },
  };
}

/** The text's width as the renderer lays it out, or undefined while its font is not loaded. */
export function widthOf(text: MTextGeometry, measure: TextMeasure): number | undefined {
  return measure(text);
}
