// The engine session (M1-67, ARCHITECTURE.md §3): the authoritative document of one open drawing,
// as the engine worker holds it. It is built from the same `DocumentInit` as every render
// replica, applies the app's edits, and returns each edit's ChangeSet for the replicas to apply.
// M2's command engine runs here too; for now the edits are the viewer's (M1-23 layer toggles).
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import { DocumentModel, type DocumentInit } from '../model/document';
import type { Handle } from '../model/handle';

/** A layer's on, frozen and locked states (LAYER palette toggles, M1-23). */
export interface LayerStateEdit {
  readonly kind: 'layer';
  readonly layer: Handle;
  readonly on?: boolean;
  readonly frozen?: boolean;
  readonly locked?: boolean;
}

export type EngineEdit = LayerStateEdit;

export type EditResult =
  | { readonly ok: true; readonly change: ChangeSet }
  | { readonly ok: false; readonly message: string };

export class EngineSession {
  readonly model: DocumentModel;

  constructor(init: DocumentInit) {
    this.model = DocumentModel.create(init);
  }

  /** Applies an edit to the document; a refused edit changes nothing. */
  edit(e: EngineEdit): EditResult {
    const layer = this.model.tables.layers.get(e.layer);
    if (!layer) return { ok: false, message: `No layer ${e.layer}.` };
    // AutoCAD refuses to freeze the current layer ("Cannot freeze the current layer.") but
    // lets it be turned off, with a warning only.
    const current = this.model.header.get('$CLAYER');
    if (
      e.frozen === true &&
      !layer.frozen &&
      typeof current === 'string' &&
      current.toUpperCase() === layer.name.toUpperCase()
    )
      return { ok: false, message: 'Cannot freeze the current layer.' };
    const patch: { on?: boolean; frozen?: boolean; locked?: boolean } = {};
    if (e.on !== undefined && e.on !== layer.on) patch.on = e.on;
    if (e.frozen !== undefined && e.frozen !== layer.frozen) patch.frozen = e.frozen;
    if (e.locked !== undefined && e.locked !== layer.locked) patch.locked = e.locked;
    if (Object.keys(patch).length === 0) return { ok: true, change: {} };
    const b = new ChangeSetBuilder(this.model);
    b.updateTableRecord('layers', layer.handle, patch);
    const change = b.build();
    this.model.apply(change);
    return { ok: true, change };
  }
}
