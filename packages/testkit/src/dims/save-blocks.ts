// The blocks the app's save gives dimensions that have none (M2-30 part 2), for corpus suites
// that save as the app does: `PromptBus.blocklessDimensionBlocks` with the real dimension engine
// and the renderer's text measuring over the bundled fonts (apps/web's `saveDrawing`).
import { regenerateDimension } from '@triya/dims';
import {
  PromptBus,
  builtinCommands,
  type ChangeSet,
  type DocumentModel,
  type ViewReply,
} from '@triya/engine';
import { textMeasure } from '@triya/render';
import { bundledFontBook } from '../render/bundled-fonts.ts';

/**
 * A change set, built on `model` and not applied to it, that draws each dimension without a
 * `*D` block into a new one; undefined when there is none.
 */
export function dimensionBlocksForSave(model: DocumentModel): Promise<ChangeSet | undefined> {
  const measure = textMeasure({
    fonts: bundledFontBook(),
    style: (h) => model.tables.textStyles.get(h),
  });
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> =>
        Promise.resolve(
          r.op === 'textWidths'
            ? { ok: true, widths: r.texts.map((t) => measure(t) ?? null) }
            : { ok: false, message: 'no view' },
        ),
    },
    dimensions: regenerateDimension,
  });
  return bus.blocklessDimensionBlocks();
}
