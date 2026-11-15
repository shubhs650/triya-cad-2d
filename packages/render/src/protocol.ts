// Messages between RendererHost (main thread) and the render worker. Plain structured-clone
// postMessage, as ARCHITECTURE.md §3 draws it: the stream is one-way except for the requests
// that need an answer (hit test, entities in a rectangle, flush, thumbnail, extents), which carry an id.

import type { DrawingDimensionHealth } from '@triya/dims';
import type {
  Box,
  ChangeSet,
  DragMotion,
  EntityId,
  GroupGrip,
  MTextGeometry,
  EnclosedSpace,
  OsnapHit,
  OsnapQuery,
  QuickMeasure,
  QuickQuery,
  TextGeometry,
  TextOutline,
  Vec2,
  UnderlaySnapPage,
} from '@triya/engine';
import type { PlotPart } from './plot/job';
import type { FontSources, PlotRequest, RenderDocument } from './session';
import type {
  DrawnEntity,
  RasterPixels,
  RenderPrimitive,
  RenderStyle,
  ScreenRect,
  SelectQuery,
  UnderlayRaster,
  UnderlayRequest,
  ViewTransform,
} from './types';

export type HostMessage =
  | {
      readonly type: 'init';
      /** The transferred OffscreenCanvas (typed loosely: the worker only knows it by shape). */
      readonly canvas: unknown;
      readonly document: RenderDocument;
      readonly style?: RenderStyle;
      /** The user's .pat files (M1-50). */
      readonly patterns?: readonly string[];
      /** Fonts for text (M1-72). */
      readonly fonts?: FontSources;
      /**
       * The drawing's engine's end of a MessageChannel (M2-62), transferred: the engine posts
       * each change set it applies on it as a `ChangeMessage`, so the worker draws it without
       * waiting on the main thread.
       */
      readonly changes?: unknown;
    }
  | {
      readonly type: 'resize';
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
    }
  | { readonly type: 'view'; readonly view: ViewTransform }
  /**
   * A change set the engine applied. `seq` is its place in the drawing's change log (M2-62):
   * the engine posts the same change on the worker's change port, and whichever copy comes
   * first is applied, the other skipped.
   */
  | { readonly type: 'apply'; readonly change: ChangeSet; readonly seq?: number }
  | { readonly type: 'transient'; readonly primitives: readonly RenderPrimitive[] }
  | { readonly type: 'style'; readonly style: RenderStyle }
  | { readonly type: 'patterns'; readonly sources: readonly string[] }
  | { readonly type: 'fonts'; readonly fonts: FontSources }
  | { readonly type: 'frame' }
  /** An IMAGEDEF's decoded bitmap, its pixel buffer transferred; null forgets it (M1-19). */
  | { readonly type: 'image'; readonly definition: string; readonly pixels: RasterPixels | null }
  /** A PDFDEFINITION's page as the app drew it, copied; null forgets it (M1-20). */
  | {
      readonly type: 'underlay';
      /** The request's `underlayKey`: the definition, with any layers turned off (M2-38). */
      readonly definition: string;
      readonly raster: UnderlayRaster | null;
    }
  /** A PDFDEFINITION's page size as read from its PDF; null forgets it (M2-68). */
  | {
      readonly type: 'underlayPage';
      readonly definition: string;
      readonly page: { readonly width: number; readonly height: number } | null;
    }
  /** A PDFDEFINITION's page geometry for osnap, copied; null forgets it (M2-22). */
  | {
      readonly type: 'underlaySnap';
      readonly definition: string;
      readonly page: UnderlaySnapPage | null;
    }
  | {
      readonly type: 'hitTest';
      readonly id: number;
      readonly screen: { readonly x: number; readonly y: number };
      readonly aperture: number;
    }
  /** The entities a selection window takes (M2-03); the answer is a `reply` with ids. */
  | { readonly type: 'select'; readonly id: number; readonly query: SelectQuery }
  /** The entities to draw selected (M2-03). */
  | { readonly type: 'highlight'; readonly ids: readonly EntityId[] }
  /** The objects a command drags with the cursor (M2-06 part 2); null ends the drag. */
  | { readonly type: 'drag'; readonly motion: DragMotion | null }
  /** The objects to show grips on and the hot grip (M2-06 part 2). */
  | {
      readonly type: 'grips';
      readonly ids: readonly EntityId[];
      readonly hot: Vec2 | null;
      /** The groups shown by one grip (GROUPDISPLAYMODE, M3-13). */
      readonly groups?: readonly GroupGrip[];
    }
  /** The cursor for the grip hover colour (M3-05 part 2); null, none. */
  | { readonly type: 'grip-hover'; readonly at: Vec2 | null; readonly within: number }
  /** The extents of some entities (ZOOM Object, M2-03); the answer is an `extents`. */
  | { readonly type: 'bounds'; readonly id: number; readonly ids: readonly EntityId[] }
  /** The box an MTEXT's glyphs fill (M2-09); the answer is an `extents`. */
  | { readonly type: 'textBox'; readonly id: number; readonly text: MTextGeometry }
  /** The widths MTEXTs are laid out at (M2-10 part 3); the answer is a `widths`. */
  | { readonly type: 'textWidths'; readonly id: number; readonly texts: readonly MTextGeometry[] }
  /** The dynamic column counts of MTEXTs (M2-26 part 2); the answer is a `counts`. */
  | { readonly type: 'columnCounts'; readonly id: number; readonly texts: readonly MTextGeometry[] }
  /** The drawing's dimensions against their stored blocks (M2-30 part 3); answered by `dimensionHealth`. */
  | { readonly type: 'dimensionHealth'; readonly id: number }
  /** Where texts lie as drawn (M2-27); the answer is an `outlines`. */
  | {
      readonly type: 'textOutlines';
      readonly id: number;
      readonly texts: readonly (TextGeometry | MTextGeometry)[];
    }
  /** The object snap points under the aperture (M2-04); the answer is a `snap`. */
  | { readonly type: 'snap'; readonly id: number; readonly query: OsnapQuery }
  /** What MEASUREGEOM Quick shows at the cursor (M3-07); the answer is a `quick`. */
  | { readonly type: 'quick'; readonly id: number; readonly query: QuickQuery }
  /** The space enclosed around a point, in a view (M3-07); the answer is an `enclosed`. */
  | {
      readonly type: 'enclosed';
      readonly id: number;
      readonly point: Vec2;
      readonly view: Box;
    }
  /** The entities drawn in a rectangle of the canvas (M1-106 fidelity triage). */
  | { readonly type: 'entitiesIn'; readonly id: number; readonly rect: ScreenRect }
  | { readonly type: 'flush'; readonly id: number }
  /** When the first frame holding numbered change `seq` was drawn (M2-62); a `drawnAt`. */
  | { readonly type: 'drawnAt'; readonly id: number; readonly seq: number }
  /** What plotting a space draws (M2-17); the answer is a `plot`. */
  | { readonly type: 'plot'; readonly id: number; readonly request: PlotRequest }
  /** ZOOM Extents of the space drawn, as measured after everything before (M1-35 part 2). */
  | { readonly type: 'extents'; readonly id: number }
  /** The last frame drawn, fitted inside width × height (M1-22 tab hover preview). */
  | {
      readonly type: 'thumbnail';
      readonly id: number;
      readonly width: number;
      readonly height: number;
    };

