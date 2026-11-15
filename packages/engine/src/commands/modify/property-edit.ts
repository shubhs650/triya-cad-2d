// A Properties palette edit as a command makes it (M2-35; shared with CHPROP and MATCHPROP in
// M3-02 part 5): the texts, multileaders and hatches the edit places again are measured or laid
// out by the app first, then every object takes the edit in one go, and what was refused is
// said on the command line as the palette says it.
import { addArrowheadBlock, arrowheadBlock } from '../../edit/arrowhead-blocks';
import { refusalMessages } from '../../edit/edit';
import type { EntityId } from '../../model/entity-ids';
import type { EntityGeometry, EntityType } from '../../model/types';
import {
  applyCurrentEdit,
  applyPropertyEdit,
  arrowheadByName,
  hatchesToPattern,
  multiLeaderTextsToMeasure,
  placedPatterns,
  textsToMeasure,
  type HatchPatterns,
  type PropertyEdit,
  type TextOutlines,
} from '../../properties/edit';
import type { MultiLeaderWidths } from '../../properties/multileader';
import { filtered } from '../../properties/sheet';
import type { CommandContext } from '../command';

/**
 * Sets `edit` on `ids` (those of type `filter`), or as the current setting when `ids` is empty,
 * measuring what it must first. One `ctx.edit`, besides an arrowhead block it adds.
 */
export async function applyProperty(
  ctx: CommandContext,
  ids: readonly EntityId[],
  edit: PropertyEdit,
  filter: EntityType | undefined,
): Promise<void> {
  const model = ctx.model;
  let report: ReturnType<typeof applyPropertyEdit> | undefined;
  const entities = filtered(model, ids, filter);
  // A text given another justification is measured where the canvas draws it first.
  const measure = textsToMeasure(entities, edit);
  let outlines: TextOutlines | undefined;
  if (measure.length > 0) {
    const texts = measure.map((e) => e.geom as Extract<EntityGeometry, { kind: 'TEXT' }>);
    const r = await ctx.view.request({ op: 'textOutlines', texts });
    outlines = new Map(measure.map((e, i) => [e.id, (r.ok && r.outlines?.[i]) || null]));
  }
  // A hatch given another pattern is placed by the app's pattern library first.
  const toPlace = hatchesToPattern(entities, edit);
  let patterns: HatchPatterns | undefined;
  if (toPlace.length > 0) {
    const r = await ctx.view.request({
      op: 'hatchPattern',
      name: String(edit.value).trim(),
      placements: toPlace.map((h) => h.placement),
    });
    if (!r.ok || !r.pattern) {
      ctx.message(r.ok ? 'Invalid input.' : r.message);
      return;
    }
    patterns = placedPatterns(toPlace, r.pattern);
  }
  // A multileader's text placed again on its landing is measured first (M2-35 part 11).
  const leaders = multiLeaderTextsToMeasure(model, entities, edit);
  let widths: MultiLeaderWidths | undefined;
  if (leaders.length > 0) {
    const texts = leaders.flatMap((l) => [l.before, l.after].filter((t) => t !== undefined));
    const r = await ctx.view.request({ op: 'textWidths', texts });
    const got = r.ok ? (r.widths ?? []) : [];
    let i = 0;
    const next = (t: unknown) => (t === undefined ? undefined : (got[i++] ?? undefined));
    widths = new Map(
      leaders.map((l) => {
        const before = next(l.before);
        const after = next(l.after);
        return [
          l.id,
          {
            ...(before !== undefined && { before }),
            ...(after !== undefined && { after }),
          },
        ];
      }),
    );
  }
  // An arrowhead chosen by name names the drawing's block for it, which is added first
  // where the drawing lacks it (M2-35 part 22), in the same undo step.
  const named = ids.length === 0 ? undefined : arrowheadByName(model, entities, edit);
  let chosen = edit;
  if (named !== undefined) {
    let block = arrowheadBlock(model.blocks, named)?.handle;
    if (block === undefined) {
      ctx.edit((b) => {
        block = addArrowheadBlock(b, model, named);
      });
    }
    chosen = { ...edit, value: block! };
  }
  ctx.edit((b) => {
    report =
      ids.length === 0
        ? applyCurrentEdit(b, model, edit)
        : applyPropertyEdit(b, model, entities, chosen, outlines, patterns, widths);
  });
  if (report!.invalid) ctx.message(`${report!.invalid}.`);
  for (const line of refusalMessages(report!.refused, 'changed')) ctx.message(line);
}
