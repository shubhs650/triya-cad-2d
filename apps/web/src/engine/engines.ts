// One engine per open drawing (M1-67). An edit goes to the drawing's engine, and the change set
// it returns goes to every renderer of that drawing (one per space shown), which is how the
// render replicas stay in step with the authoritative document. A renderer made later (a
// layout tab shown for the first time, REGEN) starts from the drawing as opened, so it replays
// the drawing's change log first. A command's edits (M2-02) take the same way: each ChangeSet the
// command engine reports joins the change log and goes to every renderer of the drawing.
import type {
  ChangeSet,
  CommandInput,
  CommandOutput,
  DocumentInit,
  EditResult,
  EngineEdit,
  PaperView,
} from '@triya/engine';
import type { EngineHost } from './host';

export interface ChangeTarget {
  apply(change: ChangeSet): void;
}

export class Engines {
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
  ) {
    this.#create = create;
    this.#targets = targets;
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
      for (const l of this.#listeners) l(doc, o);
    });
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
      this.#engines.get(doc)?.command(input);
      return;
    }
    const next = (before ?? Promise.resolve())
      .then(() => input)
      .then(
        (i) => {
          if (i) this.#engines.get(doc)?.command(i);
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

  stop(doc: number): void {
    this.#engines.get(doc)?.dispose();
    this.#engines.delete(doc);
    this.#logs.delete(doc);
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
    log.push(change);
    for (const t of this.#targets(doc)) t.apply(change);
  }
}
