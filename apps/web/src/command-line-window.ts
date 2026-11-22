// The command line shown or hidden (M7-06 part 3; AutoCAD 2024 Help, "COMMANDLINEHIDE (Command)":
// "Hides the Command Line window", "COMMANDLINE": "Displays the Command Line window"; Ctrl+9
// toggles it). Hidden, its history and prompt row go, and the drawing area takes their place;
// typing still reaches it, and while text is typed or a command's prompt waits its input row
// shows over the foot of the drawing area. For this session only, as Clean Screen is.
export class CommandLineWindow {
  #shown = true;
  readonly #listeners = new Set<() => void>();

  shown = (): boolean => this.#shown;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set(shown: boolean): void {
    if (shown === this.#shown) return;
    this.#shown = shown;
    for (const l of this.#listeners) l();
  }

  toggle(): void {
    this.set(!this.#shown);
  }
}

export const commandLineWindow = new CommandLineWindow();

/**
 * Whether the hidden command line shows its input row: while text is typed in it, or a command
 * waits at a prompt (not at `Command:`, nor while a dialog of the app's has it waiting).
 */
export function showsInputRow(o: {
  readonly shown: boolean;
  readonly text: string;
  readonly prompting: boolean;
}): boolean {
  return o.shown || o.text !== '' || o.prompting;
}
