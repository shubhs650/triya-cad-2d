// CIRCLE (M3-01), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "CIRCLE (Command)"):
//   Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:
//   Specify radius of circle or [Diameter] <last>:      Diameter: Specify diameter of circle <last>:
//   3P: Specify first / second / third point on circle:
//   2P: Specify first / second end point of circle's diameter:
//   Ttr: Specify point on object for first / second tangent of circle:, then the radius
// The default radius is the last one drawn in the drawing this session (AutoCAD's CIRCLERAD,
// which it does not save; 0 at first, when there is no default). Of the circles Ttr could draw,
// AutoCAD draws the one whose tangent points are closest to the points picked; when none
// exists it says "Circle does not exist." and ends.
//
// 3P's points take deferred TANgent snaps (M3-01 part 2): a point snapped TAN to a line,
// circle or arc holds that object, and the circle drawn touches it, as AutoCAD's 3P does with
// the Tangent snap. Three of them are the ribbon's Tan, Tan, Tan (`_circle _3p _tan _tan _tan`,
// typed here as CIRCLE ↵ 3P ↵ TAN ↵ pick, three times, until the ribbon exists, M7-01); the
// circle whose touching points are nearest the picks is drawn, or "Circle does not exist.".
import { circleTanTanRadius, type TangentTarget } from '../../geom/construct';
import { circleThroughItems, isDeferred, itemPoint, type DeferredItem } from '../../geom/deferred';
import type { DeferredModes } from '../../input/osnap';
import { OSNAP } from '../../input/osnap';
import type { Circle } from '../../geom/curves';
import { closestPoint } from '../../geom/closest';
import { polylineSegment } from '../../geom/eval';
import type { Vec2 } from '../../geom/types';
import { distance, midpoint, sub } from '../../geom/vec';
import type { Entity } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { currentProps } from '../../properties/current';
import { sketchTolerance, type Sketch } from './sketch';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

export const NO_CIRCLE = 'Circle does not exist.';
const POSITIVE = 'Value must be positive and nonzero.';

/** CIRCLE for one document: it remembers the last radius (CIRCLERAD) for the next. */
export function circleCommand(): CommandDef {
  const state = { radius: 0 };
  return {
    name: 'CIRCLE',
    async *run(ctx) {
      const circle = yield* circlePrompts(ctx, state);
      if (!circle) return;
      const props = currentProps(ctx.model);
      ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom: circle }));
      state.radius = circle.radius;
    },
  };
}

async function* circlePrompts(
  ctx: CommandContext,
  state: { radius: number },
): Sub<Circle | undefined> {
  const a = yield ctx.prompt.point({
    message: 'Specify center point for circle or',
    options: ['3P', '2P', 'Ttr (tan tan radius)'],
  });
  if (a.kind === 'point') return yield* byRadius(ctx, a.point, state.radius);
  if (a.kind !== 'keyword') return undefined;
  if (a.keyword === '3P') return yield* threePoints(ctx);
  if (a.keyword === '2P') return yield* twoPoints(ctx);
  return yield* tanTanRadius(ctx, state.radius);
}

async function* byRadius(ctx: CommandContext, center: Vec2, last: number): Sub<Circle | undefined> {
  let diameter = false;
  for (;;) {
    const a = yield withSketch(
      ctx,
      { shape: 'circle', center, ...(diameter && { diameter }) },
      diameter
        ? ctx.prompt.distance({
            message: 'Specify diameter of circle',
            base: center,
            ...(last > 0 && { default: { kind: 'distance', value: 2 * last } }),
          })
        : ctx.prompt.distance({
            message: 'Specify radius of circle or',
            options: ['Diameter'],
            base: center,
            ...(last > 0 && { default: { kind: 'distance', value: last } }),
          }),
    );
    if (a.kind === 'keyword') {
      diameter = true;
      continue;
    }
    if (a.kind !== 'distance') return undefined;
    const r = diameter ? a.value / 2 : a.value;
    if (r > 0) return { kind: 'CIRCLE', center, radius: r };
    ctx.message(POSITIVE);
  }
}

/** 3P's points take a deferred TANgent to a line, circle or arc. */
const TANGENTS: DeferredModes = { modes: OSNAP.TAN, straight: true };

/** A 3P answer as the construction takes it: the point, or the deferred tangent. */
const item = (a: PromptAnswer & { kind: 'point' }): DeferredItem => a.deferred ?? a.point;

