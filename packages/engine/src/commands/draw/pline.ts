// PLINE (M3-01 part 3): one LWPOLYLINE of line and arc segments, on AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "PLINE (Command)"):
//   Specify start point:
//   Current line-width is 0.0000
//   Specify next point or [Arc/Halfwidth/Length/Undo/Width]:          before the first segment
//   Specify next point or [Arc/Close/Halfwidth/Length/Undo/Width]:    after it
//   Arc:        the arc segment prompts (`pline-arc.ts`), until Line
//   Width:      Specify starting width <0.0000>:  Specify ending width <starting>:
//   Halfwidth:  Specify starting half-width <0.0000>:  Specify ending half-width <starting>:
//   Length:     Specify length of line:   on along the last segment (tangent to an arc)
//   Undo:       removes the last segment;  Close: back to the start point, and ends
// The polyline is in the drawing from its first segment and grows with each, so Esc and Enter
// keep what is drawn, and it is one undo step. The ending width is the width of the segments
// that follow and the drawing's PLINEWID (the next PLINE's "Current line-width"); the drawing's
// PLINEGEN is the new polyline's linetype generation. A polyline whose segments all share one
// width is written with that constant width (DXF 43), as AutoCAD writes one.
import type { BulgeArc } from '../../geom/eval';
import { arcEnd, arcStartDirectionEnd } from '../../geom/construct';
import { bulgeOf } from '../../geom/shapes';
import type { Vec2 } from '../../geom/types';
import { add, scale } from '../../geom/vec';
import type { EntityId } from '../../model/entity-ids';
import type { LwPolylineGeometry, PolylineVertex } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatDistance } from '../units';
import { currentProps } from '../../properties/current';
import { INVALID_ARC } from './arc';
import { lastDrawn, lineDirection, type LastDrawn } from './last-drawn';
import { arcSegment } from './pline-arc';
import { sketchTolerance } from './sketch';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const NOT_NEGATIVE = 'Value must be positive or zero.';

interface Vertex {
  x: number;
  y: number;
  bulge: number;
  /** The widths of the segment from this vertex (for the last, of the segment to come). */
  startWidth: number;
  endWidth: number;
}

/** A drawing's PLINEWID: the width a new polyline starts with. */
function plineWidth(ctx: CommandContext): number {
  const w = ctx.model.header.get('$PLINEWID');
  return typeof w === 'number' && w > 0 ? w : 0;
}

/**
 * PLINE for one document. `last` is where the last line or arc drawn ended: a first segment
 * drawn as an arc leaves in its direction (AutoCAD: tangent to the last object drawn), east when
 * there is none.
 */
