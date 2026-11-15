// The keyboard map (M3-10 part 2, PRD FR-C5): AutoCAD's default shortcut keys in one table, and
// the drafter's own keys over it, kept with the settings and edited in the Keyboard Shortcuts
// dialog (AutoCAD's CUI editor, Keyboard Shortcuts > Shortcut Keys). Every app shortcut is looked
// up here; one window listener (shortcuts.ts) runs the action a chord names.
//
// A chord is written as AutoCAD writes it: modifiers in the order Ctrl, Alt, Shift, then the key
// (`Ctrl+Shift+P`, `F3`, `Ctrl+1`). On a Mac Cmd counts as Ctrl, as AutoCAD for Mac maps it.

/** A key press, as a KeyboardEvent carries it. */
export interface KeyPress {
  readonly key: string;
  /** The physical key (`KeyA`, `Digit1`): Shift+1 still names 1. */
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export type Chord = string;

/** An action a key can run: an app action, or a command (`command:PLOT`). */
export interface KeyAction {
  readonly id: string;
  readonly label: string;
  readonly group: 'File' | 'Edit' | 'View' | 'Drafting' | 'Temporary Override' | 'Command';
  /** AutoCAD's default keys for it (acad.cuix's Shortcut Keys), or Triya's where noted. */
  readonly keys: readonly Chord[];
  /**
   * A temporary override (M3-06 part 5, acad.cuix's Temporary Overrides): it acts while its key
   * is held, which is Shift alone or Shift with a typing key (`temp-overrides.ts`).
   */
  readonly hold?: true;
}

/** The actions that come with keys, in the order the Keyboard Shortcuts dialog lists them. */
export const KEY_ACTIONS: readonly KeyAction[] = [
  { id: 'file:open', label: 'Open…', group: 'File', keys: ['Ctrl+O'] },
  { id: 'file:save', label: 'Save', group: 'File', keys: ['Ctrl+S'] },
  { id: 'file:saveas', label: 'Save As…', group: 'File', keys: ['Ctrl+Shift+S'] },
  { id: 'command:PLOT', label: 'PLOT', group: 'Command', keys: ['Ctrl+P'] },
  { id: 'command:U', label: 'Undo (U)', group: 'Edit', keys: ['Ctrl+Z'] },
  // Ctrl+Y is AutoCAD's; Ctrl+Shift+Z is the Mac's redo key (Cmd+Shift+Z, AutoCAD for Mac).
  { id: 'command:REDO', label: 'Redo (REDO)', group: 'Edit', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'command:COPYCLIP', label: 'Copy (COPYCLIP)', group: 'Edit', keys: ['Ctrl+C'] },
  { id: 'command:CUTCLIP', label: 'Cut (CUTCLIP)', group: 'Edit', keys: ['Ctrl+X'] },
  { id: 'command:PASTECLIP', label: 'Paste (PASTECLIP)', group: 'Edit', keys: ['Ctrl+V'] },
  {
    id: 'command:COPYBASE',
    label: 'Copy with Base Point (COPYBASE)',
    group: 'Edit',
    keys: ['Ctrl+Shift+C'],
  },
  {
    id: 'command:PASTEBLOCK',
    label: 'Paste as Block (PASTEBLOCK)',
    group: 'Edit',
    keys: ['Ctrl+Shift+V'],
  },
  { id: 'select-all', label: 'Select All', group: 'Edit', keys: ['Ctrl+A'] },
  // AutoCAD's Ctrl+J and Ctrl+M are Enter: they end the input, or repeat the last command.
  { id: 'enter', label: 'Enter (repeat last command)', group: 'Edit', keys: ['Ctrl+J', 'Ctrl+M'] },
  { id: 'properties', label: 'Properties palette', group: 'View', keys: ['Ctrl+1'] },
  { id: 'history', label: 'Command history', group: 'View', keys: ['F2'] },
  // Triya's command palette; AutoCAD's Ctrl+K (HYPERLINK) has no command in Triya.
  { id: 'palette', label: 'Command palette', group: 'View', keys: ['Ctrl+K'] },
  { id: 'drafting:osnap', label: 'Object Snap on/off', group: 'Drafting', keys: ['F3', 'Ctrl+F'] },
  { id: 'drafting:grid', label: 'Grid Display on/off', group: 'Drafting', keys: ['F7', 'Ctrl+G'] },
  { id: 'drafting:ortho', label: 'Ortho Mode on/off', group: 'Drafting', keys: ['F8', 'Ctrl+L'] },
  { id: 'drafting:snap', label: 'Snap Mode on/off', group: 'Drafting', keys: ['F9', 'Ctrl+B'] },
  {
    id: 'drafting:polar',
    label: 'Polar Tracking on/off',
    group: 'Drafting',
    keys: ['F10', 'Ctrl+U'],
  },
  {
    id: 'drafting:otrack',
    label: 'Object Snap Tracking on/off',
    group: 'Drafting',
    keys: ['F11'],
  },
  { id: 'dyn', label: 'Dynamic Input on/off', group: 'Drafting', keys: ['F12'] },
  { id: 'drafting:lwt', label: 'Show/Hide Lineweight', group: 'Drafting', keys: [] },
  { id: 'drafting:tpy', label: 'Show/Hide Transparency', group: 'Drafting', keys: [] },
  {
    id: 'drafting:qp',
    label: 'Quick Properties on/off',
    group: 'Drafting',
    keys: ['Ctrl+Shift+P'],
  },
  {
    id: 'drafting:sc',
    label: 'Selection Cycling on/off',
    group: 'Drafting',
    keys: ['Ctrl+W'],
  },
  // AutoCAD's Toggle Groups (Ctrl+Shift+A) and PICKSTYLE toggle (Ctrl+H): group selection, M3-08.
  {
    id: 'drafting:groups',
    label: 'Group Selection on/off',
    group: 'Drafting',
    keys: ['Ctrl+Shift+A', 'Ctrl+H'],
  },
  // AutoCAD's temporary override keys (M3-06 part 5): each has a left-hand and a right-hand key.
  ...(
    [
      ['ortho', 'Ortho Toggle', ['Shift']],
      ['polar', 'Polar Override', ['Shift+X', 'Shift+.']],
      ['otrack', 'Object Snap Tracking Override', ['Shift+Q', 'Shift+]']],
      ['osnap', 'Object Snap Toggle', ['Shift+A', "Shift+'"]],
      ['disable', 'Disable All Snapping and Tracking', ['Shift+D', 'Shift+L']],
      ['enforce', 'Object Snap Enforcement', ['Shift+S', 'Shift+;']],
      ['END', 'Object Snap Override: Endpoint', ['Shift+E', 'Shift+P']],
      ['MID', 'Object Snap Override: Midpoint', ['Shift+M', 'Shift+V']],
      ['CEN', 'Object Snap Override: Center', ['Shift+C', 'Shift+,']],
    ] as const
  ).map(([id, label, keys]): KeyAction => ({
    id: `override:${id}`,
    label,
    group: 'Temporary Override',
    keys,
    hold: true,
  })),
];

const ACTIONS = new Map(KEY_ACTIONS.map((a) => [a.id, a]));

/** The table's action, or a command's (`command:LINE`) for any command name. */
export function keyAction(id: string): KeyAction | undefined {
  const known = ACTIONS.get(id);
  if (known) return known;
  const name = commandOf(id);
  return name === undefined ? undefined : { id, label: name, group: 'Command', keys: [] };
}

/** The command an action id runs (`command:PLOT` → PLOT), or undefined. */
export function commandOf(id: string): string | undefined {
  const m = /^command:([A-Z0-9_.-]+)$/.exec(id);
  return m ? m[1] : undefined;
}

const NAMED: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Hyper']);
const KEY_NAMES = new Set([
  'Space',
  'Escape',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/** Punctuation keys by their physical key, so Shift+. is `.` rather than the `>` it types. */
const PUNCTUATION: Readonly<Record<string, string>> = {
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
};

/** A key's name in a chord: `A`, `1`, `F3`, `PageUp`, `[`; undefined for a modifier alone. */
function keyName(key: string, code: string | undefined): string | undefined {
  // The physical letter or digit, so Shift+1 is 1 and Alt+P on a Mac (π) is still P.
  const physical = code && /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code);
  if (physical) return physical[1] ?? physical[2];
  const mark = code && PUNCTUATION[code];
  if (mark) return mark;
  if (MODIFIER_KEYS.has(key) || key === 'Dead' || key === 'Unidentified' || key === '')
    return undefined;
  const k = NAMED[key] ?? key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
  if (KEY_NAMES.has(k)) return k;
  if (k.length === 1) return k.toUpperCase();
  return undefined;
}

/** The chord a key press makes (`Ctrl+Shift+P`), or undefined for a modifier pressed alone. */
export function chordOf(e: KeyPress): Chord | undefined {
  const key = keyName(e.key, e.code);
  if (key === undefined) return undefined;
  return [
    ...(e.ctrlKey || e.metaKey ? ['Ctrl'] : []),
    ...(e.altKey ? ['Alt'] : []),
    ...(e.shiftKey ? ['Shift'] : []),
    key,
  ].join('+');
}

/** A chord written by a person or kept with the settings, as `chordOf` writes it, or undefined. */
export function normalizeChord(text: string): Chord | undefined {
  // Shift alone: the ORTHO override's key (M3-06 part 5).
  if (text.trim().toLowerCase() === 'shift') return 'Shift';
  const parts = text
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  // A `+` key: `Ctrl++`.
  if (text.trim().endsWith('++')) parts.push('+');
  if (parts.length === 0) return undefined;
  const mods = new Set<string>();
  for (const p of parts.slice(0, -1)) {
    const m = p.toLowerCase();
    if (m === 'ctrl' || m === 'control' || m === 'cmd' || m === 'command') mods.add('Ctrl');
    else if (m === 'alt' || m === 'option') mods.add('Alt');
    else if (m === 'shift') mods.add('Shift');
    else return undefined;
  }
  const last = parts[parts.length - 1]!;
  const named = [...KEY_NAMES].find((n) => n.toLowerCase() === last.toLowerCase());
  const key =
    named ?? keyName(last.length === 1 ? last : last[0]!.toUpperCase() + last.slice(1), undefined);
  if (key === undefined) return undefined;
  return chordOf({
    key,
    ctrlKey: mods.has('Ctrl'),
    metaKey: false,
    altKey: mods.has('Alt'),
    shiftKey: mods.has('Shift'),
  });
}

/**
 * Whether a chord can be a shortcut key: a function key (with any modifiers), or a key with Ctrl
 * or Alt. A key alone or with Shift types at the command line (that is what aliases are for);
 * Esc, Enter, Tab and the Spacebar keep their AutoCAD meanings. A held override's (`hold`) is
 * Shift alone or Shift with one typing key, as AutoCAD's CUI allows for them.
 */
export function assignable(chord: Chord, hold = false): boolean {
  if (hold) return chord === 'Shift' || /^Shift\+.$/u.test(chord);
  const parts = chord.split('+');
  const key = parts[parts.length - 1]!;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return true;
  if (['Escape', 'Enter', 'Tab', 'Space'].includes(key) && !parts.includes('Ctrl')) return false;
  return parts.includes('Ctrl') || parts.includes('Alt');
}

/**
 * Chords a browser keeps for its own tabs and windows: a page in a tab never hears them, the
 * installed app's window does (Chrome passes them to an app window). AutoCAD's Ctrl+W, Ctrl+N
 * and Ctrl+Tab are among them.
 */
export const BROWSER_KEYS: ReadonlySet<Chord> = new Set([
  'Ctrl+N',
  'Ctrl+Shift+N',
  'Ctrl+T',
  'Ctrl+Shift+T',
  'Ctrl+W',
  'Ctrl+Shift+W',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
  'Ctrl+PageUp',
  'Ctrl+PageDown',
  'Alt+F4',
]);

/** The drafter's keys over the defaults: an action's keys in place of its defaults ([] none). */
export type KeyOverrides = Readonly<Record<string, readonly Chord[]>>;

/** The most actions with keys of their own the settings keep (guards a damaged record). */
export const KEY_OVERRIDES_MAX = 1000;

/** A stored record as key overrides: unknown actions, unreadable or unusable chords left out. */
export function normalizeKeyOverrides(raw: unknown): KeyOverrides {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, Chord[]> = {};
  for (const [id, keys] of Object.entries(raw).slice(0, KEY_OVERRIDES_MAX)) {
    if (!keyAction(id) || !Array.isArray(keys)) continue;
    const chords = keys
      .map((k) => (typeof k === 'string' ? normalizeChord(k) : undefined))
      .filter((c): c is Chord => c !== undefined && assignable(c, keyAction(id)?.hold));
    out[id] = [...new Set(chords)];
  }
  return out;
}

/** The keyboard map: the defaults with the drafter's keys over them. */
export class Keymap {
  readonly overrides: KeyOverrides;
  readonly #byChord = new Map<Chord, string>();

  constructor(overrides: KeyOverrides = {}) {
    this.overrides = overrides;
    // The drafter's own keys first: a key given to another action leaves its default owner.
    for (const [id, keys] of Object.entries(overrides))
      for (const k of keys) if (!this.#byChord.has(k)) this.#byChord.set(k, id);
    for (const a of KEY_ACTIONS) {
      if (overrides[a.id] !== undefined) continue;
      for (const k of a.keys) if (!this.#byChord.has(k)) this.#byChord.set(k, a.id);
    }
  }

  /** The action a chord runs, or undefined. */
  actionFor(chord: Chord): string | undefined {
    return this.#byChord.get(chord);
  }

  /** An action's keys now. */
  keysOf(id: string): readonly Chord[] {
    const keys = this.overrides[id] ?? ACTIONS.get(id)?.keys ?? [];
    return keys.filter((k) => this.#byChord.get(k) === id);
  }

  /** Every action that has keys now, or has had its keys changed (the table's, then commands'). */
  actions(): readonly KeyAction[] {
    const commands = Object.keys(this.overrides)
      .filter((id) => !ACTIONS.has(id))
      .sort()
      .map((id) => keyAction(id)!);
    return [...KEY_ACTIONS, ...commands];
  }

  /**
   * The map with `chord` given to `id` (taken from whatever had it): the overrides to keep. An
   * action's keys equal to its defaults are not kept as an override.
   */
  assign(id: string, chord: Chord): KeyOverrides {
    const owner = this.actionFor(chord);
    if (owner === id) return this.overrides;
    const next: Record<string, readonly Chord[]> = { ...this.overrides };
    if (owner !== undefined) next[owner] = this.keysOf(owner).filter((k) => k !== chord);
    next[id] = [...this.keysOf(id), chord];
    return compact(next);
  }

  /** The map without `chord` on `id`. */
  remove(id: string, chord: Chord): KeyOverrides {
    return compact({ ...this.overrides, [id]: this.keysOf(id).filter((k) => k !== chord) });
  }

  /** The map with `id` back on its default keys (those still free). */
  restore(id: string): KeyOverrides {
    const next: Record<string, readonly Chord[]> = { ...this.overrides };
    delete next[id];
    return compact(next);
  }
}

/** Overrides without the entries that say what the defaults say. */
function compact(o: Record<string, readonly Chord[]>): KeyOverrides {
  const out: Record<string, readonly Chord[]> = {};
  for (const [id, keys] of Object.entries(o)) {
    const defaults = ACTIONS.get(id)?.keys ?? [];
    const same = keys.length === defaults.length && keys.every((k, i) => k === defaults[i]);
    if (!same) out[id] = keys;
  }
  return out;
}

/** Where the focus is, for the text keys: the command line (empty or not), another field, none. */
export interface Focus {
  readonly kind: 'command' | 'input' | 'text' | 'none';
  /** The field holds no text (command line or input). */
  readonly empty: boolean;
}

const SELECT_ALL = 'Ctrl+A';
/** Text editing's own keys: copy, cut, paste, undo and redo text. */
const EDIT_KEYS = new Set([
  'Ctrl+C',
  'Ctrl+X',
  'Ctrl+V',
  'Ctrl+Shift+C',
  'Ctrl+Shift+V',
  'Ctrl+Z',
  'Ctrl+Y',
  'Ctrl+Shift+Z',
]);
/** A rich text editor's: bold, italic, underline. */
const RICH_KEYS = new Set(['Ctrl+B', 'Ctrl+I', 'Ctrl+U']);

/**
 * Whether a chord stays with the text field that has the focus instead of running its action:
 * Ctrl+A selects the text of a field holding some (an empty command line selects every object,
 * M2-03), the Clipboard and undo keys edit text anywhere text is typed but an empty command line
 * (M2-14, M2-23), and Ctrl+B/I/U format text in a text editor.
 */
export function keepsForText(chord: Chord, focus: Focus): boolean {
  if (chord === SELECT_ALL)
    return (
      focus.kind === 'text' ||
      ((focus.kind === 'command' || focus.kind === 'input') && !focus.empty)
    );
  if (EDIT_KEYS.has(chord))
    return (
      focus.kind === 'text' || focus.kind === 'input' || (focus.kind === 'command' && !focus.empty)
    );
  if (RICH_KEYS.has(chord)) return focus.kind === 'text';
  return false;
}

/** An action's keys for a tooltip or the palette: `F3, Ctrl+F`; '' with none. */
export const keysText = (keys: readonly Chord[]): string => keys.join(', ');
