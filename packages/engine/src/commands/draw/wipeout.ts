// WIPEOUT (M2-08) with AutoCAD 2024's prompts (AutoCAD 2024 Help, "WIPEOUT (Command)",
// WIPEOUTFRAME):
//   Specify first point or [Frames/Polyline] <Polyline>:
//   Specify next point:  /  Specify next point or [Undo]:  /  Specify next point or [Close/Undo]:
//   Enter mode [ON/OFF/Display but not plot] <ON>:                   (Frames)
//   Select a closed polyline:  Erase polyline? [Yes/No] <No>:         (Polyline)
// The wipeout masks the polygon in the background colour (edit/revcloud.ts `wipeoutGeometry`).
// Frames sets WIPEOUTFRAME: OFF 0, ON 1, "Display but not plot" 2 (M2-24 part 2: the screen
// draws the frames and the plot job leaves them out). A polyline's arc segments are followed by
// chords, as AutoCAD 2015+ approximates them.
import type { Vec2 } from '../../geom/types';
import { flatten } from '../../geom/flatten';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { NonGraphicalObject, WipeoutFrame, WipeoutVariables } from '../../model/types';
import { distinctVertices, wipeoutGeometry } from '../../edit/revcloud';
import type { CommandContext, CommandDef } from '../command';
import { currentProps } from '../../properties/current';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** A keyword prompt with a default answers a keyword (Enter gives the default). */
const keyword = (a: PromptAnswer): string => (a as { keyword: string }).keyword;
/** A selection prompt answers the selection (none when Enter ends it at once). */
const selected = (a: PromptAnswer): readonly EntityId[] => (a as { ids: readonly EntityId[] }).ids;

/** The drawing's WIPEOUTVARIABLES, if it has one. */
function wipeoutVariables(model: DocumentModel): WipeoutVariables | undefined {
  for (const o of model.objects.values()) {
    if (o.type === 'WIPEOUTVARIABLES') return o as WipeoutVariables;
  }
  return undefined;
}

/** WIPEOUTFRAME: the drawing's WIPEOUTVARIABLES, else AutoCAD's initial 1 (shown and plotted). */
export const wipeoutFrame = (model: DocumentModel): WipeoutFrame =>
  wipeoutVariables(model)?.frame ?? 1;

/** Frames' options, by the WIPEOUTFRAME each sets. */
const MODES = ['OFF', 'ON', 'Display but not plot'] as const;

async function* frames(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter mode',
    options: ['ON', 'OFF', 'Display but not plot'],
    default: { kind: 'keyword', keyword: MODES[wipeoutFrame(ctx.model)] },
  });
  const frame = MODES.findIndex(
    (m) => m.toUpperCase() === keyword(a).toUpperCase(),
  ) as WipeoutFrame;
  setWipeoutFrame(ctx, frame);
}

/**
 * Sets WIPEOUTFRAME (WIPEOUT Frames, SETVAR; M2-42): in the drawing's WIPEOUTVARIABLES, made
 * when it has none and the mode is not AutoCAD's initial 1. False, with a message, when the
 * drawing has nowhere to keep it.
 */
export function setWipeoutFrame(ctx: CommandContext, frame: WipeoutFrame): boolean {
  const vars = wipeoutVariables(ctx.model);
  if (vars) {
    if (vars.frame !== frame) {
      ctx.edit((b) => b.updateObject(vars.handle, { frame } as Partial<NonGraphicalObject>));
    }
    return true;
  }
  if (frame === 1) return true; // no object means frames on already
  const root = ctx.model.meta.rootDictionary;
  if (root === undefined) {
    ctx.message('The drawing has no named object dictionary to keep WIPEOUTFRAME in.');
    return false;
  }
  // AutoCAD files it in the root dictionary as ACAD_WIPEOUT_VARS (the save names the entry).
  ctx.edit((b) =>
    b.addObject({
      type: 'WIPEOUTVARIABLES',
      owner: root,
      frame,
    } as Omit<WipeoutVariables, 'handle'>),
  );
  return true;
}

function add(ctx: CommandContext, points: readonly Vec2[]): void {
  ctx.edit((b) =>
    b.addEntity({
      owner: ctx.space,
      ...currentProps(ctx.model),
      geom: wipeoutGeometry(points),
    }),
  );
}

async function* fromPolyline(ctx: CommandContext): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: 'Select a closed polyline',
      single: true,
      editable: true,
    });
    const picked = selected(a);
    if (picked.length === 0) return;
    const e = ctx.model.entity(picked[0]!)!;
    const g = e.geom;
    if ((g.kind !== 'LWPOLYLINE' && g.kind !== 'POLYLINE') || !g.closed) {
      ctx.message('Polyline must be closed.');
      continue;
    }
    const xs = g.vertices.map((v) => Math.abs(v.x)).concat(g.vertices.map((v) => Math.abs(v.y)));
    const size = Math.max(1, ...xs);
    const flat = flatten({ kind: 'LWPOLYLINE', vertices: g.vertices, closed: true }, size * 1e-3);
    const points = distinctVertices(flat.points, size * 1e-10);
    if (points.length < 3) {
      ctx.message('Polyline must enclose an area.');
      continue;
    }
    const erase = yield ctx.prompt.keyword({
      message: 'Erase polyline',
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'No' },
    });
    add(ctx, points);
    if (keyword(erase) === 'Yes') ctx.edit((b) => b.removeEntity(e.id));
    return;
  }
}

export function wipeoutCommand(): CommandDef {
  return {
    name: 'WIPEOUT',
    async *run(ctx) {
      const a = yield ctx.prompt.point({
        message: 'Specify first point or',
        options: ['Frames', 'Polyline'],
        defaultLabel: 'Polyline',
      });
      if (a.kind === 'keyword' && a.keyword === 'Frames') return yield* frames(ctx);
      if (a.kind === 'enter' || a.kind === 'keyword') return yield* fromPolyline(ctx);
      const points: Vec2[] = [(a as { point: Vec2 }).point];
      for (;;) {
        ctx.preview(
          points.length > 1
            ? [
                {
                  kind: 'LWPOLYLINE',
                  closed: false,
                  vertices: points.map((p) => ({ ...p, bulge: 0 })),
                },
              ]
            : [],
        );
        const options = points.length >= 3 ? ['Close', 'Undo'] : points.length > 1 ? ['Undo'] : [];
        const n = yield ctx.prompt.point({
          message: options.length ? 'Specify next point or' : 'Specify next point',
          ...(options.length && { options }),
          rubberBand: { from: points.at(-1)! },
        });
        if (n.kind === 'point') points.push(n.point);
        else if (n.kind === 'keyword' && n.keyword === 'Undo') points.pop();
        else {
          // Enter or Close.
          const ring = distinctVertices(points, 0);
          if (ring.length < 3) {
            ctx.message('A wipeout needs three or more points.');
            if (n.kind === 'enter' && points.length < 2) return;
            continue;
          }
          add(ctx, ring);
          return;
        }
      }
    },
  };
}