export function plineCommand(last: LastDrawn = lastDrawn()): CommandDef {
  return {
    name: 'PLINE',
    async *run(ctx) {
      const s = yield ctx.prompt.point({ message: 'Specify start point' });
      if (s.kind !== 'point') return;
      const units = drawingUnits(ctx.model.header);
      const width = plineWidth(ctx);
      ctx.message(`Current line-width is ${formatDistance(width, units)}`);
      const props = currentProps(ctx.model);
      const plinegen = ctx.model.header.get('$PLINEGEN') === 1;
      const vertices: Vertex[] = [
        { x: s.point.x, y: s.point.y, bulge: 0, startWidth: width, endWidth: width },
      ];
      /** The direction the path travels at the end of each segment. */
      const directions: Vec2[] = [];
      const startDirection = last.end?.direction ?? { x: 1, y: 0 };
      let id: EntityId | undefined;
      let arcMode = false;

      const current = (): Vertex => vertices.at(-1)!;
      const point = (): Vec2 => ({ x: current().x, y: current().y });
      const direction = (): Vec2 => directions.at(-1) ?? startDirection;
      const write = (closed: boolean): void => {
        const geom = vertices.length >= 2 ? geometry(vertices, closed, plinegen) : undefined;
        ctx.edit((b) => {
          if (!geom) {
            // Undo back to the start point: there is a polyline, as there was a segment.
            b.removeEntity(id!);
            id = undefined;
          } else if (id === undefined) {
            id = b.addEntity({ owner: ctx.space, ...props, geom }).id;
          } else b.updateEntity(id, { geom });
        });
      };
      const segment = (to: Vec2, bulge: number, travel: Vec2): void => {
        const from = current();
        from.bulge = bulge;
        vertices.push({
          x: to.x,
          y: to.y,
          bulge: 0,
          startWidth: from.endWidth,
          endWidth: from.endWidth,
        });
        directions.push(travel);
        write(false);
      };
      const drawArc = (arc: BulgeArc): void => {
        const end = arcEnd(arc);
        segment(end.point, bulgeOf(arc), end.direction);
      };

      for (;;) {
        const segments = vertices.length - 1;
        let answer: PromptAnswer | { kind: 'arc'; arc: BulgeArc };
        if (!arcMode) {
          const from = point();
          answer = yield {
            ...ctx.prompt.point({
              message: 'Specify next point or',
              options:
                segments > 0
                  ? ['Arc', 'Close', 'Halfwidth', 'Length', 'Undo', 'Width']
                  : ['Arc', 'Halfwidth', 'Length', 'Undo', 'Width'],
              rubberBand: { from, ...(segments > 0 && { direction: direction() }) },
            }),
            drag: {
              kind: 'sketch',
              sketch: {
                shape: 'pline',
                from,
                startWidth: current().startWidth,
                endWidth: current().endWidth,
              },
              layer: props.layer,
            },
          };
        } else {
          const step = yield* arcSegment(ctx, {
            start: point(),
            direction: direction(),
            options:
              segments > 0
                ? ['CLose', 'Halfwidth', 'Line', 'Undo', 'Width']
                : ['Halfwidth', 'Line', 'Undo', 'Width'],
            layer: props.layer,
            widths: { start: current().startWidth, end: current().endWidth },
          });
          if (!step) return;
          answer = step;
        }
        if (answer.kind === 'point') {
          segment(answer.point, 0, lineDirection(point(), answer.point, direction()));
          continue;
        }
        if (answer.kind === 'arc') {
          drawArc(answer.arc);
          continue;
        }
        if (answer.kind !== 'keyword') return;
        switch (answer.keyword) {
          case 'Arc':
            arcMode = true;
            break;
          case 'Line':
            arcMode = false;
            break;
          case 'Close':
            write(true);
            return;
          case 'CLose': {
            const first = vertices[0]!;
            const arc = arcStartDirectionEnd(
              point(),
              direction(),
              first,
              sketchTolerance(point(), first),
            );
            if (!arc) {
              ctx.message(INVALID_ARC);
              break;
            }
            current().bulge = bulgeOf(arc);
            write(true);
            return;
          }
          case 'Length': {
            const l = yield ctx.prompt.distance({
              message: 'Specify length of line',
              base: point(),
            });
            if (l.kind !== 'distance') break;
            const d = direction();
            segment(add(point(), scale(d, l.value)), 0, l.value < 0 ? scale(d, -1) : d);
            break;
          }
          case 'Undo':
            if (segments === 0) {
              ctx.message('All segments already undone.');
              break;
            }
            vertices.pop();
            directions.pop();
            current().bulge = 0;
            write(false);
            break;
          case 'Width':
          case 'Halfwidth': {
            const w = yield* widths(ctx, current(), answer.keyword === 'Halfwidth');
            current().startWidth = w[0];
            current().endWidth = w[1];
            ctx.edit((b) => b.setHeader('$PLINEWID', w[1]));
            if (id !== undefined) write(false);
            break;
          }
        }
      }
    },
  };
}

/** Width or Halfwidth: the next segment's starting and ending widths (each has a default). */
async function* widths(ctx: CommandContext, at: Vertex, half: boolean): Sub<[number, number]> {
  const k = half ? 2 : 1;
  const word = half ? 'half-width' : 'width';
  const base = { x: at.x, y: at.y };
  const ask = async function* (which: string, value: number): Sub<number> {
    for (;;) {
      const a = yield ctx.prompt.distance({
        message: `Specify ${which} ${word}`,
        base,
        default: { kind: 'distance', value },
      });
      const v = (a as { value: number }).value;
      if (v >= 0) return v * k;
      ctx.message(NOT_NEGATIVE);
    }
  };
  const start = yield* ask('starting', at.startWidth / k);
  const end = yield* ask('ending', start / k);
  return [start, end];
}

/** The LWPOLYLINE `vertices` make: one constant width when they all share it. */
function geometry(vertices: readonly Vertex[], closed: boolean, plinegen: boolean) {
  const w = vertices[0]!.startWidth;
  const constant = vertices.every((v) => v.startWidth === w && v.endWidth === w);
  const out: PolylineVertex[] = vertices.map((v) =>
    constant
      ? { x: v.x, y: v.y, bulge: v.bulge }
      : { x: v.x, y: v.y, bulge: v.bulge, startWidth: v.startWidth, endWidth: v.endWidth },
  );
  const g: LwPolylineGeometry = {
    kind: 'LWPOLYLINE',
    vertices: out,
    closed,
    ...(constant && w > 0 && { constantWidth: w }),
    ...(plinegen && { plinegen }),
  };
  return g;
}
