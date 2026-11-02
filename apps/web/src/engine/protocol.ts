// Messages between EngineHost (main thread) and the engine worker (M1-67). Plain
// structured-clone postMessage, as the render worker's protocol: every request after `init`
// carries an id and gets one reply, in order.
import type { DocumentInit, EditResult, EngineEdit } from '@triya/engine';

export type EngineRequest =
  | { readonly type: 'init'; readonly init: DocumentInit }
  | { readonly type: 'edit'; readonly id: number; readonly edit: EngineEdit };

export type EngineReply =
  | { readonly type: 'result'; readonly id: number; readonly result: EditResult }
  | { readonly type: 'error'; readonly message: string; readonly id?: number };

/** One end of the channel, typed by shape: a Worker, a worker's `self` or a test double. */
export interface Endpoint<In, Out> {
  postMessage(message: Out): void;
  addEventListener(type: 'message', listener: (e: { readonly data: In }) => void): void;
}
