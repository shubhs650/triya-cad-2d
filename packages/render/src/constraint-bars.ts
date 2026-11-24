// Constraint bars drawn on the drawing (M9-05 part 2): the engine's `ConstraintBars` (each
// constrained object's bar, laid out from its midpoint, and the Coincident squares) as a row of
// icons on a panel, the same size on screen at any zoom, never plotted. AutoCAD 2024 Help, "About
// Displaying and Verifying Geometric Constraints": "A constraint bar displays one or more icons
// that represent the geometric constraints applied to an object", and "Coincident constraints
// display by default as small, blue squares". CBARTRANSPARENCY ("Saved in: Registry", 10 to 90,
// initially 50; "The higher value makes the constraint bars more opaque") is the panel's opacity.
//
// The icons are Triya's own glyphs, drawn on a unit square: AutoCAD's are images whose look the
// Help does not describe beyond what each constraint is.

import type {
  ConstraintBar,
  ConstraintBars,
  GeometricConstraintKind,
  Handle,
  Vec2,
} from '@triya/engine';
import type { ConstraintBarHit } from './types';
import { CONSTRAINT_BAR_BITS, constraintBarKey } from '@triya/engine';
import { PATH_A, PATH_L, PATH_M, PATH_Z, type PrimitiveColor, type RenderPrimitive } from './types';

/** A bar's sizes on screen, CSS pixels (AutoCAD documents none; ours). */
export const CONSTRAINT_BAR_PX = {
  /** An icon's square. */
  icon: 16,
  /** The panel's margin round the icons, and the space between two. */
  pad: 2,
  /** How far the panel sits off its object's midpoint. */
  offset: 6,
  /** A Coincident square's side. */
  mark: 6,
} as const;

/** How the bars show: which kinds, the colours, the panel's opacity. */
export interface ConstraintBarLook {
  /** CONSTRAINTBARMODE: the kinds of constraint the bars show (bits of `CONSTRAINT_BAR_BITS`). */
  readonly mode: number;
  /** The icons' and squares' colour. */
  readonly color: PrimitiveColor;
  /** The panel's colour. */
  readonly panel: PrimitiveColor;
  /** CBARTRANSPARENCY as an opacity, 0.1 to 0.9. */
  readonly opacity: number;
}

/** A glyph's strokes on the unit square centred on the origin, y up. */
type Glyph = readonly (readonly number[])[];

const line = (x0: number, y0: number, x1: number, y1: number) => [PATH_M, x0, y0, PATH_L, x1, y1];
const circle = (x: number, y: number, r: number) => [
  PATH_M,
  x + r,
  y,
  PATH_A,
  x,
  y,
  r,
  0,
  2 * Math.PI,
  1,
];
const arc = (x: number, y: number, r: number, a0: number, a1: number) => [
  PATH_M,
  x + r * Math.cos(a0),
  y + r * Math.sin(a0),
  PATH_A,
  x,
  y,
  r,
  a0,
  a1,
  a1 > a0 ? 1 : 0,
];

/** Each kind's glyph: what the constraint makes of its objects. */
export const CONSTRAINT_GLYPHS: Readonly<Record<GeometricConstraintKind, Glyph>> = {
  horizontal: [line(-0.4, 0, 0.4, 0), line(-0.4, -0.15, -0.4, 0.15), line(0.4, -0.15, 0.4, 0.15)],
  vertical: [line(0, -0.4, 0, 0.4), line(-0.15, -0.4, 0.15, -0.4), line(-0.15, 0.4, 0.15, 0.4)],
  perpendicular: [line(-0.4, -0.35, 0.4, -0.35), line(0, -0.35, 0, 0.4)],
  parallel: [line(-0.35, -0.4, 0.05, 0.4), line(-0.05, -0.4, 0.35, 0.4)],
  tangent: [circle(0, -0.12, 0.28), line(-0.42, 0.16, 0.42, 0.16)],
  smooth: [arc(-0.2, 0, 0.2, Math.PI, 0), arc(0.2, 0, 0.2, Math.PI, 2 * Math.PI)],
  coincident: [
    [PATH_M, -0.2, -0.2, PATH_L, 0.2, -0.2, PATH_L, 0.2, 0.2, PATH_L, -0.2, 0.2, PATH_Z],
  ],
  concentric: [circle(0, 0, 0.38), circle(0, 0, 0.15)],
  collinear: [line(-0.42, -0.42, -0.08, -0.08), line(0.08, 0.08, 0.42, 0.42)],
  symmetric: [
    [PATH_M, -0.2, 0.4, PATH_L, -0.4, 0.4, PATH_L, -0.4, -0.4, PATH_L, -0.2, -0.4],
    [PATH_M, 0.2, 0.4, PATH_L, 0.4, 0.4, PATH_L, 0.4, -0.4, PATH_L, 0.2, -0.4],
    line(0, -0.45, 0, -0.2),
    line(0, -0.1, 0, 0.1),
    line(0, 0.2, 0, 0.45),
  ],
  equal: [line(-0.35, 0.15, 0.35, 0.15), line(-0.35, -0.15, 0.35, -0.15)],
  fix: [
    [PATH_M, -0.3, -0.42, PATH_L, 0.3, -0.42, PATH_L, 0.3, 0.05, PATH_L, -0.3, 0.05, PATH_Z],
    arc(0, 0.05, 0.2, 0, Math.PI),
  ],
};

