// The engine session (M1-67, ARCHITECTURE.md §3): the authoritative document of one open drawing,
// as the engine worker holds it. It is built from the same `DocumentInit` as every render
// replica, applies the app's edits, and returns each edit's ChangeSet for the replicas to apply.
// The document's command engine runs here too (M2-02): the front-ends send `CommandInput`s and
// hear `CommandOutput`s, each edit a command makes among them as its ChangeSet.
import { builtinCommands } from '../commands/builtin';
import { PromptBus, modelSpaceOf, type BusEvent } from '../commands/bus';
import type { PromptAnswer } from '../commands/prompt';
import type { DimensionRegenerator } from '../edit/dimension-block';
import type { ViewReply, ViewRequest } from '../commands/view/host';
import type { Vec2 } from '../geom/types';
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import { DocumentModel, type DocumentInit } from '../model/document';
import type { Handle } from '../model/handle';
import { applyToReplica } from '../model/replica';
import type { Layout, LayoutPlot } from '../model/types';
import { xrefLoadChange, xrefLoadProblem } from '../model/xref';
import type { EntityId } from '../model/entity-ids';
import type { EntityType } from '../model/types';
import type { PropertyEdit } from '../properties/edit';
import { propertySheet, type PropertySheet } from '../properties/sheet';

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

/**
 * What a front-end (the command line, Dynamic Input, the canvas, the Ctrl+K palette) sends a
 * document's command engine: the `PromptBus` calls as plain messages, plus the space shown.
 */
export type CommandInput =
  /** Typed input ended by Enter; `cursor` is where the cursor is, for direct distance entry. */
  | { readonly kind: 'submit'; readonly text: string; readonly cursor?: Vec2 }
  | { readonly kind: 'answer'; readonly answer: PromptAnswer }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'invoke'; readonly name: string }
  /**
   * A left click on the canvas (M2-03, `PromptBus.pick`): a pick or a selection window's corner
   * at `Command:` and "Select objects", the point at a point prompt; `release` ends a drag;
   * `missed`: the prompt's object snap override found nothing there (M2-04 part 2).
   */
  | {
      readonly kind: 'pick';
      readonly point: Vec2;
      readonly shift?: boolean;
      readonly release?: boolean;
      readonly missed?: boolean;
      /** How near a grip, in drawing units, counts as on it (M2-06 grip editing). */
      readonly grip?: number;
    }
  /** Ctrl+A (M2-03, `PromptBus.selectAll`). */
  | { readonly kind: 'select-all' }
  /** A double click on the canvas: edits the object there (M2-07 part 2, `PromptBus.doubleClick`). */
  | { readonly kind: 'double-click'; readonly point: Vec2 }
  /** The space the drafter works in now: model space or a layout's paper space. */
  | { readonly kind: 'space'; readonly block: Handle }
  /** The app's reply to the view request `id` (M2-02 part 2). */
  | { readonly kind: 'view'; readonly id: number; readonly reply: ViewReply }
  /**
   * The Properties palette (M2-21) opened or closed, or narrowed to one type of the selected
   * objects (`filter`, null for all). While it is open the engine sends a `properties` sheet
   * whenever the selection or the selected objects change.
   */
  | { readonly kind: 'properties'; readonly open: boolean; readonly filter?: EntityType | null }
  /** A Properties palette edit on the selected objects of the type it shows (one undo step). */
  | { readonly kind: 'property'; readonly edit: PropertyEdit };

/**
 * What the command engine tells the front-ends: the bus's events, with every edit a command
 * makes as its ChangeSet the moment it is applied (the render replicas and the change log take
 * it), and a finished command's record as its name only (the undo stack, M2-05, stays here;
 * its state goes out as `undo`, for the undo/redo buttons).
 */
export type CommandOutput =
  | Exclude<BusEvent, { readonly type: 'commit' }>
  | { readonly type: 'commit'; readonly command: string }
  | { readonly type: 'change'; readonly change: ChangeSet }
  /**
   * A view command asks the canvas of the space shown (ZOOM, PAN, REGEN, VIEW): the app answers
   * with a `view` input carrying the same id. The command waits for it, so the app must answer
   * every request, with a refusal when it has no canvas.
   */
  | { readonly type: 'view'; readonly id: number; readonly request: ViewRequest }
  /** The Properties palette's sheet for the objects selected now (M2-21), while it is open. */
  | { readonly type: 'properties'; readonly sheet: PropertySheet };

/** What the app hands the engine from the packages above it. */
export interface EngineServices {
  readonly dimensions?: DimensionRegenerator;
}

