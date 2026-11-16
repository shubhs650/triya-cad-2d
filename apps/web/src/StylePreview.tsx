// A style dialog's preview image (M4-03 part 3 for the Dimension Style Manager, M4-14 for the
// Text Style and Multileader Style dialogs): drawn by the drawing's renderer from the engine's
// sample drawing and shown on a `bitmaprenderer` canvas, as no 2D drawing happens outside the
// renderer. It keeps its last picture until the next one arrives; `data-drawn` holds the
// preview it shows.
import type { DimStylePreview, StylePreview as EngineStylePreview } from '@triya/engine';
import { useEffect, useRef } from 'react';
import { controllersOf } from './canvas/registry';

/** How long the preview waits for typing to pause before it is drawn again. */
const PREVIEW_DELAY_MS = 60;

export function StylePreview({
  doc,
  preview,
  size,
  testId = 'dimstyle-preview',
}: {
  doc: number;
  /** A dimension style's (no `kind`), or a text or multileader style's. */
  preview: DimStylePreview | EngineStylePreview | undefined;
  size: { readonly width: number; readonly height: number };
  testId?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = preview ? JSON.stringify(preview) : '';
  useEffect(() => {
    if (!preview) return;
    let live = true;
    const timer = setTimeout(() => {
      const controller = controllersOf(doc)[0];
      const drawn =
        'kind' in preview
          ? controller?.stylePreview(preview, size)
          : controller?.dimStylePreview(preview, size);
      void drawn?.then((bitmap) => {
        const c = canvas.current;
        if (!live || !c || !bitmap) {
          bitmap?.close();
          return;
        }
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext('bitmaprenderer')?.transferFromImageBitmap(bitmap);
        c.dataset['drawn'] = key;
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` stands for the preview's content, which is a new object each render.
  }, [doc, key, size]);
  return (
    <canvas
      ref={canvas}
      className="dimstyle-preview"
      role="img"
      aria-label="Preview"
      data-testid={testId}
      style={{ width: size.width, height: size.height }}
    />
  );
}
