// Grip editing (M2-06 part 2): a click on a grip of the objects selected at `Command:` makes it
// hot and starts AutoCAD's grip modes (AutoCAD 2024 Help, "To Use Grips to Stretch, Move,
// Rotate, Scale or Mirror Objects"): STRETCH, then on each Enter (or Space) MOVE, ROTATE, SCALE
// and MIRROR, round again. Each mode takes Base point, Copy (keep the originals and place as
// many copies as wanted, until Enter or eXit), Undo (the last copy) and eXit; ROTATE and SCALE
// take Reference. The edit is about the hot grip, or the base point given instead. MIRROR
// without Copy leaves only the mirror image, as AutoCAD's does. The objects stay selected.
import type { Vec2 } from '../../geom/types';
import { add, sub } from '../../geom/vec';
import type { EntityId } from '../../model/entity-ids';
import { copyObjects, gripObjects, refusalMessages, transformObjects } from '../../edit/edit';
import { moveGrip } from '../../edit/grips';
import { revcloudOf } from '../../edit/revcloud';
import { mirrorIn, moveBy, scaleAbout, turnAbout, type Similarity } from '../../edit/similarity';
import type { DocumentModel } from '../../model/document';
import type { TransformOptions } from '../../edit/transform';
import type { Prompt, PromptAnswer } from '../prompt';
import type { CommandContext, CommandDef } from '../command';
import { regenerateDimensions } from './dimensions';

export const GRIP_MODES = ['STRETCH', 'MOVE', 'ROTATE', 'SCALE', 'MIRROR'] as const;
export type GripMode = (typeof GRIP_MODES)[number];

/** GRIPOBJLIMIT: grips show for at most this many selected objects (AutoCAD's default 100). */
export const GRIP_OBJECT_LIMIT = 100;

const mirrorOptions = (model: DocumentModel): TransformOptions => {
  const on = (name: string) => {
    const v = model.header.get(name);
    return v === 1 || v === true;
  };
  return { mirrorText: on('$MIRRTEXT'), mirrorHatch: on('$MIRRHATCH') };
};

/** Copies of the objects with a grip at `grip`, that grip dragged to `to` (STRETCH with Copy). */
function copyStretched(
  ctx: CommandContext,
  ids: readonly EntityId[],
  grip: Vec2,
  to: Vec2,
): EntityId[] {
  const out: EntityId[] = [];
  ctx.edit((b) => {
    for (const id of ids) {
      const e = b.entity(id);
      if (!e) continue;
      const r = moveGrip(e.geom, grip, to, revcloudOf(ctx.model, e));
      if (r.kind === 'none' || r.kind === 'whole') continue;
      const t = r.kind === 'move' ? moveBy(sub(to, grip)) : moveBy({ x: 0, y: 0 });
      const [copy] = copyObjects(b, ctx.model, [id], t, mirrorOptions(ctx.model)).ids;
      if (copy === undefined) continue;
      if (r.kind === 'shape') {
        // A dimension's copy keeps the block of its own that the copy gave it.
        const own = b.entity(copy)!.geom;
        const geom =
          'dimType' in r.geom && 'dimType' in own ? { ...r.geom, block: own.block } : r.geom;
        b.updateEntity(copy, { geom: geom as typeof r.geom });
      }
      out.push(copy);
    }
  });
  return out;
}

