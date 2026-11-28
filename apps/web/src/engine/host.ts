// EngineHost (M1-67, ARCHITECTURE.md §3): the main thread's handle on one drawing's engine
// session. With a worker factory the session runs in the engine worker; without one it runs on
// the main thread behind the same calls (tests, and any browser without module workers).
import {
  EngineSession,
  type ChangeSet,
  type CommandInput,
  type CommandOutput,
  type DocumentInit,
  type EditResult,
  type EngineEdit,
  type Handle,
  type PaperView,
  type HealthChecks,
  type PurgeHealth,
} from '@triya/engine';
import { libraryAnswer, type LibraryAnswer, type LibraryItem } from '@triya/library';
import type { ChangeLink } from '@triya/render';
import type { Endpoint, EngineReply, EngineRequest } from './protocol';
import { ENGINE_SERVICES } from './services';

export type EngineWorker = Endpoint<EngineReply, EngineRequest> & { terminate(): void };

interface Pending {
  resolve(r: EditResult): void;
  reject(e: Error): void;
}

interface PendingBlocks {
  resolve(c: ChangeSet | undefined): void;
  reject(e: Error): void;
}

export class EngineHost {
  readonly mode: 'worker' | 'main';
  readonly #worker: EngineWorker | undefined;
  readonly #session: EngineSession | undefined;
  readonly #pending = new Map<number, Pending>();
  readonly #blocks = new Map<number, PendingBlocks>();
  readonly #health = new Map<number, { resolve(h: PurgeHealth): void; reject(e: Error): void }>();
  readonly #checks = new Map<number, { resolve(h: HealthChecks): void; reject(e: Error): void }>();
  readonly #used = new Map<number, { resolve(h: Handle[]): void; reject(e: Error): void }>();
  readonly #library = new Map<
    number,
    { resolve(a: LibraryAnswer): void; reject(e: Error): void }
  >();
  readonly #commandListeners = new Set<(o: CommandOutput) => void>();
  #nextId = 1;
  #nextLink = 1;
  #disposed = false;

  /** `changes`: a recovered drawing's change log, replayed onto `init` first (M2-14). */
  constructor(
    init: DocumentInit,
    createWorker?: () => EngineWorker,
    changes: readonly ChangeSet[] = [],
  ) {
    if (createWorker) {
      this.mode = 'worker';
      const w = createWorker();
      this.#worker = w;
      w.addEventListener('message', ({ data }) => this.#receive(data));
      w.postMessage(changes.length ? { type: 'init', init, changes } : { type: 'init', init });
    } else {
      this.mode = 'main';
      this.#session = new EngineSession(init, ENGINE_SERVICES, changes);
      this.#session.onCommand((o) => this.#commandOutput(o));
    }
  }

  /** Hands command input to the drawing's command engine (M2-02); output comes by `onCommand`. */
  command(input: CommandInput): void {
    if (this.#disposed) return;
    if (this.#worker) this.#worker.postMessage({ type: 'command', input });
    else
      this.#session!.command(input).catch((e: unknown) =>
        this.#commandOutput({
          type: 'log',
          line: `; error: ${e instanceof Error ? e.message : String(e)}`,
        }),
      );
  }

