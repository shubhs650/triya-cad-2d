// RenderSession: everything that draws one document, wherever it runs.
//
// The render side never touches the authoritative document (ARCHITECTURE.md §3). It keeps a
// replica: a DocumentModel built from the same `DocumentInit` as the engine's and fed the same
// ChangeSets, with its own spatial index and a Canvas2DRenderer. RendererHost runs a session in
// the render worker on an OffscreenCanvas, or on the main thread where that is unavailable; the
// session is the same code either way, which is what makes the fallback render identically.

import {
  DocumentModel,
  SpatialIndex,
  applyToReplica,
  osnap,
  toleranceForSize,
  toleranceFromExtents,
  unionBox,
  type Box,
  type ChangeSet,
  type DocumentInit,
  type Entity,
  type EntityId,
  type Handle,
  type HeaderValue,
  type MTextGeometry,
  type OsnapHit,
  type OsnapQuery,
  type TextGeometry,
  type TextOutline,
  type Tolerance,
  type UnderlaySnapPage,
} from '@triya/engine';
import {
  FontBook,
  loadStrokeFont,
  parseShx,
  parseTtfCollection,
  type TriyaStrokeFont,
} from '@triya/text';
import { dimensionParts, drawingDimensionHealth, type DrawingDimensionHealth } from '@triya/dims';
import { Canvas2DRenderer, type Surface } from './canvas2d';
import type { Paint } from './tessellate';
import { columnCounter, textMeasure, type TextContext } from './text';
import { textBounds, textOutline } from './text-bounds';
import { thumbnailOf, type BitmapFactory, type ThumbnailSize } from './thumbnail';
import { plotParts, type PlotPart } from './plot/job';
import type { PlotStyleTable } from './plot/plot-style-table';
import { PlotResolver } from './plot/resolver';
import type { RasterPixels, RenderStyle, UnderlayRaster, UnderlayRequest } from './types';
import { underlayKeyDefinition } from './underlay';

/** What to plot (M2-17): a space of the drawing through a plot style table. */
export interface PlotRequest {
  /** Model space or a layout's paper space; the space drawn when absent. */
  readonly block?: Handle;
  /** The plot style table; none plots objects with their own properties. */
  readonly table?: PlotStyleTable;
  /** "Plot paperspace last" (a layout only). */
  readonly paperspaceLast?: boolean;
  /** The objects to plot, by handle (M2-32 part 5's picture); all of the space's when absent. */
  readonly handles?: readonly Handle[];
}

/** What the render side needs to build its replica: the engine's init and the block shown. */
export interface RenderDocument {
  readonly init: DocumentInit;
  /** The block record shown: model space, or a layout's paper space. */
  readonly block: Handle;
  /** The document's tolerance; defaults to one derived from `$EXTMIN`/`$EXTMAX`. */
  readonly tol?: Tolerance;
}

/**
 * Fonts for TEXT and MTEXT, as sources a message can carry: the bundled stroke fonts (M1-09) as
 * their committed JSON text by font name (`oet-simplex`, M1-72), and the user's font files as
 * bytes by file name (`.shx`, `.ttf`, `.otf`; M1-37, M1-38). The session loads them into a
 * FontBook where it runs, so the worker needs nothing but the message.
 */
export interface FontSources {
  readonly shx?: readonly { readonly name: string; readonly source: string }[];
  readonly files?: readonly { readonly name: string; readonly bytes: Uint8Array }[];
}

const TRUETYPE = /\.(ttf|otf|ttc)$/i;

/**
 * A FontBook holding the given fonts. A file that does not parse is left out and its name
 * pushed to `failed`: its text draws with the fallbacks, as for a missing font, and the health
 * report can name it.
 */
