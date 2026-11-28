// Messages between EngineHost (main thread) and the engine worker (M1-67). Plain
// structured-clone postMessage, as the render worker's protocol: every request after `init`
// carries an id and gets one reply, in order (a save's blocks, which wait on the canvas, may
// come after later replies). Command input (M2-02) gets no reply: the command
// engine's output comes back as `command` messages, in the order it happens.
// Each render worker of the drawing is also linked to the engine worker by a MessageChannel
// (M2-62): the engine posts every change set it applies on each linked port, numbered by its
// place in the drawing's change log, before it tells the main thread.
import type {
  ChangeSet,
  CommandInput,
  CommandOutput,
  DocumentInit,
  EditResult,
  EngineEdit,
  Handle,
  HealthChecks,
  PaperView,
  PurgeHealth,
} from '@triya/engine';

export type EngineRequest =
  /** `changes`: a recovered drawing's change log, replayed onto `init` (M2-14). */
  | { readonly type: 'init'; readonly init: DocumentInit; readonly changes?: readonly ChangeSet[] }
  | { readonly type: 'edit'; readonly id: number; readonly edit: EngineEdit }
  | { readonly type: 'command'; readonly input: CommandInput }
  /** The blocks a save gives dimensions without one (M2-30 part 2). */
  | { readonly type: 'save-blocks'; readonly id: number }
  /** The view each layout shown is saved in (M2-47 part 1). */
  | { readonly type: 'save-views'; readonly id: number; readonly layouts: readonly PaperView[] }
  /** What the Health palette's purge card counts (M5-09 part 3). */
  | { readonly type: 'purge-health'; readonly id: number }
  /** What the Health palette's drawing checks find (M8-07). */
  | { readonly type: 'health-checks'; readonly id: number }
  /** The layers objects are on: the Layer Properties Manager's All Used Layers (M5-07 part 5). */
  | { readonly type: 'layers-in-use'; readonly id: number }
  /** A render worker's end of a change channel (M2-62), transferred; `id` names the link. */
  | { readonly type: 'renderer'; readonly id: number; readonly port: MessagePort }
  /** The renderer linked as `id` is gone: stop posting to it. */
  | { readonly type: 'renderer-closed'; readonly id: number };

export type EngineReply =
  | { readonly type: 'result'; readonly id: number; readonly result: EditResult }
  | { readonly type: 'command'; readonly output: CommandOutput }
  | { readonly type: 'save-blocks'; readonly id: number; readonly change?: ChangeSet }
  | { readonly type: 'save-views'; readonly id: number; readonly change?: ChangeSet }
  | { readonly type: 'purge-health'; readonly id: number; readonly health: PurgeHealth }
  | { readonly type: 'health-checks'; readonly id: number; readonly checks: HealthChecks }
  | { readonly type: 'layers-in-use'; readonly id: number; readonly layers: readonly Handle[] }
  | { readonly type: 'error'; readonly message: string; readonly id?: number };

/** One end of the channel, typed by shape: a Worker, a worker's `self` or a test double. */
export interface Endpoint<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: { readonly data: In }) => void): void;
}
