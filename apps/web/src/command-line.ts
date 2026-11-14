// The command line's state per open drawing (M2-02): the main thread's mirror of what the
// drawing's command engine said (history lines, the prompt it waits at), plus what the drafter
// typed at `Command:` for Up/Down recall. The command engine itself runs in the engine worker.
import type { CommandOutput, CommandRegistry, Prompt } from '@triya/engine';

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
  /** Typed input, oldest first, for Up/Down. */
  readonly recent: readonly string[];
  /** The number of the last input sent to the engine (M2-47 part 3). */
  readonly sent: number;
  /** The number of the last input the engine has read: `prompt` is that input's prompt. */
  readonly read: number;
}

export const IDLE: CommandLineState = {
  lines: [],
  prompt: undefined,
  promptText: 'Command:',
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
      return { ...state, prompt: o.prompt, promptText: o.text };
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
 * Type-ahead (M2-47 part 3). Whether a space ends the input (Enter) or is typed depends on the
 * prompt it reaches: a name may hold spaces, an option or a point may not. Keys typed while the
 * engine has not yet read the last input sent are typed ahead of a prompt not shown yet, so the
 * command line holds a space typed then, and every key after it, and replays them once the
 * engine has read that input and its prompt is shown: AutoCAD buffers type-ahead the same way.
 * Letters and Enter mean the same at any prompt, so they go on as typed until a key is held.
 */
const HELD_KEYS = new Set(['Enter', 'Backspace']);

/** Keys that type: a character, Enter or Backspace. */
const types = (key: string) => key.length === 1 || HELD_KEYS.has(key);

/** The engine has not read every input sent: the prompt shown may not be the one keys reach. */
export const reading = (state: CommandLineState): boolean => state.sent > state.read;

/** The command line holds `key` for the prompt it reaches, after the keys held already. */
export function holdsKey(state: CommandLineState, held: readonly string[], key: string): boolean {
  if (held.length > 0) return types(key);
  return key === ' ' && reading(state);
}

/**
 * Held keys replayed on `prompt`, the prompt they reach, after `text` was typed: the text the
 * command line then shows, the input it sends (`submit`) when a key ends it, and the keys after
 * that key, which wait for the prompt that input leads to.
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
    t = key === 'Backspace' ? t.slice(0, -1) : t + key;
  }
  return { text: t, keys: [] };
}

/**
 * The commands `text` may be the start of (AutoCAD's AUTOCOMPLETE): the command an alias names
 * exactly, then the commands whose names begin with it, as `{ name, alias }`.
 */
export function completions(
  registry: CommandRegistry,
  text: string,
): { readonly name: string; readonly alias?: string }[] {
  const t = text.trim().toUpperCase();
  if (t === '' || /[^A-Z0-9_\-']/.test(t)) return [];
  const bare = t.replace(/^'/, '');
  const out: { name: string; alias?: string }[] = [];
  const aliased = registry.alias(bare);
  if (aliased && registry.get(aliased)) out.push({ name: aliased, alias: bare });
  for (const name of registry.names()) {
    if (name.startsWith(bare) && !out.some((o) => o.name === name)) out.push({ name });
  }
  return out;
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

/** Each open drawing's command line. */
export class CommandLines {
  readonly #states = new Map<number, CommandLineState>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Moves whenever any drawing's command line changes (for useSyncExternalStore). */
  version = (): number => this.#version;

  get(doc: number): CommandLineState {
    return this.#states.get(doc) ?? IDLE;
  }

  follow(doc: number, o: CommandOutput): void {
    this.#set(doc, follow(this.get(doc), o));
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

/** The keys that run the Clipboard commands (M2-14 part 2, COMMANDS.md), as AutoCAD binds them. */
const CLIPBOARD_KEYS: Readonly<Record<string, string>> = {
  c: 'COPYCLIP',
  x: 'CUTCLIP',
  v: 'PASTECLIP',
  'shift+c': 'COPYBASE',
  'shift+v': 'PASTEBLOCK',
};

/**
 * The Clipboard command a key press runs: Ctrl+C COPYCLIP, Ctrl+X CUTCLIP, Ctrl+V PASTECLIP,
 * Ctrl+Shift+C COPYBASE, Ctrl+Shift+V PASTEBLOCK (Cmd for Ctrl on a Mac), or undefined.
 */
export function clipboardCommand(e: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): string | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return undefined;
  return CLIPBOARD_KEYS[`${e.shiftKey ? 'shift+' : ''}${e.key.toLowerCase()}`];
}
