// The engine session (M1-67, ARCHITECTURE.md §3): the authoritative document of one open drawing,
// as the engine worker holds it. It is built from the same `DocumentInit` as every render
// replica, applies the app's edits, and returns each edit's ChangeSet for the replicas to apply.
// The document's command engine runs here too (M2-02): the front-ends send `CommandInput`s and
// hear `CommandOutput`s, each edit a command makes among them as its ChangeSet.
import { builtinCommands } from '../commands/builtin';
import { PromptBus, modelSpaceOf, type BusEvent } from '../commands/bus';
import type { PromptAnswer } from '../commands/prompt';
import type { DesignCenterDrop } from '../commands/design-center';
import type { ReferencePathEdit } from '../commands/reference-path';
import { isDesignCenterItem } from '../edit/design-center';
import type { CommandPreview } from '../commands/command-preview';
import { PICKFIRST } from '../commands/sysvars';
import { GROUPDISPLAYMODE, PICKADD, PICKAUTO, PICKSTYLE } from '../selection/loop';
import type { UndoState, ViewStep } from '../commands/undo';
import type { DimensionRegenerator } from '../edit/dimension-block';
import type { HatchLinesOf } from '../edit/explode';
import type { SpellService } from '../edit/spelling';
import type { ViewReply, ViewRequest, ViewState } from '../commands/view/host';
import {
  paperViewsChange,
  saveNamedView,
  validViewName,
  viewCategory,
  viewCategoryProblem,
  type PaperView,
} from '../edit/named-view';
import {
  dropViewLayers,
  renameViewLayers,
  restoreViewLayers,
  saveViewLayers,
} from '../edit/view-layers';
import type { DeferredPick } from '../geom/deferred';
import type { Vec2 } from '../geom/types';
import type { Lasso } from '../selection/loop';
import { ChangeSetBuilder } from '../model/builder';
import { isEmptyChangeSet, type ChangeSet } from '../model/changeset';
import { DocumentModel, type DocumentInit } from '../model/document';
import type { Handle } from '../model/handle';
import { applyToReplica } from '../model/replica';
import type { LayerStateLayer, Layout, LayoutPlot } from '../model/types';
import {
  xrefLoadChange,
  xrefLoadProblem,
  xrefUnloadChange,
  xrefUnloadProblem,
} from '../model/xref';
import { xrefDetachChange, xrefDetachProblem } from '../edit/xrefs';
import { xrefBindChange, xrefBindProblem } from '../edit/xref-bind';
import type { EntityId } from '../model/entity-ids';
import type { EntityType, TableCellLock } from '../model/types';
import type { PropertyEdit } from '../properties/edit';
import { propertySheet, type DimensionMeasure, type PropertySheet } from '../properties/sheet';
import { quickPropertySheet, rolloverSheet } from '../properties/quick';
import { REVCLOUDGRIPS } from '../edit/revcloud';
import { fieldEventChange, type FieldEvent } from '../edit/field-eval';
import {
  currentLayerChange,
  deleteLayersChange,
  mergeLayersChange,
  layerPropsChange,
  layersInUse,
  newLayerChange,
  type LayerProps,
} from '../edit/layer-manager';
import {
  convertLayerFilterChange,
  filterLayersChange,
  isolateFilterChange,
  type FilterLayerSetting,
  type LayerFilterNode,
} from '../edit/layer-filter-menu';
import {
  deleteLayerFilterChange,
  editLayerFilterChange,
  newLayerFilterChange,
} from '../edit/layer-filters';
import {
  deleteLayerStateChange,
  editLayerStateChange,
  importLayerStateChange,
  restoreLayerStateChange,
  saveLayerStateChange,
  type LayerStateInit,
} from '../edit/layer-states';
import { layerPreviousOf } from '../commands/layer-previous';
import { loadLinetypes, type LinetypeDefinition } from '../edit/linetypes';
import {
  emptyTextObjects,
  orphanedData,
  purgeClosure,
  purgeHealth,
  purgeInto,
  purgeOrphanedInto,
  unusedItems,
  zeroLengthObjects,
  type PurgeHealth,
} from '../edit/purge';
import { eraseObjects } from '../edit/edit';
import { layerFilterSelectCommand } from '../commands/layer-filter-select';

/**
 * A layer's on, frozen and locked states (LAYER palette toggles, M1-23) and, from the Layer
 * Properties Manager (M5-05), every property a row edits, on one layer or on all the layers
 * selected (a rename takes one).
 */
export interface LayerStateEdit extends LayerProps {
  readonly kind: 'layer';
  readonly layer: Handle | readonly Handle[];
}

/**
 * The Layer Properties Manager's New Layer (named LayerN unless `name` is given, with `like`'s
 * properties, layer 0's without), Delete Layer and Set Current (M5-05): one LAYER step each.
 */
export type LayerTableEdit =
  | { readonly kind: 'layer-new'; readonly like?: Handle; readonly name?: string }
  | { readonly kind: 'layer-delete'; readonly layers: readonly Handle[] }
  /** Merge Selected Layer(s) to (M5-05 part 4): their objects move to `target`, they go. */
  | { readonly kind: 'layer-merge'; readonly layers: readonly Handle[]; readonly target: Handle }
  | { readonly kind: 'layer-current'; readonly layer: Handle };

/**
 * The Layer States Manager's New (or an overwrite of the state so named), Restore, Delete, Edit
 * and Rename, and Import of a `.las` file's state (M5-07): one LAYERSTATE undo step each.
 */
