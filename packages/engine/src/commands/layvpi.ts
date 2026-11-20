// LAYVPI (M6-02 part 6): the layer of each object picked frozen in every layout viewport but the
// current one (AutoCAD 2024 Help, "LAYVPI (Command)": "Isolates the layer of a selected object in
// the current viewport by freezing the layer in all viewports except the current viewport. You
// can choose to isolate in all layouts or in the current layout only"). Like LAYFRZ it takes one
// object at a time until Enter, with Settings (Layouts: All layouts or Current layout; Block
// selection: the nesting level, `nested-pick.ts`) and Undo (the last layer back as it was in
// each viewport). The settings last while the drawing is open (Help: "persists from session to
// session"; Triya keeps no per-user command settings in the engine). One LAYVPI undo step.
//
// Help: "LAYVPI works only when TILEMODE is set to 0 and when two or more paper space viewports
// are defined." It gives no messages, so the refusals' wording is chosen: on the Model tab the
// one MSPACE and VPCLIP give; in paper space (no viewport current, so no "current viewport" to
// isolate in) and with fewer than two floating viewports where the setting looks, a message
// saying what is needed. Ambiguity, settled for the common drafter expectation: a layer frozen
// in the current viewport (VPLAYER, VP Freeze) is thawed there, since isolating it means showing
// it there; its own Freeze and Off are left alone.
import type { CommandContext, CommandDef } from './command';
import type { Handle } from '../model/handle';
import { freezeInViewports, layoutViewports } from '../edit/viewport-layer-edits';
import { BLOCK_SELECTIONS, pickedLayer, type BlockSelection } from './nested-pick';
import { isPaperSpace } from './bus';
import { NOT_IN_MODEL_TAB } from './mspace';

export const LAYVPI_IN_PAPER_SPACE =
  'No viewport is current. Use MSPACE or double-click in a viewport first.';
export const LAYVPI_TOO_FEW = 'LAYVPI requires two or more layout viewports.';

type Layouts = 'All layouts' | 'Current layout';

/** One pick's change: the layer, and the viewports it was frozen in and thawed in before. */
interface Isolated {
  readonly layer: Handle;
  readonly frozen: readonly Handle[];
  readonly thawed: readonly Handle[];
}

function frozenIn(ctx: CommandContext, viewport: Handle, layer: Handle): boolean {
  const g = ctx.model.entityByHandle(viewport)?.geom;
  return g?.kind === 'VIEWPORT' && g.frozenLayers.includes(layer);
}

export function layvpiCommand(): CommandDef {
  const state: { layouts: Layouts; blocks: BlockSelection } = {
    layouts: 'All layouts',
    blocks: 'Block',
  };
  return {
    name: 'LAYVPI',
    usesSelection: 'during',
    async *run(ctx) {
      const current = ctx.viewport.current;
      if (current === undefined) {
        ctx.message(isPaperSpace(ctx.model, ctx.space) ? LAYVPI_IN_PAPER_SPACE : NOT_IN_MODEL_TAB);
        return;
      }
      /** The viewports the setting covers, the current one included. */
      const covered = () =>
        layoutViewports(ctx.model)
          .filter((v) => state.layouts === 'All layouts' || v.owner === ctx.viewport.sheet)
          .map((v) => v.handle);
      if (covered().length < 2) {
        ctx.message(LAYVPI_TOO_FEW);
        return;
      }
      ctx.message(
        `Current settings: Layouts=${state.layouts}, Block nesting level=${state.blocks}`,
      );
      const done: Isolated[] = [];
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select objects on the layer to be isolated in viewport',
          options: ['Settings', 'Undo'],
          single: true,
        });
        if (a.kind === 'keyword' && a.keyword === 'Settings') {
          const t = yield ctx.prompt.keyword({
            message: 'Enter setting type for',
            options: ['Layouts', 'Block selection'],
          });
          if (t.kind !== 'keyword') return;
          if (t.keyword === 'Block selection') {
            const n = yield ctx.prompt.keyword({
              message: 'Enter Block Selection nesting level',
              options: [...BLOCK_SELECTIONS],
              default: { kind: 'keyword', keyword: state.blocks },
            });
            if (n.kind !== 'keyword') return;
            state.blocks = n.keyword as BlockSelection;
            continue;
          }
          const s = yield ctx.prompt.keyword({
            message: 'Isolate layers in all viewports except current for',
            options: ['All layouts', 'Current layout'],
            default: { kind: 'keyword', keyword: state.layouts },
          });
          if (s.kind !== 'keyword') return;
          state.layouts = s.keyword as Layouts;
          continue;
        }
        if (a.kind === 'keyword') {
          const last = done.pop();
          if (!last) ctx.message('Nothing to undo.');
          else
            ctx.edit((b) => {
              freezeInViewports(b, ctx.model, [last.layer], last.frozen, true);
              freezeInViewports(b, ctx.model, [last.layer], last.thawed, false);
            });
          continue;
        }
        if (a.kind !== 'selection') return;
        const layer = await pickedLayer(ctx, a, state.blocks);
        if (!layer) return;
        const viewports = covered();
        const others = viewports.filter((h) => h !== current);
        done.push({
          layer: layer.handle,
          frozen: viewports.filter((h) => frozenIn(ctx, h, layer.handle)),
          thawed: viewports.filter((h) => !frozenIn(ctx, h, layer.handle)),
        });
        ctx.edit((b) => {
          freezeInViewports(b, ctx.model, [layer.handle], others, true);
          freezeInViewports(b, ctx.model, [layer.handle], [current], false);
        });
        ctx.message(`Layer "${layer.name}" has been isolated in the current viewport.`);
      }
    },
  };
}
