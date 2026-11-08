// The raster image test drawing (M1-19 part 3), authored here (Rule 0, DEC-047, in place of the
// owner sample M1-64): three bitmaps written byte by byte, and an AC1032 DXF showing them.
// `pnpm fixtures:raster` writes them to packages/testkit/fixtures/raster/, where the app spec
// (tests/e2e/ui/raster-images.spec.ts) and the fixture golden images
// (tests/e2e/fidelity/fixtures.spec.ts) read them; fixture.test.ts keeps the files in step.
//
// Bitmaps:
//   checker.png  8 × 8 RGBA, quadrants red (top left), green (top right), blue (bottom left)
//                and clear (bottom right): colour and alpha through the browser's PNG codec.
//   bars.bmp     6 × 4 24-bit, bottom-up rows: six vertical bars black, red, yellow, green, cyan,
//                magenta, through Triya's own BMP decoder.
//   scan.tif     16 × 8 one bit, uncompressed, BlackIsZero: a black X on white, a bitonal image
//                (drawn in the IMAGE's colour) through UTIF.js.
//
// The drawing, one unit a grid square:
//   A  checker.png at (0, 0), 0.5 a pixel, transparency on: the clear quadrant shows the canvas.
//   B  bars.bmp at (6, 0), 0.75 a pixel, turned 30°, brightness 60 and contrast 70, clipped by
//      a triangle.
//   C  checker.png at (0, 6), 0.5 a pixel, fade 60, with an inverted rectangular clip.
//   D  scan.tif at (6, 6), 0.25 a pixel, red (ACI 1), transparency on.
//   E  site-photo.jpg at (12, 0), never supplied: its frame only.
//   F  checker.png at (12, 6) through a definition saved unloaded: its frame only.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  ClipMode,
  ClipType,
  Color,
  ImageDefinition,
  RasterImage,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';
import { encodePng } from '../fidelity/compare';

export const RASTER_DXF_NAME = 'raster-images.dxf';
export const CHECKER_PNG = 'checker.png';
export const BARS_BMP = 'bars.bmp';
export const SCAN_TIF = 'scan.tif';
/** The file image E names, which is never supplied. */
export const MISSING_JPG = 'site-photo.jpg';

/** Image B's clip triangle, in its pixel coordinates (V down from the top edge). */
export const BARS_CLIP: readonly { x: number; y: number }[] = [
  { x: -0.5, y: 3.5 },
  { x: 5.5, y: 3.5 },
  { x: 2.5, y: -0.5 },
];

/** Image C's inverted clip: the middle 4 × 4 pixels are cut out. */
export const CHECKER_HOLE: readonly { x: number; y: number }[] = [
  { x: 1.5, y: 1.5 },
  { x: 5.5, y: 5.5 },
];

type Rgba = readonly [number, number, number, number];

/** checker.png's pixel at column x, row y (top first). */
export function checkerPixel(x: number, y: number): Rgba {
  const top = y < 4;
  const left = x < 4;
  if (top) return left ? [255, 0, 0, 255] : [0, 255, 0, 255];
  return left ? [0, 0, 255, 255] : [0, 0, 0, 0];
}

export function checkerPng(): Uint8Array {
  const data = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) data.set(checkerPixel(x, y), (y * 8 + x) * 4);
  }
  return encodePng({ width: 8, height: 8, data });
}

export const BAR_COLOURS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
];

/** A 6 × 4 24-bit BMP (BITMAPINFOHEADER, rows bottom-up, each padded to 4 bytes). */
export function barsBmp(): Uint8Array {
  const w = 6;
  const h = 4;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = BAR_COLOURS[x]!;
      out.set([b, g, r], 54 + y * row + x * 3);
    }
  }
  return out;
}

/** scan.tif's pixel at column x, row y (top first): true where the X is (black). */
export function scanInk(x: number, y: number): boolean {
  const d = x / 2;
  return Math.abs(d - y) < 0.75 || Math.abs(d - (7 - y)) < 0.75;
}

