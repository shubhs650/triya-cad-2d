// The plot job (M2-17, ARCHITECTURE.md §12): model space or a layout turned into the parts a plot
// draws, each with what it plots with through a plot style table (`PlotResolver`). The parts are
// structurally the PDF writer's `PlotItem`s (`@triya/pdf`, which this package cannot import), in
// the space's own drawing units: a layout's parts are in paper space, its viewports' model space
// carried onto the sheet.
//
// AutoCAD rules encoded here:
// - What plots is what the screen shows (the same tessellation, `tessellateContext`), minus the
//   objects on layers whose Plot setting is off ("objects on that layer are not plotted"; inside a
//   block, an object on layer 0 takes the reference's layer, so a reference on a non-plotting
//   layer leaves out its layer-0 parts but plots those on layers of their own, as with off).
// - A plot style table resolves each object by the colour, lineweight, linetype and plot style it
//   has with ByLayer and ByBlock resolved: inside a block, ByBlock takes the reference's values and
//   layer 0 the reference's layer (`blockContext`, M1-13), so "every red object plots the same
//   way" holds for parts of blocks too.
// - Wipeout frames plot with WIPEOUTFRAME 1 only: 2 shows them on screen and leaves them off the
//   plot ("frames are displayed, but not plotted", M2-24 part 2).
// - Text glyphs and hatch pattern lines plot continuous whatever the plot style linetype, as
//   AutoCAD draws them (M2-16).
// - A layout plots its paper space and every viewport that shows model space, clipped to its
//   frame (or its clip entity), with the viewport's frozen layers left out, its layer overrides
//   applied (VPLAYER, M1-62) and, under PSLTSCALE, model linetypes scaled to paper units.
// - "Plot paperspace last" (Plot dialog, More Options): off by default, so paper space plots
//   first and the viewports over it; on, paper space plots on top. AutoCAD's help describes the
//   option as "Plots paper space geometry first. Usually, paper space geometry is plotted before
//   model space geometry", which contradicts its name; the name and the usual reading (off:
//   paper space first) are encoded here, an ambiguity noted in the PR.
//
// - A PDF underlay plots its page's own content (M2-16 part 5): the part names its definition's
//   file and page, and the PDF writer copies that page from the file the app supplied.
//
// - A wipeout (and a text background mask in the background colour) plots in the paper's white,
//   not through the table: on a monochrome plot it was a black box (M2-24 part 2).
//
// Not plotted: an image whose bitmap the app has not loaded, which plots its frame only.

import {
  viewportFrame,
  viewportLayers,
  viewportScale,
  viewportShowsModel,
  viewportTransform,
  VIEWPORT_NON_RECT_CLIP,
  type Color,
  type DocumentModel,
  type Entity,
  type EntityId,
  type Handle,
  type NonGraphicalObject,
  type PdfDefinition,
  type SortEntsTable,
  type ViewportGeometry,
} from '@triya/engine';
import { expandInsert, expands, insertClips, transformPrimitive } from '../blocks';
import type { Affine } from '../affine';
import { imageFrames, withLayers } from '../document-settings';
import { adjustPixels } from '../image';
import { createPaint } from '../paint';
import { drawOrder } from '../style/draw-order';
import { mixColors, parseHex, tintColor } from '../style/mix';
import {
  effectiveLayer,
  resolveColor,
  resolveLinetype,
  resolveLineweight,
  type BlockContext,
  type StyleSource,
} from '../style/resolve';
import { tessellate, type Paint, type TessellateContext } from '../tessellate';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  type PrimitiveColor,
  type PrimitiveFrame,
  type RasterPixels,
  type RenderPrimitive,
} from '../types';
import type { PlotObject, PlotProperties, PlotResolver } from './resolver';

/** A paper colour, 0–255 per channel. */
export type PlotRgb = readonly [number, number, number];

