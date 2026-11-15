// ELLIPSE (M3-01 part 4), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "ELLIPSE (Command)"):
//   Specify axis endpoint of ellipse or [Arc/Center]:
//   Specify other endpoint of axis:
//   Specify distance to other axis or [Rotation]:          Rotation: Specify rotation around major axis:
//   Center: Specify center of ellipse:  Specify endpoint of axis:  then the other axis
//   Arc: Specify axis endpoint of elliptical arc or [Center]:  the axes, then
//        Specify start angle or [Parameter]:               Parameter: Specify start parameter or [Angle]:
//        Specify end angle or [Parameter/Included angle]:   Specify end parameter or [Angle/Included angle]:
//        Included angle: Specify included angle for arc <180>:
// The first axis may be the major or the minor one (`geom/shapes.ts`). Arc angles count CCW
// from the first axis endpoint, typed ones too (`AnglePrompt.zero`). Isocircle is offered only
// with isometric snap, which Triya does not have yet (M3-06). With PELLIPSE 1 (part 6) ELLIPSE
// makes a closed polyline of arcs instead (`ellipsePolyline`) and leaves Arc out of its first
// prompt, as AutoCAD's does: a polyline ellipse cannot be an elliptical arc. AutoCAD's help
// does not word its refusals; "*Invalid*" is what its command line gives for them (as ARC).
import { normalizeAngle, TAU } from '../../geom/angle';
import type { Ellipse } from '../../geom/curves';
import {
  ellipseOf,
  ellipsePolyline,
  firstAxisAngle,
  otherFromRotation,
  type EllipseAxes,
} from '../../geom/ellipse-xline';
import type { Vec2 } from '../../geom/types';
import type { EntityGeometry } from '../../model/types';
import { midpoint, sub } from '../../geom/vec';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { currentProps } from '../../properties/current';
import { sketchTolerance, type Sketch } from './sketch';
import { arcEndParameter } from './sketch-shapes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

export const INVALID = '*Invalid*';

export function ellipseCommand(): CommandDef {
  return {
    name: 'ELLIPSE',
    async *run(ctx) {
      const polyline = ctx.model.header.get('$PELLIPSE') === 1;
      const e = yield* ellipsePrompts(ctx, polyline);
      if (!e) return;
      const props = currentProps(ctx.model);
      const vertices = polyline ? ellipsePolyline(e, tolOfEllipse(e)) : undefined;
      const geom: EntityGeometry = vertices ? { kind: 'LWPOLYLINE', vertices, closed: true } : e;
      ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom }));
    },
  };
}

async function* ellipsePrompts(ctx: CommandContext, polyline: boolean): Sub<Ellipse | undefined> {
  const a = yield ctx.prompt.point({
    message: 'Specify axis endpoint of ellipse or',
    options: polyline ? ['Center'] : ['Arc', 'Center'],
  });
  if (a.kind === 'keyword' && a.keyword === 'Arc') {
    const axes = yield* arcAxes(ctx);
    return axes && (yield* arcAngles(ctx, axes));
  }
  if (a.kind === 'keyword') {
    const axes = yield* fromCenter(ctx);
    return axes && ellipseOf(axes, tolOf(axes));
  }
  if (a.kind !== 'point') return undefined;
  const axes = yield* fromAxisEnd(ctx, a.point);
  return axes && ellipseOf(axes, tolOf(axes));
}

/** The axes of an elliptical arc (after Arc). */
async function* arcAxes(ctx: CommandContext): Sub<EllipseAxes | undefined> {
  const a = yield ctx.prompt.point({
    message: 'Specify axis endpoint of elliptical arc or',
    options: ['Center'],
  });
  if (a.kind === 'keyword') return yield* fromCenter(ctx);
  if (a.kind !== 'point') return undefined;
  return yield* fromAxisEnd(ctx, a.point);
}

async function* fromAxisEnd(ctx: CommandContext, first: Vec2): Sub<EllipseAxes | undefined> {
  for (;;) {
    const b = yield ctx.prompt.point({
      message: 'Specify other endpoint of axis',
      rubberBand: { from: first },
    });
    if (b.kind !== 'point') return undefined;
    const center = midpoint(first, b.point);
    const axis = sub(first, center);
    if (tooShort(axis, first, b.point)) {
      ctx.message(INVALID);
      continue;
    }
    return yield* otherAxis(ctx, center, axis);
  }
}

async function* fromCenter(ctx: CommandContext): Sub<EllipseAxes | undefined> {
  const c = yield ctx.prompt.point({ message: 'Specify center of ellipse' });
  if (c.kind !== 'point') return undefined;
  for (;;) {
    const e = yield ctx.prompt.point({
      message: 'Specify endpoint of axis',
      rubberBand: { from: c.point },
    });
    if (e.kind !== 'point') return undefined;
    const axis = sub(e.point, c.point);
    if (tooShort(axis, c.point, e.point)) {
      ctx.message(INVALID);
      continue;
    }
    return yield* otherAxis(ctx, c.point, axis);
  }
}

