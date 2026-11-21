// ZOOM and PAN in a layout viewport made current (M6-02 part 4): the viewport's frame on the
// canvas is treated as a window of its own, so the canvas's view maths (ZOOM Window, Extents,
// All, Scale, the wheel, real-time PAN and ZOOM) apply to it unchanged. Its "view" is model space
// at the frame's middle and the frame's height in CSS pixels over the view height (DXF 45);
// what that gives back becomes the viewport's own view, which the engine saves in the drawing.
import {
  viewportFrame,
  viewportTwist,
  viewportViewOf,
  withViewportView,
  type Box,
  type Handle,
  type ViewportGeometry,
  type ViewportView,
} from '@triya/engine';
import { worldToScreen, type ViewTransform } from '@triya/render';
import { HISTORY_LIMIT } from './views';
import type { ViewportSize } from './navigate';

/** The viewport's frame on the canvas, in CSS pixels: its size and its top-left corner. */
export interface FrameOnCanvas {
  readonly size: ViewportSize;
  readonly left: number;
  readonly top: number;
}

/** Where the viewport's frame is on a canvas of `canvas` size showing the sheet in `sheet`. */
export function frameOnCanvas(
  g: ViewportGeometry,
  sheet: ViewTransform,
  canvas: ViewportSize,
): FrameOnCanvas {
  const f = viewportFrame(g);
  const topLeft = worldToScreen(sheet, canvas.width, canvas.height, { x: f.minX, y: f.maxY });
  return {
    size: { width: (f.maxX - f.minX) * sheet.scale, height: (f.maxY - f.minY) * sheet.scale },
    left: topLeft.x,
    top: topLeft.y,
  };
}

/**
 * The viewport's own view as a view of its frame of `size` pixels, turned by its twist (M6-02
 * part 15): the frame's own axes are the sheet's, along which ZOOM and PAN measure.
 */
export function frameView(g: ViewportGeometry, size: ViewportSize): ViewTransform {
  const v = viewportViewOf(g);
  const rotation = viewportTwist(g);
  return { center: v.center, scale: size.height / v.height, ...(rotation !== 0 && { rotation }) };
}

/** A point of model space turned by `angle` about the origin. */
function turn(p: { readonly x: number; readonly y: number }, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** The box holding `box`'s corners, each taken through `t`. */
export function turnedBox(
  box: Box,
  t: (p: { x: number; y: number }) => { x: number; y: number },
): Box {
  const ps = [
    t({ x: box.minX, y: box.minY }),
    t({ x: box.maxX, y: box.minY }),
    t({ x: box.maxX, y: box.maxY }),
    t({ x: box.minX, y: box.maxY }),
  ];
  return {
    minX: Math.min(...ps.map((p) => p.x)),
    minY: Math.min(...ps.map((p) => p.y)),
    maxX: Math.max(...ps.map((p) => p.x)),
    maxY: Math.max(...ps.map((p) => p.y)),
  };
}

/**
 * A view fitted to what a frame turned by `rotation` (a twisted viewport's, M6-02 part 15) shows:
 * `fit` takes model points and boxes through `t`, into the frame's own axes, so a window or an
 * extents box fills the frame as the screen shows it; its centre comes back in model space.
 */
export function fitTurned(
  rotation: number,
  fit: (t: (p: { x: number; y: number }) => { x: number; y: number }) => ViewTransform | undefined,
): ViewTransform | undefined {
  if (rotation === 0) return fit((p) => p);
  const v = fit((p) => turn(p, -rotation));
  return v && { ...v, center: turn(v.center, rotation), rotation };
}

/** A view of the frame of `size` pixels as the viewport's own view. */
export function viewportViewFrom(view: ViewTransform, size: ViewportSize): ViewportView {
  return { center: view.center, height: size.height / view.scale };
}

/**
 * A viewport maximized (VPMAX, M6-02 part 7): framed by the whole canvas of `canvas` size showing
 * the sheet in `sheet`, and showing `view`, else what its own frame showed: its model space
 * across the frame fitted to the canvas about the same point, as AutoCAD expands the viewport
 * "to fill the screen". Only the canvas draws it so; the drawing keeps the viewport as it is.
 */
export function maximizedGeometry(
  g: ViewportGeometry,
  sheet: ViewTransform,
  canvas: ViewportSize,
  view?: ViewportView,
): ViewportGeometry {
  const own = viewportViewOf(g);
  const ownWidth = (own.height * Math.abs(g.width)) / Math.abs(g.height);
  const fit = view ?? {
    center: own.center,
    height: Math.max(own.height, (ownWidth * canvas.height) / canvas.width),
  };
  const framed = {
    ...g,
    center: sheet.center,
    width: canvas.width / sheet.scale,
    height: canvas.height / sheet.scale,
  };
  return withViewportView(framed, fit);
}

/** Whether two viewport views are the same. */
export function sameViewportView(a: ViewportView, b: ViewportView): boolean {
  return a.center.x === b.center.x && a.center.y === b.center.y && a.height === b.height;
}

/**
 * ZOOM Previous of each layout viewport: AutoCAD keeps the last ten views of each viewport, a
 * floating viewport's apart from the sheet's.
 */
export class ViewportHistories {
  readonly #views = new Map<Handle, ViewportView[]>();

  /** Records the view `viewport` is leaving. */
  push(viewport: Handle, view: ViewportView): void {
    let views = this.#views.get(viewport);
    if (!views) this.#views.set(viewport, (views = []));
    const last = views.at(-1);
    if (last && sameViewportView(last, view)) return;
    views.push(view);
    if (views.length > HISTORY_LIMIT) views.shift();
  }

  /** The view before, taken off; undefined with none left. */
  previous(viewport: Handle): ViewportView | undefined {
    return this.#views.get(viewport)?.pop();
  }
}
