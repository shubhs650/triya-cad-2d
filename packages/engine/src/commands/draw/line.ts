// LINE (M2-02; the rest of its options, tangent and perpendicular starts through osnaps, are
// M3-01's): a chain of separate LINE entities, each drawn as its point is given, so Esc keeps
// the segments already drawn. AutoCAD 2024's prompts:
//   Specify first point:                     Enter continues from the last line's end
//   Specify next point or [Undo]:            the first two segments
//   Specify next point or [Close/Undo]:      from the third on
// (AutoCAD 2024 Help, "LINE (Command)").
import type { Vec2 } from '../../geom/types';
import type { EntityId } from '../../model/entity-ids';
import type { CommandDef } from '../command';
import { currentProps } from '../../properties/current';

export { currentLayer } from '../../properties/current';

/**
 * LINE for one document. The definition remembers where its last segment ended, which Enter at
 * "Specify first point" continues from (AutoCAD continues from the last line or arc drawn; arcs
 * join when ARC does, M3-01).
 */
export function lineCommand(): CommandDef {
  let lastEnd: Vec2 | undefined;
  return {
    name: 'LINE',
    async *run(ctx) {
      let first: Vec2 | undefined;
      while (!first) {
        const a = yield ctx.prompt.point({ message: 'Specify first point' });
        if (a.kind === 'point') first = a.point;
        else if (a.kind === 'enter') {
          if (lastEnd) first = lastEnd;
          else ctx.message('No line or arc to continue.');
        } else return;
      }
      const points: Vec2[] = [first];
      const ids: EntityId[] = [];
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
            lastEnd = ids.length > 0 ? points.at(-1) : undefined;
          }
          continue;
        }
        const close = a.kind === 'keyword' && a.keyword === 'Close';
        const to = close ? points[0]! : a.kind === 'point' ? a.point : undefined;
        if (!to) return;
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
        lastEnd = to;
        if (close) return;
        points.push(to);
      }
    },
  };
}
