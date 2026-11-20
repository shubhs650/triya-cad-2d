// MSPACE (MS) and PSPACE (PS) (M6-02 part 3): a layout worked in through one of its floating
// viewports, or in its paper space again (AutoCAD 2024 Help, "MSPACE (Command)", "PSPACE
// (Command)"). MSPACE makes current the viewport last current in the layout shown, else the one
// AutoCAD's file stacked first (`firstViewport`); a double click in a viewport, or on the sheet
// outside them, does the same (bus.ts). Neither is an undo step, as in AutoCAD.
//
// Messages: on the Model tab AutoCAD refuses both ("** Command not allowed in Model Tab **").
// AutoCAD's help gives no message for MSPACE without a viewport to work in, nor for PSPACE in
// paper space; "There are no active model space viewports." and "Already in paper space." are
// chosen. A viewport turned off, twisted or not in plan is none to work in (`workableViewport`).
import { firstViewport, floatingViewport } from '../layout/current-viewport';
import { isPaperSpace } from './bus';
import type { CommandContext, CommandDef } from './command';

export const NOT_IN_MODEL_TAB = '** Command not allowed in Model Tab **';
export const NO_VIEWPORTS = 'There are no active model space viewports.';
export const IN_PAPER_SPACE = 'Already in paper space.';

/** Whether the tab shown is a layout's (not the Model tab, nor the Block Editor's block). */
const onLayout = (ctx: CommandContext): boolean =>
  ctx.viewport.current !== undefined || isPaperSpace(ctx.model, ctx.space);

export function mspaceCommand(): CommandDef {
  return {
    name: 'MSPACE',
    // eslint-disable-next-line require-yield -- no prompt: it switches at once
    async *run(ctx) {
      if (!onLayout(ctx)) return ctx.message(NOT_IN_MODEL_TAB);
      if (ctx.viewport.current !== undefined) return;
      const sheet = ctx.viewport.sheet;
      const vp =
        floatingViewport(ctx.model, sheet, ctx.viewport.last) ?? firstViewport(ctx.model, sheet);
      if (!vp) return ctx.message(NO_VIEWPORTS);
      await ctx.viewport.set(vp.handle);
    },
  };
}

export function pspaceCommand(): CommandDef {
  return {
    name: 'PSPACE',
    // eslint-disable-next-line require-yield -- no prompt: it switches at once
    async *run(ctx) {
      if (!onLayout(ctx)) return ctx.message(NOT_IN_MODEL_TAB);
      if (ctx.viewport.current === undefined) return ctx.message(IN_PAPER_SPACE);
      await ctx.viewport.set(undefined);
    },
  };
}
