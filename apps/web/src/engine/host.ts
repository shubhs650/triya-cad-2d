// EngineHost (M1-67, ARCHITECTURE.md §3): the main thread's handle on one drawing's engine
// session. With a worker factory the session runs in the engine worker; without one it runs on
// the main thread behind the same calls (tests, and any browser without module workers).
import {
  EngineSession,
  type CommandInput,
  type CommandOutput,
  type DocumentInit,
  type EditResult,
  type EngineEdit,
} from '@triya/engine';
import type { Endpoint, EngineReply, EngineRequest } from './protocol';

export type EngineWorker = Endpoint<EngineReply, EngineRequest> & { terminate(): void };

interface Pending {
  resolve(r: EditResult): void;
  reject(e: Error): void;
}

export class EngineHost {
  readonly mode: 'worker' | 'main';
  readonly #worker: EngineWorker | undefined;
  readonly #session: EngineSession | undefined;
  readonly #pending = new Map<number, Pending>();
  readonly #commandListeners = new Set<(o: CommandOutput) => void>();
  #nextId = 1;
  #disposed = false;

  constructor(init: DocumentInit, createWorker?: () => EngineWorker) {
    if (createWorker) {
      this.mode = 'worker';
      const w = createWorker();
      this.#worker = w;
      w.addEventListener('message', ({ data }) => this.#receive(data));
      w.postMessage({ type: 'init', init });
    } else {
      this.mode = 'main';
      this.#session = new EngineSession(init);
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

  dispose(): void {
    this.#disposed = true;
    this.#worker?.terminate();
    for (const p of this.#pending.values()) p.reject(new Error('engine host disposed'));
    this.#pending.clear();
    this.#commandListeners.clear();
  }

  #commandOutput(o: CommandOutput): void {
    for (const l of this.#commandListeners) l(o);
  }

  #receive(m: EngineReply): void {
    if (m.type === 'command') return this.#commandOutput(m.output);
    const p = m.id === undefined ? undefined : this.#pending.get(m.id);
    if (m.id !== undefined) this.#pending.delete(m.id);
    if (m.type === 'result') p?.resolve(m.result);
    else if (p) p.reject(new Error(`engine worker: ${m.message}`));
    else for (const q of this.#pending.values()) q.reject(new Error(`engine worker: ${m.message}`));
  }
}
