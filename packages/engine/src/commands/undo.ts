// The undo stack (M2-05, ARCHITECTURE.md §4.2, DEC-049): one step per command, as the bus's
// `CommandRecord` gives it, plus what AutoCAD's UNDO adds around them: marks (Mark/Back),
// BEgin/End groups, the Control modes and the OOPS set.
//
// A step keeps the command's change sets in order. Undo applies their inverses in reverse
// order (`invertChangeSet` is a swap, DEC-035), redo applies them again; both go through the
// bus's `apply`, so the renderers follow, but never into a command record: U is not itself a
// step. REDO reverses one whole U or UNDO (AutoCAD: "REDO reverses the effects of a single U
// or UNDO command"), so the redo side is a stack of the groups each one undid.
import type { ChangeSet, PositionedEntity } from '../model/changeset';
import { invertChangeSet, isEmptyChangeSet } from '../model/changeset';
import type { Entity } from '../model/types';
import type { CommandRecord } from './bus';

/** What UNDO Control sets: All (unlimited, bounded by memory), One (one step) or None. */
export type UndoControl = 'all' | 'one' | 'none';

/** The other UNDO settings (AutoCAD's UNDOCTL bits), kept for the commands they concern. */
export interface UndoSettings {
  /** UNDO Auto: a menu macro is one step (macros arrive with the ribbon's commands). */
  readonly auto: boolean;
  /** UNDO Control Combine: consecutive ZOOM/PAN are one step (once views are undoable). */
  readonly combineZoomPan: boolean;
  /** UNDO Control Layer: Layer Properties Manager changes are one step. */
  readonly combineLayer: boolean;
}

/** What front-ends show: the undo/redo buttons, their tooltips and the undo toast. */
export interface UndoState {
  readonly undoable: number;
  readonly redoable: number;
  readonly nextUndo?: string;
  readonly nextRedo?: string;
  /** An UNDO BEgin group is open. */
  readonly grouping: boolean;
  readonly control: UndoControl;
}

/**
 * What an undo or a redo did, for front-ends to say so (UI_SPEC's undo toast): the steps
 * undone, newest first, or redone, oldest first.
 */
export interface UndoAction {
  readonly kind: 'undo' | 'redo';
  readonly labels: readonly string[];
}

/** One undo step: a command, or a BEgin/End group of commands (labelled GROUP). */
export interface UndoRecord {
  readonly label: string;
  readonly changes: readonly ChangeSet[];
  /** Estimated memory the step holds, for the history's bound. */
  readonly bytes: number;
}

type Entry = { readonly kind: 'record'; readonly record: UndoRecord } | { readonly kind: 'mark' };

export interface UndoStackOptions {
  /** Applies a change set to the drawing (and in the engine worker, to the renderers). */
  readonly apply: (change: ChangeSet) => void;
  /** The history's memory bound; the oldest steps drop past it (default 256 MB). */
  readonly maxBytes?: number;
  /** Called whenever the state changes; `action` when an undo or a redo changed it. */
  readonly onChange?: (state: UndoState, action?: UndoAction) => void;
  /** A line for the command line (the memory bound's warning). */
  readonly onMessage?: (line: string) => void;
}

/** ARCHITECTURE.md §4.2: unlimited by count, bounded by memory, 256 MB by default. */
export const DEFAULT_UNDO_LIMIT_BYTES = 256 * 1024 * 1024;

/** The result of an undo: the steps undone, newest first, and whether more were asked for. */
export interface UndoResult {
  readonly labels: readonly string[];
  /** Asked for more steps than there were: AutoCAD's "Everything has been undone". */
  readonly exhausted: boolean;
  /** Stopped at a mark (UNDO Back). */
  readonly mark: boolean;
}

export class UndoStack {
  readonly #apply: (change: ChangeSet) => void;
  readonly #maxBytes: number;
  readonly #onChange: ((state: UndoState, action?: UndoAction) => void) | undefined;
  readonly #onMessage: ((line: string) => void) | undefined;
  #undo: Entry[] = [];
  #redo: Entry[][] = [];
  #group: { changes: ChangeSet[]; bytes: number } | undefined;
  #bytes = 0;
  #warned = false;
  #control: UndoControl = 'all';
  #settings: UndoSettings = { auto: true, combineZoomPan: true, combineLayer: true };
  #erased: readonly Entity[] = [];

  constructor(options: UndoStackOptions) {
    this.#apply = options.apply;
    this.#maxBytes = options.maxBytes ?? DEFAULT_UNDO_LIMIT_BYTES;
    this.#onChange = options.onChange;
    this.#onMessage = options.onMessage;
  }

