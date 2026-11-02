// ZOOM options and named views as view functions (M1-22 part 2). The navigation bar calls them
// now; the ZOOM and VIEW commands will when the command line arrives (M2-01).
import { unionBox, type Box, type ViewRecord } from '@triya/engine';
import { fitView, type ViewTransform } from '@triya/render';
import type { ViewportSize } from './navigate';

const valid = (b: Box | undefined): b is Box =>
  b !== undefined && b.minX <= b.maxX && b.minY <= b.maxY;

/** ZOOM Window: the box between two corners fills the window, with no margin. */
export function windowView(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  size: ViewportSize,
): ViewTransform | undefined {
  const box = {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
  if (!(box.maxX > box.minX) || !(box.maxY > box.minY)) return undefined;
  return fitView(box, size.width, size.height, 0);
}

/**
 * ZOOM All: the drawing limits or the extents, whichever reaches further (AutoCAD shows the
 * union of the two), with Zoom Extents' margin.
 */
export function allView(
  limits: Box | undefined,
  extents: Box | undefined,
  size: ViewportSize,
): ViewTransform {
  const box =
    valid(limits) && valid(extents) ? unionBox(limits, extents) : valid(limits) ? limits : extents;
  if (!valid(box)) return { center: { x: 0, y: 0 }, scale: Math.max(size.width, 1) / 100 };
  return fitView(box, size.width, size.height);
}

/** ZOOM Scale nX: `factor` times the current magnification, about the view's centre. */
export function scaleView(view: ViewTransform, factor: number): ViewTransform {
  if (!(factor > 0) || !Number.isFinite(factor)) return view;
  return { center: view.center, scale: view.scale * factor };
}

/** AutoCAD keeps the last ten views of each viewport for ZOOM Previous. */
export const HISTORY_LIMIT = 10;

/** The views ZOOM Previous steps back through. */
export class ViewHistory {
  readonly #views: ViewTransform[] = [];

  /** Records the view being left. */
  push(view: ViewTransform): void {
    const last = this.#views.at(-1);
    if (last && sameView(last, view)) return;
    this.#views.push(view);
    if (this.#views.length > HISTORY_LIMIT) this.#views.shift();
  }

  previous(): ViewTransform | undefined {
    return this.#views.pop();
  }
}

const sameView = (a: ViewTransform, b: ViewTransform): boolean =>
  a.scale === b.scale && a.center.x === b.center.x && a.center.y === b.center.y;

/**
 * VIEW restore of a saved view: its width and height fitted into the window around its centre.
 * The centre is in display coordinates, which for a plan view are world XY less the target.
 * A view looking anywhere but straight down, or twisted, needs a rotated view this 2D
 * transform cannot express, so it is not restorable yet.
 */
export function namedView(view: ViewRecord, size: ViewportSize): ViewTransform | undefined {
  const d = view.direction;
  const plan = Math.abs(d.x) < 1e-12 && Math.abs(d.y) < 1e-12 && d.z > 0;
  if (!plan || Math.abs(view.twist) > 1e-12) return undefined;
  if (!(view.width > 0) || !(view.height > 0)) return undefined;
  const cx = view.center.x + view.target.x;
  const cy = view.center.y + view.target.y;
  const box = {
    minX: cx - view.width / 2,
    minY: cy - view.height / 2,
    maxX: cx + view.width / 2,
    maxY: cy + view.height / 2,
  };
  return { center: { x: cx, y: cy }, scale: fitView(box, size.width, size.height, 0).scale };
}
