// The engine session (M1-67, ARCHITECTURE.md §3): the authoritative document of one open drawing,
// as the engine worker holds it. It is built from the same `DocumentInit` as every render
// replica, applies the app's edits, and returns each edit's ChangeSet for the replicas to apply.
// M2's command engine runs here too; for now the edits are the viewer's (M1-23 layer toggles).
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import { DocumentModel, type DocumentInit } from '../model/document';
import type { Handle } from '../model/handle';
import type { Layout, LayoutPlot } from '../model/types';
import { xrefLoadChange, xrefLoadProblem } from '../model/xref';

/** A layer's on, frozen and locked states (LAYER palette toggles, M1-23). */
export interface LayerStateEdit {
  readonly kind: 'layer';
  readonly layer: Handle;
  readonly on?: boolean;
  readonly frozen?: boolean;
  readonly locked?: boolean;
}

/**
 * A layout renamed, moved among the layout tabs or given a new page setup (M1-97): what LAYOUT
 * Rename, dragging a layout tab and PAGESETUP will send (M6). Model stays the first tab.
 */
export interface LayoutEdit {
  readonly kind: 'layout';
  readonly layout: Handle;
  readonly name?: string;
  /** The tab's place among the layouts, 1 first; past the last puts it last. */
  readonly tabOrder?: number;
  readonly plot?: LayoutPlot;
}

/**
 * An xref's drawing found (M1-21): its file as the importer maps it, loaded as the content of
 * the host's xref block (`xrefLoadChange`). Not an undoable edit in AutoCAD either: loading
 * changes what the drawing shows, not the drawing.
 */
export interface XrefLoadEdit {
  readonly kind: 'xref-load';
  readonly block: Handle;
  readonly drawing: DocumentInit;
}

export type EngineEdit = LayerStateEdit | LayoutEdit | XrefLoadEdit;

/**
 * Characters AutoCAD refuses in a layout name (LAYOUT Rename: "Invalid layout name"), and its
 * 255-character limit; the save checks the same (M1-75 part 20).
 */
const LAYOUT_NAME_INVALID = /[<>/\\":;?*|,=`]/;
const LAYOUT_NAME_MAX = 255;

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
    if (e.kind === 'xref-load') return this.#xrefLoad(e);
    return e.kind === 'layout' ? this.#layoutEdit(e) : this.#layerEdit(e);
  }

  #xrefLoad(e: XrefLoadEdit): EditResult {
    const problem = xrefLoadProblem(this.model, e.block);
    if (problem) return { ok: false, message: problem };
    let change: ChangeSet;
    try {
      change = xrefLoadChange(this.model, e.block, e.drawing);
      this.model.apply(change);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true, change };
  }

  #layerEdit(e: LayerStateEdit): EditResult {
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
  #layoutEdit(e: LayoutEdit): EditResult {
    const layouts = this.model.layouts;
    const layout = layouts.find((l) => l.handle === e.layout);
    if (!layout) return { ok: false, message: `No layout ${e.layout}.` };
    const model = this.#isModel(layout);
    if (model && ((e.name !== undefined && e.name !== layout.name) || e.tabOrder !== undefined))
      return { ok: false, message: 'The Model tab cannot be renamed or moved.' };
    if (e.name !== undefined && e.name !== layout.name) {
      if (
        e.name.trim() === '' ||
        e.name.length > LAYOUT_NAME_MAX ||
        LAYOUT_NAME_INVALID.test(e.name)
      )
        return { ok: false, message: 'Invalid layout name.' };
      // Names are case-insensitive (Layout1 and LAYOUT1 are one layout).
      const taken = layouts.some(
        (l) => l !== layout && l.name.toUpperCase() === e.name!.toUpperCase(),
      );
      if (taken) return { ok: false, message: `A layout named "${e.name}" already exists.` };
    }
    if (e.tabOrder !== undefined && !Number.isInteger(e.tabOrder))
      return { ok: false, message: `Invalid tab position ${e.tabOrder}.` };
    const plotProblem = e.plot && plotProblemOf(e.plot);
    if (plotProblem) return { ok: false, message: `Invalid page setup: ${plotProblem}.` };

    const b = new ChangeSetBuilder(this.model);
    const patch: { -readonly [K in 'name' | 'plot']?: Layout[K] } = {};
    if (e.name !== undefined && e.name !== layout.name) patch.name = e.name;
    if (e.plot !== undefined && !samePlot(e.plot, layout.plot)) patch.plot = e.plot;
    if (Object.keys(patch).length > 0) b.updateLayout(layout.handle, patch);
    if (e.tabOrder !== undefined) {
      // The layouts in tab order with this one moved; then numbered 1 to N, as AutoCAD keeps
      // them (and the save requires, M1-75 part 20).
      const sheets = layouts.filter((l) => l !== layout && !this.#isModel(l));
      const at = Math.max(0, Math.min(sheets.length, e.tabOrder - 1));
      sheets.splice(at, 0, layout);
      sheets.forEach((l, i) => {
        if (l.tabOrder !== i + 1) b.updateLayout(l.handle, { tabOrder: i + 1 });
      });
    }
    const change = b.build();
    if (Object.keys(change).length > 0) this.model.apply(change);
    return { ok: true, change };
  }

  #isModel(layout: Layout): boolean {
    const record = this.model.tables.blockRecords.get(layout.blockRecord);
    return record?.name.toUpperCase() === '*MODEL_SPACE';
  }
}

/** Why a page setup cannot be a layout's, or undefined (PAGESETUP takes no such values). */
function plotProblemOf(p: LayoutPlot): string | undefined {
  if (!(p.paperWidth > 0 && p.paperHeight > 0)) return 'the paper size must be greater than 0';
  const m = p.margins;
  if ([m.left, m.bottom, m.right, m.top].some((v) => !(v >= 0)))
    return 'margins cannot be negative';
  if (m.left + m.right >= p.paperWidth || m.bottom + m.top >= p.paperHeight)
    return 'the margins leave no printable area';
  if (!(p.scale.numerator > 0 && p.scale.denominator > 0))
    return 'the plot scale must be greater than 0';
  return undefined;
}

function samePlot(a: LayoutPlot, b: LayoutPlot | undefined): boolean {
  return b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}
