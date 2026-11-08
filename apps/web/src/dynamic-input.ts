// Dynamic Input's fields (M2-02 part 2, UI_SPEC.md §5, FR-C2): the tooltip at the cursor while a
// command waits. It is a front-end of the command engine like the command line: what is typed in
// its fields becomes the same text the command line would send, so the bus parses both alike.
// As AutoCAD 2024 (Help, "About Dynamic Input"; "Dynamic Input Tab (Drafting Settings Dialog
// Box)"), with DYNMODE 3 and DYNPICOORDS 0:
// - pointer input at a point prompt: X and Y fields; a comma moves to Y; the first point is
//   absolute, the next ones relative to the last (`@`) unless typed with `#`;
// - dimension input at a point prompt with a rubber band: Distance and Angle fields; `<` moves
//   to the angle; a distance alone is a direct distance towards the cursor;
// - Tab locks the field typed in and moves to the next; Backspace unlocks it once emptied;
// - anything that is not a number (an option, `@100<45`, FROM, `'Z`) is taken as typed.
import type { Prompt, Vec2 } from '@triya/engine';

export type DynKind = 'pointer' | 'dimension' | 'single';

export interface DynField {
  readonly label: string;
  readonly text: string;
  readonly locked: boolean;
}

export interface DynState {
  readonly kind: DynKind;
  readonly fields: readonly DynField[];
  readonly active: number;
  /** Typed text that is not a number: sent as typed, from the first field. */
  readonly raw: boolean;
  /** The highlighted option of the ↓ menu, when open. */
  readonly menu?: number;
}

const field = (label: string): DynField => ({ label, text: '', locked: false });

/** The fields a prompt shows. */
export function dynFor(prompt: Prompt): DynState {
  const base = { active: 0, raw: false } as const;
  if (prompt.kind === 'point' && prompt.rubberBand && !prompt.rubberBand.box) {
    return { ...base, kind: 'dimension', fields: [field('Distance'), field('Angle')] };
  }
  if (prompt.kind === 'point')
    return { ...base, kind: 'pointer', fields: [field('X'), field('Y')] };
  const label = prompt.kind === 'distance' ? 'Distance' : prompt.kind === 'angle' ? 'Angle' : '';
  return { ...base, kind: 'single', fields: [field(label)] };
}

/** Pointer input's coordinates are relative to the last point once there is one (DYNPICOORDS 0). */
export function isRelative(prompt: Prompt): boolean {
  return prompt.kind === 'point' && prompt.rubberBand !== undefined;
}

/** A number being typed; the first pointer field may start with `@` or `#`. */
function plain(s: DynState, index: number, text: string): boolean {
  const prefix = s.kind === 'pointer' && index === 0 ? '[@#]?' : '';
  return new RegExp(`^${prefix}[-+]?\\d*\\.?\\d*$`).test(text);
}

const SEPARATOR: Record<DynKind, string> = { pointer: ',', dimension: '<', single: '' };

const withField = (s: DynState, i: number, f: Partial<DynField>): DynState => ({
  ...s,
  fields: s.fields.map((x, j) => (j === i ? { ...x, ...f } : x)),
});

/** The fields as text, as far as typed: `10,2` or `5<30`. */
function typedSoFar(s: DynState): string {
  const sep = SEPARATOR[s.kind];
  return s.fields
    .slice(0, s.active + 1)
    .map((f) => f.text)
    .join(sep);
}

/** A character typed. */
export function dynType(s: DynState, ch: string): DynState {
  const { menu: _menu, ...rest } = s;
  s = rest;
  const f = s.fields[s.active]!;
  if (s.raw) return withField(s, 0, { text: f.text + ch });
  const next = f.text + ch;
  if (ch === SEPARATOR[s.kind] && s.active === 0 && f.text !== '' && plain(s, 0, f.text)) {
    return { ...s, active: 1 };
  }
  if (plain(s, s.active, next)) return withField(s, s.active, { text: next });
  return {
    ...s,
    raw: true,
    active: 0,
    fields: [{ ...field(s.fields[0]!.label), text: typedSoFar(s) + ch }],
  };
}