export type NamedLayerStateEdit =
  | {
      readonly kind: 'layer-state-save';
      readonly name: string;
      readonly description?: string;
      readonly mask?: number;
    }
  | {
      readonly kind: 'layer-state-restore';
      readonly state: Handle;
      /** "Turn off layers not found in layer state". */
      readonly turnOffMissing?: boolean;
    }
  | { readonly kind: 'layer-state-delete'; readonly state: Handle }
  | {
      readonly kind: 'layer-state-edit';
      readonly state: Handle;
      readonly name?: string;
      readonly description?: string;
      readonly mask?: number;
      /** Edit Layer State (M5-07 part 3): the layers the state names, with their settings. */
      readonly layers?: readonly LayerStateLayer[];
    }
  | {
      readonly kind: 'layer-state-import';
      readonly state: LayerStateInit;
      /** Overwrite a state of the same name (M5-07 part 2). */
      readonly replace?: boolean;
    };

/**
 * The Layer Properties Manager's filters (M5-07 part 4): New Properties Filter and New Group
 * Filter (at the top or nested in `parent`), Rename, a new definition or group layers, Delete
 * (with the filters nested in it); the filter menu's Visibility, Lock, Isolate Group and Convert
 * to Group Filter (part 6). One LAYER undo step each.
 */
export type LayerFilterEdit =
  | {
      readonly kind: 'layer-filter-new';
      readonly name: string;
      /** Property unless said. */
      readonly filterType?: 'property' | 'group';
      /** A property filter's definition, `parseLayerFilterExpression`'s form. */
      readonly expression?: string;
      /** A group filter's layers. */
      readonly layers?: readonly Handle[];
      readonly parent?: Handle;
    }
  | {
      readonly kind: 'layer-filter-edit';
      readonly filter: Handle;
      readonly name?: string;
      readonly expression?: string;
      readonly layers?: readonly Handle[];
    }
  | { readonly kind: 'layer-filter-delete'; readonly filter: Handle }
  /** The filter menu's Visibility and Lock on every layer `node` lists (M5-07 part 6). */
  | {
      readonly kind: 'layer-filter-set';
      readonly node: LayerFilterNode;
      readonly set: FilterLayerSetting;
    }
  /** Isolate Group: in model space, or the layout whose block is `space` (its viewports). */
  | {
      readonly kind: 'layer-filter-isolate';
      readonly node: LayerFilterNode;
      readonly space?: Handle;
    }
  /** Convert to Group Filter. */
  | { readonly kind: 'layer-filter-convert'; readonly filter: Handle };

/**
 * Linetypes loaded from a .lin file outside the Linetype Manager (M5-08: the Layer Properties
 * Manager's Select Linetype Load...): new names added, names the drawing has reloaded when
 * `reload` says so; one LINETYPE undo step, refused when nothing loads.
 */
