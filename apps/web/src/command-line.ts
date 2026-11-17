// The command line's state per open drawing (M2-02): the main thread's mirror of what the
// drawing's command engine said (history lines, the prompt it waits at), plus what the drafter
// typed at `Command:` for Up/Down recall. The command engine itself runs in the engine worker.
import {
  systemVariables,
  type CommandOutput,
  type CommandRegistry,
  type HeaderValue,
  type Prompt,
} from '@triya/engine';
import { DYN_DEFAULT_UNITS, type DynUnits } from './dynamic-input';

export interface CommandLineState {
  /** The command history, as the text window (F2) shows it. */
  readonly lines: readonly string[];
  /** The prompt the command engine waits at, or undefined at `Command:`. */
  readonly prompt: Prompt | undefined;
  /**
   * The prompt line as AutoCAD words it: `Specify next point or [Undo]:`, `Command:`; empty while
   * a command waits on a dialog (M2-41).
   */
  readonly promptText: string;
  /** The drawing's units and angle convention as of the last prompt, for Dynamic Input. */
  readonly units: DynUnits;
  /** Typed input, oldest first, for Up/Down. */
  readonly recent: readonly string[];
  /** The number of the last input sent to the engine (M2-47 part 3). */
  readonly sent: number;
  /** The number of the last input the engine has read: `prompt` is that input's prompt. */
  readonly read: number;
  /**
   * What the prompt line says while a lasso is dragged (M3-04 part 2: "Crossing Lasso  Press
   * Spacebar to cycle options"), shown over the prompt; the canvas says it, not the engine.
   */
  readonly lasso?: string;
}

export const IDLE: CommandLineState = {
  lines: [],
  prompt: undefined,
  promptText: 'Command:',
  units: DYN_DEFAULT_UNITS,
  recent: [],
  sent: 0,
  read: 0,
};

/** AutoCAD keeps the text window to the last lines it was set to hold; ours, the last 2000. */
const MAX_LINES = 2000;
const MAX_RECENT = 100;

/** The state after the command engine said `o`. */
export function follow(state: CommandLineState, o: CommandOutput): CommandLineState {
  switch (o.type) {
    case 'log':
      return { ...state, lines: [...state.lines, o.line].slice(-MAX_LINES) };
    case 'prompt':
      return {
        ...state,
        prompt: o.prompt,
        promptText: o.text,
        units: { units: o.units, angles: o.angles, ucs: o.ucs },
      };
    case 'idle':
      return { ...state, prompt: undefined, promptText: 'Command:' };
    // A command waits on a dialog of the app's (M2-41): the prompt line is empty, as AutoCAD's.
    case 'waiting':
      return { ...state, prompt: undefined, promptText: '' };
    case 'read':
      return o.seq > state.read ? { ...state, read: o.seq } : state;
    default:
      return state;
  }
}

/** The state after the drafter entered `text`. */
export function typed(state: CommandLineState, text: string): CommandLineState {
  const t = text.trim();
  if (t === '' || state.recent.at(-1) === t) return state;
  return { ...state, recent: [...state.recent, t].slice(-MAX_RECENT) };
}

/**
 * Type-ahead (M2-47 part 3, M2-71). What a key means depends on the prompt it reaches: whether a
 * space ends the input (Enter) or is typed (a name may hold spaces, an option or a point may
 * not), and which fields Dynamic Input puts it in (a point after the first is relative to the
 * last, DYNPICOORDS 0). Keys typed while the engine has not yet read the last input sent are
 * typed ahead of a prompt not shown yet, so they are held, the command line's and Dynamic
 * Input's alike, and replayed once the engine has read that input and its prompt is shown: into
 * Dynamic Input's fields if it shows that prompt, at the command line otherwise. AutoCAD buffers
 * type-ahead the same way.
 */
const HELD_KEYS = new Set(['Enter', 'Backspace']);

/** Keys that type: a character, Enter or Backspace. */
const types = (key: string) => key.length === 1 || HELD_KEYS.has(key);

/** The engine has not read every input sent: the prompt shown may not be the one keys reach. */
export const reading = (state: CommandLineState): boolean => state.sent > state.read;

/**
 * Whether `key` is held for the prompt it reaches, after the keys held already: a key that types,
 * while the engine reads; then every key that types, Tab (Dynamic Input's next field) and Esc
 * until the held keys are replayed, so they reach the engine in the order typed: Esc cancels
 * after the input typed before it. A second Esc in a row is not held, so Esc always cancels.
 */
