// The open documents and which tab shows (M1-22). A small external store read with
// useSyncExternalStore: only the chrome (tabs, start screen, banners) subscribes.
import type { OpenResult } from '@triya/io';

export interface OpenDocument {
  readonly id: number;
  readonly name: string;
  readonly opened: OpenResult;
  /** The block shown: model space until layouts come (M1-18). */
  readonly block: string;
}

export interface DocumentsState {
  readonly docs: readonly OpenDocument[];
  readonly active: number | undefined;
  /** Files being opened, by name. */
  readonly opening: readonly string[];
  readonly error: string | undefined;
}

export class DocumentStore {
  #state: DocumentsState = { docs: [], active: undefined, opening: [], error: undefined };
  readonly #listeners = new Set<() => void>();
  #nextId = 1;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): DocumentsState => this.#state;

  startOpening(name: string): void {
    this.#set({ opening: [...this.#state.opening, name], error: undefined });
  }

  /** A file opened: it gets a tab, which shows. */
  opened(name: string, opened: OpenResult, block: string): void {
    const doc: OpenDocument = { id: this.#nextId++, name, opened, block };
    this.#set({
      docs: [...this.#state.docs, doc],
      active: doc.id,
      opening: this.#withoutOne(name),
    });
  }

  failed(name: string, message: string): void {
    this.#set({ opening: this.#withoutOne(name), error: message });
  }

  activate(id: number): void {
    if (this.#state.docs.some((d) => d.id === id)) this.#set({ active: id });
  }

  /** Closes a tab; the tab to its right shows next, else the one to its left. */
  close(id: number): void {
    const docs = this.#state.docs;
    const at = docs.findIndex((d) => d.id === id);
    if (at < 0) return;
    const rest = docs.filter((d) => d.id !== id);
    const active = this.#state.active === id ? (rest[at] ?? rest[at - 1])?.id : this.#state.active;
    this.#set({ docs: rest, active });
  }

  dismissError(): void {
    this.#set({ error: undefined });
  }

  #withoutOne(name: string): readonly string[] {
    const list = [...this.#state.opening];
    const i = list.indexOf(name);
    if (i >= 0) list.splice(i, 1);
    return list;
  }

  #set(patch: Partial<DocumentsState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l();
  }
}
