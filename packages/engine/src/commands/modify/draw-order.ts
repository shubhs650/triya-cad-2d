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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function drawOrderCommand(): CommandDef {
  return {
    name: 'DRAWORDER',
    usesSelection: 'during',
    async *run(ctx) {
      const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      if (s.kind !== 'selection' || s.ids.length === 0) return;
      const a = yield ctx.prompt.keyword({
        message: 'Enter object ordering option',
        options: ['Above objects', 'Under objects', 'Front', 'Back'],
        default: { kind: 'keyword', keyword: 'Back' },
      });
      if (a.kind !== 'keyword') return;
      let move: DrawOrderMove;
      if (a.keyword === 'Front' || a.keyword === 'Back') {
        move = { to: a.keyword === 'Front' ? 'front' : 'back' };
      } else {
        const r = yield ctx.prompt.selection({ message: 'Select reference objects' });
        if (r.kind !== 'selection' || r.ids.length === 0) return;
        move = { to: a.keyword === 'Above objects' ? 'above' : 'under', reference: r.ids };
      }
      ctx.edit((b) => moveInDrawOrder(b, ctx.model, s.ids, move));
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
      if (a.kind !== 'keyword') return;
      const kinds = new Set<string>(
        a.keyword === 'All'
          ? Object.values(TEXT_TO_FRONT_KINDS).flat()
          : TEXT_TO_FRONT_KINDS[a.keyword as keyof typeof TEXT_TO_FRONT_KINDS],
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
