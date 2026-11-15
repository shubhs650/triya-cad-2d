// The app's shortcut keys (M3-10 part 2): the keyboard map in use (the defaults with the user's
// keys, kept with the settings) and `runShortcut`, which the command line's window listener calls
// first for every key (bubbling, so a dialog or the text editor that stops its keys keeps them).
// The parts of the app that own an action register its handler here: the title bar's file
// actions (App), the command line's (commands, toggles, palette, history).
import {
  Keymap,
  chordOf,
  commandOf,
  keepsForText,
  keyAction,
  type Focus,
  type KeyOverrides,
  type KeyPress,
} from './keymap';
import { heldOverrides, overrideOf } from './temp-overrides';

let map = new Keymap();
let version = 0;
const listeners = new Set<() => void>();

/** The keyboard map in use. */
export const keymap = (): Keymap => map;

/** Uses the user's keys over the defaults; listeners hear of a change. */
export function applyKeyOverrides(overrides: KeyOverrides): boolean {
  if (sameKeys(overrides, map.overrides)) return false;
  map = new Keymap(overrides);
  version++;
  for (const l of listeners) l();
  return true;
}

/** Whether two sets of overrides give the same actions the same keys. */
function sameKeys(a: KeyOverrides, b: KeyOverrides): boolean {
  const ids = Object.keys(a);
  return (
    ids.length === Object.keys(b).length &&
    ids.every((id) => b[id] !== undefined && b[id].join('\n') === a[id]!.join('\n'))
  );
}

/** For `useSyncExternalStore`: the keyboard map's version, which moves with each change. */
export const keymapVersion = {
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: (): number => version,
};

/**
 * Runs an action: true when it did (the key is then the shortcut's, not the browser's). A
 * handler for `command:` runs every command action.
 */
export type ShortcutHandler = (id: string, focus: Focus) => boolean;

const handlers = new Map<string, ShortcutHandler>();

/** Registers handlers by action id (`command:` for every command); returns the unregister. */
export function onShortcuts(own: Readonly<Record<string, ShortcutHandler>>): () => void {
  for (const [id, h] of Object.entries(own)) handlers.set(id, h);
  return () => {
    for (const [id, h] of Object.entries(own)) if (handlers.get(id) === h) handlers.delete(id);
  };
}

/** Where the focus is, for `keepsForText`. */
export function focusOf(target: EventTarget | null, commandInput: Element | null): Focus {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement))
    return { kind: 'none', empty: true };
  if (target instanceof HTMLInputElement)
    return { kind: target === commandInput ? 'command' : 'input', empty: target.value === '' };
  const text = target.isContentEditable || target.closest('textarea, select, dialog') !== null;
  return { kind: text ? 'text' : 'none', empty: true };
}

/** The command line's input, for `focusOf` (set by the command line). */
export const commandInput: { current: HTMLInputElement | null } = { current: null };

/**
 * Runs the action a key press's chord names, if any and if the focus does not keep the key:
 * the action the keyboard map gives it, by its registered handler.
 */
export function runShortcut(e: KeyPress & { readonly target: EventTarget | null }): boolean {
  const chord = chordOf(e) ?? (shiftAlone(e) ? 'Shift' : undefined);
  if (chord === undefined) return false;
  const id = map.actionFor(chord);
  if (id === undefined) return false;
  const focus = focusOf(e.target, commandInput.current);
  if (keyAction(id)?.hold) return holdOverride(e, chord, id, focus);
  if (keepsForText(chord, focus)) return false;
  const handler =
    handlers.get(id) ?? (commandOf(id) !== undefined ? handlers.get('command:') : undefined);
  return handler?.(id, focus) ?? false;
}

/** Whether a key press is a temporary override's key in the keyboard map (M3-06 part 5). */
export function overrideKey(e: KeyPress): boolean {
  const chord = chordOf(e);
  return chord !== undefined && keyAction(map.actionFor(chord) ?? '')?.hold === true;
}

const shiftAlone = (e: KeyPress): boolean =>
  e.key === 'Shift' && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * A temporary override key pressed (M3-06 part 5): held while its owner (`override:`, the command
 * line) takes it. Shift alone is held but left to the browser, as Shift+click needs it.
 */
function holdOverride(e: KeyPress, chord: string, id: string, focus: Focus): boolean {
  const kind = overrideOf(id);
  const handler = handlers.get('override:');
  if (!kind || !handler?.(id, focus)) return false;
  heldOverrides.press(chord === 'Shift' ? 'Shift' : keyOf(e), kind);
  return chord !== 'Shift';
}

/** A key let go: its override ends; Shift let go ends them all. */
export function releaseShortcut(e: Pick<KeyPress, 'key' | 'code'>): void {
  if (e.key === 'Shift') heldOverrides.clear();
  else heldOverrides.release(keyOf(e));
}

/** The physical key held, whatever Shift types on it. */
const keyOf = (e: Pick<KeyPress, 'key' | 'code'>): string => e.code ?? e.key.toUpperCase();
