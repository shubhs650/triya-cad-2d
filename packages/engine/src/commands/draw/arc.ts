// ARC (M3-01): AutoCAD 2024's eleven ways to draw an arc, on its prompts (AutoCAD 2024 Help,
// "ARC (Command)", "To Draw Arcs"):
//   Specify start point of arc or [Center]:              Enter: continue from the last line/arc
//   Specify second point of arc or [Center/End]:         a point: 3P
//   Specify end point of arc:                            3P; also after End
//   Specify center point of arc:                         after Center
//   Specify end point of arc or [Angle/chord Length]:    after a start and centre: SCE, CSE
//   Specify included angle:                              SCA, CSA, SEA
//   Specify length of chord:                             SCL, CSL
//   Specify center point of arc or [Angle/Direction/Radius]:   after a start and end: SEC
//   Specify tangent direction for the start point of arc:      SED
//   Specify radius of arc:                                     SER
// AutoCAD 2024 adds "(hold Ctrl to switch direction)" to the last prompts; Triya's front-ends
// have no such modifier yet, so the prompts leave it out (a negative angle, chord or radius
// still draws the other way, as typed values do in AutoCAD).
//
// Each construction is in `geom/construct.ts`; while the last value is asked, the arc it would
// give is dragged with the cursor (`sketch.ts`). An impossible answer (three collinear points, a
// chord longer than the diameter) is refused with "*Invalid*" and asked again: AutoCAD's help
// does not word its refusals, and this is the message its command line gives for them.
import type { BulgeArc } from '../../geom/eval';
import type { Vec2 } from '../../geom/types';
import { fromAngle } from '../../geom/vec';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { currentProps } from '../../properties/current';
import { lastDrawn, type LastDrawn } from './last-drawn';
import { sketchTolerance, type Sketch } from './sketch';
import {
  arcEnd,
  arcStartCenterAngle,
  arcStartCenterChord,
  arcStartCenterEnd,
  arcStartDirectionEnd,
  arcStartEndAngle,
  arcStartEndCenter,
  arcStartEndRadius,
  arcThrough3,
  dxfArc,
} from '../../geom/construct';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
type ArcSketch = Exclude<Sketch, { shape: 'circle' | 'circle2p' | 'circle3p' }>;

export const INVALID_ARC = '*Invalid*';

/** ARC for one document; `last` is shared with LINE (`builtinCommands`). */
export function arcCommand(last: LastDrawn = lastDrawn()): CommandDef {
  return {
    name: 'ARC',
    async *run(ctx) {
      const arc = yield* arcPrompts(ctx, last);
      if (!arc) return;
      const props = currentProps(ctx.model);
      ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom: dxfArc(arc) }));
      last.end = { ...arcEnd(arc), arc: true };
    },
  };
}

async function* arcPrompts(ctx: CommandContext, last: LastDrawn): Sub<BulgeArc | undefined> {
  for (;;) {
    const a = yield ctx.prompt.point({
      message: 'Specify start point of arc or',
      options: ['Center'],
    });
    if (a.kind === 'point') return yield* afterStart(ctx, a.point);
    if (a.kind === 'keyword') {
      const c = yield ctx.prompt.point({ message: 'Specify center point of arc' });
      if (c.kind !== 'point') return undefined;
      const s = yield ctx.prompt.point({
        message: 'Specify start point of arc',
        rubberBand: { from: c.point },
      });
      if (s.kind !== 'point') return undefined;
      return yield* afterStartCenter(ctx, s.point, c.point);
    }
    if (a.kind !== 'enter') return undefined;
    if (!last.end) {
      ctx.message('No line or arc to continue.');
      continue;
    }
    // Continue: tangent to the last line or arc, from its end (AutoCAD 2024 Help, "ARC").
    const { point: start, direction } = last.end;
    return yield* final(
      ctx,
      { shape: 'arcTangent', start, direction },
      ctx.prompt.point({ message: 'Specify end point of arc', rubberBand: { from: start } }),
      (e) =>
        e.kind === 'point'
          ? arcStartDirectionEnd(start, direction, e.point, sketchTolerance(start, e.point))
          : undefined,
    );
  }
}

async function* afterStart(ctx: CommandContext, start: Vec2): Sub<BulgeArc | undefined> {
  const a = yield ctx.prompt.point({
    message: 'Specify second point of arc or',
    options: ['Center', 'End'],
    rubberBand: { from: start },
  });
  if (a.kind === 'point') {
    const second = a.point;
    return yield* final(
      ctx,
      { shape: 'arc3p', a: start, b: second },
      ctx.prompt.point({ message: 'Specify end point of arc' }),
      (e) =>
        e.kind === 'point'
          ? arcThrough3(start, second, e.point, sketchTolerance(start, second, e.point))
          : undefined,
    );
  }
  if (a.kind !== 'keyword') return undefined;
  if (a.keyword === 'Center') {
    const c = yield ctx.prompt.point({
      message: 'Specify center point of arc',
      rubberBand: { from: start },
    });
    if (c.kind !== 'point') return undefined;
    return yield* afterStartCenter(ctx, start, c.point);
  }
  const e = yield ctx.prompt.point({
    message: 'Specify end point of arc',
    rubberBand: { from: start },
  });
  if (e.kind !== 'point') return undefined;
  return yield* afterStartEnd(ctx, start, e.point);
}

