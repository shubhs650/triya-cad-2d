// A worker started ahead of the job that takes it (M4-22). Starting a worker loads its modules,
// which took longer than the work asked of it: a drawing's engine worker (hundreds of modules
// before the production build bundles them) waited to start until the I/O worker had read the
// file, so the first edit and the first save after opening a drawing waited for both in turn.
// Started when the file starts being read, the two load side by side.

export class SpareWorker<W extends { terminate(): void }> {
  readonly #create: () => W;
  #spare: W | undefined;

  constructor(create: () => W) {
    this.#create = create;
  }

  /** Starts a spare worker, unless one is already waiting. */
  start(): void {
    this.#spare ??= this.#create();
  }

  /** The spare worker, or a new one when none is waiting; the job owns it from now on. */
  take(): W {
    const w = this.#spare ?? this.#create();
    this.#spare = undefined;
    return w;
  }

  /** Ends the spare worker, if one is waiting: the job it was started for is not coming. */
  discard(): void {
    this.#spare?.terminate();
    this.#spare = undefined;
  }
}