/** `glyph`'s strokes scaled by `size` about `at`. */
function placeGlyph(glyph: Glyph, at: Vec2, size: number): number[][] {
  return glyph.map((path) => {
    const out: number[] = [];
    for (let i = 0; i < path.length;) {
      const op = path[i]!;
      out.push(op);
      if (op === PATH_M || op === PATH_L) {
        out.push(at.x + path[i + 1]! * size, at.y + path[i + 2]! * size);
        i += 3;
      } else if (op === PATH_A) {
        out.push(
          at.x + path[i + 1]! * size,
          at.y + path[i + 2]! * size,
          path[i + 3]! * size,
          path[i + 4]!,
          path[i + 5]!,
          path[i + 6]!,
        );
        i += 7;
      } else i += 1;
    }
    return out;
  });
}

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  PATH_M,
  x0,
  y0,
  PATH_L,
  x1,
  y0,
  PATH_L,
  x1,
  y1,
  PATH_L,
  x0,
  y1,
  PATH_Z,
];

/**
 * Where the drafter dragged bars (M9-05 part 6), by `constraintBarKey`: each one's offset in CSS
 * pixels, y down, from where it is laid out. AutoCAD 2024 Help, "About Displaying and Verifying
 * Geometric Constraints", lets a bar be dragged; it does not say whether a dragged bar keeps its
 * place in the drawing or beside its object. Triya keeps it beside its object, as the bars are
 * the same size on screen at any zoom: the same offset in pixels from its object's midpoint
 * whatever the zoom, and following the object as it moves.
 */
export type ConstraintBarMoves = ReadonlyMap<string, { readonly x: number; readonly y: number }>;

const NOT_MOVED: ConstraintBarMoves = new Map();

const movedOf = (bar: ConstraintBar, moved: ConstraintBarMoves) =>
  moved.size === 0 ? undefined : moved.get(constraintBarKey(bar.entity, bar.segment));

/** A bar's icons shown under CONSTRAINTBARMODE `mode`. */
export function barIcons(bar: ConstraintBar, mode: number): ConstraintBar['icons'] {
  return bar.icons.filter((i) => (mode & CONSTRAINT_BAR_BITS[i.kind]) !== 0);
}

/**
 * Where a bar of `n` icons sits for a view of `scale` CSS pixels per drawing unit: its panel's
 * corners and each icon's centre, in drawing units, the panel off its object's midpoint on the
 * bar's side, a row across the screen; `moved` (CSS pixels, y down) from there when dragged.
 */
export function barBox(
  bar: ConstraintBar,
  n: number,
  scale: number,
  moved?: { readonly x: number; readonly y: number },
): { min: Vec2; max: Vec2; icons: Vec2[] } {
  const k = 1 / scale;
  const { icon, pad, offset } = CONSTRAINT_BAR_PX;
  const w = (n * icon + (n + 1) * pad) * k;
  const h = (icon + 2 * pad) * k;
  // Far enough along the side that the panel's nearest edge is `offset` off the midpoint.
  const reach = offset * k + Math.abs(bar.side.x) * (w / 2) + Math.abs(bar.side.y) * (h / 2);
  const c = {
    x: bar.anchor.x + bar.side.x * reach + (moved ? moved.x * k : 0),
    y: bar.anchor.y + bar.side.y * reach - (moved ? moved.y * k : 0),
  };
  const min = { x: c.x - w / 2, y: c.y - h / 2 };
  const icons = Array.from({ length: n }, (_, i) => ({
    x: min.x + (pad + i * (icon + pad) + icon / 2) * k,
    y: c.y,
  }));
  return { min, max: { x: c.x + w / 2, y: c.y + h / 2 }, icons };
}

/**
 * What the bars `shown` draw (those whose object, or polyline, `visible` names) at a view of
 * `scale`: each bar's panel, framed, then its icons, where `moved` says those dragged are; each
 * Coincident square.
 */
export function constraintBarPrimitives(
  bars: ConstraintBars,
  visible: (entity: Handle) => boolean,
  scale: number,
  look: ConstraintBarLook,
  moved: ConstraintBarMoves = NOT_MOVED,
): RenderPrimitive[] {
  const out: RenderPrimitive[] = [];
  const k = 1 / scale;
  const opacity = look.opacity < 1 ? { opacity: look.opacity } : {};
  for (const bar of bars.bars) {
    if (!visible(bar.entity)) continue;
    const icons = barIcons(bar, look.mode);
    if (icons.length === 0) continue;
    const box = barBox(bar, icons.length, scale, movedOf(bar, moved));
    const frame = rect(box.min.x, box.min.y, box.max.x, box.max.y);
    out.push({ kind: 'fill', path: frame, color: look.panel, ...opacity });
    out.push({ kind: 'stroke', path: frame, color: look.color, ...opacity });
    // The glyph inside its square, a margin round it.
    const size = (CONSTRAINT_BAR_PX.icon - 4) * k;
    icons.forEach((i, n) => {
      for (const path of placeGlyph(CONSTRAINT_GLYPHS[i.kind], box.icons[n]!, size)) {
        out.push({ kind: 'stroke', path, color: look.color });
      }
    });
  }
  if ((look.mode & CONSTRAINT_BAR_BITS.coincident) !== 0) {
    const half = (CONSTRAINT_BAR_PX.mark / 2) * k;
    for (const m of bars.marks) {
      if (!m.entities.some(visible)) continue;
      out.push({
        kind: 'fill',
        path: rect(m.at.x - half, m.at.y - half, m.at.x + half, m.at.y + half),
        color: look.color,
      });
    }
  }
  return out;
}