  /**
   * Links a render worker to this engine (M2-62): the engine worker posts each change set it
   * applies on the returned port, numbered by its place in the change log, before it tells the
   * main thread. Hand the port to the render worker and `close` the link when that renderer is
   * gone. Undefined when the engine runs on the main thread (nothing to skip) or is disposed.
   */
  connect(): ChangeLink | undefined {
    const worker = this.#worker;
    if (this.#disposed || !worker) return undefined;
    const { port1, port2 } = new MessageChannel();
    const id = this.#nextLink++;
    worker.postMessage({ type: 'renderer', id, port: port1 }, [port1]);
    return {
      port: port2,
      close: () => {
        if (!this.#disposed) worker.postMessage({ type: 'renderer-closed', id });
      },
    };
  }

  /** Listens to the command engine's output; returns the unsubscribe. */
  onCommand(listener: (o: CommandOutput) => void): () => void {
    this.#commandListeners.add(listener);
    return () => this.#commandListeners.delete(listener);
  }

  /** Applies an edit to the document; resolves with its change set or the refusal. */
  edit(edit: EngineEdit): Promise<EditResult> {
    if (this.#disposed) return Promise.reject(new Error('engine host disposed'));
    if (this.#session) return Promise.resolve(this.#session.edit(edit));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker!.postMessage({ type: 'edit', id, edit });
    });
  }

  /**
   * The blocks a save gives the dimensions that have none (M2-30 part 2), for the saved file
   * only; undefined when there are none.
   */
  blocklessDimensionBlocks(): Promise<ChangeSet | undefined> {
    if (this.#disposed) return Promise.reject(new Error('engine host disposed'));
    if (this.#session) return this.#session.blocklessDimensionBlocks();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#blocks.set(id, { resolve, reject });
      this.#worker!.postMessage({ type: 'save-blocks', id });
    });
  }

  /** The view each layout shown is saved in (M2-47 part 1), for the saved file only. */
  paperViews(layouts: readonly PaperView[]): Promise<ChangeSet | undefined> {
    if (this.#disposed) return Promise.reject(new Error('engine host disposed'));
    if (this.#session) return Promise.resolve(this.#session.paperViews(layouts));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#blocks.set(id, { resolve, reject });
      this.#worker!.postMessage({ type: 'save-views', id, layouts });
    });
  }

  /** What the Health palette's purge card counts (M5-09 part 3), as the drawing is now. */
  purgeHealth(): Promise<PurgeHealth> {
    if (this.#disposed) return Promise.reject(new Error('engine host disposed'));
    if (this.#session) return Promise.resolve(this.#session.purgeHealth());
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#health.set(id, { resolve, reject });
      this.#worker!.postMessage({ type: 'purge-health', id });
    });
  }

  /** What the Health palette's drawing checks find (M8-07), as the drawing is now. */
  healthChecks(): Promise<HealthChecks> {
    if (this.#disposed) return Promise.reject(new Error('engine host disposed'));
    if (this.#session) return Promise.resolve(this.#session.healthChecks());
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#checks.set(id, { resolve, reject });
      this.#worker!.postMessage({ type: 'health-checks', id });
    });
  }

  /** The layers objects are on (M5-07 part 5: the Layer Properties Manager's All Used Layers). */
  layersInUse(): Promise<Handle[]> {
    if (this.#disposed) return Promise.reject(new Error('engine host disposed'));
    if (this.#session) return Promise.resolve(this.#session.layersInUse());
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#used.set(id, { resolve, reject });
      this.#worker!.postMessage({ type: 'layers-in-use', id });
    });
  }

  /** The library palette's drawing context, and `item` as a block for the drawing (M8-03). */
  library(item?: LibraryItem): Promise<LibraryAnswer> {
    if (this.#disposed) return Promise.reject(new Error('engine host disposed'));
    if (this.#session) return Promise.resolve(libraryAnswer(this.#session.model, item));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#library.set(id, { resolve, reject });
      this.#worker!.postMessage(item ? { type: 'library', id, item } : { type: 'library', id });
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#worker?.terminate();
    for (const p of [
      ...this.#pending.values(),
      ...this.#blocks.values(),
      ...this.#health.values(),
      ...this.#checks.values(),
      ...this.#used.values(),
      ...this.#library.values(),
    ]) {
      p.reject(new Error('engine host disposed'));
    }
    this.#pending.clear();
    this.#blocks.clear();
    this.#health.clear();
    this.#checks.clear();
    this.#used.clear();
    this.#library.clear();
    this.#commandListeners.clear();
  }

  #commandOutput(o: CommandOutput): void {
    for (const l of this.#commandListeners) l(o);
  }

  #receive(m: EngineReply): void {
    if (m.type === 'command') return this.#commandOutput(m.output);
    const health = m.id === undefined ? undefined : this.#health.get(m.id);
    if (health) {
      this.#health.delete(m.id!);
      if (m.type === 'purge-health') health.resolve(m.health);
      else health.reject(new Error(`engine worker: ${m.type === 'error' ? m.message : m.type}`));
      return;
    }
    const checks = m.id === undefined ? undefined : this.#checks.get(m.id);
    if (checks) {
      this.#checks.delete(m.id!);
      if (m.type === 'health-checks') checks.resolve(m.checks);
      else checks.reject(new Error(`engine worker: ${m.type === 'error' ? m.message : m.type}`));
      return;
    }
    const used = m.id === undefined ? undefined : this.#used.get(m.id);
    if (used) {
      this.#used.delete(m.id!);
      if (m.type === 'layers-in-use') used.resolve([...m.layers]);
      else used.reject(new Error(`engine worker: ${m.type === 'error' ? m.message : m.type}`));
      return;
    }
    const library = m.id === undefined ? undefined : this.#library.get(m.id);
    if (library) {
      this.#library.delete(m.id!);
      if (m.type === 'library') library.resolve(m.library);
      else library.reject(new Error(`engine worker: ${m.type === 'error' ? m.message : m.type}`));
      return;
    }
    const blocks = m.id === undefined ? undefined : this.#blocks.get(m.id);
    if (blocks) {
      this.#blocks.delete(m.id!);
      if (m.type === 'save-blocks' || m.type === 'save-views') blocks.resolve(m.change);
      else blocks.reject(new Error(`engine worker: ${m.type === 'error' ? m.message : m.type}`));
      return;
    }
    if (
      m.type === 'save-blocks' ||
      m.type === 'save-views' ||
      m.type === 'purge-health' ||
      m.type === 'health-checks' ||
      m.type === 'layers-in-use' ||
      m.type === 'library'
    )
      return;
    const p = m.id === undefined ? undefined : this.#pending.get(m.id);
    if (m.id !== undefined) this.#pending.delete(m.id);
    if (m.type === 'result') p?.resolve(m.result);
    else if (p) p.reject(new Error(`engine worker: ${m.message}`));
    else if (this.#pending.size === 0) {
      // Nothing waits for an answer: say it on the command line (a recovered drawing's change
      // log that no longer fits its file, M2-14).
      this.#commandOutput({ type: 'log', line: `; error: ${m.message}` });
    } else
      for (const q of this.#pending.values()) q.reject(new Error(`engine worker: ${m.message}`));
  }
}