/** The grip modes on `ids` with the grip at `hot` hot. */
export function gripCommand(ids: readonly EntityId[], hot: Vec2): CommandDef {
  return {
    name: 'GRIP',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      let mode = 0;
      let base = hot;
      let copying = false;
      const made: EntityId[][] = [];
      const say = (lines: string[]) => lines.forEach((l) => ctx.message(l));
      /** One edit: kept as a copy (the mode goes on) or made (grip editing ends). */
      const apply = (t: Similarity, verb: string): boolean => {
        if (copying) {
          let r: ReturnType<typeof copyObjects> | undefined;
          ctx.edit((b) => {
            r = copyObjects(b, ctx.model, ids, t, mirrorOptions(ctx.model));
          });
          say(refusalMessages(r!.refused, 'copied'));
          made.push([...r!.ids]);
          return false;
        }
        let r: ReturnType<typeof transformObjects> | undefined;
        ctx.edit((b) => {
          r = transformObjects(b, ctx.model, ids, t, mirrorOptions(ctx.model));
        });
        say(refusalMessages(r!.refused, verb));
        return true;
      };
      for (;;) {
        const name = GRIP_MODES[mode]!;
        ctx.message(`** ${name}${copying ? ' (multiple)' : ''} **`);
        const options = ['Base point', 'Copy', 'Undo', 'eXit'];
        const withReference = ['Base point', 'Copy', 'Undo', 'Reference', 'eXit'];
        let a: PromptAnswer;
        switch (name) {
          case 'STRETCH':
            a = yield ctx.prompt.point({
              message: 'Specify stretch point or',
              options,
              rubberBand: { from: base },
              drag: { kind: 'grip', ids, grip: hot, from: base },
            });
            break;
          case 'MOVE':
            a = yield ctx.prompt.point({
              message: 'Specify move point or',
              options,
              rubberBand: { from: base },
              drag: { kind: 'move', ids, from: base },
            });
            break;
          case 'ROTATE':
            a = yield ctx.prompt.angle({
              message: 'Specify rotation angle or',
              options: withReference,
              base,
              drag: { kind: 'rotate', ids, base, reference: 0 },
            });
            break;
          case 'SCALE':
            a = yield ctx.prompt.distance({
              message: 'Specify scale factor or',
              options: withReference,
              base,
              drag: { kind: 'scale', ids, base, reference: 1 },
            });
            break;
          case 'MIRROR':
            a = yield ctx.prompt.point({
              message: 'Specify second point or',
              options,
              rubberBand: { from: base },
              drag: { kind: 'mirror', ids, from: base },
            });
            break;
        }
        if (a.kind === 'enter') {
          // Enter (or Space) goes on to the next mode; after copies it ends, as AutoCAD's.
          if (made.length > 0) return;
          mode = (mode + 1) % GRIP_MODES.length;
          continue;
        }
        if (a.kind === 'keyword') {
          switch (a.keyword) {
            case 'eXit':
              return;
            case 'Copy':
              copying = true;
              continue;
            case 'Undo': {
              const last = made.pop();
              if (last) ctx.edit((b) => last.forEach((id) => b.entity(id) && b.removeEntity(id)));
              continue;
            }
            case 'Base point': {
              const p = yield ctx.prompt.point({ message: 'Specify base point' });
              if (p.kind === 'point') base = p.point;
              continue;
            }
            case 'Reference': {
              const done =
                name === 'ROTATE'
                  ? yield* rotateReference(ctx, ids, base, apply)
                  : yield* scaleReference(ctx, ids, base, apply);
              if (done === 'end') return;
              continue;
            }
          }
          continue;
        }
        let ended = false;
        if (name === 'STRETCH' && a.kind === 'point') {
          const to = add(hot, sub(a.point, base));
          if (copying) {
            const copies = copyStretched(ctx, ids, hot, to);
            made.push(copies);
            await regenerateDimensions(
              ctx,
              copies.filter((id) => 'dimType' in ctx.model.entity(id)!.geom),
            );
          } else {
            let r: ReturnType<typeof gripObjects> | undefined;
            ctx.edit((b) => {
              r = gripObjects(b, ctx.model, ids, hot, to);
            });
            say(refusalMessages(r!.refused, 'stretched'));
            // A dimension's grip reshapes it: the dimension engine draws it afresh (M2-11).
            await regenerateDimensions(ctx, r!.regenerate ?? []);
            ended = true;
          }
        } else if (name === 'MOVE' && a.kind === 'point') {
          ended = apply(moveBy(sub(a.point, base)), 'moved');
        } else if (name === 'ROTATE' && a.kind === 'angle') {
          ended = apply(turnAbout(base, a.value), 'rotated');
        } else if (name === 'SCALE' && a.kind === 'distance') {
          if (!(a.value > 0)) {
            ctx.message('Value must be positive and nonzero.');
            continue;
          }
          ended = apply(scaleAbout(base, a.value), 'scaled');
        } else if (name === 'MIRROR' && a.kind === 'point') {
          if (a.point.x === base.x && a.point.y === base.y) {
            ctx.message('Mirror line points must be different.');
            continue;
          }
          ended = apply(mirrorIn(base, a.point), 'mirrored');
        }
        if (ended) return;
      }
    },
  };
}

type Apply = (t: Similarity, verb: string) => boolean;
type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** ROTATE's Reference: "Specify reference angle <0>:", then the new angle, dragged. */
async function* rotateReference(
  ctx: CommandContext,
  ids: readonly EntityId[],
  base: Vec2,
  apply: Apply,
): Sub<'end' | 'more'> {
  const r = yield ctx.prompt.angle({
    message: 'Specify reference angle',
    default: { kind: 'angle', value: 0 },
  });
  if (r.kind !== 'angle') return 'more';
  const n = yield ctx.prompt.angle({
    message: 'Specify new angle',
    base,
    drag: { kind: 'rotate', ids, base, reference: r.value },
  });
  if (n.kind !== 'angle') return 'more';
  return apply(turnAbout(base, n.value - r.value), 'rotated') ? 'end' : 'more';
}

/** SCALE's Reference: "Specify reference length <1.0000>:", then the new length, dragged. */
async function* scaleReference(
  ctx: CommandContext,
  ids: readonly EntityId[],
  base: Vec2,
  apply: Apply,
): Sub<'end' | 'more'> {
  const r = yield ctx.prompt.distance({
    message: 'Specify reference length',
    default: { kind: 'distance', value: 1 },
  });
  if (r.kind !== 'distance' || !(r.value > 0)) return 'more';
  const n = yield ctx.prompt.distance({
    message: 'Specify new length',
    base,
    drag: { kind: 'scale', ids, base, reference: r.value },
  });
  if (n.kind !== 'distance' || !(n.value > 0)) return 'more';
  return apply(scaleAbout(base, n.value / r.value), 'scaled') ? 'end' : 'more';
}
