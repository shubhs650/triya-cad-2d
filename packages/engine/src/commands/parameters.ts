// PARAMETERS (PAR) and PARAMETERSCLOSE (M9-03 part 5): AutoCAD's Parameters Manager palette,
// which lists the drawing's dimensional constraints' parameters (Name, Expression, Value, Type,
// Description) and edits them. The palette is the app's; its edits come back here as
// `parameterEditCommand`s, each one undo step that the command line does not echo, as the
// Properties palette's edits.
//
// AutoCAD 2024 Help, "Parameters Manager": a parameter's Name and Expression are edited in
// place, the geometry following a new value; renaming a parameter renames it in every
// expression that uses it; a description is the user's note. Deleting a dimensional
// constraint's parameter deletes the constraint, and expressions that use it keep its value.
// A reference constraint's parameter shows what it measures and cannot be set.
//
// User parameters (part 6): the manager's New User Parameter adds user1 = 1 (then user2…, the
// lowest number no parameter has), a value or expression no constraint holds, which the
// constraints' expressions may name. It is edited, renamed and deleted as a constraint's
// parameter is, and deleting it leaves the expressions that used it with its value.
import type { CommandContext, CommandDef } from './command';
import { sentence, setExpressions } from './constraints';
import { viewRequest } from './view/zoom';
import { toleranceFor } from './modify/offset';
import {
  geometricConstraints,
  parameterObjects,
  type ConstraintSolver,
  type ParameterChangeResult,
} from '../edit/constraints';
import type { ChangeSetBuilder } from '../model/builder';
import type { NonGraphicalObject, UserParameterObject } from '../model/types';
import type { RecordPatch } from '../model/update';

/** An edit made in the Parameters Manager, on parameter `name`; `new` adds a user parameter. */
export type ParameterEdit =
  | { readonly kind: 'new' }
  | {
      readonly kind: 'expression';
      readonly name: string;
      readonly expression: string;
      /** The side of its constraint that adjusts: a triangular grip's (M9-03 part 11). */
      readonly side?: 'first' | 'second';
    }
  | { readonly kind: 'rename'; readonly name: string; readonly to: string }
  | { readonly kind: 'description'; readonly name: string; readonly description: string }
  | { readonly kind: 'delete'; readonly name: string };

function paletteCommand(name: string, open: boolean): CommandDef {
  return {
    name,
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the host opens or closes the palette
    async *run(ctx) {
      await viewRequest(ctx, { op: 'palette', palette: 'parameters', open });
    },
  };
}

export const PARAMETERS_COMMANDS: readonly (() => CommandDef)[] = [
  () => paletteCommand('PARAMETERS', true),
  () => paletteCommand('PARAMETERSCLOSE', false),
];

/** The palette's edit as a command the bus runs: one undo step, the constraints solved here. */
export function parameterEditCommand(edit: ParameterEdit): CommandDef {
  return {
    name: 'PARAMETERS',
    usesSelection: 'none',
    keepsSelection: true,
    solvesConstraints: true,
    // eslint-disable-next-line require-yield -- the palette gave the value
    async *run(ctx) {
      await applyParameterEdit(ctx, edit);
    },
  };
}

/** Applies `edit` to the drawing, or says why it cannot. */
export async function applyParameterEdit(ctx: CommandContext, edit: ParameterEdit): Promise<void> {
  const dims = parameterObjects(ctx.model);
  if (edit.kind === 'new') {
    newUserParameter(ctx, new Set(dims.map((d) => d.parameter)));
    return;
  }
  const own = dims.find((d) => d.parameter === edit.name);
  if (!own) {
    ctx.message(`No parameter named "${edit.name}".`);
    return;
  }
  if (edit.kind === 'description') {
    const description = edit.description.trim();
    if (description === (own.description ?? '')) return;
    ctx.edit((b) =>
      b.updateObject(own.handle, {
        description: description === '' ? undefined : description,
      } as RecordPatch<NonGraphicalObject>),
    );
    return;
  }
  const solver = await solverOf(ctx);
  if (!solver) return;
  let r: ParameterChangeResult;
  if (edit.kind === 'expression') {
    if (edit.expression.trim() === own.expression) return;
    const lookup = (h: string) => ctx.model.entityByHandle(h);
    // The drawing's tolerance (DEC-036): the extents' size, as the modify commands take it.
    const tol = toleranceFor(ctx.model, {
      kind: 'LINE',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    });
    r = solver.setExpression(
      geometricConstraints(ctx.model),
      dims,
      edit.name,
      edit.expression.trim(),
      lookup,
      tol,
      ...(edit.side ? [edit.side] : []),
    );
  } else if (edit.kind === 'rename') {
    if (edit.to.trim() === edit.name) return;
    r = solver.renameParameter(dims, edit.name, edit.to.trim());
  } else r = solver.deleteParameter(dims, edit.name);
  if (!r.ok) {
    ctx.message(sentence(r.message));
    return;
  }
  const done = r;
  ctx.edit((b: ChangeSetBuilder) => {
    for (const moved of done.updated) b.updateEntity(moved.after.id, { geom: moved.after.geom });
    if (edit.kind === 'rename') {
      b.updateObject(own.handle, { parameter: edit.to.trim() } as RecordPatch<NonGraphicalObject>);
    }
    if (edit.kind === 'delete') b.removeObject(own.handle);
    setExpressions(ctx, b, done.expressions);
  });
}

/**
 * AutoCAD's New User Parameter: user1 = 1, or the lowest number no parameter has. Nothing depends
 * on it yet, so nothing is solved.
 */
function newUserParameter(ctx: CommandContext, taken: ReadonlySet<string>): void {
  let n = 1;
  while (taken.has(`user${n}`)) n++;
  const owner = ctx.model.meta.rootDictionary ?? '0';
  ctx.edit((b) =>
    b.addObject({
      type: 'TRIYA_USERPARAMETER',
      owner,
      parameter: `user${n}`,
      expression: '1',
    } as Omit<UserParameterObject, 'handle'>),
  );
}

async function solverOf(ctx: CommandContext): Promise<ConstraintSolver | undefined> {
  try {
    const solver = await ctx.constraints?.();
    if (!solver) ctx.message('Dimensional constraints are not available here.');
    return solver;
  } catch (e) {
    ctx.message(`The constraint solver could not load: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}
