// QDIM (M4-02), with AutoCAD 2024's prompts (AutoCAD 2024 Help, "QDIM (Command)"):
//   Select geometry to dimension:
//   Specify dimension line position, or
//     [Continuous/Staggered/Baseline/Ordinate/Radius/Diameter/datumPoint/Edit/seTtings] <Continuous>:
// "Quickly creates a series of dimensions from selected objects": the points it dimensions are
// the ends of the lines, arcs and polyline segments selected and the centres of the circles and
// arcs, each place once. The dimension line position says which way the series runs, as
// DIMLINEAR's location does: above or below the points horizontal, beside them vertical.
// - Continuous: a chain of linear dimensions from point to point along the position's line.
// - Staggered: from the outermost pair of points inwards, each pair a DIMDLI further out from the
//   points than the one inside it, the innermost on the position's line.
// - Baseline: from the datum (the first point along the series, or the datumPoint given) to
//   each other point, the nearest on the position's line and each further one a DIMDLI out.
// - Ordinate: an ordinate dimension of each point measured from the datum (the UCS origin until
//   datumPoint gives one), its leader ending on the position's line.
// - Radius and Diameter: a dimension on each circle and arc selected, towards the position.
// - datumPoint: the datum Baseline and Ordinate measure from. Edit: points removed or added
//   ("Indicate dimension point to remove, or [Add/eXit] <eXit>:"). seTtings: AutoCAD's
//   "Associative dimension priority [Endpoint/Intersection]"; the dimensions Triya makes are not
//   associative (DIMASSOC 1, as DIMLINEAR's), so the answer is taken and changes nothing.
import type { Vec2 } from '../../geom/types';
import { add, distance, dot, fromAngle, perp, scale, sub } from '../../geom/vec';
import type { DimensionGeometry, EntityGeometry } from '../../model/types';
import {
  baselineSpacing,
  linearRotation,
  newDimension,
  placeDimension,
} from '../../edit/dimension';
import type { CommandDef, CommandGenerator } from '../command';
import type { PromptAnswer } from '../prompt';
import { currentUcs } from '../ucs';
import { currentStyle, makeDimension, stateOf } from './dimension';

type Mode = 'Continuous' | 'Staggered' | 'Baseline' | 'Ordinate' | 'Radius' | 'Diameter';

const OPTIONS = [
  'Continuous',
  'Staggered',
  'Baseline',
  'Ordinate',
  'Radius',
  'Diameter',
  'datumPoint',
  'Edit',
  'seTtings',
];

/** The points QDIM dimensions on `g`, and the circles it takes for Radius and Diameter. */
function pointsOf(g: EntityGeometry): {
  points: Vec2[];
  circle?: { center: Vec2; radius: number };
} {
  switch (g.kind) {
    case 'LINE':
      return { points: [g.start, g.end] };
    case 'ARC':
      return {
        points: [
          add(g.center, fromAngle(g.startAngle, g.radius)),
          add(g.center, fromAngle(g.endAngle, g.radius)),
          g.center,
        ],
        circle: g,
      };
    case 'CIRCLE':
      return { points: [g.center], circle: g };
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return { points: g.vertices.map((v) => ({ x: v.x, y: v.y })) };
    case 'POINT':
      return { points: [g.position] };
    default:
      return { points: [] };
  }
}

/** The points without repeats, in the order first met. */
function unique(points: readonly Vec2[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.some((q) => distance(p, q) <= tol)) out.push(p);
  return out;
}

