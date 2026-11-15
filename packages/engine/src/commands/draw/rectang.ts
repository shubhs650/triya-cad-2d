// RECTANG (M3-01 part 3): a closed LWPOLYLINE, on AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "RECTANG (Command)"):
//   Current rectangle modes:  Chamfer=1.0000 x 2.0000  Width=0.5000      (when any is set)
//   Specify first corner point or [Chamfer/Elevation/Fillet/Thickness/Width]:
//     Chamfer:    Specify first chamfer distance for rectangles <0.0000>:
//                 Specify second chamfer distance for rectangles <first>:
//     Elevation:  Specify the elevation for rectangles <0.0000>:
//     Fillet:     Specify fillet radius for rectangles <0.0000>:
//     Thickness:  Specify thickness for rectangles <0.0000>:
//     Width:      Specify line width for rectangles <0.0000>:
//   Specify other corner point or [Area/Dimensions/Rotation]:
//     Area:       Enter area of rectangle in current units <100.0000>:
//                 Calculate rectangle dimensions based on [Length/Width] <Length>:
//                 Enter rectangle length <10.0000>:   (or width)
//     Dimensions: Specify length for rectangles <10.0000>:  Specify width for rectangles <…>:
//                 then the other corner picks which way from the first the rectangle lies
//     Rotation:   Specify rotation angle or [Pick points] <0>:
// The modes (and the rotation) stay for the drawing's next rectangles this session, as
// AutoCAD's do. Chamfer and Fillet replace each other; a distance or radius of 0 turns the
// corners off. Elevation and thickness are the polyline's own (DXF 38 and 39), which Triya's
// 2D views do not show.
import { cornersArea, rectangleVertices, type RectangleCorners } from '../../geom/shapes';
import type { Vec2 } from '../../geom/types';
import { angleOf, dot, fromAngle, perp, sub } from '../../geom/vec';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatAngle, formatDistance } from '../units';
import { currentProps } from '../../properties/current';
import { closed, sketchTolerance, type Sketch } from './sketch';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const INVALID = '*Invalid*';
const NOT_NEGATIVE = 'Value must be positive or zero.';
const POSITIVE = 'Value must be positive and nonzero.';

/** RECTANG's modes and remembered sizes, per drawing. */
interface RectangState {
  chamfer: [number, number];
  fillet: number;
  /** Which of chamfer and fillet is on (when its distances are not 0). */
  corners: 'chamfer' | 'fillet';
  elevation: number;
  thickness: number;
  width: number;
  rotation: number;
  area: number;
  length: number;
  breadth: number;
}

const cornersOf = (s: RectangState): RectangleCorners | undefined =>
  s.corners === 'fillet'
    ? s.fillet > 0
      ? { kind: 'fillet', radius: s.fillet }
      : undefined
    : s.chamfer[0] > 0 || s.chamfer[1] > 0
      ? { kind: 'chamfer', first: s.chamfer[0], second: s.chamfer[1] }
      : undefined;

