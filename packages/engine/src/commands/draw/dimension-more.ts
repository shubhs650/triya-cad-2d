// DIMORDINATE, DIMJOGGED and DIMARC (M4-02), with AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "DIMORDINATE (Command)", "DIMJOGGED (Command)", "DIMARC (Command)"):
//   DIMORDINATE  Specify feature location:
//                Specify leader endpoint or [Xdatum/Ydatum/Mtext/Text/Angle]:
//   DIMJOGGED    Select arc or circle:
//                Specify center location override:
//                Dimension text = 10.0000
//                Specify dimension line location or [Mtext/Text/Angle]:
//                Specify jog location:
//   DIMARC       Select arc or polyline arc segment:
//                Specify arc length dimension location or [Mtext/Text/Angle/Partial/Leader]:
// The dimensions are made as DIMLINEAR's (draw/dimension.ts): in the current dimension style
// with the header's overrides, on the current layer, drawn by the dimension engine into a `*D`
// block, not associative. Where each puts its definition points is in edit/dimension.ts.
import type { Vec2 } from '../../geom/types';
import { normalizeAngle } from '../../geom/angle';
import { bulgeArc } from '../../geom/eval';
import { add, angleOf, distance, dot, fromAngle, scale, sub } from '../../geom/vec';
import type { EntityGeometry } from '../../model/types';
import { newDimension, placeDimension, type DimPlacement } from '../../edit/dimension';
import type { CommandDef, CommandGenerator } from '../command';
import { currentUcs } from '../ucs';
import { currentLayer } from './line';
import {
  TEXT_OPTIONS,
  askLocation,
  currentStyle,
  makeDimension,
  measurementOf,
  pickObject,
  stateOf,
} from './dimension';

function ordinateCommand(): CommandDef {
  return {
    name: 'DIMORDINATE',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const style = currentStyle(ctx);
      if (style === undefined) return;
      const f = yield ctx.prompt.point({ message: 'Specify feature location' });
      if (f.kind !== 'point') return;
      const place: DimPlacement = {
        kind: 'ordinate',
        feature: f.point,
        ucs: currentUcs(ctx),
        base: newDimension(style.handle),
      };
      const g = yield* askLocation(ctx, place, style.xdata, 'Specify leader endpoint or', [
        'Xdatum',
        'Ydatum',
        ...TEXT_OPTIONS,
      ]);
      if (g) await makeDimension(ctx, stateOf(ctx.model), g, style.xdata);
    },
  };
}

function joggedCommand(): CommandDef {
  return {
    name: 'DIMJOGGED',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const style = currentStyle(ctx);
      if (style === undefined) return;
      let circle: { center: Vec2; radius: number } | undefined;
      while (!circle) {
        const o = yield* pickObject(ctx, 'Select arc or circle');
        if (o === undefined || o === 'enter') return;
        const g = o.entity.geom;
        if ((g.kind === 'CIRCLE' || g.kind === 'ARC') && g.radius > 0) circle = g;
        else ctx.message('Object selected is not a circle or arc.');
      }
      const c = yield ctx.prompt.point({
        message: 'Specify center location override',
        rubberBand: { from: circle.center },
      });
      if (c.kind !== 'point') return;
      let place: DimPlacement = {
        kind: 'jogged',
        center: circle.center,
        radius: circle.radius,
        overrideCenter: c.point,
        base: newDimension(style.handle),
      };
      // AutoCAD says what it measures before the dimension line is placed.
      const sample = placeDimension(place, add(circle.center, fromAngle(0, circle.radius)));
      const m = sample && measurementOf(ctx, sample, style.xdata);
      if (m !== undefined) ctx.message(`Dimension text = ${m}`);
      const placed = yield* askLocation(
        ctx,
        place,
        style.xdata,
        'Specify dimension line location or',
        TEXT_OPTIONS,
      );
      if (!placed || placed.dimType !== 'jogged') return;
      // The text options' changes are in what was placed; the jog is dragged along it.
      const {
        definitionPoint: _c,
        chordPoint: _p,
        overrideCenter: _o,
        jogPoint: _j,
        ...fields
      } = placed;
      const { kind: _k, dimType: _t, leaderLength: _l, ...base } = fields;
      place = { ...place, location: placed.textPosition, base };
      const layer = currentLayer(ctx.model);
      const xdata = style.xdata;
      for (;;) {
        const j = yield ctx.prompt.point({
          message: 'Specify jog location',
          drag: { kind: 'dimension', place, layer, ...(xdata && { xdata }) },
        });
        if (j.kind !== 'point') return;
        const g = placeDimension(place, j.point);
        if (!g) {
          ctx.message('Invalid point.');
          continue;
        }
        await makeDimension(ctx, stateOf(ctx.model), g, style.xdata, false);
        return;
      }
    },
  };
}

