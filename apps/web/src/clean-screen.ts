// Clean Screen (M7-06; AutoCAD 2024 Help, "CLEANSCREENON (Command)": "Clears the screen of the
// ribbon, toolbars, and dockable windows, excluding the command line"): Ctrl+0, the status bar's
// Clean Screen button and CLEANSCREENON/OFF hide the ribbon, the palettes and their rail, leaving
// the title bar, file tabs, layout tabs, command line and status bar. Turned off, the palettes
// hidden by it come back; palettes hidden before it (HIDEPALETTES) stay hidden. For this session
// only, as AutoCAD's CLEANSCREENSTATE is not saved with a drawing.
import { paletteStack, type PaletteStack } from './palette-stack';

export class CleanScreen {
  #on = false;
  /** The palettes were hidden before Clean Screen hid them. */
  #palettesHidden = false;
  readonly #stack: PaletteStack;
  readonly #listeners = new Set<() => void>();

  constructor(stack: PaletteStack) {
    this.#stack = stack;
  }

  on = (): boolean => this.#on;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    if (on) {
      this.#palettesHidden = this.#stack.hidden();
      this.#stack.show(false);
    } else if (!this.#palettesHidden) this.#stack.show(true);
    for (const l of this.#listeners) l();
  }

  toggle(): void {
    this.set(!this.#on);
  }
}

export const cleanScreen = new CleanScreen(paletteStack);