  get state(): UndoState {
    const records = this.#undo.filter((e) => e.kind === 'record');
    const nextRedo = this.#redo.at(-1)?.findLast((e) => e.kind === 'record');
    const last = records.at(-1);
    return {
      undoable: records.length,
      redoable: this.#redo.length,
      ...(last?.kind === 'record' ? { nextUndo: last.record.label } : {}),
      ...(nextRedo?.kind === 'record' ? { nextRedo: nextRedo.record.label } : {}),
      grouping: this.#group !== undefined,
      control: this.#control,
    };
  }

  get control(): UndoControl {
    return this.#control;
  }

  get settings(): UndoSettings {
    return this.#settings;
  }

  /** The estimated memory the history holds (undo and redo sides and an open group). */
  get bytes(): number {
    return this.#bytes;
  }

  /** The entities the last erasing command removed (ERASE, BLOCK, WBLOCK), for OOPS. */
  get erased(): readonly Entity[] {
    return this.#erased;
  }

  /**
   * A finished command's record becomes a step (or joins the open BEgin group). A record whose
   * change sets are all empty is no step (DEC-049). `erases` marks ERASE-like commands, whose
   * removed entities become the OOPS set.
   */
  push(record: CommandRecord, options: { readonly erases?: boolean } = {}): void {
    if (options.erases) this.#erased = erasedBy(record.changes);
    const changes = record.changes.filter((c) => !isEmptyChangeSet(c));
    if (changes.length === 0 || this.#control === 'none') return;
    const bytes = changes.reduce((n, c) => n + estimateBytes(c), 0);
    this.#dropRedo();
    if (this.#group) {
      this.#group.changes.push(...changes);
      this.#group.bytes += bytes;
      this.#bytes += bytes;
    } else {
      this.#pushRecord({ label: record.command, changes, bytes });
    }
    this.#trim();
    this.#changed();
  }

  /** UNDO Mark. */
  mark(): void {
    this.#endGroup();
    this.#undo.push({ kind: 'mark' });
    this.#changed();
  }

  /** UNDO BEgin: ends a group already open and opens another. */
  begin(): void {
    this.#endGroup();
    this.#group = { changes: [], bytes: 0 };
    this.#changed();
  }

  /** UNDO End: closes the open group as one step; with none open it does nothing. */
  end(): void {
    this.#endGroup();
    this.#changed();
  }

  /** Whether any mark is on the undo side (UNDO Back asks before undoing everything if not). */
  get hasMark(): boolean {
    return this.#undo.some((e) => e.kind === 'mark');
  }

  /** U / UNDO n: undoes `steps` steps, passing over marks (they move with the steps). */
  undo(steps: number): UndoResult {
    this.#endGroup();
    if (!this.#undo.some((e) => e.kind === 'record')) {
      this.#changed();
      return { labels: [], exhausted: true, mark: false };
    }
    const taken: Entry[] = [];
    let left = steps;
    while (left > 0 && this.#undo.length > 0) {
      const e = this.#undo.pop()!;
      taken.push(e);
      if (e.kind === 'record') {
        this.#undoRecord(e.record);
        left -= 1;
      }
    }
    this.#redo.push(taken);
    const labels = labelsOf(taken);
    this.#changed({ kind: 'undo', labels });
    return { labels, exhausted: left > 0, mark: false };
  }

  /** UNDO Back: undoes to the last mark and removes it, or everything when there is none. */
  back(): UndoResult {
    this.#endGroup();
    const taken: Entry[] = [];
    let mark = false;
    while (this.#undo.length > 0) {
      const e = this.#undo.pop()!;
      taken.push(e);
      if (e.kind === 'mark') {
        mark = true;
        break;
      }
      this.#undoRecord(e.record);
    }
    if (taken.length > 0) this.#redo.push(taken);
    const labels = labelsOf(taken);
    this.#changed(labels.length > 0 ? { kind: 'undo', labels } : undefined);
    return { labels, exhausted: !mark, mark };
  }

  /** REDO: reverses the last U or UNDO; the labels redone, oldest first, or undefined. */
  redo(): string[] | undefined {
    const group = this.#redo.pop();
    if (!group) return undefined;
    for (let i = group.length - 1; i >= 0; i -= 1) {
      const e = group[i]!;
      if (e.kind === 'record') {
        try {
          for (const c of e.record.changes) this.#apply(c);
        } catch (err) {
          this.#fail(err);
        }
      }
      this.#undo.push(e);
    }
    const labels = labelsOf(group).reverse();
    this.#changed({ kind: 'redo', labels });
    return labels;
  }

  /** UNDO Control. None drops the history and turns undo off; One keeps the last step. */
  setControl(control: UndoControl): void {
    this.#control = control;
    if (control === 'none') {
      this.#group = undefined;
      this.clear();
      return;
    }
    if (control === 'one') {
      this.#endGroup();
      this.#trim();
    }
    this.#changed();
  }

  setSettings(settings: Partial<UndoSettings>): void {
    this.#settings = { ...this.#settings, ...settings };
  }

  /** Forgets every step (opening another drawing's history, UNDO Control None). */
  clear(): void {
    this.#undo = [];
    this.#redo = [];
    this.#bytes = this.#group?.bytes ?? 0;
    this.#changed();
  }

  #undoRecord(record: UndoRecord): void {
    try {
      for (let i = record.changes.length - 1; i >= 0; i -= 1) {
        this.#apply(invertChangeSet(record.changes[i]!));
      }
    } catch (err) {
      this.#fail(err);
    }
  }

