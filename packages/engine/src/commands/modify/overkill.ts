// OVERKILL and -OVERKILL (M3-02 part 6), with AutoCAD 2024's prompts (AutoCAD Help, "Delete
// Duplicate Objects Dialog Box", "-OVERKILL (Command)"):
//
//   Select objects:
//   (OVERKILL: the Delete Duplicate Objects dialog; OK runs it, Cancel ends the command)
//   (-OVERKILL) Enter an option to change [Done/Ignore/tOlerance/optimize Plines/combine parTial
//               overlap/combine Endtoend/Associativity] <done>:
//   N duplicate(s) deleted
//   N overlapping object(s) or segment(s) deleted
//
// The settings are kept while the drawing is open, shared by the two forms. -OVERKILL's
// sub-prompts are not documented word for word: Ignore takes one property at a time (each
// toggles it; None clears them, All takes them all), the others ask Yes or No with the setting
// as the default. Objects on locked layers are left out. The geometry is `edit/overkill.ts`'s.
import { eraseObjects, reshapeObject } from '../../edit/edit';
import {
  DEFAULT_OVERKILL,
  OVERKILL_PROPERTIES,
  planOverkill,
  type OverkillProperty,
  type OverkillSettings,
} from '../../edit/overkill';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** -OVERKILL Ignore's keywords, by property. */
const IGNORE: Record<OverkillProperty, string> = {
  color: 'Color',
  layer: 'LAyer',
  linetype: 'Ltype',
  ltScale: 'Ltscale',
  lineweight: 'LWeight',
  thickness: 'Thickness',
  transparency: 'TRansparency',
  plotStyle: 'plotStyle',
  material: 'Material',
};

export function overkillCommand(): CommandDef {
  let settings: OverkillSettings = DEFAULT_OVERKILL;
  return {
    name: 'OVERKILL',
    dashVariant: true,
    usesSelection: 'before',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      const ids = (a as { ids: readonly number[] }).ids;
      if (ids.length === 0) return;
      if (ctx.dash) {
        settings = yield* dashSettings(ctx, settings);
      } else {
        const d = yield ctx.prompt.dialog({
          message: 'Delete Duplicate Objects',
          dialog: { type: 'overkill', settings },
        });
        settings = (d as { overkill?: OverkillSettings }).overkill ?? settings;
      }
      // In drawing order, as the space holds them.
      const chosen = new Set(ids);
      const order = ctx.model.blockEntities(ctx.space).filter((id) => chosen.has(id));
      const plan = planOverkill(ctx.model, order, settings);
      if (plan.erase.length > 0 || plan.reshape.size > 0) {
        ctx.edit((b) => {
          for (const [id, g] of plan.reshape) reshapeObject(b, ctx.model, id, [g]);
          eraseObjects(b, ctx.model, plan.erase);
        });
      }
      ctx.message(`${plan.duplicates} duplicate(s) deleted`);
      ctx.message(`${plan.overlaps} overlapping object(s) or segment(s) deleted`);
    },
  };
}

async function* yesNo(ctx: CommandContext, message: string, now: boolean): Sub<boolean> {
  const a = yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    defaultLabel: now ? 'Yes' : 'No',
  });
  return a.kind === 'keyword' ? a.keyword === 'Yes' : now;
}

async function* dashSettings(ctx: CommandContext, start: OverkillSettings): Sub<OverkillSettings> {
  let s = start;
  for (;;) {
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option to change',
      options: [
        'Done',
        'Ignore',
        'tOlerance',
        'optimize Plines',
        'combine parTial overlap',
        'combine Endtoend',
        'Associativity',
      ],
      defaultLabel: 'done',
    });
    const k = a.kind === 'keyword' ? a.keyword : 'Done';
    switch (k) {
      case 'Done':
        return s;
      case 'Ignore': {
        const options = ['None', 'All', ...OVERKILL_PROPERTIES.map((p) => IGNORE[p])];
        const i = yield ctx.prompt.keyword({
          message: 'Ignore property',
          options,
          defaultLabel: s.ignore.length === 0 ? 'None' : s.ignore.map((p) => IGNORE[p]).join(','),
        });
        if (i.kind !== 'keyword') break;
        if (i.keyword === 'None') s = { ...s, ignore: [] };
        else if (i.keyword === 'All') s = { ...s, ignore: [...OVERKILL_PROPERTIES] };
        else {
          const p = OVERKILL_PROPERTIES.find((x) => IGNORE[x] === i.keyword)!;
          const ignore = s.ignore.includes(p)
            ? s.ignore.filter((x) => x !== p)
            : OVERKILL_PROPERTIES.filter((x) => x === p || s.ignore.includes(x));
          s = { ...s, ignore };
        }
        break;
      }
      case 'tOlerance':
        for (;;) {
          const t = yield ctx.prompt.distance({
            message: 'Specify Tolerance',
            default: { kind: 'distance', value: s.tolerance },
          });
          const v = (t as { value: number }).value;
          if (v >= 0) {
            s = { ...s, tolerance: v };
            break;
          }
          ctx.message('Value must be positive or zero.');
        }
        break;
      case 'optimize Plines': {
        const on = yield* yesNo(ctx, 'Optimize segments within polylines?', s.optimizePolylines);
        s = { ...s, optimizePolylines: on };
        if (!on) break;
        const w = yield* yesNo(ctx, 'Ignore polyline segment widths?', s.ignoreWidths);
        const keep = yield* yesNo(ctx, 'Do not break polylines?', s.keepPolylines);
        s = { ...s, ignoreWidths: w, keepPolylines: keep };
        break;
      }
      case 'combine parTial overlap':
        s = {
          ...s,
          combinePartial: yield* yesNo(
            ctx,
            'Combine co-linear objects that partially overlap?',
            s.combinePartial,
          ),
        };
        break;
      case 'combine Endtoend':
        s = {
          ...s,
          combineEndToEnd: yield* yesNo(
            ctx,
            'Combine co-linear objects when aligned end to end?',
            s.combineEndToEnd,
          ),
        };
        break;
      default:
        s = {
          ...s,
          keepAssociative: yield* yesNo(ctx, 'Maintain associative objects?', s.keepAssociative),
        };
    }
  }
}
