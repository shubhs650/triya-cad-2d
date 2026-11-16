// DIMREASSOCIATE and DIMDISASSOCIATE (M4-02), with AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "DIMREASSOCIATE (Command)", "DIMDISASSOCIATE (Command)"):
//   DIMREASSOCIATE   Select dimensions to reassociate:
//     then, for each dimension selected, by its kind:
//     linear, aligned      Specify first extension line origin or [Select object] <next>:
//                          Specify second extension line origin <next>:
//     angular (3 point)    Specify angle vertex or [Select arc] <next>:
//                          Specify first angle endpoint <next>:
//                          Specify second angle endpoint <next>:
//     angular (2 line)     Select first line <next>:
//                          Select second line <next>:
//     radius, diameter,    Select arc or circle <next>:
//     jogged
//     ordinate             Specify feature location <next>:
//     arc length           Select arc or polyline arc segment <next>:
//   DIMDISASSOCIATE  Select dimensions to disassociate:
// Triya's dimensions are not associative (DIMASSOC 1, as DIMLINEAR's), so DIMREASSOCIATE
// re-picks definition points (the roadmap's "defpoint re-pick"): the point or object given
// becomes the dimension's, which is measured and drawn afresh, and Enter (<next>) keeps a point
// as it is. It does not follow the object afterwards, as AutoCAD's would. A dimension whose
// points change lets go of any association it was read with, which would take it back to the
// old geometry. DIMDISASSOCIATE removes the associations (DIMASSOC objects) of dimensions read
// from a drawing; the save removes them from the file (`io` export/dim-assocs.ts).
import type { Vec2 } from '../../geom/types';
import { add, distance, fromAngle, midpoint, normalize, scale, sub } from '../../geom/vec';
import type { DimAssoc, DimensionGeometry, Entity } from '../../model/types';
import { newDimension, placeDimension } from '../../edit/dimension';
import { disassociateDimensions } from '../../edit/edit';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { endsOf, pickObject } from '../draw/dimension';
import { arcOf } from '../draw/dimension-more';
import { regenerateDimensions } from './dimensions';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
type Dim = Entity & { geom: DimensionGeometry };

const isDimension = (e: Entity): e is Dim =>
  e.geom.kind === 'DIMENSION' ||
  e.geom.kind === 'ARC_DIMENSION' ||
  e.geom.kind === 'LARGE_RADIAL_DIMENSION';

/** The dimensions selected after `message`; undefined when the command ends. */
async function* selectDimensions(ctx: CommandContext, message: string): Sub<Dim[] | undefined> {
  const a = yield ctx.prompt.selection({ message });
  if (a.kind !== 'selection') return undefined;
  return a.ids.flatMap((id) => {
    const e = ctx.model.entity(id);
    return e && isDimension(e) ? [e] : [];
  });
}

/** A point re-picked: the point, 'next' at Enter, 'option' for the option, or undefined to end. */
async function* repick(
  ctx: CommandContext,
  message: string,
  options?: readonly string[],
): Sub<Vec2 | 'next' | 'option' | undefined> {
  const a = yield ctx.prompt.point({
    message: options ? `${message} or` : message,
    ...(options && { options: [...options] }),
    defaultLabel: 'next',
  });
  if (a.kind === 'point') return a.point;
  if (a.kind === 'enter') return 'next';
  if (a.kind === 'keyword') return 'option';
  return undefined;
}

/** A circle or arc picked: its centre and radius, 'next' at Enter, or undefined to end. */
async function* pickCircle(
  ctx: CommandContext,
): Sub<{ center: Vec2; radius: number } | 'next' | undefined> {
  for (;;) {
    const o = yield* pickObject(ctx, 'Select arc or circle', 'next');
    if (o === 'enter') return 'next';
    if (o === undefined) return undefined;
    const g = o.entity.geom;
    if ((g.kind === 'CIRCLE' || g.kind === 'ARC') && g.radius > 0) return g;
    ctx.message('Object selected is not a circle or arc.');
  }
}

