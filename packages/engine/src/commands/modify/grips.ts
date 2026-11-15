// Grip editing (M2-06 part 2): a click on a grip of the objects selected at `Command:` makes it
// hot and starts AutoCAD's grip modes (AutoCAD 2024 Help, "To Use Grips to Stretch, Move,
// Rotate, Scale or Mirror Objects"): STRETCH, then on each Enter (or Space) MOVE, ROTATE, SCALE
// and MIRROR, round again. Each mode takes Base point, Copy (keep the originals and place as
// many copies as wanted, until Enter or eXit), Undo (the last copy) and eXit; ROTATE and SCALE
// take Reference. The edit is about the hot grip, or the base point given instead. MIRROR
// without Copy leaves only the mirror image, as AutoCAD's does. The objects stay selected.
// The mode names (ST, MO, RO, SC, MI) can be typed at any grip prompt to go to that mode.
//
// A multi-functional grip (M3-05 part 1, `edit/grip-functions.ts`): STRETCH is its first
// function, and a tap of Ctrl goes on to the next that takes a point, as AutoCAD's Ctrl cycles
// them ("** ADD VERTEX **", "** LENGTHEN **", …), round to STRETCH again. Each function can also
// be typed by name, or picked from the grip's hover menu (part 2: the grip starts in it); Remove
// Vertex and Convert to Line take no point and act at once. Part 2 also takes a point clicked
// with Ctrl held at a grip mode's prompt as Copy turned on, that click placing the first copy. A function edits only the first selected object
// with that grip, in one undo step; Enter goes on to MOVE, as from STRETCH.
//
// A dimension's grips (M3-05 part 4): Flip Arrow and the text placements that take no point act at
// once; Continue and Baseline Dimension end grip editing in DIMCONTINUE's or DIMBASELINE's
// prompts, going on from the extension line at the grip's end.
import { removeCopies } from '../../edit/groups';
import type { Vec2 } from '../../geom/types';
import { add, sub } from '../../geom/vec';
import type { EntityId } from '../../model/entity-ids';
import { copyObjects, gripObjects, refusalMessages, transformObjects } from '../../edit/edit';
import { moveGrip } from '../../edit/grips';
import { gripInfoOf } from '../../edit/array-grips';
import { mirrorIn, moveBy, scaleAbout, turnAbout, type Similarity } from '../../edit/similarity';
import type { DocumentModel } from '../../model/document';
import type { TransformOptions } from '../../edit/transform';
import type { Prompt, PromptAnswer } from '../prompt';
import type { CommandContext, CommandDef } from '../command';
import { arrayGripAt, editArrayByGrip } from './array-grips';
import { regenerateDimensions } from './dimensions';
import {
  functionsAt,
  gripShortcutMenu,
  runGripFunction,
  FUNCTION_KEYWORDS,
  MODE_KEYWORDS,
  PROPERTIES_KEYWORD,
} from './grip-functions';
import { viewRequest } from '../view/zoom';
import { GRIP_CYCLE } from '../prompt';
import {
  COMMAND_FUNCTIONS,
  IMMEDIATE_FUNCTIONS,
  type GripFunction,
} from '../../edit/grip-functions';
import { continueDimension } from '../draw/dimension';
import { recountColumns } from './mtext-columns';

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
      const r = moveGrip(e.geom, grip, to, gripInfoOf(ctx.model, e));
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

/**
 * The grip modes on `ids` with the grip at `hot` hot; `first`, a function picked from the grip's
 * hover menu (M3-05 part 2), the one it starts in. `group`: the hot grip is a selected group's
 * centre grip (GROUPDISPLAYMODE, M3-13), whose STRETCH moves the objects, as a grip at no
 * object's own point does.
 */