/** The series of dimensions `mode` makes at `at`. */
export function qdimSeries(
  mode: Mode,
  points: readonly Vec2[],
  circles: readonly { center: Vec2; radius: number }[],
  at: Vec2,
  o: {
    readonly style: string;
    readonly spacing: number;
    readonly datum?: Vec2;
    readonly ucs: { readonly origin: Vec2; readonly angle: number };
  },
): DimensionGeometry[] {
  const base = newDimension(o.style);
  if (mode === 'Radius' || mode === 'Diameter') {
    const kind = mode === 'Radius' ? 'radius' : 'diameter';
    return circles
      .map((c) => placeDimension({ kind, center: c.center, radius: c.radius, base }, at))
      .filter((g): g is DimensionGeometry => g !== undefined);
  }
  if (points.length === 0) return [];
  // Which way the series runs: as DIMLINEAR's location decides for the points' box.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const lo = { x: Math.min(...xs), y: Math.min(...ys) };
  const hi = { x: Math.max(...xs), y: Math.max(...ys) };
  const rotation = linearRotation(lo, hi, at);
  const u = fromAngle(rotation);
  const n = perp(u);
  const sorted = [...points].sort((a, b) => dot(a, u) - dot(b, u));
  // Points at the same place along the series measure nothing between them.
  const along: Vec2[] = [];
  for (const p of sorted) {
    const last = along.at(-1);
    if (!last || Math.abs(dot(sub(p, last), u)) > 1e-9 * Math.max(1, Math.abs(dot(p, u)))) {
      along.push(p);
    }
  }
  // The side of the points the position is on, for dimension lines further out.
  const side = dot(sub(at, sorted[0]!), n) < 0 ? -1 : 1;
  const out = (k: number) => add(at, scale(n, side * k * o.spacing));
  const linear = (first: Vec2, second: Vec2, k: number) =>
    placeDimension({ kind: 'linear', first, second, rotation, base }, out(k));
  const made: (DimensionGeometry | undefined)[] = [];
  switch (mode) {
    case 'Continuous':
      for (let i = 0; i + 1 < along.length; i++) made.push(linear(along[i]!, along[i + 1]!, 0));
      break;
    case 'Staggered':
      for (
        let i = 0, j = along.length - 1, k = Math.floor(along.length / 2) - 1;
        i < j;
        i++, j--, k--
      ) {
        made.push(linear(along[i]!, along[j]!, k));
      }
      break;
    case 'Baseline': {
      const datum = o.datum ?? along[0]!;
      const rest = along
        .filter((p) => Math.abs(dot(sub(p, datum), u)) > 1e-9)
        .sort((a, b) => Math.abs(dot(sub(a, datum), u)) - Math.abs(dot(sub(b, datum), u)));
      rest.forEach((p, k) => made.push(linear(datum, p, k)));
      break;
    }
    case 'Ordinate': {
      // Leaders across the series to the position's line: X ordinates for a horizontal one.
      const ucs = o.datum ? { ...o.ucs, origin: o.datum } : o.ucs;
      for (const p of along) {
        const end = add(p, scale(n, dot(sub(at, p), n)));
        made.push(
          placeDimension(
            { kind: 'ordinate', feature: p, ucs, axis: rotation === 0 ? 'x' : 'y', base },
            end,
          ),
        );
      }
      break;
    }
  }
  return made.filter((g): g is DimensionGeometry => g !== undefined);
}

export function qdimCommand(): CommandDef {
  return {
    name: 'QDIM',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const style = currentStyle(ctx);
      if (style === undefined) return;
      const s = yield ctx.prompt.selection({ message: 'Select geometry to dimension' });
      if (s.kind !== 'selection' || s.ids.length === 0) return;
      let points: Vec2[] = [];
      const circles: { center: Vec2; radius: number }[] = [];
      for (const id of s.ids) {
        const g = ctx.model.entity(id)?.geom;
        if (!g) continue;
        const got = pointsOf(g);
        points.push(...got.points);
        if (got.circle && got.circle.radius > 0) circles.push(got.circle);
      }
      const size = Math.max(1, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
      const tol = 1e-10 * size;
      points = unique(points, tol);
      if (points.length === 0) {
        ctx.message('No geometry to dimension.');
        return;
      }
      let mode: Mode = 'Continuous';
      let datum: Vec2 | undefined;
      const spacing = baselineSpacing(ctx.model, { style: style.handle }, style.xdata);
      for (;;) {
        const a = yield ctx.prompt.point({
          message: 'Specify dimension line position, or',
          options: OPTIONS,
          default: { kind: 'keyword', keyword: mode },
        });
        if (a.kind === 'point') {
          const series = qdimSeries(mode, points, circles, a.point, {
            style: style.handle,
            spacing,
            ...(datum && { datum }),
            ucs: currentUcs(ctx),
          });
          if (series.length === 0) {
            ctx.message('Nothing to dimension.');
            return;
          }
          for (const g of series) {
            await makeDimension(ctx, stateOf(ctx.model), g, style.xdata, false);
          }
          return;
        }
        if (a.kind !== 'keyword') return;
        switch (a.keyword) {
          case 'datumPoint': {
            const d = yield ctx.prompt.point({ message: 'Select new datum point' });
            if (d.kind !== 'point') return;
            datum = d.point;
            continue;
          }
          case 'Edit': {
            // AutoCAD marks each point with an X to pick; the nearest to the pick is taken.
            let adding = false;
            for (;;) {
              const e: PromptAnswer = yield ctx.prompt.point({
                message: `Indicate dimension point to ${adding ? 'add' : 'remove'}, or`,
                options: [adding ? 'Remove' : 'Add', 'eXit'],
                default: { kind: 'keyword', keyword: 'eXit' },
              });
              if (e.kind === 'point') {
                if (adding) {
                  points = unique([...points, e.point], tol);
                } else {
                  const near = points.reduce((b, q) =>
                    distance(q, e.point) < distance(b, e.point) ? q : b,
                  );
                  points = points.filter((q) => q !== near);
                }
                continue;
              }
              if (e.kind === 'keyword' && e.keyword !== 'eXit') {
                adding = e.keyword === 'Add';
                continue;
              }
              if (e.kind === 'keyword' || e.kind === 'enter') break;
              return;
            }
            continue;
          }
          case 'seTtings': {
            const t = yield ctx.prompt.keyword({
              message: 'Associative dimension priority',
              options: ['Endpoint', 'Intersection'],
              default: { kind: 'keyword', keyword: 'Endpoint' },
            });
            if (t.kind !== 'keyword') return;
            continue;
          }
          default:
            mode = a.keyword as Mode;
        }
      }
    },
  };
}
