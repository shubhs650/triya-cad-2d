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
// M5-08 part 2: a drawing without CENTERLTYPE's linetype loads it, as AutoCAD loads it from
// CENTERLTYPEFILE (a registry setting, acad.lin or acadiso.lin), from the bundled
// `triya-drafting.lin` (inches) or `triya-drafting-iso.lin` (millimetres, a metric drawing),
// whose CENTER2 is Triya's own (DEC-073); in the mark's undo step, when the first mark is made.
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
//
// M4-29: CENTERLINE (and CENTERREASSOCIATE on a centerline) also takes a polyline's straight
// segment, the one nearest the pick ("Creates a centerline associated with selected lines and
// linear polyline segments", AutoCAD 2024 Help, "CENTERLINE (Command)"), and two segments of one
// polyline. The help gives no message for a curved segment; Triya's is "Polyline segment
// selected is not straight."
import {
  centerlinePick,
  centerMarkOf,
  disassociateCenterMark,
  isAssociated,
  makeCenterMark,
  redrawCenterMark,
  segmentsField,
} from '../../edit/center-marks';
import { centerSettings, metric, type CenterSettings } from '../../edit/center-settings';
import { linetypeNamed, loadLinetypes } from '../../edit/linetypes';
import { AnonymousNames } from '../../edit/edit';
import type { ChangeSetBuilder } from '../../model/builder';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { CenterMark, Entity } from '../../model/types';
import type { GeneralProps } from '../../properties/sheet';
import { currentProps } from '../../properties/current';
import type { Vec2 } from '../../geom/types';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { hatchLayerRecord } from './hatch';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** CENTERLTYPE's initial value. */
export const CENTER_LINETYPE = 'CENTER2';

/** The bundled files CENTERLTYPE is loaded from (AutoCAD's CENTERLTYPEFILE), by units. */
export const CENTER_LINETYPE_FILES = {
  imperial: 'triya-drafting.lin',
  metric: 'triya-drafting-iso.lin',
} as const;

/**
 * Loads CENTERLTYPE's linetype when the drawing lacks it (M5-08 part 2), from the bundled file
 * for the drawing's units, as its own edit in the command's undo step. Nothing is said: AutoCAD
 * loads it silently. A file that lacks it (or no app to read it) leaves `markLinetype` to fall
 * back to ByLayer and say so.
 */
async function loadMarkLinetype(ctx: CommandContext, s: CenterSettings): Promise<void> {
  const name = s.linetype.trim();
  if (name === '.' || /^by(layer|block)$/i.test(name) || linetypeNamed(ctx.model, name)) return;
  const file = metric(ctx.model) ? CENTER_LINETYPE_FILES.metric : CENTER_LINETYPE_FILES.imperial;
  const r = await ctx.view.request({ op: 'linetypeFile', file });
  const def = r.ok
    ? r.linetypeFile?.linetypes.find((l) => l.name.toUpperCase() === name.toUpperCase())
    : undefined;
  if (def) ctx.edit((b) => loadLinetypes(b, ctx.model, [def]));
}

/**
 * The linetype a new mark takes: CENTERLTYPE's, the current one for ".". A drawing still without
 * the linetype named (`loadMarkLinetype` found none to load) draws the mark ByLayer, and
 * `missing` names it.
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

/** One object picked at `message`, with where, or undefined at Enter or Esc. */
async function* pickAt(
  ctx: CommandContext,
  message: string,
): Sub<{ entity: Entity | null; at?: Vec2 } | undefined> {
  const a = yield ctx.prompt.selection({ message, single: true });
  if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
  return { entity: ctx.model.entity(a.ids[0]!) ?? null, ...(a.pick && { at: a.pick }) };
}

/** One object picked at `message`, or undefined at Enter or Esc. */
async function* pickOne(ctx: CommandContext, message: string): Sub<Entity | undefined | null> {
  const p = yield* pickAt(ctx, message);
  return p && p.entity;
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
        await loadMarkLinetype(ctx, settings);
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

/** A centerline's line: a LINE (segment -1) or a polyline's straight segment. */
interface PickedLine {
  readonly entity: Entity;
  readonly segment: number;
}

/**
 * "Select first line:", "Select second line:", each a line or a polyline's straight segment;
 * undefined at Enter or Esc.
 */
async function* pickLines(ctx: CommandContext): Sub<PickedLine[] | undefined> {
  const lines: PickedLine[] = [];
  while (lines.length < 2) {
    const message = lines.length === 0 ? 'Select first line' : 'Select second line';
    const p = yield* pickAt(ctx, message);
    if (p === undefined) return undefined;
    const e = p.entity;
    const pick = e ? centerlinePick(e, p.at) : undefined;
    if (!e || !pick || 'refused' in pick) {
      ctx.message(
        pick && 'refused' in pick && pick.refused === 'curved'
          ? 'Polyline segment selected is not straight.'
          : 'Object selected is not a line.',
      );
    } else if (lines[0]?.entity.id === e.id && lines[0].segment === pick.segment) {
      ctx.message('Select a different line.');
    } else lines.push({ entity: e, segment: pick.segment });
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
      await loadMarkLinetype(ctx, settings);
      const { linetype, missing } = markLinetype(ctx.model, settings);
      let made: Entity | undefined;
      ctx.edit((b) => {
        made = makeCenterMark(
          b,
          ctx.model,
          {
            space: lines[0]!.entity.owner,
            props: markProps(b, ctx, settings, linetype),
            kind: 'line',
            objects: lines.map((l) => l.entity),
            segments: lines.map((l) => l.segment),
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
      let picked: PickedLine[] | undefined;
      if (r.kind === 'mark') {
        const e = yield* pickCircle(ctx, 'Select circle or arc');
        picked = e && [{ entity: e, segment: -1 }];
      } else picked = yield* pickLines(ctx);
      if (!picked) return;
      let drawn = false;
      ctx.edit((b) => {
        const { segments: _old, ...rest } = r;
        const after: CenterMark = {
          ...rest,
          objects: picked.map((p) => p.entity.handle),
          ...segmentsField(picked.map((p) => p.segment)),
        };
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
