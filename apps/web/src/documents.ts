// The open documents and which tab shows (M1-22). A small external store read with
// useSyncExternalStore: only the chrome (tabs, start screen, banners) subscribes.
import type { ChangeSet, DocumentInit, Layout } from '@triya/engine';
import type { OpenResult } from '@triya/io';
import type { DrawingFile } from './save';

export interface OpenDocument {
  readonly id: number;
  readonly name: string;
  readonly opened: OpenResult;
  /** The space shown: model space or a layout's paper-space block record. */
  readonly block: string;
  /** Edits applied by the drawing's engine so far (M1-67): chrome that mirrors it re-reads. */
  readonly revision: number;
  /**
   * The file the drawing came from and Save writes (M2-13); undefined for a document opened
   * without its bytes (tests).
   */
  readonly file?: DrawingFile;
  /**
   * Edits that change the drawing (loading an xref does not), counted since it opened, and how
   * many of them the last save holds: the tab shows its dirty dot and closing asks to save
   * while they differ (AutoCAD's DBMOD).
   */
  readonly edits: number;
  readonly savedEdits: number;
}

/** The drawing has changes no save holds (M2-13). */
export const isDirty = (d: OpenDocument): boolean => d.edits !== d.savedEdits;

/**
 * The drawing's layouts as they are now: as opened, with what the engine's change sets carried
 * since (renamed, reordered, a new page setup or limits, M1-97; added or removed), in tab order.
 */
export function layoutsOf(init: DocumentInit, changes: readonly ChangeSet[]): Layout[] {
  const now = new Map((init.layouts ?? []).map((l) => [l.handle, l]));
  for (const { layouts: c } of changes) {
    for (const l of c?.removed ?? []) now.delete(l.handle);
    for (const { after } of c?.updated ?? []) now.set(after.handle, after);
    for (const l of c?.added ?? []) now.set(l.handle, l);
  }
  return [...now.values()].sort((a, b) => a.tabOrder - b.tabOrder);
}

/**
 * Model, then the layouts in tab order (DXF 71): the layout tabs and the file tab preview.
 * `changes` are the edits the drawing's engine applied since it opened.
 */
export function spacesOf(
  doc: Pick<OpenDocument, 'opened'>,
  changes: readonly ChangeSet[],
): { readonly name: string; readonly block: string }[] {
  const model = doc.opened.modelSpace!;
  const layouts = layoutsOf(doc.opened.init, changes).filter((l) => l.blockRecord !== model);
  return [
    { name: 'Model', block: model },
    ...layouts.map((l) => ({ name: l.name, block: l.blockRecord })),
  ];
}

export interface DocumentsState {
  readonly docs: readonly OpenDocument[];
  /**
   * Drawings open with no tab (M2-45 part 2: PUBLISH's Add Sheets opens a drawing that is not
   * open for the publish and closes it after, as AutoCAD loads one): each has its engine and a
   * hidden canvas to plot from, and none ever shows.
   */
  readonly background: readonly OpenDocument[];
  readonly active: number | undefined;
  /** Files being opened, by name. */
  readonly opening: readonly string[];
  readonly error: string | undefined;
  /** A passing note, such as a save's (M2-13). */
  readonly notice?: string | undefined;
}

export class DocumentStore {
  #state: DocumentsState = {
    docs: [],
    background: [],
    active: undefined,
    opening: [],
    error: undefined,
  };
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

  /**
   * A file opened: it gets a tab, which shows. Returns the new document's id. A drawing
   * recovered after a crash (M2-14) opens with the `edits` it had unsaved.
   */
  opened(name: string, opened: OpenResult, block: string, file?: DrawingFile, edits = 0): number {
    const doc: OpenDocument = {
      id: this.#nextId++,
      name,
      opened,
      block,
      revision: 0,
      ...(file && { file }),
      edits,
      savedEdits: 0,
    };
    this.#set({
      docs: [...this.#state.docs, doc],
      active: doc.id,
      opening: this.#withoutOne(name),
    });
    return doc.id;
  }

  /** A drawing opened with no tab (PUBLISH's Add Sheets); the tab shown stays. Returns its id. */
  openedInBackground(name: string, opened: OpenResult, block: string): number {
    const doc: OpenDocument = {
      id: this.#nextId++,
      name,
      opened,
      block,
      revision: 0,
      edits: 0,
      savedEdits: 0,
    };
    this.#set({ background: [...this.#state.background, doc] });
    return doc.id;
  }

  failed(name: string, message: string): void {
    this.#set({ opening: this.#withoutOne(name), error: message });
  }

  activate(id: number): void {
    if (this.#state.docs.some((d) => d.id === id)) this.#set({ active: id });
  }

  /** Closes a tab; the tab to its right shows next, else the one to its left. */
  close(id: number): void {
    if (this.#state.background.some((d) => d.id === id)) {
      this.#set({ background: this.#state.background.filter((d) => d.id !== id) });
      return;
    }
    const docs = this.#state.docs;
    const at = docs.findIndex((d) => d.id === id);
    if (at < 0) return;
    const rest = docs.filter((d) => d.id !== id);
    const active = this.#state.active === id ? (rest[at] ?? rest[at - 1])?.id : this.#state.active;
    this.#set({ docs: rest, active });
  }

  /**
   * Moves a tab to position `to` among the tabs (dragging a file tab, as in AutoCAD); the tab
   * showing stays the same. `to` is clamped to the ends.
   */
  move(id: number, to: number): void {
    const docs = [...this.#state.docs];
    const from = docs.findIndex((d) => d.id === id);
    if (from < 0) return;
    const at = Math.max(0, Math.min(docs.length - 1, Math.trunc(to)));
    if (at === from) return;
    const [doc] = docs.splice(from, 1);
    docs.splice(at, 0, doc!);
    this.#set({ docs });
  }

  /**
   * The drawing's engine applied an edit: the palettes mirroring it re-read. An edit that
   * `modifies` the drawing (all but loading an xref) leaves it with unsaved changes.
   */
  edited(id: number, modifies = true): void {
    this.#update(id, (d) => ({
      ...d,
      revision: d.revision + 1,
      edits: d.edits + (modifies ? 1 : 0),
    }));
  }

  /**
   * The drawing was saved as `name` to `file`, holding its first `edits` edits (those made while
   * the save ran stay unsaved).
   */
  saved(id: number, name: string, file: DrawingFile, edits: number): void {
    this.#update(id, (d) => ({ ...d, name, file, savedEdits: edits }));
    this.#set({ notice: `Saved ${name}.` });
  }

  /** Shows an error that is not about opening a file (a failed save). */
  fail(message: string): void {
    this.#set({ error: message, notice: undefined });
  }

  dismissNotice(): void {
    this.#set({ notice: undefined });
  }

  /** Shows the Model tab or a layout tab of a document. */
  showSpace(id: number, block: string): void {
    this.#update(id, (d) => ({ ...d, block }));
  }

  dismissError(): void {
    this.#set({ error: undefined });
  }

  #update(id: number, f: (d: OpenDocument) => OpenDocument): void {
    const docs = this.#state.docs;
    if (docs.some((d) => d.id === id)) {
      this.#set({ docs: docs.map((d) => (d.id === id ? f(d) : d)) });
      return;
    }
    const background = this.#state.background;
    if (background.some((d) => d.id === id))
      this.#set({ background: background.map((d) => (d.id === id ? f(d) : d)) });
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