/** `p` at `radius` from `center` the way `toward` is from `from` (along X when they meet). */
function onCircle(center: Vec2, radius: number, from: Vec2, toward: Vec2): Vec2 {
  const d = sub(toward, from);
  const u = distance(toward, from) > 0 ? normalize(d) : fromAngle(0);
  return add(center, scale(u, radius));
}

/**
 * The dimension `g` with its definition points re-picked, the same object when nothing
 * changed, or undefined when the command ends.
 */
async function* reassociate(
  ctx: CommandContext,
  g: DimensionGeometry,
): Sub<DimensionGeometry | undefined> {
  switch (g.dimType) {
    case 'linear':
    case 'aligned': {
      for (;;) {
        const a = yield* repick(ctx, 'Specify first extension line origin', ['Select object']);
        if (a === undefined) return undefined;
        if (a === 'option') {
          // Both origins at the object's ends, as DIMLINEAR's <select object> takes them.
          const o = yield* pickObject(ctx, 'Select object');
          if (o === undefined || o === 'enter') return undefined;
          const ends = endsOf(o.entity.geom, o.at);
          if (ends && distance(ends[0], ends[1]) > 0) {
            return { ...g, first: ends[0], second: ends[1] };
          }
          ctx.message('Object selected is not a line, arc or polyline segment.');
          continue;
        }
        const first = a === 'next' ? g.first : a;
        const b = yield* repick(ctx, 'Specify second extension line origin');
        if (b === undefined || b === 'option') return undefined;
        const second = b === 'next' ? g.second : b;
        return first === g.first && second === g.second ? g : { ...g, first, second };
      }
    }
    case 'angular3pt': {
      let { vertex, first, second } = g;
      for (;;) {
        const a = yield* repick(ctx, 'Specify angle vertex', ['Select arc']);
        if (a === undefined) return undefined;
        if (a === 'option') {
          // The arc's centre and ends, as DIMANGULAR measures an arc.
          const o = yield* pickObject(ctx, 'Select arc');
          if (o === undefined || o === 'enter') return undefined;
          const arc = o.entity.geom;
          if (arc.kind === 'ARC' && arc.radius > 0) {
            return {
              ...g,
              vertex: arc.center,
              first: add(arc.center, fromAngle(arc.startAngle, arc.radius)),
              second: add(arc.center, fromAngle(arc.endAngle, arc.radius)),
            };
          }
          ctx.message('Object selected is not an arc.');
          continue;
        }
        if (a !== 'next') vertex = a;
        break;
      }
      const b = yield* repick(ctx, 'Specify first angle endpoint');
      if (b === undefined || b === 'option') return undefined;
      if (b !== 'next') first = b;
      const c = yield* repick(ctx, 'Specify second angle endpoint');
      if (c === undefined || c === 'option') return undefined;
      if (c !== 'next') second = c;
      return vertex === g.vertex && first === g.first && second === g.second
        ? g
        : { ...g, vertex, first, second };
    }
    case 'angular': {
      let line1: readonly [Vec2, Vec2] = [g.line1Start, g.line1End];
      let line2: readonly [Vec2, Vec2] = [g.line2Start, g.definitionPoint];
      for (const which of ['first', 'second'] as const) {
        for (;;) {
          const o = yield* pickObject(ctx, `Select ${which} line`, 'next');
          if (o === undefined) return undefined;
          if (o === 'enter') break;
          const h = o.entity.geom;
          if (h.kind !== 'LINE' || distance(h.start, h.end) === 0) {
            ctx.message('Object selected is not a line.');
            continue;
          }
          const l1 = which === 'first' ? ([h.start, h.end] as const) : line1;
          const l2 = which === 'second' ? ([h.start, h.end] as const) : line2;
          const placed = placeDimension(
            { kind: 'angular', line1: l1, line2: l2, base: newDimension(g.style) },
            g.arcPoint,
          );
          if (!placed) {
            ctx.message('Lines are parallel.');
            continue;
          }
          line1 = l1;
          line2 = l2;
          break;
        }
      }
      const [line1Start, line1End] = line1;
      const [line2Start, definitionPoint] = line2;
      return line1Start === g.line1Start &&
        line1End === g.line1End &&
        line2Start === g.line2Start &&
        definitionPoint === g.definitionPoint
        ? g
        : { ...g, line1Start, line1End, line2Start, definitionPoint };
    }
    case 'radius':
    case 'diameter':
    case 'jogged': {
      const c = yield* pickCircle(ctx);
      if (c === undefined) return undefined;
      if (c === 'next') return g;
      // The chord point stays the same way from the centre it was.
      const centre =
        g.dimType === 'diameter' ? midpoint(g.definitionPoint, g.chordPoint) : g.definitionPoint;
      const chordPoint = onCircle(c.center, c.radius, centre, g.chordPoint);
      if (g.dimType === 'radius' || g.dimType === 'jogged') {
        return { ...g, definitionPoint: c.center, chordPoint };
      }
      const far = onCircle(c.center, c.radius, g.chordPoint, centre);
      return { ...g, definitionPoint: far, chordPoint };
    }
    case 'ordinate': {
      const a = yield* repick(ctx, 'Specify feature location');
      if (a === undefined || a === 'option') return undefined;
      return a === 'next' ? g : { ...g, feature: a };
    }
    case 'arc': {
      for (;;) {
        const o = yield* pickObject(ctx, 'Select arc or polyline arc segment', 'next');
        if (o === undefined) return undefined;
        if (o === 'enter') return g;
        const arc = arcOf(o.entity.geom, o.at);
        if (!arc) {
          ctx.message('Object selected is not an arc or polyline arc segment.');
          continue;
        }
        // The dimension arc as far outside the new arc as it was outside the old one.
        const offset = distance(g.definitionPoint, g.center) - distance(g.first, g.center);
        const sweep = arc.endAngle - arc.startAngle;
        const mid = arc.startAngle + (sweep > 0 ? sweep : sweep + 2 * Math.PI) / 2;
        const at = add(arc.center, fromAngle(mid, Math.max(arc.radius + offset, arc.radius / 2)));
        const placed = placeDimension(
          {
            kind: 'arc',
            center: arc.center,
            radius: arc.radius,
            startAngle: arc.startAngle,
            endAngle: arc.endAngle,
            base: newDimension(g.style),
          },
          at,
        );
        if (placed?.dimType !== 'arc') return g;
        const { leader: _leader, ...rest } = g;
        return {
          ...rest,
          definitionPoint: placed.definitionPoint,
          first: placed.first,
          second: placed.second,
          center: placed.center,
          startAngle: placed.startAngle,
          endAngle: placed.endAngle,
          partial: false,
        };
      }
    }
  }
}