/** Tab: locks the field typed in and moves to the next. */
export function dynTab(s: DynState): DynState {
  if (s.raw || s.fields.length < 2) return s;
  const f = s.fields[s.active]!;
  const locked = f.text !== '' && f.text !== '@' && f.text !== '#';
  return { ...withField(s, s.active, { locked }), active: (s.active + 1) % s.fields.length };
}

/** Backspace: deletes the last character; an emptied field unlocks, and an empty one goes back. */
export function dynBackspace(s: DynState, prompt: Prompt): DynState {
  const f = s.fields[s.active]!;
  if (s.raw)
    return f.text.length <= 1 ? dynFor(prompt) : withField(s, 0, { text: f.text.slice(0, -1) });
  if (f.text === '' && s.active > 0)
    return { ...withField(s, s.active, { locked: false }), active: s.active - 1 };
  const text = f.text.slice(0, -1);
  return withField(s, s.active, { text, locked: text !== '' && f.locked });
}

/**
 * The fields of a prompt after `keys` (characters, `Tab`, `Backspace`): what was typed ahead
 * of a prompt that had not arrived yet carries over to it rather than being lost.
 */
export function dynReplay(prompt: Prompt, keys: readonly string[]): DynState {
  let s = dynFor(prompt);
  for (const k of keys) {
    s = k === 'Tab' ? dynTab(s) : k === 'Backspace' ? dynBackspace(s, prompt) : dynType(s, k);
  }
  return s;
}

/** Whether anything was typed. */
export const dynTyped = (s: DynState): boolean => s.fields.some((f) => f.text !== '');

const fmt = (v: number) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};

/** Degrees counter-clockwise from +X, 0 to 360. */
function degrees(from: Vec2, to: Vec2): number {
  const a = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** What each field shows while nothing is typed in it: the cursor's coordinates or distance and angle. */
export function dynLive(s: DynState, prompt: Prompt, cursor: Vec2 | undefined): readonly string[] {
  if (!cursor) return s.fields.map(() => '');
  const base =
    prompt.kind === 'point' ? prompt.rubberBand?.from : 'base' in prompt ? prompt.base : undefined;
  if (s.kind === 'pointer') {
    const rel =
      base && isRelative(prompt) && !s.fields[0]!.text.startsWith('#') ? base : { x: 0, y: 0 };
    return [fmt(cursor.x - rel.x), fmt(cursor.y - rel.y)];
  }
  if (!base) return s.fields.map(() => '');
  const d = Math.hypot(cursor.x - base.x, cursor.y - base.y);
  if (s.kind === 'dimension') return [fmt(d), fmt(degrees(base, cursor))];
  return [prompt.kind === 'angle' ? fmt(degrees(base, cursor)) : fmt(d)];
}

/**
 * The text Enter sends to the command engine: '' (Enter) with nothing typed; a value left
 * untyped beside a typed one is the cursor's, as the field shows it.
 */
export function dynText(s: DynState, prompt: Prompt, cursor: Vec2 | undefined): string {
  const [a = '', b = ''] = s.fields.map((f) => f.text);
  if (s.raw || s.kind === 'single') return a;
  if (a === '' && b === '') return '';
  const live = dynLive(s, prompt, cursor);
  if (s.kind === 'dimension') {
    // A distance alone is a direct distance: the bus measures it towards the cursor.
    if (b === '') return a;
    return `@${a === '' ? live[0] : a}<${b}`;
  }
  const prefix = a.startsWith('#') ? '#' : a.startsWith('@') || isRelative(prompt) ? '@' : '';
  const x = a.replace(/^[@#]/, '');
  return `${prefix}${x === '' ? live[0] : x},${b === '' ? live[1] : b}`;
}

/** DYNMODE: Dynamic Input on (AutoCAD's default) or off; F12 and the status bar toggle it. */
export class DynMode {
  #on = true;
  readonly #listeners = new Set<() => void>();
  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };
  get = (): boolean => this.#on;
  set(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    for (const l of this.#listeners) l();
  }
  toggle(): void {
    this.set(!this.#on);
  }
}

export const dynMode = new DynMode();
