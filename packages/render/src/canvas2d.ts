// Canvas2DRenderer: the v1 `Renderer` (ARCHITECTURE.md §7.2).
//
// - Scene cache: each entity's primitives are built once per change (`apply`), never per
//   frame, and the drawn scene is kept in its own layer, so a frame that only moves the
//   transient layer (rubber band, grips) is two bitmap copies.
// - Culling: each frame draws only what the spatial index returns for the visible box.
// - LOD: an entity smaller than a pixel on screen is a one-pixel dot; after a frame over the
//   16 ms budget the next frame skips those and schedules a full-quality frame when idle.
// - Precision: paths are built relative to the view centre, so canvas float32 maths never
//   sees large drawing coordinates.
// - DPR: backing stores are CSS size × device pixel ratio; line widths are device pixels.
// - Style (M1-13): an entity with a linetype is cached continuous, which is what it shows
//   once a pattern is under a pixel and what picking measures; its dashes are fitted the
//   first time it is drawn at a zoom that shows them and kept until it changes, so opening a
//   drawing never pays for dashes nobody zooms in to see. Lineweights follow AutoCAD's model
//   and layout display (`lineweightPixels`), a block's SORTENTSTABLE sets the draw order
//   (`drawOrder`), and LTSCALE, linetype and layer changes re-resolve every entity.
//
// The renderer reads the model and its spatial index; the caller applies each ChangeSet to
// both first, then to the renderer (the order `SpatialIndex.apply` already requires).

import type {
  Box,
  ChangeSet,
  DocumentModel,
  Entity,
  EntityId,
  Handle,
  KeyedChanges,
  NonGraphicalObject,
  SortEntsTable,
  SpatialIndex,
} from '@triya/engine';
import { expandInsert, referenceOf, type BlockSource } from './blocks';
import { defaultPaint, type PaintFunction } from './paint';
import { drawOrder } from './style/draw-order';
import { mixColors, tintColor } from './style/mix';
import { patternLength } from './style/pattern';
import { lineweightPixels } from './style/resolve';
import { tessellate, type TessellateContext } from './tessellate';
import type { TextFonts } from '@triya/text';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  screenToWorld,
  visibleBox,
  type FillGradient,
  type PrimitiveColor,
  type RenderPrimitive,
  type RenderStyle,
  type Renderer,
  type ViewTransform,
} from './types';

/** The Canvas 2D calls the renderer makes; an HTML canvas and an OffscreenCanvas both fit. */
export interface Canvas2D {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise?: boolean): void;
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    a0: number,
    a1: number,
    anticlockwise?: boolean,
  ): void;
  closePath(): void;
  stroke(): void;
  fill(rule?: CanvasFillRule): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
}

/** A canvas (visible or an offscreen layer) and its 2D context. */
export interface Surface {
  readonly canvas: { width: number; height: number };
  readonly ctx: Canvas2D;
  /** What `drawImage` takes to copy this surface onto another. */
  readonly image: CanvasImageSource;
}

export interface Canvas2DRendererOptions {
  readonly model: DocumentModel;
  readonly index: SpatialIndex;
  /** The block record shown: model space, or a layout's paper space. */
  readonly block: Handle;
  readonly surface: Surface;
  /** Makes an offscreen layer (the scene cache and the transient layer). */
  readonly createLayer: () => Surface;
  readonly style?: RenderStyle;
  /**
   * Entity → paint (inside the context an INSERT hands down); undefined hides it. Defaults to
   * `defaultPaint`, whose `insertContext` also serves a paint function that has none.
   */
  readonly paint?: PaintFunction;
  readonly now?: () => number;
  /** Runs a callback when the browser is idle (requestIdleCallback in the app). */
  readonly requestIdle?: (cb: () => void) => void;
  /**
   * Loaded fonts for TEXT and MTEXT (M1-41); without them text draws nothing. The app fills
   * them from the user font store and the bundled fonts before drawing (M1-37).
   */
  readonly fonts?: TextFonts;
  /** A field's current value (MTEXT `%<…>%`); undefined shows `----`. */
  readonly evaluateField?: (code: string) => string | undefined;
}

