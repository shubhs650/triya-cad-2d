// ZOOM options and named views as view functions (M1-22 part 2), and the views a drawing was
// saved in (part 3). The navigation bar calls them now; the ZOOM and VIEW commands will when
// the command line arrives (M2-01).
import {
  unionBox,
  type Box,
  type EntityInit,
  type Handle,
  type Vec3,
  type ViewParams,
  type ViewRecord,
  type ViewportGeometry,
  type VportRecord,
} from '@triya/engine';
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

/**
 * ZOOM n (no X): `factor` relative to the limits, about the current view's centre. 1 shows the
 * limits' whole height or width, whichever fits, as ZOOM All of the limits alone would (without
 * its margin); 2 shows half that. Undefined without limits or a usable factor.
 */
export function limitsView(
  limits: Box | undefined,
  size: ViewportSize,
  factor: number,
  current: ViewTransform | undefined,
): ViewTransform | undefined {
  if (!valid(limits) || !(factor > 0) || !Number.isFinite(factor)) return undefined;
  const fit = fitView(limits, size.width, size.height, 0);
  return { center: current?.center ?? fit.center, scale: fit.scale * factor };
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
  if (!isPlan(view.direction, view.twist)) return undefined;
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

/**
 * Looking straight down +Z without a twist, the only views a 2D transform can show. Files
 * store the direction at any length (geoloc.dxf: 484.29) and with rounding noise in X and Y
 * (uncommon.dxf: -7.8e-14), so the test is relative to its length.
 */
function isPlan(d: Vec3, twist: number): boolean {
  const len = Math.hypot(d.x, d.y, d.z);
  return (
    d.z > 0 &&
    Math.abs(d.x) <= 1e-9 * len &&
    Math.abs(d.y) <= 1e-9 * len &&
    Math.abs(twist) <= 1e-12
  );
}

const isActive = (v: VportRecord) => v.name.toUpperCase() === '*ACTIVE';

/**
 * The model-space view a drawing was saved in: the `*Active` VPORT. Several of them make a
 * tiled-viewport configuration (`modelTiles`), and the DXF reference says the first is the
 * current viewport.
 */
export function activeVport(vports: readonly VportRecord[] | undefined): VportRecord | undefined {
  return vports?.find(isActive);
}

/** A tile's part of the window as fractions of its width and height, from the top left. */
export interface TileRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One tiled model-space viewport: the `*Active` VPORT it opens in and where it sits. */
export interface ModelTile {
  readonly vport: VportRecord | undefined;
  readonly rect: TileRect;
}

const WHOLE: TileRect = { left: 0, top: 0, width: 1, height: 1 };

/**
 * A corner stored this far outside the window (in fractions of it) is rounding, clipped to the
 * window; further out, the tile is not in the window.
 */
const RECT_SLACK = 1e-6;

/**
 * The tiled model-space viewports a drawing was saved with (M1-22 part 4): every `*Active`
 * VPORT in table order, the first being the current one, each in its part of the window. DXF
 * 10/11 give its lower-left and upper-right corners as fractions of the drawing area with the
 * origin at the lower left (AutoCAD DXF reference, VPORT), so the top is 1 less the upper
 * corner's Y. A tile with no area or outside the window is left out; when the current one is,
 * or fewer than two are left, the current viewport fills the window alone, as a single
 * viewport always does whatever corners it states.
 */
export function modelTiles(vports: readonly VportRecord[] | undefined): readonly ModelTile[] {
  const active = vports?.filter(isActive) ?? [];
  const placed: ModelTile[] = [];
  for (const vport of active) {
    const rect = tileRect(vport);
    if (rect) placed.push({ vport, rect });
    else if (placed.length === 0) break;
  }
  if (placed.length < 2) return [{ vport: active[0], rect: WHOLE }];
  return placed;
}

function tileRect(v: VportRecord): TileRect | undefined {
  const { lowerLeft: ll, upperRight: ur } = v;
  if (![ll?.x, ll?.y, ur?.x, ur?.y].every(Number.isFinite)) return undefined;
  const inside = (n: number) => n >= -RECT_SLACK && n <= 1 + RECT_SLACK;
  if (![ll.x, ll.y, ur.x, ur.y].every(inside)) return undefined;
  const clip = (n: number) => Math.min(Math.max(n, 0), 1);
  const x0 = clip(ll.x);
  const y0 = clip(ll.y);
  const x1 = clip(ur.x);
  const y1 = clip(ur.y);
  if (!(x1 - x0 > RECT_SLACK) || !(y1 - y0 > RECT_SLACK)) return undefined;
  return { left: x0, top: 1 - y1, width: x1 - x0, height: y1 - y0 };
}

/**
 * A space's saved view at its centre and height: `height` world units fill the window's
 * height and the width follows the window, as VIEWSIZE ("the height of the view displayed in
 * the current viewport") stays when AutoCAD's window changes shape. The VPORT's aspect ratio
 * is the window it was saved from, so it is not used. Undefined when there is nothing to show.
 */
function heightView(
  center: { readonly x: number; readonly y: number },
  height: number,
  size: ViewportSize,
): ViewTransform | undefined {
  if (!(height > 0) || !Number.isFinite(height) || !(size.height > 0)) return undefined;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return undefined;
  return { center: { x: center.x, y: center.y }, scale: size.height / height };
}

/**
 * Model space as the drawing was saved: the VPORT's centre (display coordinates, so plus
 * the target in a plan view) and height. A 3D or twisted view, which a 2D transform cannot
 * show, is left to the caller (Zoom Extents).
 */
export function savedModelView(
  vport: ViewParams | undefined,
  size: ViewportSize,
): ViewTransform | undefined {
  if (!vport || !isPlan(vport.direction, vport.twist)) return undefined;
  const center = { x: vport.center.x + vport.target.x, y: vport.center.y + vport.target.y };
  return heightView(center, vport.height, size);
}

/**
 * A layout's own paper-space viewport (DXF 69 id 1), which holds the layout's paper-space
 * view. AutoCAD makes it the first time a layout is shown, so a layout never shown has none.
 */
export function paperSpaceViewport(
  entities: readonly EntityInit[] | undefined,
  layoutBlock: Handle,
): ViewportGeometry | undefined {
  for (const e of entities ?? []) {
    if (e.owner === layoutBlock && e.geom.kind === 'VIEWPORT' && e.geom.id === 1) return e.geom;
  }
  return undefined;
}

/**
 * A layout as it was saved: its paper-space viewport's view centre and height (DXF 12 / 45).
 * Paper space is a plan view, and the viewport's frame (10 / 41) is the same window, so the
 * frame stands in when the view is not stated (acad-ts reads none from an R14 DWG). ezdxf
 * writes the frame at (0, 0) beside a stated view, so the view comes first.
 */
export function paperSpaceView(
  vp: ViewportGeometry | undefined,
  size: ViewportSize,
): ViewTransform | undefined {
  if (!vp) return undefined;
  if (vp.viewHeight > 0) return heightView(vp.viewCenter, vp.viewHeight, size);
  return heightView(vp.center, vp.height, size);
}