interface PlotPartBase {
  readonly paint: PlotProperties;
  /**
   * The layer the part plots from: its object's effective layer (inside a block, layer 0 is the
   * reference's), by name. An SVG plot groups parts by it (M2-18).
   */
  readonly layer?: string;
  /** Object transparency, below 1; absent is opaque. */
  readonly opacity?: number;
  /** Closed polygons (flat x, y pairs) the part shows within: XCLIPs and viewport frames. */
  readonly clip?: readonly (readonly number[])[];
}

/** A stroked or filled renderer path (`PlotPathItem`). */
export interface PlotPathPart extends PlotPartBase {
  readonly kind: 'stroke' | 'fill';
  readonly path: readonly number[];
  readonly evenOdd?: boolean;
  readonly gradient?: {
    readonly kind: 'linear' | 'radial';
    readonly frame: PrimitiveFrame;
    readonly stops: readonly { readonly offset: number; readonly color: PlotRgb }[];
  };
  readonly image?: {
    readonly pixels: RasterPixels;
    readonly frame: PrimitiveFrame;
    readonly width: number;
    readonly height: number;
  };
  /** TrueType text: the glyphs the fill's outlines draw (M2-16 part 3). */
  readonly glyphs?: readonly PlotGlyphPart[];
  /** A PDF underlay (`@triya/pdf` `PlotUnderlay`); the path is its clip boundary. */
  readonly underlay?: PlotUnderlayPart;
}

/** A PDF underlay's page as a plot shows it: the definition's file and page, and its settings. */
export interface PlotUnderlayPart {
  readonly definition: Handle;
  /** DXF 1 of the PDFDEFINITION: the file as the drawing names it. */
  readonly fileName: string;
  /** DXF 2 of the PDFDEFINITION: the page number from 1. */
  readonly page: string;
  /** Underlay space (inches) → the space's units. */
  readonly frame: PrimitiveFrame;
  readonly clipped: boolean;
  readonly contrast: number;
  readonly fade: number;
  readonly monochrome: boolean;
}

/** A placed TrueType glyph (`PlacedGlyph`), its font reduced to what a PDF embeds. */
export interface PlotGlyphPart {
  readonly font: { readonly bytes?: Uint8Array };
  readonly index: number;
  readonly codePoint: number;
  readonly m: PrimitiveFrame;
}

export interface PlotPointPart extends PlotPartBase {
  readonly kind: 'point';
  readonly x: number;
  readonly y: number;
}

export interface PlotInfinitePart extends PlotPartBase {
  readonly kind: 'infinite';
  readonly base: { readonly x: number; readonly y: number };
  readonly direction: { readonly x: number; readonly y: number };
  readonly both: boolean;
  readonly dashes?: { readonly lengths: readonly number[]; readonly period: number };
}

/** What a plot draws, in order: structurally `@triya/pdf`'s `PlotItem`. */
export type PlotPart = PlotPathPart | PlotPointPart | PlotInfinitePart;

export interface PlotSource {
  readonly resolver: PlotResolver;
  /** What the screen tessellates with (`Canvas2DRenderer.tessellateContext`): fonts, patterns. */
  readonly tessellate?: TessellateContext;
  /** An IMAGEDEF's bitmap, as the app decoded it; undefined plots the image's frame. */
  readonly images?: (definition: Handle) => RasterPixels | undefined;
  /** `$LWDEFAULT`, hundredths of a millimetre; AutoCAD's 25 when absent. */
  readonly lwDefault?: number;
  /** "Plot paperspace last" (a layout only); off when absent. */
  readonly paperspaceLast?: boolean;
}

/** What an INSERT hands down for plotting: the display context and the colour it resolved. */
interface PlotContext extends BlockContext {
  readonly plotColor: Color;
}

const COLOR_7: Color = { kind: 'aci', index: 7 };
const WHITE: PlotRgb = [255, 255, 255];
const BLACK: PlotRgb = [0, 0, 0];

