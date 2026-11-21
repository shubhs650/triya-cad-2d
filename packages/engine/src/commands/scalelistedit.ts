// -SCALELISTEDIT (M6-02 part 21): the drawing's scale list at the command line (AutoCAD 2024
// Help, "-SCALELISTEDIT (Command)": "Enter option [?/Add/Delete/Reset/Exit] <Add>:"). The
// options ask again until Exit; every change is part of the command's one undo step. The scale
// list edits (annotation/scale-list.ts) do the work, as the Edit Drawing Scales dialog's do.
//   - ? lists the scales whose names match, each with its paper and drawing units.
//   - Add asks a name, then a ratio as n:m, paper units to drawing units ("Enter the ratio as
//     n:m, where n is paper units and m is drawing units"); the scale joins the end of the list.
//   - Delete removes the scales a name matches (wildcards, as BricsCAD's "or all unused"), but
//     not the current one or one an annotative object uses ("cannot be deleted").
//   - Reset "deletes all custom scales and restores the default list of scales" after a Yes,
//     the scales in use kept.
// Ambiguities, settled for the common drafter expectation (Help gives the options, not their
// prompts or messages): the prompts are "Enter name for new scale", "Enter scale ratio",
// "Enter name of scale to delete" and "Reset scale list to default entries? [Yes/No] <No>";
// a ratio typed as one number n is n:1; an invalid one says "Invalid scale." and asks again.
// SCALELISTEDIT opens the Edit Drawing Scales dialog (M6-02 part 22) on the list, each scale with
// how it is in use; its OK makes the list it left in one undo step, Cancel nothing. With no
// dialog to show (a script, a test without a canvas) it asks these prompts instead.
import {
  DEFAULT_SCALE_LIST,
  type ScaleListDialogEntry,
  parseScaleRatio,
  resetScaleList,
  scaleListOf,
  scaleListProblem,
  scaleNameProblem,
  scaleUses,
  SCALE_IN_USE_BY_OBJECT,
  SCALE_IS_CURRENT,
  writeScaleList,
  type ScaleListEntry,
} from '../annotation/scale-list';
import type { CommandContext, CommandDef } from './command';
import { wcmatch } from './modify/attributes';
import type { Prompt, PromptAnswer } from './prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const OPTIONS = ['?', 'Add', 'Delete', 'Reset', 'Exit'];

/** The list a drawing with no scale list edits: the metric scales viewports offer it. */
export const METRIC_SCALE_LIST = DEFAULT_SCALE_LIST.slice(0, 17);

const typed = (a: PromptAnswer): string => (a.kind === 'string' ? a.value.trim() : '');

/** The drawing's scale list as SCALELISTEDIT edits it. */
export const editedList = (ctx: Pick<CommandContext, 'model'>): ScaleListEntry[] =>
  scaleListOf(ctx.model, METRIC_SCALE_LIST);

/** Makes the scale list `list` in the command's edit, or says why it cannot be. */
export function commitScaleList(
  ctx: Pick<CommandContext, 'model' | 'edit' | 'message'>,
  list: readonly ScaleListEntry[],
): boolean {
  const problem = scaleListProblem(ctx.model, list);
  if (problem) {
    ctx.message(problem);
    return false;
  }
  ctx.edit((b) => writeScaleList(ctx.model, b, list));
  return true;
}

const units = (n: number): string => String(Number(n.toPrecision(12)));

async function* list(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter scale name(s) to list',
    default: { kind: 'string', value: '*' },
    spaces: true,
  });
  const pattern = typed(a) || '*';
  const found = editedList(ctx).filter((s) => wcmatch(s.name, pattern));
  if (found.length === 0) {
    ctx.message('No matching scales found.');
    return;
  }
  const width = Math.max(...found.map((s) => s.name.length)) + 4;
  for (const s of found)
    ctx.message(
      `${s.name.padEnd(width)}${units(s.paperUnits)} paper units = ${units(s.drawingUnits)} drawing units`,
    );
}

async function* add(ctx: CommandContext): Sub<void> {
  const before = editedList(ctx);
  const name = typed(
    yield ctx.prompt.string({ message: 'Enter name for new scale', spaces: true }),
  );
  if (name === '') return;
  const problem = scaleNameProblem(before, name);
  if (problem) {
    ctx.message(problem);
    return;
  }
  for (;;) {
    const a = yield ctx.prompt.string({ message: 'Enter scale ratio' });
    if (a.kind !== 'string' || typed(a) === '') return;
    const ratio = parseScaleRatio(typed(a));
    if (!ratio) {
      ctx.message('Invalid scale.');
      continue;
    }
    commitScaleList(ctx, [...before, { name, ...ratio }]);
    return;
  }
}

async function* remove(ctx: CommandContext): Sub<void> {
  const pattern = typed(
    yield ctx.prompt.string({ message: 'Enter name of scale to delete', spaces: true }),
  );
  if (pattern === '') return;
  const before = editedList(ctx);
  // A name as typed first: scale names hold characters wildcards read (`.`, `,`, `#`).
  const exact = before.filter((s) => s.name.toUpperCase() === pattern.toUpperCase());
  const matched = exact.length > 0 ? exact : before.filter((s) => wcmatch(s.name, pattern));
  if (matched.length === 0) {
    ctx.message(`Cannot find scale "${pattern}".`);
    return;
  }
  const uses = scaleUses(ctx.model);
  const gone = new Set<ScaleListEntry>();
  for (const s of matched) {
    const use = s.handle === undefined ? undefined : uses.get(s.handle);
    if (use === 'object') ctx.message(SCALE_IN_USE_BY_OBJECT(s.name));
    else if (use === 'current') ctx.message(SCALE_IS_CURRENT(s.name));
    else gone.add(s);
  }
  if (gone.size === 0) return;
  if (
    commitScaleList(
      ctx,
      before.filter((s) => !gone.has(s)),
    )
  )
    ctx.message(`${gone.size} scale${gone.size === 1 ? '' : 's'} deleted.`);
}

async function* reset(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Reset scale list to default entries?',
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: 'No' },
  });
  if (a.kind !== 'keyword' || a.keyword !== 'Yes') return;
  commitScaleList(ctx, resetScaleList(ctx.model, editedList(ctx)));
}

/** The Edit Drawing Scales dialog; false when there is none to show. */
async function dialog(ctx: CommandContext): Promise<boolean> {
  const uses = scaleUses(ctx.model);
  const scales: ScaleListDialogEntry[] = editedList(ctx).map((s) => {
    const use = s.handle === undefined ? undefined : uses.get(s.handle);
    return use ? { ...s, use } : s;
  });
  const reply = await ctx.view.request({
    op: 'scaleListDialog',
    scales,
    defaults: DEFAULT_SCALE_LIST,
  });
  if (!reply.ok) return false;
  if (reply.scaleList) commitScaleList(ctx, reply.scaleList);
  return true;
}

export function scalelisteditCommand(): CommandDef {
  return {
    name: 'SCALELISTEDIT',
    dashVariant: true,
    async *run(ctx) {
      if (!ctx.dash && (await dialog(ctx))) return;
      for (;;) {
        const a = yield ctx.prompt.keyword({
          message: 'Enter option',
          options: OPTIONS,
          default: { kind: 'keyword', keyword: 'Add' },
        });
        if (a.kind !== 'keyword' || a.keyword === 'Exit') return;
        if (a.keyword === '?') yield* list(ctx);
        else if (a.keyword === 'Add') yield* add(ctx);
        else if (a.keyword === 'Delete') yield* remove(ctx);
        else yield* reset(ctx);
      }
    },
  };
}
