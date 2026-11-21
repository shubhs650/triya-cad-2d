// A new layout shown for the first time (M6-06), as AutoCAD initializes one (AutoCAD 2024 Help,
// "LAYOUTCREATEVIEWPORT", "SHOWPAGESETUPFORNEWLAYOUTS", both "Saved in: Registry"):
//   - SHOWPAGESETUPFORNEWLAYOUTS 1 (0 initially; the Page Setup Manager's "Display when creating
//     a new layout") opens the Page Setup Manager for it, as PAGESETUP opens it;
//   - LAYOUTCREATEVIEWPORT 1 (initially) then gives it a viewport, MVIEW Fit's
//     (`addLayoutViewport`), fitting the sheet its page setup now has.
// The session runs this when the app shows a layout made since the drawing opened that has never
// been shown and has nothing on its sheet (`EngineSession`, `space`): LAYOUT New's, or a copy of
// an empty one. What a file's own empty layouts hold stays as read. The viewport is one LAYOUT
// undo step; undone, the layout is not given another when shown again, as it has been shown.
import type { CommandContext, CommandDef, CommandGenerator } from './command';
import { windowDialog } from './file';
import { addLayoutViewport } from './mview';

/** An app variable that is a switch, or AutoCAD's initial value where no app keeps it. */
async function appSwitch(ctx: CommandContext, name: string, initial: 0 | 1): Promise<boolean> {
  const r = await ctx.view.request({ op: 'sysvar', name });
  return (r.ok && typeof r.value === 'number' ? r.value : initial) === 1;
}

/** Whether the space shown is still a layout with nothing on its sheet. */
const emptyLayout = (ctx: CommandContext): boolean =>
  ctx.model.layouts.some((l) => l.blockRecord === ctx.space) &&
  ctx.model.blockEntities(ctx.space).length === 0;

export function layoutInitCommand(): CommandDef {
  return {
    name: 'LAYOUT',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx): CommandGenerator {
      if (await appSwitch(ctx, 'SHOWPAGESETUPFORNEWLAYOUTS', 0)) {
        yield* windowDialog(ctx, 'pagesetup');
      }
      if (emptyLayout(ctx) && (await appSwitch(ctx, 'LAYOUTCREATEVIEWPORT', 1))) {
        await addLayoutViewport(ctx);
      }
    },
  };
}
