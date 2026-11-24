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
import { frameLabelPrimitives, labelWidth, type TextContext } from './text';
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
 * DIMCONSTRAINTICON's bits (M9-05 part 9; AutoCAD 2024 Help, "DIMCONSTRAINTICON (System
 * Variable)"): the lock icon beside dynamic constraints' text (1) and annotational ones' (2);
 * initially 3, both.
 */
export const LOCK_ICON_DYNAMIC = 1;
export const LOCK_ICON_ANNOTATIONAL = 2;

/** Whether DIMCONSTRAINTICON `bits` (3 when absent) gives `d` its lock icon. */
export function showsLock(d: ConstraintDisplay, bits: number | undefined): boolean {
  const bit = d.form === 'annotational' ? LOCK_ICON_ANNOTATIONAL : LOCK_ICON_DYNAMIC;
  return ((bits ?? LOCK_ICON_DYNAMIC | LOCK_ICON_ANNOTATIONAL) & bit) !== 0;
}

/**
 * What `d` draws, in `color`, at sizes `s`; its text only where a font is loaded. Without
 * `extensions`, its extension lines are left out: what a pick takes it by (M9-03 part 10), as
 * they start at the objects' points. With `lock`, a padlock before its text (M9-05 part 9).
 */
export function constraintPrimitives(
  d: ConstraintDisplay,
  s: ConstraintSizes,
  color: PrimitiveColor,
  text: TextContext | undefined,
  extensions = true,
  lock = false,
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
    const unit = lock ? labelWidth(d.label, text) : undefined;
    if (unit !== undefined) out.push(...lockPrimitives(frame, s.text, (unit * s.text) / 2, color));
  }
  return out;
}

/**
 * A padlock `h` tall (the text's height) ending a third of `h` before the text, whose label
 * runs from -`half` to `half` along `frame` and is centred on its origin: a filled body and
 * its shackle, a stroke. AutoCAD draws its lock to the left of the name; the Help shows it but
 * gives no size, so it is the text's height here, as the text keeps its size on screen.
 */
function lockPrimitives(
  frame: Affine,
  h: number,
  half: number,
  color: PrimitiveColor,
): RenderPrimitive[] {
  const at = (x: number, y: number): [number, number] => [
    frame.a * x + frame.c * y + frame.e,
    frame.b * x + frame.d * y + frame.f,
  ];
  const right = -half - h / 3;
  const width = 0.7 * h;
  const left = right - width;
  const bottom = -h / 2;
  const top = bottom + 0.55 * h;
  const body = [at(left, bottom), at(right, bottom), at(right, top), at(left, top)];
  // The shackle: two legs up from the body joined by a half circle, as a polyline.
  const r = width / 2 - 0.15 * h;
  const cx = (left + right) / 2;
  const cy = top + 0.15 * h;
  const shackle: [number, number][] = [at(cx - r, top)];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (Math.PI * i) / steps;
    shackle.push(at(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  shackle.push(at(cx + r, top));
  const path = (pts: [number, number][]) =>
    pts.flatMap(([x, y], i) => [i === 0 ? PATH_M : PATH_L, x, y]);
  return [
    { kind: 'fill', path: [...path(body), PATH_Z], color },
    { kind: 'stroke', path: path(shackle), color },
  ];
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
