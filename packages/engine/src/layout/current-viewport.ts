// The layout viewport made current (MSPACE, M6-02 part 3): which floating viewports a drafter
// can work in, which one MSPACE or a double click picks, and the view of model space it gives.
//
// AutoCAD 2024 Help, "MSPACE (Command)": "When you are on a named layout, you can enter MSPACE on
// the command line to make the last viewport current … You can switch to model space in a layout
// viewport by double-clicking within the viewport. You can also switch to paper space by
// double-clicking an area of paper space in the layout."
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { ViewportGeometry } from '../model/types';
import { viewportFrame, viewportShowsModel, viewportTransform } from './viewport';

/** A floating viewport of a layout's paper space, with its geometry. */
export interface FloatingViewport {
  readonly id: EntityId;
  readonly handle: Handle;
  readonly geom: ViewportGeometry;
}

/**
 * Whether model space can be worked in through the viewport: it shows model space (on, not the
 * layout's own paper-space viewport) in plan, so the cursor's point on the sheet maps to one
 * point of model space's XY plane by a turn (the view's twist, DXF 51; M6-02 part 15), a scale
 * and a move. Triya draws in plan only (DEC-061): a view from below or from the side is none to
 * work in, as its map mirrors or squashes model space.
 */
export function workableViewport(g: ViewportGeometry): boolean {
  if (!viewportShowsModel(g)) return false;
  const t = viewportTransform(g);
  const s = Math.hypot(t.a, t.b);
  // A turn and a scale: [a c; b d] = s·[cos −sin; sin cos].
  return s > 0 && Math.abs(t.a - t.d) <= s * 1e-9 && Math.abs(t.b + t.c) <= s * 1e-9;
}

/**
 * The angle model space's X axis shows at on the sheet through a workable viewport, radians
 * counterclockwise in [0, 2π): its twist (DXF 51), which AutoCAD's VIEWTWIST reports.
 */
export function viewportTwist(g: ViewportGeometry): number {
  const t = viewportTransform(g);
  const a = Math.atan2(t.b, t.a);
  return a < 0 ? a + 2 * Math.PI : a;
}

/** The layout's floating viewports one can work in, in the order its block holds them. */
export function floatingViewports(model: DocumentModel, sheet: Handle): FloatingViewport[] {
  if (!model.hasBlock(sheet)) return [];
  const out: FloatingViewport[] = [];
  for (const id of model.blockEntities(sheet)) {
    const e = model.entity(id);
    if (e?.geom.kind === 'VIEWPORT' && workableViewport(e.geom)) {
      out.push({ id, handle: e.handle, geom: e.geom });
    }
  }
  return out;
}

/** The floating viewport `handle` names in `sheet`, when one can still work in it. */
export function floatingViewport(
  model: DocumentModel,
  sheet: Handle,
  handle: Handle | undefined,
): FloatingViewport | undefined {
  if (handle === undefined) return undefined;
  const id = model.ids.idOf(handle);
  const e = id === undefined ? undefined : model.entity(id);
  if (id === undefined || e?.geom.kind !== 'VIEWPORT' || e.owner !== sheet) return undefined;
  return workableViewport(e.geom) ? { id, handle, geom: e.geom } : undefined;
}

/**
 * The viewport MSPACE makes current when none was in the layout (AutoCAD: "the last viewport"):
 * the one AutoCAD's file stacked first (the lowest positive DXF 68, which AutoCAD writes for the
 * layout it saved current), else the first the layout holds.
 */
export function firstViewport(model: DocumentModel, sheet: Handle): FloatingViewport | undefined {
  const all = floatingViewports(model, sheet);
  const stacked = all.filter((v) => v.geom.status > 0);
  if (stacked.length === 0) return all[0];
  return stacked.reduce((a, b) => (b.geom.status < a.geom.status ? b : a));
}

/** Whether the paper point lies inside the viewport's frame. */
export function insideViewport(g: ViewportGeometry, paper: Vec2): boolean {
  const f = viewportFrame(g);
  return paper.x >= f.minX && paper.x <= f.maxX && paper.y >= f.minY && paper.y <= f.maxY;
}

/** The topmost floating viewport whose frame holds the paper point, if any. */
export function viewportAt(
  model: DocumentModel,
  sheet: Handle,
  paper: Vec2,
): FloatingViewport | undefined {
  const all = floatingViewports(model, sheet);
  for (let i = all.length - 1; i >= 0; i--) {
    if (insideViewport(all[i]!.geom, paper)) return all[i];
  }
  return undefined;
}

/** A model-space point as the viewport shows it on the sheet. */
export function paperPointOf(g: ViewportGeometry, model: Vec2): Vec2 {
  const t = viewportTransform(g);
  return { x: t.a * model.x + t.c * model.y + t.e, y: t.b * model.x + t.d * model.y + t.f };
}

/** The point of model space's XY plane a workable viewport shows at a sheet point. */
export function modelPointOf(g: ViewportGeometry, paper: Vec2): Vec2 {
  const t = viewportTransform(g);
  const det = t.a * t.d - t.b * t.c;
  const x = paper.x - t.e;
  const y = paper.y - t.f;
  return { x: (t.d * x - t.c * y) / det, y: (t.a * y - t.b * x) / det };
}
