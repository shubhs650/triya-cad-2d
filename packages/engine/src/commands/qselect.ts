// QSELECT (M3-04 part 2): AutoCAD 2024's Quick Select (AutoCAD Help, "QSELECT (Command)",
// "Quick Select Dialog Box"). It opens on the objects selected at `Command:` when there are any
// (Apply to: Current selection), the entire drawing otherwise. "Select objects" closes the
// dialog for a fresh selection and opens it again applying to that. OK selects what the
// criteria take, leaving it selected and gripped at `Command:`, and says how many; Cancel
// changes nothing.
import type { CommandDef } from './command';
import type { PromptAnswer } from './prompt';
import { propertyUnits } from '../properties/sheet';
import {
  DEFAULT_QSELECT,
  quickSelect,
  quickSelectCandidates,
  quickSelectTypes,
  type QuickSelectCriteria,
} from '../selection/qselect';
import { selectAll } from '../selection/rules';

export function qselectCommand(): CommandDef {
  return {
    name: 'QSELECT',
    usesSelection: 'before',
    keepsSelection: true,
    async *run(ctx) {
      let selected = [...ctx.preselected];
      let criteria: QuickSelectCriteria = {
        ...DEFAULT_QSELECT,
        applyTo: selected.length > 0 ? 'selection' : 'drawing',
      };
      for (;;) {
        const a = (yield ctx.prompt.dialog({
          message: 'Quick Select',
          dialog: {
            type: 'qselect',
            criteria,
            selected: selected.length,
            drawing: quickSelectTypes(ctx.model, selectAll(ctx.model, ctx.space)),
            selection: quickSelectTypes(ctx.model, selected),
            units: propertyUnits(ctx.model),
          },
        })) as Extract<PromptAnswer, { kind: 'dialog' }>;
        criteria = a.qselect ?? criteria;
        if (a.action !== 'select') break;
        // A selection of its own, not the pre-selection the command opened on.
        const s = yield ctx.prompt.selection({ message: 'Select objects', pickfirst: false });
        if (s.kind === 'selection' && s.ids.length > 0) {
          selected = [...s.ids];
          criteria = { ...criteria, applyTo: 'selection' };
        }
      }
      const candidates = quickSelectCandidates(ctx.model, ctx.space, selected, criteria);
      const found = quickSelect(ctx.model, candidates, criteria);
      const ids = criteria.append ? [...new Set([...selected, ...found])] : found;
      ctx.select(ids);
      ctx.message(`${ids.length} item(s) selected.`);
    },
  };
}
