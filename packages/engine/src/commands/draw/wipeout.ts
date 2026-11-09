// WIPEOUT (M2-08) with AutoCAD 2024's prompts (AutoCAD 2024 Help, "WIPEOUT (Command)",
// WIPEOUTFRAME):
//   Specify first point or [Frames/Polyline] <Polyline>:
//   Specify next point:  /  Specify next point or [Undo]:  /  Specify next point or [Close/Undo]:
//   Enter mode [ON/OFF] <ON>:                                        (Frames)
//   Select a closed polyline:  Erase polyline? [Yes/No] <No>:         (Polyline)
// The wipeout masks the polygon in the background colour (edit/revcloud.ts `wipeoutGeometry`).
// AutoCAD 2024's Frames also offers "Display but not plot" (WIPEOUTFRAME 2); Triya's model keeps
// WIPEOUTFRAME on or off (acad-ts reads it so, M1-19), so only ON and OFF are offered. A polyline's
// arc segments are followed by chords, as AutoCAD 2015+ approximates them.
import type { Vec2 } from '../../geom/types';
import { flatten } from '../../geom/flatten';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { NonGraphicalObject, WipeoutVariables } from '../../model/types';
import { distinctVertices, wipeoutGeometry } from '../../edit/revcloud';
import type { CommandContext, CommandDef } from '../command';
import { currentLayer } from './line';
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

/** WIPEOUTFRAME: on unless the drawing's WIPEOUTVARIABLES says off. */
export const wipeoutFrame = (model: DocumentModel): boolean =>
  wipeoutVariables(model)?.frame ?? true;

async function* frames(ctx: CommandContext): Sub<void> {
  const on = wipeoutFrame(ctx.model);
  const a = yield ctx.prompt.keyword({
    message: 'Enter mode',
    options: ['ON', 'OFF'],
    default: { kind: 'keyword', keyword: on ? 'ON' : 'OFF' },
  });
  const frame = keyword(a) === 'ON';
  const vars = wipeoutVariables(ctx.model);
  if (vars) {
    if (vars.frame !== frame) {
      ctx.edit((b) => b.updateObject(vars.handle, { frame } as Partial<NonGraphicalObject>));
    }
    return;
  }
  if (frame) return; // no object means frames on already
  const root = ctx.model.meta.rootDictionary;
  if (root === undefined) {
    ctx.message('The drawing has no named object dictionary to keep WIPEOUTFRAME in.');
    return;
  }
  // AutoCAD files it in the root dictionary as ACAD_WIPEOUT_VARS (the save names the entry).
  ctx.edit((b) =>
    b.addObject({
      type: 'WIPEOUTVARIABLES',
      owner: root,
      frame,
    } as Omit<WipeoutVariables, 'handle'>),
  );
}

function add(ctx: CommandContext, points: readonly Vec2[]): void {
  ctx.edit((b) =>
    b.addEntity({
      owner: ctx.space,
      layer: currentLayer(ctx.model),
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
