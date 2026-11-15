// BREAK, BREAKATPOINT and LENGTHEN (M3-02 part 4), with AutoCAD 2024's prompts and options
// (AutoCAD Help, "BREAK (Command)", "LENGTHEN (Command)"):
//
//   Select object:
//   Specify second break point or [First point]:
//
// BREAK takes the point the object was picked at as the first break point (asking for it when
// the object came from a window or a pre-selection); First point gives it again. A second point
// off the object is taken where the object is nearest it, so a point past an end breaks that
// end off; `@` (the first point again) splits the object in two. BREAKATPOINT asks for one
// point and splits there.
//
//   Select an object to measure or [DElta/Percent/Total/DYnamic] <DElta>:
//   Select an object to change or [Undo]:
//
// LENGTHEN reports the length of a picked object ("Current length: 10.0000", and an arc's
// included angle) until a mode is chosen; Enter takes the mode last used (DElta at first, which
// AutoCAD 2024 shows: the help does not name the first default). Each pick then changes the end
// nearer the pick, until Enter; Undo takes back the last change. DElta and Total take an
// Angle for arcs. The geometry is `edit/break.ts`'s.
import { ccwSweep } from '../../geom/angle';
import type { Curve } from '../../geom/curves';
import { closestPoint } from '../../geom/closest';
import type { Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import {
  breakCurveOf,
  breakGeometry,
  lengthenGeometry,
  lengthTo,
  measureLength,
  movesEnd,
  type BreakProblem,
  type LengthenProblem,
} from '../../edit/break';
import { reshapeObject, revertChanges } from '../../edit/edit';
import { isClosedCurve } from '../../edit/trim';
import type { ChangeSet } from '../../model/changeset';
import type { EntityId } from '../../model/entity-ids';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatAngle, formatDistance } from '../units';
import { toleranceFor } from './offset';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const BREAK_PROBLEM: Record<BreakProblem, string> = {
  'full circle': 'Arc cannot be full 360 degrees.',
  'closed at a point': 'A closed object cannot be broken at a single point.',
  'nothing left': 'The break points leave nothing of the object.',
};

/** The object picked at `point` in the space being drawn in, one with a curve first. */
export async function pickedObject(
  ctx: CommandContext,
  point: Vec2,
): Promise<EntityId | undefined> {
  const r = await ctx.view.request({ op: 'pick', point });
  const hits = (r.ok ? (r.ids ?? []) : []).filter(
    (id) => ctx.model.entity(id)?.owner === ctx.space,
  );
  // Under a hatch the line it is drawn up to is what a drafter means.
  return hits.find((h) => breakCurveOf(ctx.model.entity(h)!.geom)) ?? hits[0];
}

const locked = (ctx: CommandContext, id: EntityId): boolean =>
  ctx.model.tables.layers.get(ctx.model.entity(id)?.layer ?? '')?.locked === true;

// ── BREAK, BREAKATPOINT ─────────────────────────────────────────────────────────────────────

