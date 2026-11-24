// A selected dimensional constraint's grips and its text edited by a double click (M9-03 part
// 11; where the grips sit and what a drag sets: `edit/constraint-grips.ts`).
//
// AutoCAD 2024 Help, "To Change the Value of a Dimensional Constraint": select the constraint
// and click a triangular grip, then drag it (the value and the geometry follow), or "Double-
// click the constraint" and type a new value or expression ("name=expression" as at
// DIMCONSTRAINT's prompt). "About Applying Dimensional Constraints": the square grip moves the
// text and dimension line. A grip is made hot by a click and placed by the next, as an
// object's grip is in STRETCH (`modify/grips.ts`); Enter, eXit or Esc leaves it as it was. The
// Help shows the grip modes' cycle only for objects, so Enter here ends grip editing.
import type { CommandContext, CommandDef } from './command';
import { applyParameterEdit } from './parameters';
import { parseDimensionText } from './dimensional-constraints';
import {
  constraintGripValue,
  movedConstraintLocation,
  type ConstraintGrip,
} from '../edit/constraint-grips';
import { dimensionalConstraints } from '../edit/constraints';
import type { Handle } from '../model/handle';
import type { NonGraphicalObject } from '../model/types';
import type { RecordPatch } from '../model/update';

/** A value dragged, as its expression keeps it: a plain number to ten places, no trailing 0s. */
export function draggedValue(v: number): string {
  const s = v.toFixed(10).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/** Grip editing of constraint `handle`'s grip `grip`, made hot at `Command:`. */
export function constraintGripCommand(handle: Handle, grip: ConstraintGrip): CommandDef {
  return {
    name: 'GRIP',
    usesSelection: 'none',
    keepsSelection: true,
    solvesConstraints: true,
    async *run(ctx) {
      ctx.message('** STRETCH **');
      const a = yield ctx.prompt.point({
        message: 'Specify stretch point or',
        options: ['eXit'],
        rubberBand: { from: grip.point },
      });
      if (a.kind !== 'point') return;
      await placeGrip(ctx, handle, grip, a.point);
    },
  };
}

async function placeGrip(
  ctx: CommandContext,
  handle: Handle,
  grip: ConstraintGrip,
  to: { readonly x: number; readonly y: number },
): Promise<void> {
  const c = dimensionalConstraints(ctx.model).find((x) => x.handle === handle);
  if (!c) return;
  if (grip.role === 'location') {
    const location = movedConstraintLocation(ctx.model, handle, grip, to);
    if (!location) return;
    ctx.edit((b) => b.updateObject(handle, { location } as RecordPatch<NonGraphicalObject>));
    return;
  }
  const value = constraintGripValue(ctx.model, handle, grip, to);
  if (value === undefined) return;
  await applyParameterEdit(ctx, {
    kind: 'expression',
    name: c.parameter,
    expression: draggedValue(value),
    side: grip.role,
  });
}

/**
 * A double click on constraint `handle` at `Command:`: its text, `name=expression`, asked for
 * as DIMCONSTRAINT asks; a new name renames its parameter (in every expression naming it), a
 * new expression sets its value, one undo step. Enter keeps it as it is.
 */
export function constraintTextCommand(handle: Handle): CommandDef {
  return {
    name: 'TEXTEDIT',
    usesSelection: 'none',
    keepsSelection: true,
    solvesConstraints: true,
    async *run(ctx) {
      for (;;) {
        const c = dimensionalConstraints(ctx.model).find((x) => x.handle === handle);
        if (!c) return;
        const shown = `${c.parameter}=${c.expression}`;
        const a = yield ctx.prompt.string({
          message: 'Dimension text',
          spaces: true,
          default: { kind: 'string', value: shown },
        });
        if (a.kind !== 'string' || a.value.trim() === shown) return;
        const typed = parseDimensionText(a.value);
        if ('error' in typed) {
          ctx.message(typed.error);
          continue;
        }
        let name = c.parameter;
        if (typed.parameter !== undefined && typed.parameter !== name) {
          await applyParameterEdit(ctx, { kind: 'rename', name, to: typed.parameter });
          // Refused (a name taken, say): it said why; the text is asked for again.
          const now = dimensionalConstraints(ctx.model).find((x) => x.handle === handle);
          if (now?.parameter !== typed.parameter) continue;
          name = typed.parameter;
        }
        if (typed.expression !== undefined && typed.expression !== c.expression) {
          await applyParameterEdit(ctx, {
            kind: 'expression',
            name,
            expression: typed.expression,
          });
        }
        return;
      }
    },
  };
}