export type WorkerMessage =
  | { readonly type: 'reply'; readonly id: number; readonly ids?: readonly EntityId[] }
  | { readonly type: 'entities'; readonly id: number; readonly entities: readonly DrawnEntity[] }
  /** The thumbnail asked for, transferred; null when the canvas was never sized. */
  | { readonly type: 'thumbnail'; readonly id: number; readonly bitmap: ImageBitmap | null }
  /** The object snap points asked for (M2-04), best first. */
  | { readonly type: 'snap'; readonly id: number; readonly hits: readonly OsnapHit[] }
  /** What Quick measures at the cursor (M3-07). */
  | { readonly type: 'quick'; readonly id: number; readonly measure: QuickMeasure }
  /** The space around the point, or null where none is (M3-07). */
  | { readonly type: 'enclosed'; readonly id: number; readonly space: EnclosedSpace | null }
  /** The extents asked for; null when nothing drawn has a known extent. */
  | { readonly type: 'extents'; readonly id: number; readonly box: Box | null }
  /** The text widths asked for, null for a text no loaded font draws. */
  | { readonly type: 'widths'; readonly id: number; readonly widths: readonly (number | null)[] }
  /** The column counts asked for, null for a text no loaded font draws. */
  | { readonly type: 'counts'; readonly id: number; readonly counts: readonly (number | null)[] }
  | {
      readonly type: 'dimensionHealth';
      readonly id: number;
      readonly health: DrawingDimensionHealth;
    }
  /** The outlines asked for, null for a text no loaded font draws. */
  | {
      readonly type: 'outlines';
      readonly id: number;
      readonly outlines: readonly (TextOutline | null)[];
    }
  /** The plot parts asked for (M2-17). */
  | { readonly type: 'plot'; readonly id: number; readonly parts: readonly PlotPart[] }
  /**
   * The time, in milliseconds since the epoch (`performance.timeOrigin + performance.now()`),
   * the frame asked for was drawn; null when no frame has drawn that change yet.
   */
  | { readonly type: 'drawnAt'; readonly id: number; readonly at: number | null }
  | { readonly type: 'error'; readonly message: string; readonly id?: number }
  /** A PDF underlay page the view needs drawn (M1-20); unasked, so it carries no id. */
  | { readonly type: 'underlayRequest'; readonly request: UnderlayRequest; readonly id?: never };

/** Both ends of the channel, typed by shape: a Worker, a worker's `self` or a test double. */
export interface Endpoint<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: { readonly data: In }) => void): void;
}

/**
 * A change set on the change port between a drawing's engine worker and a render worker
 * (M2-62), numbered by its place in the drawing's change log: 1 for the first change applied
 * after the drawing opened.
 */
export interface ChangeMessage {
  readonly seq: number;
  readonly change: ChangeSet;
}

/**
 * A render worker's link to its drawing's engine (M2-62): the port to hand the worker, and how
 * to tell the engine to stop posting on it once the renderer is gone.
 */
export interface ChangeLink {
  readonly port: unknown;
  close(): void;
}
