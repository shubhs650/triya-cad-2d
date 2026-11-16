// The Dimension Style Manager's preview image (M4-03 part 3). The engine makes the preview
// drawing (`dimStylePreviewModel`: a plate dimensioned in the style); it is drawn here as any
// drawing is, by a Canvas2DRenderer of its own on a layer the size of the dialog's picture, in
// the fonts and display style of the drawing's canvas, fitted to what it draws with a margin, on
// the canvas background (ACI 7 follows it). The picture is handed back as an ImageBitmap, as a
// thumbnail is, so the dialog never draws with Canvas 2D itself.
import {
  SpatialIndex,
  dimStylePreviewModel,
  type DimStylePreview,
  type DocumentModel,
  type Tolerance,
} from '@triya/engine';
import { dimensionParts } from '@triya/dims';
import { Canvas2DRenderer, type Surface } from './canvas2d';
import { textMeasure, type TextContext } from './text';
import { textBounds } from './text-bounds';
import type { BitmapFactory } from './thumbnail';
import type { RenderStyle } from './types';

/** The picture's size in CSS pixels and the device pixel ratio it is drawn at. */
export interface PreviewSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

/** The share of the picture the sample fills, the rest a margin around it. */
const FILL = 0.9;

export interface PreviewContext {
  readonly model: DocumentModel;
  readonly text: TextContext;
  readonly style: RenderStyle;
  readonly createLayer: () => Surface;
  /** The drawing's tolerance: the sample is drawn at the size of its dimension text. */
  readonly tol: Tolerance;
}

/**
 * The preview of `preview` in `c.model`'s styles as a bitmap of `size`; undefined when the
 * drawing has nothing to show it with (no model space, a style it lacks) or the size is empty.
 */
export function dimStylePreviewImage(
  c: PreviewContext,
  preview: DimStylePreview,
  size: PreviewSize,
  createBitmap: BitmapFactory | undefined = globalThis.createImageBitmap?.bind(globalThis),
): Promise<ImageBitmap | undefined> {
  const drawn = drawDimStylePreview(c, preview, size);
  if (!drawn || !createBitmap) return Promise.resolve(undefined);
  return createBitmap(drawn.image, {});
}

/** The preview drawn on a new layer of `size` (device pixels), or undefined. */
export function drawDimStylePreview(
  c: PreviewContext,
  preview: DimStylePreview,
  size: PreviewSize,
): Surface | undefined {
  if (!(size.width > 0 && size.height > 0 && size.dpr > 0)) return undefined;
  const model = dimStylePreviewModel(c.model, preview);
  if (!model) return undefined;
  const space = [...model.tables.blockRecords.values()].find(
    (r) => r.name.toUpperCase() === '*MODEL_SPACE',
  )!.handle;
  const text: TextContext = { fonts: c.text.fonts, style: (h) => model.tables.textStyles.get(h) };
  const index = SpatialIndex.build(model, {
    tol: c.tol,
    annotationBounds: textBounds(text),
    measureText: textMeasure(text),
    dimensionParts,
  });
  const box = index.drawnExtents(space);
  if (!box) return undefined;
  const scene = c.createLayer();
  const renderer = new Canvas2DRenderer({
    model,
    index,
    block: space,
    surface: scene,
    createLayer: c.createLayer,
    style: c.style,
    fonts: c.text.fonts,
    // Drawn once, at once: nothing waits for an idle moment.
    requestIdle: () => {},
  });
  renderer.resize(size.width, size.height, size.dpr);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const scale = Math.min(
    w > 0 ? (size.width * FILL) / w : Infinity,
    h > 0 ? (size.height * FILL) / h : Infinity,
  );
  renderer.setView({
    center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    scale: Number.isFinite(scale) ? scale : 1,
  });
  renderer.frame();
  // The renderer leaves its background to the canvas element; the picture carries its own.
  const out = c.createLayer();
  out.canvas.width = scene.canvas.width;
  out.canvas.height = scene.canvas.height;
  out.ctx.setTransform(1, 0, 0, 1, 0, 0);
  out.ctx.fillStyle = c.style.background;
  out.ctx.fillRect(0, 0, out.canvas.width, out.canvas.height);
  out.ctx.drawImage(scene.image, 0, 0);
  return out;
}
