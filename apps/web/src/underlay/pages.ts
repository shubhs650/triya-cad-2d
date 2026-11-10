// PDF underlay pages (M1-20): the PDF files the user supplied this session, opened once each,
// and the page rasters the renderers ask for (`UnderlayRequest`), drawn one at a time and kept
// in a cache bounded by bytes, so zooming back or a second viewport of the same page draws
// nothing again. pdf.js itself is behind `OpenPdf` (pdfjs.ts), so this runs in Node tests.
//
// A request is drawn at its scale over its region clamped to the page, unless that would
// exceed the pixel budget, when the scale drops to fit: the renderer then shows the page a
// little soft rather than the app running out of memory. Only the latest request per page of
// each canvas is drawn; one superseded while waiting is skipped.
//
// Each page's vector geometry (M2-22), for running object snaps under PDFOSNAP, is read once
// (pdf.js parses the page in its worker) and cached with the file; a canvas gets it for each
// definition the first time it asks for that definition's page, and again when the file is
// replaced.
//
// Files are matched to PDFDEFINITIONs by file name without its folder, ignoring case, as the
// definition's path is the attaching computer's (`..\plans\plan.pdf`). Finding files on the
// user's disk and the Missing References panel are M1-21.
import type { Box, PdfDefinition, UnderlaySnapPage } from '@triya/engine';
import type { RasterPixels, UnderlayRaster, UnderlayRequest } from '@triya/render';

/** An opened PDF, as pdf.js serves it (pdfjs.ts). */
export interface PdfFile {
  readonly pageCount: number;
  /** A page's size in inches (72 PDF points), as displayed (its /Rotate applied). */
  pageSize(page: number): Promise<{ readonly width: number; readonly height: number }>;
  /**
   * `region` of a page (inches from its lower-left corner, y up) as `width` × `height`
   * pixels, straight RGBA with the paper clear.
   */
  render(page: number, region: Box, width: number, height: number): Promise<RasterPixels>;
  /** A page's painted paths in page inches, for running object snaps (M2-22). */
  snapGeometry?(page: number): Promise<UnderlaySnapPage>;
}

export type OpenPdf = (bytes: Uint8Array) => Promise<PdfFile>;

export interface PdfPagesOptions {
  /** The most pixels one raster may have; 16 M (64 MB) by default. */
  readonly maxPixels?: number;
  /** The rasters kept, in bytes; 256 MB by default. */
  readonly cacheBytes?: number;
}

/** One canvas's link to the pages: it asks with `request` and is answered through `deliver`. */
export interface UnderlayClient {
  request(r: UnderlayRequest): void;
  dispose(): void;
}

type Deliver = (definition: string, raster: UnderlayRaster | undefined) => void;
type DeliverSnap = (definition: string, page: UnderlaySnapPage | undefined) => void;

interface Client {
  readonly definitions: ReadonlyMap<string, PdfDefinition>;
  readonly deliver: Deliver;
  /** The latest request per definition. */
  readonly latest: Map<string, UnderlayRequest>;
  readonly deliverSnap: DeliverSnap | undefined;
  /** The definitions whose page geometry was sent (or is on its way). */
  readonly snapped: Set<string>;
}

interface Cached {
  /** File and page. */
  readonly page: string;
  readonly raster: UnderlayRaster;
  /** The request it was drawn for, as a key. */
  readonly request: string;
  readonly bytes: number;
}

/** The file name without its folder (either slash), lower case. */
export const fileKey = (path: string): string => (path.split(/[\\/]/).pop() ?? '').toLowerCase();

/** DXF 2 is the page number from 1; anything else (a page label) shows the first page. */
const pageNumber = (page: string, count: number): number => {
  const n = Number.parseInt(page, 10);
  return Number.isInteger(n) && n >= 1 && n <= count ? n : 1;
};

const keyOf = (r: UnderlayRequest): string =>
  [r.scale, r.region.minX, r.region.minY, r.region.maxX, r.region.maxY].join('|');

export class PdfPages {
  readonly #open: OpenPdf;
  readonly #maxPixels: number;
  readonly #cacheBytes: number;
  readonly #files = new Map<
    string,
    {
      readonly bytes: Uint8Array;
      opened?: Promise<PdfFile>;
      /** Page geometry by page number. */
      readonly snaps: Map<number, Promise<UnderlaySnapPage | undefined>>;
    }
  >();
  readonly #clients = new Set<Client>();
  /** Least recently used first. */
  readonly #cache = new Map<string, Cached>();
  #cachedBytes = 0;
  /** Renders run one at a time, in the order asked. */
  #queue: Promise<void> = Promise.resolve();
  /** pdf.js renders done (tests check the cache spares them). */
  renders = 0;
  /** Pages whose geometry pdf.js read (tests check each is read once). */
  snapReads = 0;

  constructor(open: OpenPdf, o: PdfPagesOptions = {}) {
    this.#open = open;
    this.#maxPixels = o.maxPixels ?? 16 * 1024 * 1024;
    this.#cacheBytes = o.cacheBytes ?? 256 * 1024 * 1024;
  }

  /**
   * A PDF the user supplied (dropped or picked); it replaces one of the same name, and every
   * canvas waiting on a page of it is served.
   */
  add(name: string, bytes: Uint8Array): void {
    const key = fileKey(name);
    this.#files.set(key, { bytes, snaps: new Map() });
    for (const [k, c] of this.#cache) {
      if (k.startsWith(`${key}#`)) {
        this.#cache.delete(k);
        this.#cachedBytes -= c.bytes;
      }
    }
    for (const client of this.#clients) {
      for (const r of client.latest.values()) {
        const def = client.definitions.get(r.definition);
        if (def && fileKey(def.fileName) === key) {
          client.snapped.delete(r.definition);
          this.#serve(client, r);
        }
      }
    }
  }

