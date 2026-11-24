// CONSTRAINTBAR and DELCONSTRAINT (M9-05 part 2).
//
// CONSTRAINTBAR (AutoCAD 2024 Help, "CONSTRAINTBAR (Command)": "Displays or hides the geometric
// constraints on an object"): Select Objects, then Show, Hide or Reset. The Parametric tab's
// Show All and Hide All show or hide every bar ("To Display all Geometric Constraints": "Click
// Parametric tab > Geometric panel > Show All"); the Help gives no command line for them, and
// CONSTRAINTBARDISPLAY's page speaks of "CONSTRAINTBAR = Showall", so Triya offers them as the
// selection prompt's options, Showall and Hideall, which the ribbon types. Reset "displays
// constraint bars ... and resets them to their default locations": bars cannot be dragged yet,
// so it shows the selected objects' bars, as Show does. Which bars show is the app's display
// state of the drawing, not an edit (`constraint-bars.ts` in edit/).
//
// DELCONSTRAINT (AutoCAD 2024 Help, "DELCONSTRAINT (Command)": "Removes all geometric and
// dimensional constraints from a selection set of objects. The number of constraints removed
// are displayed on the command line."): every constraint any of whose references names an
// object selected, one undo step; a dimensional constraint's parameter that other expressions
// name leaves them its value, as the Parameters Manager's delete does (M9-10).
import type { CommandContext, CommandDef } from './command';
import type { PromptAnswer } from './prompt';
import { dropConstraints } from './constraint-upkeep';
import { constrainedObjects } from '../edit/constraint-bars';
import { dimensionalConstraints, geometricConstraints } from '../edit/constraints';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';

/** The handles of the objects a selection answered (none when Enter ended it at once). */
function handlesOf(ctx: CommandContext, a: PromptAnswer): Set<Handle> {
  const ids = (a as { ids?: readonly EntityId[] }).ids ?? [];
  const out = new Set<Handle>();
  for (const id of ids) {
    const e = ctx.model.entity(id);
    if (e) out.add(e.handle);
  }
  return out;
}

/** The app shows or hides the bars of `entities`, saying why not where it cannot. */
async function bars(
  ctx: CommandContext,
  action: 'show' | 'hide',
  entities: readonly Handle[],
): Promise<void> {
  const r = await ctx.view.request({ op: 'constraintBars', action, entities });
  if (!r.ok) ctx.message(r.message);
}

export function constraintBarCommand(): CommandDef {
  return {
    name: 'CONSTRAINTBAR',
    usesSelection: 'during',
    async *run(ctx) {
      const s = yield ctx.prompt.selection({
        message: 'Select objects or',
        options: ['Showall', 'Hideall'],
      });
      if (s.kind === 'keyword') {
        await bars(ctx, s.keyword === 'Hideall' ? 'hide' : 'show', constrainedObjects(ctx.model));
        return;
      }
      const picked = handlesOf(ctx, s);
      if (picked.size === 0) return;
      const constrained = constrainedObjects(ctx.model).filter((h) => picked.has(h));
      if (constrained.length === 0) {
        ctx.message('No geometric constraints are associated with the objects selected.');
        return;
      }
      const a = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['Show', 'Hide', 'Reset'],
        default: { kind: 'keyword', keyword: 'Show' },
      });
      // A default: Enter answers Show, so the answer is a keyword.
      const hide = (a as { keyword: string }).keyword === 'Hide';
      await bars(ctx, hide ? 'hide' : 'show', constrained);
    },
  };
}

export function delConstraintCommand(): CommandDef {
  return {
    name: 'DELCONSTRAINT',
    usesSelection: 'during',
    // Removing constraints is no edit of the geometry the upkeep would follow.
    solvesConstraints: true,
    async *run(ctx) {
      const s = yield ctx.prompt.selection({ message: 'Select objects' });
      const picked = handlesOf(ctx, s);
      if (picked.size === 0) return;
      const on = <C extends { refs: readonly { entity: Handle }[] }>(c: C) =>
        c.refs.some((r) => picked.has(r.entity));
      const geometric = geometricConstraints(ctx.model).filter(on);
      const dimensional = dimensionalConstraints(ctx.model).filter(on);
      const n = geometric.length + dimensional.length;
      if (n > 0) await dropConstraints(ctx, [...geometric, ...dimensional]);
      ctx.message(`${n} constraint${n === 1 ? '' : 's'} removed.`);
    },
  };
}

/**
 * A constraint bar icon's Delete (M9-05 part 4: its shortcut menu, or Delete with the cursor on
 * it): the geometric constraints `handles` name go, as DELCONSTRAINT removes them, one undo
 * step, the geometry left as it is. AutoCAD 2024 Help, "About Displaying and Verifying Geometric
 * Constraints": a constraint icon's shortcut menu deletes it. A handle that names no constraint
 * (one gone since the cursor rested on it) is passed over; nothing is said on the command line,
 * as the app's palette edits say nothing.
 */
export function deleteConstraintsCommand(handles: readonly Handle[]): CommandDef {
  return {
    name: 'DELCONSTRAINT',
    usesSelection: 'none',
    keepsSelection: true,
    solvesConstraints: true,
    // eslint-disable-next-line require-yield -- the app named the constraints
    async *run(ctx) {
      const named = new Set(handles);
      const gone = geometricConstraints(ctx.model).filter((c) => named.has(c.handle));
      if (gone.length > 0) await dropConstraints(ctx, gone);
    },
  };
}