export function holdsKey(state: CommandLineState, held: readonly string[], key: string): boolean {
  if (held.length > 0) {
    return types(key) || key === 'Tab' || (key === 'Escape' && held.at(-1) !== 'Escape');
  }
  return types(key) && reading(state);
}

/**
 * Held keys replayed at the command line on `prompt`, the prompt they reach, after `text` was
 * typed: the text the command line then shows, the input it sends (`submit`) when a key ends it,
 * and the keys after that key, which wait for the prompt that input leads to. An Esc is left
 * first in the keys, for the command line to cancel with, and the text typed before it is
 * dropped. Tab moves between Dynamic Input's fields, which the command line has not.
 */
export function replayAhead(
  text: string,
  keys: readonly string[],
  prompt: Prompt | undefined,
): { readonly text: string; readonly keys: readonly string[]; readonly submit?: string } {
  const spaces = prompt?.kind === 'string' && prompt.spaces === true;
  let t = text;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (key === 'Enter' || (key === ' ' && !spaces)) {
      return { text: '', keys: keys.slice(i + 1), submit: t };
    }
    if (key === 'Escape') return { text: '', keys: keys.slice(i) };
    if (key === 'Tab') continue;
    t = key === 'Backspace' ? t.slice(0, -1) : t + key;
  }
  return { text: t, keys: [] };
}

/**
 * The commands `text` may be the start of (AutoCAD's AUTOCOMPLETE): the command an alias names
 * exactly, then the commands whose names begin with it, as `{ name, alias }`; then the system
 * variables of `variables` that begin with it, as `{ name, variable: true }` (AUTOCOMPLETEMODE
 * lists system variables too, M2-59 part 5).
 */
