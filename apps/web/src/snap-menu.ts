// The object snap menu's state (M2-04 part 2): which drawing's canvas opened it with
// Shift+right-click, and where. A store outside React, as the canvas is (.claude/rules/ui.md).
import { OSNAP_MODES } from '@triya/engine';

export interface SnapMenuState {
  readonly doc: number;
  /** Client pixels: where the right-click was. */
  readonly at: { readonly x: number; readonly y: number };
}

/**
 * AutoCAD's Shift+right-click menu (AutoCAD 2024 Help, "Object Snap Overrides"), each item
 * the text typed at the prompt to the same effect: the point modifiers, every object snap
 * mode as a one-shot override, and None.
 */
export const SNAP_MENU_ITEMS: readonly { readonly label: string; readonly text: string }[] = [
  { label: 'From', text: 'FROM' },
  { label: 'Mid Between 2 Points', text: 'M2P' },
  ...OSNAP_MODES.map((m) => ({ label: m.label, text: m.mode })),
  { label: 'None', text: 'NON' },
];

class SnapMenu {
  #state: SnapMenuState | undefined;
  readonly #listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (): SnapMenuState | undefined => this.#state;

  open(doc: number, at: { readonly x: number; readonly y: number }): void {
    this.#set({ doc, at });
  }

  close(): void {
    if (this.#state) this.#set(undefined);
  }

  #set(s: SnapMenuState | undefined): void {
    this.#state = s;
    for (const l of this.#listeners) l();
  }
}

export const snapMenu = new SnapMenu();