export class EngineSession {
  readonly model: DocumentModel;
  readonly #bus: PromptBus;
  #space: Handle | undefined;
  readonly #listeners = new Set<(o: CommandOutput) => void>();
  readonly #viewReplies = new Map<number, (r: ViewReply) => void>();
  #nextView = 1;
  /** The Properties palette is open: sheets are sent (M2-21). */
  #properties = false;
  #filter: EntityType | undefined;
  /** The selection the last sheet showed, so a new selection shows all types again. */
  #sheetIds: readonly EntityId[] = [];
  #sheetQueued = false;

  /**
   * `services` are what the engine cannot be built with because they sit above it: the
   * dimension engine edited dimensions are regenerated by (M2-10 part 3, `@triya/dims`).
   * `changes`, when given, are the change sets an earlier session of the drawing applied (an
   * autosave's log, M2-14), replayed in order as a replica takes them. The undo history starts
   * empty, as in a recovered AutoCAD drawing. A log that does not fit the drawing throws.
   */
  constructor(
    init: DocumentInit,
    services: EngineServices = {},
    changes: readonly ChangeSet[] = [],
  ) {
    this.model = DocumentModel.create(init);
    for (const cs of changes) applyToReplica(this.model, cs, 'recovered drawing');
    this.#bus = new PromptBus({
      model: this.model,
      registry: builtinCommands(),
      dimensions: services.dimensions,
      apply: (change) => {
        this.model.apply(change);
        this.#emit({ type: 'change', change });
      },
      space: () => this.#space ?? modelSpaceOf(this.model),
      view: {
        request: (request) =>
          new Promise((resolve) => {
            const id = this.#nextView++;
            this.#viewReplies.set(id, resolve);
            this.#emit({ type: 'view', id, request });
          }),
      },
    });
    this.#bus.on((e) => {
      this.#emit(e.type === 'commit' ? { type: 'commit', command: e.record.command } : e);
      if (e.type === 'selection' || e.type === 'commit' || e.type === 'undo') this.#queueSheet();
    });
  }

  /**
   * Sends the Properties palette's sheet once whatever changed it has settled (a command's
   * edits and the selection it leaves come in one go).
   */
  #queueSheet(): void {
    if (!this.#properties || this.#sheetQueued) return;
    this.#sheetQueued = true;
    void Promise.resolve().then(() => {
      this.#sheetQueued = false;
      if (this.#properties) this.#sendSheet();
    });
  }

  #sendSheet(): void {
    const ids = this.#bus.selection;
    // A different selection shows every type again, as AutoCAD's palette does.
    const same =
      ids.length === this.#sheetIds.length && ids.every((id, i) => id === this.#sheetIds[i]);
    if (!same) this.#filter = undefined;
    this.#sheetIds = [...ids];
    const sheet = propertySheet(this.model, ids, this.#filter);
    this.#emit({ type: 'properties', sheet });
  }

  /** Listens to the command engine; returns the unsubscribe. */
  onCommand(listener: (o: CommandOutput) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Hands a front-end's input to the command engine; resolves once it has been handled. */
  command(input: CommandInput): Promise<void> {
    switch (input.kind) {
      case 'submit':
        if (input.cursor) this.#bus.pointer(input.cursor);
        return this.#bus.submit(input.text);
      case 'answer':
        if (input.answer.kind === 'point') this.#bus.pointer(input.answer.point);
        return this.#bus.answer(input.answer);
      case 'cancel':
        return this.#bus.cancel();
      case 'invoke':
        return this.#bus.invoke(input.name);
      case 'pick':
        return this.#bus.pick(input.point, {
          ...(input.shift && { shift: true }),
          ...(input.release && { release: true }),
          ...(input.missed && { missed: true }),
          ...(input.grip !== undefined && { grip: input.grip }),
        });
      case 'select-all':
        return this.#bus.selectAll();
      case 'double-click':
        return this.#bus.doubleClick(input.point);
      case 'space':
        if (!this.model.hasBlock(input.block) || input.block === this.#space) {
          return Promise.resolve();
        }
        this.#space = input.block;
        // Objects are selected in one space: another layout shown starts with none (M2-03).
        return this.#bus.clearSelection();
      case 'properties':
        this.#properties = input.open;
        if (input.filter !== undefined) this.#filter = input.filter ?? undefined;
        if (input.open) {
          // Narrowing keeps the selection the sheet showed; opening starts from it.
          if (input.filter === undefined) this.#sheetIds = [];
          else this.#sheetIds = [...this.#bus.selection];
          this.#sendSheet();
        }
        return Promise.resolve();
      case 'property':
        return this.#bus.setProperty(input.edit, this.#filter);
      case 'view': {
        // Not queued on the bus: the command awaiting it holds the bus's queue.
        const resolve = this.#viewReplies.get(input.id);
        this.#viewReplies.delete(input.id);
        resolve?.(input.reply);
        return Promise.resolve();
      }
    }
  }

  #emit(o: CommandOutput): void {
    for (const l of this.#listeners) l(o);
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
