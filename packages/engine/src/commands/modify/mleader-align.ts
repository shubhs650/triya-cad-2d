// MLEADERALIGN (MLA) and MLEADERCOLLECT (MLC), M4-04 part 3, with AutoCAD 2024's prompts
// ("MLEADERALIGN (Command)", "MLEADERCOLLECT (Command)", AutoCAD 2024 Help):
//   Select multileaders:
//   Current mode: Use current spacing
//   Select multileader to align to or [Options]:
//   Specify direction:
//   Enter an option [Distribute/make leader segments Parallel/specify Spacing/Use current spacing]
//     <Use current spacing>:
//   Specify first point: / Specify second point:                     (Distribute)
//   Specify spacing <0.0000>:                                       (Spacing)
// and
//   Select multileaders:
//   Specify collected multileader location or [Vertical/Horizontal/Wrap] <Horizontal>:
//   Specify wrap width or [Number]: / Enter the maximum number of blocks per row:   (Wrap)
// The mode MLEADERALIGN's Options chose, and MLEADERCOLLECT's layout, stay for the drawing's
// next run, as AutoCAD's do. The geometry, and the readings taken where the help is silent, are
// in edit/mleader-align.ts. Help does not say what Distribute asks after its points: it moves
// the content at once, with no multileader to align to.
import type { Box } from '../../geom/bounds';
import type { Vec2 } from '../../geom/types';
import type { EntityId } from '../../model/entity-ids';
import type { MultiLeaderGeometry } from '../../model/types';
import {
  MLEADER_BLOCK,
  blockContentBox,
  multiLeaderMText,
  MLEADER_MTEXT,
} from '../../edit/mleader';
import {
  alignMultiLeaders,
  collectMultiLeaders,
  distributeMultiLeaders,
  moveMultiLeaderContent,
  type AlignItem,
  type MLeaderAlignMode,
  type MLeaderCollectLayout,
} from '../../edit/mleader-align';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const MODE_NAMES: Readonly<Record<MLeaderAlignMode['kind'], string>> = {
  current: 'Use current spacing',
  parallel: 'make leader segments Parallel',
  spacing: 'specify Spacing',
  distribute: 'Distribute',
};

const keywordOf = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

/** The multileaders among the objects given, in the order given. */
function multiLeadersIn(ctx: CommandContext, ids: readonly EntityId[]): EntityId[] {
  return ids.filter((id) => ctx.model.entity(id)?.geom.kind === 'MULTILEADER');
}

const geomOf = (ctx: CommandContext, id: EntityId) =>
  ctx.model.entity(id)!.geom as MultiLeaderGeometry;

/** The box of a multileader's content: its text as the renderer measures it, or its block's. */
async function contentBox(ctx: CommandContext, g: MultiLeaderGeometry): Promise<Box | undefined> {
  if (g.contentType === MLEADER_MTEXT && g.text) {
    const r = await ctx.view.request({ op: 'textBox', text: multiLeaderMText(g.text) });
    return r.ok ? r.box : undefined;
  }
  if (g.contentType === MLEADER_BLOCK && g.block) return blockContentBox(ctx.model, g.block);
  return undefined;
}

async function itemsOf(ctx: CommandContext, ids: readonly EntityId[]): Promise<AlignItem[]> {
  const out: AlignItem[] = [];
  for (const id of ids) {
    const geom = geomOf(ctx, id);
    const box = await contentBox(ctx, geom);
    out.push({ geom, ...(box && { box }) });
  }
  return out;
}

/** "Select multileaders": the multileaders selected, in the order selected. */
async function* selectMultiLeaders(ctx: CommandContext): Sub<EntityId[]> {
  const a = yield ctx.prompt.selection({ message: 'Select multileaders', editable: true });
  const ids = (a as { readonly ids?: readonly EntityId[] }).ids ?? [];
  const found = multiLeadersIn(ctx, ids);
  if (ids.length > found.length) {
    const n = ids.length - found.length;
    ctx.message(`${n} ${n === 1 ? 'object was' : 'objects were'} not a multileader.`);
  }
  return found;
}

/** Moves each multileader's content by its move, in one change set. */
function moveAll(ctx: CommandContext, ids: readonly EntityId[], moves: readonly Vec2[]): void {
  ctx.edit((b) =>
    ids.forEach((id, i) => {
      const g = geomOf(ctx, id);
      const moved = moveMultiLeaderContent(g, moves[i]!);
      if (moved !== g) b.updateEntity(id, { geom: moved });
    }),
  );
}

