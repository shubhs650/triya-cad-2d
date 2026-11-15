// A grip's hover menu (M3-05 part 2; AutoCAD 2024 Help, GRIPMULTIFUNCTIONAL's initial 3: "Access
// multi-functional grip options with Ctrl-cycling and the hover grip menu"). When the cursor
// rests on a grip of the selection at `Command:`, the drawing's engine is asked for the grip's
// functions (the session's `grip-menu` input); a grip with several shows them beside the
// cursor, and choosing one makes the grip hot in that function (`GripMenu.tsx`). The menu stays
// a moment as the cursor leaves the grip, long enough to reach it, and while the cursor is on it.
import type { Vec2 } from '@triya/engine';
import type { RestAt } from './rollover';

/** Where the menu goes from the cursor: below and to its right, clear of the grip. */
export const GRIP_MENU_OFFSET = { x: 8, y: 8 } as const;
/** How long the menu stays after the cursor leaves the grip or the menu. */
export const GRIP_MENU_LINGER_MS = 400;

export interface GripMenuState {
  readonly doc: number;
  /** The grip, in drawing units: where the function picked makes the grip hot. */
  readonly grip: Vec2;
  /** How near the grip counts as on it, the pick's `grip`. */
  readonly within: number;
  readonly items: readonly string[];
  /** Window pixels. */
  readonly left: number;
  readonly top: number;
}

/** What a rest needs from the app: the command line, the canvas and the engine. */
export interface GripMenuDeps {
  /** The drawing waits at `Command:` with grips shown. */
  idle(): boolean;
  /** How near a grip counts as on it, drawing units (`CanvasController.gripReach`). */
  reach(): number;
  /** Asks the drawing's engine for the grip at `point` (the session's `grip-menu` input). */
  ask(point: Vec2, within: number): void;
}

/** The one hover menu (there is one cursor), and the rest it waits on the engine for. */
export class GripMenus {
  #shown: GripMenuState | undefined;
  #pending: { doc: number; at: RestAt; within: number } | undefined;
  /** The cursor is on the menu. */
  #over = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (): GripMenuState | undefined => this.#shown;

  /**
   * The cursor rests at `at` on drawing `doc`'s canvas, or stopped resting (undefined): a rest
   * asks for the grip there, the menu shown going; the rest's end lets the menu linger.
   */
  rest(doc: number, at: RestAt | undefined, deps: GripMenuDeps): void {
    if (!at) {
      this.#pending = undefined;
      this.#linger();
      return;
    }
    this.#set(undefined);
    this.#pending = undefined;
    if (!deps.idle()) return;
    const within = deps.reach();
    this.#pending = { doc, at, within };
    deps.ask(at.world, within);
  }

  /** The engine's answer for a rest at `point`: shown if that rest still waits on it. */
  answer(doc: number, point: Vec2, grip: Vec2 | undefined, items: readonly string[]): void {
    const p = this.#pending;
    if (!p || p.doc !== doc || p.at.world.x !== point.x || p.at.world.y !== point.y) return;
    this.#pending = undefined;
    if (!grip || items.length < 2) return;
    this.#set({
      doc,
      grip,
      within: p.within,
      items,
      left: p.at.clientX + GRIP_MENU_OFFSET.x,
      top: p.at.clientY + GRIP_MENU_OFFSET.y,
    });
  }

  /** The cursor came onto the menu: it stays. */
  enter(): void {
    this.#over = true;
    clearTimeout(this.#timer);
  }

  /** The cursor left the menu: it lingers, then goes. */
  leave(): void {
    this.#over = false;
    this.#linger();
  }

  /** Drawing `doc`'s menu goes (a command started, its grips changed, a function chosen). */
  close(doc: number): void {
    if (this.#pending?.doc === doc) this.#pending = undefined;
    if (this.#shown?.doc === doc) this.#set(undefined);
  }

  #linger(): void {
    clearTimeout(this.#timer);
    if (!this.#shown || this.#over) return;
    this.#timer = setTimeout(() => {
      if (!this.#over) this.#set(undefined);
    }, GRIP_MENU_LINGER_MS);
  }

  #set(s: GripMenuState | undefined): void {
    clearTimeout(this.#timer);
    if (!s) this.#over = false;
    if (s === this.#shown) return;
    this.#shown = s;
    for (const l of this.#listeners) l();
  }
}

export const gripMenus = new GripMenus();
