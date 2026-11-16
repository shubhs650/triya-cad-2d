// CENTERMARK and CENTERLINE (M4-08 part 1), with AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "CENTERMARK (Command)", "CENTERLINE (Command)"):
//   CENTERMARK   Select circle or arc to add center mark:   (again, until Enter)
//   CENTERLINE   Select first line:
//                Select second line:
// Each mark is an INSERT of an anonymous block, associative to its objects through a
// `TRIYA_CENTERMARK` record (edit/center-marks.ts), on CENTERLAYER (the current layer, ".")
// in CENTERLTYPE (CENTER2, when the drawing has it) at CENTERLTSCALE (1). Part 1 uses AutoCAD's
// initial CENTERCROSSSIZE, CENTERCROSSGAP and CENTERMARKEXE and the drawing's CENTEREXE; the
// variables themselves, polyline segments for CENTERLINE and the CENTER* editing commands come
// in later parts of M4-08.
import { centerSettings, makeCenterMark } from '../../edit/center-marks';
import { AnonymousNames } from '../../edit/edit';
import type { DocumentModel } from '../../model/document';
import type { Entity } from '../../model/types';
import type { GeneralProps } from '../../properties/sheet';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** CENTERLTYPE's initial value. */
export const CENTER_LINETYPE = 'CENTER2';

/**
 * The properties a new mark takes: the current ones, in CENTERLTYPE at CENTERLTSCALE 1. A drawing
 * without that linetype draws the mark ByLayer (AutoCAD loads it from CENTERLTYPEFILE; Triya's
 * linetype loader is roadmap M5-08), and `missing` says so.
 */
function markProps(model: DocumentModel): { props: GeneralProps; missing: boolean } {
  const lt = [...model.tables.linetypes.values()].find(
    (l) => l.name.toUpperCase() === CENTER_LINETYPE,
  );
  return {
    props: { ...currentProps(model), linetype: lt ? lt.handle : 'ByLayer', ltScale: 1 },
    missing: !lt,
  };
}

const missingMessage = `Linetype ${CENTER_LINETYPE} is not in the drawing: ByLayer is used.`;

/** One object picked at `message`, or undefined at Enter or Esc. */
async function* pickOne(ctx: CommandContext, message: string): Sub<Entity | undefined | null> {
  const a = yield ctx.prompt.selection({ message, single: true });
  if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
  return ctx.model.entity(a.ids[0]!) ?? null;
}

function centermarkCommand(): CommandDef {
  return {
    name: 'CENTERMARK',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      let told = false;
      for (;;) {
        const e = yield* pickOne(ctx, 'Select circle or arc to add center mark');
        if (e === undefined) return;
        if (!e || (e.geom.kind !== 'CIRCLE' && e.geom.kind !== 'ARC')) {
          ctx.message('Object selected is not a circle or arc.');
          continue;
        }
        const { props, missing } = markProps(ctx.model);
        if (missing && !told) ctx.message(missingMessage);
        told = true;
        ctx.edit((b) =>
          makeCenterMark(b, ctx.model, {
            space: e.owner,
            props,
            kind: 'mark',
            objects: [e],
            settings: centerSettings(ctx.model),
          }),
        );
      }
    },
  };
}

function centerlineCommand(): CommandDef {
  return {
    name: 'CENTERLINE',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const lines: Entity[] = [];
      while (lines.length < 2) {
        const message = lines.length === 0 ? 'Select first line' : 'Select second line';
        const e = yield* pickOne(ctx, message);
        if (e === undefined) return;
        if (!e || e.geom.kind !== 'LINE') ctx.message('Object selected is not a line.');
        else if (lines[0]?.id === e.id) ctx.message('Select a different line.');
        else lines.push(e);
      }
      const { props, missing } = markProps(ctx.model);
      let made: Entity | undefined;
      ctx.edit((b) => {
        made = makeCenterMark(
          b,
          ctx.model,
          {
            space: lines[0]!.owner,
            props,
            kind: 'line',
            objects: lines,
            settings: centerSettings(ctx.model),
          },
          new AnonymousNames(ctx.model),
        );
      });
      if (!made) ctx.message('The lines meet end to end: there is no centerline between them.');
      else if (missing) ctx.message(missingMessage);
    },
  };
}

export function centerMarkCommands(): CommandDef[] {
  return [centermarkCommand(), centerlineCommand()];
}
