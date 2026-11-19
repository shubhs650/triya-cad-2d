// VIEW and -VIEW (M2-02 part 2): named views, for the space shown. VIEW (V) opens the View
// Manager (M2-47 part 2), the app's dialog, and waits for it; its New View dialog's "Define
// window" hides both and hands back to VIEW, which asks "Specify first corner:" and "Specify
// opposite corner:" and shows them again with that window, as PLOT's Window< does (Esc at a
// corner shows them again as they were). -VIEW runs the command-line prompts: Delete, Restore,
// Save, sEttings and Window are the 2D ones (Orthographic is 3D).
// Save and Window write the view into the drawing's VIEW table (M2-29), an undo step the save
// keeps, as AutoCAD's do; Delete removes views from it, with their layer snapshots. Restore
// restores a view's layer snapshot with it (M5-07 part 7, `restoreViewLayers`). Save and Window
// keep no snapshot: AutoCAD 2024 Help's -VIEW Save says nothing of one, so a view saved again
// keeps the one it had; sEttings' Layer snapshot sets it (M5-07 part 8).
//   Enter an option [?/Delete/Restore/Save/sEttings/Window]:
// sEttings offers the 2D settings, Categorize and Layer snapshot (Background, live Section and
// Visual style are 3D; Ucs sets UCSVIEW, which Triya, drawing in the WCS, does not have):
//   Enter an option [Categorize/Layer snapshot]:
// Help describes them ("Specifies a category for the named view", "Saves the current layer
// visibility settings with the new named view") without their prompts. Ambiguity, settled for
// the common drafter expectation: each asks for the views to change, as Delete does (`?` lists
// them), then for the setting, which it gives each of them as the View Manager's Category and
// Layer snapshot rows do, one VIEW undo step:
//   Enter view name(s) to categorize or [?]:   Enter category name or [?]:
//   Enter view name(s) to change or [?]:
//   Save current layer settings with view(s)? [Yes/No] <Yes>:
// A category's `?` lists those the drawing's views have; `<None>` (or nothing) takes it off.
// (AutoCAD 2024 Help, "-VIEW (Command)"). Saving under a name the drawing has replaces that view:
// the Help says nothing of asking first, and the View Manager's New asks only because a dialog
// can; the command line keeps the drafter's flow.
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import type { ViewRecord } from '../../model/types';
import {
  saveNamedView,
  validViewName,
  viewCategory,
  viewCategoryProblem,
  type ViewExtent,
} from '../../edit/named-view';
import { dropViewLayers, restoreViewLayers, saveViewLayers } from '../../edit/view-layers';
import { isPaperSpace } from '../bus';
import { viewRequest } from './zoom';
import { windowDialog } from '../file';