/** The colour an object plots by before the table: ByLayer and ByBlock resolved, as a `Color`. */
function objectColor(e: Entity, src: StyleSource, block: PlotContext | undefined): Color {
  const c = e.color;
  if (c.kind === 'byBlock') return block ? block.plotColor : COLOR_7;
  const own = c.kind === 'byLayer' ? (effectiveLayer(e, src, block)?.color ?? COLOR_7) : c;
  // A negative layer colour only means the layer is off.
  return own.kind === 'aci' ? { kind: 'aci', index: Math.abs(own.index) } : own;
}

/** The plot style name an object plots by (a named plot style drawing): its own, or its layer's. */
function plotStyleName(e: Entity, src: StyleSource, model: DocumentModel, block?: BlockContext) {
  const handle = e.plotStyle ?? effectiveLayer(e, src, block)?.plotStyle;
  return handle === undefined ? undefined : model.tables.plotStyles.get(handle)?.name;
}

/** What an object plots by: ByLayer and ByBlock resolved (`PlotResolver`'s input). */
export function plotObject(
  e: Entity,
  model: DocumentModel,
  block?: BlockContext,
  lwDefault = 25,
): PlotObject {
  const src = { layers: model.tables.layers, lwDefault };
  const ctx = block && 'plotColor' in block ? (block as PlotContext) : undefined;
  const linetype = resolveLinetype(e, src, block);
  const style = plotStyleName(e, src, model, block);
  return {
    color: objectColor(e, src, ctx),
    lineweight: resolveLineweight(e, src, block),
    ...(linetype ? { linetype } : {}),
    ...(style !== undefined ? { plotStyle: style } : {}),
  };
}

/** A primitive's colour on paper: the foreground (ACI 7) black, the background white. */
function paperRgb(c: PrimitiveColor): PlotRgb {
  if (c === 'foreground') return BLACK;
  if (c === 'background') return WHITE;
  return parseHex(c) ?? BLACK;
}

