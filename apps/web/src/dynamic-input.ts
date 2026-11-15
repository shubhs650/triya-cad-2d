// Dynamic Input's fields (M2-02 part 2, UI_SPEC.md §5, FR-C2): the tooltip at the cursor while a
// command waits. It is a front-end of the command engine like the command line: what is typed in
// its fields becomes the same text the command line would send, so the bus parses both alike.
// As AutoCAD 2024 (Help, "About Dynamic Input"; "Dynamic Input Tab (Drafting Settings Dialog
// Box)"), with DYNMODE 3 and DYNPICOORDS 0:
// - pointer input at a point prompt: X and Y fields; a comma moves to Y; the first point is
//   absolute, the next ones relative to the last (`@`) unless typed with `#`;
// - dimension input at a point prompt with a rubber band: Distance and Angle fields; `<` moves
//   to the angle; a distance alone is a direct distance towards the cursor; a comma switches to
//   pointer input, relative to the last point (M2-71);
// - Tab locks the field typed in and moves to the next; Backspace unlocks it once emptied;
// - anything that is not a number (an option, `@100<45`, FROM, `'Z`) is taken as typed;
// - the fields show the cursor's values in the drawing's units (M2-35 part 20), as the status
//   bar and the command line show them: coordinates and distances by LUNITS/LUPREC, angles by
//   AUNITS/AUPREC, as RTOS and ANGTOS write them (the engine's `formatDistance`/`formatAngle`).
// The Drafting Settings dialog's Dynamic Input tab (M3-06 part 4) sets which of them show
// (`DynSettings`): pointer input (DYNMODE bit 1) in polar or Cartesian format (DYNPIFORMAT) with
// relative or absolute next points (DYNPICOORDS), dimension input (DYNMODE bit 2), and the
// prompt itself (DYNPROMPT). A prompt none of them applies to takes what is typed, as typed.
import {
  DECIMAL_UNITS,
  DEFAULT_ANGLES,
  formatAngle,
  formatDistance,
  formatNumber,
  type AngleConvention,
  type DrawingUnits,
  type Prompt,
  type Vec2,
} from '@triya/engine';
import type { DraftingState } from './drafting';

/** DYNMODE's bits: pointer input and dimension input. */
export const DYN_POINTER = 1;
export const DYN_DIMENSION = 2;

/** What the Dynamic Input tab sets (AutoCAD 2024 Help, "Dynamic Input Tab"), kept per user. */
export interface DynSettings {
  /** Enable Pointer Input (DYNMODE bit 1): X and Y fields at point prompts. */
  readonly pointer: boolean;
  /** Enable Dimension Input where possible (DYNMODE bit 2): distance and angle fields. */
  readonly dimension: boolean;
  /** Show command prompting and command input near the crosshairs (DYNPROMPT). */
  readonly prompt: boolean;
  /** Pointer input's next points: absolute (DYNPICOORDS 1), else relative (0). */
  readonly absolute: boolean;
  /** Pointer input's next points: Cartesian format (DYNPIFORMAT 1), else polar (0). */
  readonly cartesian: boolean;
}

/** AutoCAD's initial settings: DYNMODE 3, DYNPROMPT 1, DYNPICOORDS 0, DYNPIFORMAT 0. */
export const DYN_SETTINGS: DynSettings = {
  pointer: true,
  dimension: true,
  prompt: true,
  absolute: false,
  cartesian: false,
};

/** The Dynamic Input settings the drafting aids keep. */
export const dynSettings = (
  d: Pick<DraftingState, 'dynBits' | 'dynPrompt' | 'dynPiCoords' | 'dynPiFormat'>,
): DynSettings => ({
  pointer: (d.dynBits & DYN_POINTER) !== 0,
  dimension: (d.dynBits & DYN_DIMENSION) !== 0,
  prompt: d.dynPrompt,
  absolute: d.dynPiCoords === 1,
  cartesian: d.dynPiFormat === 1,
});

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
  /** Pointer input's X and Y count from the rubber band's start (`@`). */
  readonly relative: boolean;
  /** Typed text that is not a number: sent as typed, from the first field. */
  readonly raw: boolean;
  /** The highlighted option of the ↓ menu, when open. */
  readonly menu?: number;
}

const field = (label: string): DynField => ({ label, text: '', locked: false });

/**
 * The fields a prompt shows with settings `o`. Next points (with a rubber band) take dimension
 * input, else pointer input in its format; a first point pointer input. A prompt neither applies
 * to has one unlabelled field, which takes what is typed.
 */
