// Regeneration of the dimensions an edit changed (M2-10 part 3): their blocks rewritten by the
// dimension engine the bus was given (`ctx.dimensions`), in the same command, so one undo takes
// back the edit and the regeneration together. The engine worker has no fonts: the texts are
// measured by the canvas (`textWidths`), each once, and drawing is tried again with the widths
// it asked for until nothing is missing (a dimension measures its main text and, for some
// rules, a second one).
import type { MTextGeometry } from '../../model/types';
import type { EntityId } from '../../model/entity-ids';
import type { TextMeasure } from '../../annotation/tolerance';
import { writeDimensionBlock, type RegeneratedParts } from '../../edit/dimension-block';
import { AnonymousNames } from '../../edit/edit';
import type { CommandContext } from '../command';

/** Measuring rounds before giving up: a dimension asks for at most a few texts in turn. */
const ROUNDS = 4;

/**
 * Rewrites the blocks of the dimensions `ids` as the dimension engine draws them now. Says on
 * the command line how many could not be (no dimension engine, no canvas, a font not loaded),
 * which keep the graphics carried with them. Returns what each regenerated one draws.
 */
export async function regenerateDimensions(
  ctx: CommandContext,
  ids: readonly EntityId[],
): Promise<ReadonlyMap<EntityId, RegeneratedParts>> {
  const drawn = new Map<EntityId, RegeneratedParts>();
  if (ids.length === 0) return drawn;
  const regenerate = ctx.dimensions;
  if (regenerate) {
    const widths = new Map<string, number | undefined>();
    for (let round = 0; round < ROUNDS; round++) {
      const missing = new Map<string, MTextGeometry>();
      const measure: TextMeasure = (t) => {
        const key = JSON.stringify(t);
        if (widths.has(key)) return widths.get(key);
        missing.set(key, t);
        return undefined;
      };
      for (const id of ids) {
        const e = ctx.model.entity(id);
        if (!e || drawn.has(id)) continue;
        const r = regenerate(e, ctx.model, measure);
        if (r) drawn.set(id, r);
      }
      if (missing.size === 0) break;
      const texts = [...missing.values()];
      const reply = await ctx.view.request({ op: 'textWidths', texts });
      const got = reply.ok ? reply.widths : undefined;
      [...missing.keys()].forEach((key, i) => widths.set(key, got?.[i] ?? undefined));
    }
  }
  if (drawn.size > 0) {
    ctx.edit((b) => {
      const names = new AnonymousNames(ctx.model);
      for (const [id, r] of drawn) writeDimensionBlock(b, ctx.model, id, r, names);
    });
  }
  const left = ids.filter((id) => ctx.model.entity(id) && !drawn.has(id)).length;
  if (left > 0) {
    ctx.message(
      `${left} ${left === 1 ? 'dimension was' : 'dimensions were'} not regenerated (its text cannot be measured).`,
    );
  }
  return drawn;
}