export function gripCommand(
  ids: readonly EntityId[],
  hot: Vec2,
  first?: string,
  group?: boolean,
): CommandDef {
  return {
    name: 'GRIP',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      // An associative array's sizing grip edits that array alone (M3-11 part 3).
      const array = group ? undefined : arrayGripAt(ctx.model, ids, hot);
      if (array) return yield* editArrayByGrip(ctx, array.id, array.role, hot, first);
      // The hot grip's functions, if it has more than one (M3-05).
      const multi = group ? undefined : functionsAt(ctx.model, ids, hot);
      const picked = first === 'Stretch Vertex' ? 'Stretch' : first;
      let fn: GripFunction | undefined =
        multi && picked !== multi.functions[0]
          ? multi.functions.find((f) => f === picked)
          : undefined;
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
      /** The keyword names a grip mode (switched to) or a function (`fn` set): handled. */
      const switched = (keyword: string): boolean => {
        const m = MODE_KEYWORDS.indexOf(keyword as (typeof MODE_KEYWORDS)[number]);
        if (m >= 0) {
          mode = m;
          fn = undefined;
          return true;
        }
        const f = multi && FUNCTION_KEYWORDS.get(keyword);
        if (!f || !multi.functions.includes(f)) return false;
        fn = f === multi.functions[0] ? undefined : f;
        mode = 0;
        return true;
      };
      /** The functions Ctrl goes through: those that take a point. */
      const takes: readonly GripFunction[] = (multi?.functions ?? []).filter(
        (f) => !IMMEDIATE_FUNCTIONS.has(f) && !COMMAND_FUNCTIONS.has(f),
      );
      /** Ctrl: the next function that takes a point, after `fn`, round to STRETCH. */
      const cycle = () => {
        const next = takes[(takes.indexOf(fn ?? takes[0]!) + 1) % takes.length]!;
        fn = next === takes[0] ? undefined : next;
        mode = 0;
      };
      const hidden = [...MODE_KEYWORDS, ...(multi?.keywords ?? []), PROPERTIES_KEYWORD];
      /** Properties (M3-05 part 5): grip editing ends, the palette opens on the selection. */
      const properties = async (): Promise<void> => {
        await viewRequest(ctx, { op: 'palette', palette: 'properties', open: true });
      };
      for (;;) {
        if (fn && multi) {
          const menu = gripShortcutMenu(['eXit', ...hidden], multi.functions);
          const r = yield* runGripFunction(ctx, multi.id, hot, fn, hidden, menu);
          if (r.kind === 'done') return;
          if (r.kind === 'keyword' && r.keyword === PROPERTIES_KEYWORD) return await properties();
          // Continue or Baseline Dimension: grip editing goes on as DIMCONTINUE or DIMBASELINE.
          if (r.kind === 'chain')
            return yield* continueDimension(ctx, multi.id, r.from, r.baseline);
          if (r.kind === 'cycle') cycle();
          else if (r.kind !== 'keyword' || !switched(r.keyword)) {
            // Enter goes on to MOVE; an immediate function refused goes back to STRETCH.
            fn = undefined;
            if (r.kind === 'enter') mode = 1;
          }
          continue;
        }
        const name = GRIP_MODES[mode]!;
        ctx.message(`** ${name}${copying ? ' (multiple)' : ''} **`);
        const stretching = name === 'STRETCH' && multi !== undefined;
        const hiddenOptions = stretching ? hidden : [...MODE_KEYWORDS, PROPERTIES_KEYWORD];
        const options = ['Base point', 'Copy', 'Undo', 'eXit'];
        const withReference = ['Base point', 'Copy', 'Undo', 'Reference', 'eXit'];
        const referenced = name === 'ROTATE' || name === 'SCALE';
        const extra = {
          hiddenOptions,
          ...(stretching && takes.length > 1 && { ctrlCycles: true as const }),
          ctrlCopies: true as const,
          // The right-click menu (M3-05 part 5): what this prompt takes, the rest greyed.
          shortcutMenu: gripShortcutMenu(
            [...(referenced ? withReference : options), ...hiddenOptions],
            multi?.functions,
          ),
        };
        let a: PromptAnswer;
        switch (name) {
          case 'STRETCH':
            a = yield ctx.prompt.point({
              message: 'Specify stretch point or',
              options,
              ...extra,
              rubberBand: { from: base },
              drag: group
                ? { kind: 'move', ids, from: base }
                : { kind: 'grip', ids, grip: hot, from: base },
            });
            break;
          case 'MOVE':
            a = yield ctx.prompt.point({
              message: 'Specify move point or',
              options,
              ...extra,
              rubberBand: { from: base },
              drag: { kind: 'move', ids, from: base },
            });
            break;
          case 'ROTATE':
            a = yield ctx.prompt.angle({
              turn: true,
              message: 'Specify rotation angle or',
              options: withReference,
              ...extra,
              base,
              drag: { kind: 'rotate', ids, base, reference: 0 },
            });
            break;
          case 'SCALE':
            a = yield ctx.prompt.distance({
              message: 'Specify scale factor or',
              options: withReference,
              ...extra,
              base,
              drag: { kind: 'scale', ids, base, reference: 1 },
            });
            break;
          case 'MIRROR':
            a = yield ctx.prompt.point({
              message: 'Specify second point or',
              options,
              ...extra,
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
          if (a.keyword === GRIP_CYCLE) {
            if (stretching && takes.length > 1) cycle();
            continue;
          }
          // A mode or function typed: the loop goes there (Remove Vertex and Convert to Line
          // act at once).
          if (switched(a.keyword)) continue;
          switch (a.keyword) {
            case 'eXit':
              return;
            case PROPERTIES_KEYWORD:
              return await properties();
            case 'Copy':
              copying = true;
              continue;
            case 'Undo': {
              const last = made.pop();
              if (last) ctx.edit((b) => removeCopies(b, last));
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
        // A point clicked with Ctrl held turns Copy on, this one placing the first copy.
        if ('ctrl' in a && a.ctrl) copying = true;
        let ended = false;
        if (name === 'STRETCH' && a.kind === 'point' && group) {
          ended = apply(moveBy(sub(a.point, base)), 'moved');
        } else if (name === 'STRETCH' && a.kind === 'point') {
          const to = add(hot, sub(a.point, base));
          if (copying) {
            const copies = copyStretched(ctx, ids, hot, to);
            made.push(copies);
            await regenerateDimensions(
              ctx,
              copies.filter((id) => 'dimType' in ctx.model.entity(id)!.geom),
            );
            await recountColumns(ctx, copies);
          } else {
            let r: ReturnType<typeof gripObjects> | undefined;
            ctx.edit((b) => {
              r = gripObjects(b, ctx.model, ids, hot, to);
            });
            say(refusalMessages(r!.refused, 'stretched'));
            // A dimension's grip reshapes it: the dimension engine draws it afresh (M2-11).
            await regenerateDimensions(ctx, r!.regenerate ?? []);
            // A column grip: dynamic columns take what the text needs (M2-26 part 2).
            await recountColumns(ctx, r!.ids);
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