export function fontBookOf(sources: FontSources, failed: string[] = []): FontBook {
  const book = new FontBook();
  for (const { name, source } of sources.shx ?? []) {
    try {
      book.addShx(name, loadStrokeFont(JSON.parse(source) as TriyaStrokeFont));
    } catch {
      failed.push(name);
    }
  }
  // User files go in after the bundled fonts: a style finds its own file by name first, and
  // the bundled fonts only stand in for what is missing (ARCHITECTURE.md §8).
  for (const { name, bytes } of sources.files ?? []) {
    try {
      if (TRUETYPE.test(name)) {
        // A collection's first face answers to the file name, as AutoCAD draws a style naming
        // it; every face answers to its family (M2-16 part 4).
        parseTtfCollection(bytes).forEach((face, i) =>
          book.addTtf(face, i === 0 ? name : undefined),
        );
      } else book.addShx(name, parseShx(bytes));
    } catch {
      failed.push(name);
    }
  }
  return book;
}

export interface RenderSessionOptions {
  readonly document: RenderDocument;
  readonly surface: Surface;
  readonly createLayer: () => Surface;
  readonly style?: RenderStyle;
  /** The user's .pat files (M1-50). */
  readonly patterns?: readonly string[];
  /** Fonts for text (M1-72, M1-38); without them text draws nothing and has unknown bounds. */
  readonly fonts?: FontSources;
  readonly paint?: (e: Entity, model: DocumentModel) => Paint | undefined;
  readonly now?: () => number;
  readonly requestIdle?: (cb: () => void) => void;
  /** A PDF underlay's page the view needs drawn (M1-20); the app answers with `setUnderlay`. */
  readonly onUnderlayRequest?: (request: UnderlayRequest) => void;
}

const isPoint = (v: HeaderValue | undefined): v is { x: number; y: number } =>
  typeof v === 'object' && v !== null;

/** The tolerance from the header's extents, or the unit tolerance when they are missing. */
export function documentTolerance(init: DocumentInit): Tolerance {
  const header = new Map(init.header ?? []);
  const min = header.get('$EXTMIN');
  const max = header.get('$EXTMAX');
  return isPoint(min) && isPoint(max) ? toleranceFromExtents(min, max) : toleranceForSize(1);
}

export class RenderSession {
  readonly model: DocumentModel;
  readonly index: SpatialIndex;
  readonly renderer: Canvas2DRenderer;
  /** What text draws with and how it is bounded; `fonts` changes with `setFonts`. */
  readonly #text: { fonts: FontBook; readonly style: TextContext['style'] };
  /** The font files that did not parse, by name (the health report lists them). */
  fontWarnings: readonly string[] = [];
  /** Decoded bitmaps by IMAGEDEF handle, as the app sends them (M1-19). */
  readonly #images = new Map<Handle, RasterPixels>();
  /**
   * PDF underlay pages as the app draws them (M1-20), by `underlayKey`: the PDFDEFINITION's
   * handle, with the layers turned off when any are (M2-38).
   */
  readonly #underlays = new Map<string, UnderlayRaster>();
  /** Each PDFDEFINITION's page size, from any raster of it: what extents need. */
  readonly #underlayPages = new Map<Handle, UnderlayRaster['page']>();
  /** PDF underlay pages' vector geometry by PDFDEFINITION handle, for osnap (M2-22). */
  readonly #underlaySnaps = new Map<Handle, UnderlaySnapPage>();
  readonly #surface: Surface;
  /** The block record drawn: model space or a layout's paper space. */
  readonly #block: Handle;
  readonly #tol: Tolerance;

