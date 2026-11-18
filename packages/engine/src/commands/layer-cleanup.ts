// LAYDEL and LAYMRG (M5-06 part 2), with AutoCAD 2024's prompts (AutoCAD Help, "LAYDEL
// (Command)", "-LAYDEL", "LAYMRG (Command)", "-LAYMRG"):
//
//   - LAYDEL deletes every object on the layers picked (in block definitions too, which are
//     redefined) and purges the layers.
//   - LAYMRG moves every object on the layers picked to a target layer and purges them.
//
// Both gather layers by picking an object on each ("Select object on layer to delete or
// [Name/Undo]"; Undo takes the last one back) until Enter, then ask "Do you wish to continue?".
// Name opens the Delete Layers or Merge Layers dialog (M5-06 part 3), and the target's Name the
// Merge to Layer dialog, each listing only the layers the command can take; -LAYDEL and -LAYMRG
// ask for the name at the command line (`?` lists the layers). AutoCAD's help does not say where
// OK in Delete Layers or Merge Layers goes: it goes on to the warning (or the target) with the
// layers chosen, as a drafter who named them expects; Cancel goes back to the pick prompt.
// "Layers that cannot be deleted include the current layer, layer 0, locked layers, and
// xref-dependent layers": Delete Layers leaves a locked layer out of its list, though a pick on
// an object of one takes it (AutoCAD's help names no lock for picks).
//
// AutoCAD's help names no layer either refuses. Both purge what they take, so they refuse what
// the Layer Properties Manager's Delete Layer refuses (layer 0, Defpoints, the current layer and
// an xref's layers) when it is picked, and LAYMRG an xref-dependent target. The warning's
// wording follows AutoCAD's ("******** WARNING ********", "You are about to …"); its help does
// not quote it, so the lines naming several layers are Triya's.
//
// A pick on a block reference or an xref takes the layer of the object picked inside it (M5-06
// part 5, `nested-pick.ts`), for the layers and the target alike.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { ChangeSetBuilder } from '../model/builder';
import type { Handle } from '../model/handle';
import type { LayerRecord } from '../model/types';
import type { LayerListRequest } from './prompt';
import { deleteLayersWithObjects, layerRemovalProblem, mergeLayers } from '../edit/layer-manager';
import { pickedLayer } from './nested-pick';

/** DXF 70 bit 16: a layer that came in with an xref. */
const XREF_DEPENDENT = 16;

type Asking<T> = AsyncGenerator<Prompt, T | undefined, PromptAnswer>;

const quoted = (name: string) => `"${name}"`;
const names = (layers: readonly LayerRecord[]) => layers.map((l) => quoted(l.name)).join(', ');

function layerNamed(ctx: CommandContext, name: string): LayerRecord | undefined {
  const wanted = name.trim().toUpperCase();
  return [...ctx.model.tables.layers.values()].find((l) => l.name.toUpperCase() === wanted);
}

/** "Enter layer name or [?]": a layer of the drawing, asked again until one is named. */
async function* askLayerName(ctx: CommandContext): Asking<LayerRecord> {
  for (;;) {
    const a = yield ctx.prompt.string({ message: 'Enter layer name or', options: ['?'] });
    if (a.kind === 'keyword') {
      const all = [...ctx.model.tables.layers.values()].map((l) => l.name);
      all.sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));
      ctx.message('Layers:');
      for (const n of all) ctx.message(`  ${n}`);
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return undefined;
    const l = layerNamed(ctx, a.value);
    if (l) return l;
    ctx.message(`Layer ${quoted(a.value.trim())} not found.`);
  }
}

const byName = (x: LayerRecord, y: LayerRecord) =>
  x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * A layer list dialog of `layers` (M5-06 part 3): the layers chosen at OK, those of them the
 * drawing still has; undefined at Cancel (or any other answer), or OK with none chosen.
 */
async function* askLayerList(
  ctx: CommandContext,
  title: LayerListRequest['title'],
  layers: readonly LayerRecord[],
  multiple: boolean,
): Asking<LayerRecord[]> {
  const a = yield ctx.prompt.dialog({
    message: title,
    escape: true,
    dialog: {
      type: 'layerlist',
      title,
      multiple,
      layers: [...layers].sort(byName).map((l) => ({ handle: l.handle, name: l.name })),
    },
  });
  if (a.kind !== 'dialog' || a.action !== 'ok') return undefined;
  const chosen = (a.layers ?? []).flatMap((h) => {
    const l = ctx.model.tables.layers.get(h);
    return l ? [l] : [];
  });
  return chosen.length > 0 ? chosen : undefined;
}

/** The layers Delete Layers or Merge Layers offers: those a pick could take, not yet chosen. */
function removableLayers(
  ctx: CommandContext,
  verb: 'delete' | 'merge',
  chosen: readonly LayerRecord[],
): LayerRecord[] {
  return [...ctx.model.tables.layers.values()].filter(
    (l) =>
      !chosen.includes(l) &&
      !(verb === 'delete' && l.locked) &&
      layerRemovalProblem(ctx.model, l, verb === 'delete' ? 'deleted' : 'merged') === undefined,
  );
}

/**
 * The layers to delete or merge: one per pick (or name) until Enter, each one LAYDEL or LAYMRG
 * cannot take refused as it is picked; the layers chosen in the Delete Layers or Merge Layers
 * dialog end the gathering. Undefined at Esc.
 */
