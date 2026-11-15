// SPLINE (M3-01 part 5), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "SPLINE (Command)"):
//   Current settings: Method=Fit   Knots=Chord            (Method=CV   Degree=3)
//   Specify first point or [Method/Knots/Object]:         ([Method/Degree/Object] for CV)
//     Method:  Enter spline creation method [Fit/CV] <Fit>:
//     Knots:   Enter knot parameterization [Chord/Square root/Uniform] <Chord>:
//     Degree:  Enter degree of spline <3>:                 1 to 10
//     Object:  Select objects to convert to splines …      spline-fit polylines
//   Fit:  Enter next point or [start Tangency/toLerance]:
//         Enter next point or [end Tangency/toLerance/Undo]:
//         Enter next point or [end Tangency/toLerance/Undo/Close]:
//           start Tangency:  Specify start tangent:
//           end Tangency:    Specify end tangent:          (draws the spline)
//           toLerance:       Specify a fit tolerance <0.0000>:
//   CV:   Enter next point:   Enter next point or [Undo]:   Enter next point or [Close/Undo]:
// Enter ends the spline; Close closes it (periodic) and ends; Esc draws nothing, the spline
// being one object. The method, knots and degree (AutoCAD's SPLMETHOD, SPLKNOTS and
// SPLDEGREE) are the drawing's next defaults this session. The spline is dragged with the
// cursor as its next point, or with the tangent asked for. Object converts quadratic and
// cubic spline-fit POLYLINEs to the SPLINE with their frame as its control polygon, erasing
// the polyline (DELOBJ's default).
import { controlSpline } from '../../geom/control-spline';
import type { KnotParameterization } from '../../geom/fit';
import type { Vec2 } from '../../geom/types';
import { copiedProps, eraseObjects } from '../../edit/edit';
import type { EntityId } from '../../model/entity-ids';
import type { EntityGeometry, SplineGeometry } from '../../model/types';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { splineOf, type SplineSketch, type SplineSpec } from './spline-shape';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const KNOTS: Record<KnotParameterization, string> = {
  chord: 'Chord',
  sqrt: 'Square root',
  uniform: 'Uniform',
};

/** SPLMETHOD, SPLKNOTS and SPLDEGREE for one drawing. */
interface SplineSettings {
  method: 'fit' | 'cv';
  knots: KnotParameterization;
  degree: number;
}

