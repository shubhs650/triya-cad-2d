// AUTOCONSTRAIN and CONSTRAINTSETTINGS (M9-05 part 3).
//
// AUTOCONSTRAIN (AutoCAD 2024 Help, "AUTOCONSTRAIN (Command)"): "Select objects or [Settings]";
// the objects selected take the geometric constraints the AutoConstrain tab applies, in its
// order, within its tolerances (`autoConstraints`, edit/autoconstrain.ts). Each is solved with
// the drawing's others as GEOMCONSTRAINT solves one; one the constraints already applied make
// redundant, or that the geometry cannot take, is skipped. All of it is one undo step, and the
// command line says how many were applied. The Help gives no message; Triya says "n constraints
// applied to m objects." (m the objects the constraints name). Settings opens the Constraint
// Settings dialog on its AutoConstrain tab, then asks again. GCCOINCIDENT's Autoconstrain (the
// Help's "Selects multiple points and applies coincident constraints to them") is the same with
// only Coincident.
//
// CONSTRAINTSETTINGS (CSETTINGS; "CONSTRAINTSETTINGS (Command)": "Controls the display of
// geometric constraints on constraint bars") opens the dialog on the tab shown last. What it sets
// is the user's (the bars' kinds and display, the dimensional constraints' name format, the
// AutoConstrain tab), kept by the app as AutoCAD keeps it in the registry: the dialog sets it
// itself on OK and the drawing is not edited, as DSETTINGS. It runs transparently, as AutoCAD's
// does ('CSETTINGS).
import type { CommandContext, CommandDef, CommandGenerator } from './command';
import type { ConstraintSettingsTab } from './prompt';
import { sentence, setExpressions, toleranceOf } from './constraints';
import {
  AUTOCONSTRAIN_DEFAULTS,
  autoConstraints,
  autoConstrainSettingsOf,
  type AutoConstrainSettings,
} from '../edit/autoconstrain';
import {
  geometricConstraints,
  parameterObjects,
  type ConstraintSolver,
  type ExpressionChange,
} from '../edit/constraints';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  ConstraintRef,
  Entity,
  GeometricConstraintObject,
  ParameterObject,
} from '../model/types';

/** Opens the Constraint Settings dialog on `tab` and waits until it closes. */
async function* constraintSettings(ctx: CommandContext, tab?: ConstraintSettingsTab) {
  yield ctx.prompt.dialog({
    message: 'Constraint Settings',
    dialog: { type: 'csettings', ...(tab && { tab }) },
  });
}

export function constraintSettingsCommand(): CommandDef {
  return {
    name: 'CONSTRAINTSETTINGS',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      yield* constraintSettings(ctx);
    },
  };
}

/** The user's AutoConstrain settings, which the app keeps; the defaults where it keeps none. */
async function settingsOf(ctx: CommandContext): Promise<AutoConstrainSettings> {
  const r = await ctx.view.request({ op: 'autoConstrain' });
  return r.ok && r.autoConstrain
    ? autoConstrainSettingsOf(r.autoConstrain)
    : AUTOCONSTRAIN_DEFAULTS;
}

