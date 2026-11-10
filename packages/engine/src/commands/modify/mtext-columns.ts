// Dynamic columns recounted after a column grip reshaped them (M2-26 part 2): AutoCAD adds and
// removes dynamic columns as the text needs, and only the canvas, with the fonts, can lay the
// text out (`columnCounts`). The count goes into the same command, so one undo takes back the
// grip and the recount together. Without a canvas or a loaded font the count stays as it was.
import type { EntityId } from '../../model/entity-ids';
import type { MTextGeometry } from '../../model/types';
import { hasDynamicColumns, withColumnCount } from '../../edit/mtext-grips';
import type { CommandContext } from '../command';

export async function recountColumns(ctx: CommandContext, ids: readonly EntityId[]): Promise<void> {
  const texts: { id: EntityId; geom: MTextGeometry }[] = [];
  for (const id of ids) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind === 'MTEXT' && hasDynamicColumns(g)) texts.push({ id, geom: g });
  }
  if (texts.length === 0) return;
  const reply = await ctx.view.request({ op: 'columnCounts', texts: texts.map((t) => t.geom) });
  const counts = reply.ok ? reply.counts : undefined;
  if (!counts) return;
  const changed = texts.flatMap(({ id, geom }, i) => {
    const n = counts[i];
    const g = n === null || n === undefined ? geom : withColumnCount(geom, n);
    return g === geom ? [] : [{ id, g }];
  });
  if (changed.length === 0) return;
  ctx.edit((b) => {
    for (const { id, g } of changed) if (b.entity(id)) b.updateEntity(id, { geom: g });
  });
}