/** RECTANG for one document. */
export function rectangCommand(): CommandDef {
  const state: RectangState = {
    chamfer: [0, 0],
    fillet: 0,
    corners: 'fillet',
    elevation: 0,
    thickness: 0,
    width: 0,
    rotation: 0,
    area: 100,
    length: 10,
    breadth: 10,
  };
  return {
    name: 'RECTANG',
    async *run(ctx) {
      const units = drawingUnits(ctx.model.header);
      const d = (v: number) => formatDistance(v, units);
      const distance = async function* (message: string, value: number): Sub<number | undefined> {
        for (;;) {
          const a = yield ctx.prompt.distance({ message, default: { kind: 'distance', value } });
          if (a.kind !== 'distance') return undefined;
          if (a.value >= 0) return a.value;
          ctx.message(NOT_NEGATIVE);
        }
      };
      const modes = (): void => {
        const out: string[] = [];
        const c = cornersOf(state);
        if (c?.kind === 'chamfer') out.push(`Chamfer=${d(c.first)} x ${d(c.second)}`);
        if (state.elevation !== 0) out.push(`Elevation=${d(state.elevation)}`);
        if (c?.kind === 'fillet') out.push(`Fillet=${d(c.radius)}`);
        if (state.thickness !== 0) out.push(`Thickness=${d(state.thickness)}`);
        if (state.width > 0) out.push(`Width=${d(state.width)}`);
        if (state.rotation !== 0) out.push(`Rotation=${formatAngle(state.rotation, units)}`);
        if (out.length > 0) ctx.message(`Current rectangle modes:  ${out.join('  ')}`);
      };
      modes();

      let first: Vec2 | undefined;
      while (!first) {
        const a = yield ctx.prompt.point({
          message: 'Specify first corner point or',
          options: ['Chamfer', 'Elevation', 'Fillet', 'Thickness', 'Width'],
        });
        if (a.kind === 'point') {
          first = a.point;
          break;
        }
        if (a.kind !== 'keyword') return;
        switch (a.keyword) {
          case 'Chamfer': {
            const c1 = yield* distance(
              'Specify first chamfer distance for rectangles',
              state.chamfer[0],
            );
            if (c1 === undefined) return;
            const c2 = yield* distance('Specify second chamfer distance for rectangles', c1);
            if (c2 === undefined) return;
            state.chamfer = [c1, c2];
            state.corners = 'chamfer';
            break;
          }
          case 'Fillet': {
            const r = yield* distance('Specify fillet radius for rectangles', state.fillet);
            if (r === undefined) return;
            state.fillet = r;
            state.corners = 'fillet';
            break;
          }
          case 'Width': {
            const w = yield* distance('Specify line width for rectangles', state.width);
            if (w === undefined) return;
            state.width = w;
            break;
          }
          default: {
            // Elevation and Thickness may be negative (below the XY plane, extruded down).
            const elevation = a.keyword === 'Elevation';
            const v = yield ctx.prompt.distance({
              message: elevation
                ? 'Specify the elevation for rectangles'
                : 'Specify thickness for rectangles',
              default: {
                kind: 'distance',
                value: elevation ? state.elevation : state.thickness,
              },
            });
            if (v.kind !== 'distance') return;
            if (elevation) state.elevation = v.value;
            else state.thickness = v.value;
          }
        }
      }

      const corner = first;
      let size: { length: number; width: number } | undefined;
      for (;;) {
        const sketch: Sketch = {
          shape: 'rectangle',
          first: corner,
          rotation: state.rotation,
          ...(cornersOf(state) && { corners: cornersOf(state)! }),
          ...(state.width > 0 && { width: state.width }),
          ...(size && { size }),
        };
        const a = yield {
          ...ctx.prompt.point({
            message: 'Specify other corner point or',
            options: ['Area', 'Dimensions', 'Rotation'],
            ...(!size && { rubberBand: { from: corner } }),
          }),
          drag: { kind: 'sketch', sketch, layer: currentProps(ctx.model).layer },
        };
        if (a.kind === 'point') {
          const u = fromAngle(state.rotation);
          const v = sub(a.point, corner);
          let length = dot(v, u);
          let width = dot(v, perp(u));
          if (size) {
            length = (length < 0 ? -1 : 1) * size.length;
            width = (width < 0 ? -1 : 1) * size.width;
          }
          const tol = sketchTolerance(corner, a.point);
          if (Math.abs(length) <= tol.linear || Math.abs(width) <= tol.linear) {
            ctx.message(INVALID);
            continue;
          }
          return draw(ctx, state, corner, length, width);
        }
        if (a.kind !== 'keyword') return;
        if (a.keyword === 'Rotation') {
          const r = yield* rotation(ctx, state.rotation);
          if (r === undefined) return;
          state.rotation = r;
          continue;
        }
        if (a.keyword === 'Dimensions') {
          const l = yield* positive(ctx, 'Specify length for rectangles', state.length);
          if (l === undefined) return;
          const w = yield* positive(ctx, 'Specify width for rectangles', state.breadth);
          if (w === undefined) return;
          state.length = l;
          state.breadth = w;
          size = { length: l, width: w };
          continue;
        }
        const area = yield* byArea(ctx, state);
        if (!area) return;
        return draw(ctx, state, corner, area[0], area[1]);
      }
    },
  };
}

/** Area: the area, then a length or a width; the other side counting the corners' area. */
async function* byArea(ctx: CommandContext, s: RectangState): Sub<[number, number] | undefined> {
  const area = yield* positive(ctx, 'Enter area of rectangle in current units', s.area);
  if (area === undefined) return undefined;
  const by = yield ctx.prompt.keyword({
    message: 'Calculate rectangle dimensions based on',
    options: ['Length', 'Width'],
    default: { kind: 'keyword', keyword: 'Length' },
  });
  if (by.kind !== 'keyword') return undefined;
  const length = by.keyword === 'Length';
  const side = yield* positive(
    ctx,
    length ? 'Enter rectangle length' : 'Enter rectangle width',
    length ? s.length : s.breadth,
  );
  if (side === undefined) return undefined;
  const other = (area + cornersArea(cornersOf(s))) / side;
  s.area = area;
  s.length = length ? side : other;
  s.breadth = length ? other : side;
  return [s.length, s.breadth];
}

/** A distance above zero, `value` the default. */
async function* positive(
  ctx: CommandContext,
  message: string,
  value: number,
): Sub<number | undefined> {
  for (;;) {
    const a = yield ctx.prompt.distance({ message, default: { kind: 'distance', value } });
    if (a.kind !== 'distance') return undefined;
    if (a.value > 0) return a.value;
    ctx.message(POSITIVE);
  }
}

/** Rotation: an angle, or the angle from a first point to a second (Pick points). */
async function* rotation(ctx: CommandContext, value: number): Sub<number | undefined> {
  const a = yield ctx.prompt.angle({
    message: 'Specify rotation angle or',
    options: ['Pick points'],
    default: { kind: 'angle', value },
  });
  if (a.kind === 'angle') return a.value;
  if (a.kind !== 'keyword') return undefined;
  const p = yield ctx.prompt.point({ message: 'Specify first point' });
  if (p.kind !== 'point') return undefined;
  const q = yield ctx.prompt.point({
    message: 'Specify second point',
    rubberBand: { from: p.point },
  });
  if (q.kind !== 'point') return undefined;
  return angleOf(sub(q.point, p.point));
}

function draw(
  ctx: CommandContext,
  s: RectangState,
  first: Vec2,
  length: number,
  width: number,
): void {
  const reach = Math.abs(length) + Math.abs(width);
  const tol = sketchTolerance(first, {
    x: Math.abs(first.x) + reach,
    y: Math.abs(first.y) + reach,
  });
  const vertices = rectangleVertices(first, length, width, s.rotation, cornersOf(s), tol);
  const props = currentProps(ctx.model);
  const plinegen = ctx.model.header.get('$PLINEGEN') === 1;
  const geom = {
    ...closed(vertices, s.width),
    ...(s.elevation !== 0 && { elevation: s.elevation }),
    ...(s.thickness !== 0 && { thickness: s.thickness }),
    ...(plinegen && { plinegen }),
  };
  ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom }));
}