export interface LinetypeLoadEdit {
  readonly kind: 'linetype-load';
  readonly linetypes: readonly LinetypeDefinition[];
  readonly reload?: boolean;
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
 * changes what the drawing shows, not the drawing. The load XATTACH asks for while it runs is
 * part of its undo step (M5-04 part 6, `PromptBus.joinLoad`).
 */
export interface XrefLoadEdit {
  readonly kind: 'xref-load';
  readonly block: Handle;
  readonly drawing: DocumentInit;
}

/**
 * The References palette's Unload and Reload (M5-04, `xrefUnloadChange`): the xref's loaded
 * content taken out, the xref left Unloaded, or with `reload` waiting for its file again (the
 * app then loads the file it finds). Like a load, not an undo step: it changes what the drawing
 * shows, not the drawing.
 */
export interface XrefUnloadEdit {
  readonly kind: 'xref-unload';
  readonly block: Handle;
  readonly reload?: boolean;
}

/** The References palette's Detach (M5-04, `xrefDetachChange`): one XREF undo step. */
export interface XrefDetachEdit {
  readonly kind: 'xref-detach';
  readonly blocks: readonly Handle[];
}

/**
 * The References palette's Bind (M5-04 part 2, `xrefBindChange`): the xrefs made blocks of the
 * drawing, as the Bind Xrefs dialog's Insert says when `insert`. One XREF undo step.
 */
export interface XrefBindEdit {
  readonly kind: 'xref-bind';
  readonly blocks: readonly Handle[];
  readonly insert?: boolean;
}

/**
 * The navigation bar's Save view (M2-29): the view shown kept in the drawing as `name`, as VIEW
 * Save keeps it (`saveNamedView`), one VIEW undo step.
 */
export interface NamedViewEdit {
  readonly kind: 'view';
  readonly name: string;
  readonly view: ViewState;
  /** New View's View category (M2-70); '' or `<None>` for none, kept as it was when absent. */
  readonly category?: string;
  /**
   * New View's "Save layer snapshot with view" (M5-07 part 7): true saves the layers' settings
   * now as the view's snapshot, false saves it without one; absent keeps what the view had.
   */
  readonly layers?: boolean;
}

/**
 * The View Manager's Delete and its Name row (M2-47 part 2): the named view `name` (case ignored,
 * as AutoCAD compares table names) removed, or renamed `newName`, one VIEW undo step each.
 */
export type ViewTableEdit =
  | { readonly kind: 'view-delete'; readonly name: string }
  | { readonly kind: 'view-rename'; readonly name: string; readonly newName: string }
  /** The Category row (M2-70): '' or `<None>` takes the category off. */
  | { readonly kind: 'view-category'; readonly name: string; readonly category: string }
  /**
   * Update Layers and the Layer snapshot row (M5-07 part 7): `save` saves the layers' settings
   * now as the view's snapshot, otherwise the view's snapshot goes.
   */
  | { readonly kind: 'view-layers'; readonly name: string; readonly save: boolean }
  /**
   * The View Manager's OK and Apply with a view set current (M5-07 part 7): the layers as the
   * view's snapshot has them, once the app shows the view; nothing when it has none.
   */
  | { readonly kind: 'view-restore'; readonly name: string };

/**
 * A per-user system variable the app keeps that the drawing's engine follows: REVCLOUDGRIPS
 * (M2-42), which its grips follow, and PICKFIRST (M2-59), which its command line follows. The app
 * sets them on every drawing it opens and whenever SETVAR changes them. Not undoable edits, and
 * never saved: AutoCAD keeps them in the registry, not in the drawing.
 */
export type SessionVariableEdit =
  | {
      readonly kind: 'sysvar';
      readonly name: typeof REVCLOUDGRIPS | typeof PICKFIRST;
      readonly value: 0 | 1;
    }
  /**
   * PICKADD (0 to 3) and PICKAUTO (0 to 7), which its "Select objects" follows (M3-04 part 4);
   * PICKSTYLE (0 to 3) and GROUPDISPLAYMODE (0 to 2), which its grips on groups follow (M3-13).
   */
  | {
      readonly kind: 'sysvar';
      readonly name: typeof PICKADD | typeof PICKAUTO | typeof PICKSTYLE | typeof GROUPDISPLAYMODE;
      readonly value: number;
    };

/**
 * The user alias file's aliases (M3-10, `parseAliasFile`), which the command line follows over
 * the default acad.pgp ones. Per user, like the session variables: never saved in the drawing.
 */
export interface AliasEdit {
  readonly kind: 'aliases';
  readonly aliases: Readonly<Record<string, string>>;
}

/**
 * The drawing opened, saved or plotted (M4-10 part 3): its fields evaluated as FIELDEVAL and each
 * field's options allow (`fieldEventChange`), against the app's clock and the drawing's file name.
 * Not an undo step: AutoCAD's own evaluation is none.
 */
export interface FieldEventEdit {
  readonly kind: 'fields';
  readonly event: FieldEvent;
  /** The event's time, ms since the epoch: Date fields, and SaveDate or PlotDate. */
  readonly now: number;
  /** DWGNAME: the file opened, or the one the save writes. */
  readonly fileName?: string;
}

/**
 * The Health palette's purge fixes (M5-09 part 3): every unused named item purged with what only
 * they use (the Purge dialog's Purge All with Purge nested items; registered applications left to
 * -PURGE), or the zero-length geometry, empty text or orphaned data (M5-09 part 5) PURGE deletes.
 * One PURGE undo step each, refused when there is nothing to purge.
 */
export interface PurgeEdit {
  readonly kind: 'purge';
  readonly what: 'unused' | 'zero-length' | 'empty-text' | 'orphaned';
}

export type EngineEdit =
  | FieldEventEdit
  | PurgeEdit
  | LayerStateEdit
  | LayerTableEdit
  | NamedLayerStateEdit
  | LayerFilterEdit
  | LinetypeLoadEdit
  | LayoutEdit
  | XrefLoadEdit
  | XrefUnloadEdit
  | XrefDetachEdit
  | XrefBindEdit
  | NamedViewEdit
  | ViewTableEdit
  | SessionVariableEdit
  | AliasEdit;

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
  /**
   * Typed input ended by Enter; `cursor` is where the cursor is, for direct distance entry. A
   * `seq` asks for a `read` output with it once the input has been handled (M2-47 part 3).
   */
  | {
      readonly kind: 'submit';
      readonly text: string;
      readonly cursor?: Vec2;
      readonly seq?: number;
      /** What a relative point (`@`) in it counts from, where not the last point (M2-71). */
      readonly relativeTo?: Vec2;
    }
  /**
   * A prompt's answer; a `seq` asks for a `read` output once it has been handled, as for `submit`:
   * the in-place text editors number theirs (M4-31), so keys typed after them wait.
   */
  | { readonly kind: 'answer'; readonly answer: PromptAnswer; readonly seq?: number }
  /** Esc; a `seq` asks for a `read` output once it has been handled, as for `submit` (M2-71). */
  | { readonly kind: 'cancel'; readonly seq?: number }
  | { readonly kind: 'invoke'; readonly name: string }
  /**
   * The Layer Properties Manager's Select Layers on the group filter `filter` (M5-07 part 9):
   * objects selected in the drawing add their layers to it, or with `replace` become its layers.
   */
  | { readonly kind: 'layer-filter-select'; readonly filter: Handle; readonly replace: boolean }
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
      /** The lasso dragged from the window's first corner, with `release` (M3-04 part 2). */
      readonly lasso?: Lasso;
      readonly missed?: boolean;
      /** How near a grip, in drawing units, counts as on it (M2-06 grip editing). */
      readonly grip?: number;
      /** The Deferred Tangent or Perpendicular the point was snapped with (M3-01 part 2). */
      readonly deferred?: DeferredPick;
      /** Ctrl was held: an arc's direction switched (M3-01 part 6), or a grip copy (M3-05). */
      readonly ctrl?: boolean;
      /** The function picked from a grip's hover menu, with `grip` (M3-05 part 2). */
      readonly gripFunction?: string;
      /** The press made at `point` has been dragged (PICKAUTO 2, M3-04 part 6). */
      readonly dragged?: boolean;
      /** With `release`: the path the press was dragged along (M3-12 part 6, `freehand`). */
      readonly freehand?: readonly Vec2[];
    }
  /**
   * COMMANDPREVIEW (M3-12 part 6, `PromptBus.commandPreview`): what a pick (point) at `cursor`
   * would do at the prompt the command waits at; answered with `command-preview` and `seq`.
   */
  | {
      readonly kind: 'command-preview';
      readonly seq: number;
      readonly cursor: Vec2;
      readonly hits: readonly EntityId[];
      readonly shift?: boolean;
    }
  /** Ctrl+A (M2-03, `PromptBus.selectAll`). */
  | { readonly kind: 'select-all' }
  /** A double click on the canvas: edits the object there (M2-07 part 2, `PromptBus.doubleClick`). */
  | { readonly kind: 'double-click'; readonly point: Vec2 }
  /** The space the drafter works in now: model space or a layout's paper space. */
  | { readonly kind: 'space'; readonly block: Handle }
  /**
   * The drafter changed a canvas's view (M2-47 part 4): a ZOOM or PAN (the command's, the
   * navigation bar's, the wheel's, a real-time drag's) or a named view restored. `view` is the
   * view `viewport` showed before; the step is the undo history's (`UndoStack.pushView`).
   */
  | ({ readonly kind: 'view-step' } & ViewStep)
  /** The app's reply to the view request `id` (M2-02 part 2). */
  | { readonly kind: 'view'; readonly id: number; readonly reply: ViewReply }
  /**
   * The Properties palette (M2-21) opened or closed, or narrowed to one type of the selected
   * objects (`filter`, null for all). While it is open the engine sends a `properties` sheet
   * whenever the selection or the selected objects change. `quick` asks for Quick Properties'
   * sheets instead (M2-35 part 16, `quickPropertySheet`): the app shows one or the other.
   */
  | {
      readonly kind: 'properties';
      readonly open: boolean;
      readonly filter?: EntityType | null;
      readonly quick?: boolean;
    }
  /** A Properties palette edit on the selected objects of the type it shows (one undo step). */
  | { readonly kind: 'property'; readonly edit: PropertyEdit }
  /**
   * The Properties palette's Vertex spinner (M2-35 part 8): the polyline vertex its sheet shows,
   * from 0, until the selection changes (another selection starts at the first vertex).
   */
  | { readonly kind: 'property-vertex'; readonly vertex: number }
  /**
   * A row's `...` button (`PropertyRow.editor`, M2-35 part 9): an MTEXT's Contents opens the
   * In-Place Text Editor on the one MTEXT the palette shows. `linetype` is the Linetype list's
   * Other... (M5-08 part 2): the Linetype Manager, applying its linetype to what the palette shows.
   */
  | { readonly kind: 'property-editor'; readonly key: 'contents' | 'linetype' }
  /**
   * DesignCenter (M5-11): items another drawing offers added to this one, and a block inserted,
   * at a point (dragged onto the canvas) or by the Insert dialog (`PromptBus.designCenter`).
   */
  | { readonly kind: 'design-center'; readonly drop: DesignCenterDrop }
  /**
   * The References palette's Saved Path, Browse... and Remove Path (M5-04 part 15): the references
   * given these saved paths, one XREF undo step with the loads it brings
   * (`PromptBus.referencePath`).
   */
  | { readonly kind: 'reference-path'; readonly edits: readonly ReferencePathEdit[] }
  /**
   * The cursor rests on object `id` (M2-35 part 21, ROLLOVERTIPS): the engine answers with its
   * rollover tooltip (`rolloverSheet`), whether or not it is selected; the selection stays.
   */
  | { readonly kind: 'rollover'; readonly id: EntityId }
  /**
   * The cursor rests at `point` (M3-05 part 2): the engine answers with the grip of the selection
   * at `Command:` within `within` drawing units and its hover menu (`PromptBus.gripMenu`).
   */
  | { readonly kind: 'grip-menu'; readonly point: Vec2; readonly within: number }
  /**
   * The cursor moved to `point` (M4-16 part 11): the engine answers with the lock of the table
   * cell under it, which the canvas shows by the cursor (`PromptBus.cellLock`); `seq` numbers
   * the question so a late answer is known.
   */
  | { readonly kind: 'cell-lock'; readonly seq: number; readonly point: Vec2 };

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
   * The submit, Esc or answer numbered `seq` has been handled: the prompt it led to, `Command:`
   * or a dialog's wait has been said already (M2-47 part 3). Until then the command line cannot tell
   * whether a space typed is text or Enter, so it holds the keys typed ahead for that prompt.
   */
  | { readonly type: 'read'; readonly seq: number }
  /**
   * A view command asks the canvas of the space shown (ZOOM, PAN, REGEN, VIEW): the app answers
   * with a `view` input carrying the same id. The command waits for it, so the app must answer
   * every request, with a refusal when it has no canvas.
   */
  | { readonly type: 'view'; readonly id: number; readonly request: ViewRequest }
  /** The Properties palette's sheet for the objects selected now (M2-21), while it is open. */
  | { readonly type: 'properties'; readonly sheet: PropertySheet }
  /** A command preview asked for with `seq` (M3-12 part 6); none where the prompt shows none. */
  | { readonly type: 'command-preview'; readonly seq: number; readonly preview?: CommandPreview }
  /** The rollover tooltip of object `id` (M2-35 part 21); no sheet when the object is gone. */
  | { readonly type: 'rollover'; readonly id: EntityId; readonly sheet?: PropertySheet }
  /** The lock of the table cell under the cursor asked with `seq` (M4-16 part 11); none if unlocked. */
  | { readonly type: 'cell-lock'; readonly seq: number; readonly lock?: TableCellLock }
  /**
   * The grip under a resting cursor at `point` and its hover menu's functions (M3-05 part 2):
   * no grip when there is none there, no items when it has one function.
   */
  | {
      readonly type: 'grip-menu';
      readonly point: Vec2;
      readonly grip?: Vec2;
      readonly items: readonly string[];
    };

