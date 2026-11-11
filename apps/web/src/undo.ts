// Undo in the app (M2-23): each drawing's undo history lives in its command engine (M2-05); the
// app hears its state as `undo` outputs. From them the Quick Access Undo and Redo buttons take
// their state and tooltips, and an undo or a redo shows UI_SPEC's undo toast with a count.
// Their drop-down lists (M2-36) undo or redo several steps with one pick.
import type { UndoAction, UndoState } from '@triya/engine';

interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * The undo command a key press runs: Ctrl+Z U and Ctrl+Y REDO, as AutoCAD binds them (Cmd for
 * Ctrl on a Mac, where Cmd+Shift+Z is redo too, as in AutoCAD for Mac), or undefined.
 */
export function undoKeyCommand(e: KeyPress): string | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return undefined;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? (e.metaKey ? 'REDO' : undefined) : 'U';
  if (key === 'y' && !e.shiftKey) return 'REDO';
  return undefined;
}

export interface UndoButton {
  readonly enabled: boolean;
  readonly title: string;
}

/** The Undo and Redo buttons for a drawing's undo state (undefined: no drawing). */
export function undoButtons(s: UndoState | undefined): {
  readonly undo: UndoButton;
  readonly redo: UndoButton;
} {
  const undo: UndoButton =
    s?.control === 'none'
      ? { enabled: false, title: 'Undo is turned off' }
      : s && s.undoable > 0
        ? { enabled: true, title: `Undo ${s.nextUndo ? `${s.nextUndo} ` : ''}(Ctrl+Z)` }
        : { enabled: false, title: 'Nothing to undo' };
  const redo: UndoButton =
    s && s.redoable > 0
      ? { enabled: true, title: `Redo ${s.nextRedo ? `${s.nextRedo} ` : ''}(Ctrl+Y)` }
      : { enabled: false, title: 'Nothing to redo' };
  return { undo, redo };
}

export interface UndoList {
  readonly enabled: boolean;
  /** The steps, newest (Undo) or next (Redo) first. */
  readonly items: readonly string[];
}

/**
 * The Quick Access Undo or Redo drop-down list (M2-36): the steps by name, as the engine lists
 * them (UndoState `undoList`/`redoList`), the one the button would undo or redo first.
 */
export function undoList(s: UndoState | undefined, kind: 'undo' | 'redo'): UndoList {
  const items = s ? (kind === 'undo' ? s.undoList : s.redoList) : [];
  const enabled = items.length > 0 && !(kind === 'undo' && s?.control === 'none');
  return { enabled, items: enabled ? items : [] };
}

/**
 * Picking entry `index` of a list undoes or redoes every step down to it in one go, as AutoCAD's
 * lists do: UNDO n or MREDO n with n = index + 1. `text` is the list's foot while that entry
 * is pointed at.
 */
export function undoListPick(
  kind: 'undo' | 'redo',
  index: number,
): { readonly command: 'UNDO' | 'MREDO'; readonly count: number; readonly text: string } {
  const count = index + 1;
  const text = `${kind === 'undo' ? 'Undo' : 'Redo'} ${count} ${count === 1 ? 'step' : 'steps'}`;
  return { command: kind === 'undo' ? 'UNDO' : 'MREDO', count, text };
}

/**
 * The toast an undo or a redo shows: what it did (the command, or the number of steps) and how
 * many steps are left to undo or redo; undefined when it did nothing.
 */
export function undoToast(action: UndoAction, s: UndoState): string | undefined {
  const n = action.labels.length;
  if (n === 0) return undefined;
  const what = n === 1 ? action.labels[0]! : `${n} steps`;
  if (action.kind === 'undo') {
    const left = s.undoable > 0 ? `${s.undoable} more to undo` : 'nothing more to undo';
    return `Undone: ${what} · ${left}`;
  }
  return s.redoable > 0 ? `Redone: ${what} · ${s.redoable} more to redo` : `Redone: ${what}`;
}

export interface UndoToast {
  /** A new id for each toast, so a repeated U shows (and times) a new one. */
  readonly id: number;
  readonly doc: number;
  readonly text: string;
}

/** Each open drawing's undo state, and the last undo toast, for the chrome to show. */
export class UndoStates {
  readonly #states = new Map<number, UndoState>();
  readonly #listeners = new Set<() => void>();
  #toast: UndoToast | undefined;
  #nextToast = 1;
  #version = 0;

  set(doc: number, state: UndoState, action?: UndoAction): void {
    this.#states.set(doc, state);
    const text = action && undoToast(action, state);
    if (text) this.#toast = { id: this.#nextToast++, doc, text };
    this.#changed();
  }

  get(doc: number | undefined): UndoState | undefined {
    return doc === undefined ? undefined : this.#states.get(doc);
  }

  get toast(): UndoToast | undefined {
    return this.#toast;
  }

  /** The toast `id` timed out (a newer one stays). */
  dismiss(id: number): void {
    if (this.#toast?.id !== id) return;
    this.#toast = undefined;
    this.#changed();
  }

  forget(doc: number): void {
    const had = this.#states.delete(doc);
    const toast = this.#toast?.doc === doc;
    if (toast) this.#toast = undefined;
    if (had || toast) this.#changed();
  }

  /** A value that changes whenever anything here does, for `useSyncExternalStore`. */
  version = (): number => this.#version;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #changed(): void {
    this.#version += 1;
    for (const l of this.#listeners) l();
  }
}

export const undoStates = new UndoStates();
