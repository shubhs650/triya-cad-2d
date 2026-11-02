// Messages between RendererHost (main thread) and the render worker. Plain structured-clone
// postMessage, as ARCHITECTURE.md §3 draws it: the stream is one-way except for the two
// requests that need an answer (hit test, flush), which carry an id.

import type { ChangeSet, EntityId } from '@triya/engine';
import type { RenderDocument } from './session';
import type { RasterPixels, RenderPrimitive, RenderStyle, ViewTransform } from './types';

export type HostMessage =
  | {
      readonly type: 'init';
      /** The transferred OffscreenCanvas (typed loosely: the worker only knows it by shape). */
      readonly canvas: unknown;
      readonly document: RenderDocument;
      readonly style?: RenderStyle;
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
  | { readonly type: 'frame' }
  /** An IMAGEDEF's decoded bitmap, its pixel buffer transferred; null forgets it (M1-19). */
  | { readonly type: 'image'; readonly definition: string; readonly pixels: RasterPixels | null }
  | {
      readonly type: 'hitTest';
      readonly id: number;
      readonly screen: { readonly x: number; readonly y: number };
      readonly aperture: number;
    }
  | { readonly type: 'flush'; readonly id: number };

export type WorkerMessage =
  | { readonly type: 'reply'; readonly id: number; readonly ids?: readonly EntityId[] }
  | { readonly type: 'error'; readonly message: string; readonly id?: number };

/** Both ends of the channel, typed by shape: a Worker, a worker's `self` or a test double. */
export interface Endpoint<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: { readonly data: In }) => void): void;
}
