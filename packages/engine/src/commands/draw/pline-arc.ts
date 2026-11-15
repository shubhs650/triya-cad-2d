// PLINE's arc segments (M3-01 part 3), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "PLINE
// (Command)", Arc):
//   Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Halfwidth/Line/Radius/Second pt/Undo/Width]:
//   Angle:      Specify included angle:
//               Specify endpoint of arc or [CEnter/Radius]:
//                 CEnter: Specify center point of arc:
//                 Radius: Specify radius of arc:, then Specify direction of chord for arc <…>:
//   CEnter:     Specify center point of arc:
//               Specify endpoint of arc or [Angle/Length]:
//                 Angle: Specify included angle:   Length: Specify length of chord:
//   Direction:  Specify the tangent direction for the start point of arc:
//               Specify endpoint of the arc:
//   Radius:     Specify radius of arc:
//               Specify endpoint of arc or [Angle]:
//                 Angle: Specify included angle:, then Specify direction of chord for arc <…>:
//   Second pt:  Specify second point on arc:
//               Specify end point of arc:
// An endpoint alone draws the arc tangent to the path so far. AutoCAD 2024 adds "(hold Ctrl to
// switch direction)" to the prompts that finish an arc but Second pt's (M3-01 part 6): a pick
// with Ctrl held draws it the other way round, as ARC's (`switchArc`). An answer that makes no arc (an end straight on
// along the tangent, a chord longer than the diameter) is refused with "*Invalid*" and asked
// again.
//
// `arcSegment` asks one segment and hands back the arc or the caller's own option, so the
// "next point" prompts of DIST and AREA (M3-07) can offer Arc with the same prompts.
import {
  arcStartCenterAngle,
  arcStartCenterChord,
  arcStartCenterEnd,
  arcStartDirectionEnd,
  arcStartEndAngle,
  arcStartEndRadius,
  arcThrough3,
} from '../../geom/construct';
import { normalizeAngle } from '../../geom/angle';
import type { BulgeArc } from '../../geom/eval';
import type { Vec2 } from '../../geom/types';
import { angleOf, fromAngle } from '../../geom/vec';
import type { Handle } from '../../model/handle';
import type { CommandContext } from '../command';
import { CTRL_SWITCH, type Prompt, type PromptAnswer } from '../prompt';
import { INVALID_ARC, switched } from './arc';
import { chordEnd, sketchTolerance, type ArcSketch } from './sketch';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

// What a prompt was answered with, read without checking its kind: `last` hands its `make` only
// the kind its prompt asks for (the bus refuses any other).
const pointOf = (a: PromptAnswer): Vec2 => (a as { point: Vec2 }).point;
const valueOf = (a: PromptAnswer): number => (a as { value: number }).value;

/** The arc's own options, which `arcSegment` answers itself. */
const ARC_OPTIONS = ['Angle', 'CEnter', 'Direction', 'Radius', 'Second pt'];

export interface ArcSegmentOptions {
  /** Where the segment starts. */
  readonly start: Vec2;
  /** The direction the path travels at `start` (an endpoint alone draws tangent to it). */
  readonly direction: Vec2;
  /**
   * The caller's options at the endpoint prompt (PLINE: CLose, Halfwidth, Line, Undo, Width),
   * listed with the arc's in AutoCAD's order (alphabetical).
   */
  readonly options: readonly string[];
  /** The layer the dragged segment is drawn on. */
  readonly layer: Handle;
  /** The dragged segment's widths at its start and end (PLINE's current widths). */
  readonly widths?: { readonly start: number; readonly end: number };
  /** Put before each prompt (AREA's "(SUBTRACT mode) "). */
  readonly prefix?: string;
  /**
   * The caller's options listed after the arc's, as given (DIST's and AREA's Total, last as in
   * their next-point prompts).
   */
  readonly after?: readonly string[];
  /** The option Enter takes at the endpoint prompt (DIST's and AREA's Total). */
  readonly default?: string;
}

/** What the endpoint prompt was answered with: an arc, one of the caller's options, Enter. */
export type ArcStep =
  | { readonly kind: 'arc'; readonly arc: BulgeArc }
  | { readonly kind: 'keyword'; readonly keyword: string }
  | { readonly kind: 'enter' };

