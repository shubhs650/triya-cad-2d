// The open documents and which tab shows (M1-22). A small external store read with
// useSyncExternalStore: only the chrome (tabs, start screen, banners) subscribes.
import type { OpenResult } from '@triya/io';
import type { ViewTransform } from '@triya/render';

/** A view saved with VIEW (New) in this session, in the space it was saved in. */
export interface SavedView {
  readonly name: string;
  readonly block: string;
  readonly view: ViewTransform;
}

export interface OpenDocument {
  readonly id: number;
  readonly name: string;
  readonly opened: OpenResult;
  /** The space shown: model space or a layout's paper-space block record. */
  readonly block: string;
  /**
   * Views saved this session. They are written into the drawing's VIEW table when saving
   * arrives (M2-13); until then they last as long as the tab.
   */
  readonly savedViews: readonly SavedView[];
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
    const doc: OpenDocument = { id: this.#nextId++, name, opened, block, savedViews: [] };
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

  /** Shows the Model tab or a layout tab of a document. */
  showSpace(id: number, block: string): void {
    this.#update(id, (d) => ({ ...d, block }));
  }

  /** VIEW New: saves `view` of the space shown under `name`, replacing a view of that name. */
  saveView(id: number, name: string, view: ViewTransform): void {
    this.#update(id, (d) => ({
      ...d,
      savedViews: [
        ...d.savedViews.filter((v) => v.name.toUpperCase() !== name.toUpperCase()),
        { name, block: d.block, view },
      ],
    }));
  }

  dismissError(): void {
    this.#set({ error: undefined });
  }

  #update(id: number, f: (d: OpenDocument) => OpenDocument): void {
    this.#set({ docs: this.#state.docs.map((d) => (d.id === id ? f(d) : d)) });
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