function reassociateCommand(): CommandDef {
  return {
    name: 'DIMREASSOCIATE',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const dims = yield* selectDimensions(ctx, 'Select dimensions to reassociate');
      if (!dims || dims.length === 0) return;
      // Each dimension changes as its points are given, so that Esc keeps the ones done; the
      // command is one undo step all the same.
      for (const e of dims) {
        const g = yield* reassociate(ctx, e.geom);
        if (g === undefined) return;
        if (g === e.geom) continue;
        ctx.edit((b) => {
          disassociateDimensions(b, ctx.model, [e.id]);
          b.updateEntity(e.id, { geom: g });
        });
        await regenerateDimensions(ctx, [e.id]);
      }
    },
  };
}

function disassociateCommand(): CommandDef {
  return {
    name: 'DIMDISASSOCIATE',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const dims = yield* selectDimensions(ctx, 'Select dimensions to disassociate');
      if (!dims || dims.length === 0) return;
      // Only a dimension read with an association has one to remove.
      const associated = new Set(
        [...ctx.model.objects.values()].flatMap((o) =>
          o.type === 'DIMASSOC' ? [(o as DimAssoc).dimension] : [],
        ),
      );
      const ids = dims.filter((e) => associated.has(e.handle)).map((e) => e.id);
      if (ids.length > 0) {
        ctx.edit((b) => {
          disassociateDimensions(b, ctx.model, ids);
        });
      }
      ctx.message(`${ids.length} disassociated.`);
    },
  };
}

export function dimensionAssociateCommands(): CommandDef[] {
  return [reassociateCommand(), disassociateCommand()];
}