/** A 16 × 8 one-bit TIFF, little-endian, uncompressed, BlackIsZero, one strip. */
export function scanTif(): Uint8Array {
  const w = 16;
  const h = 8;
  const row = w / 8;
  const tags: [tag: number, type: 3 | 4, value: number][] = [
    [256, 3, w],
    [257, 3, h],
    [258, 3, 1],
    [259, 3, 1],
    [262, 3, 1],
    [273, 4, 0], // the strip's offset, set below
    [277, 3, 1],
    [278, 3, h],
    [279, 4, row * h],
  ];
  const ifd = 8;
  const data = ifd + 2 + tags.length * 12 + 4;
  tags[5]![2] = data;
  const out = new Uint8Array(data + row * h);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0]);
  v.setUint32(4, ifd, true);
  v.setUint16(ifd, tags.length, true);
  tags.forEach(([tag, type, value], i) => {
    const at = ifd + 2 + i * 12;
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, 1, true);
    if (type === 3) v.setUint16(at + 8, value, true);
    else v.setUint32(at + 8, value, true);
  });
  // BlackIsZero: a 1 bit is white, so the X is the 0 bits.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!scanInk(x, y)) out[data + y * row + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return out;
}

interface Placement {
  readonly at: readonly [number, number];
  /** Drawing units a pixel. */
  readonly pixel: number;
  readonly angle?: number;
}

/** The AC1032 DXF showing images A–F. */
export function rasterDxf(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadImageDict)!;
  const define = (name: string, file: string, w: number, h: number, loaded = true) => {
    const def = new ImageDefinition(name);
    def.fileName = `.\\images\\${file}`;
    def.size = new XY(w, h);
    def.defaultSize = new XY(1, 1);
    def.isLoaded = loaded;
    dict.add(def);
    return def;
  };
  const checker = define('checker', CHECKER_PNG, 8, 8);
  const bars = define('bars', BARS_BMP, 6, 4);
  const scan = define('scan', SCAN_TIF, 16, 8);
  const photo = define('site-photo', MISSING_JPG, 40, 30);
  const unloaded = define('checker-unloaded', CHECKER_PNG, 8, 8, false);

  const place = (def: ImageDefinition, p: Placement, flags: number): RasterImage => {
    const im = new RasterImage();
    doc.entities!.add(im);
    im.definition = def;
    const a = p.angle ?? 0;
    im.insertPoint = new XYZ(p.at[0], p.at[1], 0);
    im.uVector = new XYZ(p.pixel * Math.cos(a), p.pixel * Math.sin(a), 0);
    im.vVector = new XYZ(-p.pixel * Math.sin(a), p.pixel * Math.cos(a), 0);
    im.size = new XY(def.size.x, def.size.y);
    im.flags = flags as never;
    im.clipType = ClipType.Rectangular;
    im.clipBoundaryVertices = [new XY(-0.5, -0.5), new XY(def.size.x - 0.5, def.size.y - 0.5)];
    return im;
  };
  // DXF 70: 1 show image, 2 show when not aligned with the screen, 4 use the clip boundary,
  // 8 transparency on.
  place(checker, { at: [0, 0], pixel: 0.5 }, 1 | 2 | 8);

  const b = place(bars, { at: [6, 0], pixel: 0.75, angle: Math.PI / 6 }, 1 | 2 | 4);
  b.brightness = 60;
  b.contrast = 70;
  b.clippingState = true;
  b.clipType = ClipType.Polygonal;
  b.clipBoundaryVertices = BARS_CLIP.map((p) => new XY(p.x, p.y));

  const c = place(checker, { at: [0, 6], pixel: 0.5 }, 1 | 2 | 4);
  c.fade = 60;
  c.clippingState = true;
  c.clipMode = ClipMode.Inside;
  c.clipBoundaryVertices = CHECKER_HOLE.map((p) => new XY(p.x, p.y));

  const d = place(scan, { at: [6, 6], pixel: 0.25 }, 1 | 2 | 8);
  d.color = new Color(1);

  place(photo, { at: [12, 0], pixel: 0.1 }, 1 | 2);
  place(unloaded, { at: [12, 6], pixel: 0.5 }, 1 | 2);
  return writeCadDocument(doc, { format: 'dxf' });
}
