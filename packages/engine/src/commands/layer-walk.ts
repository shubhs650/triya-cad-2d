// LAYWALK (M5-06 part 4), as AutoCAD 2024's (AutoCAD Help, "LAYWALK (Command)": "Dynamically
// displays objects on layers that you select"; "LayerWalk Dialog Box"): the LayerWalk dialog
// (`LayerWalkRequest`) lists the drawing's layers, and the layers chosen in it are shown while
// every other one is hidden; a layer set to Always Show (held, `*` before its name) stays shown
// whatever is chosen. The dialog's buttons:
//   - Select Objects: "Selects objects and their layers": the dialog closes for "Select objects",
//     and the layers of the objects selected become the layers chosen;
//   - Purge: "When unreferenced layers are selected in the layer list, purges those layers";
//   - Restore on Exit: "Returns layers to their previous state when you exit the dialog box. If
//     the check box is cleared, any changes you made are saved."
// and the list's shortcut menu's Save Layer State "Saves the current selection of layers as a
// layer state that can be used by the Layer States Manager". The rest of the menu (Hold and
// Release, Select All, Clear All, Invert Selection, Select Unreferenced, Inspect, Copy as Filter,
// Save and Delete Current Filter) and the wildcard filter are the dialog's own; the filter it
// last had, its saved filters and Restore on Exit are kept for the next LAYWALK, as AutoCAD keeps
// them for the session.
//
// The dialog answers each change of the layers chosen (`apply`), and the layers are turned on or
// off as the drafter walks, so the canvas, osnaps and picks see only the layers shown. All of it
// is one undo step: a walk that Restore on Exit puts back is a step that changes nothing, which
// U goes over as AutoCAD's U goes over a LAYWALK group.
//
// Settled for the common drafter expectation (AutoCAD's help does not say; noted in the PR):
// the dialog opens with the layers that are on chosen, so opening it changes nothing on screen;
// walking turns layers on and off (Restore on Exit cleared keeps them so) and never thaws a
// frozen layer; a layer the filter leaves out of the list is hidden unless chosen or held, as
// any layer not chosen is; Purge leaves layer 0, Defpoints, the current layer and xref layers,
// as PURGE does.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import { deleteLayers, layerRemovalProblem, layersInUse } from '../edit/layer-manager';
import { layerStates, saveLayerState } from '../edit/layer-states';

/** One layer of the LayerWalk dialog's list. */
export interface LayerWalkLayer {
  readonly handle: Handle;
  readonly name: string;
  /** The objects on it, in model space, the layouts and block definitions (Inspect). */
  readonly objects: number;
  /** An object is on it (Select Unreferenced chooses the others). */
  readonly referenced: boolean;
  /** Purge can take it: unreferenced, and not layer 0, Defpoints, current or an xref's. */
  readonly purgeable: boolean;
}

/** The LayerWalk dialog's settings, as it opens and as each answer leaves them. */
export interface LayerWalkSettings {
  /** The layers chosen in the list: those shown, with the held ones. */
  readonly selected: readonly Handle[];
  /** The layers set to Always Show. */
  readonly held: readonly Handle[];
  readonly restore: boolean;
  /** The wildcard typed in the filter box, and whether the Filter check box applies it. */
  readonly filter: string;
  readonly filterOn: boolean;
  /** The filters saved (Save Current Filter), which the filter box's list offers. */
  readonly filters: readonly string[];
}

/**
 * LAYWALK's LayerWalk dialog ("LayerWalk - Layers: n"): the drawing's layers by name, its
 * settings, the drawing's layer states (Save Layer State asks before overwriting one) and what
 * the last action said (Purge's count, a refused layer state name).
 */
export interface LayerWalkRequest {
  readonly type: 'laywalk';
  readonly layers: readonly LayerWalkLayer[];
  readonly walk: LayerWalkSettings;
  readonly states: readonly string[];
  readonly note?: string;
}

/**
 * What the dialog answers: its settings, with `apply` (a walk step, with Purge or Save Layer
 * State when `purge` or `saveState` says so), `select` (Select Objects) or `ok` (Close).
 */
export interface LayerWalkAnswer {
  readonly walk: LayerWalkSettings;
  readonly purge?: true;
  readonly saveState?: { readonly name: string; readonly description: string };
}

/** What LAYWALK keeps between runs while the app is open. */
interface WalkMemory {
  restore: boolean;
  filter: string;
  filterOn: boolean;
  filters: readonly string[];
}

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const byName = (x: { name: string }, y: { name: string }) =>
  x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' });

const countOf = (n: number) => `${n} layer${n === 1 ? '' : 's'}`;

function listedLayers(ctx: CommandContext): LayerWalkLayer[] {
  const objects = new Map<Handle, number>();
  for (const e of ctx.model.entities()) objects.set(e.layer, (objects.get(e.layer) ?? 0) + 1);
  const used = layersInUse(ctx.model);
  return [...ctx.model.tables.layers.values()].sort(byName).map((l) => ({
    handle: l.handle,
    name: l.name,
    objects: objects.get(l.handle) ?? 0,
    referenced: used.has(l.handle),
    purgeable: !used.has(l.handle) && layerRemovalProblem(ctx.model, l, 'deleted') === undefined,
  }));
}

