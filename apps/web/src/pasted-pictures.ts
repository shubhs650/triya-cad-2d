// Pictures pasted from other apps (M2-54, DEC-056). PASTECLIP pastes a picture as a raster
// IMAGE whose IMAGEDEF names a PNG file; the drawing holds no pixels, so the app keeps the file
// on this device (PRD §9: in the origin-private file system, never uploaded) under that name.
// The image draws as soon as it is pasted, and again whenever a drawing naming the file opens on
// this device, in this visit or a later one. Elsewhere the file has to come with the drawing, as
// any image's does: the References palette names it as not found until it is supplied.
//
// The file's name is the picture's: `pasted-` and the first 8 hex digits of its SHA-256, so the
// same picture pasted again is the same file (and the same IMAGEDEF), and pictures from
// different pastes never take each other's place.
import type { ClipboardPicture } from '@triya/engine';

/** What a PNG states of itself: its size, and its resolution when it gives one. */
export interface PngInfo {
  readonly width: number;
  readonly height: number;
  /** Pixels per inch along X and Y, from its pHYs chunk when that is in metres. */
  readonly ppi?: { readonly x: number; readonly y: number };
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const INCH = 0.0254;

const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

const chunkType = (b: Uint8Array, at: number): string =>
  String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/**
 * The PNG's size from its IHDR chunk and its resolution from its pHYs chunk (PNG specification
 * §11.2.2, §11.3.5.3: pixels per unit, unit 1 the metre; unit 0 states only the aspect ratio,
 * which is no resolution). Undefined when the bytes are not a PNG.
 */
export function pngInfo(bytes: Uint8Array): PngInfo | undefined {
  if (bytes.length < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) return undefined;
  if (chunkType(bytes, 12) !== 'IHDR') return undefined;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  if (width === 0 || height === 0) return undefined;
  // The chunks before the image data: pHYs must come before the first IDAT.
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = u32(bytes, at);
    const type = chunkType(bytes, at + 4);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'pHYs' && length === 9 && at + 17 <= bytes.length) {
      const x = u32(bytes, at + 8);
      const y = u32(bytes, at + 12);
      if (bytes[at + 16] === 1 && x > 0 && y > 0) {
        return { width, height, ppi: { x: x * INCH, y: y * INCH } };
      }
      break;
    }
    at += 12 + length;
  }
  return { width, height };
}

/** The file name a picture is kept as: `pasted-` and 8 hex digits of its SHA-256. */
export async function pictureName(
  bytes: Uint8Array,
  digest: (data: Uint8Array) => Promise<ArrayBuffer> = (data) =>
    globalThis.crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>),
): Promise<string> {
  const hash = new Uint8Array(await digest(bytes));
  const hex = [...hash.subarray(0, 4)].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `pasted-${hex}.png`;
}

/** Where pasted pictures are kept between visits: one file each, by name. */
export interface PictureFolder {
  get(name: string): Promise<Uint8Array | undefined>;
  put(name: string, bytes: Uint8Array): Promise<void>;
}

/** The private file system's folder for pasted pictures. */
export const PICTURES_FOLDER = 'pictures';

/** Pasted pictures in this origin's private file system (OPFS), in `PICTURES_FOLDER`. */
export function opfsPictures(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): PictureFolder {
  const folder = async (): Promise<FileSystemDirectoryHandle> => {
    if (!storage?.getDirectory) throw new Error('the origin-private file system is unavailable');
    const root = await storage.getDirectory();
    return root.getDirectoryHandle(PICTURES_FOLDER, { create: true });
  };
  return {
    async get(name) {
      try {
        const handle = await (await folder()).getFileHandle(name);
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch {
        // Not kept here (NotFoundError), or no private file system in this browser.
        return undefined;
      }
    },
    async put(name, bytes) {
      const handle = await (await folder()).getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    },
  };
}

/** Only the names `pictureName` gives are looked for among the kept pictures. */
const PASTED = /^pasted-[0-9a-f]{8}\.png$/i;

export const isPastedPictureName = (fileName: string): boolean =>
  PASTED.test(fileName.replace(/^.*[\\/]/, ''));

/**
 * Keeps another app's PNG for a paste: under its name in `folder`, and handed to `use` (the
 * app's RasterImages, so it draws at once). What PASTECLIP is told, or undefined when the bytes
 * are not a PNG. A picture that cannot be kept on the device still pastes; it draws until the
 * page closes.
 */
export async function keepPicture(
  bytes: Uint8Array,
  folder: PictureFolder,
  use: (fileName: string, bytes: Uint8Array) => void,
  name: (bytes: Uint8Array) => Promise<string> = pictureName,
): Promise<ClipboardPicture | undefined> {
  const info = pngInfo(bytes);
  if (!info) return undefined;
  const fileName = await name(bytes);
  use(fileName, bytes);
  await folder.put(fileName, bytes).catch(() => undefined);
  return {
    fileName,
    width: info.width,
    height: info.height,
    ...(info.ppi && { ppi: info.ppi }),
  };
}