/** What the app hands the engine from the packages above it. */
export interface EngineServices {
  readonly dimensions?: DimensionRegenerator;
  /** What a dimension measures, for the Properties palette's Measurement row (M2-35 part 10). */
  readonly measureDimension?: DimensionMeasure;
  /** A pattern hatch's lines, which EXPLODE turns into lines (M3-12 part 3, `@triya/hatch`). */
  readonly hatchLines?: HatchLinesOf;
  /** The spelling dictionary SPELL checks with (M4-09 part 4, `@triya/text`'s). */
  readonly spelling?: SpellService;
}

export class EngineSession {
  readonly model: DocumentModel;
  readonly #bus: PromptBus;
  /** Its commands, with the user's aliases (M3-10). */
  readonly #registry = builtinCommands();
  #space: Handle | undefined;
  readonly #listeners = new Set<(o: CommandOutput) => void>();
  readonly #viewReplies = new Map<number, (r: ViewReply) => void>();
  #nextView = 1;
  /** The Properties palette is open: sheets are sent (M2-21). */
  #properties = false;
  /** Quick Properties asked for the sheets: they are cut to its rows (M2-35 part 16). */
  #quick = false;
  #filter: EntityType | undefined;
  /** The polyline vertex the Properties sheet shows (M2-35 part 8). */
  #vertex = 0;
  /** The selection the last sheet showed, so a new selection shows all types again. */
  #sheetIds: readonly EntityId[] = [];
  #sheetQueued = false;
  readonly #services: EngineServices;

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
    this.#services = services;
    this.model = DocumentModel.create(init);
    for (const cs of changes) applyToReplica(this.model, cs, 'recovered drawing');
    this.#bus = new PromptBus({
      model: this.model,
      registry: this.#registry,
      dimensions: services.dimensions,
      hatchLines: services.hatchLines,
      spelling: services.spelling,
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
      // A prompt's preview source stays here: the app asks for its previews (M3-12 part 6), and
      // a function cannot go to the app's thread.
      const cp = e.type === 'prompt' ? e.prompt.commandPreview : undefined;
      if (e.type === 'prompt' && cp) {
        const commandPreview = cp.hover ? { hover: cp.hover } : {};
        this.#emit({ ...e, prompt: { ...e.prompt, commandPreview } });
      } else this.#emit(e.type === 'commit' ? { type: 'commit', command: e.record.command } : e);
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
    if (!same) {
      this.#filter = undefined;
      this.#vertex = 0;
    }
    this.#sheetIds = [...ids];
    const sheet = propertySheet(
      this.model,
      ids,
      this.#filter,
      this.#vertex,
      this.#services.measureDimension,
    );
    if (!this.#quick) return this.#emit({ type: 'properties', sheet });
    // Nothing selected shows no Quick Properties: an empty sheet says so.
    const quick = quickPropertySheet(sheet) ?? {
      count: 0,
      types: [],
      sections: [],
      units: sheet.units,
    };
    this.#emit({ type: 'properties', sheet: quick });
  }

