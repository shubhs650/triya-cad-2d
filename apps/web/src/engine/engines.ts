// One engine per open drawing (M1-67). An edit goes to the drawing's engine, and the change set
// it returns goes to every renderer of that drawing (one per space shown), which is how the
// render replicas stay in step with the authoritative document. A renderer made later (a
// layout tab shown for the first time, REGEN) starts from the drawing as opened, so it replays
// the drawing's change log first.
import type { ChangeSet, DocumentInit, EditResult, EngineEdit } from '@triya/engine';
import type { EngineHost } from './host';

export interface ChangeTarget {
  apply(change: ChangeSet): void;
}

export class Engines {
  readonly #create: (init: DocumentInit) => EngineHost;
  readonly #targets: (doc: number) => Iterable<ChangeTarget>;
  readonly #engines = new Map<number, EngineHost>();
  readonly #logs = new Map<number, ChangeSet[]>();

  constructor(
    create: (init: DocumentInit) => EngineHost,
    targets: (doc: number) => Iterable<ChangeTarget>,
  ) {
    this.#create = create;
    this.#targets = targets;
  }

  start(doc: number, init: DocumentInit): void {
    this.stop(doc);
    this.#engines.set(doc, this.#create(init));
    this.#logs.set(doc, []);
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

  /** Applies an edit to a drawing and shows it on every canvas of that drawing. */
  async edit(doc: number, edit: EngineEdit): Promise<EditResult> {
    const engine = this.#engines.get(doc);
    if (!engine) return { ok: false, message: 'The drawing is not open.' };
    const result = await engine.edit(edit);
    // The drawing may have closed while the engine answered.
    const log = this.#logs.get(doc);
    if (result.ok && log && Object.keys(result.change).length > 0) {
      log.push(result.change);
      for (const t of this.#targets(doc)) t.apply(result.change);
    }
    return result;
  }
}