/** A `?` list pattern: `*` any run, `?` one character, case ignored; commas separate several. */
export function viewNameMatches(name: string, patterns: string): boolean {
  return patterns
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .some((p) => {
      const re = p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${re}$`, 'i').test(name);
    });
}

async function* listViews(ctx: CommandContext): CommandGenerator {
  const a = yield ctx.prompt.string({
    message: 'Enter view name(s) to list',
    default: { kind: 'string', value: '*' },
  });
  if (a.kind !== 'string') return;
  const r = await viewRequest(ctx, { op: 'views' });
  if (!r.ok) return;
  const found = (r.views ?? []).filter((v) => viewNameMatches(v.name, a.value));
  if (found.length === 0) return ctx.message('No matching views found.');
  ctx.message('Saved views:');
  for (const v of found) {
    const notes = [
      v.inDrawing ? undefined : 'this session',
      v.restorable ? undefined : 'not a plan view',
    ].filter((n) => n !== undefined);
    ctx.message(`  ${v.name}${notes.length ? `  (${notes.join(', ')})` : ''}`);
  }
}

async function* viewName(
  ctx: CommandContext,
  message: string,
): AsyncGenerator<Prompt, string | undefined, PromptAnswer> {
  for (;;) {
    const a = yield ctx.prompt.string({ message, spaces: true });
    if (a.kind !== 'string') return undefined;
    const name = a.value.trim();
    if (validViewName(name)) return name;
    ctx.message('Invalid view name.');
  }
}

/** Deletes the views whose names match the patterns typed (`?` and `*`, comma separated). */
async function* deleteViews(ctx: CommandContext): CommandGenerator {
  const a = yield ctx.prompt.string({ message: 'Enter view name(s) to delete', spaces: true });
  if (a.kind !== 'string' || a.value.trim() === '') return;
  const found = [...ctx.model.tables.views.values()].filter((v) =>
    viewNameMatches(v.name, a.value),
  );
  if (found.length === 0) return ctx.message('No matching views found.');
  ctx.edit((b) => {
    for (const v of found) {
      dropViewLayers(b, ctx.model, v);
      b.removeTableRecord('views', v.handle);
    }
  });
}

/** The drawing's views as `?` lists them. */
function listDrawingViews(ctx: CommandContext): void {
  const views = [...ctx.model.tables.views.values()];
  if (views.length === 0) return ctx.message('No matching views found.');
  ctx.message('Saved views:');
  for (const v of views) ctx.message(`  ${v.name}`);
}

const isList = (a: PromptAnswer): boolean =>
  a.kind === 'keyword' || (a.kind === 'string' && a.value.trim() === '?');

/** sEttings' "Enter view name(s) to ... or [?]:", until views are named; undefined at Esc. */
async function* settingsViews(
  ctx: CommandContext,
  verb: string,
): AsyncGenerator<Prompt, ViewRecord[] | undefined, PromptAnswer> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: `Enter view name(s) to ${verb} or`,
      options: ['?'],
      spaces: true,
    });
    if (isList(a)) {
      listDrawingViews(ctx);
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return undefined;
    const found = [...ctx.model.tables.views.values()].filter((v) =>
      viewNameMatches(v.name, a.value),
    );
    if (found.length === 0) ctx.message('No matching views found.');
    return found.length === 0 ? undefined : found;
  }
}

/** The categories the drawing's views have, as a category's `?` lists them. */
function listCategories(ctx: CommandContext): void {
  const used = new Map<string, string>();
  for (const v of ctx.model.tables.views.values())
    if (v.category !== undefined) used.set(v.category.toUpperCase(), v.category);
  if (used.size === 0) return ctx.message('No view categories.');
  ctx.message('View categories:');
  for (const c of used.values()) ctx.message(`  ${c}`);
}

/** sEttings Categorize: the views named filed under the category typed. */
async function* categorize(ctx: CommandContext): CommandGenerator {
  const views = yield* settingsViews(ctx, 'categorize');
  if (!views) return;
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter category name or',
      options: ['?'],
      spaces: true,
    });
    if (isList(a)) {
      listCategories(ctx);
      continue;
    }
    if (a.kind !== 'string') return;
    const category = viewCategory(a.value);
    const problem = viewCategoryProblem(category);
    if (problem) {
      ctx.message(problem);
      continue;
    }
    const changed = views.filter((v) => v.category !== category);
    if (changed.length > 0)
      ctx.edit((b) => {
        for (const v of changed) b.updateTableRecord('views', v.handle, { category });
      });
    return;
  }
}

/** sEttings Layer snapshot: the layers now saved with the views named, or their snapshots dropped. */
async function* layerSnapshot(ctx: CommandContext): CommandGenerator {
  const views = yield* settingsViews(ctx, 'change');
  if (!views) return;
  const a = yield ctx.prompt.keyword({
    message: 'Save current layer settings with view(s)?',
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: 'Yes' },
  });
  if (a.kind !== 'keyword') return;
  let why: string | undefined;
  ctx.edit((b) => {
    for (const v of views) {
      if (a.keyword === 'No') dropViewLayers(b, ctx.model, v);
      else why ??= saveViewLayers(b, ctx.model, v);
    }
  });
  if (why) ctx.message(why);
}

/** Saves `extent` of the space drawn in as the view `name`. */
function save(ctx: CommandContext, name: string, extent: ViewExtent, paper: boolean): void {
  ctx.edit((b) => saveNamedView(b, ctx.model, name, { ...extent, paper }));
}

export function viewCommand(): CommandDef {
  return {
    name: 'VIEW',
    dashVariant: true,
    async *run(ctx) {
      if (!ctx.dash) return yield* windowDialog(ctx, 'views');
      const a = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['?', 'Delete', 'Restore', 'Save', 'sEttings', 'Window'],
      });
      if (a.kind !== 'keyword') return;
      if (a.keyword === '?') return yield* listViews(ctx);
      if (a.keyword === 'Delete') return yield* deleteViews(ctx);
      if (a.keyword === 'sEttings') {
        const o = yield ctx.prompt.keyword({
          message: 'Enter an option',
          options: ['Categorize', 'Layer snapshot'],
        });
        if (o.kind !== 'keyword') return;
        return yield* o.keyword === 'Categorize' ? categorize(ctx) : layerSnapshot(ctx);
      }
      if (a.keyword === 'Restore') {
        const name = yield* viewName(ctx, 'Enter view name to restore');
        if (!name) return;
        const r = await viewRequest(ctx, { op: 'restore', name });
        // The view's layer snapshot comes back with it (M5-07 part 7).
        const key = name.toUpperCase();
        const view = [...ctx.model.tables.views.values()].find((v) => v.name.toUpperCase() === key);
        if (r.ok && view?.layerState !== undefined)
          ctx.edit((b) => restoreViewLayers(b, ctx.model, view));
        return;
      }
      const name = yield* viewName(ctx, 'Enter view name to save');
      if (!name) return;
      if (a.keyword === 'Save') {
        // The canvas knows what it shows; `viewRequest` reports a refusal.
        const r = await viewRequest(ctx, { op: 'get' });
        if (r.ok && r.view) save(ctx, name, r.view, r.view.paper);
        return;
      }
      const first = yield ctx.prompt.point({ message: 'Specify first corner' });
      if (first.kind !== 'point') return;
      const second = yield ctx.prompt.point({
        message: 'Specify opposite corner',
        rubberBand: { from: first.point, box: true },
      });
      if (second.kind !== 'point') return;
      const p = first.point;
      const q = second.point;
      const width = Math.abs(q.x - p.x);
      const height = Math.abs(q.y - p.y);
      if (!(width > 0) || !(height > 0)) return ctx.message('The window has no area.');
      const center = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      save(ctx, name, { center, width, height }, isPaperSpace(ctx.model, ctx.space));
    },
  };
}
