// A prompt's right-click menu (M3-05 part 5): the grip modes' menu, AutoCAD's "shortcut menu of
// grip options" (`Prompt.shortcutMenu`). Which drawing's canvas opened it, where, and its items.
// A store outside React, as the canvas is (.claude/rules/ui.md).
import type { ShortcutMenuItem } from '@triya/engine';

export interface ShortcutMenuState {
  readonly doc: number;
  /** Client pixels: where the right-click was. */
  readonly at: { readonly x: number; readonly y: number };
  readonly items: readonly ShortcutMenuItem[];
}

class ShortcutMenu {
  #state: ShortcutMenuState | undefined;
  readonly #listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (): ShortcutMenuState | undefined => this.#state;

  open(
    doc: number,
    at: { readonly x: number; readonly y: number },
    items: readonly ShortcutMenuItem[],
  ): void {
    this.#set({ doc, at, items });
  }

  close(): void {
    if (this.#state) this.#set(undefined);
  }

  #set(s: ShortcutMenuState | undefined): void {
    this.#state = s;
    for (const l of this.#listeners) l();
  }
}

export const shortcutMenu = new ShortcutMenu();