  /** Listens to the command engine; returns the unsubscribe. */
  onCommand(listener: (o: CommandOutput) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Hands a front-end's input to the command engine; resolves once it has been handled. */
  command(input: CommandInput): Promise<void> {
    switch (input.kind) {
      case 'submit': {
        if (input.cursor) this.#bus.pointer(input.cursor);
        const done = this.#bus.submit(input.text, { relativeTo: input.relativeTo });
        const seq = input.seq;
        if (seq === undefined) return done;
        return done.finally(() => this.#emit({ type: 'read', seq }));
      }
      case 'answer': {
        if (input.answer.kind === 'point') this.#bus.pointer(input.answer.point);
        const done = this.#bus.answer(input.answer);
        const seq = input.seq;
        if (seq === undefined) return done;
        return done.finally(() => this.#emit({ type: 'read', seq }));
      }
      case 'cancel': {
        const done = this.#bus.cancel();
        const seq = input.seq;
        if (seq === undefined) return done;
        return done.finally(() => this.#emit({ type: 'read', seq }));
      }
      case 'invoke':
        return this.#bus.invoke(input.name);
      case 'layer-filter-select':
        return this.#bus.run(layerFilterSelectCommand(input.filter, input.replace));
      case 'pick':
        return this.#bus.pick(input.point, {
          ...(input.shift && { shift: true }),
          ...(input.release && { release: true }),
          ...(input.lasso && { lasso: input.lasso }),
          ...(input.missed && { missed: true }),
          ...(input.grip !== undefined && { grip: input.grip }),
          ...(input.deferred && { deferred: input.deferred }),
          ...(input.ctrl && { ctrl: true }),
          ...(input.gripFunction && { gripFunction: input.gripFunction }),
          ...(input.dragged && { dragged: true }),
          ...(input.freehand && { freehand: input.freehand }),
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
        this.#quick = input.quick === true;
        if (input.filter !== undefined) this.#filter = input.filter ?? undefined;
        if (input.open) {
          // Narrowing keeps the selection the sheet showed; opening starts from it.
          if (input.filter === undefined) this.#sheetIds = [];
          else this.#sheetIds = [...this.#bus.selection];
          this.#sendSheet();
        }
        return Promise.resolve();
      case 'property':
        // The palette shows what the edit made, a running command's selection's too (M2-35
        // part 30), which no commit announces.
        return this.#bus.setProperty(input.edit, this.#filter).then(() => this.#queueSheet());
      case 'property-editor':
        // The Linetype list's Other... (M5-08 part 2), or an MTEXT's Contents `...`.
        return input.key === 'linetype'
          ? this.#bus.otherLinetype(this.#filter)
          : this.#bus.editContents(this.#filter);
      case 'design-center': {
        // Plain data from the app: what is not an item is left out.
        const { items, insert } = input.drop;
        const at = insert?.at;
        const point = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : undefined;
        return this.#bus.designCenter({
          items: (Array.isArray(items) ? items : []).filter(isDesignCenterItem),
          ...(typeof insert?.block === 'string' && {
            insert: { block: insert.block, ...(point && { at: { x: point.x, y: point.y } }) },
          }),
        });
      }
      case 'reference-path':
        // Plain data from the app: what is not a handle and a path is left out.
        return this.#bus.referencePath(
          (Array.isArray(input.edits) ? input.edits : [])
            .filter((e) => typeof e?.handle === 'string' && typeof e.path === 'string')
            .map((e) => ({ handle: e.handle, path: e.path })),
        );
      case 'property-vertex':
        this.#vertex = Math.max(0, Math.trunc(input.vertex));
        if (this.#properties) this.#sendSheet();
        return Promise.resolve();
      case 'command-preview': {
        const { seq } = input;
        return this.#bus
          .commandPreview({
            cursor: input.cursor,
            hits: input.hits,
            ...(input.shift && { shift: true }),
          })
          .then((preview) =>
            this.#emit({ type: 'command-preview', seq, ...(preview && { preview }) }),
          );
      }
      case 'rollover': {
        const sheet = rolloverSheet(this.model, input.id);
        this.#emit({ type: 'rollover', id: input.id, ...(sheet && { sheet }) });
        return Promise.resolve();
      }
      case 'cell-lock': {
        const lock = this.#bus.cellLock(input.point);
        this.#emit({ type: 'cell-lock', seq: input.seq, ...(lock && { lock }) });
        return Promise.resolve();
      }
      case 'grip-menu': {
        const menu = this.#bus.gripMenu(input.point, input.within);
        this.#emit({
          type: 'grip-menu',
          point: input.point,
          ...(menu && { grip: menu.grip }),
          items: menu?.items ?? [],
        });
        return Promise.resolve();
      }
      case 'view-step':
        this.#bus.undo.pushView({ label: input.label, viewport: input.viewport, view: input.view });
        return Promise.resolve();
      case 'view': {
        // Not queued on the bus: the command awaiting it holds the bus's queue.
        const resolve = this.#viewReplies.get(input.id);
        this.#viewReplies.delete(input.id);
        resolve?.(input.reply);
        return Promise.resolve();
      }
    }
  }

