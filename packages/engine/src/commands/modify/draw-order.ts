// DRAWORDER, TEXTTOFRONT and HATCHTOBACK (M2-08) with AutoCAD 2024's prompts (AutoCAD 2024
// Help: DRAWORDER, TEXTTOFRONT, HATCHTOBACK (Command)):
//   Select objects:
//   Enter object ordering option [Above objects/Under objects/Front/Back] <Back>:
//   Select reference objects:                                   (Above objects, Under objects)
//   Bring to front [Text/Dimensions/Leaders/All] <All>:          (TEXTTOFRONT)
// The draw order is the block's SORTENTSTABLE (edit/draw-order.ts). TEXTTOFRONT and HATCHTOBACK
// rearrange every layout (model space and each paper space), leaving blocks and xrefs alone;
// objects on locked layers stay where they are, as DRAWORDER refuses them (AutoCAD documents
// neither command's handling of locked layers; we keep them alike).
import {
  TEXT_TO_FRONT_KINDS,
  layoutObjects,
  moveInDrawOrder,
  type DrawOrderMove,
} from '../../edit/draw-order';
import type { CommandDef } from '../command';
import type { EntityId } from '../../model/entity-ids';
import type { PromptAnswer } from '../prompt';

/** A selection prompt answers the selection (none when Enter ends it at once). */
const selected = (a: PromptAnswer): readonly EntityId[] => (a as { ids: readonly EntityId[] }).ids;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function drawOrderCommand(): CommandDef {
  return {
    name: 'DRAWORDER',
    usesSelection: 'during',
    async *run(ctx) {
      const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      const ids = selected(s);
      if (ids.length === 0) return;
      const a = yield ctx.prompt.keyword({
        message: 'Enter object ordering option',
        options: ['Above objects', 'Under objects', 'Front', 'Back'],
        default: { kind: 'keyword', keyword: 'Back' },
      });
      // A default: Enter answers Back, so the answer is a keyword.
      const option = (a as { keyword: string }).keyword;
      let move: DrawOrderMove;
      if (option === 'Front' || option === 'Back') {
        move = { to: option === 'Front' ? 'front' : 'back' };
      } else {
        const r = yield ctx.prompt.selection({ message: 'Select reference objects' });
        const reference = selected(r);
        if (reference.length === 0) return;
        move = { to: option === 'Above objects' ? 'above' : 'under', reference };
      }
      ctx.edit((b) => moveInDrawOrder(b, ctx.model, ids, move));
    },
  };
}

export function textToFrontCommand(): CommandDef {
  return {
    name: 'TEXTTOFRONT',
    async *run(ctx) {
      const a = yield ctx.prompt.keyword({
        message: 'Bring to front',
        options: ['Text', 'Dimensions', 'Leaders', 'All'],
        default: { kind: 'keyword', keyword: 'All' },
      });
      const option = (a as { keyword: string }).keyword; // Enter answers All
      const kinds = new Set<string>(
        option === 'All'
          ? Object.values(TEXT_TO_FRONT_KINDS).flat()
          : TEXT_TO_FRONT_KINDS[option as keyof typeof TEXT_TO_FRONT_KINDS],
      );
      const ids = layoutObjects(ctx.model, (e) => kinds.has(e.geom.kind));
      if (ids.length > 0) ctx.edit((b) => moveInDrawOrder(b, ctx.model, ids, { to: 'front' }));
      ctx.message(`${plural(ids.length, 'object', 'objects')} brought to front.`);
    },
  };
}

export function hatchToBackCommand(): CommandDef {
  return {
    name: 'HATCHTOBACK',
    // eslint-disable-next-line require-yield -- no prompts, as AutoCAD's
    async *run(ctx) {
      const ids = layoutObjects(ctx.model, (e) => e.geom.kind === 'HATCH');
      if (ids.length > 0) ctx.edit((b) => moveInDrawOrder(b, ctx.model, ids, { to: 'back' }));
      ctx.message(`${plural(ids.length, 'hatch object', 'hatch objects')} sent to back.`);
    },
  };
}

export const DRAW_ORDER_COMMANDS = [drawOrderCommand, textToFrontCommand, hatchToBackCommand];
