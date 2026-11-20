// The view a current layout viewport shows (M6-02 part 4): ZOOM, PAN, the wheel and real-time
// navigation in a viewport made current change that viewport's own view, its view centre (DXF 12)
// and view height (45), and so its scale on the sheet, as AutoCAD's do ("ZOOM (Command)": "In a
// layout viewport ... zooming changes the view in the current viewport"). The frame stays where
// it is. A viewport whose display is locked keeps its view: AutoCAD zooms paper space then
// ("Viewport display locking ... prevents the scale from being changed"), which the canvas does.
import type { Vec2 } from '../geom/types';
import type { ViewportGeometry } from '../model/types';
import { workableViewport } from './current-viewport';
import { VIEWPORT_LOCKED, viewportScale, viewportTransform } from './viewport';

/**
 * A viewport's view in model space: the point at the middle of its frame and the model units its
 * frame shows from bottom to top (VIEWCTR and VIEWSIZE in AutoCAD's MSPACE).
 */
export interface ViewportView {
  readonly center: Vec2;
  readonly height: number;
}

/** The viewport's view as model space has it. Valid for a workable (plan, untwisted) viewport. */
export function viewportViewOf(g: ViewportGeometry): ViewportView {
  const t = viewportTransform(g);
  return {
    center: { x: (g.center.x - t.e) / t.a, y: (g.center.y - t.f) / t.d },
    height: g.viewHeight,
  };
}

/**
 * The viewport showing `view`: its view height, and its view centre moved so the frame's middle
 * shows `view.center`. The view centre is in display coordinates, which differ from model space's
 * by the target (17); moving it by the sheet distance over the scale keeps that offset.
 */
export function withViewportView(g: ViewportGeometry, view: ViewportView): ViewportGeometry {
  const s = viewportScale(g);
  const t = viewportTransform(g);
  const shown = { x: t.a * view.center.x + t.e, y: t.d * view.center.y + t.f };
  return {
    ...g,
    viewCenter: {
      x: g.viewCenter.x + (shown.x - g.center.x) / s,
      y: g.viewCenter.y + (shown.y - g.center.y) / s,
    },
    viewHeight: view.height,
  };
}

/** Whether the viewport's display is locked (MVIEW Lock, DXF 90 bit 15). */
export function viewportLocked(g: ViewportGeometry): boolean {
  return (g.flags & VIEWPORT_LOCKED) !== 0;
}

/** Why the viewport's view cannot be changed to `view`, if it cannot. */
export function viewportViewProblem(g: ViewportGeometry, view: ViewportView): string | undefined {
  if (!workableViewport(g)) return 'The viewport cannot be worked in.';
  if (viewportLocked(g)) return 'The viewport display is locked.';
  const finite = [view.center.x, view.center.y, view.height].every(Number.isFinite);
  if (!finite || !(view.height > 0)) return 'Invalid view.';
  return undefined;
}
