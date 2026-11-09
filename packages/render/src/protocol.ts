// Messages between RendererHost (main thread) and the render worker. Plain structured-clone
// postMessage, as ARCHITECTURE.md §3 draws it: the stream is one-way except for the requests
// that need an answer (hit test, entities in a rectangle, flush, thumbnail, extents), which carry an id.

import type {
  Box,
  ChangeSet,
  DragMotion,
  EntityId,
  MTextGeometry,
  OsnapHit,
  OsnapQuery,
  Vec2,
} from '@triya/engine';
import type { FontSources, RenderDocument } from './session';
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
    }
  | {
      readonly type: 'resize';
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
    }
  | { readonly type: 'view'; readonly view: ViewTransform }
  | { readonly type: 'apply'; readonly change: ChangeSet }
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
      readonly definition: string;
      readonly raster: UnderlayRaster | null;
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
  | { readonly type: 'grips'; readonly ids: readonly EntityId[]; readonly hot: Vec2 | null }
  /** The extents of some entities (ZOOM Object, M2-03); the answer is an `extents`. */
  | { readonly type: 'bounds'; readonly id: number; readonly ids: readonly EntityId[] }
  /** The box an MTEXT's glyphs fill (M2-09); the answer is an `extents`. */
  | { readonly type: 'textBox'; readonly id: number; readonly text: MTextGeometry }
  /** The widths MTEXTs are laid out at (M2-10 part 3); the answer is a `widths`. */
  | { readonly type: 'textWidths'; readonly id: number; readonly texts: readonly MTextGeometry[] }
  /** The object snap points under the aperture (M2-04); the answer is a `snap`. */
  | { readonly type: 'snap'; readonly id: number; readonly query: OsnapQuery }
  /** The entities drawn in a rectangle of the canvas (M1-106 fidelity triage). */
  | { readonly type: 'entitiesIn'; readonly id: number; readonly rect: ScreenRect }
  | { readonly type: 'flush'; readonly id: number }
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
  /** The extents asked for; null when nothing drawn has a known extent. */
  | { readonly type: 'extents'; readonly id: number; readonly box: Box | null }
  /** The text widths asked for, null for a text no loaded font draws. */
  | { readonly type: 'widths'; readonly id: number; readonly widths: readonly (number | null)[] }
  | { readonly type: 'error'; readonly message: string; readonly id?: number }
  /** A PDF underlay page the view needs drawn (M1-20); unasked, so it carries no id. */
  | { readonly type: 'underlayRequest'; readonly request: UnderlayRequest; readonly id?: never };

/** Both ends of the channel, typed by shape: a Worker, a worker's `self` or a test double. */
export interface Endpoint<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: { readonly data: In }) => void): void;
}