  /**
   * The blocks a save gives the dimensions that have none (M2-30 part 2): a change set for the
   * saved file only, applied after the drawing's change log; undefined when there are none.
   */
  blocklessDimensionBlocks(): Promise<ChangeSet | undefined> {
    return this.#bus.blocklessDimensionBlocks();
  }

  /**
   * The view each layout shown is saved in (M2-47 part 1, `paperViewsChange`): a change set for
   * the saved file only, applied after the drawing's change log; undefined when nothing changes.
   */
  paperViews(layouts: readonly PaperView[]): ChangeSet | undefined {
    const change = paperViewsChange(this.model, layouts);
    return Object.keys(change).length > 0 ? change : undefined;
  }

  #emit(o: CommandOutput): void {
    for (const l of this.#listeners) l(o);
  }

  /** Applies an edit to the document; a refused edit changes nothing. */
  edit(e: EngineEdit): EditResult {
    if (e.kind === 'xref-load') return this.#xrefLoad(e);
    if (e.kind === 'xref-unload') return this.#xrefUnload(e);
    if (e.kind === 'xref-detach') return this.#xrefDetach(e);
    if (e.kind === 'xref-bind') return this.#xrefBind(e);
    if (e.kind === 'view') return this.#viewEdit(e);
    if (
      e.kind === 'view-delete' ||
      e.kind === 'view-rename' ||
      e.kind === 'view-category' ||
      e.kind === 'view-layers' ||
      e.kind === 'view-restore'
    )
      return this.#viewTableEdit(e);
    if (e.kind === 'sysvar') return this.#sessionVariable(e);
    if (e.kind === 'fields') return this.#fieldEvent(e);
    if (
      e.kind === 'layer-new' ||
      e.kind === 'layer-delete' ||
      e.kind === 'layer-merge' ||
      e.kind === 'layer-current'
    )
      return this.#layerTableEdit(e);
    if (
      e.kind === 'layer-state-save' ||
      e.kind === 'layer-state-restore' ||
      e.kind === 'layer-state-delete' ||
      e.kind === 'layer-state-edit' ||
      e.kind === 'layer-state-import'
    )
      return this.#layerStatesEdit(e);
    if (
      e.kind === 'layer-filter-new' ||
      e.kind === 'layer-filter-edit' ||
      e.kind === 'layer-filter-delete' ||
      e.kind === 'layer-filter-set' ||
      e.kind === 'layer-filter-isolate' ||
      e.kind === 'layer-filter-convert'
    )
      return this.#layerFiltersEdit(e);
    if (e.kind === 'linetype-load') return this.#linetypeLoad(e);
    if (e.kind === 'purge') return this.#purge(e);
    if (e.kind === 'aliases') {
      this.#registry.setUserAliases(e.aliases);
      return { ok: true, change: {} };
    }
    return e.kind === 'layout' ? this.#layoutEdit(e) : this.#layerEdit(e);
  }

