// VPCLIP (M6-02 part 2): a layout viewport clipped by an object or a polygon drawn, or
// rectangular again, on AutoCAD 2024's prompts (AutoCAD 2024 Help, "VPCLIP (Command)"):
//   Select viewport to clip:
//   Select clipping object or [Polygonal] <Polygonal>:          (Delete too once it is clipped)
//     an object:  a closed polyline, circle, ellipse, closed spline or region (viewport-clip.ts)
//     Polygonal:  Specify start point:
//                 Specify next point or [Arc/Length/Undo]:
//                 Specify next point or [Arc/Close/Length/Undo]:
//                 Arc: PLINE's arc segment prompts (`pline-arc.ts`), with CLose, Line and Undo
//     Delete:     the clipping boundary is erased and the viewport is rectangular again
// The polygon is a closed LWPOLYLINE with the current properties, made before the viewport is
// clipped by it (MVIEW Polygonal draws it the same way). Enter after three points closes it, as
// AutoCAD's Close does. The whole command is one VPCLIP undo step; picking a clipped viewport's
// boundary picks the viewport. Outside a layout AutoCAD refuses it, as MVIEW.
//
// Messages AutoCAD's help does not give are chosen: "Object is not a viewport." and the
// clipping object's refusals (viewport-clip.ts).
import type { BulgeArc } from '../geom/eval';
import { arcEnd, arcStartDirectionEnd } from '../geom/construct';
import { bulgeOf } from '../geom/shapes';
import type { Vec2 } from '../geom/types';
import { add, scale } from '../geom/vec';
import {
  clipObjectProblem,
  clipViewport,
  clipsViewport,
  deleteViewportClip,
} from '../edit/viewport-clip';
import type { ChangeSetBuilder } from '../model/builder';
import type { EntityId } from '../model/entity-ids';
import type { Entity, LwPolylineGeometry, ViewportGeometry } from '../model/types';
import { currentProps } from '../properties/current';
import { isPaperSpace } from './bus';
import type { CommandContext, CommandDef } from './command';
import { INVALID_ARC } from './draw/arc';
import { lineDirection } from './draw/last-drawn';
import { arcSegment } from './draw/pline-arc';
import { sketchTolerance } from './draw/sketch';
import type { Prompt, PromptAnswer } from './prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

interface Vertex {
  x: number;
  y: number;
  bulge: number;
}

/** The closed polyline `vertices` make. */
const polygonOf = (vertices: readonly Vertex[]): LwPolylineGeometry => ({
  kind: 'LWPOLYLINE',
  vertices: vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge })),
  closed: true,
});

/**
 * Polygonal's boundary, drawn as PLINE draws, with line and arc segments: the closed polyline,
 * or undefined when the command is cancelled or ended before it encloses an area. `clips`
 * checks the polygon closed (a message why it cannot clip, or undefined).
 */
export async function* polygonalBoundary(
  ctx: CommandContext,
  clips: (g: LwPolylineGeometry) => string | undefined,
): Sub<LwPolylineGeometry | undefined> {
  const s = yield ctx.prompt.point({ message: 'Specify start point' });
  if (s.kind !== 'point') return undefined;
  const layer = currentProps(ctx.model).layer;
  const vertices: Vertex[] = [{ x: s.point.x, y: s.point.y, bulge: 0 }];
  /** The direction the path travels at the end of each segment. */
  const directions: Vec2[] = [];
  let arcMode = false;
  const point = (): Vec2 => ({ x: vertices.at(-1)!.x, y: vertices.at(-1)!.y });
  const direction = (): Vec2 => directions.at(-1) ?? { x: 1, y: 0 };
  const show = (): void =>
    ctx.preview(vertices.length > 1 ? [{ ...polygonOf(vertices), closed: false }] : []);
  const segment = (to: Vec2, bulge: number, travel: Vec2): void => {
    vertices.at(-1)!.bulge = bulge;
    vertices.push({ x: to.x, y: to.y, bulge: 0 });
    directions.push(travel);
  };
  /** The polygon closed, or a message why it cannot be and undefined. */
  const close = (): LwPolylineGeometry | undefined => {
    const g = polygonOf(vertices);
    const problem = clips(g);
    if (!problem) return g;
    ctx.message(problem);
    return undefined;
  };

  for (;;) {
    show();
    const segments = vertices.length - 1;
    let answer: PromptAnswer | { kind: 'arc'; arc: BulgeArc };
    if (!arcMode) {
      answer = yield ctx.prompt.point({
        message: 'Specify next point or',
        options: segments > 0 ? ['Arc', 'Close', 'Length', 'Undo'] : ['Arc', 'Length', 'Undo'],
        rubberBand: { from: point(), ...(segments > 0 && { direction: direction() }) },
      });
    } else {
      const step = yield* arcSegment(ctx, {
        start: point(),
        direction: direction(),
        options: segments > 0 ? ['CLose', 'Line', 'Undo'] : ['Line', 'Undo'],
        layer,
      });
      if (!step) return undefined;
      answer = step;
    }
    if (answer.kind === 'point') {
      segment(answer.point, 0, lineDirection(point(), answer.point, direction()));
      continue;
    }
    if (answer.kind === 'arc') {
      const end = arcEnd(answer.arc);
      segment(end.point, bulgeOf(answer.arc), end.direction);
      continue;
    }
    // Enter closes the polygon, as Close does (AutoCAD: "If you press Enter after specifying at
    // least three points, the boundary is closed automatically").
    switch (answer.kind === 'keyword' ? answer.keyword : 'Close') {
      case 'Arc':
        arcMode = true;
        break;
      case 'Line':
        arcMode = false;
        break;
      case 'Close': {
        if (segments === 0) return undefined;
        const g = close();
        if (g) return g;
        break;
      }
      case 'CLose': {
        const first = vertices[0]!;
        const arc = arcStartDirectionEnd(
          point(),
          direction(),
          first,
          sketchTolerance(point(), first),
        );
        if (!arc) {
          ctx.message(INVALID_ARC);
          break;
        }
        vertices.at(-1)!.bulge = bulgeOf(arc);
        const g = close();
        if (g) return g;
        vertices.at(-1)!.bulge = 0;
        break;
      }
      case 'Length': {
        const l = yield ctx.prompt.distance({ message: 'Specify length of line', base: point() });
        if (l.kind !== 'distance') break;
        const d = direction();
        segment(add(point(), scale(d, l.value)), 0, l.value < 0 ? scale(d, -1) : d);
        break;
      }
      case 'Undo':
        if (segments === 0) {
          ctx.message('All segments already undone.');
          break;
        }
        vertices.pop();
        directions.pop();
        vertices.at(-1)!.bulge = 0;
        break;
    }
  }
}