export function dynFor(prompt: Prompt, o: DynSettings = DYN_SETTINGS): DynState {
  const relative = prompt.kind === 'point' && prompt.rubberBand !== undefined && !o.absolute;
  const base = { active: 0, raw: false, relative } as const;
  const none: DynState = { ...base, kind: 'single', fields: [field('')] };
  if (prompt.kind === 'point' && prompt.rubberBand && !prompt.rubberBand.box) {
    if (o.dimension || (o.pointer && !o.cartesian))
      return { ...base, kind: 'dimension', fields: [field('Distance'), field('Angle')] };
  }
  if (prompt.kind === 'point')
    return o.pointer ? { ...base, kind: 'pointer', fields: [field('X'), field('Y')] } : none;
  if ((prompt.kind === 'distance' || prompt.kind === 'angle') && !o.dimension) return none;
  // SCALE and the SCALE grip mode take a factor, which the cursor's distance gives (M2-06).
  const scale = prompt.kind === 'distance' && prompt.drag?.kind === 'scale';
  const label =
    prompt.kind === 'distance'
      ? scale
        ? 'Scale'
        : 'Distance'
      : prompt.kind === 'angle'
        ? 'Angle'
        : '';
  return { ...base, kind: 'single', fields: [field(label)] };
}

/**
 * Whether the tooltip shows for fields `s`: for fields to type in, or for the prompt itself
 * while DYNPROMPT is 1.
 */
export const dynShows = (s: DynState, o: DynSettings): boolean =>
  o.prompt || s.kind !== 'single' || s.fields[0]!.label !== '';

/**
 * A number being typed; the first pointer field may start with `@` or `#`. After a digit, the
 * marks of feet and inches and fractions (`5'-6-1/2"`), which the bus reads in architectural and
 * engineering units (M2-35 part 7); a quote first is a transparent command (`'Z`).
 */
