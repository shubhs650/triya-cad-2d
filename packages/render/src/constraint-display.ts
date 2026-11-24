// Dimensional constraints drawn on the drawing (M9-03 part 4): the engine's `ConstraintDisplay`
// (the points measured, the dimension line, arc or leader, the text and where it goes) as
// strokes, filled arrowheads and text. AutoCAD 2024 Help, "About Applying Dimensional
// Constraints": a dynamic constraint keeps "the same size when zooming in or out" and is not
// plotted; an annotational one is sized as a dimension (its dimension style). Sizes are given
// here in drawing units: the renderer works out a dynamic constraint's from pixels at the
// view's scale each time the scene is drawn, an annotational one's from the drawing's DIMVARs.

import type { ConstraintDisplay, ConstraintShape, Vec2 } from '@triya/engine';
import type { Affine } from './affine';
import type { Paint } from './tessellate';
import { frameLabelPrimitives, type TextContext } from './text';
import { PATH_A, PATH_L, PATH_M, PATH_Z, type PrimitiveColor, type RenderPrimitive } from './types';

/** A constraint's sizes, in drawing units. */
export interface ConstraintSizes {
  /** The text's height. */
  readonly text: number;
  /** An arrowhead's length. */
  readonly arrow: number;
  /** The gap between a point measured and its extension line (DIMEXO). */
  readonly offset: number;
  /** How far an extension line runs past the dimension line (DIMEXE). */
  readonly extend: number;
  /** The gap between the dimension line and its text (DIMGAP). */
  readonly gap: number;
}

/** A dynamic constraint's sizes on screen, CSS pixels (AutoCAD documents no size; ours). */
export const DYNAMIC_CONSTRAINT_PX: ConstraintSizes = {
  text: 9,
  arrow: 10,
  offset: 3,
  extend: 5,
  gap: 3,
};

/** `px` sized for a view showing `scale` CSS pixels per drawing unit. */
export function sizesAt(px: ConstraintSizes, scale: number): ConstraintSizes {
  const k = 1 / scale;
  return {
    text: px.text * k,
    arrow: px.arrow * k,
    offset: px.offset * k,
    extend: px.extend * k,
    gap: px.gap * k,
  };
}

/**
 * An annotational constraint's sizes: the drawing's DIMTXT, DIMASZ, DIMEXO, DIMEXE and DIMGAP
 * times DIMSCALE (0 counting as 1), AutoCAD's imperial defaults where the header has none.
 */
export function annotationalSizes(header: ReadonlyMap<string, unknown>): ConstraintSizes {
  const num = (name: string, fallback: number) => {
    const v = header.get(name);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const scale = num('$DIMSCALE', 1) || 1;
  return {
    text: num('$DIMTXT', 0.18) * scale,
    arrow: num('$DIMASZ', 0.18) * scale,
    offset: num('$DIMEXO', 0.0625) * scale,
    extend: num('$DIMEXE', 0.18) * scale,
    gap: Math.abs(num('$DIMGAP', 0.09)) * scale,
  };
}

/**
 * What `d` draws, in `color`, at sizes `s`; its text only where a font is loaded. Without
 * `extensions`, its extension lines are left out: what a pick takes it by (M9-03 part 10), as
 * they start at the objects' points.
 */
export function constraintPrimitives(
  d: ConstraintDisplay,
  s: ConstraintSizes,
  color: PrimitiveColor,
  text: TextContext | undefined,
  extensions = true,
): RenderPrimitive[] {
  const out: RenderPrimitive[] = [];
  const stroke = (path: number[]) => out.push({ kind: 'stroke', path, color });
  const arrow = (tip: Vec2, from: Vec2) => {
    const len = Math.hypot(tip.x - from.x, tip.y - from.y);
    if (!(len > 0)) return;
    const u = { x: (tip.x - from.x) / len, y: (tip.y - from.y) / len };
    const w = s.arrow / 6;
    const bx = tip.x - u.x * s.arrow;
    const by = tip.y - u.y * s.arrow;
    out.push({
      kind: 'fill',
      path: [
        PATH_M,
        tip.x,
        tip.y,
        PATH_L,
        bx - u.y * w,
        by + u.x * w,
        PATH_L,
        bx + u.y * w,
        by - u.x * w,
        PATH_Z,
      ],
      color,
    });
  };
  drawShape(d.shape, s, stroke, arrow, extensions);
  if (text) {
    const c = Math.cos(d.textAngle);
    const sn = Math.sin(d.textAngle);
    // Centred above the line: the label's middle a gap and half its height off it.
    const up = s.gap + s.text / 2;
    const frame: Affine = {
      a: c,
      b: sn,
      c: -sn,
      d: c,
      e: d.textAt.x - sn * up,
      f: d.textAt.y + c * up,
    };
    const paint: Paint = { color };
    out.push(...frameLabelPrimitives(d.label, frame, s.text, paint, text));
  }
  return out;
}

function drawShape(
  shape: ConstraintShape,
  s: ConstraintSizes,
  stroke: (path: number[]) => void,
  arrow: (tip: Vec2, from: Vec2) => void,
  extensions: boolean,
): void {
  const line = (p: Vec2, q: Vec2) => stroke([PATH_M, p.x, p.y, PATH_L, q.x, q.y]);
  /** An extension line from `p` to `q`, starting `offset` off `p` and running `extend` past `q`. */
  const extension = (p: Vec2, q: Vec2) => {
    if (!extensions) return;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (!(len > s.offset)) return;
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    line(
      { x: p.x + u.x * s.offset, y: p.y + u.y * s.offset },
      { x: q.x + u.x * s.extend, y: q.y + u.y * s.extend },
    );
  };
  switch (shape.kind) {
    case 'linear': {
      extension(shape.a, shape.da);
      extension(shape.b, shape.db);
      line(shape.da, shape.db);
      arrow(shape.da, shape.db);
      arrow(shape.db, shape.da);
      return;
    }
    case 'angular': {
      const { center: c, radius: r, start, sweep } = shape;
      for (const [p, q] of shape.extensions) extension(p, q);
      stroke([
        PATH_M,
        c.x + r * Math.cos(start),
        c.y + r * Math.sin(start),
        PATH_A,
        c.x,
        c.y,
        r,
        start,
        start + sweep,
        1,
      ]);
      // Each arrow points along the arc's tangent at its end, from a chord one arrow long.
      const at = (a: number) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
      const step = r > 0 ? Math.min(s.arrow / r, sweep / 2) : 0;
      arrow(at(start), at(start + step));
      arrow(at(start + sweep), at(start + sweep - step));
      return;
    }
    case 'radial': {
      const { center: c, radius: r, angle, reach } = shape;
      const u = { x: Math.cos(angle), y: Math.sin(angle) };
      const on = { x: c.x + r * u.x, y: c.y + r * u.y };
      if (shape.diameter) {
        const across = { x: c.x - r * u.x, y: c.y - r * u.y };
        line(across, { x: c.x + reach * u.x, y: c.y + reach * u.y });
        arrow(across, c);
      } else line(c, { x: c.x + reach * u.x, y: c.y + reach * u.y });
      arrow(on, c);
      return;
    }
  }
}