/** The settings with only layers the drawing has, each once. */
function sane(ctx: CommandContext, w: LayerWalkSettings): LayerWalkSettings {
  const has = (h: Handle) => ctx.model.tables.layers.has(h);
  return {
    ...w,
    selected: [...new Set(w.selected)].filter(has),
    held: [...new Set(w.held)].filter(has),
    filters: [...new Set(w.filters)],
  };
}

/** Each layer on when chosen or held, off otherwise; one edit, none when all are so already. */
function show(ctx: CommandContext, w: LayerWalkSettings): void {
  const on = new Set([...w.selected, ...w.held]);
  const changing = [...ctx.model.tables.layers.values()].filter((l) => l.on !== on.has(l.handle));
  if (changing.length === 0) return;
  ctx.edit((b) => {
    for (const l of changing) b.updateTableRecord('layers', l.handle, { on: !l.on });
  });
}

/** Purge: the chosen layers it can take removed; the settings without them, and what it said. */
function purge(ctx: CommandContext, w: LayerWalkSettings): [LayerWalkSettings, string] {
  const can = new Set(listedLayers(ctx).flatMap((l) => (l.purgeable ? [l.handle] : [])));
  const gone = w.selected.filter((h) => can.has(h));
  if (gone.length === 0) return [w, 'No unreferenced layers are selected.'];
  let why: string | undefined;
  ctx.edit((b) => {
    why = deleteLayers(b, ctx.model, gone);
  });
  if (why) return [w, why];
  const said = `${countOf(gone.length)} purged.`;
  ctx.message(said);
  return [sane(ctx, w), said];
}

/** Select Objects: the layers of the objects selected, in the order taken; none at Enter. */
async function* layersOfSelection(ctx: CommandContext): Sub<Handle[]> {
  // Esc goes back to the dialog, as Enter does: the walk is not left half undone.
  const a = yield ctx.prompt.selection({ message: 'Select objects', escape: true });
  if (a.kind !== 'selection') return [];
  const layers: Handle[] = [];
  for (const id of a.ids) {
    const l = ctx.model.entity(id)?.layer;
    if (l !== undefined && !layers.includes(l)) layers.push(l);
  }
  return layers;
}

export function laywalkCommand(): CommandDef {
  const memory: WalkMemory = { restore: true, filter: '', filterOn: false, filters: [] };
  return {
    name: 'LAYWALK',
    usesSelection: 'none',
    async *run(ctx) {
      const before = new Map([...ctx.model.tables.layers.values()].map((l) => [l.handle, l.on]));
      let walk: LayerWalkSettings = {
        selected: listedLayers(ctx).flatMap((l) =>
          ctx.model.tables.layers.get(l.handle)?.on ? [l.handle] : [],
        ),
        held: [],
        restore: memory.restore,
        filter: memory.filter,
        filterOn: memory.filterOn,
        filters: memory.filters,
      };
      let note: string | undefined;
      for (;;) {
        const a = yield ctx.prompt.dialog({
          message: 'LayerWalk',
          escape: true,
          dialog: {
            type: 'laywalk',
            layers: listedLayers(ctx),
            walk,
            states: layerStates(ctx.model).map((s) => s.name),
            ...(note !== undefined && { note }),
          },
        });
        note = undefined;
        const answer = a.kind === 'dialog' ? a.laywalk : undefined;
        if (answer) {
          walk = sane(ctx, answer.walk);
          memory.restore = walk.restore;
          memory.filter = walk.filter;
          memory.filterOn = walk.filterOn;
          memory.filters = walk.filters;
        }
        if (a.kind !== 'dialog' || a.action === 'ok' || !answer) break;
        if (a.action === 'select') {
          show(ctx, walk);
          const picked = yield* layersOfSelection(ctx);
          if (picked.length > 0) walk = { ...walk, selected: picked };
        } else if (answer.purge) {
          [walk, note] = purge(ctx, walk);
        }
        show(ctx, walk);
        if (a.action === 'apply' && answer.saveState) {
          const { name, description } = answer.saveState;
          let why: string | undefined;
          ctx.edit((b) => {
            why = saveLayerState(b, ctx.model, name.trim(), { description });
          });
          note = why ?? `Layer state "${name.trim()}" saved.`;
        }
      }
      if (!walk.restore) return;
      // Restore on Exit: every layer the drawing still has back on or off as it was.
      const back = [...ctx.model.tables.layers.values()].filter(
        (l) => before.has(l.handle) && before.get(l.handle) !== l.on,
      );
      if (back.length === 0) return;
      ctx.edit((b) => {
        for (const l of back) b.updateTableRecord('layers', l.handle, { on: !l.on });
      });
    },
  };
}
