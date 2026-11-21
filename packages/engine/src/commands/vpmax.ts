// VPMAX and VPMIN (M6-02 part 7): a layout viewport expanded to fill the drawing area for
// editing, and the layout shown again (AutoCAD 2024 Help, "VPMAX (Command)": "Expands the
// current layout viewport for editing. The viewport is expanded to fill the screen and switched
// to model space for editing"; "VPMIN (Command)": "Restores the current layout viewport. The
// center point and magnification are returned to the settings that were in effect before the
// viewport was maximized"). The engine works in the viewport's model space meanwhile, as in
// MSPACE; the canvas fills itself with the viewport and keeps the view ZOOM and PAN give it there
// to itself, so neither command edits the drawing nor is an undo step.
//
// Choices where Help says nothing: in paper space VPMAX takes the viewport preselected, else the
// layout's only one, else asks for one; VPMIN goes back to paper space when VPMAX was given
// there, to the viewport worked in otherwise (the common drafter expectation: VPMIN undoes
// VPMAX). "The viewport is already maximized." and "The viewport is not maximized." are chosen.
import { floatingViewport, floatingViewports } from '../layout/current-viewport';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { CommandContext, CommandDef } from './command';
import { isPaperSpace } from './bus';
import { NOT_IN_MODEL_TAB, NO_VIEWPORTS } from './mspace';
import { viewportOfPick } from './vpclip';

export const ALREADY_MAXIMIZED = 'The viewport is already maximized.';
export const NOT_MAXIMIZED = 'The viewport is not maximized.';
export const NOT_WORKABLE = 'The viewport cannot be maximized.';

/** Whether the tab shown is a layout's (not the Model tab, nor the Block Editor's block). */
const onLayout = (ctx: CommandContext): boolean =>
  ctx.viewport.current !== undefined || isPaperSpace(ctx.model, ctx.space);

/** The workable viewport of the layout shown that one of `ids` is (or clips), or why none is. */
function viewportAmong(
  ctx: CommandContext,
  ids: readonly EntityId[],
): { readonly handle: Handle } | { readonly problem: string } {
  const vp = ids.map((i) => viewportOfPick(ctx, ctx.model.entity(i))).find((v) => v);
  if (!vp) return { problem: 'Object is not a viewport.' };
  return floatingViewport(ctx.model, ctx.viewport.sheet, vp.handle)
    ? { handle: vp.handle }
    : { problem: NOT_WORKABLE };
}

export function vpmaxCommand(): CommandDef {
  return {
    name: 'VPMAX',
    // A viewport preselected (or double-clicked) is the one maximized.
    usesSelection: 'during',
    async *run(ctx) {
      if (!onLayout(ctx)) return ctx.message(NOT_IN_MODEL_TAB);
      if (ctx.viewport.maximized) return ctx.message(ALREADY_MAXIMIZED);
      let viewport = ctx.viewport.current;
      const all = floatingViewports(ctx.model, ctx.viewport.sheet);
      if (viewport === undefined) {
        const pre = viewportAmong(ctx, ctx.preselected);
        if ('handle' in pre) viewport = pre.handle;
        else if (all.length === 0) return ctx.message(NO_VIEWPORTS);
        else if (all.length === 1) viewport = all[0]!.handle;
      }
      while (viewport === undefined) {
        const a = yield ctx.prompt.selection({
          message: 'Select a viewport to maximize',
          single: true,
        });
        const ids = (a as { ids?: readonly EntityId[] }).ids ?? [];
        if (ids.length === 0) return;
        const vp = viewportAmong(ctx, ids);
        if ('handle' in vp) viewport = vp.handle;
        else ctx.message(vp.problem);
      }
      await ctx.viewport.maximize(viewport);
    },
  };
}

export function vpminCommand(): CommandDef {
  return {
    name: 'VPMIN',
    // eslint-disable-next-line require-yield -- no prompt: it restores at once
    async *run(ctx) {
      if (!onLayout(ctx)) return ctx.message(NOT_IN_MODEL_TAB);
      if (!ctx.viewport.maximized) return ctx.message(NOT_MAXIMIZED);
      await ctx.viewport.minimize();
    },
  };
}