export function breakCommand(): CommandDef {
  return {
    name: 'BREAK',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({
        message: 'Select object',
        single: true,
        pickfirst: true,
        editable: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const id = a.ids[0]!;
      const c = curveOf(ctx, id);
      if (!c) return;
      let first = a.pick;
      let second: Vec2 | undefined;
      if (first) {
        const s = yield ctx.prompt.point({
          message: 'Specify second break point or',
          options: ['First point'],
          lastPoint: first,
          rubberBand: { from: first },
        });
        if (s.kind === 'point') second = s.point;
        else if (s.kind !== 'keyword') return;
        else first = undefined;
      }
      if (!first || !second) {
        const f = yield ctx.prompt.point({ message: 'Specify first break point' });
        if (f.kind !== 'point') return;
        first = f.point;
        const s = yield ctx.prompt.point({
          message: 'Specify second break point',
          lastPoint: first,
          rubberBand: { from: first },
        });
        if (s.kind !== 'point') return;
        second = s.point;
      }
      breakAt(ctx, id, c, first, second);
    },
  };
}

export function breakAtPointCommand(): CommandDef {
  return {
    name: 'BREAKATPOINT',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({
        message: 'Select object',
        single: true,
        pickfirst: true,
        editable: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const id = a.ids[0]!;
      const c = curveOf(ctx, id);
      if (!c) return;
      const p = yield ctx.prompt.point({ message: 'Specify break point' });
      if (p.kind !== 'point') return;
      breakAt(ctx, id, c, p.point, p.point);
    },
  };
}

/** The curve BREAK works on, or undefined (having said so) for an object it cannot break. */
function curveOf(ctx: CommandContext, id: EntityId): Curve | undefined {
  const e = ctx.model.entity(id);
  const c = e && breakCurveOf(e.geom);
  if (!c) ctx.message('Cannot break that object.');
  return c;
}

function breakAt(ctx: CommandContext, id: EntityId, c: Curve, p1: Vec2, p2: Vec2): void {
  const e = ctx.model.entity(id)!;
  const tol = toleranceFor(ctx.model, c);
  const t1 = closestPoint(c, p1, tol).t;
  const t2 = p1 === p2 ? t1 : closestPoint(c, p2, tol).t;
  const r = breakGeometry(e.geom, c, t1, t2, tol);
  if (typeof r === 'string') {
    ctx.message(BREAK_PROBLEM[r]);
    return;
  }
  // Both points at one end leave the object as it was.
  if (r.length === 1 && r[0] === e.geom) return;
  ctx.edit((b) => reshapeObject(b, ctx.model, id, r));
}

// ── LENGTHEN ────────────────────────────────────────────────────────────────────────────────

type Mode = 'DElta' | 'Percent' | 'Total' | 'DYnamic';
const MODES: readonly Mode[] = ['DElta', 'Percent', 'Total', 'DYnamic'];

/** LENGTHEN's values, kept while the drawing is open as AutoCAD keeps them. */
interface LengthenSettings {
  mode: Mode;
  delta: number;
  /** DElta Angle: the arc's included angle changes by `deltaAngle` (radians). */
  deltaAngle: number;
  /** Whether DElta (Total) works on arcs' angles. */
  deltaByAngle: boolean;
  percent: number;
  total: number;
  totalAngle: number;
  totalByAngle: boolean;
}

const LENGTHEN_PROBLEM: Record<LengthenProblem, string> = {
  closed: 'Cannot lengthen a closed object.',
  invalid: 'The new length must be more than zero.',
  'too long': 'Arc cannot be full 360 degrees.',
  'not an arc': 'Only an arc has an included angle.',
};

export function lengthenCommand(): CommandDef {
  const s: LengthenSettings = {
    mode: 'DElta',
    delta: 0,
    deltaAngle: 0,
    deltaByAngle: false,
    percent: 100,
    total: 1,
    // AutoCAD offers one radian (57°) as the first total angle.
    totalAngle: 1,
    totalByAngle: false,
  };
  return {
    name: 'LENGTHEN',
    async *run(ctx) {
      const units = drawingUnits(ctx.model.header);
      for (;;) {
        const a = yield ctx.prompt.point({
          message: 'Select an object to measure or',
          options: [...MODES],
          default: { kind: 'keyword', keyword: s.mode },
          pickbox: true,
        });
        if (a.kind === 'point') {
          const id = await pickedObject(ctx, a.point);
          const e = id === undefined ? undefined : ctx.model.entity(id);
          const c = e && breakCurveOf(e.geom);
          const m = c && measureLength(c);
          if (!m) {
            ctx.message('That object has no length to measure.');
            continue;
          }
          const length = `Current length: ${formatDistance(m.length, units)}`;
          ctx.message(
            m.angle === undefined
              ? length
              : `${length}, included angle: ${formatAngle(m.angle, units)}`,
          );
          continue;
        }
        if (a.kind !== 'keyword') return;
        s.mode = a.keyword as Mode;
        const ok = yield* askValue(ctx, s);
        if (!ok) return;
        yield* changeObjects(ctx, s);
        return;
      }
    },
  };
}

/** The mode's value: false when the prompt was left (Esc, or an answer that is none). */
async function* askValue(ctx: CommandContext, s: LengthenSettings): Sub<boolean> {
  switch (s.mode) {
    case 'DElta': {
      const a = yield ctx.prompt.distance({
        message: 'Enter delta length or',
        options: ['Angle'],
        default: { kind: 'distance', value: s.delta },
      });
      if (a.kind === 'distance') {
        s.delta = a.value;
        s.deltaByAngle = false;
        return true;
      }
      if (a.kind !== 'keyword') return false;
      const g = yield ctx.prompt.angle({
        turn: true,
        message: 'Enter delta angle',
        default: { kind: 'angle', value: s.deltaAngle },
      });
      if (g.kind !== 'angle') return false;
      s.deltaAngle = g.value;
      s.deltaByAngle = true;
      return true;
    }
    case 'Percent': {
      for (;;) {
        const a = yield ctx.prompt.real({
          message: 'Enter percentage length',
          default: { kind: 'number', value: s.percent },
        });
        if (a.kind !== 'number') return false;
        if (a.value > 0) {
          s.percent = a.value;
          return true;
        }
        ctx.message('Value must be positive and nonzero.');
      }
    }
    case 'Total': {
      for (;;) {
        const a = yield ctx.prompt.distance({
          message: 'Specify total length or',
          options: ['Angle'],
          default: { kind: 'distance', value: s.total },
        });
        if (a.kind === 'distance') {
          if (a.value <= 0) {
            ctx.message('Value must be positive and nonzero.');
            continue;
          }
          s.total = a.value;
          s.totalByAngle = false;
          return true;
        }
        if (a.kind !== 'keyword') return false;
        const g = yield ctx.prompt.angle({
          turn: true,
          message: 'Specify total angle',
          default: { kind: 'angle', value: s.totalAngle },
        });
        if (g.kind !== 'angle') return false;
        s.totalAngle = g.value;
        s.totalByAngle = true;
        return true;
      }
    }
    case 'DYnamic':
      return true;
  }
}

/** "Select an object to change or [Undo]:" until Enter, each pick changing one object. */
async function* changeObjects(ctx: CommandContext, s: LengthenSettings): Sub<void> {
  const done: ChangeSet[] = [];
  for (;;) {
    const a = yield ctx.prompt.point({
      message: 'Select an object to change or',
      options: ['Undo'],
      pickbox: true,
    });
    if (a.kind === 'keyword') {
      const last = done.pop();
      if (last) ctx.edit((b) => revertChanges(b, last));
      else ctx.message('Nothing to undo.');
      continue;
    }
    if (a.kind !== 'point') return;
    const id = await pickedObject(ctx, a.point);
    const e = id === undefined ? undefined : ctx.model.entity(id);
    const c = e && breakCurveOf(e.geom);
    if (id === undefined || !e || !c || c.kind === 'RAY' || c.kind === 'XLINE') {
      ctx.message('Cannot lengthen that object.');
      continue;
    }
    if (locked(ctx, id)) {
      ctx.message('The object is on a locked layer.');
      continue;
    }
    const tol = toleranceFor(ctx.model, c);
    if (isClosedCurve(c, tol)) {
      ctx.message(LENGTHEN_PROBLEM.closed);
      continue;
    }
    const atEnd = movesEnd(c, closestPoint(c, a.point, tol).t);
    let target: number | LengthenProblem;
    if (s.mode === 'DYnamic') {
      const p = yield ctx.prompt.point({ message: 'Specify new end point' });
      if (p.kind !== 'point') return;
      target = lengthTo(c, atEnd, p.point, tol) ?? 'invalid';
    } else target = newLength(c, s, tol);
    const r = typeof target === 'string' ? target : lengthenGeometry(e.geom, c, atEnd, target, tol);
    if (typeof r === 'string') {
      ctx.message(LENGTHEN_PROBLEM[r]);
      continue;
    }
    if (r === e.geom) continue;
    done.push(ctx.edit((b) => reshapeObject(b, ctx.model, id, [r])));
  }
}

/** The length the mode gives `c`. */
function newLength(c: Curve, s: LengthenSettings, tol: Tolerance): number | LengthenProblem {
  const m = measureLength(c);
  if (!m) return 'invalid';
  const byAngle = s.mode === 'DElta' ? s.deltaByAngle : s.mode === 'Total' && s.totalByAngle;
  if (byAngle) {
    if (c.kind !== 'ARC') return 'not an arc';
    const sweep = ccwSweep(c.startAngle, c.endAngle);
    const to = s.mode === 'DElta' ? sweep + s.deltaAngle : s.totalAngle;
    return to * c.radius > tol.linear ? to * c.radius : 'invalid';
  }
  switch (s.mode) {
    case 'DElta':
      return m.length + s.delta;
    case 'Percent':
      return (m.length * s.percent) / 100;
    default:
      return s.total;
  }
}
