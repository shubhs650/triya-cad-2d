// The state of a reference edited in place (M5-02 part 3), kept by the PromptBus: the working set
// and every change made since REFEDIT carried it out of its block, which REFCLOSE's Discard takes
// back and Save carries back.
//
// The undo history and the edit agree: U back past REFEDIT puts the objects back in the block, so
// the edit ends; REDO carries them out again and resumes it. U after REFCLOSE brings the edit
// back as it was when it closed, and REDO closes it again. Each is found by its change set: a
// record undone or redone that holds REFEDIT's or REFCLOSE's.
import type { ChangeSet } from '../model/changeset';
import { invertChangeSet, isEmptyChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import { compareHandles, type Handle } from '../model/handle';
import { changedIn } from '../edit/refedit';
import type { RefEditControl, RefEditSession } from './command';

interface Run {
  readonly session: RefEditSession;
  /** The changes made since the working set went out, REFEDIT's first, in the order made. */
  changes: ChangeSet[];
  readonly working: Set<EntityId>;
  /** How many changes it had when REFCLOSE closed it, and REFCLOSE's change that marks it. */
  closedAt?: number;
  closing?: ChangeSet;
}

export interface RefEditHost {
  readonly model: DocumentModel;
  /** Applies a change to the drawing (Discard's taking back). */
  apply(cs: ChangeSet): void;
  /** Adds a change to the record of the command running (REFCLOSE's). */
  record(cs: ChangeSet): void;
  /** The edit started, ended or its working set changed. */
  changed(): void;
}

const NONE: ReadonlySet<EntityId> = new Set();

export class RefEdits implements RefEditControl {
  readonly #host: RefEditHost;
  /** Every edit made in this session, the latest last: U and REDO may bring one back. */
  readonly #runs: Run[] = [];
  #active: Run | undefined;

  constructor(host: RefEditHost) {
    this.#host = host;
  }

  get session(): RefEditSession | undefined {
    return this.#active?.session;
  }

  get working(): ReadonlySet<EntityId> {
    return this.#active?.working ?? NONE;
  }

  open(session: RefEditSession): void {
    const run: Run = {
      session,
      changes: [session.extraction],
      working: new Set(session.originals.keys()),
    };
    this.#runs.push(run);
    this.#active = run;
    this.#host.changed();
  }

  add(ids: readonly EntityId[]): void {
    const run = this.#active;
    if (!run) return;
    for (const id of ids) run.working.add(id);
    this.#host.changed();
  }

  remove(ids: readonly EntityId[]): void {
    const run = this.#active;
    if (!run) return;
    for (const id of ids) run.working.delete(id);
    this.#host.changed();
  }

  touched(): ReadonlySet<EntityId | Handle> {
    const out = new Set<EntityId | Handle>();
    for (const cs of this.#active?.changes.slice(1) ?? []) changedIn(cs, out);
    return out;
  }

  close(o: { readonly saved?: ChangeSet; readonly discard?: boolean }): void {
    const run = this.#active;
    if (!run) return;
    this.#active = undefined;
    // Save's change was recorded as it was applied: it is the closing, not an edit.
    if (o.saved && run.changes.at(-1) === o.saved) run.changes.pop();
    run.closedAt = run.changes.length;
    if (o.saved) run.closing = o.saved;
    if (o.discard) {
      for (const c of [...run.changes].reverse()) {
        if (isEmptyChangeSet(c)) continue;
        const back = invertChangeSet(c);
        this.#host.apply(back);
        this.#host.record(back);
        run.closing ??= back;
      }
    }
    this.#host.changed();
  }

  /** Every change applied to the drawing: an edit's changes are kept, its new objects join it. */
  applied(cs: ChangeSet): void {
    const run = this.#active;
    if (!run) return;
    run.changes.push(cs);
    let joined = false;
    for (const a of cs.entities?.added ?? []) {
      const e = a.entity;
      if (e.owner !== run.session.space || run.working.has(e.id)) continue;
      if (compareHandles(e.handle, run.session.firstNew) < 0) continue;
      run.working.add(e.id);
      joined = true;
    }
    if (joined) this.#host.changed();
  }

  /** A step's changes undone or redone (`UndoStackOptions.onReplay`). */
  replayed(changes: readonly ChangeSet[], undone: boolean): void {
    const was = this.#active;
    for (const run of this.#runs) {
      const opening = changes.indexOf(run.session.extraction);
      const closing = run.closing ? changes.includes(run.closing) : false;
      if (undone) {
        if (closing) this.#resume(run);
        if (opening >= 0 && this.#active === run) this.#active = undefined;
      } else {
        if (opening >= 0) {
          // The changes the step made from REFEDIT's on were applied before it resumed.
          run.changes = changes.slice(opening);
          delete run.closedAt;
          this.#active = run;
        }
        if (closing && this.#active === run) {
          run.changes.length = run.closedAt ?? run.changes.length;
          this.#active = undefined;
        }
      }
    }
    if (this.#active !== was) this.#host.changed();
  }

  #resume(run: Run): void {
    if (run.closedAt !== undefined) run.changes.length = run.closedAt;
    this.#active = run;
  }
}
