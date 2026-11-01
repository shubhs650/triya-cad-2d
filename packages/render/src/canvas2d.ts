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
  SpatialIndex,
} from '@triya/engine';
import { defaultPaint } from './paint';
import { tessellate, type Paint } from './tessellate';
import {
  PATH_A,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Z,
  screenToWorld,
  visibleBox,
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
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise?: boolean): void;
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
  /** Entity → paint; undefined hides it. Defaults to `defaultPaint`. */
  readonly paint?: (e: Entity, model: DocumentModel) => Paint | undefined;
  readonly now?: () => number;
  /** Runs a callback when the browser is idle (requestIdleCallback in the app). */
  readonly requestIdle?: (cb: () => void) => void;
}

export const DEFAULT_STYLE: RenderStyle = {
  background: '#212830',
  foreground: '#ffffff',
  showLineweights: false,
};

/** The frame budget (ARCHITECTURE.md §7.2): 60 fps. */
const FRAME_BUDGET_MS = 16;
/** Screen pixels per millimetre for lineweight display (96 dpi). */
const PX_PER_MM = 96 / 25.4;

export class Canvas2DRenderer implements Renderer {
  readonly #model: DocumentModel;
  readonly #index: SpatialIndex;
  readonly #block: Handle;
  readonly #surface: Surface;
  readonly #scene: Surface;
  readonly #transientLayer: Surface;
  readonly #paint: (e: Entity, model: DocumentModel) => Paint | undefined;
  readonly #now: () => number;
  readonly #requestIdle: (cb: () => void) => void;

  readonly #cache = new Map<EntityId, readonly RenderPrimitive[]>();
  #order = new Map<EntityId, number>();
  #orderDirty = true;
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
    this.#now = o.now ?? (() => performance.now());
    this.#requestIdle = o.requestIdle ?? ((cb) => setTimeout(cb, 50));
    for (const id of this.#model.blockEntities(this.#block)) this.#cacheEntity(id);
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
    if (
      e?.added?.length ||
      e?.removed?.length ||
      e?.updated?.some((u) => u.before.owner !== u.after.owner)
    )
      this.#orderDirty = true;
    // A layer change can recolour or hide any entity on it: re-resolve the whole block.
    if (cs.tables?.layers) {
      this.#cache.clear();
      for (const id of this.#model.blockEntities(this.#block)) this.#cacheEntity(id);
    }
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
      this.#drawPrimitives(
        t.ctx,
        this.#transient.map((p) => [p, undefined] as const),
        false,
      );
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
      const prims = this.#cache.get(id);
      if (!prims) continue;
      let d = Infinity;
      for (const prim of prims) d = Math.min(d, distanceTo(prim, p));
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
    if (id !== undefined) this.#cache.delete(id);
  }

  #cacheEntity(id: EntityId): void {
    const e = this.#model.entity(id);
    if (!e) return;
    const paint = this.#paint(e, this.#model);
    if (paint) this.#cache.set(id, tessellate(e.geom, paint));
    else this.#cache.delete(id);
  }

  #drawScene(reduced: boolean): void {
    this.sceneDraws++;
    const { ctx, canvas } = this.#scene;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.#style.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.#orderDirty) {
      this.#order = new Map(this.#model.blockEntities(this.#block).map((id, i) => [id, i]));
      this.#orderDirty = false;
    }
    const ids = this.#index
      .query(this.#block, visibleBox(this.#view, this.#width, this.#height))
      .filter((id) => this.#cache.has(id));
    ids.sort((a, b) => (this.#order.get(a) ?? 0) - (this.#order.get(b) ?? 0));
    const items: (readonly [RenderPrimitive, EntityId | undefined])[] = [];
    for (const id of ids) for (const prim of this.#cache.get(id)!) items.push([prim, id]);
    this.#drawPrimitives(ctx, items, reduced);
  }

  /** Draws primitives, batching consecutive strokes of one colour and width into one path. */
  #drawPrimitives(
    ctx: Canvas2D,
    items: readonly (readonly [RenderPrimitive, EntityId | undefined])[],
    reduced: boolean,
  ): void {
    const { center, scale } = this.#view;
    const k = scale * this.#dpr;
    const cx = (this.#width * this.#dpr) / 2;
    const cy = (this.#height * this.#dpr) / 2;
    const world = (): void => ctx.setTransform(k, 0, 0, -k, cx, cy);
    const device = (): void => ctx.setTransform(1, 0, 0, 1, 0, 0);
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
    const lastSize = new Map<EntityId, number>();
    const pixelSize = (id: EntityId | undefined): number => {
      if (id === undefined) return Infinity;
      const known = lastSize.get(id);
      if (known !== undefined) return known;
      const b = this.#index.bounds(id);
      const s =
        b?.kind === 'box'
          ? Math.max(b.box.maxX - b.box.minX, b.box.maxY - b.box.minY) * scale
          : Infinity;
      lastSize.set(id, s);
      return s;
    };
    const dotted = new Set<EntityId>();

    for (const [prim, id] of items) {
      const color = this.#color(prim.color);
      // LOD: an entity under a pixel is a dot, or nothing in a reduced frame.
      if (pixelSize(id) < 1) {
        if (reduced || dotted.has(id!)) continue;
        dotted.add(id!);
        const b = this.#index.bounds(id!);
        if (b?.kind !== 'box') continue;
        flush();
        device();
        ctx.fillStyle = color;
        ctx.fillRect(
          Math.floor(cx + ((b.box.minX + b.box.maxX) / 2 - center.x) * k),
          Math.floor(cy - ((b.box.minY + b.box.maxY) / 2 - center.y) * k),
          Math.max(1, Math.round(this.#dpr)),
          Math.max(1, Math.round(this.#dpr)),
        );
        continue;
      }
      if (prim.kind === 'point') {
        flush();
        device();
        ctx.fillStyle = color;
        const d = Math.max(1, Math.round(this.#dpr));
        ctx.fillRect(
          Math.round(cx + (prim.x - center.x) * k - d / 2),
          Math.round(cy - (prim.y - center.y) * k - d / 2),
          d,
          d,
        );
        continue;
      }
      const width = this.#lineWidth(prim.kind === 'fill' ? undefined : prim.lineweight);
      if (prim.kind === 'fill') {
        flush();
        world();
        ctx.beginPath();
        buildPath(ctx, prim.path, center.x, center.y);
        device();
        ctx.fillStyle = color;
        ctx.fill(prim.evenOdd ? 'evenodd' : 'nonzero');
        continue;
      }
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
        buildPath(ctx, prim.path, center.x, center.y);
      }
    }
    flush();
  }

  #color(c: PrimitiveColor): string {
    return c === 'foreground' ? this.#style.foreground : c;
  }

  /** Device pixels: 1 CSS px, or the lineweight at 96 dpi when LWT is on (at least 1 px). */
  #lineWidth(mm: number | undefined): number {
    const css = this.#style.showLineweights && mm !== undefined ? Math.max(1, mm * PX_PER_MM) : 1;
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
  const a = prim.path;
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