  /**
   * A step that no longer applies means the drawing changed outside the history; going on would
   * undo the wrong things, so the history is dropped (AutoCAD drops it after operations it
   * cannot undo too).
   */
  #fail(err: unknown): never {
    this.#group = undefined;
    this.clear();
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`${why}; the undo history was cleared`);
  }

  #pushRecord(record: UndoRecord): void {
    this.#undo.push({ kind: 'record', record });
    this.#bytes += record.bytes;
  }

  #endGroup(): void {
    const g = this.#group;
    if (!g) return;
    this.#group = undefined;
    this.#bytes -= g.bytes;
    if (g.changes.length > 0) {
      this.#dropRedo();
      this.#pushRecord({ label: 'GROUP', changes: g.changes, bytes: g.bytes });
      this.#trim();
    }
  }

  #dropRedo(): void {
    for (const group of this.#redo) {
      for (const e of group) if (e.kind === 'record') this.#bytes -= e.record.bytes;
    }
    this.#redo = [];
  }

  /** Drops the oldest steps past the memory bound (or past one under Control One). */
  #trim(): void {
    const records = (): number => this.#undo.filter((e) => e.kind === 'record').length;
    const limit = this.#control === 'one' ? 1 : Infinity;
    let dropped = false;
    while (records() > 1 && (this.#bytes > this.#maxBytes || records() > limit)) {
      const e = this.#undo.shift()!;
      if (e.kind === 'record') {
        this.#bytes -= e.record.bytes;
        dropped ||= this.#control !== 'one';
      }
    }
    if (dropped && !this.#warned) {
      this.#warned = true;
      const mb = Math.round(this.#maxBytes / (1024 * 1024));
      this.#onMessage?.(
        `Undo history full (${mb > 0 ? `${mb} MB` : `${this.#maxBytes} bytes`}): the oldest steps can no longer be undone.`,
      );
    }
  }

  #changed(action?: UndoAction): void {
    if (action) this.#onChange?.(this.state, action);
    else this.#onChange?.(this.state);
  }
}

function labelsOf(entries: readonly Entry[]): string[] {
  const out: string[] = [];
  for (const e of entries) if (e.kind === 'record') out.push(e.record.label);
  return out;
}

/** The entities a command removed and did not put back (a move between blocks is no erase). */
function erasedBy(changes: readonly ChangeSet[]): Entity[] {
  const gone = new Map<number, PositionedEntity>();
  for (const c of changes) {
    for (const r of c.entities?.removed ?? []) if (!gone.has(r.entity.id)) gone.set(r.entity.id, r);
    for (const a of c.entities?.added ?? []) gone.delete(a.entity.id);
  }
  return [...gone.values()].sort((a, b) => a.index - b.index).map((r) => r.entity);
}

/**
 * A rough upper bound of the memory a change set holds: 8 bytes a number, 2 a character, and a
 * fixed overhead per object and array, counting each value once. The before/after versions are
 * shared with the drawing and the neighbouring steps, so this overcounts, which errs towards
 * keeping memory in bounds.
 */
export function estimateBytes(cs: ChangeSet): number {
  const seen = new Set<object>();
  let bytes = 0;
  const stack: unknown[] = [cs];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') bytes += 8;
    else if (typeof v === 'string') bytes += 16 + 2 * v.length;
    else if (v !== null && typeof v === 'object') {
      if (seen.has(v)) continue;
      seen.add(v);
      if (ArrayBuffer.isView(v)) {
        bytes += 32 + v.byteLength;
      } else if (Array.isArray(v)) {
        bytes += 16;
        for (const x of v) stack.push(x);
      } else {
        bytes += 32;
        for (const [k, x] of Object.entries(v)) {
          bytes += 8 + 2 * k.length;
          stack.push(x);
        }
      }
    }
  }
  return bytes;
}