/** An entity's primitives, with its world size and centre for the sub-pixel LOD. */
interface CacheEntry {
  readonly prims: readonly RenderPrimitive[];
  readonly size: number;
  readonly x: number;
  readonly y: number;
  /** An entity with linetypes: its dashed primitives, built on first use. */
  readonly dashes?: {
    /** The longest pattern repetition among its parts, world units. */
    readonly period: number;
    readonly build: () => readonly RenderPrimitive[];
    built?: readonly RenderPrimitive[];
  };
  /** An INSERT or a dimension: every block definition it draws from (M1-14, M1-15). */
  readonly blocks?: ReadonlySet<Handle>;
}

export const DEFAULT_STYLE: RenderStyle = {
  background: '#212830',
  foreground: '#ffffff',
  showLineweights: false,
};

/** The frame budget (ARCHITECTURE.md §7.2): 60 fps. */
const FRAME_BUDGET_MS = 16;
/** Header variables that change how every entity is painted. */
const PAINT_HEADER = new Set(['$LTSCALE']);

const isSortEnts = (o: NonGraphicalObject): o is SortEntsTable => o.type === 'SORTENTSTABLE';

function touchesSortEnts(c: KeyedChanges<NonGraphicalObject> | undefined): boolean {
  if (!c) return false;
  return (
    (c.added ?? []).some(isSortEnts) ||
    (c.removed ?? []).some(isSortEnts) ||
    (c.updated ?? []).some((u) => isSortEnts(u.before) || isSortEnts(u.after))
  );
}

export class Canvas2DRenderer implements Renderer {
  readonly #model: DocumentModel;
  readonly #index: SpatialIndex;
  readonly #block: Handle;
  readonly #surface: Surface;
  readonly #scene: Surface;
  readonly #transientLayer: Surface;
  readonly #paint: PaintFunction;
  /** Fonts and text styles for TEXT and MTEXT (M1-41). */
  readonly #tessellate: TessellateContext = {};
  /** How INSERTs and dimensions in the block shown expand (M1-14, M1-15). */
  readonly #blockSource: BlockSource;
  readonly #blockDef = (block: Handle) => this.#model.blocks.get(block);
  /** Block definition → its entities in draw order, built on demand. */
  #blockOrders = new Map<Handle, readonly EntityId[]>();
  /** Block definition → its SORTENTSTABLE, built on demand. */
  #sortTables: Map<Handle, SortEntsTable> | undefined;
  readonly #now: () => number;
  readonly #requestIdle: (cb: () => void) => void;
  /**
   * Model space and block definitions show lineweights as pixels; a layout's paper space as
   * paper millimetres at the zoom.
   */
  readonly #paperSpace: boolean;
  /** Paper drawing units per millimetre; the layout's plot paper units come with M1-18. */
  readonly #paperUnitsPerMm: number;

  /** Per entity id (ids are dense): its primitives and screen-size data; hidden ones absent. */
  #cache: (CacheEntry | undefined)[] = [];
  /** The block's entities in draw order, and each id's position in it. */
  #order: readonly EntityId[] = [];
  #rank: number[] = [];
  #orderDirty = true;
  /** Scratch marks for walking visible entities in draw order without sorting. */
  #mark = new Uint8Array(0);
  #style: RenderStyle;
  #view: ViewTransform = { center: { x: 0, y: 0 }, scale: 1 };
  #width = 0;
  #height = 0;
  #dpr = 1;
  #transient: readonly RenderPrimitive[] = [];
  #sceneDirty = true;
  #transientDirty = true;
  #lastFrameSlow = false;
  #idlePending = false;
  /** Frames that redrew the scene layer (tests check the transient path skips it). */
  sceneDraws = 0;

