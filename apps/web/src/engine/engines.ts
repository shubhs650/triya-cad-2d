// One engine per open drawing (M1-67). An edit goes to the drawing's engine, and the change set
// it returns goes to every renderer of that drawing (one per space shown), which is how the
// render replicas stay in step with the authoritative document. A renderer made later (a
// layout tab shown for the first time, REGEN) starts from the drawing as opened, so it replays
// the drawing's change log first. A command's edits (M2-02) take the same way: each ChangeSet the
// command engine reports joins the change log and goes to every renderer of the drawing.
// Each change goes with its place in the log (1 for the first), which is also how the engine
// worker numbers the copy it posts straight to the drawing's render workers (M2-62).
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
import type { ChangeLink } from '@triya/render';
import type { EngineHost } from './host';

export interface ChangeTarget {
  /** `seq`: the change's place in the drawing's change log, 1 for the first. */
  apply(change: ChangeSet, seq: number): void;
}

/** A drawing's last command, start to end (the diagnostics panel, M7-08). */
export interface CommandTiming {
  readonly command: string;
  readonly ms: number;
  readonly cancelled: boolean;
}

/** What the diagnostics panel shows of a drawing's command engine (M7-08). */
export interface EngineTimings {
  readonly lastCommand?: CommandTiming;
  /** How long the engine took to read the last numbered input sent to it, ms. */
  readonly lastResponseMs?: number;
}

export class Engines {
  readonly #now: () => number;
  /** Per drawing: the command running (not transparent), when its numbered inputs were sent. */
  readonly #running = new Map<number, { readonly command: string; readonly at: number }>();
  readonly #sentAt = new Map<number, Map<number, number>>();
  readonly #timings = new Map<number, EngineTimings>();
  readonly #create: (init: DocumentInit, changes: readonly ChangeSet[]) => EngineHost;
  readonly #targets: (doc: number) => Iterable<ChangeTarget>;
  readonly #engines = new Map<number, EngineHost>();
  readonly #logs = new Map<number, ChangeSet[]>();
  readonly #listeners = new Set<(doc: number, o: CommandOutput) => void>();
  /** Input waiting behind a click whose point is still being worked out (M2-04), per drawing. */
  readonly #queued = new Map<number, Promise<void>>();

  constructor(
    create: (init: DocumentInit, changes: readonly ChangeSet[]) => EngineHost,
    targets: (doc: number) => Iterable<ChangeTarget>,
    now: () => number = () => performance.now(),
  ) {
    this.#create = create;
    this.#targets = targets;
    this.#now = now;
  }