/** One arc segment from `o.start`; undefined when the command is cancelled. */
export async function* arcSegment(
  ctx: CommandContext,
  o: ArcSegmentOptions,
): Sub<ArcStep | undefined> {
  const { start } = o;
  const prefix = o.prefix ?? '';
  const ask = (sketch: ArcSketch | undefined, prompt: Prompt): Prompt => {
    const p = { ...prompt, message: prefix + prompt.message };
    if (!sketch) return p;
    const w = o.widths ?? { start: 0, end: 0 };
    return {
      ...p,
      drag: {
        kind: 'sketch',
        sketch: { shape: 'pline', from: start, arc: sketch, startWidth: w.start, endWidth: w.end },
        layer: o.layer,
      },
    };
  };
  /** Asks until the answer makes an arc: the arc, or undefined at Esc. */
  const last = async function* (
    sketch: ArcSketch,
    prompt: Prompt,
    make: (a: PromptAnswer) => BulgeArc | undefined,
  ): Sub<BulgeArc | undefined> {
    for (;;) {
      const a = yield ask(sketch, prompt);
      if (a.kind === 'enter') return undefined;
      const arc = switched(sketch, a, make(a));
      if (arc) return arc;
      ctx.message(INVALID_ARC);
    }
  };
  const tol = (...p: Vec2[]) => sketchTolerance(start, ...p);
  const options = [
    ...[...o.options, ...ARC_OPTIONS].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    ),
    ...(o.after ?? []),
  ];
  for (;;) {
    const a = yield ask(
      { shape: 'arcTangent', start, direction: o.direction },
      ctx.prompt.point({
        message: `Specify endpoint of arc${CTRL_SWITCH} or`,
        options,
        rubberBand: { from: start },
        switchDirection: true,
        ...(o.default !== undefined && {
          default: { kind: 'keyword' as const, keyword: o.default },
        }),
      }),
    );
    let arc: BulgeArc | undefined;
    if (a.kind === 'point') {
      arc = switched(
        { shape: 'arcTangent', start, direction: o.direction },
        a,
        arcStartDirectionEnd(start, o.direction, a.point, tol(a.point)),
      );
      if (!arc) {
        ctx.message(INVALID_ARC);
        continue;
      }
      return { kind: 'arc', arc };
    }
    if (a.kind !== 'keyword') return { kind: 'enter' };
    switch (a.keyword) {
      case 'Angle':
        arc = yield* byAngle(ctx, start, o.direction, ask, last);
        break;
      case 'CEnter':
        arc = yield* byCenter(ctx, start, ask, last);
        break;
      case 'Direction': {
        const d = yield ask(
          undefined,
          ctx.prompt.angle({
            message: 'Specify the tangent direction for the start point of arc',
            base: start,
          }),
        );
        if (d.kind !== 'angle') return undefined;
        const dir = fromAngle(d.value);
        arc = yield* last(
          { shape: 'arcTangent', start, direction: dir },
          ctx.prompt.point({
            message: `Specify endpoint of the arc${CTRL_SWITCH}`,
            rubberBand: { from: start },
            switchDirection: true,
          }),
          (e) => arcStartDirectionEnd(start, dir, pointOf(e), tol(pointOf(e))),
        );
        break;
      }
      case 'Radius':
        arc = yield* byRadius(ctx, start, o.direction, ask, last);
        break;
      case 'Second pt': {
        const s = yield ask(
          undefined,
          ctx.prompt.point({ message: 'Specify second point on arc', rubberBand: { from: start } }),
        );
        if (s.kind !== 'point') return undefined;
        const second = s.point;
        arc = yield* last(
          { shape: 'arc3p', a: start, b: second },
          ctx.prompt.point({ message: 'Specify end point of arc' }),
          (e) => arcThrough3(start, second, pointOf(e), tol(second, pointOf(e))),
        );
        break;
      }
      default:
        return { kind: 'keyword', keyword: a.keyword };
    }
    return arc && { kind: 'arc', arc };
  }
}

type Ask = (sketch: ArcSketch | undefined, prompt: Prompt) => Prompt;
type Last = (
  sketch: ArcSketch,
  prompt: Prompt,
  make: (a: PromptAnswer) => BulgeArc | undefined,
) => Sub<BulgeArc | undefined>;

/** Angle: the included angle, then the end, the centre, or a radius and the chord's direction. */
async function* byAngle(
  ctx: CommandContext,
  start: Vec2,
  direction: Vec2,
  ask: Ask,
  last: Last,
): Sub<BulgeArc | undefined> {
  const g = yield ask(
    undefined,
    ctx.prompt.angle({ turn: true, message: 'Specify included angle', base: start }),
  );
  if (g.kind !== 'angle') return undefined;
  const angle = g.value;
  for (;;) {
    const a = yield ask(
      { shape: 'arcSA', by: 'end', start, angle },
      ctx.prompt.point({
        message: `Specify endpoint of arc${CTRL_SWITCH} or`,
        options: ['CEnter', 'Radius'],
        rubberBand: { from: start },
        switchDirection: true,
      }),
    );
    if (a.kind === 'point') {
      const arc = switched(
        { shape: 'arcSA', by: 'end', start, angle },
        a,
        arcStartEndAngle(start, a.point, angle, sketchTolerance(start, a.point)),
      );
      if (arc) return arc;
      ctx.message(INVALID_ARC);
      continue;
    }
    if (a.kind !== 'keyword') return undefined;
    if (a.keyword === 'CEnter') {
      return yield* last(
        { shape: 'arcSA', by: 'center', start, angle },
        ctx.prompt.point({
          message: `Specify center point of arc${CTRL_SWITCH}`,
          rubberBand: { from: start },
          switchDirection: true,
        }),
        (c) => arcStartCenterAngle(start, pointOf(c), angle, sketchTolerance(start, pointOf(c))),
      );
    }
    const r = yield* radius(ctx, start, ask);
    if (r === undefined) return undefined;
    return yield* chordDirection(ctx, start, direction, angle, r, last);
  }
}