/** SPLINE for one document; it remembers the method, knots and degree for the next. */
export function splineCommand(): CommandDef {
  const state: SplineSettings = { method: 'fit', knots: 'chord', degree: 3 };
  return {
    name: 'SPLINE',
    async *run(ctx) {
      const settings = () =>
        ctx.message(
          state.method === 'fit'
            ? `Current settings: Method=Fit   Knots=${KNOTS[state.knots]}`
            : `Current settings: Method=CV   Degree=${state.degree}`,
        );
      settings();
      let first: Vec2 | undefined;
      while (!first) {
        const a = yield ctx.prompt.point({
          message: 'Specify first point or',
          options: ['Method', state.method === 'fit' ? 'Knots' : 'Degree', 'Object'],
        });
        if (a.kind === 'point') first = a.point;
        else if (a.kind !== 'keyword') return;
        else if (a.keyword === 'Object') return yield* convertObjects(ctx);
        else if (a.keyword === 'Method') {
          const m = yield ctx.prompt.keyword({
            message: 'Enter spline creation method',
            options: ['Fit', 'CV'],
            defaultLabel: state.method === 'fit' ? 'Fit' : 'CV',
          });
          if (m.kind === 'keyword') state.method = m.keyword === 'CV' ? 'cv' : 'fit';
        } else if (a.keyword === 'Knots') {
          const k = yield ctx.prompt.keyword({
            message: 'Enter knot parameterization',
            options: ['Chord', 'Square root', 'Uniform'],
            defaultLabel: KNOTS[state.knots],
          });
          if (k.kind === 'keyword') {
            state.knots =
              k.keyword === 'Uniform' ? 'uniform' : k.keyword === 'Chord' ? 'chord' : 'sqrt';
          }
        } else {
          for (;;) {
            const d = yield ctx.prompt.integer({
              message: 'Enter degree of spline',
              default: { kind: 'number', value: state.degree },
            });
            const n = (d as { value: number }).value;
            if (n >= 1 && n <= 10) {
              state.degree = n;
              break;
            }
            ctx.message('Requires an integer between 1 and 10.');
          }
        }
      }
      const props = currentProps(ctx.model);
      const draw = (spec: SplineSpec): void => {
        const geom = splineOf(spec);
        if (geom) ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom }));
      };
      const drag = (spec: SplineSpec, cursor: SplineSketch['cursor']) => ({
        kind: 'sketch' as const,
        sketch: { shape: 'spline' as const, spec, cursor },
        layer: props.layer,
      });

      const points: Vec2[] = [first];
      if (state.method === 'cv') {
        const degree = state.degree;
        const spec = (closed = false): SplineSpec => ({
          method: 'cv',
          points: [...points],
          degree,
          closed,
        });
        for (;;) {
          const n = points.length;
          const a = yield {
            ...ctx.prompt.point({
              message: n === 1 ? 'Enter next point' : 'Enter next point or',
              ...(n > 1 && { options: n === 2 ? ['Undo'] : ['Close', 'Undo'] }),
            }),
            drag: drag(spec(), 'point'),
          };
          if (a.kind === 'point') points.push(a.point);
          else if (a.kind === 'keyword' && a.keyword === 'Undo') points.pop();
          else if (a.kind === 'keyword') return draw(spec(true));
          else return a.kind === 'enter' ? draw(spec()) : undefined;
        }
      }

      const knots = state.knots;
      let startTangent: Vec2 | undefined;
      let tolerance = 0;
      const spec = (o: { closed?: boolean; endTangent?: Vec2 } = {}): SplineSpec => ({
        method: 'fit',
        points: [...points],
        knots,
        startTangent,
        endTangent: o.endTangent,
        tolerance,
        closed: o.closed ?? false,
      });
      for (;;) {
        const n = points.length;
        const options =
          n === 1
            ? ['start Tangency', 'toLerance']
            : n === 2
              ? ['end Tangency', 'toLerance', 'Undo']
              : ['end Tangency', 'toLerance', 'Undo', 'Close'];
        const a = yield {
          ...ctx.prompt.point({ message: 'Enter next point or', options }),
          drag: drag(spec(), 'point'),
        };
        if (a.kind === 'point') {
          points.push(a.point);
          continue;
        }
        if (a.kind === 'enter') return n > 1 ? draw(spec()) : undefined;
        if (a.kind !== 'keyword') return;
        switch (a.keyword) {
          case 'Undo':
            points.pop();
            break;
          case 'Close':
            return draw(spec({ closed: true }));
          case 'toLerance': {
            for (;;) {
              const t = yield ctx.prompt.distance({
                message: 'Specify a fit tolerance',
                default: { kind: 'distance', value: tolerance },
              });
              const v = (t as { value: number }).value;
              if (v >= 0) {
                tolerance = v;
                break;
              }
              ctx.message('Value must be positive or zero.');
            }
            break;
          }
          case 'start Tangency': {
            const t = yield* tangent(
              ctx,
              'Specify start tangent',
              first,
              drag(spec(), 'startTangent'),
            );
            if (t) startTangent = t;
            break;
          }
          default: {
            const last = points[n - 1]!;
            const t = yield* tangent(ctx, 'Specify end tangent', last, drag(spec(), 'endTangent'));
            if (t) return draw(spec({ endTangent: t }));
          }
        }
      }
    },
  };
}

/** A tangent's direction from `from`, picked or typed; undefined for Enter or a zero one. */
async function* tangent(
  ctx: CommandContext,
  message: string,
  from: Vec2,
  drag: Prompt['drag'],
): Sub<Vec2 | undefined> {
  const a = yield {
    ...ctx.prompt.point({ message, rubberBand: { from } }),
    ...(drag && { drag }),
  };
  if (a.kind !== 'point') return undefined;
  const t = { x: a.point.x - from.x, y: a.point.y - from.y };
  return t.x !== 0 || t.y !== 0 ? t : undefined;
}

/** The SPLINE a quadratic or cubic spline-fit POLYLINE is: its frame as control polygon. */
export function splineOfFitPolyline(g: EntityGeometry): SplineGeometry | undefined {
  if (g.kind !== 'POLYLINE' || (g.fit !== 'quadratic' && g.fit !== 'cubic') || !g.frame) {
    return undefined;
  }
  const closed = g.closed;
  const c = controlSpline(g.frame, g.fit === 'quadratic' ? 2 : 3, closed);
  if (!c) return undefined;
  return {
    kind: 'SPLINE',
    degree: c.degree,
    knots: c.knots,
    controlPoints: c.controlPoints,
    closed,
    periodic: closed,
  };
}

/** SPLINE Object: spline-fit polylines become splines, the polylines erased. */
async function* convertObjects(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.selection({
    message: 'Select objects to convert to splines',
    editable: true,
  });
  if (a.kind !== 'selection') return;
  const made: [EntityId, SplineGeometry][] = [];
  for (const id of a.ids) {
    const e = ctx.model.entity(id);
    const geom = e && splineOfFitPolyline(e.geom);
    if (geom) made.push([id, geom]);
  }
  if (made.length === 0) return;
  ctx.edit((b) => {
    for (const [id, geom] of made) {
      const e = ctx.model.entity(id)!;
      b.addEntity({ owner: e.owner, ...copiedProps(b, e), geom });
    }
    eraseObjects(
      b,
      ctx.model,
      made.map(([id]) => id),
    );
  });
}
