// DCDISPLAY (M9-03 part 7) with AutoCAD 2024's prompts (AutoCAD 2024 Help, "DCDISPLAY (Command)":
// "Displays or hides the dynamic constraints associated with a selection set of objects"):
//   Select objects:
//   Enter an option [Show/Hide] <Show>:
// Each dynamic constraint keeps its own Show or Hide (`DimensionalConstraintObject.hidden`, saved,
// DEC-084); the Parametric tab's Show Dynamic Constraints still hides them all, and a hidden one
// shows while an object it constrains is selected (DYNCONSTRAINTMODE 1). A constraint is
// "associated with" an object when any of its references names it. Annotational constraints are
// shown and hidden by their layer, as dimensions are, and DCDISPLAY leaves them as they are.
import type { CommandDef } from './command';
import type { PromptAnswer } from './prompt';
import { dimensionalConstraints } from '../edit/constraints';
import type { EntityId } from '../model/entity-ids';
import type { NonGraphicalObject } from '../model/types';
import type { RecordPatch } from '../model/update';

/** A selection prompt answers the selection (none when Enter ends it at once). */
const selected = (a: PromptAnswer): readonly EntityId[] => (a as { ids: readonly EntityId[] }).ids;

export function dcdisplayCommand(): CommandDef {
  return {
    name: 'DCDISPLAY',
    usesSelection: 'during',
    async *run(ctx) {
      const s = yield ctx.prompt.selection({ message: 'Select objects' });
      const ids = selected(s);
      if (ids.length === 0) return;
      const a = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['Show', 'Hide'],
        default: { kind: 'keyword', keyword: 'Show' },
      });
      // A default: Enter answers Show, so the answer is a keyword.
      const hide = (a as { keyword: string }).keyword === 'Hide';
      const handles = new Set<string>();
      for (const id of ids) {
        const e = ctx.model.entity(id);
        if (e) handles.add(e.handle);
      }
      const dynamic = dimensionalConstraints(ctx.model).filter(
        (c) => c.form === 'dynamic' && c.refs.some((r) => handles.has(r.entity)),
      );
      if (dynamic.length === 0) {
        ctx.message('No dynamic constraints are associated with the objects selected.');
        return;
      }
      const changed = dynamic.filter((c) => (c.hidden === true) !== hide);
      if (changed.length === 0) return;
      ctx.edit((b) => {
        for (const c of changed) {
          b.updateObject(c.handle, {
            hidden: hide ? true : undefined,
          } as RecordPatch<NonGraphicalObject>);
        }
      });
    },
  };
}
