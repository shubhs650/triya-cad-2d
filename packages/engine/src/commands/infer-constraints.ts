// Infer Constraints as a command ends (M9-05 part 7; AutoCAD 2024 Help, "About Inferring
// Geometric Constraints"): while CONSTRAINTINFER is 1 (the status bar's Infer Constraints,
// Ctrl+Shift+I, the Constraint Settings' "Infer geometric constraints"), the objects the
// outermost command made (and, part 8, those MOVE, COPY, STRETCH, FILLET and CHAMFER edited) take the constraints `inferredConstraints` finds from the points it was
// given by object snaps, in the command's own undo step, silently as AutoCAD applies them, their
// bars shown as an applied constraint's are. The app keeps the variable per user, as AutoCAD keeps
// it in the registry (initially 0), and tells each drawing's engine (the session's `sysvar`
// edit, `PromptBus.setConstraintInfer`), so a command ending asks the app nothing.
import type { ChangeSet } from '../model/changeset';
import type { EntityId } from '../model/entity-ids';
import type { Entity } from '../model/types';
import type { CommandContext } from './command';
import { applyGeometricConstraints } from './autoconstrain';
import { toleranceOf } from './constraints';
import {
  INFERS_EDITED,
  INFERS_ITSELF,
  INFERS_NOTHING,
  inferredConstraints,
  takesConstraints,
  type SnappedPoint,
} from '../edit/infer-constraints';

/**
 * The objects `changes` added that are still there, in the order they were made, and those it
 * edited (part 8: MOVE, STRETCH, FILLET's and CHAMFER's trimmed objects), as they are now.
 */
function touchedBy(
  ctx: CommandContext,
  changes: readonly ChangeSet[],
): { added: Entity[]; edited: Entity[] } {
  const added: Entity[] = [];
  const edited: Entity[] = [];
  const seen = new Set<EntityId>();
  const take = (id: EntityId, into: Entity[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    const now = ctx.model.entity(id);
    if (!now || now.owner !== ctx.space || !takesConstraints(now)) return;
    if (ctx.model.tables.layers.get(now.layer)?.locked === true) return;
    into.push(now);
  };
  for (const cs of changes) {
    for (const { entity } of cs.entities?.added ?? []) take(entity.id, added);
  }
  for (const cs of changes) {
    for (const { after } of cs.entities?.updated ?? []) take(after.id, edited);
  }
  return { added, edited };
}

/**
 * Infers the constraints of what command `name` made (`changes`) from the snapped points it was
 * given (`snaps`); the bus calls it while CONSTRAINTINFER is on.
 */
export async function inferConstraints(
  ctx: CommandContext,
  name: string,
  changes: readonly ChangeSet[],
  snaps: readonly SnappedPoint[],
): Promise<void> {
  if (INFERS_NOTHING.has(name)) return;
  if (snaps.length === 0 && !INFERS_ITSELF.has(name)) return;
  const { added, edited: all } = touchedBy(ctx, changes);
  const edited = INFERS_EDITED.has(name) ? all : [];
  if (added.length === 0 && edited.length === 0) return;
  const candidates = inferredConstraints({
    command: name,
    added,
    edited,
    snaps,
    entity: (id) => ctx.model.entity(id),
    // The drawing's tolerance over the objects made and those snapped to.
    tol: toleranceOf(ctx, [
      ...[...added, ...edited].map((e) => ({ entity: e.handle })),
      ...snaps.flatMap((s) => {
        const target = ctx.model.entity(s.id);
        return target ? [{ entity: target.handle }] : [];
      }),
    ]),
  });
  if (candidates.length === 0) return;
  let solver;
  try {
    solver = await ctx.constraints?.();
  } catch (e) {
    ctx.message(`The constraint solver could not load: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!solver) return;
  const applied = applyGeometricConstraints(ctx, candidates, solver);
  if (applied.length === 0) return;
  const entities = [...new Set(applied.flatMap((c) => c.refs.map((r) => r.entity)))];
  await ctx.view.request({ op: 'constraintBars', action: 'applied', entities });
}