  constructor(o: Canvas2DRendererOptions) {
    this.#model = o.model;
    this.#index = o.index;
    this.#block = o.block;
    this.#surface = o.surface;
    this.#scene = o.createLayer();
    this.#transientLayer = o.createLayer();
    this.#style = o.style ?? DEFAULT_STYLE;
    this.#paint = o.paint ?? defaultPaint;
    if (o.fonts) {
      const model = this.#model;
      this.#tessellate = {
        text: {
          fonts: o.fonts,
          style: (h) => model.tables.textStyles.get(h),
          ...(o.evaluateField ? { evaluateField: o.evaluateField } : {}),
        },
      };
    }
    this.#blockSource = {
      model: this.#model,
      paint: this.#paint,
      insertContext: this.#paint.insertContext ?? defaultPaint.insertContext,
      order: (block) => this.#blockOrder(block),
      tessellate: this.#tessellate,
    };
    this.#now = o.now ?? (() => performance.now());
    this.#requestIdle = o.requestIdle ?? ((cb) => setTimeout(cb, 50));
    this.#paperSpace = this.#model.layouts.some(
      (l) =>
        l.blockRecord === this.#block &&
        this.#model.tables.blockRecords.get(l.blockRecord)?.name.toLowerCase() !== '*model_space',
    );
    this.#paperUnitsPerMm = this.#model.meta.measurement === 'imperial' ? 1 / 25.4 : 1;
    this.#cacheBlock();
  }

  resize(width: number, height: number, dpr: number): void {
    this.#width = width;
    this.#height = height;
    this.#dpr = dpr;
    for (const s of [this.#surface, this.#scene, this.#transientLayer]) {
      s.canvas.width = Math.round(width * dpr);
      s.canvas.height = Math.round(height * dpr);
    }
    this.#sceneDirty = this.#transientDirty = true;
  }

  setView(view: ViewTransform): void {
    this.#view = view;
    this.#sceneDirty = this.#transientDirty = true;
  }

  setStyle(style: RenderStyle): void {
    this.#style = style;
    this.#sceneDirty = this.#transientDirty = true;
  }

  setTransient(primitives: readonly RenderPrimitive[]): void {
    this.#transient = primitives;
    this.#transientDirty = true;
  }

  apply(cs: ChangeSet): void {
    const e = cs.entities;
    for (const r of e?.removed ?? []) this.#forget(r.entity);
    for (const a of e?.added ?? []) this.#cacheIfShown(a.entity);
    for (const u of e?.updated ?? []) {
      this.#forget(u.before);
      this.#cacheIfShown(u.after);
    }
    const sortEnts = touchesSortEnts(cs.objects);
    if (
      e?.added?.length ||
      e?.removed?.length ||
      e?.updated?.some((u) => u.before.owner !== u.after.owner) ||
      sortEnts
    )
      this.#orderDirty = true;
    // Block definitions whose contents or draw order changed: the INSERTs drawing from them
    // (directly or through nesting) are expanded again.
    const changed = new Set<Handle>();
    for (const r of e?.removed ?? []) changed.add(r.entity.owner);
    for (const a of e?.added ?? []) changed.add(a.entity.owner);
    for (const u of e?.updated ?? []) changed.add(u.before.owner).add(u.after.owner);
    if (sortEnts) {
      for (const o of [
        ...(cs.objects?.added ?? []),
        ...(cs.objects?.removed ?? []),
        ...(cs.objects?.updated ?? []).flatMap((u) => [u.before, u.after]),
      ])
        if (isSortEnts(o)) changed.add(o.block);
      this.#sortTables = undefined;
    }
    for (const block of changed) this.#blockOrders.delete(block);
    changed.delete(this.#block);
    if (changed.size > 0) {
      this.#cache.forEach((entry, id) => {
        if (entry?.blocks && [...changed].some((b) => entry.blocks!.has(b))) this.#cacheEntity(id);
      });
    }
    // A layer, linetype, text style or LTSCALE change can restyle or hide any entity:
    // re-resolve the whole block.
    if (
      cs.tables?.layers ||
      cs.tables?.linetypes ||
      cs.tables?.textStyles ||
      cs.header?.some((h) => PAINT_HEADER.has(h.name))
    )
      this.#cacheBlock();
    this.#sceneDirty = true;
  }

  frame(): void {
    const start = this.#now();
    const reduced = this.#lastFrameSlow;
    if (this.#sceneDirty || reduced) {
      this.#drawScene(reduced);
      this.#sceneDirty = false;
    }
    if (this.#transientDirty) {
      const t = this.#transientLayer;
      t.ctx.setTransform(1, 0, 0, 1, 0, 0);
      t.ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
      this.#drawPrimitives(t.ctx, [{ prims: this.#transient, size: Infinity, x: 0, y: 0 }], false);
      this.#transientDirty = false;
    }
    const out = this.#surface.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.clearRect(0, 0, this.#surface.canvas.width, this.#surface.canvas.height);
    out.drawImage(this.#scene.image, 0, 0);
    out.drawImage(this.#transientLayer.image, 0, 0);

    this.#lastFrameSlow = this.#now() - start > FRAME_BUDGET_MS;
    if (reduced) {
      // This frame skipped detail; draw it in full once the user pauses.
      this.#sceneDirty = true;
      if (!this.#idlePending) {
        this.#idlePending = true;
        this.#requestIdle(() => {
          this.#idlePending = false;
          this.#lastFrameSlow = false;
          this.frame();
        });
      }
    }
  }

  hitTest(screen: { readonly x: number; readonly y: number }, aperture: number): EntityId[] {
    const p = screenToWorld(this.#view, this.#width, this.#height, screen);
    const r = aperture / this.#view.scale;
    const box: Box = { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
    const hits: { id: EntityId; d: number }[] = [];
    for (const id of this.#index.query(this.#block, box)) {
      const entry = this.#cache[id];
      if (!entry) continue;
      let d = Infinity;
      for (const prim of entry.prims) d = Math.min(d, distanceTo(prim, p));
      if (d <= r) hits.push({ id, d });
    }
    return hits.sort((a, b) => a.d - b.d).map((h) => h.id);
  }

  #cacheIfShown(e: Entity): void {
    if (e.owner !== this.#block) return;
    const id = this.#model.ids.idOf(e.handle);
    if (id !== undefined) this.#cacheEntity(id);
  }

  #forget(e: Entity): void {
    const id = this.#model.ids.idOf(e.handle);
    if (id !== undefined) this.#cache[id] = undefined;
  }

  #cacheBlock(): void {
    this.#cache = [];
    for (const id of this.#model.blockEntities(this.#block)) this.#cacheEntity(id);
  }

  #cacheEntity(id: EntityId): void {
    const e = this.#model.entity(id);
    if (!e) return;
    let prims: readonly RenderPrimitive[];
    let extra: Pick<CacheEntry, 'dashes' | 'blocks'>;
    if (referenceOf(e, this.#blockDef)) {
      // The reference decides its own visibility: an off layer still shows its contents on
      // other layers.
      const x = expandInsert(e, this.#blockSource, { dashes: false });
      if (x.prims.length === 0 && x.blocks.size === 0) {
        this.#cache[id] = undefined;
        return;
      }
      prims = x.prims;
      const build = () => expandInsert(e, this.#blockSource, { dashes: true }).prims;
      extra = {
        blocks: x.blocks,
        ...(x.period > 0 ? { dashes: { period: x.period, build } } : {}),
      };
    } else {
      const paint = this.#paint(e, this.#model);
      if (!paint) {
        this.#cache[id] = undefined;
        return;
      }
      const { linetype: lt, ...continuous } = paint;
      prims = tessellate(e.geom, continuous, this.#tessellate);
      const period = lt ? patternLength(lt.pattern) * lt.scale : 0;
      const build = () => tessellate(e.geom, paint, this.#tessellate);
      extra = period > 0 ? { dashes: { period, build } } : {};
    }
    // The size and centre drive the sub-pixel LOD; unknown bounds never count as small.
    const b = this.#index.bounds(id);
    this.#cache[id] =
      b?.kind === 'box'
        ? {
            prims,
            size: Math.max(b.box.maxX - b.box.minX, b.box.maxY - b.box.minY),
            x: (b.box.minX + b.box.maxX) / 2,
            y: (b.box.minY + b.box.maxY) / 2,
            ...extra,
          }
        : { prims, size: Infinity, x: 0, y: 0, ...extra };
  }

  /** What an entry draws at the current zoom: its dashes, or continuous (LOD). */
  #primitives(entry: CacheEntry): readonly RenderPrimitive[] {
    const d = entry.dashes;
    // ARCHITECTURE.md §7.2 LOD: "dashed linetypes below 1 px per pattern unit → solid". An
    // INSERT's parts with shorter patterns fall back one by one in the draw loop.
    if (!d || d.period * this.#view.scale < 1) return entry.prims;
    d.built ??= d.build();
    return d.built;
  }

  /** A block's entities in draw order: block order, rearranged by its SORTENTSTABLE. */
  #blockOrder(block: Handle): readonly EntityId[] {
    const memo = this.#blockOrders.get(block);
    if (memo) return memo;
    if (!this.#sortTables) {
      this.#sortTables = new Map();
      for (const o of this.#model.objects.values())
        if (isSortEnts(o)) this.#sortTables.set(o.block, o);
    }
    const table = this.#sortTables.get(block);
    const ids = this.#model.blockEntities(block);
    const order = table
      ? drawOrder(
          ids.map((id) => this.#model.ids.handleOf(id)!),
          table.entries,
        ).map((h) => this.#model.ids.idOf(h)!)
      : [...ids];
    this.#blockOrders.set(block, order);
    return order;
  }

  #drawScene(reduced: boolean): void {
    this.sceneDraws++;
    const { ctx, canvas } = this.#scene;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.#style.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.#orderDirty) {
      this.#order = this.#blockOrder(this.#block);
      this.#rank = [];
      this.#order.forEach((id, i) => (this.#rank[id] = i));
      this.#orderDirty = false;
    }
    const hits = this.#index.query(this.#block, visibleBox(this.#view, this.#width, this.#height));
    const entries: CacheEntry[] = [];
    if (hits.length * 8 > this.#order.length) {
      // Most of the block is in view: mark the hits and walk the block in draw order, which
      // is linear where sorting 100k ids is not.
      if (this.#mark.length < this.#cache.length) this.#mark = new Uint8Array(this.#cache.length);
      const mark = this.#mark;
      for (const id of hits) mark[id] = 1;
      for (const id of this.#order) {
        if (mark[id] !== 1) continue;
        mark[id] = 0;
        const entry = this.#cache[id];
        if (entry) entries.push(entry);
      }
    } else {
      hits.sort((a, b) => (this.#rank[a] ?? 0) - (this.#rank[b] ?? 0));
      for (const id of hits) {
        const entry = this.#cache[id];
        if (entry) entries.push(entry);
      }
    }
    this.#drawPrimitives(ctx, entries, reduced);
  }

  /** Draws entities' primitives, batching consecutive strokes of one colour and width. */
  #drawPrimitives(ctx: Canvas2D, entries: readonly CacheEntry[], reduced: boolean): void {
    const { center, scale } = this.#view;
    const k = scale * this.#dpr;
    const cx = (this.#width * this.#dpr) / 2;
    const cy = (this.#height * this.#dpr) / 2;
    // Paths are built in world units and stroked in device pixels; switch only when needed.
    let inWorld = false;
    const world = (): void => {
      if (inWorld) return;
      ctx.setTransform(k, 0, 0, -k, cx, cy);
      inWorld = true;
    };
    const device = (): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      inWorld = false;
    };
    device();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let batch: { color: string; width: number } | undefined;
    const flush = (): void => {
      if (!batch) return;
      device();
      ctx.strokeStyle = batch.color;
      ctx.lineWidth = batch.width;
      ctx.stroke();
      batch = undefined;
    };
    const dot = Math.max(1, Math.round(this.#dpr));

    for (const entry of entries) {
      // LOD: an entity under a pixel is a dot, or nothing in a reduced frame.
      if (entry.size * scale < 1) {
        if (reduced) continue;
        const first = entry.prims[0];
        if (!first) continue;
        flush();
        device();
        ctx.fillStyle = this.#color(first.color);
        ctx.fillRect(
          Math.floor(cx + (entry.x - center.x) * k),
          Math.floor(cy - (entry.y - center.y) * k),
          dot,
          dot,
        );
        continue;
      }
      for (const prim of this.#primitives(entry)) {
        const color = this.#color(prim.color);
        if (prim.kind === 'point') {
          flush();
          device();
          ctx.fillStyle = color;
          ctx.fillRect(
            Math.round(cx + (prim.x - center.x) * k - dot / 2),
            Math.round(cy - (prim.y - center.y) * k - dot / 2),
            dot,
            dot,
          );
          continue;
        }
        if (prim.kind === 'fill') {
          flush();
          world();
          ctx.beginPath();
          buildPath(ctx, prim.path, center.x, center.y);
          const g = prim.gradient;
          if (g) {
            // The gradient is made in its unit frame; a fill paints it through the transform in
            // force when it fills, so that transform is world ∘ frame.
            const f = g.frame;
            ctx.setTransform(
              k * f.a,
              -k * f.b,
              k * f.c,
              -k * f.d,
              k * (f.e - center.x) + cx,
              -k * (f.f - center.y) + cy,
            );
            inWorld = false;
            ctx.fillStyle = this.#gradient(ctx, g);
          } else {
            device();
            ctx.fillStyle = color;
          }
          ctx.fill(prim.evenOdd ? 'evenodd' : 'nonzero');
          if (g) device();
          continue;
        }
        const tint = prim.kind === 'stroke' ? prim.hatch : undefined;
        if (tint && tint.spacing * scale < 1) {
          // ARCHITECTURE.md §7.2 LOD: hatch lines under a pixel apart → the area at their
          // average ink, which is what the lines would paint: a line width of every spacing
          // across them, and each dash (plus its round caps) of every repetition along them.
          // Families tint one by one, so their alphas compound as their lines would overlap.
          flush();
          world();
          ctx.beginPath();
          buildPath(ctx, tint.area, center.x, center.y);
          device();
          const w = this.#lineWidth(prim.lineweight) / k;
          const across = Math.min(1, w / tint.spacing);
          const along =
            tint.period > 0 ? Math.min(1, (tint.dashLength + tint.marks * w) / tint.period) : 1;
          ctx.globalAlpha = across * along;
          ctx.fillStyle = color;
          ctx.fill(tint.evenOdd ? 'evenodd' : 'nonzero');
          ctx.globalAlpha = 1;
          continue;
        }
        const width = this.#lineWidth(prim.lineweight);
        if (!batch || batch.color !== color || batch.width !== width) {
          flush();
          batch = { color, width };
          ctx.beginPath();
        }
        world();
        if (prim.kind === 'infinite') {
          const seg = clipInfinite(prim, visibleBox(this.#view, this.#width, this.#height));
          if (seg) {
            ctx.moveTo(seg[0] - center.x, seg[1] - center.y);
            ctx.lineTo(seg[2] - center.x, seg[3] - center.y);
          }
        } else {
          // LOD for a dashed primitive handed in directly (the transient layer).
          const solid = prim.continuous && (prim.patternLength ?? 0) * scale < 1;
          buildPath(ctx, solid ? prim.continuous! : prim.path, center.x, center.y);
        }
      }
    }
    flush();
  }

  /** A gradient fill's canvas gradient, in its unit frame, with the colours resolved. */
  #gradient(ctx: Canvas2D, g: FillGradient): CanvasGradient {
    const c1 = this.#color(g.colors[0]);
    const c2 = g.tint === undefined ? this.#color(g.colors[1]) : tintColor(c1, g.tint);
    const out =
      g.kind === 'linear'
        ? ctx.createLinearGradient(0, 0, 1, 0)
        : ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [t, mix] of g.stops) out.addColorStop(t, mixColors(c1, c2, mix));
    return out;
  }

  #color(c: PrimitiveColor): string {
    return c === 'foreground' ? this.#style.foreground : c;
  }

  /** Device pixels for a lineweight in millimetres; undefined is 1 px. */
  #lineWidth(mm: number | undefined): number {
    const css = lineweightPixels(
      mm === undefined ? 0 : Math.round(mm * 100),
      this.#paperSpace
        ? {
            show: this.#style.showLineweights,
            space: 'paper',
            pixelsPerMillimetre: this.#view.scale * this.#paperUnitsPerMm,
          }
        : { show: this.#style.showLineweights, space: 'model' },
    );
    return css * this.#dpr;
  }
}

/** Replays packed path commands, offset by the view centre. */
function buildPath(ctx: Canvas2D, a: readonly number[], ox: number, oy: number): void {
  for (let i = 0; i < a.length;) {
    switch (a[i]) {
      case PATH_M:
        ctx.moveTo(a[i + 1]! - ox, a[i + 2]! - oy);
        i += 3;
        break;
      case PATH_L:
        ctx.lineTo(a[i + 1]! - ox, a[i + 2]! - oy);
        i += 3;
        break;
      case PATH_A:
        // World y is up and the transform flips it, so increasing angles run CCW in the world.
        ctx.arc(a[i + 1]! - ox, a[i + 2]! - oy, a[i + 3]!, a[i + 4]!, a[i + 5]!, a[i + 6] === 0);
        i += 7;
        break;
      case PATH_E:
        ctx.ellipse(
          a[i + 1]! - ox,
          a[i + 2]! - oy,
          a[i + 3]!,
          a[i + 4]!,
          a[i + 5]!,
          a[i + 6]!,
          a[i + 7]!,
          a[i + 8] === 0,
        );
        i += 9;
        break;
      case PATH_Q:
        ctx.quadraticCurveTo(a[i + 1]! - ox, a[i + 2]! - oy, a[i + 3]! - ox, a[i + 4]! - oy);
        i += 5;
        break;
      case PATH_C:
        ctx.bezierCurveTo(
          a[i + 1]! - ox,
          a[i + 2]! - oy,
          a[i + 3]! - ox,
          a[i + 4]! - oy,
          a[i + 5]! - ox,
          a[i + 6]! - oy,
        );
        i += 7;
        break;
      case PATH_Z:
        ctx.closePath();
        i += 1;
        break;
      default:
        throw new Error(`bad path command ${a[i]} at ${i}`);
    }
  }
}

/** The part of an XLINE or RAY inside `box`, as x1 y1 x2 y2 (Liang–Barsky). */
function clipInfinite(
  p: Extract<RenderPrimitive, { kind: 'infinite' }>,
  box: Box,
): [number, number, number, number] | undefined {
  const len = Math.hypot(p.direction.x, p.direction.y);
  if (!(len > 0)) return undefined;
  const dx = p.direction.x / len;
  const dy = p.direction.y / len;
  let t0 = p.both ? -Infinity : 0;
  let t1 = Infinity;
  const clip = (q: number, d: number, lo: number, hi: number): boolean => {
    if (d === 0) return q >= lo && q <= hi;
    let a = (lo - q) / d;
    let b = (hi - q) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!clip(p.base.x, dx, box.minX, box.maxX) || !clip(p.base.y, dy, box.minY, box.maxY))
    return undefined;
  return [p.base.x + dx * t0, p.base.y + dy * t0, p.base.x + dx * t1, p.base.y + dy * t1];
}

const segDist = (
  p: { x: number; y: number },
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / l2)) : 0;
  return Math.hypot(p.x - (ax + t * vx), p.y - (ay + t * vy));
};

/** Whether angle `a` lies on the arc from a0 to a1 in the given direction. */
function onSweep(a: number, a0: number, a1: number, ccw: boolean): boolean {
  const TAU = 2 * Math.PI;
  const norm = (x: number): number => ((x % TAU) + TAU) % TAU;
  const sweep = Math.abs(a1 - a0);
  if (sweep >= TAU - 1e-12) return true;
  return ccw ? norm(a - a0) <= sweep : norm(a0 - a) <= sweep;
}

/** Distance from a world point to a primitive; 0 inside a fill. */
function distanceTo(prim: RenderPrimitive, p: { x: number; y: number }): number {
  if (prim.kind === 'point') return Math.hypot(p.x - prim.x, p.y - prim.y);
  if (prim.kind === 'infinite') {
    const len = Math.hypot(prim.direction.x, prim.direction.y);
    const dx = prim.direction.x / len;
    const dy = prim.direction.y / len;
    let t = (p.x - prim.base.x) * dx + (p.y - prim.base.y) * dy;
    if (!prim.both) t = Math.max(0, t);
    return Math.hypot(p.x - (prim.base.x + t * dx), p.y - (prim.base.y + t * dy));
  }
  // Walk the path, measuring each segment; a fill also counts its inside (even-odd ray test).
  // A dashed stroke is measured along its continuous path, so its gaps pick too.
  const a = prim.continuous ?? prim.path;
  let best = Infinity;
  let crossings = 0;
  let px = 0;
  let py = 0;
  let sx = 0;
  let sy = 0;
  const edge = (x: number, y: number): void => {
    best = Math.min(best, segDist(p, px, py, x, y));
    if (py > p.y !== y > p.y && p.x < ((x - px) * (p.y - py)) / (y - py) + px) crossings++;
    px = x;
    py = y;
  };
  for (let i = 0; i < a.length;) {
    switch (a[i]) {
      case PATH_M:
        px = sx = a[i + 1]!;
        py = sy = a[i + 2]!;
        i += 3;
        break;
      case PATH_L:
        edge(a[i + 1]!, a[i + 2]!);
        i += 3;
        break;
      case PATH_A:
      case PATH_E: {
        const isArc = a[i] === PATH_A;
        const [ccx, ccy, rx] = [a[i + 1]!, a[i + 2]!, a[i + 3]!];
        const ry = isArc ? rx : a[i + 4]!;
        const rot = isArc ? 0 : a[i + 5]!;
        const a0 = a[i + (isArc ? 4 : 6)]!;
        const a1 = a[i + (isArc ? 5 : 7)]!;
        const ccw = a[i + (isArc ? 6 : 8)] !== 0;
        if (isArc) {
          const ang = Math.atan2(p.y - ccy, p.x - ccx);
          if (onSweep(ang, a0, a1, ccw))
            best = Math.min(best, Math.abs(Math.hypot(p.x - ccx, p.y - ccy) - rx));
        }
        // Chords for the inside test and the ellipse distance; the arc distance above is exact.
        const n = 64;
        for (let j = 1; j <= n; j++) {
          const t = a0 + ((a1 - a0) * j) / n;
          const ux = rx * Math.cos(t);
          const uy = ry * Math.sin(t);
          edge(
            ccx + ux * Math.cos(rot) - uy * Math.sin(rot),
            ccy + ux * Math.sin(rot) + uy * Math.cos(rot),
          );
        }
        i += isArc ? 7 : 9;
        break;
      }
      case PATH_Q:
      case PATH_C: {
        // Chords of the curve, for the distance and the inside test.
        const q = a[i] === PATH_Q;
        const [x0, y0] = [px, py];
        const n = 16;
        for (let j = 1; j <= n; j++) {
          const t = j / n;
          const u = 1 - t;
          if (q) {
            edge(
              u * u * x0 + 2 * u * t * a[i + 1]! + t * t * a[i + 3]!,
              u * u * y0 + 2 * u * t * a[i + 2]! + t * t * a[i + 4]!,
            );
          } else {
            const [b0, b1, b2, b3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
            edge(
              b0 * x0 + b1 * a[i + 1]! + b2 * a[i + 3]! + b3 * a[i + 5]!,
              b0 * y0 + b1 * a[i + 2]! + b2 * a[i + 4]! + b3 * a[i + 6]!,
            );
          }
        }
        i += q ? 5 : 7;
        break;
      }
      case PATH_Z:
        edge(sx, sy);
        i += 1;
        break;
      default:
        i += 1;
    }
  }
  return prim.kind === 'fill' && crossings % 2 === 1 ? 0 : best;
}
