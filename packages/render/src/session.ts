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
  type KeyedChanges,
  type TableChanges,
  type TableName,
  type OsnapHit,
  type OsnapQuery,
  type Tolerance,
} from '@triya/engine';
import { FontBook, loadStrokeFont, parseShx, parseTtf, type TriyaStrokeFont } from '@triya/text';
import { Canvas2DRenderer, type Surface } from './canvas2d';
import type { Paint } from './tessellate';
import type { TextContext } from './text';
import { textBounds } from './text-bounds';
import { thumbnailOf, type BitmapFactory, type ThumbnailSize } from './thumbnail';
import type { RasterPixels, RenderStyle, UnderlayRaster, UnderlayRequest } from './types';

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

const TRUETYPE = /\.(ttf|otf)$/i;

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
      if (TRUETYPE.test(name)) book.addTtf(parseTtf(bytes), name);
      else book.addShx(name, parseShx(bytes));
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
  /** PDF underlay pages by PDFDEFINITION handle, as the app draws them (M1-20). */
  readonly #underlays = new Map<Handle, UnderlayRaster>();
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
      // An unclipped underlay shows its whole page, whose size only its PDF gives (M1-20).
      underlayPage: (h) => this.#underlays.get(h)?.page,
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
   * The running object snap points under the aperture in the space drawn, best first (M2-04):
   * text is bounded by its glyphs here, which the engine worker, having no fonts, cannot do.
   */
  snap(query: OsnapQuery): OsnapHit[] {
    return osnap(
      { model: this.model, index: this.index, block: this.#block, tol: this.#tol },
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
   * gone or detached): underlays showing it redraw on the next frame (M1-20).
   */
  setUnderlay(definition: Handle, raster: UnderlayRaster | undefined): void {
    const before = this.#underlays.get(definition)?.page;
    if (raster) this.#underlays.set(definition, raster);
    else this.#underlays.delete(definition);
    // Every raster of a page states its size; only a new size moves the extents.
    const after = raster?.page;
    if (before?.width !== after?.width || before?.height !== after?.height)
      this.index.reboundUnderlays();
    this.renderer.invalidate();
  }

  /**
   * Applies a ChangeSet the engine already applied. Entity ids are dense and handed out in
   * order, so binding the new handles in id order reproduces the engine's ids; a mismatch means
   * the replica missed a change, and drawing on would show the wrong entities.
   */
  apply(cs: ChangeSet): void {
    const added = [...(cs.entities?.added ?? [])].sort((a, b) => a.entity.id - b.entity.id);
    for (const { entity } of added) {
      const id = this.model.ids.assign(entity.handle);
      if (id !== entity.id) {
        throw new Error(
          `render replica out of step: handle ${entity.handle} is id ${id} here, ${entity.id} in the engine`,
        );
      }
    }
    const local = this.#rebase(cs);
    this.model.apply(local);
    this.index.apply(local);
    this.renderer.apply(local);
  }

  /**
   * The model checks that a change set's `before` side is the very object it holds, which a
   * change set that crossed a postMessage (a structured clone) never is. Swap in the replica's
   * own objects, matched by id and handle; one it does not hold means the replica missed a
   * change, and the model then rejects the change set.
   */
  #rebase(cs: ChangeSet): ChangeSet {
    const m = this.model;
    const own = (e: Entity): Entity => m.entity(e.id) ?? e;
    const out: { -readonly [K in keyof ChangeSet]: ChangeSet[K] } = { ...cs };
    if (cs.entities) {
      const { added, updated, removed } = cs.entities;
      out.entities = {
        ...(added && { added }),
        ...(updated && {
          updated: updated.map((u) => ({ before: own(u.before), after: u.after })),
        }),
        ...(removed && {
          removed: removed.map((r) => ({ entity: own(r.entity), index: r.index })),
        }),
      };
    }
    if (cs.tables) {
      const tables: Record<string, KeyedChanges<{ readonly handle: Handle }>> = {};
      for (const [name, c] of Object.entries(cs.tables) as [TableName, KeyedChanges<never>][]) {
        const map = m.tables[name] as ReadonlyMap<Handle, { readonly handle: Handle }>;
        tables[name] = rebaseKeyed(c, map);
      }
      out.tables = tables as TableChanges;
    }
    if (cs.objects) out.objects = rebaseKeyed(cs.objects, m.objects);
    if (cs.blocks) out.blocks = rebaseKeyed(cs.blocks, m.blocks);
    if (cs.layouts) {
      const own = new Map(m.layouts.map((l) => [l.handle, l]));
      out.layouts = rebaseKeyed(cs.layouts, own);
    }
    return out;
  }
}

function rebaseKeyed<T extends { readonly handle: Handle }>(
  c: KeyedChanges<T>,
  map: ReadonlyMap<Handle, T>,
): KeyedChanges<T> {
  const own = (r: T): T => map.get(r.handle) ?? r;
  return {
    ...(c.added && { added: c.added }),
    ...(c.updated && {
      updated: c.updated.map((u) => ({ before: own(u.before), after: u.after })),
    }),
    ...(c.removed && { removed: c.removed.map(own) }),
  };
}
