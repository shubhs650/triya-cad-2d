// Rollover tooltips (M2-35 part 21; AutoCAD 2024 Help, "ROLLOVERTIPS (System Variable)":
// "Controls the display of rollover tooltips in the application", on at first, kept per user).
// When the cursor rests on an object at `Command:`, a tooltip names it and shows its Color, Layer
// and Linetype (the engine's `rolloverSheet`); it goes when the cursor moves on. Help gives no
// delay for it, so Triya waits `ROLLOVER_DELAY_MS`, and none while a command runs, where the
// cursor's tooltips are Dynamic Input's.
import type { EntityId, PropertySheet, Vec2 } from '@triya/engine';
import { valueText } from './properties';

/** How long the cursor rests on an object before its tooltip shows. */
export const ROLLOVER_DELAY_MS = 400;
/** Where the tooltip goes from the cursor: below and to its right, clear of the crosshairs. */
export const ROLLOVER_OFFSET = { x: 16, y: 20 } as const;

/** Where the cursor rests: the drawing's point under it and its place in the window. */
export interface RestAt {
  readonly world: Vec2;
  readonly clientX: number;
  readonly clientY: number;
}

export interface RolloverTip {
  readonly sheet: PropertySheet;
  readonly clientX: number;
  readonly clientY: number;
}

/** Each drawing's tooltip, and the rest it waits on the engine for. */
export class Rollovers {
  readonly #tips = new Map<number, RolloverTip>();
  readonly #pending = new Map<number, { token: number; at: RestAt; id?: EntityId }>();
  readonly #listeners = new Set<() => void>();
  #next = 1;

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (doc: number): RolloverTip | undefined => this.#tips.get(doc);

  /** A rest starts: the tooltip shown goes; returns the rest's token. */
  begin(doc: number, at: RestAt): number {
    this.clear(doc);
    const token = this.#next++;
    this.#pending.set(doc, { token, at });
    return token;
  }

  /** Whether `token` is still the drawing's rest. */
  current(doc: number, token: number): boolean {
    return this.#pending.get(doc)?.token === token;
  }

  /** The rest's object was found; the engine's answer for it is awaited. */
  asked(doc: number, token: number, id: EntityId): void {
    const p = this.#pending.get(doc);
    if (p?.token === token) this.#pending.set(doc, { ...p, id });
  }

  /** The engine's tooltip for object `id`: shown if the drawing's rest still waits on it. */
  answer(doc: number, id: EntityId, sheet: PropertySheet | undefined): void {
    const p = this.#pending.get(doc);
    if (!p || p.id !== id) return;
    this.#pending.delete(doc);
    if (!sheet) return;
    this.#tips.set(doc, { sheet, clientX: p.at.clientX, clientY: p.at.clientY });
    this.#emit();
  }

  /** The rest ended (the cursor moved on, a command started): no tooltip, none awaited. */
  clear(doc: number): void {
    this.#pending.delete(doc);
    if (this.#tips.delete(doc)) this.#emit();
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }
}

export const rollovers = new Rollovers();

/** What a rest needs from the app: the setting, the command line, the canvas and the engine. */
export interface RolloverDeps {
  /** ROLLOVERTIPS is on. */
  enabled(): boolean;
  /** The drawing waits at `Command:`. */
  idle(): boolean;
  /** The objects within the pickbox of a point, nearest first. */
  pick(world: Vec2): Promise<readonly EntityId[]>;
  /** Asks the drawing's engine for an object's tooltip (the session's `rollover` input). */
  ask(id: EntityId): void;
}

/**
 * The cursor rests at `at` on drawing `doc`'s canvas, or stopped resting (undefined): the nearest
 * object under it is asked for its tooltip, which `Rollovers.answer` then shows.
 */
export async function hoverRollover(
  tips: Rollovers,
  doc: number,
  at: RestAt | undefined,
  deps: RolloverDeps,
): Promise<void> {
  if (!at || !deps.enabled() || !deps.idle()) return tips.clear(doc);
  const token = tips.begin(doc, at);
  const ids = await deps.pick(at.world);
  if (!tips.current(doc, token)) return;
  const id = ids[0];
  if (id === undefined) return tips.clear(doc);
  tips.asked(doc, token, id);
  deps.ask(id);
}

/** The tooltip's text: the object's type, then each row as the Properties palette shows it. */
export function rolloverLines(sheet: PropertySheet): {
  title: string;
  rows: { label: string; value: string }[];
} {
  const section = sheet.sections[0];
  return {
    title: section?.title ?? '',
    rows: (section?.rows ?? []).map((r) => ({ label: r.label, value: valueText(r, sheet.units) })),
  };
}

/**
 * Where the tooltip goes, in window pixels: below and to the right of the cursor, or on its other
 * side where the window's right or bottom edge would cut it.
 */
export function rolloverPlacement(
  cursor: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number },
): { left: number; top: number } {
  let left = cursor.x + ROLLOVER_OFFSET.x;
  let top = cursor.y + ROLLOVER_OFFSET.y;
  if (left + size.width > view.width) left = cursor.x - ROLLOVER_OFFSET.x - size.width;
  if (top + size.height > view.height) top = cursor.y - ROLLOVER_OFFSET.y - size.height;
  return { left: Math.max(0, left), top: Math.max(0, top) };
}