/** The closed polyline `g` as an object of the space shown, with the current properties. */
export function addBoundary(
  ctx: CommandContext,
  b: ChangeSetBuilder,
  g: LwPolylineGeometry,
): EntityId {
  return b.addEntity({ owner: ctx.space, ...currentProps(ctx.model), geom: g }).id;
}

/** Why the polygon drawn cannot clip a viewport, or undefined when it can. */
export const polygonProblem = (g: LwPolylineGeometry): string | undefined =>
  clipsViewport(g) ? undefined : 'The boundary must enclose an area.';

type ViewportEntity = Entity & { geom: ViewportGeometry };

/**
 * The floating viewport of the space shown that `e` is, or whose clipping boundary it is
 * (AutoCAD picks a clipped viewport by its boundary); undefined for anything else.
 */
export function viewportOfPick(
  ctx: CommandContext,
  e: Entity | undefined,
): ViewportEntity | undefined {
  const floating = (v: Entity | undefined): v is ViewportEntity =>
    v?.geom.kind === 'VIEWPORT' && v.geom.id !== 1 && v.owner === ctx.space;
  if (floating(e)) return e;
  for (const h of e?.reactors ?? []) {
    const v = ctx.model.entityByHandle(h);
    if (floating(v) && v.geom.clipBoundary === e!.handle) return v;
  }
  return undefined;
}

export function vpclipCommand(): CommandDef {
  return {
    name: 'VPCLIP',
    async *run(ctx) {
      // Viewports are paper space's objects: from a viewport made current, AutoCAD's MVIEW and
      // VPCLIP work in paper space, which the layout stays in (M6-02 part 3).
      if (ctx.viewport.current !== undefined) await ctx.viewport.set(undefined);
      if (!isPaperSpace(ctx.model, ctx.space)) {
        ctx.message('** Command not allowed in Model Tab **');
        return;
      }
      let viewport: ViewportEntity | undefined;
      while (!viewport) {
        const a = yield ctx.prompt.selection({
          message: 'Select viewport to clip',
          single: true,
          editable: true,
        });
        const ids = (a as { ids?: readonly EntityId[] }).ids ?? [];
        if (ids.length === 0) return;
        // The first viewport among the objects taken (a window or ALL may take others too).
        viewport = ids.map((i) => viewportOfPick(ctx, ctx.model.entity(i))).find((v) => v);
        if (!viewport) ctx.message('Object is not a viewport.');
      }
      const id = viewport.id;
      const clipped = viewport.geom.clipBoundary !== undefined;
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select clipping object or',
          options: clipped ? ['Polygonal', 'Delete'] : ['Polygonal'],
          defaultLabel: 'Polygonal',
          single: true,
        });
        if (a.kind === 'keyword' && a.keyword === 'Delete') {
          ctx.edit((b) => deleteViewportClip(b, ctx.model, id));
          return;
        }
        const picked = (a as { ids?: readonly EntityId[] }).ids ?? [];
        if (picked.length === 0) {
          // Polygonal, or Enter for it.
          const g = yield* polygonalBoundary(ctx, polygonProblem);
          if (!g) return;
          ctx.edit((b) => clipViewport(b, ctx.model, id, addBoundary(ctx, b, g)));
          return;
        }
        const e = ctx.model.entity(picked[0]!)!;
        const problem = clipObjectProblem(ctx.model, e, ctx.space, viewport);
        if (problem) {
          ctx.message(problem);
          continue;
        }
        ctx.edit((b) => clipViewport(b, ctx.model, id, e.id));
        return;
      }
    },
  };
}
