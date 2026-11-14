// Another app's picture pasted (M2-54, DEC-056). AutoCAD's PASTECLIP pastes a picture from the
// Windows clipboard as an embedded OLE object (AutoCAD 2024 Help, "PASTECLIP"). Triya pastes it
// as a raster IMAGE instead: an OLE2FRAME's data is a Windows OLE compound object, which Triya can
// neither draw nor write in a form it could check, while an IMAGE and its IMAGEDEF are what every
// DXF reader draws, and Triya draws, saves and reopens them already (M1-19, M1-75 part 13). The
// app keeps the picture as a PNG file on this device, under the name the IMAGEDEF gives (DEC-056).
//
// Its size is the picture's own: its pixels at the resolution its file states, else 96 to the
// inch (the CSS pixel, a screenshot's), in the drawing's INSUNITS; a unitless drawing takes
// inches or millimetres by MEASUREMENT, as AutoCAD sizes an image whose file states a resolution
// in a unitless drawing. Its lower-left corner goes to the insertion point, as IMAGEATTACH
// places one (AutoCAD's help does not say which corner of a pasted OLE object it is).
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Entity, ImageDefinition, ImageGeometry } from '../model/types';
import type { GeneralProps } from '../properties/sheet';
import { insUnitsOf, metresPerUnit } from '../model/units';

/** A picture another app put on the system clipboard, as the app kept it. */
export interface ClipboardPicture {
  /** The file the app keeps the picture as (`pasted-1a2b3c4d.png`): the IMAGEDEF's file name. */
  readonly fileName: string;
  /** Its size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Pixels per inch along X and Y, as its file states them; absent: 96. */
  readonly ppi?: Vec2;
}

/** The CSS pixel: what a picture whose file states no resolution is taken at. */
const SCREEN_PPI = 96;
const INCH = 0.0254;
/** IMAGEDEF DXF 281: the resolution unit, inches. */
const RESOLUTION_INCHES = 5;

/** Whether the picture has pixels to paste. */
export function hasPixels(p: ClipboardPicture): boolean {
  return p.width >= 1 && p.height >= 1 && Number.isFinite(p.width) && Number.isFinite(p.height);
}

/** The picture's pixels per inch, X and Y: its file's, else 96. */
function ppiOf(p: ClipboardPicture): Vec2 {
  const ok = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v > 0;
  return ok(p.ppi?.x) && ok(p.ppi?.y) ? p.ppi! : { x: SCREEN_PPI, y: SCREEN_PPI };
}

/** Drawing units in an inch: by INSUNITS, or by MEASUREMENT in a unitless drawing. */
function unitsPerInch(model: DocumentModel): number {
  const metres = metresPerUnit(insUnitsOf(model));
  if (metres !== undefined) return INCH / metres;
  const m = model.header.get('$MEASUREMENT');
  const metric = typeof m === 'number' ? m === 1 : model.meta.measurement === 'metric';
  return metric ? 25.4 : 1;
}

/** One pixel's width and height in the drawing's units. */
export function pixelSizeOf(model: DocumentModel, p: ClipboardPicture): Vec2 {
  const ppi = ppiOf(p);
  const k = unitsPerInch(model);
  return { x: k / ppi.x, y: k / ppi.y };
}

/** The picture's frame with its lower-left corner at `at`: what PASTECLIP drags. */
export function pictureFrame(model: DocumentModel, p: ClipboardPicture, at: Vec2): Vec2[] {
  const px = pixelSizeOf(model, p);
  const w = px.x * p.width;
  const h = px.y * p.height;
  return [at, { x: at.x + w, y: at.y }, { x: at.x + w, y: at.y + h }, { x: at.x, y: at.y + h }];
}

const baseName = (fileName: string): string =>
  fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || 'picture';

/**
 * The drawing's IMAGEDEF for the picture's file (its name, case aside), or a new one filed as a
 * paste files one (edit/clipboard.ts): under the drawing's image dictionary, else where its
 * images' definitions are, else a new dictionary the save creates under a new handle. A new
 * one's name is the file's without its extension, numbered when the drawing has it already.
 */
function pictureDefinition(b: ChangeSetBuilder, model: DocumentModel, p: ClipboardPicture): Handle {
  const file = p.fileName.toLowerCase();
  const names = new Set<string>();
  let owner: Handle | undefined = model.meta.imageDictionary;
  for (const o of b.objects()) {
    if (o.type !== 'IMAGEDEF') continue;
    const d = o as ImageDefinition;
    if (d.fileName.toLowerCase() === file) return d.handle;
    names.add(d.name.toUpperCase());
    owner ??= d.owner;
  }
  const base = baseName(p.fileName);
  let name = base;
  for (let n = 1; names.has(name.toUpperCase()); n++) name = `${base}-${n}`;
  owner ??= b.allocateHandle();
  const ppi = ppiOf(p);
  const def: ImageDefinition = {
    type: 'IMAGEDEF',
    handle: b.allocateHandle(),
    owner,
    name,
    fileName: p.fileName,
    size: { x: p.width, y: p.height },
    pixelSize: { x: 1 / ppi.x, y: 1 / ppi.y },
    loaded: true,
    units: RESOLUTION_INCHES,
  };
  b.adoptObject(def);
  return def.handle;
}

/**
 * PASTECLIP of a picture: an IMAGE of it in `owner` with its lower-left corner at `at` and
 * `props` (the drawing's current settings), showing the drawing's IMAGEDEF for its file or a new
 * one. Returns the image.
 */
export function pastePicture(
  b: ChangeSetBuilder,
  model: DocumentModel,
  p: ClipboardPicture,
  owner: Handle,
  at: Vec2,
  props: GeneralProps,
): Entity {
  const definition = pictureDefinition(b, model, p);
  const px = pixelSizeOf(model, p);
  const geom: ImageGeometry = {
    kind: 'IMAGE',
    definition,
    position: at,
    u: { x: px.x, y: 0 },
    v: { x: 0, y: px.y },
    size: { x: p.width, y: p.height },
    // Show, show unaligned, use clip boundary: AutoCAD's 7 for an attached image, unclipped.
    displayFlags: 7,
    clipping: false,
    brightness: 50,
    contrast: 50,
    fade: 0,
    // The whole picture, in pixel coordinates centred on pixels (image-render-facts).
    clip: {
      type: 'rectangle',
      vertices: [
        { x: -0.5, y: -0.5 },
        { x: p.width - 0.5, y: p.height - 0.5 },
      ],
      inverted: false,
    },
  };
  return b.addEntity({ owner, ...props, geom });
}
