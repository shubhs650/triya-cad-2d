// VIEW and -VIEW (M2-02 part 2): named views, for the space shown. VIEW (V) opens the View
// Manager (M2-47 part 2), the app's dialog, and waits for it; its New View dialog's "Define
// window" hides both and hands back to VIEW, which asks "Specify first corner:" and "Specify
// opposite corner:" and shows them again with that window, as PLOT's Window< does (Esc at a
// corner shows them again as they were). -VIEW runs the command-line prompts: Delete, Restore,
// Save and Window are the 2D ones (Orthographic and sEttings are 3D and UCS).
// Save and Window write the view into the drawing's VIEW table (M2-29), an undo step the save
// keeps, as AutoCAD's do; Delete removes views from it.
//   Enter an option [?/Delete/Restore/Save/Window]:
// (AutoCAD 2024 Help, "-VIEW (Command)"). Saving under a name the drawing has replaces that view:
// the Help says nothing of asking first, and the View Manager's New asks only because a dialog
// can; the command line keeps the drafter's flow.
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { saveNamedView, validViewName, type ViewExtent } from '../../edit/named-view';
import { modelSpaceOf } from '../bus';
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
    for (const v of found) b.removeTableRecord('views', v.handle);
  });
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
        options: ['?', 'Delete', 'Restore', 'Save', 'Window'],
      });
      if (a.kind !== 'keyword') return;
      if (a.keyword === '?') return yield* listViews(ctx);
      if (a.keyword === 'Delete') return yield* deleteViews(ctx);
      if (a.keyword === 'Restore') {
        const name = yield* viewName(ctx, 'Enter view name to restore');
        if (name) await viewRequest(ctx, { op: 'restore', name });
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
      save(ctx, name, { center, width, height }, ctx.space !== modelSpaceOf(ctx.model));
    },
  };
}
