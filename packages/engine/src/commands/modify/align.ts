// ALIGN (M3-02 part 4), with AutoCAD 2024's prompts (AutoCAD Help, "ALIGN (Command)"):
//
//   Select objects:
//   Specify first source point:
//   Specify first destination point:
//   Specify second source point:
//   Specify second destination point:
//   Specify third source point or <continue>:
//   Scale objects based on alignment points? [Yes/No] <N>:
//
// One pair of points moves the objects; two pairs also turn them so that the second source point
// lies along the line to the second destination point, and scale them (Yes) so it lands on it.
// A third pair tilts the objects in 3D in AutoCAD; in plan (DEC-039) it can only keep them or
// turn them over, so the objects are mirrored about the first two destination points' line when
// the three source points run the other way round from the three destination points, the
// drafter's expectation of a flip, and are never scaled.
import { cross, distance, sub, angleOf } from '../../geom/vec';
import type { Vec2 } from '../../geom/types';
import { refusalMessages, transformObjects } from '../../edit/edit';
import {
  followedBy,
  mirrorIn,
  moveBy,
  scaleAbout,
  turnAbout,
  type Similarity,
} from '../../edit/similarity';
import type { CommandDef } from '../command';
import { regenerateDimensions } from './dimensions';

export function alignCommand(): CommandDef {
  return {
    name: 'ALIGN',
    usesSelection: 'during',
    async *run(ctx) {
      const sel = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      if (sel.kind !== 'selection' || sel.ids.length === 0) return;
      const ids = sel.ids;
      const pairs: { s: Vec2; d: Vec2 }[] = [];
      const ORD = ['first', 'second', 'third'] as const;
      for (const ord of ORD) {
        const s = yield ctx.prompt.point({
          message:
            ord === 'first' ? 'Specify first source point' : `Specify ${ord} source point or`,
          ...(ord !== 'first' && { defaultLabel: 'continue' }),
        });
        if (s.kind === 'enter' && ord !== 'first') break;
        if (s.kind !== 'point') return;
        const d = yield ctx.prompt.point({
          message: `Specify ${ord} destination point`,
          rubberBand: { from: s.point },
        });
        if (d.kind !== 'point') return;
        pairs.push({ s: s.point, d: d.point });
      }
      const [p1, p2, p3] = pairs;
      let t: Similarity = moveBy(sub(p1!.d, p1!.s));
      if (p2) {
        const from = sub(p2.s, p1!.s);
        const to = sub(p2.d, p1!.d);
        if (distance(p2.s, p1!.s) === 0 || distance(p2.d, p1!.d) === 0) {
          ctx.message('Source and destination points must differ.');
          return;
        }
        t = followedBy(t, turnAbout(p1!.d, angleOf(to) - angleOf(from)));
        if (p3) {
          const turnsSource = cross(from, sub(p3.s, p1!.s));
          const turnsDest = cross(to, sub(p3.d, p1!.d));
          if (turnsSource * turnsDest < 0) t = followedBy(t, mirrorIn(p1!.d, p2.d));
        } else {
          const k = yield ctx.prompt.keyword({
            message: 'Scale objects based on alignment points?',
            options: ['Yes', 'No'],
            default: { kind: 'keyword', keyword: 'No' },
          });
          if (k.kind === 'keyword' && k.keyword === 'Yes') {
            t = followedBy(t, scaleAbout(p1!.d, distance(p1!.d, p2.d) / distance(p1!.s, p2.s)));
          }
        }
      }
      let report: ReturnType<typeof transformObjects> | undefined;
      ctx.edit((b) => {
        report = transformObjects(b, ctx.model, ids, t);
      });
      for (const line of refusalMessages(report!.refused, 'aligned')) ctx.message(line);
      // A turned or scaled dimension is redrawn as it now measures.
      await regenerateDimensions(ctx, report!.regenerate ?? []);
    },
  };
}
