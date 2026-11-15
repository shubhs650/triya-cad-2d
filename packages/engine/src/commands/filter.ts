// FILTER (FI; M3-04 part 4), as AutoCAD 2024 runs it (AutoCAD Help, "FILTER (Command)", "To
// Create and Save a Selection Filter"): the Object Selection Filters dialog builds the filter
// (`selection/filter.ts`; the app keeps the named filters and the current one, as AutoCAD keeps
// them in filter.nfl), Add Selected Object closes it for "Select object" and adds that object's
// properties, and Apply asks "Select objects", keeping only what the filter takes.
//   - Typed transparently at "Select objects" ('FILTER), what it takes joins that selection.
//   - At `Command:` it makes the Previous set, as SELECT does; and as SELECT does with PICKADD 2,
//     it is left selected. Help says nothing of FILTER and PICKADD: Triya takes FILTER at
//     `Command:` for a SELECT with a filter.
import type { CommandContext, CommandDef } from './command';
import type { PromptAnswer } from './prompt';
import {
  applyFilter,
  filterNames,
  filterProblem,
  filterTypes,
  objectFilter,
  type FilterItem,
} from '../selection/filter';
import { DEFAULT_PICKADD, PICKADD } from '../selection/loop';

/** PICKADD as the app keeps it; AutoCAD's initial 2 when it tells none. */
export async function pickaddOf(ctx: CommandContext): Promise<number> {
  const r = await ctx.view.request({ op: 'sysvar', name: PICKADD });
  return r.ok && typeof r.value === 'number' ? r.value : DEFAULT_PICKADD;
}

export function filterCommand(): CommandDef {
  return {
    name: 'FILTER',
    transparent: true,
    usesSelection: 'during',
    async *run(ctx) {
      let list: readonly FilterItem[] | undefined;
      let name: string | undefined;
      for (;;) {
        const a = (yield ctx.prompt.dialog({
          message: 'Object Selection Filters',
          dialog: {
            type: 'filter',
            ...(list && { list }),
            ...(name !== undefined && { name }),
            names: filterNames(ctx.model),
            types: filterTypes(ctx.model, ctx.space),
          },
        })) as Extract<PromptAnswer, { kind: 'dialog' }>;
        list = a.filter?.list ?? list ?? [];
        name = a.filter?.name ?? name;
        if (a.action !== 'select') break;
        const s = yield ctx.prompt.selection({
          message: 'Select object',
          single: true,
          pickfirst: false,
        });
        const e = s.kind === 'selection' && s.ids[0] ? ctx.model.entity(s.ids[0]) : undefined;
        if (e) list = [...list, ...objectFilter(ctx.model, e)];
      }
      const problem = filterProblem(list);
      if (problem) return ctx.message(problem);
      ctx.message('Applying filter to selection.');
      const s = yield ctx.prompt.selection({ message: 'Select objects', pickfirst: false });
      const found = s.kind === 'selection' ? applyFilter(ctx.model, s.ids, list) : [];
      ctx.message('Exiting filtered selection.');
      if (ctx.addSelected(found)) return;
      ctx.message(`${found.length} found`);
      ctx.setPrevious(found);
      if (!ctx.transparent && found.length > 0 && (await pickaddOf(ctx)) === 2) ctx.select(found);
    },
  };
}
