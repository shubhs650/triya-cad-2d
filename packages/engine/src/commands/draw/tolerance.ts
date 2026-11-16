// TOLERANCE (TOL, M4-11), as AutoCAD 2024's "TOLERANCE (Command)": the Geometric Tolerance
// dialog, then "Enter tolerance location:" with the frame dragged by its insertion point (the
// left edge of its first row, half way up, `toleranceParts`). The frame is a TOLERANCE in the
// current dimension style with the header's DIMVAR overrides (as a dimension is made, M2-31),
// along the current UCS's X axis. TEXTEDIT (a double click) opens the dialog on a frame
// (AutoCAD 2024 Help, "TEXTEDIT (Command)": a feature control frame "Displays the Geometric
// Tolerance dialog box").
//
// Where AutoCAD's documentation is silent: OK with every field empty places nothing (there is
// nothing to draw or pick), and TEXTEDIT keeps a frame whose fields OK empties, as it keeps a
// multileader's emptied text (ERASE removes it).
import type {
  Entity,
  EntityGeometry,
  MTextGeometry,
  ToleranceGeometry,
  Xdata,
} from '../../model/types';
import { toleranceParts } from '../../annotation/tolerance';
import { currentProps } from '../../properties/current';
import {
  EMPTY_GDT_FRAME,
  toleranceFrame,
  toleranceText,
  type GdtFrame,
} from '../../edit/tolerance-frame';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { currentUcs } from '../ucs';
import { currentStyle } from './dimension';

/** The Geometric Tolerance dialog, opened on `frame`. */
export interface ToleranceRequest {
  readonly type: 'tolerance';
  readonly frame: GdtFrame;
}

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The dialog's fields as OK left them; undefined on Cancel. */
async function* toleranceDialog(ctx: CommandContext, frame: GdtFrame): Sub<GdtFrame | undefined> {
  const a = yield ctx.prompt.dialog({
    message: 'Geometric Tolerance',
    dialog: { type: 'tolerance', frame },
  });
  if (a.kind !== 'dialog' || a.action !== 'ok') return undefined;
  return a.tolerance;
}

/**
 * What is dragged to place `g`: its compartment frames and their text, laid out in the widths
 * the renderer measures (none when the renderer cannot measure them).
 */
async function framePreview(
  ctx: CommandContext,
  g: ToleranceGeometry,
  xdata: Xdata | undefined,
): Promise<EntityGeometry[]> {
  const texts: MTextGeometry[] = [];
  toleranceParts(g, xdata, ctx.model, (t) => (texts.push(t), 0));
  const r = await ctx.view.request({ op: 'textWidths', texts });
  const widths = r.ok ? (r.widths ?? []) : [];
  let i = 0;
  const parts = toleranceParts(g, xdata, ctx.model, () => widths[i++] ?? undefined);
  return (parts ?? []).map((p) => p.geom as EntityGeometry);
}

export function toleranceCommand(): CommandDef {
  return {
    name: 'TOLERANCE',
    async *run(ctx) {
      const frame = yield* toleranceDialog(ctx, EMPTY_GDT_FRAME);
      const text = frame ? toleranceText(frame) : '';
      if (text === '') return;
      const style = currentStyle(ctx);
      if (!style) return;
      const geom: ToleranceGeometry = {
        kind: 'TOLERANCE',
        style: style.handle,
        position: { x: 0, y: 0 },
        rotation: currentUcs(ctx).angle,
        text,
      };
      ctx.preview(await framePreview(ctx, geom, style.xdata));
      const at = yield ctx.prompt.point({
        message: 'Enter tolerance location',
        drag: { kind: 'preview', from: { x: 0, y: 0 } },
      });
      ctx.preview([]);
      if (at.kind !== 'point') return;
      const props = currentProps(ctx.model);
      ctx.edit((b) =>
        b.addEntity({
          owner: ctx.space,
          ...props,
          ...(style.xdata && { xdata: style.xdata }),
          geom: { ...geom, position: at.point },
        }),
      );
    },
  };
}

/**
 * TEXTEDIT on a feature control frame: the dialog on its fields. The text is written anew only
 * when OK changed a field, so codes the dialog cannot show stay as they were. The frame as it
 * was, for TEXTEDIT's Undo; false when nothing changed; undefined on Cancel.
 */
export async function* editTolerance(
  ctx: CommandContext,
  entity: Entity,
): Sub<Entity | false | undefined> {
  const g = entity.geom as ToleranceGeometry;
  const shown = toleranceFrame(g.text);
  const frame = yield* toleranceDialog(ctx, shown);
  if (!frame) return undefined;
  const text = toleranceText(frame);
  if (text === toleranceText(shown)) return false;
  if (text === '') {
    ctx.message('A feature control frame cannot be empty: ERASE removes the frame.');
    return false;
  }
  ctx.edit((b) => b.updateEntity(entity.id, { geom: { ...g, text } }));
  return entity;
}