/** SCE, SCA, SCL (and CSE, CSA, CSL, which give the same two points the other way round). */
async function* afterStartCenter(
  ctx: CommandContext,
  start: Vec2,
  center: Vec2,
): Sub<BulgeArc | undefined> {
  const sketch = (by: 'end' | 'angle' | 'chord'): ArcSketch => ({
    shape: 'arcSC',
    by,
    start,
    center,
  });
  const tol = sketchTolerance(start, center);
  for (;;) {
    const a = yield withSketch(
      ctx,
      sketch('end'),
      ctx.prompt.point({
        message: 'Specify end point of arc or',
        options: ['Angle', 'chord Length'],
        rubberBand: { from: center },
      }),
    );
    if (a.kind === 'point') {
      const arc = arcStartCenterEnd(
        start,
        center,
        a.point,
        sketchTolerance(start, center, a.point),
      );
      if (arc) return arc;
      ctx.message(INVALID_ARC);
      continue;
    }
    if (a.kind !== 'keyword') return undefined;
    if (a.keyword === 'Angle') {
      return yield* final(
        ctx,
        sketch('angle'),
        ctx.prompt.angle({ message: 'Specify included angle', base: center }),
        (v) => (v.kind === 'angle' ? arcStartCenterAngle(start, center, v.value, tol) : undefined),
      );
    }
    return yield* final(
      ctx,
      sketch('chord'),
      ctx.prompt.distance({ message: 'Specify length of chord', base: start }),
      (v) => (v.kind === 'distance' ? arcStartCenterChord(start, center, v.value, tol) : undefined),
    );
  }
}

/** SEC, SEA, SED, SER. */
async function* afterStartEnd(
  ctx: CommandContext,
  start: Vec2,
  end: Vec2,
): Sub<BulgeArc | undefined> {
  const sketch = (by: 'center' | 'angle' | 'direction' | 'radius'): ArcSketch => ({
    shape: 'arcSE',
    by,
    start,
    end,
  });
  const tol = sketchTolerance(start, end);
  for (;;) {
    const a = yield withSketch(
      ctx,
      sketch('center'),
      ctx.prompt.point({
        message: 'Specify center point of arc or',
        options: ['Angle', 'Direction', 'Radius'],
        rubberBand: { from: end },
      }),
    );
    if (a.kind === 'point') {
      const arc = arcStartEndCenter(start, end, a.point, sketchTolerance(start, end, a.point));
      if (arc) return arc;
      ctx.message(INVALID_ARC);
      continue;
    }
    if (a.kind !== 'keyword') return undefined;
    switch (a.keyword) {
      case 'Angle':
        return yield* final(
          ctx,
          sketch('angle'),
          ctx.prompt.angle({ message: 'Specify included angle', base: start }),
          (v) => (v.kind === 'angle' ? arcStartEndAngle(start, end, v.value, tol) : undefined),
        );
      case 'Direction':
        return yield* final(
          ctx,
          sketch('direction'),
          ctx.prompt.angle({
            message: 'Specify tangent direction for the start point of arc',
            base: start,
          }),
          (v) =>
            v.kind === 'angle'
              ? arcStartDirectionEnd(start, fromAngle(v.value), end, tol)
              : undefined,
        );
      default:
        return yield* final(
          ctx,
          sketch('radius'),
          ctx.prompt.distance({ message: 'Specify radius of arc', base: end }),
          (v) => (v.kind === 'distance' ? arcStartEndRadius(start, end, v.value, tol) : undefined),
        );
    }
  }
}

/**
 * The last prompt: asked, with the arc dragged, until its answer makes an arc; undefined when
 * it is answered otherwise (Enter).
 */
async function* final(
  ctx: CommandContext,
  sketch: ArcSketch,
  prompt: Prompt,
  make: (a: PromptAnswer) => BulgeArc | undefined,
): Sub<BulgeArc | undefined> {
  for (;;) {
    const a = yield withSketch(ctx, sketch, prompt);
    if (a.kind === 'enter' || a.kind === 'keyword') return undefined;
    const arc = make(a);
    if (arc) return arc;
    ctx.message(INVALID_ARC);
  }
}

function withSketch(ctx: CommandContext, sketch: ArcSketch, prompt: Prompt): Prompt {
  return { ...prompt, drag: { kind: 'sketch', sketch, layer: currentProps(ctx.model).layer } };
}