export function completions(
  registry: CommandRegistry,
  text: string,
  variables: readonly string[] = [],
): { readonly name: string; readonly alias?: string; readonly variable?: true }[] {
  const t = text.trim().toUpperCase();
  if (t === '' || /[^A-Z0-9_\-']/.test(t)) return [];
  const bare = t.replace(/^'/, '');
  const out: { name: string; alias?: string; variable?: true }[] = [];
  const aliased = registry.alias(bare);
  if (aliased && registry.get(aliased)) out.push({ name: aliased, alias: bare });
  for (const name of registry.names()) {
    if (name.startsWith(bare) && !out.some((o) => o.name === name)) out.push({ name });
  }
  for (const name of variables) {
    // A command of the same name is what the name runs.
    if (name.startsWith(bare) && !out.some((o) => o.name === name)) {
      out.push({ name, variable: true });
    }
  }
  return out;
}

/**
 * The system variables a drawing's header gives it, with those the app keeps and works out, in
 * name order: what SETVAR ? lists, for the command line's autocomplete.
 */
export function variableNames(header: ReadonlyMap<string, unknown>): string[] {
  return systemVariables({ header: header as ReadonlyMap<string, HeaderValue> }).map((v) => v.name);
}

/** The prompt line split around its options, so they show as chips: `before [A/B] after`. */
export function promptParts(
  text: string,
  options: readonly string[] | undefined,
): { readonly before: string; readonly options: readonly string[]; readonly after: string } {
  const list = options && options.length > 0 ? `[${options.join('/')}]` : undefined;
  const at = list ? text.lastIndexOf(list) : -1;
  if (!list || at < 0) return { before: text, options: [], after: '' };
  return {
    before: text.slice(0, at).trimEnd(),
    options: options!,
    after: text.slice(at + list.length).trimStart(),
  };
}

/**
 * Whether the keys held for `prompt` are its in-place editor's to take rather than the command
 * line's to replay: the editor takes the keys typed while it opened, as AutoCAD's does. TEXT's
 * line editor placing new lines (M4-20), TEXTEDIT's on a picked TEXT and the MTEXT editor
 * (M4-26). A table cell's editor is left out: it types the keys carried from the cell before
 * (M4-05 part 7).
 */
export function takesTypeAhead(prompt: Prompt | undefined): boolean {
  return prompt?.kind === 'string' && prompt.editor !== undefined && !prompt.editor.cell;
}

/**
 * The key a keydown types ahead of the prompt an in-place editor's answer leads to, once the
 * editor has answered (M4-31): what the command line would hold (`holdsKey`), a character,
 * Enter, Backspace, Tab or Esc, with no Ctrl, Alt or Cmd. Undefined for any other key, which the
 * editor drops: it is closing and the key is not its own any more.
 */
export function typedAfter(e: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): string | undefined {
  if (e.ctrlKey || e.altKey || e.metaKey) return undefined;
  return types(e.key) || e.key === 'Tab' || e.key === 'Escape' ? e.key : undefined;
}

/** The keys a command line holds (`holdsKey`), for an in-place editor to take (M4-20). */
export interface HeldKeys {
  /** The keys held, which the command line then no longer holds. */
  take(): readonly string[];
  /** Keys held again after the ones held: typed ahead of the prompt after the editor's. */
  give(keys: readonly string[]): void;
}

/** Each open drawing's command line. */
export class CommandLines {
  readonly #states = new Map<number, CommandLineState>();
  readonly #listeners = new Set<() => void>();
  readonly #held = new Map<number, HeldKeys>();
  readonly #editors = new Map<number, (keys: readonly string[]) => boolean>();
  #version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Moves whenever any drawing's command line changes (for useSyncExternalStore). */
  version = (): number => this.#version;

  /** The command line showing `doc` holds its keys in `keys`; returns the release. */
  holdKeys(doc: number, keys: HeldKeys): () => void {
    this.#held.set(doc, keys);
    return () => {
      if (this.#held.get(doc) === keys) this.#held.delete(doc);
    };
  }

  /** The keys held for `doc`'s prompt, taken from its command line. */
  takeHeld(doc: number): readonly string[] {
    return this.#held.get(doc)?.take() ?? [];
  }

  /** Keys held again by `doc`'s command line, for the prompt after the editor's. */
  giveHeld(doc: number, keys: readonly string[]): void {
    if (keys.length > 0) this.#held.get(doc)?.give(keys);
  }

  /**
   * An in-place editor open on `doc`'s prompt (`takesTypeAhead`) types the keys held for it
   * (M4-20): those held while it opened at once, and those the command line holds later (keys
   * typed outside it while the engine read an input) as `typeHeld` hands them over. The editor
   * answers whether it took them: once it has ended or cancelled the command it takes no more,
   * and they wait for `Command:`. Returns the release.
   */
  typeHeldInto(doc: number, editor: (keys: readonly string[]) => boolean): () => void {
    this.#editors.set(doc, editor);
    const keys = this.takeHeld(doc);
    if (keys.length > 0 && !editor(keys)) this.giveHeld(doc, keys);
    return () => {
      if (this.#editors.get(doc) === editor) this.#editors.delete(doc);
    };
  }

  /**
   * Keys typed into an in-place editor on `doc` after it answered the engine, numbered as typed
   * input is (`send`, M4-31): typed ahead of the prompt the answer leads to, they join the keys
   * `doc`'s command line holds and are replayed there once the engine has read the answer, as
   * the keys typed at the command line are (M2-47 part 3). AutoCAD's editor hands them on the
   * same way: TEXTEDIT's Enter Enter keeps the line and then ends TEXTEDIT.
   */
  typeAfter(doc: number, keys: readonly string[]): void {
    if (keys.length === 0) return;
    this.#held.get(doc)?.give(keys);
    // The command line replays held keys when it renders: after the engine has read the answer,
    // nothing else may move it.
    this.#changed();
  }

  /** Hands `keys`, held by `doc`'s command line, to its open editor; false when none took them. */
  typeHeld(doc: number, keys: readonly string[]): boolean {
    return this.#editors.get(doc)?.(keys) ?? false;
  }

  get(doc: number): CommandLineState {
    return this.#states.get(doc) ?? IDLE;
  }

  follow(doc: number, o: CommandOutput): void {
    this.#set(doc, follow(this.get(doc), o));
  }

  /** A lasso dragged on `doc`'s canvas, as the prompt line says it; undefined when it ends. */
  lasso(doc: number, text: string | undefined): void {
    const { lasso: _, ...state } = this.get(doc);
    this.#set(doc, text === undefined ? state : { ...state, lasso: text });
  }

  typed(doc: number, text: string): void {
    this.#set(doc, typed(this.get(doc), text));
  }

  /** Numbers the next input sent to `doc`'s engine; its `read` output says it was read. */
  send(doc: number): number {
    const state = this.get(doc);
    this.#set(doc, { ...state, sent: state.sent + 1 });
    return state.sent + 1;
  }

  forget(doc: number): void {
    if (this.#states.delete(doc)) this.#changed();
  }

  #set(doc: number, state: CommandLineState): void {
    if (state === this.get(doc)) return;
    this.#states.set(doc, state);
    this.#changed();
  }

  #changed(): void {
    this.#version++;
    for (const l of this.#listeners) l();
  }
}

/** The app's command lines, one per open drawing. */
export const commandLines = new CommandLines();