async function* threePoints(ctx: CommandContext): Sub<Circle | undefined> {
  const a = yield ctx.prompt.point({
    message: 'Specify first point on circle',
    deferred: TANGENTS,
  });
  if (a.kind !== 'point') return undefined;
  const first = item(a);
  const b = yield ctx.prompt.point({
    message: 'Specify second point on circle',
    deferred: TANGENTS,
    // A tangent is not a point to stretch a rubber band from.
    ...(!isDeferred(first) && { rubberBand: { from: first } }),
  });
  if (b.kind !== 'point') return undefined;
  const second = item(b);
  for (;;) {
    const c = yield withSketch(
      ctx,
      { shape: 'circle3p', a: first, b: second },
      ctx.prompt.point({ message: 'Specify third point on circle', deferred: TANGENTS }),
    );
    if (c.kind !== 'point') return undefined;
    const third = item(c);
    const circle = circleThroughItems(
      [first, second, third],
      sketchTolerance(itemPoint(first), itemPoint(second), itemPoint(third)),
    );
    if (circle) return circle;
    ctx.message(NO_CIRCLE);
  }
}

async function* twoPoints(ctx: CommandContext): Sub<Circle | undefined> {
  const a = yield ctx.prompt.point({ message: "Specify first end point of circle's diameter" });
  if (a.kind !== 'point') return undefined;
  for (;;) {
    const b = yield withSketch(
      ctx,
      { shape: 'circle2p', a: a.point },
      ctx.prompt.point({
        message: "Specify second end point of circle's diameter",
        rubberBand: { from: a.point },
      }),
    );
    if (b.kind !== 'point') return undefined;
    const r = distance(a.point, b.point) / 2;
    if (r > sketchTolerance(a.point, b.point).linear) {
      return { kind: 'CIRCLE', center: midpoint(a.point, b.point), radius: r };
    }
    ctx.message(NO_CIRCLE);
  }
}

async function* tanTanRadius(ctx: CommandContext, last: number): Sub<Circle | undefined> {
  const first = yield* tangentPick(ctx, 'first');
  if (!first) return undefined;
  const second = yield* tangentPick(ctx, 'second');
  if (!second) return undefined;
  let r: number | undefined;
  while (r === undefined) {
    const a = yield ctx.prompt.distance({
      message: 'Specify radius of circle',
      ...(last > 0 && { default: { kind: 'distance', value: last } }),
    });
    if (a.kind !== 'distance') return undefined;
    if (a.value > 0) r = a.value;
    else ctx.message(POSITIVE);
  }
  const circle = circleTanTanRadius(
    first.target,
    first.pick,
    second.target,
    second.pick,
    r,
    sketchTolerance(first.pick, second.pick, { x: r, y: 0 }),
  );
  if (!circle) ctx.message(NO_CIRCLE);
  return circle;
}

/** "Specify point on object for … tangent of circle": the object picked and where. */
async function* tangentPick(
  ctx: CommandContext,
  which: 'first' | 'second',
): Sub<{ target: TangentTarget; pick: Vec2 } | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: `Specify point on object for ${which} tangent of circle`,
      single: true,
    });
    if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
    const entity = ctx.model.entity(a.ids[0]!);
    const pick = a.pick;
    const target = entity && pick && tangentTarget(entity, pick);
    if (target && pick) return { target, pick };
    // AutoCAD's TANgent snap finds nothing on such an object, and asks again.
    ctx.message('Select a line, circle, arc or polyline.');
  }
}

/** What a circle can be tangent to on `e`, near `pick`: a line, circle or arc, or a segment. */
export function tangentTarget(e: Entity, pick: Vec2): TangentTarget | undefined {
  const g = e.geom;
  switch (g.kind) {
    case 'LINE': {
      const d = sub(g.end, g.start);
      return d.x === 0 && d.y === 0 ? undefined : { kind: 'line', point: g.start, direction: d };
    }
    case 'XLINE':
    case 'RAY':
      return { kind: 'line', point: g.base, direction: g.direction };
    case 'CIRCLE':
    case 'ARC':
      return { kind: 'circle', center: g.center, radius: g.radius };
    case 'LWPOLYLINE': {
      if (g.vertices.length < 2) return undefined;
      const at = closestPoint(g, pick, sketchTolerance(pick, ...g.vertices));
      const n = g.closed ? g.vertices.length : g.vertices.length - 1;
      const seg = polylineSegment(g, Math.min(Math.floor(at.t), n - 1));
      if ('arc' in seg) return { kind: 'circle', center: seg.arc.center, radius: seg.arc.radius };
      const d = sub(seg.line.b, seg.line.a);
      return d.x === 0 && d.y === 0 ? undefined : { kind: 'line', point: seg.line.a, direction: d };
    }
    default:
      return undefined;
  }
}

function withSketch(ctx: CommandContext, sketch: Sketch, prompt: Prompt): Prompt {
  return { ...prompt, drag: { kind: 'sketch', sketch, layer: currentProps(ctx.model).layer } };
}
