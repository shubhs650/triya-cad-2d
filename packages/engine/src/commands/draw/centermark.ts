// CENTERMARK and CENTERLINE (M4-08 part 1), with AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "CENTERMARK (Command)", "CENTERLINE (Command)"):
//   CENTERMARK   Select circle or arc to add center mark:   (again, until Enter)
//   CENTERLINE   Select first line:
//                Select second line:
// Each mark is an INSERT of an anonymous block, associative to its objects through a
// `TRIYA_CENTERMARK` record (edit/center-marks.ts), with the CENTER* variables' cross size, gap
// and extensions (part 3, edit/center-settings.ts), on CENTERLAYER (the current layer, ".") in
// CENTERLTYPE (CENTER2) at CENTERLTSCALE (1).
//
// Part 3 adds AutoCAD 2024's commands that edit them (AutoCAD Help, "CENTERDISASSOCIATE
// (Command)", "CENTERREASSOCIATE (Command)", "CENTERRESET (Command)"):
//   CENTERDISASSOCIATE  Select center marks or centerlines to disassociate:
//   CENTERREASSOCIATE   Select center mark or centerline:
//                       Select circle or arc:   (a center mark)
//                       Select first line:  Select second line:   (a centerline)
//   CENTERRESET         Select center marks or centerlines to reset:
// The help gives the commands' purpose but not each prompt's wording or their closing messages
// ("1 center mark or centerline disassociated."), which are Triya's, following CENTERMARK's.
import {
  centerMarkOf,
  disassociateCenterMark,
  isAssociated,
  makeCenterMark,
  redrawCenterMark,
} from '../../edit/center-marks';
import { centerSettings, type CenterSettings } from '../../edit/center-settings';
import { AnonymousNames } from '../../edit/edit';
import type { ChangeSetBuilder } from '../../model/builder';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { CenterMark, Entity } from '../../model/types';
import type { GeneralProps } from '../../properties/sheet';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { hatchLayerRecord } from './hatch';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** CENTERLTYPE's initial value. */
export const CENTER_LINETYPE = 'CENTER2';

/**
 * The linetype a new mark takes: CENTERLTYPE's, the current one for ".". A drawing without the
 * linetype named draws the mark ByLayer (AutoCAD loads it from CENTERLTYPEFILE; Triya's linetype
 * loader is roadmap M5-08), and `missing` names it.
 */
function markLinetype(
  model: DocumentModel,
  s: CenterSettings,
): { linetype: GeneralProps['linetype']; missing?: string } {
  const name = s.linetype.trim();
  if (name === '.') return { linetype: currentProps(model).linetype };
  const u = name.toUpperCase();
  if (u === 'BYLAYER') return { linetype: 'ByLayer' };
  if (u === 'BYBLOCK') return { linetype: 'ByBlock' };
  const lt = [...model.tables.linetypes.values()].find((l) => l.name.toUpperCase() === u);
  return lt ? { linetype: lt.handle } : { linetype: 'ByLayer', missing: name };
}

/**
 * The properties a new mark takes, made in `b`: the current ones, on CENTERLAYER (made, as
 * HPLAYER's layer is, when the drawing has none of that name) in CENTERLTYPE at CENTERLTSCALE.
 */
function markProps(
  b: ChangeSetBuilder,
  ctx: CommandContext,
  s: CenterSettings,
  linetype: GeneralProps['linetype'],
): GeneralProps {
  const current = currentProps(ctx.model);
  const layer = s.layer.trim() === '.' ? current.layer : hatchLayerRecord(b, ctx, s.layer.trim());
  return { ...current, layer, linetype, ltScale: s.ltScale };
}

const missingMessage = (name: string) => `Linetype ${name} is not in the drawing: ByLayer is used.`;

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
        const settings = centerSettings(ctx.model);
        const { linetype, missing } = markLinetype(ctx.model, settings);
        if (missing && !told) ctx.message(missingMessage(missing));
        told = true;
        ctx.edit((b) =>
          makeCenterMark(b, ctx.model, {
            space: e.owner,
            props: markProps(b, ctx, settings, linetype),
            kind: 'mark',
            objects: [e],
            settings,
          }),
        );
      }
    },
  };
}

const END_TO_END = 'The lines meet end to end: there is no centerline between them.';

/** "Select circle or arc:" until one is picked; undefined at Enter or Esc. */
async function* pickCircle(ctx: CommandContext, message: string): Sub<Entity | undefined> {
  for (;;) {
    const e = yield* pickOne(ctx, message);
    if (e === undefined) return undefined;
    if (e && (e.geom.kind === 'CIRCLE' || e.geom.kind === 'ARC')) return e;
    ctx.message('Object selected is not a circle or arc.');
  }
}