export function mleaderAlignCommand(): CommandDef {
  let mode: MLeaderAlignMode = { kind: 'current' };
  let spacing = 0;

  return {
    name: 'MLEADERALIGN',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const ids: EntityId[] = yield* selectMultiLeaders(ctx);
      if (ids.length === 0) return;
      for (;;) {
        const shown = mode.kind === 'spacing' ? `Specify spacing (${mode.spacing})` : null;
        ctx.message(
          `Current mode: ${shown ?? MODE_NAMES[mode.kind].replace(/^\w/, (c) => c.toUpperCase())}`,
        );
        if (mode.kind === 'distribute') {
          const a = yield ctx.prompt.point({
            message: 'Specify first point or',
            options: ['Options'],
          });
          if (keywordOf(a) === 'Options') {
            const next: MLeaderAlignMode | undefined = yield* options(ctx);
            if (!next) return;
            continue;
          }
          if (a.kind !== 'point') return;
          const first = a.point;
          const b = yield ctx.prompt.point({
            message: 'Specify second point',
            rubberBand: { from: first },
          });
          if (b.kind !== 'point') return;
          const items = await itemsOf(ctx, ids);
          moveAll(ctx, ids, distributeMultiLeaders(items, first, b.point));
          return;
        }
        const a = yield ctx.prompt.selection({
          message: 'Select multileader to align to or',
          options: ['Options'],
          single: true,
        });
        if (keywordOf(a) === 'Options') {
          const next: MLeaderAlignMode | undefined = yield* options(ctx);
          if (!next) return;
          continue;
        }
        const picked = (a as { readonly ids?: readonly EntityId[] }).ids ?? [];
        if (picked.length === 0) return;
        const ref = picked[0]!;
        if (ctx.model.entity(ref)?.geom.kind !== 'MULTILEADER') {
          ctx.message('The object is not a multileader.');
          continue;
        }
        const all = ids.includes(ref) ? ids : [ref, ...ids];
        const origin = geomOf(ctx, ref).contentBase;
        const d = yield ctx.prompt.point({
          message: 'Specify direction',
          rubberBand: { from: origin },
        });
        if (d.kind !== 'point') return;
        const items = await itemsOf(ctx, all);
        moveAll(ctx, all, alignMultiLeaders(items, all.indexOf(ref), d.point, mode));
        return;
      }

      /** The Options prompt: the next mode, or undefined when cancelled. */
      async function* options(c: CommandContext): Sub<MLeaderAlignMode | undefined> {
        const o = yield c.prompt.keyword({
          message: 'Enter an option',
          options: [
            MODE_NAMES.distribute,
            MODE_NAMES.parallel,
            MODE_NAMES.spacing,
            MODE_NAMES.current,
          ],
          default: { kind: 'keyword', keyword: MODE_NAMES[mode.kind] },
        });
        const k = keywordOf(o);
        if (k === undefined) return undefined;
        if (k === MODE_NAMES.spacing) {
          const s = yield c.prompt.distance({
            message: 'Specify spacing',
            default: { kind: 'distance', value: spacing },
          });
          if (s.kind !== 'distance' || !(s.value >= 0)) return undefined;
          spacing = s.value;
          mode = { kind: 'spacing', spacing };
          return mode;
        }
        mode =
          k === MODE_NAMES.distribute
            ? { kind: 'distribute' }
            : k === MODE_NAMES.parallel
              ? { kind: 'parallel' }
              : { kind: 'current' };
        return mode;
      }
    },
  };
}

const LAYOUT_NAMES = ['Vertical', 'Horizontal', 'Wrap'] as const;

export function mleaderCollectCommand(): CommandDef {
  let layout: MLeaderCollectLayout = { kind: 'horizontal' };

  return {
    name: 'MLEADERCOLLECT',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const picked: EntityId[] = yield* selectMultiLeaders(ctx);
      if (picked.length === 0) return;
      const ids = picked.filter((id) => {
        const g = geomOf(ctx, id);
        return g.contentType === MLEADER_BLOCK && g.block?.block !== undefined;
      });
      if (ids.length < picked.length) {
        ctx.message('Only multileaders with block content are collected.');
      }
      if (ids.length < 2) {
        ctx.message('Select two or more multileaders with block content.');
        return;
      }
      for (;;) {
        const current =
          layout.kind === 'vertical'
            ? 'Vertical'
            : layout.kind === 'horizontal'
              ? 'Horizontal'
              : 'Wrap';
        const a = yield ctx.prompt.point({
          message: 'Specify collected multileader location or',
          options: [...LAYOUT_NAMES],
          default: { kind: 'keyword', keyword: current },
        });
        const k = keywordOf(a);
        if (k === 'Vertical' || k === 'Horizontal') {
          layout = { kind: k === 'Vertical' ? 'vertical' : 'horizontal' };
          continue;
        }
        if (k === 'Wrap') {
          const w = yield ctx.prompt.distance({
            message: 'Specify wrap width or',
            options: ['Number'],
          });
          if (keywordOf(w) === 'Number') {
            const n = yield ctx.prompt.integer({
              message: 'Enter the maximum number of blocks per row',
              ...(layout.kind === 'number' && {
                default: { kind: 'number', value: layout.perRow },
              }),
            });
            if (n.kind !== 'number') return;
            if (n.value < 1) {
              ctx.message('Requires an integer of 1 or more.');
              continue;
            }
            layout = { kind: 'number', perRow: n.value };
            continue;
          }
          if (w.kind !== 'distance') return;
          if (!(w.value > 0)) {
            ctx.message('Requires a width greater than 0.');
            continue;
          }
          layout = { kind: 'wrap', width: w.value };
          continue;
        }
        if (a.kind !== 'point') return;
        const items = await itemsOf(ctx, ids);
        const placed = collectMultiLeaders(items, a.point, layout);
        ctx.edit((b) => ids.forEach((id, i) => b.updateEntity(id, { geom: placed[i]! })));
        return;
      }
    },
  };
}

export const MLEADER_ALIGN_COMMANDS = [mleaderAlignCommand, mleaderCollectCommand];
