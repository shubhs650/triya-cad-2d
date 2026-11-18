// What DesignCenter (M5-11) browses and how its items reach a drawing. Its sources are the
// drawings open, as their engines hold them now (`openDrawingModel`), and drawing files loaded
// into the palette this session (its Load... button, or files dropped on it), read as Open reads
// them without opening a tab. An item reaches the drawing shown as plain data, copied out of its
// source with what it names (`designCenterItem`), and the drawing's engine adds it, ignoring a
// duplicate, and inserts a block (the engine's `design-center` input, one ADCENTER undo step).
import {
  designCenterItem,
  type DesignCenterCategory,
  type DesignCenterDrop,
  type DocumentModel,
  type Vec2,
} from '@triya/engine';
import type { OpenDocument } from './documents';
import { drawingFileModel, openDrawingModel } from './dimstyle-import';
import { engines } from './engine/registry';

/** A drawing DesignCenter lists: one open, or a file loaded into the palette. */
export interface DesignCenterSource {
  readonly key: string;
  readonly name: string;
  /** The open drawing, when it is one. */
  readonly doc?: OpenDocument;
  readonly file?: File;
}

/** The drag type of DesignCenter's items, which the window's drop handler looks for. */
export const DESIGN_CENTER_DRAG = 'application/x-triya-designcenter';

/** What is being dragged out of DesignCenter, while it is. */
export interface DesignCenterDrag {
  readonly source: DesignCenterSource;
  readonly category: DesignCenterCategory;
  readonly names: readonly string[];
}

let dragging: DesignCenterDrag | undefined;

export function startDesignCenterDrag(drag: DesignCenterDrag | undefined): void {
  dragging = drag;
}

/** The item dragged, taken: a drop uses it once. */
export function takeDesignCenterDrag(): DesignCenterDrag | undefined {
  const d = dragging;
  dragging = undefined;
  return d;
}

/** The drawing files loaded into DesignCenter this session, in the order loaded. */
class LoadedFiles {
  #files: readonly File[] = [];
  readonly #listeners = new Set<() => void>();

  get = (): readonly File[] => this.#files;

  /** Drawing files (.dxf, .dwg) join the list; one of a name already listed replaces it. */
  add(files: Iterable<File>): void {
    const drawings = [...files].filter((f) => /\.(dxf|dwg)$/i.test(f.name));
    if (drawings.length === 0) return;
    const names = new Set(drawings.map((f) => f.name.toUpperCase()));
    this.#files = [...this.#files.filter((f) => !names.has(f.name.toUpperCase())), ...drawings];
    for (const l of this.#listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const designCenterFiles = new LoadedFiles();

/** The sources DesignCenter lists: the open drawings, then the files loaded. */
export function designCenterSources(
  docs: readonly OpenDocument[],
  files: readonly File[],
): DesignCenterSource[] {
  return [
    ...docs.map((doc) => ({ key: `doc:${doc.id}`, name: doc.name, doc })),
    ...files.map((file) => ({ key: `file:${file.name.toUpperCase()}`, name: file.name, file })),
  ];
}

/**
 * The source's drawing: an open one as its engine holds it at its revision now, a file as read
 * once. Kept, so that browsing it again does not read it again.
 */
const models = new Map<string, Promise<DocumentModel>>();

export function sourceModel(source: DesignCenterSource): Promise<DocumentModel> {
  const doc = source.doc;
  const key = doc ? `${source.key}@${doc.revision}` : source.key;
  let model = models.get(key);
  if (!model) {
    // Older revisions of the drawing are not looked at again.
    for (const k of models.keys()) if (k.startsWith(`${source.key}@`)) models.delete(k);
    model = doc
      ? Promise.resolve().then(() => openDrawingModel(doc, engines.changesOf(doc.id)))
      : drawingFileModel(source.file!);
    models.set(key, model);
    model.catch(() => models.delete(key));
  }
  return model;
}

/**
 * The items `names` of `category` brought into drawing `target`; a block inserted at `at` (world)
 * when given, else by the Insert dialog, with `insert`. A block of the drawing shown itself is
 * inserted as it is, nothing copied.
 */
export async function designCenterDrop(
  target: number,
  source: DesignCenterSource,
  category: DesignCenterCategory,
  names: readonly string[],
  insert?: { readonly at?: Vec2 },
): Promise<void> {
  const block = category === 'blocks' ? names[0] : undefined;
  const own = source.doc?.id === target;
  const model = own && block !== undefined ? undefined : await sourceModel(source);
  const items = model
    ? (block !== undefined ? [block] : names)
        .map((name) => designCenterItem(model, category, name))
        .filter((i) => i !== undefined)
    : [];
  const drop: DesignCenterDrop = {
    items,
    ...(block !== undefined &&
      insert && { insert: { block, ...(insert.at && { at: insert.at }) } }),
  };
  engines.command(target, { kind: 'design-center', drop });
}
