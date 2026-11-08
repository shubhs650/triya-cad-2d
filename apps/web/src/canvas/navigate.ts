// View maths for real-time zoom and pan (M1-22). Pure functions of a ViewTransform, so the
// canvas controller only feeds them pointer and wheel input.
import type { Box } from '@triya/engine';
import { fitView, screenToWorld, type ViewTransform } from '@triya/render';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Zoom per wheel notch. AutoCAD's ZOOMFACTOR (3–100, default 60) sets the wheel's step, but
 * its documentation gives no formula from the value to a factor, so 1.25 per notch is our
 * choice for the default (not measured against AutoCAD); ZOOMFACTOR itself comes with the
 * system variables (M2-01).
 */
export const WHEEL_STEP = 1.25;

/** CSS pixels a browser reports for one wheel notch (`deltaMode` 0). */
const PIXELS_PER_NOTCH = 100;
/** Lines a browser reports for one notch (`deltaMode` 1, Firefox). */
const LINES_PER_NOTCH = 3;

/**
 * The zoom factor for a wheel event. Rolling forward (negative `deltaY`) zooms in, as with
 * AutoCAD's default ZOOMWHEEL 0. Pixel deltas from trackpads give fractions of a notch.
 */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const notches =
    deltaMode === 0
      ? deltaY / PIXELS_PER_NOTCH
      : deltaMode === 1
        ? deltaY / LINES_PER_NOTCH
        : Math.sign(deltaY);
  return WHEEL_STEP ** -notches;
}

/** Zooms by `factor` (above 1 zooms in) keeping the world point under `screen` still. */
export function zoomAt(
  view: ViewTransform,
  size: ViewportSize,
  screen: { readonly x: number; readonly y: number },
  factor: number,
): ViewTransform {
  if (!(factor > 0) || !Number.isFinite(factor)) return view;
  const anchor = screenToWorld(view, size.width, size.height, screen);
  const scale = view.scale * factor;
  return {
    scale,
    center: {
      x: anchor.x - (screen.x - size.width / 2) / scale,
      y: anchor.y + (screen.y - size.height / 2) / scale,
    },
  };
}

/** Moves the drawing by a pointer movement of (dx, dy) CSS pixels, y down. */
export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return {
    scale: view.scale,
    center: { x: view.center.x - dx / view.scale, y: view.center.y + dy / view.scale },
  };
}

/**
 * Zoom Extents: the extents fitted with a 5 % margin each side. An empty drawing shows the
 * origin at a scale that puts about 100 units across the window.
 */
export function extentsView(extents: Box | undefined, size: ViewportSize): ViewTransform {
  if (!extents) return { center: { x: 0, y: 0 }, scale: Math.max(size.width, 1) / 100 };
  return fitView(extents, size.width, size.height);
}

/**
 * Real-time ZOOM: dragging from the window's middle to its top edge zooms in 2x, to the bottom
 * edge out 2x (AutoCAD 2024 Help, "ZOOM (Command)": "drag from the midpoint of the window to the
 * top edge to zoom in by 100%").
 */
export function realtimeZoomFactor(dy: number, height: number): number {
  return height > 0 ? 2 ** (-dy / (height / 2)) : 1;
}