  constructor(o: RenderSessionOptions) {
    this.#surface = o.surface;
    const { init, block } = o.document;
    this.#block = block;
    this.model = DocumentModel.create(init);
    const model = this.model;
    const failed: string[] = [];
    this.#text = {
      fonts: fontBookOf(o.fonts ?? {}, failed),
      style: (h) => model.tables.textStyles.get(h),
    };
    this.fontWarnings = failed;
    // Text is bounded by its glyphs (M1-35), through the fonts in force at each query, so
    // culling and extents see it; text no loaded font serves stays unknown and always draws.
    this.#tol = o.document.tol ?? documentTolerance(init);
    this.index = SpatialIndex.build(this.model, {
      tol: this.#tol,
      annotationBounds: textBounds(this.#text),
      // TOLERANCE frames and dimensions drawn without their block (from the dimension engine,
      // M2-30) are bounded by what they draw, their text measured in the same fonts.
      measureText: textMeasure(this.#text),
      dimensionParts,
      // An unclipped underlay shows its whole page, whose size only its PDF gives (M1-20).
      underlayPage: (h) => this.#underlayPages.get(h),
    });
    this.renderer = new Canvas2DRenderer({
      model: this.model,
      index: this.index,
      block,
      surface: o.surface,
      createLayer: o.createLayer,
      ...(o.style && { style: o.style }),
      ...(o.patterns && { patterns: o.patterns }),
      ...(o.fonts && { fonts: this.#text.fonts }),
      ...(o.paint && { paint: o.paint }),
      ...(o.now && { now: o.now }),
      ...(o.requestIdle && { requestIdle: o.requestIdle }),
      images: (h) => this.#images.get(h),
      underlays: (h) => this.#underlays.get(h),
      ...(o.onUnderlayRequest && { onUnderlayRequest: o.onUnderlayRequest }),
    });
  }

  /** The fonts text draws with now. */
  get fonts(): FontBook {
    return this.#text.fonts;
  }

  /**
   * Replaces the fonts (the user added or removed a font file): text redraws with them and the
   * spatial index re-bounds it.
   */
  setFonts(sources: FontSources): void {
    const failed: string[] = [];
    this.#text.fonts = fontBookOf(sources, failed);
    this.fontWarnings = failed;
    this.renderer.setFonts(this.#text.fonts);
    this.index.reboundAnnotations();
  }

  /**
   * ZOOM Extents of the space drawn (M1-35 part 2), from the spatial index as it stands: text
   * counts by its glyphs in the fonts loaded now, and edits are followed. Undefined when
   * nothing in it has a known extent.
   */
  extents(): Box | undefined {
    return this.index.drawnExtents(this.#block);
  }

  /**
   * The extents of some entities (ZOOM Object, M2-03), from the spatial index: text by its
   * glyphs. Undefined when none of them has a known extent.
   */
  boundsOf(ids: readonly EntityId[]): Box | undefined {
    let out: Box | undefined;
    for (const id of ids) {
      const b = this.index.bounds(id);
      if (b?.kind !== 'box') continue;
      out = out ? unionBox(out, b.box) : b.box;
    }
    return out;
  }

  /**
   * The box an MTEXT that is not in the drawing would fill (M2-09: MLEADEREDIT's landing on the
   * far side of a multileader's text), in the fonts loaded now.
   */
  textBox(text: MTextGeometry): Box | undefined {
    return textBounds(this.#text)(text);
  }

  /**
   * The widths MTEXTs are laid out at in the fonts loaded now (`textMeasure`), null for one no
   * loaded font draws: what the engine worker, having no fonts, regenerates dimensions by
   * (M2-10 part 3).
   */
  textWidths(texts: readonly MTextGeometry[]): (number | null)[] {
    const measure = textMeasure(this.#text);
    return texts.map((t) => measure(t) ?? null);
  }

  /**
   * How many dynamic columns MTEXTs take in the fonts loaded now (`columnCounter`), null for one
   * no loaded font draws: what the engine worker recounts columns by after a column grip (M2-26
   * part 2).
   */
  columnCounts(texts: readonly MTextGeometry[]): (number | null)[] {
    const count = columnCounter(this.#text);
    return texts.map((t) => count(t) ?? null);
  }

  /**
   * Every dimension of the drawing against its stored block (M2-30 part 3, DEC-011's health
   * check), texts measured in the fonts loaded now, as the screen draws them.
   */
  dimensionHealth(): DrawingDimensionHealth {
    return drawingDimensionHealth(this.model, textMeasure(this.#text));
  }

  /** Where texts lie as drawn in the fonts loaded now (`textOutline`, M2-27). */
  textOutlines(texts: readonly (TextGeometry | MTextGeometry)[]): (TextOutline | null)[] {
    const outline = textOutline(this.#text);
    return texts.map((t) => outline(t) ?? null);
  }

  /**
   * The running object snap points under the aperture in the space drawn, best first (M2-04):
   * text is bounded by its glyphs here, which the engine worker, having no fonts, cannot do.
   * Tracking acquisitions (EXT, PAR) follow them, marked `track`.
   */
  snap(query: OsnapQuery): OsnapHit[] {
    // In a layout, model space is snapped to through its viewports (M2-04 part 2).
    const model = [...this.model.tables.blockRecords.values()].find(
      (r) => r.name.toLowerCase() === '*model_space',
    )?.handle;
    return osnap(
      {
        model: this.model,
        index: this.index,
        block: this.#block,
        tol: this.#tol,
        ...(model !== undefined && { modelSpace: model }),
        underlays: (h) => this.#underlaySnaps.get(h),
      },
      query,
    );
  }

  /** The last frame drawn, fitted inside `max` (the document tab hover preview, M1-22). */
  thumbnail(max: ThumbnailSize, createBitmap?: BitmapFactory): Promise<ImageBitmap | undefined> {
    return thumbnailOf(this.#surface, max, createBitmap);
  }

  /**
   * An IMAGEDEF's decoded bitmap, or undefined to forget it (file gone or unloaded): images
   * using it redraw on the next frame.
   */
  setImage(definition: Handle, pixels: RasterPixels | undefined): void {
    if (pixels) this.#images.set(definition, pixels);
    else this.#images.delete(definition);
    this.renderer.invalidate();
  }

  /**
   * A PDFDEFINITION's page as the app drew it for a request, or undefined to forget it (file
   * gone or detached): underlays showing it redraw on the next frame (M1-20). `page` is the
   * request's `underlayKey`.
   */
  setUnderlay(page: string, raster: UnderlayRaster | undefined): void {
    // Keyed by `underlayKey`: a page with layers turned off has rasters of its own (M2-38).
    const definition = underlayKeyDefinition(page);
    const before = this.#underlayPages.get(definition);
    if (raster) this.#underlays.set(page, raster);
    else this.#underlays.delete(page);
    // Every raster of a page states its size; only a new size moves the extents.
    let after = raster?.page;
    if (!after)
      for (const [k, r] of this.#underlays)
        if (underlayKeyDefinition(k) === definition) after = r.page;
    if (after) this.#underlayPages.set(definition, after);
    else this.#underlayPages.delete(definition);
    if (before?.width !== after?.width || before?.height !== after?.height)
      this.index.reboundUnderlays();
    this.renderer.invalidate();
  }

  /**
   * A PDFDEFINITION's page geometry as the app read it from the PDF, or undefined to forget it:
   * running object snaps snap to it while PDFOSNAP is on (M2-22).
   */
  setUnderlaySnap(definition: Handle, page: UnderlaySnapPage | undefined): void {
    if (page) this.#underlaySnaps.set(definition, page);
    else this.#underlaySnaps.delete(definition);
  }

  /**
   * What plotting a space draws (M2-17), tessellated as the screen is (fonts, patterns, the
   * bitmaps the app loaded). Each TrueType glyph's font is reduced to its file's bytes, one
   * object per font, so the parts cross a worker boundary and a PDF embeds each font once.
   */
  plot(request: PlotRequest = {}): PlotPart[] {
    const parts = plotParts(this.model, request.block ?? this.#block, {
      resolver: new PlotResolver(request.table),
      tessellate: this.renderer.tessellateContext,
      images: (h) => this.#images.get(h),
      ...(request.paperspaceLast && { paperspaceLast: true }),
      ...(request.handles && { only: new Set(request.handles) }),
    });
    const fonts = new Map<object, { readonly bytes?: Uint8Array }>();
    const slim = (font: { readonly bytes?: Uint8Array }) => {
      let f = fonts.get(font);
      if (!f) fonts.set(font, (f = font.bytes ? { bytes: font.bytes } : {}));
      return f;
    };
    return parts.map((p) =>
      p.kind !== 'fill' || !p.glyphs
        ? p
        : { ...p, glyphs: p.glyphs.map((g) => ({ ...g, font: slim(g.font) })) },
    );
  }

  /** Applies a ChangeSet the engine already applied (`applyToReplica`). */
  apply(cs: ChangeSet): void {
    const local = applyToReplica(this.model, cs, 'render replica');
    this.index.apply(local);
    this.renderer.apply(local);
  }
}