  /**
   * Starts a drawing's engine from `init`, the drawing as opened. A recovered drawing (M2-14)
   * also passes the change log its last session applied: the engine replays it, and it starts
   * this session's log, so the drawing's canvases replay it too.
   */
  start(doc: number, init: DocumentInit, changes: readonly ChangeSet[] = []): void {
    this.stop(doc);
    const engine = this.#create(init, changes);
    this.#engines.set(doc, engine);
    this.#logs.set(doc, [...changes]);
    engine.onCommand((o) => {
      if (this.#engines.get(doc) !== engine) return;
      if (o.type === 'change') this.#applied(doc, o.change);
      this.#time(doc, o);
      for (const l of this.#listeners) l(doc, o);
    });
  }

  /** The drawing's last command and input timings (the diagnostics panel, M7-08). */
  timingsOf(doc: number): EngineTimings {
    return this.#timings.get(doc) ?? {};
  }

  #time(doc: number, o: CommandOutput): void {
    const now = this.#now();
    if (o.type === 'start' && !o.transparent) {
      this.#running.set(doc, { command: o.command, at: now });
    } else if (o.type === 'end') {
      const run = this.#running.get(doc);
      if (run?.command !== o.command) return;
      this.#running.delete(doc);
      const lastCommand = { command: o.command, ms: now - run.at, cancelled: o.cancelled };
      this.#timings.set(doc, { ...this.#timings.get(doc), lastCommand });
    } else if (o.type === 'read') {
      const sent = this.#sentAt.get(doc);
      const at = sent?.get(o.seq);
      if (at === undefined) return;
      for (const seq of sent!.keys()) if (seq <= o.seq) sent!.delete(seq);
      this.#timings.set(doc, { ...this.#timings.get(doc), lastResponseMs: now - at });
    }
  }

  /** Sends `input` to the drawing's engine, noting when a numbered one went (M7-08). */
  #send(doc: number, input: CommandInput): void {
    const engine = this.#engines.get(doc);
    if (!engine) return;
    const seq = 'seq' in input ? input.seq : undefined;
    if (seq !== undefined) {
      const sent = this.#sentAt.get(doc) ?? new Map<number, number>();
      sent.set(seq, this.#now());
      this.#sentAt.set(doc, sent);
    }
    engine.command(input);
  }

  /**
   * Hands command input to a drawing's command engine (the command line, the canvas). Input
   * still being worked out (a click waiting for its object snap, M2-04) holds back what
   * follows it, so Enter typed right after a click reaches the command after the click; input
   * worked out to undefined is dropped.
   */
  command(doc: number, input: CommandInput | Promise<CommandInput | undefined>): void {
    const before = this.#queued.get(doc);
    if (!before && !(input instanceof Promise)) {
      this.#send(doc, input);
      return;
    }
    const next = (before ?? Promise.resolve())
      .then(() => input)
      .then(
        (i) => {
          if (i) this.#send(doc, i);
        },
        () => undefined,
      );
    this.#queued.set(doc, next);
    void next.then(() => {
      if (this.#queued.get(doc) === next) this.#queued.delete(doc);
    });
  }

  /**
   * Listens to every drawing's command engine; a command's edits are already on the drawing's
   * canvases and in its change log when the listener hears of them.
   */
  onCommand(listener: (doc: number, o: CommandOutput) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Links a render worker of the drawing to its engine (M2-62): see `EngineHost.connect`.
   * Undefined when the drawing is not open or its engine runs on the main thread.
   */
  connect(doc: number): ChangeLink | undefined {
    return this.#engines.get(doc)?.connect();
  }

  /** Where the drawing's engine runs (the error report's `engine-in-worker`, M7-08). */
  modeOf(doc: number): 'worker' | 'main' | undefined {
    return this.#engines.get(doc)?.mode;
  }

  stop(doc: number): void {
    this.#engines.get(doc)?.dispose();
    this.#engines.delete(doc);
    this.#logs.delete(doc);
    this.#running.delete(doc);
    this.#sentAt.delete(doc);
    this.#timings.delete(doc);
  }

  /**
   * Every change applied to the drawing since it opened, in order: what a new renderer built
   * from the opened `DocumentInit` must apply to catch up. Kept whole for now (viewer edits
   * are few); M2's undo history and autosave snapshots will bound it.
   */
  changesOf(doc: number): readonly ChangeSet[] {
    return this.#logs.get(doc) ?? [];
  }

  /**
   * The blocks a save gives the drawing's dimensions that have none (M2-30 part 2): for the
   * saved file only, so neither the change log nor the canvases take them.
   */
  async blocklessDimensionBlocks(doc: number): Promise<ChangeSet | undefined> {
    const engine = this.#engines.get(doc);
    return engine ? engine.blocklessDimensionBlocks() : undefined;
  }

  /**
   * The view each layout shown is saved in (M2-47 part 1): its paper-space viewport, for the
   * saved file only, as the Model tiles' `*Active` VPORTs are.
   */
  async paperViews(doc: number, layouts: readonly PaperView[]): Promise<ChangeSet | undefined> {
    const engine = this.#engines.get(doc);
    return engine && layouts.length > 0 ? engine.paperViews(layouts) : undefined;
  }

  /**
   * What the Health palette's purge card counts (M5-09 part 3): the drawing's unused named items,
   * zero-length geometry and empty text; undefined when the drawing is not open.
   */
  async purgeHealth(doc: number): Promise<PurgeHealth | undefined> {
    const engine = this.#engines.get(doc);
    return engine ? engine.purgeHealth() : undefined;
  }

  /** What the Health palette's drawing checks find (M8-07); undefined when the drawing is not open. */
  async healthChecks(doc: number): Promise<HealthChecks | undefined> {
    const engine = this.#engines.get(doc);
    return engine ? engine.healthChecks() : undefined;
  }

  /**
   * The layers objects are on (M5-07 part 5: the Layer Properties Manager's All Used Layers);
   * undefined when the drawing is not open.
   */
  async layersInUse(doc: number): Promise<Handle[] | undefined> {
    const engine = this.#engines.get(doc);
    return engine ? engine.layersInUse() : undefined;
  }

  /** Applies an edit to a drawing and shows it on every canvas of that drawing. */
  async edit(doc: number, edit: EngineEdit): Promise<EditResult> {
    const engine = this.#engines.get(doc);
    if (!engine) return { ok: false, message: 'The drawing is not open.' };
    const result = await engine.edit(edit);
    // The drawing may have closed while the engine answered.
    if (result.ok) this.#applied(doc, result.change);
    return result;
  }

  #applied(doc: number, change: ChangeSet): void {
    const log = this.#logs.get(doc);
    if (!log || Object.keys(change).length === 0) return;
    const seq = log.push(change);
    for (const t of this.#targets(doc)) t.apply(change, seq);
  }
}
