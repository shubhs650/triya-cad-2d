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
  toleranceForSize,
  toleranceFromExtents,
  type ChangeSet,
  type DocumentInit,
  type Entity,
  type Handle,
  type HeaderValue,
  type KeyedChanges,
  type TableChanges,
  type TableName,
  type Tolerance,
} from '@triya/engine';
import { Canvas2DRenderer, type Surface } from './canvas2d';
import type { Paint } from './tessellate';
import type { RasterPixels, RenderStyle } from './types';

/** What the render side needs to build its replica: the engine's init and the block shown. */
export interface RenderDocument {
  readonly init: DocumentInit;
  /** The block record shown: model space, or a layout's paper space. */
  readonly block: Handle;
  /** The document's tolerance; defaults to one derived from `$EXTMIN`/`$EXTMAX`. */
  readonly tol?: Tolerance;
}

export interface RenderSessionOptions {
  readonly document: RenderDocument;
  readonly surface: Surface;
  readonly createLayer: () => Surface;
  readonly style?: RenderStyle;
  /** The user's .pat files (M1-50). */
  readonly patterns?: readonly string[];
  readonly paint?: (e: Entity, model: DocumentModel) => Paint | undefined;
  readonly now?: () => number;
  readonly requestIdle?: (cb: () => void) => void;
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
  /** Decoded bitmaps by IMAGEDEF handle, as the app sends them (M1-19). */
  readonly #images = new Map<Handle, RasterPixels>();

  constructor(o: RenderSessionOptions) {
    const { init, block } = o.document;
    this.model = DocumentModel.create(init);
    this.index = SpatialIndex.build(this.model, { tol: o.document.tol ?? documentTolerance(init) });
    this.renderer = new Canvas2DRenderer({
      model: this.model,
      index: this.index,
      block,
      surface: o.surface,
      createLayer: o.createLayer,
      ...(o.style && { style: o.style }),
      ...(o.patterns && { patterns: o.patterns }),
      ...(o.paint && { paint: o.paint }),
      ...(o.now && { now: o.now }),
      ...(o.requestIdle && { requestIdle: o.requestIdle }),
      images: (h) => this.#images.get(h),
    });
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