const hex = (c: PlotRgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const isSortEnts = (o: NonGraphicalObject): o is SortEntsTable => o.type === 'SORTENTSTABLE';

/** Paints, references and block orders for one plot, memoised. */
class Plotter {
  readonly #model: DocumentModel;
  readonly #src: PlotSource;
  readonly #lwDefault: number;
  readonly #tessellate: TessellateContext;
  readonly #orders = new Map<Handle, readonly EntityId[]>();
  #sortTables: Map<Handle, SortEntsTable> | undefined;
  #clips: ReturnType<typeof insertClips> | undefined;
  readonly #base: ReturnType<typeof createPaint>;

  constructor(model: DocumentModel, src: PlotSource) {
    this.#model = model;
    this.#src = src;
    this.#lwDefault = src.lwDefault ?? 25;
    // The screen's context, with the frames a plot draws: WIPEOUTFRAME 2 shows them on screen
    // and leaves them off the plot (AutoCAD 2024 Help, "WIPEOUTFRAME (System Variable)").
    this.#tessellate = { ...src.tessellate, frames: imageFrames(model, 'plot') };
    this.#base = createPaint({ lwDefault: this.#lwDefault });
  }

  /** A block's entities in draw order (its SORTENTSTABLE applied). */
  order(block: Handle): readonly EntityId[] {
    const memo = this.#orders.get(block);
    if (memo) return memo;
    const model = this.#model;
    if (!this.#sortTables) {
      this.#sortTables = new Map();
      for (const o of model.objects.values()) if (isSortEnts(o)) this.#sortTables.set(o.block, o);
    }
    const table = this.#sortTables.get(block);
    const ids = model.blockEntities(block);
    const order = table
      ? drawOrder(
          ids.map((id) => model.ids.handleOf(id)!),
          table.entries,
        ).map((h) => model.ids.idOf(h)!)
      : [...ids];
    this.#orders.set(block, order);
    return order;
  }

  /** The screen's paint, but nothing on a layer that does not plot. */
  readonly paint = (e: Entity, model: DocumentModel, block?: BlockContext): Paint | undefined => {
    const layer = effectiveLayer(e, { layers: model.tables.layers, lwDefault: 0 }, block);
    if (layer && !layer.plot) return undefined;
    return this.#base(e, model, block);
  };

  readonly insertContext = (
    insert: Entity,
    model: DocumentModel,
    outer?: BlockContext,
  ): PlotContext | undefined => {
    const ctx = this.#base.insertContext(insert, model, outer);
    if (!ctx) return undefined;
    const src = { layers: model.tables.layers, lwDefault: this.#lwDefault };
    const plotColor = objectColor(insert, src, outer as PlotContext | undefined);
    return { ...ctx, plotColor };
  };

  /**
   * One entity's parts: as painted with `model`'s layers (a viewport's, when it overrides any),
   * its linetypes scaled by `linetypeScale`, carried by `m`, within `clip`; parts on a layer in
   * `frozen` left out.
   */
  entityParts(
    e: Entity,
    model: DocumentModel,
    out: PlotPart[],
    o: {
      readonly linetypeScale?: number;
      readonly m?: Affine;
      readonly clip?: readonly (readonly number[])[];
      readonly frozen?: ReadonlySet<Handle>;
    } = {},
  ): void {
    const ltMul = o.linetypeScale ?? 1;
    const block = (h: Handle) => model.blocks.get(h);
    let prims: readonly RenderPrimitive[];
    let owners: readonly { entity: Entity; context: BlockContext | undefined }[];
    if (expands(e, block)) {
      const x = expandInsert(
        e,
        {
          model,
          paint: this.paint,
          insertContext: this.insertContext,
          order: (h) => this.order(h),
          tessellate: this.#tessellate,
          clip: (insert) => (this.#clips ??= insertClips(model))(insert),
        },
        { dashes: true, linetypeScale: ltMul, owners: true },
      );
      prims = x.prims;
      owners = x.owners ?? [];
    } else {
      const paint = this.paint(e, model);
      if (!paint) return;
      const used =
        paint.linetype && ltMul !== 1
          ? { ...paint, linetype: { ...paint.linetype, scale: paint.linetype.scale * ltMul } }
          : paint;
      prims = tessellate(e.geom, used, this.#tessellate);
      const owner = { entity: e, context: undefined };
      owners = prims.map(() => owner);
    }
    let last: { entity: Entity; context: BlockContext | undefined } | undefined;
    let props: PlotProperties | undefined;
    let object: PlotObject | undefined;
    let shown: PrimitiveColor = 'foreground';
    let layer: string | undefined;
    // XCLIP polygons carried into the space, joined to `clip`; one array per source array.
    const clips = new Map<readonly (readonly number[])[], readonly (readonly number[])[]>();
    for (let i = 0; i < prims.length; i++) {
      const raw = prims[i]!;
      if (o.frozen && 'layers' in raw && raw.layers?.some((l) => o.frozen!.has(l))) continue;
      const owner = owners[i]!;
      if (owner !== last) {
        last = owner;
        object = plotObject(owner.entity, model, owner.context, this.#lwDefault);
        props = this.#src.resolver.resolve(object);
        const src = { layers: model.tables.layers, lwDefault: this.#lwDefault };
        shown = resolveColor(owner.entity, src, owner.context);
        layer = effectiveLayer(owner.entity, src, owner.context)?.name;
      }
      const prim = o.m ? transformPrimitive(raw, o.m) : raw;
      let clip = o.clip;
      if (prim.clip) {
        let joined = clips.get(prim.clip);
        if (!joined) clips.set(prim.clip, (joined = [...(o.clip ?? []), ...prim.clip]));
        clip = joined;
      }
      const part = this.part(prim, object!, props!, shown);
      if (!part) continue;
      const tagged = layer === undefined ? part : { ...part, layer };
      out.push(clip ? { ...tagged, clip } : tagged);
    }
  }

  /** One primitive as a plot part painted with `props`; undefined for what does not plot. */
  part(
    prim: RenderPrimitive,
    object: PlotObject,
    props: PlotProperties,
    shown: PrimitiveColor,
  ): PlotPart | undefined {
    const resolver = this.#src.resolver;
    const common = prim.opacity !== undefined ? { opacity: prim.opacity } : {};
    if (prim.kind === 'point')
      return { kind: 'point', x: prim.x, y: prim.y, paint: props, ...common };
    if (prim.kind === 'infinite') {
      return {
        kind: 'infinite',
        base: prim.base,
        direction: prim.direction,
        both: prim.both,
        paint: props,
        ...(prim.dashes ? { dashes: prim.dashes } : {}),
        ...common,
      };
    }
    const u = prim.underlay;
    if (u) {
      const def = this.#model.objects.get(u.definition);
      const pdf = def?.type === 'PDFDEFINITION' ? (def as PdfDefinition) : undefined;
      return {
        kind: 'fill',
        path: prim.path,
        paint: props,
        underlay: {
          definition: u.definition,
          fileName: pdf?.fileName ?? '',
          page: pdf?.page ?? '1',
          frame: u.frame,
          clipped: u.clipped,
          contrast: u.contrast,
          fade: u.fade,
          monochrome: u.monochrome,
        },
        ...common,
      };
    }
    // A missing image's name shows only while its bitmap is not loaded.
    if (prim.missingImage !== undefined && this.#src.images?.(prim.missingImage)) return undefined;
    const solid: PlotProperties = { ...props, linetype: { kind: 'object' }, fillStyle: 'solid' };
    // A colour other than the object's (a gradient's, an MTEXT run's) plots through the style
    // that colour takes (ours: the help is silent).
    const onPaper = (c: PrimitiveColor): PlotRgb => {
      const [r, g, b] = paperRgb(c);
      return resolver.resolve({ ...object, color: { kind: 'rgb', r, g, b } }).color;
    };
    const base = { kind: prim.kind, ...(prim.evenOdd ? { evenOdd: true } : {}), ...common };
    const g = prim.gradient;
    if (g) {
      const c1 = hex(paperRgb(g.colors[0]));
      const c2 = g.tint === undefined ? hex(paperRgb(g.colors[1])) : tintColor(c1, g.tint);
      return {
        ...base,
        path: prim.path,
        paint: solid,
        gradient: {
          kind: g.kind,
          frame: g.frame,
          stops: g.stops.map(([offset, mix]) => ({
            offset,
            color: onPaper(mixColors(c1, c2, mix)),
          })),
        },
      };
    }
    const im = prim.image;
    if (im) {
      const src = this.#src.images?.(im.definition);
      // No bitmap: the frame alone, as the screen outlines it.
      if (!src) return { kind: 'stroke', path: prim.path, paint: solid, ...common };
      const data = adjustPixels(
        { width: src.width, height: src.height, data: Uint8ClampedArray.from(src.data) },
        {
          brightness: im.brightness,
          contrast: im.contrast,
          fade: im.fade,
          transparent: im.transparent,
          color: paperRgb(prim.color),
          background: WHITE,
        },
      );
      return {
        ...base,
        path: prim.path,
        paint: solid,
        image: {
          pixels: { width: src.width, height: src.height, data },
          frame: im.frame,
          width: im.width,
          height: im.height,
        },
      };
    }
    // A wipeout, or a text background mask in the background colour, masks in the paper's white:
    // it hides what is under it, so no plot style table recolours it.
    if (prim.kind === 'fill' && prim.color === 'background') {
      return { ...base, path: prim.path, paint: { ...solid, color: WHITE } };
    }
    const continuous = prim.text !== undefined || prim.hatch !== undefined;
    // An MTEXT colour override: the run's own colour, through the table.
    const textPaint =
      prim.kind === 'fill' && prim.text && prim.color !== shown
        ? { ...solid, color: onPaper(prim.color) }
        : solid;
    // A plot style linetype dashes the object's continuous path itself.
    const dashed = props.linetype.kind === 'plot' && !continuous;
    const glyphs = prim.kind === 'fill' ? prim.text?.glyphs : undefined;
    return {
      ...base,
      path: dashed ? (prim.continuous ?? prim.path) : prim.path,
      paint: continuous ? (prim.text ? textPaint : solid) : props,
      ...(glyphs ? { glyphs } : {}),
    };
  }
}

/** A frame box as a closed polygon. */
const boxPolygon = (b: { minX: number; minY: number; maxX: number; maxY: number }) => [
  b.minX,
  b.minY,
  b.maxX,
  b.minY,
  b.maxX,
  b.maxY,
  b.minX,
  b.maxY,
];

/** Arcs and curves flattened into this many chords per full turn (a clip outline's precision). */
const CHORDS_PER_TURN = 128;

/**
 * A renderer path as closed polygons, one per subpath, curves flattened: a non-rectangular
 * viewport's clip outline.
 */
export function pathPolygons(path: readonly number[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  const end = () => {
    if (cur.length >= 6) out.push(cur);
    cur = [];
  };
  const last = () => ({ x: cur[cur.length - 2] ?? 0, y: cur[cur.length - 1] ?? 0 });
  const curve = (at: (t: number) => readonly [number, number], sweep: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * CHORDS_PER_TURN));
    for (let k = cur.length === 0 ? 0 : 1; k <= n; k++) cur.push(...at(k / n));
  };
  for (let i = 0; i < path.length;) {
    switch (path[i]) {
      case PATH_M:
        end();
        cur.push(path[i + 1]!, path[i + 2]!);
        i += 3;
        break;
      case PATH_L:
        cur.push(path[i + 1]!, path[i + 2]!);
        i += 3;
        break;
      case PATH_A: {
        const [cx, cy, r, a0, a1, ccw] = path.slice(i + 1, i + 7) as number[];
        const sweep = sweepOf(a0!, a1!, ccw! !== 0);
        curve(
          (t) => [cx! + r! * Math.cos(a0! + sweep * t), cy! + r! * Math.sin(a0! + sweep * t)],
          sweep,
        );
        i += 7;
        break;
      }
      case PATH_E: {
        const [cx, cy, rx, ry, rot, a0, a1, ccw] = path.slice(i + 1, i + 9) as number[];
        const sweep = sweepOf(a0!, a1!, ccw! !== 0);
        const cr = Math.cos(rot!);
        const sr = Math.sin(rot!);
        curve((t) => {
          const u = rx! * Math.cos(a0! + sweep * t);
          const v = ry! * Math.sin(a0! + sweep * t);
          return [cx! + u * cr - v * sr, cy! + u * sr + v * cr];
        }, sweep);
        i += 9;
        break;
      }
      case PATH_Q: {
        const p0 = last();
        const [x1, y1, x, y] = path.slice(i + 1, i + 5) as number[];
        curve((t) => {
          const s = 1 - t;
          return [
            s * s * p0.x + 2 * s * t * x1! + t * t * x!,
            s * s * p0.y + 2 * s * t * y1! + t * t * y!,
          ];
        }, Math.PI / 2);
        i += 5;
        break;
      }
      case PATH_C: {
        const p0 = last();
        const [x1, y1, x2, y2, x, y] = path.slice(i + 1, i + 7) as number[];
        curve((t) => {
          const s = 1 - t;
          const a = s * s * s;
          const b = 3 * s * s * t;
          const c = 3 * s * t * t;
          const d = t * t * t;
          return [a * p0.x + b * x1! + c * x2! + d * x!, a * p0.y + b * y1! + c * y2! + d * y!];
        }, Math.PI / 2);
        i += 7;
        break;
      }
      case PATH_Z:
        end();
        i += 1;
        break;
      default:
        // An unknown command ends the walk: the outline is unusable past it.
        end();
        return out;
    }
  }
  end();
  return out;
}

/** The signed sweep from a0 to a1, counter-clockwise when `ccw`, as the canvas's arc() takes it. */
function sweepOf(a0: number, a1: number, ccw: boolean): number {
  const turn = 2 * Math.PI;
  let d = a1 - a0;
  if (ccw) {
    if (d < 0) d = (d % turn) + turn;
    if (Math.abs(a1 - a0) >= turn) d = turn;
  } else {
    if (d > 0) d = (d % turn) - turn;
    if (Math.abs(a1 - a0) >= turn) d = -turn;
  }
  return d;
}

/** The block record of model space. */
function modelSpace(model: DocumentModel): Handle | undefined {
  for (const r of model.tables.blockRecords.values())
    if (r.name.toLowerCase() === '*model_space') return r.handle;
  return undefined;
}

/**
 * What plotting the space `block` (model space, or a layout's paper space) draws, in its own
 * drawing units, in plot order.
 */
export function plotParts(model: DocumentModel, block: Handle, src: PlotSource): PlotPart[] {
  const plotter = new Plotter(model, src);
  const out: PlotPart[] = [];
  const msp = modelSpace(model);
  const layout = block === msp ? undefined : model.layouts.find((l) => l.blockRecord === block);
  const viewports: Entity[] = [];
  const paper: PlotPart[] = [];
  for (const id of plotter.order(block)) {
    const e = model.entity(id);
    if (!e) continue;
    if (layout && msp !== undefined && e.geom.kind === 'VIEWPORT' && viewportShowsModel(e.geom))
      viewports.push(e);
    plotter.entityParts(e, model, layout ? paper : out);
  }
  if (!layout || msp === undefined) return out;
  // PSLTSCALE (the layout's DXF 70 bit 1, on unless stated).
  const psltscale = ((layout.flags ?? 1) & 1) !== 0;
  const views: PlotPart[] = [];
  for (const vp of viewports) {
    const g = vp.geom as ViewportGeometry;
    const frame = viewportFrame(g);
    const outline = viewportClip(model, g);
    const clip = [boxPolygon(frame), ...(outline ?? [])];
    const shown = viewportLayers(model.tables.layers, vp.handle);
    const seen = shown ? withLayers(model, shown.layers) : model;
    const frozen = g.frozenLayers.length > 0 ? new Set(g.frozenLayers) : undefined;
    const vs = viewportScale(g);
    const m = viewportTransform(g);
    for (const id of plotter.order(msp)) {
      const e = model.entity(id);
      if (!e || frozen?.has(e.layer)) continue;
      plotter.entityParts(e, seen, views, {
        // PSLTSCALE 1: dashes in a viewport are as long as in paper space.
        linetypeScale: psltscale && vs > 0 ? 1 / vs : 1,
        m,
        clip,
        ...(frozen ? { frozen } : {}),
      });
    }
  }
  return src.paperspaceLast ? [...views, ...paper] : [...paper, ...views];
}

/** A non-rectangular viewport's clip entity as polygons (M1-62), or undefined. */
function viewportClip(model: DocumentModel, g: ViewportGeometry): number[][] | undefined {
  if ((g.flags & VIEWPORT_NON_RECT_CLIP) === 0 || g.clipBoundary === undefined) return undefined;
  const id = model.ids.idOf(g.clipBoundary);
  const e = id === undefined ? undefined : model.entity(id);
  if (!e) return undefined;
  const polygons = tessellate(e.geom, { color: 'foreground' }).flatMap((p) =>
    p.kind === 'stroke' ? pathPolygons(p.path) : [],
  );
  return polygons.length > 0 ? polygons : undefined;
}