/** "Specify distance to other axis or [Rotation]", the ellipse dragged with the cursor. */
async function* otherAxis(
  ctx: CommandContext,
  center: Vec2,
  axis: Vec2,
): Sub<EllipseAxes | undefined> {
  let rotation = false;
  for (;;) {
    const a = yield withSketch(
      ctx,
      { shape: 'ellipse', center, axis, by: rotation ? 'rotation' : 'distance' },
      rotation
        ? // A typed rotation is the angle itself, whatever ANGBASE says.
          ctx.prompt.angle({ message: 'Specify rotation around major axis', base: center, zero: 0 })
        : ctx.prompt.distance({
            message: 'Specify distance to other axis or',
            options: ['Rotation'],
            base: center,
          }),
    );
    if (a.kind === 'keyword') {
      rotation = true;
      continue;
    }
    const other =
      a.kind === 'distance'
        ? a.value
        : a.kind === 'angle'
          ? otherFromRotation(axis, a.value)
          : undefined;
    if (a.kind !== 'distance' && a.kind !== 'angle') return undefined;
    const axes = other === undefined ? undefined : { center, axis, other };
    if (axes && ellipseOf(axes, tolOf(axes))) return axes;
    ctx.message(INVALID);
  }
}

/** The start and end of an elliptical arc on `axes`. */
async function* arcAngles(ctx: CommandContext, axes: EllipseAxes): Sub<Ellipse | undefined> {
  const zero = firstAxisAngle(axes);
  /** An angle answer as an angle from the first axis (picked or typed, `zero`). */
  const fromAxis = (value: number) => normalizeAngle(value - zero);
  let parameter = false;
  let start: { u: number; angle: number } | undefined;
  while (!start) {
    const a = yield withSketch(
      ctx,
      { shape: 'ellipseArc', axes },
      ctx.prompt.angle({
        message: parameter ? 'Specify start parameter or' : 'Specify start angle or',
        options: [parameter ? 'Angle' : 'Parameter'],
        base: axes.center,
        zero,
      }),
    );
    if (a.kind === 'keyword') {
      parameter = !parameter;
      continue;
    }
    if (a.kind !== 'angle') return undefined;
    const v = fromAxis(a.value);
    const u = parameter ? v : arcEndParameter(axes, { u: 0, angle: 0 }, 'angle', v);
    start = { u, angle: parameter ? angleOfParameter(axes, u) : v };
  }
  for (;;) {
    const a = yield withSketch(
      ctx,
      { shape: 'ellipseArc', axes, start, by: parameter ? 'parameter' : 'angle' },
      ctx.prompt.angle({
        message: parameter ? 'Specify end parameter or' : 'Specify end angle or',
        options: [parameter ? 'Angle' : 'Parameter', 'Included angle'],
        base: axes.center,
        zero,
      }),
    );
    if (a.kind === 'keyword' && a.keyword === 'Included angle') break;
    if (a.kind === 'keyword') {
      parameter = !parameter;
      continue;
    }
    if (a.kind !== 'angle') return undefined;
    const u1 = arcEndParameter(axes, start, parameter ? 'parameter' : 'angle', fromAxis(a.value));
    return arcOf(axes, start.u, u1);
  }
  const a = yield withSketch(
    ctx,
    { shape: 'ellipseArc', axes, start, by: 'included' },
    ctx.prompt.angle({
      message: 'Specify included angle for arc',
      base: axes.center,
      zero: 0,
      default: { kind: 'angle', value: Math.PI },
    }),
  );
  if (a.kind !== 'angle') return undefined;
  return arcOf(axes, start.u, arcEndParameter(axes, start, 'included', a.value));
}

/** The arc CCW from `u0` to `u1` (a whole ellipse when they meet). */
function arcOf(axes: EllipseAxes, u0: number, u1: number): Ellipse | undefined {
  return ellipseOf(axes, tolOf(axes), u0, u1 <= u0 ? u1 + TAU : u1);
}

/** The angle from the first axis of the point at first-axis parameter `u`. */
function angleOfParameter(axes: EllipseAxes, u: number): number {
  const a = Math.hypot(axes.axis.x, axes.axis.y);
  return normalizeAngle(Math.atan2(Math.abs(axes.other) * Math.sin(u), a * Math.cos(u)));
}

const tolOfEllipse = (e: Ellipse) =>
  sketchTolerance(e.center, { x: e.center.x + e.majorAxis.x, y: e.center.y + e.majorAxis.y });

const tolOf = (e: EllipseAxes) =>
  sketchTolerance(
    e.center,
    { x: e.center.x + e.axis.x, y: e.center.y + e.axis.y },
    {
      x: e.other,
      y: 0,
    },
  );

function tooShort(axis: Vec2, a: Vec2, b: Vec2): boolean {
  return !(Math.hypot(axis.x, axis.y) > sketchTolerance(a, b).linear);
}

function withSketch(ctx: CommandContext, sketch: Sketch, prompt: Prompt): Prompt {
  return { ...prompt, drag: { kind: 'sketch', sketch, layer: currentProps(ctx.model).layer } };
}