  /** The bytes of the file of this name, as supplied (a plot copies its pages, M2-16 part 5). */
  bytes(fileName: string): Uint8Array | undefined {
    return this.#files.get(fileKey(fileName))?.bytes;
  }

  /** Whether a file of this name was supplied. */
  has(fileName: string): boolean {
    return this.#files.has(fileKey(fileName));
  }

  /**
   * A canvas of a drawing with these PDFDEFINITIONs: pages are delivered as asked, and with
   * `deliverSnap` each definition's page geometry once (M2-22).
   */
  client(
    definitions: readonly PdfDefinition[],
    deliver: Deliver,
    deliverSnap?: DeliverSnap,
  ): UnderlayClient {
    const client: Client = {
      definitions: new Map(definitions.map((d) => [d.handle, d])),
      deliver,
      latest: new Map(),
      deliverSnap,
      snapped: new Set(),
    };
    this.#clients.add(client);
    return {
      request: (r) => {
        client.latest.set(r.definition, r);
        this.#serve(client, r);
      },
      dispose: () => this.#clients.delete(client),
    };
  }

  #serve(client: Client, r: UnderlayRequest): void {
    const def = client.definitions.get(r.definition);
    if (!def) return;
    const file = this.#files.get(fileKey(def.fileName));
    if (!file) return;
    if (client.deliverSnap && !client.snapped.has(r.definition)) {
      client.snapped.add(r.definition);
      void this.#snap(file, def.page).then((page) => {
        if (page && this.#clients.has(client) && this.#files.get(fileKey(def.fileName)) === file)
          client.deliverSnap?.(r.definition, page);
      });
    }
    this.#queue = this.#queue.then(async () => {
      if (!this.#clients.has(client) || client.latest.get(r.definition) !== r) return;
      try {
        const raster = await this.#raster(fileKey(def.fileName), file, def.page, r);
        if (raster && this.#clients.has(client) && client.latest.get(r.definition) === r)
          client.deliver(r.definition, raster);
      } catch {
        // A file pdf.js cannot read shows as a missing page: the boundary only.
      }
    });
  }

  /** A page's geometry, read once per file; undefined when pdf.js cannot read it. */
  #snap(
    file: {
      readonly bytes: Uint8Array;
      opened?: Promise<PdfFile>;
      readonly snaps: Map<number, Promise<UnderlaySnapPage | undefined>>;
    },
    pageName: string,
  ): Promise<UnderlaySnapPage | undefined> {
    file.opened ??= this.#open(file.bytes);
    return file.opened
      .then(async (pdf) => {
        if (!pdf.snapGeometry) return undefined;
        const n = pageNumber(pageName, pdf.pageCount);
        let got = file.snaps.get(n);
        if (!got) {
          this.snapReads++;
          got = pdf.snapGeometry(n).catch(() => undefined);
          file.snaps.set(n, got);
        }
        return got;
      })
      .catch(() => undefined);
  }

  async #raster(
    key: string,
    file: { readonly bytes: Uint8Array; opened?: Promise<PdfFile> },
    pageName: string,
    r: UnderlayRequest,
  ): Promise<UnderlayRaster | undefined> {
    file.opened ??= this.#open(file.bytes);
    const pdf = await file.opened;
    const n = pageNumber(pageName, pdf.pageCount);
    const pageKey = `${key}#${n}`;
    const request = keyOf(r);
    const hit = this.#lookup(pageKey, request, r);
    if (hit) return hit;
    const page = await pdf.pageSize(n);
    const region = {
      minX: Math.max(r.region.minX, 0),
      minY: Math.max(r.region.minY, 0),
      maxX: Math.min(r.region.maxX, page.width),
      maxY: Math.min(r.region.maxY, page.height),
    };
    const w = region.maxX - region.minX;
    const h = region.maxY - region.minY;
    if (!(w > 0 && h > 0)) return undefined;
    const fit = Math.min(1, Math.sqrt(this.#maxPixels / (w * r.scale * h * r.scale)));
    const width = Math.max(1, Math.round(w * r.scale * fit));
    const height = Math.max(1, Math.round(h * r.scale * fit));
    const pixels = await pdf.render(n, region, width, height);
    this.renders++;
    const raster: UnderlayRaster = { page, region, pixels };
    this.#remember(`${pageKey}@${request}`, {
      page: pageKey,
      raster,
      request,
      bytes: pixels.data.length,
    });
    return raster;
  }

  /** A cached raster drawn for this request, or one sharp enough that covers its region. */
  #lookup(pageKey: string, request: string, r: UnderlayRequest): UnderlayRaster | undefined {
    for (const [k, c] of this.#cache) {
      if (c.page !== pageKey) continue;
      const g = c.raster.region;
      const p = c.raster.page;
      const scale = c.raster.pixels.width / (g.maxX - g.minX);
      const covers =
        scale >= r.scale * (1 - 1e-9) &&
        g.minX <= Math.max(r.region.minX, 0) &&
        g.minY <= Math.max(r.region.minY, 0) &&
        g.maxX >= Math.min(r.region.maxX, p.width) &&
        g.maxY >= Math.min(r.region.maxY, p.height);
      if (c.request === request || covers) {
        this.#cache.delete(k);
        this.#cache.set(k, c);
        return c.raster;
      }
    }
    return undefined;
  }

  #remember(key: string, c: Cached): void {
    this.#cache.set(key, c);
    this.#cachedBytes += c.bytes;
    for (const [k, old] of this.#cache) {
      if (this.#cachedBytes <= this.#cacheBytes || k === key) break;
      this.#cache.delete(k);
      this.#cachedBytes -= old.bytes;
    }
  }
}