async function* gatherLayers(ctx: CommandContext, verb: 'delete' | 'merge'): Asking<LayerRecord[]> {
  const chosen: LayerRecord[] = [];
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: `Select object on layer to ${verb} or`,
      options: chosen.length > 0 ? ['Name', 'Undo'] : ['Name'],
      single: true,
    });
    let taken: LayerRecord[] = [];
    let done = false;
    if (a.kind === 'keyword' && a.keyword === 'Undo') {
      chosen.pop();
    } else if (a.kind === 'keyword' && ctx.dash) {
      const l = yield* askLayerName(ctx);
      if (l) taken = [l];
    } else if (a.kind === 'keyword') {
      const title = verb === 'delete' ? 'Delete Layers' : 'Merge Layers';
      const listed = yield* askLayerList(ctx, title, removableLayers(ctx, verb, chosen), true);
      if (!listed) continue;
      taken = listed;
      done = true;
    } else if (a.kind === 'selection' && a.ids.length > 0) {
      const l = await pickedLayer(ctx, a, 'Entity');
      if (l) taken = [l];
    } else {
      return chosen;
    }
    for (const layer of taken) {
      const why = layerRemovalProblem(ctx.model, layer, verb === 'delete' ? 'deleted' : 'merged');
      if (why) ctx.message(why);
      else if (!chosen.includes(layer)) chosen.push(layer);
    }
    if (done && chosen.length > 0) return chosen;
    if (taken.length > 0 && taken.every((l) => !chosen.includes(l))) continue;
    ctx.message(
      chosen.length > 0
        ? `Selected layers: ${chosen.map((l) => l.name).join(', ')}`
        : 'No layers selected.',
    );
  }
}

/** "Do you wish to continue? [Yes/No] <No>" after AutoCAD's warning; false at No or Esc. */
async function* confirm(ctx: CommandContext, warning: string): Asking<boolean> {
  ctx.message('******** WARNING ********');
  ctx.message(warning);
  const a = yield ctx.prompt.keyword({
    message: 'Do you wish to continue?',
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: 'No' },
  });
  return a.kind === 'keyword' && a.keyword === 'Yes';
}

/**
 * `layers` deleted or merged by `build` (into the command's one edit), reported as AutoCAD
 * reports purged layers; or why not, with nothing changed.
 */
function removeLayers(
  ctx: CommandContext,
  layers: readonly LayerRecord[],
  build: (b: ChangeSetBuilder, handles: readonly Handle[]) => string | undefined,
): void {
  let problem: string | undefined;
  ctx.edit((b) => {
    problem = build(
      b,
      layers.map((l) => l.handle),
    );
  });
  if (problem) {
    ctx.message(problem);
    return;
  }
  for (const l of layers) ctx.message(`Deleting layer ${quoted(l.name)}.`);
  ctx.message(`${layers.length} layer${layers.length === 1 ? '' : 's'} deleted.`);
}

/** LAYDEL (and -LAYDEL): the layers picked deleted with every object on them. */
export function laydelCommand(): CommandDef {
  return {
    name: 'LAYDEL',
    dashVariant: true,
    usesSelection: 'during',
    async *run(ctx) {
      const layers = yield* gatherLayers(ctx, 'delete');
      if (!layers || layers.length === 0) return;
      const ok = yield* confirm(
        ctx,
        layers.length === 1
          ? `You are about to delete layer ${quoted(layers[0]!.name)} from this drawing.`
          : `You are about to delete layers ${names(layers)} from this drawing.`,
      );
      if (!ok) return;
      removeLayers(ctx, layers, (b, handles) => deleteLayersWithObjects(b, ctx.model, handles));
    },
  };
}

/** LAYMRG (and -LAYMRG): the layers picked merged into a target layer. */
export function laymrgCommand(): CommandDef {
  return {
    name: 'LAYMRG',
    dashVariant: true,
    usesSelection: 'during',
    async *run(ctx) {
      const layers = yield* gatherLayers(ctx, 'merge');
      if (!layers || layers.length === 0) return;
      let target: LayerRecord | undefined;
      while (!target) {
        const a = yield ctx.prompt.selection({
          message: 'Select object on target layer or',
          options: ['Name'],
          single: true,
        });
        if (a.kind === 'keyword' && ctx.dash) target = yield* askLayerName(ctx);
        else if (a.kind === 'keyword') {
          const targets = [...ctx.model.tables.layers.values()].filter(
            (l) => !layers.includes(l) && ((l.flags ?? 0) & XREF_DEPENDENT) === 0,
          );
          target = (yield* askLayerList(ctx, 'Merge to Layer', targets, false))?.[0];
          if (!target) continue;
        } else if (a.kind === 'selection' && a.ids.length > 0)
          target = await pickedLayer(ctx, a, 'Entity');
        else return;
        if (target && layers.includes(target)) {
          ctx.message(`Layer ${quoted(target.name)} is being merged; select another layer.`);
          target = undefined;
        } else if (target && ((target.flags ?? 0) & XREF_DEPENDENT) !== 0) {
          ctx.message('Cannot merge into an xref-dependent layer.');
          target = undefined;
        }
      }
      const ok = yield* confirm(
        ctx,
        layers.length === 1
          ? `You are about to merge layer ${quoted(layers[0]!.name)} into layer ${quoted(target.name)}.`
          : `You are about to merge layers ${names(layers)} into layer ${quoted(target.name)}.`,
      );
      if (!ok) return;
      const into = target.handle;
      removeLayers(ctx, layers, (b, handles) => mergeLayers(b, ctx.model, handles, into));
    },
  };
}
