// Canvas surfaces for the renderer: a visible canvas (HTML or transferred offscreen) and the
// offscreen layers it composites (scene cache, transient layer).

import type { Canvas2D, Surface } from './canvas2d';

interface ContextSource {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
}

/** The surface for a canvas the renderer draws into. */
export function surfaceOf(canvas: ContextSource): Surface {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return { canvas, ctx: ctx as Canvas2D, image: canvas as unknown as CanvasImageSource };
}

/**
 * An offscreen layer. OffscreenCanvas wherever it exists (workers and modern main threads), so
 * the worker and the main-thread fallback composite identical layers; a detached `<canvas>`
 * only on browsers without it.
 */
export function offscreenLayer(): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return surfaceOf(new OffscreenCanvas(1, 1));
  return surfaceOf(document.createElement('canvas'));
}
