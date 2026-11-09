// Closing a drawing with unsaved changes (M2-13): AutoCAD asks "Save changes to <file>?" with
// Yes, No and Cancel before CLOSE (AutoCAD 2024 Help, "CLOSE (Command)"). The question waits
// here, outside React, until SaveChanges.tsx answers it; one question at a time.
export type SaveChangesAnswer = 'yes' | 'no' | 'cancel';

export interface SaveChangesQuestion {
  /** The drawing's file name, as its tab shows it. */
  readonly name: string;
}

export class SaveChangesPrompt {
  #question: SaveChangesQuestion | undefined;
  #answer: ((a: SaveChangesAnswer) => void) | undefined;
  readonly #listeners = new Set<() => void>();

  readonly subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  readonly get = (): SaveChangesQuestion | undefined => this.#question;

  /** Asks about the drawing `name`; a question still open is answered Cancel. */
  ask(name: string): Promise<SaveChangesAnswer> {
    this.answer('cancel');
    return new Promise((resolve) => {
      this.#question = { name };
      this.#answer = resolve;
      this.#emit();
    });
  }

  answer(a: SaveChangesAnswer): void {
    const resolve = this.#answer;
    if (!resolve) return;
    this.#question = undefined;
    this.#answer = undefined;
    this.#emit();
    resolve(a);
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }
}

export const saveChanges = new SaveChangesPrompt();