/** "Select first line:", "Select second line:"; undefined at Enter or Esc. */
async function* pickLines(ctx: CommandContext): Sub<Entity[] | undefined> {
  const lines: Entity[] = [];
  while (lines.length < 2) {
    const message = lines.length === 0 ? 'Select first line' : 'Select second line';
    const e = yield* pickOne(ctx, message);
    if (e === undefined) return undefined;
    if (!e || e.geom.kind !== 'LINE') ctx.message('Object selected is not a line.');
    else if (lines[0]?.id === e.id) ctx.message('Select a different line.');
    else lines.push(e);
  }
  return lines;
}

function centerlineCommand(): CommandDef {
  return {
    name: 'CENTERLINE',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const lines = yield* pickLines(ctx);
      if (!lines) return;
      const settings = centerSettings(ctx.model);
      const { linetype, missing } = markLinetype(ctx.model, settings);
      let made: Entity | undefined;
      ctx.edit((b) => {
        made = makeCenterMark(
          b,
          ctx.model,
          {
            space: lines[0]!.owner,
            props: markProps(b, ctx, settings, linetype),
            kind: 'line',
            objects: lines,
            settings,
          },
          new AnonymousNames(ctx.model),
        );
      });
      if (!made) ctx.message(END_TO_END);
      else if (missing) ctx.message(missingMessage(missing));
    },
  };
}

/** The center marks and centerlines among `ids`, with their records. */
function marksAmong(
  model: DocumentModel,
  ids: readonly EntityId[],
): { insert: Entity; r: CenterMark }[] {
  return ids.flatMap((id) => {
    const insert = model.entity(id);
    const r = centerMarkOf(model, insert);
    return insert && r ? [{ insert, r }] : [];
  });
}

/** "1 center mark or centerline …", "2 center marks or centerlines …". */
const counted = (n: number, done: string): string =>
  `${n} ${n === 1 ? 'center mark or centerline' : 'center marks or centerlines'} ${done}.`;

/** Center marks and centerlines picked at `message`, or none at Enter or Esc. */
async function* pickMarks(
  ctx: CommandContext,
  message: string,
): Sub<{ insert: Entity; r: CenterMark }[]> {
  const a = yield ctx.prompt.selection({ message, editable: true, pickfirst: true });
  return a.kind === 'selection' ? marksAmong(ctx.model, a.ids) : [];
}

function centerDisassociateCommand(): CommandDef {
  return {
    name: 'CENTERDISASSOCIATE',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const marks = yield* pickMarks(ctx, 'Select center marks or centerlines to disassociate');
      const associated = marks.filter(({ r }) => isAssociated(r));
      if (associated.length > 0) {
        ctx.edit((b) => {
          for (const { r } of associated) disassociateCenterMark(b, r);
        });
      }
      ctx.message(counted(associated.length, 'disassociated'));
    },
  };
}

function centerResetCommand(): CommandDef {
  return {
    name: 'CENTERRESET',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const marks = yield* pickMarks(ctx, 'Select center marks or centerlines to reset');
      if (marks.length === 0) return;
      // AutoCAD 2024 Help: "Resets the extension lines of the centerlines and center marks to the
      // current value defined in the CENTEREXE system variable."
      const { extension } = centerSettings(ctx.model);
      let reset = 0;
      ctx.edit((b) => {
        for (const { insert, r } of marks) {
          const after = { ...r, extensions: r.extensions.map(() => extension) };
          if (JSON.stringify(after) === JSON.stringify(r)) {
            reset++;
            continue;
          }
          if (redrawCenterMark(b, ctx.model, insert, r, after)) reset++;
        }
      });
      ctx.message(counted(reset, 'reset'));
    },
  };
}

function centerReassociateCommand(): CommandDef {
  return {
    name: 'CENTERREASSOCIATE',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      let mark: { insert: Entity; r: CenterMark } | undefined;
      while (!mark) {
        const e = yield* pickOne(ctx, 'Select center mark or centerline');
        if (e === undefined) return;
        mark = e ? marksAmong(ctx.model, [e.id])[0] : undefined;
        if (!mark) ctx.message('Object selected is not a center mark or centerline.');
      }
      const { insert, r } = mark;
      let picked: Entity[] | undefined;
      if (r.kind === 'mark') {
        const e = yield* pickCircle(ctx, 'Select circle or arc');
        picked = e && [e];
      } else picked = yield* pickLines(ctx);
      if (!picked) return;
      let drawn = false;
      ctx.edit((b) => {
        const after = { ...r, objects: picked.map((e) => e.handle) };
        drawn = redrawCenterMark(b, ctx.model, insert, r, after);
      });
      if (!drawn) ctx.message(END_TO_END);
    },
  };
}

export function centerMarkCommands(): CommandDef[] {
  return [
    centermarkCommand(),
    centerlineCommand(),
    centerDisassociateCommand(),
    centerReassociateCommand(),
    centerResetCommand(),
  ];
}