/**
 * What of the bars `visible` shows lies under `p` (drawing units) at a view of `scale`, under
 * CONSTRAINTBARMODE `mode` (M9-05 part 4): a Coincident square's constraint (drawn over the
 * bars, so found first), else an icon's, else a bar's panel alone; undefined over none. AutoCAD
 * 2024 Help, "About Displaying and Verifying Geometric Constraints": "When you roll over a
 * constraint icon … the associated objects are highlighted" and the icon has a shortcut menu.
 */
export function constraintBarAt(
  bars: ConstraintBars,
  visible: (entity: Handle) => boolean,
  scale: number,
  mode: number,
  p: Vec2,
  moved: ConstraintBarMoves = NOT_MOVED,
): ConstraintBarHit | undefined {
  const k = 1 / scale;
  if ((mode & CONSTRAINT_BAR_BITS.coincident) !== 0) {
    const half = (CONSTRAINT_BAR_PX.mark / 2) * k;
    for (let i = bars.marks.length - 1; i >= 0; i--) {
      const m = bars.marks[i]!;
      if (!m.entities.some(visible)) continue;
      if (Math.abs(p.x - m.at.x) <= half && Math.abs(p.y - m.at.y) <= half) {
        return { constraint: m.handle, kind: 'coincident', entities: m.entities };
      }
    }
  }
  // The bar drawn last is on top.
  for (let b = bars.bars.length - 1; b >= 0; b--) {
    const bar = bars.bars[b]!;
    if (!visible(bar.entity)) continue;
    const icons = barIcons(bar, mode);
    if (icons.length === 0) continue;
    const box = barBox(bar, icons.length, scale, movedOf(bar, moved));
    if (p.x < box.min.x || p.x > box.max.x || p.y < box.min.y || p.y > box.max.y) continue;
    const at = bar.segment === undefined ? {} : { segment: bar.segment };
    // Each icon's square, half the gap between two either side of it.
    const reach = ((CONSTRAINT_BAR_PX.icon + CONSTRAINT_BAR_PX.pad) / 2) * k;
    const n = box.icons.findIndex((c) => Math.abs(p.x - c.x) < reach);
    // The panel's outer margins are no icon's.
    const inside = n >= 0 && Math.abs(p.x - box.icons[n]!.x) <= (CONSTRAINT_BAR_PX.icon / 2) * k;
    const icon = inside ? icons[n] : undefined;
    if (!icon) return { entity: bar.entity, ...at, entities: [bar.entity] };
    return {
      entity: bar.entity,
      ...at,
      constraint: icon.handle,
      kind: icon.kind,
      entities: icon.entities,
    };
  }
  return undefined;
}

/**
 * The frames round what `hit` names (M9-05 part 4): each icon of its constraint on the bars
 * shown, or its Coincident square, in `color`; none for a bar's panel alone.
 */
export function constraintBarHoverPrimitives(
  bars: ConstraintBars,
  visible: (entity: Handle) => boolean,
  scale: number,
  mode: number,
  hit: ConstraintBarHit,
  color: PrimitiveColor,
  moved: ConstraintBarMoves = NOT_MOVED,
): RenderPrimitive[] {
  const out: RenderPrimitive[] = [];
  if (hit.constraint === undefined) return out;
  const k = 1 / scale;
  const half = (CONSTRAINT_BAR_PX.icon / 2) * k;
  for (const bar of bars.bars) {
    if (!visible(bar.entity)) continue;
    const icons = barIcons(bar, mode);
    const n = icons.findIndex((i) => i.handle === hit.constraint);
    if (n < 0) continue;
    const c = barBox(bar, icons.length, scale, movedOf(bar, moved)).icons[n]!;
    out.push({ kind: 'stroke', path: rect(c.x - half, c.y - half, c.x + half, c.y + half), color });
  }
  if ((mode & CONSTRAINT_BAR_BITS.coincident) !== 0) {
    // A pixel round the square, so the frame shows beside its fill.
    const r = (CONSTRAINT_BAR_PX.mark / 2 + 1) * k;
    for (const m of bars.marks) {
      if (m.handle !== hit.constraint || !m.entities.some(visible)) continue;
      out.push({
        kind: 'stroke',
        path: rect(m.at.x - r, m.at.y - r, m.at.x + r, m.at.y + r),
        color,
      });
    }
  }
  return out;
}
