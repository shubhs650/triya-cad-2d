// VIEW and -VIEW (M2-02 part 2): the command-line form of named views, for the space shown.
// AutoCAD's VIEW opens the View Manager; until that dialog lands both run the -VIEW prompts.
// Restore, Save and Window are the 2D ones (Orthographic and sEttings are 3D and UCS, Delete
// comes with writing views to the drawing, M2-13); a view saved here lasts the session, as the
// navigation bar's.
//   Enter an option [?/Restore/Save/Window]:
// (AutoCAD 2024 Help, "-VIEW (Command)").
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { viewRequest } from './zoom';

/** Characters AutoCAD refuses in a symbol table name. */
const NAME_INVALID = /[<>/\\":;?*|,=`]/;

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
    if (name !== '' && name.length <= 255 && !NAME_INVALID.test(name)) return name;
    ctx.message('Invalid view name.');
  }
}

export function viewCommand(): CommandDef {
  return {
    name: 'VIEW',
    dashVariant: true,
    async *run(ctx) {
      const a = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['?', 'Restore', 'Save', 'Window'],
      });
      if (a.kind !== 'keyword') return;
      if (a.keyword === '?') return yield* listViews(ctx);
      if (a.keyword === 'Restore') {
        const name = yield* viewName(ctx, 'Enter view name to restore');
        if (name) await viewRequest(ctx, { op: 'restore', name });
        return;
      }
      const name = yield* viewName(ctx, 'Enter view name to save');
      if (!name) return;
      if (a.keyword === 'Save') return void (await viewRequest(ctx, { op: 'save', name }));
      const first = yield ctx.prompt.point({ message: 'Specify first corner' });
      if (first.kind !== 'point') return;
      const second = yield ctx.prompt.point({
        message: 'Specify opposite corner',
        rubberBand: { from: first.point, box: true },
      });
      if (second.kind !== 'point') return;
      await viewRequest(ctx, { op: 'save', name, window: { a: first.point, b: second.point } });
    },
  };
}