/** An arc DIMARC measures: an ARC, or the arc segment of a polyline nearest the pick. */
interface MeasuredArc {
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return distance(p, add(a, scale(ab, t)));
}

/** How far `p` is from the arc. */
function toArc(p: Vec2, a: MeasuredArc): number {
  const sweep = normalizeAngle(a.endAngle - a.startAngle) || 2 * Math.PI;
  const t = normalizeAngle(angleOf(sub(p, a.center)) - a.startAngle);
  if (t <= sweep) return Math.abs(distance(p, a.center) - a.radius);
  return Math.min(
    distance(p, add(a.center, fromAngle(a.startAngle, a.radius))),
    distance(p, add(a.center, fromAngle(a.endAngle, a.radius))),
  );
}

export function arcOf(g: EntityGeometry, at: Vec2 | undefined): MeasuredArc | undefined {
  if (g.kind === 'ARC') return g.radius > 0 ? g : undefined;
  if (g.kind !== 'LWPOLYLINE' && g.kind !== 'POLYLINE') return undefined;
  const v = g.vertices;
  const n = g.closed ? v.length : v.length - 1;
  // The segment picked, which must be an arc; without a pick, the first arc.
  let best: MeasuredArc | undefined;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const p = v[i]!;
    const q = v[(i + 1) % v.length]!;
    const bulge = 'bulge' in p ? (p.bulge ?? 0) : 0;
    if (distance(p, q) === 0) continue;
    if (bulge === 0) {
      const d = at ? distanceToSegment(at, p, q) : Infinity;
      if (d < bestD) {
        bestD = d;
        best = undefined;
      }
      continue;
    }
    const b = bulgeArc(p, q, bulge);
    // Counter-clockwise, as an ARC runs.
    const s = b.sweep >= 0 ? b.startAngle : b.startAngle + b.sweep;
    const arc = {
      center: b.center,
      radius: b.radius,
      startAngle: normalizeAngle(s),
      endAngle: normalizeAngle(s + Math.abs(b.sweep)),
    };
    const d = at ? toArc(at, arc) : i;
    if (d < bestD) {
      bestD = d;
      best = arc;
    }
  }
  return best;
}

/** DIMARC's options: Leader (or No leader) only for an arc over 90°. */
function arcOptions(p: DimPlacement): readonly string[] {
  if (p.kind !== 'arc') return TEXT_OPTIONS;
  const sweep = normalizeAngle(p.endAngle - p.startAngle) || 2 * Math.PI;
  const leader = sweep > Math.PI / 2 ? [p.leader ? 'No leader' : 'Leader'] : [];
  return [...TEXT_OPTIONS, 'Partial', ...leader];
}

function arcLengthCommand(): CommandDef {
  return {
    name: 'DIMARC',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const style = currentStyle(ctx);
      if (style === undefined) return;
      let arc: MeasuredArc | undefined;
      while (!arc) {
        const o = yield* pickObject(ctx, 'Select arc or polyline arc segment');
        if (o === undefined || o === 'enter') return;
        arc = arcOf(o.entity.geom, o.at);
        if (!arc) ctx.message('Object selected is not an arc or polyline arc segment.');
      }
      const place: DimPlacement = {
        kind: 'arc',
        center: arc.center,
        radius: arc.radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
        base: newDimension(style.handle),
      };
      const g = yield* askLocation(
        ctx,
        place,
        style.xdata,
        'Specify arc length dimension location or',
        arcOptions,
      );
      if (g) await makeDimension(ctx, stateOf(ctx.model), g, style.xdata);
    },
  };
}

export function moreDimensionCommands(): CommandDef[] {
  return [ordinateCommand(), joggedCommand(), arcLengthCommand()];
}
