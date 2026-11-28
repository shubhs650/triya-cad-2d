// The Properties palette's edits of dimensional constraints (M9-03 part 10): the Constraint
// rows `properties/sheet.ts` shows for the constraints selected at `Command:`. Each edit is one
// undo step the command line does not echo, as the palette's edits of objects are.
//
// AutoCAD 2024 Help, "About Applying Dimensional Constraints": "You can set the Reference
// property in the Properties palette to convert a dynamic or annotational constraint to a
// reference parameter", "You cannot change a reference parameter back to a dimensional
// constraint if doing so would overconstrain the geometry", and "use the Properties palette to
// change dynamic constraints to annotational constraints" (and back). "To Edit a Dimensional
// Constraint Using the Properties Palette": the name, expression and description are edited
// there as in the Parameters Manager (`parameters.ts`), whose rename and expression edits these
// are.
//
// An annotational constraint's Dim style and DIMVAR rows (M9-03 part 15, DEC-088) set its style
// and its own DIMVARs, as a dimension's rows set its style and `DSTYLE` overrides; "Annotational
// constraints display using the current dimension style", which one made (or turned)
// annotational takes. A dynamic one has no such rows: the palette shows them only when every
// constraint shown is annotational.
import type { CommandContext, CommandDef } from './command';
import { applyParameterEdit } from './parameters';
import { sentence, setExpressions } from './constraints';
import { toleranceFor } from './modify/offset';
import {
  dimensionalConstraints,
  geometricConstraints,
  parameterObjects,
} from '../edit/constraints';
import type { Handle } from '../model/handle';
import type { DimensionalConstraintObject, NonGraphicalObject } from '../model/types';
import type { RecordPatch } from '../model/update';
import type { PropertyEdit } from '../properties/edit';
import { DIMVAR_DEFAULTS, DIMVAR_ROWS } from '../properties/dimension';
import type { PropertyValue } from '../properties/sheet';
import {
  constraintDimvars,
  isConstraintDimvar,
  newConstraintStyle,
} from '../edit/constraint-style';

/** The edit `edit` of the Constraint rows, on the constraints `handles`, as a bus command. */
export function constraintPropertyCommand(
  handles: readonly Handle[],
  edit: PropertyEdit,
): CommandDef {
  return {
    name: 'PROPERTIES',
    usesSelection: 'none',
    keepsSelection: true,
    solvesConstraints: true,
    // eslint-disable-next-line require-yield -- the palette gave the value
    async *run(ctx) {
      await applyConstraintProperty(ctx, handles, edit);
    },
  };
}

async function applyConstraintProperty(
  ctx: CommandContext,
  handles: readonly Handle[],
  edit: PropertyEdit,
): Promise<void> {
  const named = new Set(handles);
  const shown = dimensionalConstraints(ctx.model).filter((c) => named.has(c.handle));
  if (shown.length === 0) return;
  const text = typeof edit.value === 'string' ? edit.value : String(edit.value);
  const patch = (c: DimensionalConstraintObject, p: RecordPatch<DimensionalConstraintObject>) =>
    ctx.edit((b) => b.updateObject(c.handle, p as RecordPatch<NonGraphicalObject>));
  switch (edit.key) {
    case 'constraint-form': {
      if (text !== 'dynamic' && text !== 'annotational') return;
      for (const c of shown) {
        if (c.form === text) continue;
        // Made annotational, it takes the current dimension style unless it kept one (DEC-088).
        const style = text === 'annotational' && c.style === undefined;
        patch(c, { form: text, ...(style && newConstraintStyle(ctx.model)) });
      }
      return;
    }
    case 'constraint-dimStyle': {
      if (!ctx.model.tables.dimStyles.has(text)) return;
      for (const c of shown) {
        if (c.form === 'annotational' && c.style !== text) patch(c, { style: text });
      }
      return;
    }
    case 'constraint-description': {
      const description = text.trim();
      for (const c of shown) {
        if ((c.description ?? '') === description) continue;
        patch(c, { description: description === '' ? undefined : description });
      }
      return;
    }
    case 'constraint-name':
      // One parameter's: the sheet shows the row read only for several.
      if (shown.length !== 1) return;
      return applyParameterEdit(ctx, { kind: 'rename', name: shown[0]!.parameter, to: text });
    case 'constraint-expression':
      if (shown.length !== 1) return;
      return applyParameterEdit(ctx, {
        kind: 'expression',
        name: shown[0]!.parameter,
        expression: text,
      });
    case 'constraint-reference': {
      if (text !== 'yes' && text !== 'no') return;
      return setReference(ctx, shown, text === 'yes');
    }
    default:
      if (edit.key.startsWith('dimvar:')) setDimvar(ctx, shown, edit.key.slice(7), edit.value);
      return;
  }
}

/**
 * Sets DIMVAR `name` (one of those a constraint draws with) of the annotational constraints of
 * `cs` to `value`, as the dimension's row of it takes a value (M9-03 part 15): kept as the
 * constraint's own over its style's; a value the row refuses changes nothing.
 */
function setDimvar(
  ctx: CommandContext,
  cs: readonly DimensionalConstraintObject[],
  name: string,
  value: PropertyValue,
): void {
  const row = DIMVAR_ROWS.find((r) => r.name === name);
  if (!row || !isConstraintDimvar(name)) return;
  for (const c of cs) {
    if (c.form !== 'annotational') continue;
    const vars = { ...DIMVAR_DEFAULTS, ...constraintDimvars(ctx.model, c) };
    const n = row.set(value, vars, ctx.model)?.[name];
    if (typeof n !== 'number') return;
    if (c.dimvars?.[name] === n) continue;
    ctx.edit((b) =>
      b.updateObject(c.handle, {
        dimvars: { ...c.dimvars, [name]: n },
      } as RecordPatch<NonGraphicalObject>),
    );
  }
}

/**
 * Makes each of `cs` a reference constraint, or a driving one, through the solver, each in
 * turn on the drawing the one before left; the first refusal is said and ends the edit, that
 * constraint and those after it left as they were.
 */
async function setReference(
  ctx: CommandContext,
  cs: readonly DimensionalConstraintObject[],
  reference: boolean,
): Promise<void> {
  const changing = cs.filter((c) => (c.reference === true) !== reference);
  if (changing.length === 0) return;
  let solver;
  try {
    solver = await ctx.constraints?.();
  } catch (e) {
    ctx.message(`The constraint solver could not load: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!solver) {
    ctx.message('Dimensional constraints are not available here.');
    return;
  }
  const lookup = (h: Handle) => ctx.model.entityByHandle(h);
  // The drawing's tolerance (DEC-036): the extents' size, as the modify commands take it.
  const tol = toleranceFor(ctx.model, { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
  for (const c of changing) {
    const r = solver.setReference(
      geometricConstraints(ctx.model),
      parameterObjects(ctx.model),
      c.handle,
      reference,
      lookup,
      tol,
    );
    if (!r.ok) {
      ctx.message(sentence(r.message));
      return;
    }
    ctx.edit((b) => {
      for (const moved of r.updated) b.updateEntity(moved.after.id, { geom: moved.after.geom });
      b.updateObject(c.handle, {
        reference: reference ? true : undefined,
      } as RecordPatch<NonGraphicalObject>);
      setExpressions(ctx, b, r.expressions);
    });
  }
}