/** The solver, or undefined having said why there is none. */
async function solverOf(ctx: CommandContext): Promise<ConstraintSolver | undefined> {
  try {
    const solver = await ctx.constraints?.();
    if (!solver) ctx.message('Geometric constraints are not available here.');
    return solver;
  } catch (e) {
    ctx.message(`The constraint solver could not load: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/** The same references, in any order. */
const sameRefs = (a: readonly ConstraintRef[], b: readonly ConstraintRef[]) => {
  const key = (r: ConstraintRef) => JSON.stringify(Object.entries(r).sort());
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
};

/**
 * Applies the constraints `settings` finds among `ids`, one at a time, skipping what the solver
 * refuses: one edit, one undo step. Objects on locked layers are left out, as a pick of one is.
 */
export async function autoConstrain(
  ctx: CommandContext,
  ids: readonly EntityId[],
  settings: AutoConstrainSettings,
): Promise<void> {
  const entities = ids
    .map((id) => ctx.model.entity(id))
    .filter((e): e is Entity => e !== undefined && e.owner === ctx.space)
    .filter((e) => ctx.model.tables.layers.get(e.layer)?.locked !== true);
  const candidates = autoConstraints(entities, settings);
  if (candidates.length === 0) {
    ctx.message('No constraints applied.');
    return;
  }
  const solver = await solverOf(ctx);
  if (!solver) return;
  const owner = ctx.model.meta.rootDictionary ?? '0';
  const constraints: GeometricConstraintObject[] = geometricConstraints(ctx.model);
  const moved = new Map<Handle, Entity>();
  const lookup = (h: Handle) => moved.get(h) ?? ctx.model.entityByHandle(h);
  let parameters: ParameterObject[] = parameterObjects(ctx.model);
  const expressions = new Map<string, string>();
  const applied: GeometricConstraintObject[] = [];
  for (const c of candidates) {
    if (constraints.some((o) => o.kind === c.kind && sameRefs(o.refs, c.refs))) continue;
    // A handle of its own for the solver to tell it from the others by; the edit allocates the
    // real one.
    const constraint: GeometricConstraintObject = {
      handle: `AC${applied.length.toString(16).toUpperCase()}`,
      type: 'TRIYA_GEOMCONSTRAINT',
      owner,
      kind: c.kind,
      refs: c.refs,
    };
    const r = solver.add(constraints, constraint, lookup, toleranceOf(ctx, c.refs), parameters);
    if (!r.ok) continue;
    for (const u of r.updated) moved.set(u.after.handle, u.after);
    for (const x of r.expressions ?? []) expressions.set(x.parameter, x.expression);
    parameters = parameters.map((p) => {
      const expression = expressions.get(p.parameter);
      return expression === undefined ? p : { ...p, expression };
    });
    constraints.push(constraint);
    applied.push(constraint);
  }
  const objects = [...new Set(applied.flatMap((c) => c.refs.map((r) => r.entity)))];
  if (applied.length) {
    const changes: ExpressionChange[] = [...expressions].map(([parameter, expression]) => ({
      parameter,
      expression,
    }));
    ctx.edit((b) => {
      for (const e of moved.values()) b.updateEntity(e.id, { geom: e.geom });
      setExpressions(ctx, b, changes);
      for (const c of applied) {
        b.addObject({ type: 'TRIYA_GEOMCONSTRAINT', owner, kind: c.kind, refs: c.refs } as Omit<
          GeometricConstraintObject,
          'handle'
        >);
      }
    });
  }
  const n = applied.length;
  const m = objects.length;
  ctx.message(
    n === 0
      ? 'No constraints applied.'
      : sentence(
          `${n} constraint${n === 1 ? '' : 's'} applied to ${m} object${m === 1 ? '' : 's'}`,
        ),
  );
  if (n) await ctx.view.request({ op: 'constraintBars', action: 'applied', entities: objects });
}

export function autoconstrainCommand(): CommandDef {
  return {
    name: 'AUTOCONSTRAIN',
    usesSelection: 'during',
    solvesConstraints: true,
    async *run(ctx): CommandGenerator {
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select objects or',
          options: ['Settings'],
        });
        if (a.kind === 'keyword') {
          if (a.keyword === 'Settings') yield* constraintSettings(ctx, 'autoconstrain');
          continue;
        }
        const ids = (a as { ids?: readonly EntityId[] }).ids ?? [];
        if (ids.length === 0) return;
        await autoConstrain(ctx, ids, await settingsOf(ctx));
        return;
      }
    },
  };
}

/** GCCOINCIDENT's Autoconstrain: the objects selected, Coincident only. */
export async function* coincidentAutoconstrain(ctx: CommandContext): CommandGenerator {
  const a = yield ctx.prompt.selection({ message: 'Select objects' });
  const ids = (a as { ids?: readonly EntityId[] }).ids ?? [];
  if (ids.length === 0) return;
  const settings = await settingsOf(ctx);
  await autoConstrain(ctx, ids, {
    ...settings,
    order: [{ kind: 'coincident', apply: true }],
  });
}
