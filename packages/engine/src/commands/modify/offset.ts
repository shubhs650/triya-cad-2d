// OFFSET (M3-02 part 1), with AutoCAD 2024's prompts and options (AutoCAD 2024 Help, "OFFSET
// (Command)", OFFSETDIST, OFFSETERASE, OFFSETGAPTYPE):
//
//   Current settings: Erase source=No  Layer=Source  OFFSETGAPTYPE=0
//   Specify offset distance or [Through/Erase/Layer] <Through>:
//   Select object to offset or [Exit/Undo] <Exit>:
//   Specify point on side to offset or [Exit/Multiple/Undo] <Exit>:
//   (Through:) Specify through point or [Exit/Multiple/Undo] <Exit>:
//
// The distance (or Through) is remembered for the drawing's next OFFSET, as AutoCAD's OFFSETDIST
// (−1 Through, its initial value) is; Erase and Layer are remembered likewise (OFFSETERASE and the
// Layer option). Multiple offsets the object made last again at the same distance, one object
// further out each pick, until Enter goes back to "Select object to offset"; in Through mode each
// point offsets the selected object through it. Undo takes back the last offset (and puts back a
// source Erase took). The objects are made by `edit/offset.ts`: lines, arcs, circles, rays and
// xlines as themselves, polylines as polylines with their loops cut out, ellipses and splines as
// splines. They keep the source's properties and xdata (Layer Current: on the current layer).
//
// Left for later (roadmap M3-02): OFFSETGAPTYPE 1 and 2 (filleted and chamfered gaps; 0, the
// default, extends the segments), the SETVAR variables OFFSETDIST, OFFSETERASE and OFFSETGAPTYPE,
// and the preview of the offset that follows the cursor.
import { boxOf } from '../../geom/bounds';
import type { Curve } from '../../geom/curves';
import { flatten } from '../../geom/flatten';
import { toleranceForSize, type Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { copiedProps, eraseObjects } from '../../edit/edit';
import { offsetCurveOf, offsetGeometry, offsetSide } from '../../edit/offset';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { Entity } from '../../model/types';
import { currentLayer } from '../../properties/current';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** One offset made, for Undo: the objects it made and the source it erased. */
interface Made {
  readonly ids: readonly EntityId[];
  readonly erased?: Entity;
  /** The object Multiple offsets next, before this offset. */
  readonly source: EntityId;
}

const isPoint = (v: unknown): v is Vec2 =>
  typeof v === 'object' && v !== null && 'x' in v && 'y' in v;

/**
 * The tolerance an offset works to: the drawing's, from its extents (DEC-036), or the curve's own
 * size where the curve lies beyond them.
 */
function toleranceFor(model: DocumentModel, c: Curve): Tolerance {
  const min = model.header.get('$EXTMIN');
  const max = model.header.get('$EXTMAX');
  const pts: Vec2[] =
    c.kind === 'XLINE' || c.kind === 'RAY' ? [c.base] : flatten(c, Infinity).points;
  if (isPoint(min) && isPoint(max) && min.x <= max.x && min.y <= max.y) pts.push(min, max);
  const b = boxOf(pts);
  return toleranceForSize(
    Math.max(
      Math.abs(b.minX),
      Math.abs(b.minY),
      Math.abs(b.maxX),
      Math.abs(b.maxY),
      b.maxX - b.minX,
      b.maxY - b.minY,
    ),
  );
}

export function offsetCommand(): CommandDef {
  // OFFSETDIST (< 0 Through, AutoCAD's initial −1), OFFSETERASE and the Layer option.
  let dist = -1;
  let erase = false;
  let currentLayerOption = false;

  /** "Specify offset distance or [Through/Erase/Layer]": false when the command ends. */
  async function* distance(ctx: CommandContext): Sub<boolean> {
    for (;;) {
      const a = yield ctx.prompt.distance({
        message: 'Specify offset distance or',
        options: ['Through', 'Erase', 'Layer'],
        default:
          dist < 0 ? { kind: 'keyword', keyword: 'Through' } : { kind: 'distance', value: dist },
      });
      if (a.kind === 'keyword' && a.keyword === 'Through') {
        dist = -1;
        return true;
      }
      if (a.kind === 'keyword' && a.keyword === 'Erase') {
        const e = yield ctx.prompt.keyword({
          message: 'Erase source object after offsetting?',
          options: ['Yes', 'No'],
          default: { kind: 'keyword', keyword: erase ? 'Yes' : 'No' },
        });
        if (e.kind !== 'keyword') return false;
        erase = e.keyword === 'Yes';
        continue;
      }
      if (a.kind === 'keyword' && a.keyword === 'Layer') {
        const l = yield ctx.prompt.keyword({
          message: 'Enter layer option for offset objects',
          options: ['Current', 'Source'],
          default: { kind: 'keyword', keyword: currentLayerOption ? 'Current' : 'Source' },
        });
        if (l.kind !== 'keyword') return false;
        currentLayerOption = l.keyword === 'Current';
        continue;
      }
      if (a.kind !== 'distance' && a.kind !== 'number') return false;
      if (!(a.value > 0)) {
        ctx.message('Value must be positive and nonzero.');
        continue;
      }
      dist = a.value;
      return true;
    }
  }

  /**
   * Offsets `source` by `d` to the side of `side`, erasing it when Erase says so and it is the
   * object picked: the record for Undo, or undefined when nothing could be made.
   */
  function offsetOnce(
    ctx: CommandContext,
    source: EntityId,
    picked: EntityId,
    through: Vec2,
    d: number | undefined,
    eraseNow: boolean,
  ): Made | undefined {
    const e = ctx.model.entity(source);
    const c = e && offsetCurveOf(e.geom);
    if (!e || !c) return undefined;
    const tol = toleranceFor(ctx.model, c);
    const where = offsetSide(c, through, tol);
    if (where.side === 0) return undefined;
    const signed = (d ?? where.distance) * where.side;
    const geoms = offsetGeometry(e.geom, signed, tol);
    if (geoms.length === 0) {
      ctx.message('Cannot offset that object.');
      return undefined;
    }
    const ids: EntityId[] = [];
    let erased: Entity | undefined;
    ctx.edit((b) => {
      const props = copiedProps(b, e);
      if (currentLayerOption) props.layer = currentLayer(ctx.model);
      for (const geom of geoms) ids.push(b.addEntity({ owner: e.owner, ...props, geom }).id);
      const src = b.entity(picked);
      if (eraseNow && src) {
        erased = src;
        eraseObjects(b, ctx.model, [picked]);
      }
    });
    return { ids, source, ...(erased && { erased }) };
  }

  /** Erases `picked` as Erase source says, after a Through Multiple run that kept it: for Undo. */
  function eraseAfter(ctx: CommandContext, picked: EntityId): Made | undefined {
    const e = ctx.model.entity(picked);
    if (!e) return undefined;
    ctx.edit((b) => eraseObjects(b, ctx.model, [picked]));
    return { ids: [], erased: e, source: picked };
  }

  return {
    name: 'OFFSET',
    usesSelection: 'during',
    async *run(ctx) {
      ctx.message(
        `Current settings: Erase source=${erase ? 'Yes' : 'No'}  Layer=${
          currentLayerOption ? 'Current' : 'Source'
        }  OFFSETGAPTYPE=0`,
      );
      if (!(yield* distance(ctx))) return;
      const through = dist < 0;
      const made: Made[] = [];
      const undo = (): EntityId | undefined => {
        const last = made.pop();
        if (!last) {
          ctx.message('Nothing to undo.');
          return undefined;
        }
        ctx.edit((b) => {
          for (const id of last.ids) b.removeEntity(id);
          if (last.erased) b.restoreEntity(last.erased);
        });
        return last.source;
      };
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select object to offset or',
          options: ['Exit', 'Undo'],
          defaultLabel: 'Exit',
          single: true,
          editable: true,
        });
        if (a.kind === 'keyword' && a.keyword === 'Undo') {
          undo();
          continue;
        }
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        const picked = a.ids[0]!;
        const e = ctx.model.entity(picked);
        if (!e || !offsetCurveOf(e.geom)) {
          ctx.message('Cannot offset that object.');
          continue;
        }
        let multiple = false;
        // Multiple at a distance offsets what it made last; Through offsets the object picked,
        // which Erase takes once the run ends.
        let source = picked;
        let throughRun = 0;
        const endRun = (): void => {
          if (!erase || throughRun === 0) return;
          const m = eraseAfter(ctx, picked);
          if (m) made.push(m);
        };
        for (;;) {
          const p = yield ctx.prompt.point({
            message: through ? 'Specify through point or' : 'Specify point on side to offset or',
            options: multiple ? ['Exit', 'Undo'] : ['Exit', 'Multiple', 'Undo'],
            defaultLabel: multiple ? 'next object' : 'Exit',
          });
          if (p.kind === 'keyword' && p.keyword === 'Exit') {
            endRun();
            return;
          }
          if (p.kind === 'keyword' && p.keyword === 'Multiple') {
            multiple = true;
            continue;
          }
          if (p.kind === 'keyword' && p.keyword === 'Undo') {
            const back = undo();
            if (back !== undefined && !through && multiple) source = back;
            if (back !== undefined && through && multiple) throughRun = Math.max(0, throughRun - 1);
            if (!multiple) break;
            continue;
          }
          if (p.kind === 'enter' && multiple) {
            endRun();
            break;
          }
          if (p.kind !== 'point') {
            endRun();
            return;
          }
          const keepSource = through && multiple;
          const m = offsetOnce(
            ctx,
            ctx.model.entity(source) ? source : picked,
            picked,
            p.point,
            through ? undefined : dist,
            erase && !keepSource,
          );
          if (m) {
            made.push(m);
            if (keepSource) throughRun++;
            if (!through && m.ids.length > 0) source = m.ids[0]!;
          }
          if (!multiple) break;
        }
      }
    },
  };
}