  #viewEdit(e: NamedViewEdit): EditResult {
    const name = e.name.trim();
    if (!validViewName(name)) return { ok: false, message: 'Invalid view name.' };
    const problem = viewCategoryProblem(e.category && viewCategory(e.category));
    if (problem) return { ok: false, message: problem };
    const b = new ChangeSetBuilder(this.model);
    const view = saveNamedView(b, this.model, name, e.view, e.category);
    if (e.layers === true) {
      const why = saveViewLayers(b, this.model, view);
      if (why) return { ok: false, message: why };
    } else if (e.layers === false) {
      const before = this.model.tables.views.get(view.handle);
      if (before) dropViewLayers(b, this.model, before);
    }
    const change = b.build();
    this.model.apply(change);
    this.#step('VIEW', change);
    return { ok: true, change };
  }

  #viewTableEdit(e: ViewTableEdit): EditResult {
    const views = [...this.model.tables.views.values()];
    const named = (n: string) => views.find((v) => v.name.toUpperCase() === n.trim().toUpperCase());
    const view = named(e.name);
    if (!view) return { ok: false, message: `Cannot find view "${e.name.trim()}".` };
    const b = new ChangeSetBuilder(this.model);
    if (e.kind === 'view-delete') {
      dropViewLayers(b, this.model, view);
      b.removeTableRecord('views', view.handle);
    } else if (e.kind === 'view-layers') {
      if (e.save) {
        const why = saveViewLayers(b, this.model, view);
        if (why) return { ok: false, message: why };
      } else dropViewLayers(b, this.model, view);
    } else if (e.kind === 'view-restore') {
      restoreViewLayers(b, this.model, view);
    } else if (e.kind === 'view-category') {
      const category = viewCategory(e.category);
      const problem = viewCategoryProblem(category);
      if (problem) return { ok: false, message: problem };
      if (category === view.category) return { ok: true, change: {} };
      b.updateTableRecord('views', view.handle, { category });
    } else {
      const name = e.newName.trim();
      if (!validViewName(name)) return { ok: false, message: 'Invalid view name.' };
      const other = named(name);
      if (other && other.handle !== view.handle) {
        return { ok: false, message: `A view named "${other.name}" already exists.` };
      }
      if (name === view.name) return { ok: true, change: {} };
      renameViewLayers(b, this.model, view, name);
      b.updateTableRecord('views', view.handle, { name });
    }
    const change = b.build();
    if (isEmptyChangeSet(change)) return { ok: true, change };
    this.model.apply(change);
    this.#step('VIEW', change);
    return { ok: true, change };
  }

  #fieldEvent(e: FieldEventEdit): EditResult {
    const change = fieldEventChange(
      {
        model: this.model,
        now: new Date(e.now),
        ...(e.fileName === undefined ? {} : { fileName: e.fileName }),
        // A browser never reveals a file's folder (DWGPREFIX).
        folder: '',
      },
      e.event,
    );
    if (!change) return { ok: true, change: {} };
    this.model.apply(change);
    return { ok: true, change };
  }

  #sessionVariable(e: SessionVariableEdit): EditResult {
    const most = { [PICKADD]: 3, [PICKAUTO]: 7, [PICKSTYLE]: 3, [GROUPDISPLAYMODE]: 2 } as const;
    if (e.name in most) {
      const name = e.name as keyof typeof most;
      const max = most[name];
      if (!Number.isInteger(e.value) || e.value < 0 || e.value > max) {
        return { ok: false, message: `Cannot set ${e.name} to ${e.value}.` };
      }
      this.#bus.setPickVariable(name, e.value);
      return { ok: true, change: {} };
    }
    const known = e.name === REVCLOUDGRIPS || e.name === PICKFIRST;
    if (!known || (e.value !== 0 && e.value !== 1)) {
      return { ok: false, message: `Cannot set ${String(e.name)} here.` };
    }
    if (e.name === PICKFIRST) {
      void this.#bus.setPickfirst(e.value === 1);
      return { ok: true, change: {} };
    }
    // 1 is AutoCAD's initial value, which no entry means.
    const value = e.value === 1 ? undefined : 0;
    if (this.model.header.get(REVCLOUDGRIPS) === value) return { ok: true, change: {} };
    const b = new ChangeSetBuilder(this.model);
    b.setHeader(REVCLOUDGRIPS, value);
    const change = b.build();
    this.model.apply(change);
    return { ok: true, change };
  }

  #xrefLoad(e: XrefLoadEdit): EditResult {
    const problem = xrefLoadProblem(this.model, e.block);
    if (problem) return { ok: false, message: problem };
    let change: ChangeSet;
    try {
      // XATTACH's load evaluates every layer of the xref as new (M5-19).
      change = xrefLoadChange(this.model, e.block, e.drawing, { attach: this.#bus.attaching });
      this.model.apply(change);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    // XATTACH's load (M5-04 part 6) is part of its undo step.
    this.#bus.joinLoad(change);
    return { ok: true, change };
  }

  #xrefUnload(e: XrefUnloadEdit): EditResult {
    const problem = xrefUnloadProblem(this.model, e.block, e.reload);
    if (problem) return { ok: false, message: problem };
    const change = xrefUnloadChange(this.model, e.block, e.reload);
    if (Object.keys(change).length) this.model.apply(change);
    return { ok: true, change };
  }

  #xrefDetach(e: XrefDetachEdit): EditResult {
    for (const h of e.blocks) {
      const problem = xrefDetachProblem(this.model, h);
      if (problem) return { ok: false, message: problem };
    }
    const change = xrefDetachChange(this.model, e.blocks);
    if (Object.keys(change).length === 0) return { ok: true, change };
    this.model.apply(change);
    this.#step('XREF', change);
    return { ok: true, change };
  }

  #xrefBind(e: XrefBindEdit): EditResult {
    for (const h of e.blocks) {
      const problem = xrefBindProblem(this.model, h);
      if (problem) return { ok: false, message: problem };
    }
    const change = xrefBindChange(this.model, e.blocks, e.insert);
    this.model.apply(change);
    this.#step('XREF', change);
    return { ok: true, change };
  }

  #layerEdit(e: LayerStateEdit): EditResult {
    const { kind: _kind, layer, ...props } = e;
    return this.#layerStep(
      layerPropsChange(this.model, typeof layer === 'string' ? [layer] : layer, props),
    );
  }

  #layerTableEdit(e: LayerTableEdit): EditResult {
    return this.#layerStep(
      e.kind === 'layer-new'
        ? newLayerChange(this.model, e.like, e.name)
        : e.kind === 'layer-delete'
          ? deleteLayersChange(this.model, e.layers)
          : e.kind === 'layer-merge'
            ? mergeLayersChange(this.model, e.layers, e.target)
            : currentLayerChange(this.model, e.layer),
    );
  }

  /** What the Health palette's purge card counts (M5-09 part 3). */
  purgeHealth(): PurgeHealth {
    return purgeHealth(this.model);
  }

  /** The layers any object is on: the Layer Properties Manager's All Used Layers (M5-07 part 5). */
  layersInUse(): Handle[] {
    return [...layersInUse(this.model)];
  }

  #purge(e: PurgeEdit): EditResult {
    const m = this.model;
    const b = new ChangeSetBuilder(m);
    if (e.what === 'unused') {
      const unused = unusedItems(m);
      if (unused.length === 0) return { ok: false, message: 'No unused named items found.' };
      const items = purgeClosure(
        m,
        unused.map((i) => i.handle),
        true,
      );
      purgeInto(b, m, items);
    } else if (e.what === 'orphaned') {
      const orphaned = orphanedData(m);
      if (orphaned.length === 0) return { ok: false, message: 'No orphaned data found.' };
      purgeOrphanedInto(b, m, orphaned);
    } else {
      const ids = e.what === 'zero-length' ? zeroLengthObjects(m) : emptyTextObjects(m);
      if (ids.length === 0)
        return {
          ok: false,
          message:
            e.what === 'zero-length'
              ? 'No zero-length geometry found.'
              : 'No empty text objects found.',
        };
      eraseObjects(b, m, ids);
    }
    const change = b.build();
    m.apply(change);
    this.#step('PURGE', change);
    return { ok: true, change };
  }

  #linetypeLoad(e: LinetypeLoadEdit): EditResult {
    const b = new ChangeSetBuilder(this.model);
    const r = loadLinetypes(b, this.model, e.linetypes, e.reload ?? false);
    if (r.loaded.length + r.reloaded.length === 0) {
      const why = r.refused[0];
      return {
        ok: false,
        message: why ? `Linetype ${why.name} not loaded: ${why.reason}.` : 'No linetype loaded.',
      };
    }
    return this.#layerStep(b.build(), 'LINETYPE');
  }

  #layerStatesEdit(e: NamedLayerStateEdit): EditResult {
    const m = this.model;
    const change =
      e.kind === 'layer-state-save'
        ? saveLayerStateChange(m, e.name, e)
        : e.kind === 'layer-state-restore'
          ? restoreLayerStateChange(m, e.state, e)
          : e.kind === 'layer-state-delete'
            ? deleteLayerStateChange(m, e.state)
            : e.kind === 'layer-state-edit'
              ? editLayerStateChange(m, e.state, {
                  name: e.name,
                  description: e.description,
                  mask: e.mask,
                  layers: e.layers,
                })
              : importLayerStateChange(m, e.state, e.replace);
    return this.#layerStep(change, 'LAYERSTATE');
  }

  /** A layer change applied as one LAYER step, as AutoCAD names the manager's; or refused. */
  #layerFiltersEdit(e: LayerFilterEdit): EditResult {
    const m = this.model;
    const change =
      e.kind === 'layer-filter-new'
        ? newLayerFilterChange(m, e)
        : e.kind === 'layer-filter-edit'
          ? editLayerFilterChange(m, e.filter, e)
          : e.kind === 'layer-filter-set'
            ? filterLayersChange(m, e.node, e.set)
            : e.kind === 'layer-filter-isolate'
              ? isolateFilterChange(m, e.node, e.space)
              : e.kind === 'layer-filter-convert'
                ? convertLayerFilterChange(m, e.filter)
                : deleteLayerFilterChange(m, e.filter);
    return this.#layerStep(change);
  }

  #layerStep(change: ChangeSet | string, label = 'LAYER'): EditResult {
    if (typeof change === 'string') return { ok: false, message: change };
    if (Object.keys(change).length === 0) return { ok: true, change };
    this.model.apply(change);
    this.#step(label, change);
    return { ok: true, change };
  }

  /**
   * An edit the app made outside a command, as AutoCAD keeps it: one undo step of its own
   * (M2-23), which U undoes through the bus, so the replicas hear of it as a `change`. AutoCAD
   * names a Layer-control change LAYER and a layout's rename, move or page setup LAYOUT. An
   * empty change is no step (DEC-049).
   */
  #step(label: string, change: ChangeSet): void {
    layerPreviousOf(this.model).record(this.model, [change]);
    // The manager's LAYER steps join the LAYER step just before them under UNDO Control Layer.
    this.#bus.undo.push({ command: label, changes: [change] }, { layer: label === 'LAYER' });
  }

  /** PICKFIRST as the app last set it (M2-59): picks at `Command:` select. */
  get pickfirst(): boolean {
    return this.#bus.pickfirst;
  }

  /** The drawing's undo history as the undo/redo buttons show it (M2-05, M2-23). */
  get undoState(): UndoState {
    return this.#bus.undo.state;
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
    if (Object.keys(change).length > 0) {
      this.model.apply(change);
      this.#step('LAYOUT', change);
    }
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
