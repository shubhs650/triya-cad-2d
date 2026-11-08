// Pictures of spaces not shown yet (M1-22 close-out). AutoCAD's file tab preview pictures
// every layout of a drawing, opened or not; a space's own canvas is made the first time it
// shows, so a layout not shown yet is pictured by a canvas made only for the picture: the
// same controller and renderer, drawn once in its opening view off screen at the drawing
// area's size, copied and thrown away.
import type { CanvasController } from './controller';

/** How long a picture may take before the preview keeps its stand-in. */
const PICTURE_TIMEOUT_MS = 30_000;

export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The first frame of a canvas made by `make` inside an off-screen box of `area` CSS pixels,
 * fitted inside `max` CSS pixels; undefined when it fails or takes too long. `cancelled`
 * stops it early (the preview closed), between steps.
 */
export async function pictureOf(
  make: (container: HTMLElement) => CanvasController,
  area: PictureSize,
  max: PictureSize,
  cancelled: () => boolean = () => false,
): Promise<ImageBitmap | undefined> {
  if (area.width <= 0 || area.height <= 0) return undefined;
  const stage = document.createElement('div');
  stage.className = 'picture-stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.inert = true;
  stage.style.width = `${area.width}px`;
  stage.style.height = `${area.height}px`;
  document.body.append(stage);
  let controller: CanvasController | undefined;
  try {
    controller = make(stage);
    // The controller opens the space in its saved view, or at its extents once measured,
    // and tells of each frame drawn; the first is the picture.
    const drawn = await firstFrame(controller.canvas, PICTURE_TIMEOUT_MS);
    if (!drawn || cancelled()) return undefined;
    return await controller.thumbnail(max);
  } catch {
    return undefined;
  } finally {
    controller?.dispose();
    stage.remove();
  }
}

function firstFrame(canvas: HTMLCanvasElement, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    canvas.addEventListener(
      'framedrawn',
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}
