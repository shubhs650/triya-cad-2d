// Raster images (M1-19 part 3): the image files the user supplied this session (dropped on the
// window), matched to IMAGEDEFs by file name without its folder, ignoring case, as the saved
// path is the attaching computer's (`.\photos\site.jpg`), as PDF underlays' files are (M1-20).
// Each file is decoded once (`decodeRaster`, injected so this runs in Node tests) and its
// bitmap handed to every canvas showing an IMAGE of it, a copy each: the renderer host transfers
// the buffer to its worker. Finding files on the user's disk and the References palette are
// M1-21.
//
// A definition saved unloaded (DXF 280 = 0, AutoCAD's Unload in the External References
// palette) is not served: AutoCAD shows only an unloaded image's frame.
//
// A picture pasted from another app (M2-54) is a file the app keeps on this device: a definition
// naming one that was not supplied is looked up there (`kept`), once per name.
import type { ChangeSet, DocumentInit, ImageDefinition, NonGraphicalObject } from '@triya/engine';
import type { RasterPixels } from '@triya/render';
import { fileKey } from './underlay/pages';
import { isPastedPictureName } from './pasted-pictures';

export type DecodeImage = (bytes: Uint8Array) => Promise<RasterPixels>;

/**
 * The image formats `decodeRaster` reads, by extension (AutoCAD's own names for them): BMP,
 * JPEG, PNG, TIFF and GIF. A dropped file named so is an image, not a drawing to open.
 */
const RASTER_EXT = /\.(bmp|dib|rle|jpe?g|jpe|jfif|png|tiff?|gif)$/i;

export const isRasterFile = (name: string): boolean => RASTER_EXT.test(name);

/** The drawing's IMAGEDEFs as they are now: as opened, then every change its engine applied. */
export function imageDefinitionsOf(
  init: DocumentInit,
  changes: readonly ChangeSet[],
): ImageDefinition[] {
  return objectsOf<ImageDefinition>(init, changes, 'IMAGEDEF');
}

/**
 * The drawing's objects of `type` as they are now: as opened, then every change its engine
 * applied (a loaded xref's definitions, a pasted image's or underlay's, M2-32).
 */
export function objectsOf<T extends NonGraphicalObject>(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  type: T['type'],
): T[] {
  const isOf = (o: { readonly type: string }): o is T => o.type === type;
  const now = new Map((init.objects ?? []).filter(isOf).map((d) => [d.handle, d]));
  for (const { objects: c } of changes) {
    for (const o of c?.removed ?? []) now.delete(o.handle);
    for (const { after } of c?.updated ?? []) {
      if (isOf(after)) now.set(after.handle, after);
      else now.delete(after.handle);
    }
    for (const o of c?.added ?? []) if (isOf(o)) now.set(o.handle, o);
  }
  return [...now.values()];
}

type Deliver = (definition: string, pixels: RasterPixels | undefined) => void;

/** One canvas's link to the images. */
export interface ImageClient {
  /**
   * Hands over every bitmap its definitions have again, read as they are now: after a new
   * renderer (REGEN) or an edit that brought definitions in (a loaded xref's images).
   */
  resend(): void;
  dispose(): void;
}

interface Client {
  readonly definitions: () => readonly ImageDefinition[];
  readonly deliver: Deliver;
}

interface ImageFile {
  readonly bytes: Uint8Array;
  decoded?: Promise<RasterPixels>;
}

const copy = (p: RasterPixels): RasterPixels => ({ ...p, data: p.data.slice() });

/** The pasted pictures kept on this device (M2-54). */
export interface KeptPictures {
  /** A kept picture's bytes by its file name; undefined when none is kept. */
  kept(fileName: string): Promise<Uint8Array | undefined>;
  /** A kept picture was found and added: the References palette's state changed. */
  found(): void;
}

export class RasterImages {
  readonly #decode: DecodeImage;
  readonly #kept: KeptPictures | undefined;
  readonly #files = new Map<string, ImageFile>();
  readonly #clients = new Set<Client>();
  /** The names already looked up among the kept pictures. */
  readonly #asked = new Set<string>();

  constructor(decode: DecodeImage, kept?: KeptPictures) {
    this.#decode = decode;
    this.#kept = kept;
  }

  /**
   * An image file the user supplied; it replaces one of the same name, and every canvas with
   * an IMAGE of it is served.
   */
  add(name: string, bytes: Uint8Array): void {
    const key = fileKey(name);
    const file: ImageFile = { bytes };
    this.#files.set(key, file);
    for (const client of this.#clients) {
      for (const d of client.definitions()) if (fileKey(d.fileName) === key) this.#serve(client, d);
    }
  }

  /** Whether a file of this name was supplied. */
  has(fileName: string): boolean {
    return this.#files.has(fileKey(fileName));
  }

  /** A canvas of a drawing whose IMAGEDEFs `definitions` gives; served at once with what is here. */
  client(definitions: () => readonly ImageDefinition[], deliver: Deliver): ImageClient {
    const client: Client = { definitions, deliver };
    this.#clients.add(client);
    const all = () => {
      for (const d of definitions()) this.#serve(client, d);
    };
    all();
    return {
      resend: all,
      dispose: () => this.#clients.delete(client),
    };
  }

  #serve(client: Client, def: ImageDefinition): void {
    if (!def.loaded) return;
    const file = this.#files.get(fileKey(def.fileName));
    if (!file) {
      this.#lookUp(def.fileName);
      return;
    }
    file.decoded ??= this.#decode(file.bytes);
    file.decoded.then(
      (pixels) => {
        // Superseded by a newer file of the name, or the canvas went away meanwhile.
        if (this.#files.get(fileKey(def.fileName)) !== file || !this.#clients.has(client)) return;
        client.deliver(def.handle, copy(pixels));
      },
      // A file the decoder cannot read shows as a missing image: its frame only.
      () => {},
    );
  }

  /** Looks a pasted picture's file up among the kept ones, once; `add` serves it when found. */
  #lookUp(fileName: string): void {
    const key = fileKey(fileName);
    if (!this.#kept || this.#asked.has(key) || !isPastedPictureName(fileName)) return;
    this.#asked.add(key);
    const kept = this.#kept;
    void kept.kept(fileKey(fileName)).then((bytes) => {
      // A file supplied meanwhile is the user's: it stays.
      if (!bytes || this.#files.has(key)) return;
      this.add(fileName, bytes);
      kept.found();
    });
  }
}