/** CEnter: the centre, then the end, the included angle or the chord's length. */
async function* byCenter(
  ctx: CommandContext,
  start: Vec2,
  ask: Ask,
  last: Last,
): Sub<BulgeArc | undefined> {
  const c = yield ask(
    undefined,
    ctx.prompt.point({ message: 'Specify center point of arc', rubberBand: { from: start } }),
  );
  if (c.kind !== 'point') return undefined;
  const center = c.point;
  const tol = sketchTolerance(start, center);
  for (;;) {
    const a = yield ask(
      { shape: 'arcSC', by: 'end', start, center },
      ctx.prompt.point({
        message: `Specify endpoint of arc${CTRL_SWITCH} or`,
        options: ['Angle', 'Length'],
        rubberBand: { from: center },
        switchDirection: true,
      }),
    );
    if (a.kind === 'point') {
      const arc = switched(
        { shape: 'arcSC', by: 'end', start, center },
        a,
        arcStartCenterEnd(start, center, a.point, sketchTolerance(start, center, a.point)),
      );
      if (arc) return arc;
      ctx.message(INVALID_ARC);
      continue;
    }
    if (a.kind !== 'keyword') return undefined;
    if (a.keyword === 'Angle') {
      return yield* last(
        { shape: 'arcSC', by: 'angle', start, center },
        ctx.prompt.angle({
          turn: true,
          message: `Specify included angle${CTRL_SWITCH}`,
          base: center,
          switchDirection: true,
        }),
        (v) => arcStartCenterAngle(start, center, valueOf(v), tol),
      );
    }
    return yield* last(
      { shape: 'arcSC', by: 'chord', start, center },
      ctx.prompt.distance({
        message: `Specify length of chord${CTRL_SWITCH}`,
        base: start,
        switchDirection: true,
      }),
      (v) => arcStartCenterChord(start, center, valueOf(v), tol),
    );
  }
}

/** Radius: the radius, then the end, or an included angle and the chord's direction. */
async function* byRadius(
  ctx: CommandContext,
  start: Vec2,
  direction: Vec2,
  ask: Ask,
  last: Last,
): Sub<BulgeArc | undefined> {
  const r = yield* radius(ctx, start, ask);
  if (r === undefined) return undefined;
  for (;;) {
    const a = yield ask(
      { shape: 'arcSR', start, radius: r },
      ctx.prompt.point({
        message: `Specify endpoint of arc${CTRL_SWITCH} or`,
        options: ['Angle'],
        rubberBand: { from: start },
        switchDirection: true,
      }),
    );
    if (a.kind === 'point') {
      const arc = switched(
        { shape: 'arcSR', start, radius: r },
        a,
        arcStartEndRadius(start, a.point, r, sketchTolerance(start, a.point)),
      );
      if (arc) return arc;
      ctx.message(INVALID_ARC);
      continue;
    }
    if (a.kind !== 'keyword') return undefined;
    const g = yield ask(
      undefined,
      ctx.prompt.angle({ turn: true, message: 'Specify included angle', base: start }),
    );
    if (g.kind !== 'angle') return undefined;
    return yield* chordDirection(ctx, start, direction, g.value, r, last);
  }
}

/** "Specify radius of arc": above zero. */
async function* radius(ctx: CommandContext, start: Vec2, ask: Ask): Sub<number | undefined> {
  for (;;) {
    const a = yield ask(
      undefined,
      ctx.prompt.distance({ message: 'Specify radius of arc', base: start }),
    );
    if (a.kind !== 'distance') return undefined;
    if (a.value > 0) return a.value;
    ctx.message('Value must be positive and nonzero.');
  }
}

/**
 * "Specify direction of chord for arc": by default the chord of the arc that leaves `start`
 * tangent to `direction` (the tangent turned by half the included angle).
 */
async function* chordDirection(
  ctx: CommandContext,
  start: Vec2,
  direction: Vec2,
  angle: number,
  r: number,
  last: Last,
): Sub<BulgeArc | undefined> {
  const tangent = normalizeAngle(angleOf(direction) + angle / 2);
  return yield* last(
    { shape: 'arcSA', by: 'chord', start, angle, radius: r },
    ctx.prompt.angle({
      message: `Specify direction of chord for arc${CTRL_SWITCH}`,
      base: start,
      switchDirection: true,
      default: { kind: 'angle', value: tangent },
    }),
    (v) => {
      const end = chordEnd(start, angle, r, valueOf(v));
      return arcStartEndAngle(start, end, angle, sketchTolerance(start, end));
    },
  );
}
