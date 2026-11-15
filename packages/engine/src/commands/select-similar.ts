// SELECTSIMILAR (M3-04 part 3), with AutoCAD 2024's prompt (AutoCAD Help, "SELECTSIMILAR
// (Command)"):
//
//   Select objects or [SEttings]:
//
// Objects selected at `Command:` are the samples at once, with no prompt. Otherwise the samples
// are picked; SEttings opens the Select Similar Settings dialog on SELECTSIMILARMODE, which OK
// sets (the app keeps it, as AutoCAD keeps it in the user settings), and the prompt comes back.
// The samples and every object like them (`selection/similar.ts`) are left selected and gripped
// at `Command:`, as a pick would leave them.
import type { CommandDef, CommandContext } from './command';
import { DEFAULT_SELECTSIMILARMODE, SELECTSIMILARMODE, selectSimilar } from '../selection/similar';

/** SELECTSIMILARMODE as the app keeps it; AutoCAD's initial 130 when it tells none. */
async function similarMode(ctx: CommandContext): Promise<number> {
  const r = await ctx.view.request({ op: 'sysvar', name: SELECTSIMILARMODE });
  return r.ok && typeof r.value === 'number' ? r.value : DEFAULT_SELECTSIMILARMODE;
}

export function selectSimilarCommand(): CommandDef {
  return {
    name: 'SELECTSIMILAR',
    usesSelection: 'before',
    keepsSelection: true,
    async *run(ctx) {
      let samples = [...ctx.preselected];
      while (samples.length === 0) {
        const a = yield ctx.prompt.selection({
          message: 'Select objects or',
          options: ['SEttings'],
          pickfirst: false,
        });
        if (a.kind === 'keyword') {
          const d = yield ctx.prompt.dialog({
            message: 'Select Similar Settings',
            escape: true,
            dialog: { type: 'selectsimilar', mode: await similarMode(ctx) },
          });
          if (d.kind === 'dialog' && d.selectSimilar !== undefined) {
            await ctx.view.request({
              op: 'sysvar',
              name: SELECTSIMILARMODE,
              value: d.selectSimilar,
            });
          } else if (d.kind !== 'dialog' && d.kind !== 'escape') return;
          continue;
        }
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        samples = [...a.ids];
      }
      ctx.select(selectSimilar(ctx.model, ctx.space, samples, await similarMode(ctx)));
    },
  };
}
