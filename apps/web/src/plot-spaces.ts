// What a space of a drawing plots from, shown or not (M2-17 part 2's PUBLISH; part 5's -PLOT): a
// space shown on a canvas plots as the Plot dialog would (model space's Display among its areas);
// one not shown from its page setup, model space by its extents.
import type { PlotStyleTable } from '@triya/render';
import { controllerOf } from './canvas/registry';
import { layoutsOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import type { PlotSpace } from './plot';
import { sheetSpace } from './publish';

export async function plotSpaceOf(
  doc: OpenDocument,
  block: string,
  name: string,
  userTables: ReadonlyMap<string, PlotStyleTable> | undefined,
): Promise<PlotSpace | undefined> {
  const live = controllerOf(doc.id, block);
  if (live) return { ...(await live.plotSpace()), userTables };
  const active = controllerOf(doc.id, doc.block);
  if (!active) return undefined;
  const here = await active.plotSpace();
  const layouts = layoutsOf(doc.opened.init, engines.changesOf(doc.id));
  return sheetSpace({
    name,
    layout: layouts.find((l) => l.blockRecord === block),
    model: block === doc.opened.modelSpace,
    extents: doc.opened.extents[block],
    namedPlotStyles: here.namedPlotStyles ?? false,
    userTables,
  });
}
