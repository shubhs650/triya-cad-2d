// XLINE and RAY (M3-01 part 4), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "XLINE (Command)",
// "RAY (Command)"):
//   Specify a point or [Hor/Ver/Ang/Bisect/Offset]:      a point, then
//   Specify through point:                               again and again; Enter ends
//   Hor / Ver: Specify through point: (repeated)
//   Ang: Enter angle of xline (0) or [Reference]:        Reference: Select a line object:
//        Enter angle of xline <0>:  (from the line)       then Specify through point: (repeated)
//   Bisect: Specify angle vertex point:  Specify angle start point:  Specify angle end point: (repeated)
//   Offset: Specify offset distance or [Through] <Through>:
//        a distance: Select a line object:  Specify side to offset:  (repeated)
//        Through:    Select a line object:  Specify through point:   (repeated)
//   RAY: Specify start point:  Specify through point: (repeated)
// Each line is made as its point is given, as AutoCAD does, and dragged with the cursor before.
// A "line object" is a line, xline, ray or a straight polyline segment. The Ang prompt's
// "(0)" shows the last angle typed, which Enter takes again; the offset distance is
// remembered for the next XLINE Offset (AutoCAD keeps it in OFFSETDIST, shared with OFFSET;
// Triya's OFFSET keeps its own distance, so XLINE keeps its own too).
import type { Xline } from '../../geom/curves';
import { bisector, offsetXline, xlineThrough, type StraightLine } from '../../geom/shapes';
import type { Vec2 } from '../../geom/types';
import { angleOf, fromAngle, sub } from '../../geom/vec';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { currentProps } from '../../properties/current';
import { drawingUnits, formatAngle, formatDistance } from '../units';
import { tangentTarget } from './circle';
import { sketchTolerance, type Sketch } from './sketch';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** XLINE for one document: it remembers the last Ang angle and Offset distance. */
export function xlineCommand(): CommandDef {
  // `offset` undefined is Through, AutoCAD's initial OFFSETDIST (−1).
  const state: { angle: number; offset: number | undefined } = { angle: 0, offset: undefined };
  return {
    name: 'XLINE',
    async *run(ctx) {
      const a = yield ctx.prompt.point({
        message: 'Specify a point or',
        options: ['Hor', 'Ver', 'Ang', 'Bisect', 'Offset'],
      });
      if (a.kind === 'point') return yield* throughPoints(ctx, a.point, 'XLINE');
      if (a.kind !== 'keyword') return;
      switch (a.keyword) {
        case 'Hor':
          return yield* alongDirection(ctx, { x: 1, y: 0 });
        case 'Ver':
          return yield* alongDirection(ctx, { x: 0, y: 1 });
        case 'Ang':
          return yield* byAngle(ctx, state);
        case 'Bisect':
          return yield* bisect(ctx);
        default:
          return yield* byOffset(ctx, state);
      }
    },
  };
}

export function rayCommand(): CommandDef {
  return {
    name: 'RAY',
    async *run(ctx) {
      const a = yield ctx.prompt.point({ message: 'Specify start point' });
      if (a.kind !== 'point') return;
      yield* throughPoints(ctx, a.point, 'RAY');
    },
  };
}

function add(ctx: CommandContext, geom: Xline | { kind: 'RAY'; base: Vec2; direction: Vec2 }) {
  const props = currentProps(ctx.model);
  ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom }));
}

/** XLINEs (or RAYs) from `base` through each point given, until Enter. */
async function* throughPoints(ctx: CommandContext, base: Vec2, kind: 'XLINE' | 'RAY'): Sub<void> {
  for (;;) {
    const a = yield withSketch(
      ctx,
      kind === 'XLINE' ? { shape: 'xline', base } : { shape: 'ray', base },
      ctx.prompt.point({ message: 'Specify through point', rubberBand: { from: base } }),
    );
    if (a.kind !== 'point') return;
    // The through point on the base point makes no line; AutoCAD asks again.
    const x = xlineThrough(base, sub(a.point, base), sketchTolerance(base, a.point));
    if (x) add(ctx, kind === 'XLINE' ? x : { kind: 'RAY', base: x.base, direction: x.direction });
  }
}

