// What a layout VIEWPORT shows of model space (M1-18): the map from model space to the sheet.
//
// DXF reference (VIEWPORT, and "Display coordinate system"): the view looks along the view
// direction (16) at the target (17), which is the origin of the display coordinate system
// (DCS); the view centre (12) is in DCS and the view height (45) spans the frame's height (41).
// The DCS axes follow AutoCAD's arbitrary-axis algorithm on the view direction, the same one
// OCS uses, which gives the familiar screen axes for plan and isometric views. A twist (51)
// turns the view counterclockwise on the sheet (DVIEW TWist; PLAN in a UCS rotated by θ stores
// 2π − θ). The corpus holds only untwisted plan views, so the twist sign is encoded from the
// documentation and needs a reference plot. Perspective views (flag 1) are drawn as parallel
// projections.

import type { Box } from '../geom/bounds';
import type { Matrix2D } from '../geom/transform';
import type { Vec3 } from '../geom/types';
import type { ViewportGeometry } from '../model/types';

/** DXF 90 bit 17: the viewport is turned off (MVIEW OFF). */
export const VIEWPORT_OFF = 0x20000;
/** DXF 90 bit 16: the viewport is clipped by the entity in 340 instead of its rectangle. */
export const VIEWPORT_NON_RECT_CLIP = 0x10000;

const cross = (u: Vec3, v: Vec3): Vec3 => ({
  x: u.y * v.z - u.z * v.y,
  y: u.z * v.x - u.x * v.z,
  z: u.x * v.y - u.y * v.x,
});
const dot3 = (u: Vec3, v: Vec3): number => u.x * v.x + u.y * v.y + u.z * v.z;
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** The DCS x and y axes for a view direction (arbitrary-axis algorithm), in WCS. */
function displayAxes(direction: Vec3): { x: Vec3; y: Vec3 } {
  const n =
    Math.hypot(direction.x, direction.y, direction.z) > 0 ? unit(direction) : { x: 0, y: 0, z: 1 };
  const near = Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64;
  const ax = unit(cross(near ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }, n));
  return { x: ax, y: unit(cross(n, ax)) };
}

/** Paper-space units per model unit: the frame height over the view height. */
export function viewportScale(vp: ViewportGeometry): number {
  return vp.viewHeight > 0 ? Math.abs(vp.height) / vp.viewHeight : 0;
}

/**
 * Whether the viewport draws model space: not the layout's own paper-space viewport (id 1), not
 * turned off (DXF 90 bit 0x20000) and with a frame and a view. DXF 68 is not the On switch,
 * although the DXF reference calls 0 "off": AutoCAD writes 0 for every viewport of a layout that
 * is not current, the paper-space viewport included (text_negative_extrusion.dxf, Layout1), and DWG
 * has no 68 at all; −1 (past MAXACTVP) is a screen limit Triya does not have. R12 files, which
 * have no 90, get the off bit from 68 = 0 on read (acad-ts patch 0119).
 */
export function viewportShowsModel(vp: ViewportGeometry): boolean {
  return (
    vp.id !== 1 &&
    (vp.flags & VIEWPORT_OFF) === 0 &&
    vp.width !== 0 &&
    vp.height !== 0 &&
    viewportScale(vp) > 0
  );
}

/** The model-space XY plane (z = 0) → paper space, as the viewport projects it. */
export function viewportTransform(vp: ViewportGeometry): Matrix2D {
  const s = viewportScale(vp);
  const axes = displayAxes(vp.viewDirection);
  const cs = Math.cos(vp.twist);
  const sn = Math.sin(vp.twist);
  // DCS axes turned by the twist: the view, and so the drawing, turns counterclockwise.
  const X = {
    x: cs * axes.x.x - sn * axes.y.x,
    y: cs * axes.x.y - sn * axes.y.y,
    z: cs * axes.x.z - sn * axes.y.z,
  };
  const Y = {
    x: sn * axes.x.x + cs * axes.y.x,
    y: sn * axes.x.y + cs * axes.y.y,
    z: sn * axes.x.z + cs * axes.y.z,
  };
  const t = vp.viewTarget;
  return {
    a: s * X.x,
    b: s * Y.x,
    c: s * X.y,
    d: s * Y.y,
    e: vp.center.x + s * (-dot3(X, t) - vp.viewCenter.x),
    f: vp.center.y + s * (-dot3(Y, t) - vp.viewCenter.y),
  };
}

/** The viewport's frame on the sheet. */
export function viewportFrame(vp: ViewportGeometry): Box {
  const hw = Math.abs(vp.width) / 2;
  const hh = Math.abs(vp.height) / 2;
  return {
    minX: vp.center.x - hw,
    minY: vp.center.y - hh,
    maxX: vp.center.x + hw,
    maxY: vp.center.y + hh,
  };
}