function plain(s: DynState, index: number, text: string): boolean {
  const prefix = s.kind === 'pointer' && index === 0 ? '[@#]?' : '';
  return new RegExp(`^${prefix}[-+]?(?:\\d[\\d.'"/-]*|\\.\\d*)?$`).test(text);
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
  // A comma after a number in the Distance field switches dimension input to pointer input:
  // the point is X,Y relative to the last (AutoCAD 2024 Help, "About Dynamic Input": for the
  // second and next points pointer input's coordinates are relative, DYNPICOORDS 0), so
  // `10,0` typed at LINE's next point goes 10 to the right, as `@10,0` at the command line.
  if (
    ch === ',' &&
    s.kind === 'dimension' &&
    s.active === 0 &&
    f.text !== '' &&
    plain(s, 0, f.text)
  ) {
    return {
      ...s,
      kind: 'pointer',
      active: 1,
      fields: [{ ...field('X'), text: f.text }, field('Y')],
    };
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
export function dynBackspace(s: DynState, prompt: Prompt, o: DynSettings = DYN_SETTINGS): DynState {
  const f = s.fields[s.active]!;
  if (s.raw)
    return f.text.length <= 1 ? dynFor(prompt, o) : withField(s, 0, { text: f.text.slice(0, -1) });
  if (f.text === '' && s.active > 0)
    return { ...withField(s, s.active, { locked: false }), active: s.active - 1 };
  const text = f.text.slice(0, -1);
  return withField(s, s.active, { text, locked: text !== '' && f.locked });
}

/** Whether `key` ends the input at `prompt` with fields `s`: Enter, or a space a name does not take. */
export function dynEnds(s: DynState, prompt: Prompt, key: string): boolean {
  const spaces = prompt.kind === 'string' && prompt.spaces === true && s.raw;
  return key === 'Enter' || (key === ' ' && !spaces);
}

/** A key that types into the fields: a character, Tab or Backspace. */
function dynKey(s: DynState, prompt: Prompt, key: string, o: DynSettings): DynState {
  if (key === 'Tab') return dynTab(s);
  if (key === 'Backspace') return dynBackspace(s, prompt, o);
  return dynType(s, key);
}

/**
 * Keys held ahead of `prompt` (M2-71, command-line.ts `holdsKey`) replayed into its fields `s`:
 * the fields after them and the keys that typed into them (`typed`), or, when a key ends the
 * input, the fields it ends (`ends`) and the keys after it, which wait for the prompt that input
 * leads to (`rest`). An Esc stops the replay: it is left first in `rest`, for the command line
 * to cancel with.
 */
export function dynAhead(
  s: DynState,
  prompt: Prompt,
  keys: readonly string[],
  o: DynSettings = DYN_SETTINGS,
): {
  readonly state: DynState;
  readonly typed: readonly string[];
  readonly ends: boolean;
  readonly rest: readonly string[];
} {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (key === 'Escape')
      return { state: s, typed: keys.slice(0, i), ends: false, rest: keys.slice(i) };
    if (dynEnds(s, prompt, key)) {
      return { state: s, typed: keys.slice(0, i), ends: true, rest: keys.slice(i + 1) };
    }
    s = dynKey(s, prompt, key, o);
  }
  return { state: s, typed: keys, ends: false, rest: [] };
}

/**
 * The fields of a prompt after `keys` (characters, `Tab`, `Backspace`): what was typed ahead
 * of a prompt that had not arrived yet carries over to it rather than being lost.
 */
export function dynReplay(
  prompt: Prompt,
  keys: readonly string[],
  o: DynSettings = DYN_SETTINGS,
): DynState {
  let s = dynFor(prompt, o);
  for (const k of keys) s = dynKey(s, prompt, k, o);
  return s;
}

/**
 * The fields a key typed now goes to: those last set, if they were set for `prompt`, else the
 * prompt's own with what was typed ahead of it replayed. A key can come as a new prompt shows,
 * before its fields are set (M2-34: a ROTATE angle typed so went into the base point's X field,
 * and Enter sent `90,<cursor Y>`).
 */
export function dynCurrent(
  latest: { readonly prompt: Prompt | undefined; readonly state: DynState | undefined },
  prompt: Prompt | undefined,
  typed: readonly string[],
  o: DynSettings = DYN_SETTINGS,
): DynState | undefined {
  if (latest.prompt === prompt && latest.state) return latest.state;
  return prompt && dynReplay(prompt, typed, o);
}

/** Whether anything was typed. */
export const dynTyped = (s: DynState): boolean => s.fields.some((f) => f.text !== '');

/** How the fields show values: the drawing's units and how its typed angles turn (ANGBASE, ANGDIR). */
export interface DynUnits {
  readonly units: DrawingUnits;
  readonly angles?: AngleConvention;
}

/** AutoCAD's defaults: four decimal places, whole degrees counter-clockwise from east. */
export const DYN_DEFAULT_UNITS: DynUnits = { units: DECIMAL_UNITS, angles: DEFAULT_ANGLES };

/**
 * The direction from `from` to `to` as it would be typed: ANGBASE and ANGDIR turn a typed angle
 * into the world (`parseAngle`), so the shown one is turned back, and typing it goes where the
 * cursor is. A bearing names a world direction whatever they say (M2-35 part 18).
 */
function typedAngle(from: Vec2, to: Vec2, u: DynUnits): string {
  const world = Math.atan2(to.y - from.y, to.x - from.x);
  const { base, clockwise } = u.angles ?? DEFAULT_ANGLES;
  const typed = u.units.aunits === 4 ? world : clockwise ? base - world : world - base;
  return formatAngle(typed, u.units);
}

/** What each field shows while nothing is typed in it: the cursor's coordinates or distance and angle. */
export function dynLive(
  s: DynState,
  prompt: Prompt,
  cursor: Vec2 | undefined,
  u: DynUnits = DYN_DEFAULT_UNITS,
): readonly string[] {
  if (!cursor) return s.fields.map(() => '');
  const length = (v: number) => formatDistance(v, u.units);
  const base =
    prompt.kind === 'point' ? prompt.rubberBand?.from : 'base' in prompt ? prompt.base : undefined;
  if (s.kind === 'pointer') {
    const rel = base && s.relative && !s.fields[0]!.text.startsWith('#') ? base : { x: 0, y: 0 };
    return [length(cursor.x - rel.x), length(cursor.y - rel.y)];
  }
  if (!base) return s.fields.map(() => '');
  const d = Math.hypot(cursor.x - base.x, cursor.y - base.y);
  if (s.kind === 'dimension') return [length(d), typedAngle(base, cursor, u)];
  if (prompt.kind === 'angle') return [typedAngle(base, cursor, u)];
  // SCALE's factor is a plain number, as the command line shows a real (`<1.0000>`).
  return [s.fields[0]!.label === 'Scale' ? formatNumber(d, u.units.luprec) : length(d)];
}

/**
 * The text Enter sends to the command engine: '' (Enter) with nothing typed; a value left
 * untyped beside a typed one is the cursor's, as the field shows it (in the drawing's units,
 * which the engine reads back whatever LUNITS says).
 */
export function dynText(
  s: DynState,
  prompt: Prompt,
  cursor: Vec2 | undefined,
  u: DynUnits = DYN_DEFAULT_UNITS,
): string {
  const [a = '', b = ''] = s.fields.map((f) => f.text);
  if (s.raw || s.kind === 'single') return a;
  if (a === '' && b === '') return '';
  const live = dynLive(s, prompt, cursor, u);
  if (s.kind === 'dimension') {
    // A distance alone is a direct distance: the bus measures it towards the cursor.
    if (b === '') return a;
    return `@${a === '' ? live[0] : a}<${b}`;
  }
  const prefix = a.startsWith('#') ? '#' : a.startsWith('@') || s.relative ? '@' : '';
  const x = a.replace(/^[@#]/, '');
  return `${prefix}${x === '' ? live[0] : x},${b === '' ? live[1] : b}`;
}

/**
 * What a relative point Enter sends (`text`, starting `@`) counts from: the base of the prompt's
 * rubber band, which the X, Y, Distance and Angle fields measure from. The command line's `@`
 * counts from the last point given, which COPY's second points leave behind each copy while
 * their rubber band stays on the base point (M2-71); undefined where there is no rubber band.
 */
export function dynRelativeTo(text: string, prompt: Prompt): Vec2 | undefined {
  if (!text.startsWith('@') || prompt.kind !== 'point') return undefined;
  return prompt.rubberBand?.from;
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