/** XLINEs along `direction` through each point given (Hor, Ver, Ang, Offset Through). */
async function* alongDirection(ctx: CommandContext, direction: Vec2): Sub<void> {
  for (;;) {
    const a = yield withSketch(
      ctx,
      { shape: 'xlineDirection', direction },
      ctx.prompt.point({ message: 'Specify through point' }),
    );
    if (a.kind !== 'point') return;
    const x = xlineThrough(a.point, direction, sketchTolerance(a.point));
    if (x) add(ctx, x);
  }
}

async function* byAngle(ctx: CommandContext, state: { angle: number }): Sub<void> {
  const units = drawingUnits(ctx.model.header);
  const a = yield ctx.prompt.angle({
    message: `Enter angle of xline (${formatAngle(state.angle, units)}) or`,
    options: ['Reference'],
  });
  if (a.kind === 'enter') return yield* alongDirection(ctx, fromAngle(state.angle));
  if (a.kind === 'angle') {
    state.angle = a.value;
    return yield* alongDirection(ctx, fromAngle(a.value));
  }
  if (a.kind !== 'keyword') return;
  const line = yield* lineObject(ctx);
  if (!line) return;
  // Reference: the angle counts counter-clockwise from the line, typed or Enter for 0.
  const zero = angleOf(line.direction);
  const r = yield ctx.prompt.angle({ message: 'Enter angle of xline', defaultLabel: '0', zero });
  if (r.kind !== 'angle' && r.kind !== 'enter') return;
  yield* alongDirection(ctx, fromAngle(r.kind === 'angle' ? r.value : zero));
}

async function* bisect(ctx: CommandContext): Sub<void> {
  const v = yield ctx.prompt.point({ message: 'Specify angle vertex point' });
  if (v.kind !== 'point') return;
  const vertex = v.point;
  const s = yield withSketch(
    ctx,
    { shape: 'xline', base: vertex },
    ctx.prompt.point({ message: 'Specify angle start point', rubberBand: { from: vertex } }),
  );
  if (s.kind !== 'point') return;
  const start = s.point;
  for (;;) {
    const e = yield withSketch(
      ctx,
      { shape: 'xlineBisect', vertex, start },
      ctx.prompt.point({ message: 'Specify angle end point', rubberBand: { from: vertex } }),
    );
    if (e.kind !== 'point') return;
    const x = bisector(vertex, start, e.point, sketchTolerance(vertex, start, e.point));
    if (x) add(ctx, x);
  }
}

async function* byOffset(ctx: CommandContext, state: { offset: number | undefined }): Sub<void> {
  const units = drawingUnits(ctx.model.header);
  let distance: number | undefined;
  for (;;) {
    const a = yield ctx.prompt.distance({
      message: 'Specify offset distance or',
      options: ['Through'],
      defaultLabel: state.offset === undefined ? 'Through' : formatDistance(state.offset, units),
    });
    if (a.kind === 'keyword' || (a.kind === 'enter' && state.offset === undefined)) {
      state.offset = undefined;
      break;
    }
    if (a.kind === 'enter') {
      distance = state.offset;
      break;
    }
    if (a.kind !== 'distance') return;
    if (a.value > 0) {
      distance = state.offset = a.value;
      break;
    }
    ctx.message('Value must be positive and nonzero.');
  }
  for (;;) {
    const line = yield* lineObject(ctx);
    if (!line) return;
    const side = yield withSketch(
      ctx,
      distance === undefined
        ? { shape: 'xlineDirection', direction: line.direction }
        : { shape: 'xlineOffset', line, distance },
      ctx.prompt.point({
        message: distance === undefined ? 'Specify through point' : 'Specify side to offset',
      }),
    );
    if (side.kind !== 'point') return;
    const x = offsetXline(line, side.point, distance, sketchTolerance(line.point, side.point));
    if (x) add(ctx, x);
  }
}

/** "Select a line object:" until one is picked: its line, or undefined on Enter or Esc. */
async function* lineObject(ctx: CommandContext): Sub<StraightLine | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: 'Select a line object', single: true });
    if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
    const e = ctx.model.entity(a.ids[0]!);
    const t = e && a.pick && tangentTarget(e, a.pick);
    if (t?.kind === 'line') return { point: t.point, direction: t.direction };
    ctx.message('Selected entity is not a line, polyline, xline or ray.');
  }
}

function withSketch(ctx: CommandContext, sketch: Sketch, prompt: Prompt): Prompt {
  return { ...prompt, drag: { kind: 'sketch', sketch, layer: currentProps(ctx.model).layer } };
}
