// LINE (M2-02; continuing from an arc, M3-01): a chain of separate LINE entities, each drawn as
// its point is given, so Esc keeps the segments already drawn. AutoCAD 2024's prompts:
//   Specify first point:                     Enter continues from the last line or arc
//   Specify length of line:                  after Enter, when the last was an arc: the line
//                                            leaves the arc's end tangent to it
//   Specify next point or [Undo]:            the first two segments
//   Specify next point or [Close/Undo]:      from the third on
// (AutoCAD 2024 Help, "LINE (Command)"). Tangent and perpendicular starts come from the running
// and typed object snaps (M2-04).
import type { Vec2 } from '../../geom/types';
import { add, scale } from '../../geom/vec';
import type { EntityId } from '../../model/entity-ids';
import type { CommandDef } from '../command';
import { currentProps } from '../../properties/current';
import { lastDrawn, lineDirection, type LastDrawn } from './last-drawn';

export { currentLayer } from '../../properties/current';

/**
 * LINE for one document. `last` is where the last line or arc drawn ended, which Enter at
 * "Specify first point" continues from; ARC shares it (`builtinCommands`).
 */
export function lineCommand(last: LastDrawn = lastDrawn()): CommandDef {
  return {
    name: 'LINE',
    async *run(ctx) {
      const points: Vec2[] = [];
      const ids: EntityId[] = [];
      const draw = (from: Vec2, to: Vec2): void => {
        const props = currentProps(ctx.model);
        ctx.edit((b) => {
          ids.push(
            b.addEntity({
              owner: ctx.space,
              ...props,
              geom: { kind: 'LINE', start: from, end: to },
            }).id,
          );
        });
        last.end = {
          point: to,
          direction: lineDirection(from, to, last.end?.direction),
          arc: false,
        };
      };
      while (points.length === 0) {
        const a = yield ctx.prompt.point({ message: 'Specify first point' });
        if (a.kind === 'point') points.push(a.point);
        else if (a.kind !== 'enter') return;
        else if (!last.end) ctx.message('No line or arc to continue.');
        else if (!last.end.arc) points.push(last.end.point);
        else {
          const { point: from, direction } = last.end;
          const l = yield ctx.prompt.distance({ message: 'Specify length of line', base: from });
          if (l.kind !== 'distance') return;
          const to = add(from, scale(direction, l.value));
          draw(from, to);
          points.push(from, to);
        }
      }
      for (;;) {
        const from = points.at(-1)!;
        const a = yield ctx.prompt.point({
          message: 'Specify next point or',
          options: ids.length >= 2 ? ['Close', 'Undo'] : ['Undo'],
          rubberBand: { from },
        });
        if (a.kind === 'keyword' && a.keyword === 'Undo') {
          const id = ids.pop();
          if (id === undefined) ctx.message('All segments already undone.');
          else {
            ctx.edit((b) => b.removeEntity(id));
            points.pop();
            const [p, q] = points.slice(-2);
            last.end =
              ids.length > 0 && p && q
                ? { point: q, direction: lineDirection(p, q), arc: false }
                : undefined;
          }
          continue;
        }
        const close = a.kind === 'keyword' && a.keyword === 'Close';
        const to = close ? points[0]! : a.kind === 'point' ? a.point : undefined;
        if (!to) return;
        draw(from, to);
        if (close) return;
        points.push(to);
      }
    },
  };
}
