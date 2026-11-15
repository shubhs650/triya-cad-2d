// FILLET and CHAMFER (M3-02 part 3), with AutoCAD 2024's prompts and options (AutoCAD 2024 Help,
// "FILLET (Command)", "CHAMFER (Command)", FILLETRAD, TRIMMODE, CHAMFERA–D, CHAMMODE):
//
//   Current settings: Mode = TRIM, Radius = 0.0000
//   Select first object or [Undo/Polyline/Radius/Trim/Multiple]:
//   Select second object or shift-select to apply corner or [Radius]:
//
//   (TRIM mode) Current chamfer Dist1 = 0.0000, Dist2 = 0.0000
//   Select first line or [Undo/Polyline/Distance/Angle/Trim/mEthod/Multiple]:
//   Select second line or shift-select to apply corner or [Distance/Angle/Method]:
//
// The radius and the chamfer distances, length and angle are the drawing's FILLETRAD and
// CHAMFERA–D (header variables, saved with it); the Trim mode (TRIMMODE) is shared by FILLET and
// CHAMFER and the chamfer method (CHAMMODE) is CHAMFER's, both variables the app keeps (M3-12,
// `option-variables.ts`): each command starts from them and sets them when its option changes. Shift with the second pick makes a sharp corner
// (radius or distances 0). Multiple repeats until Enter; Undo takes back the last fillet
// (chamfer) of the command. Polyline does every vertex of a 2D polyline. The geometry is
// `edit/corner.ts`'s.
//
// Messages AutoCAD's help does not word are worded here after its other messages ("Radius is
// too large", "Lines are parallel"); the PR notes the ambiguity.
import { normalizeAngle } from '../../geom/angle';
import type { Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { reshapeObject, revertChanges } from '../../edit/edit';
import {
  chamferCorner,
  cornerEdit,
  filletCorner,
  isPolyline2d,
  legOf,
  parallelFillet,
  polylineCorners,
  samePolylineCorner,
  type ChamferSize,
  type Corner,
  type CornerProblem,
  type Leg,
} from '../../edit/corner';
import { trimCurveOf } from '../../edit/trim';
import type { ChangeSet } from '../../model/changeset';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { Entity } from '../../model/types';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatAngle, formatDistance } from '../units';
import { toleranceFor } from './offset';
import { optionVariable, setOptionVariable } from './option-variables';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/**
 * FILLET's and CHAMFER's settings for one open drawing: TRIMMODE and CHAMMODE, and the values
 * of FILLETRAD and CHAMFERA–D for a drawing whose header has none.
 */
export interface CornerSettings {
  trim: boolean;
  /** CHAMMODE 1: a length and an angle. */
  angleMethod: boolean;
  radius: number;
  dist1: number;
  dist2: number;
  length: number;
  angle: number;
}

export const cornerSettings = (): CornerSettings => ({
  trim: true,
  angleMethod: false,
  radius: 0,
  dist1: 0,
  dist2: 0,
  length: 0,
  angle: 0,
});

type Saved = 'radius' | 'dist1' | 'dist2' | 'length' | 'angle';

const HEADER: Record<Saved, string> = {
  radius: '$FILLETRAD',
  dist1: '$CHAMFERA',
  dist2: '$CHAMFERB',
  length: '$CHAMFERC',
  angle: '$CHAMFERD',
};

/** A saved setting: the drawing's header variable, else the session's value. */
function read(ctx: CommandContext, s: CornerSettings, k: Saved): number {
  const v = ctx.model.header.get(HEADER[k]);
  return typeof v === 'number' && Number.isFinite(v) ? v : s[k];
}

/** Sets a saved setting, in the drawing's header when it has the variable. */
function write(ctx: CommandContext, s: CornerSettings, k: Saved, v: number): void {
  s[k] = v;
  if (ctx.model.header.has(HEADER[k]) && ctx.model.header.get(HEADER[k]) !== v) {
    ctx.edit((b) => b.setHeader(HEADER[k], v));
  }
}

const keywordOf = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

const locked = (model: DocumentModel, id: EntityId): boolean =>
  model.tables.layers.get(model.entity(id)?.layer ?? '')?.locked === true;

/** The words that differ between FILLET and CHAMFER. */
interface Words {
  readonly name: 'FILLET' | 'CHAMFER';
  readonly verb: 'fillet' | 'chamfer';
  readonly first: string;
  readonly second: string;
  readonly firstOptions: readonly string[];
  readonly secondOptions: readonly string[];
  readonly polylineOptions: readonly string[];
  readonly tooLarge: string;
}

const FILLET_WORDS: Words = {
  name: 'FILLET',
  verb: 'fillet',
  first: 'Select first object or',
  second: 'Select second object or shift-select to apply corner or',
  firstOptions: ['Undo', 'Polyline', 'Radius', 'Trim', 'Multiple'],
  secondOptions: ['Radius'],
  polylineOptions: ['Radius'],
  tooLarge: 'Radius is too large.',
};

const CHAMFER_WORDS: Words = {
  name: 'CHAMFER',
  verb: 'chamfer',
  first: 'Select first line or',
  second: 'Select second line or shift-select to apply corner or',
  firstOptions: ['Undo', 'Polyline', 'Distance', 'Angle', 'Trim', 'mEthod', 'Multiple'],
  secondOptions: ['Distance', 'Angle', 'Method'],
  polylineOptions: ['Distance', 'Angle', 'Method'],
  tooLarge: 'Distance is too large.',
};

export const filletCommand = (s: CornerSettings): CommandDef => cornerCommand(s, FILLET_WORDS);
export const chamferCommand = (s: CornerSettings): CommandDef => cornerCommand(s, CHAMFER_WORDS);

/** An object picked: its id and leg. */
interface Picked {
  readonly id: EntityId;
  readonly leg: Leg;
}

function cornerCommand(s: CornerSettings, w: Words): CommandDef {
  const fillet = w.name === 'FILLET';

  const settingsLine = (ctx: CommandContext): string => {
    const u = drawingUnits(ctx.model.header);
    const d = (k: Saved) => formatDistance(read(ctx, s, k), u);
    if (fillet)
      return `Current settings: Mode = ${s.trim ? 'TRIM' : 'NOTRIM'}, Radius = ${d('radius')}`;
    const mode = `(${s.trim ? 'TRIM' : 'NOTRIM'} mode)`;
    return s.angleMethod
      ? `${mode} Current chamfer Length = ${d('length')}, Angle = ${formatAngle(read(ctx, s, 'angle'), u)}`
      : `${mode} Current chamfer Dist1 = ${d('dist1')}, Dist2 = ${d('dist2')}`;
  };

  /** CHAMFER's method chosen: CHAMMODE. */
  async function setAngleMethod(ctx: CommandContext, angle: boolean): Promise<void> {
    s.angleMethod = angle;
    await setOptionVariable(ctx, 'CHAMMODE', angle ? 1 : 0);
  }

  /** A non-negative distance for `k`, asked with `message`; false when the command ends. */
  async function* distanceFor(
    ctx: CommandContext,
    k: Saved,
    message: string,
    fallback?: number,
  ): Sub<boolean> {
    for (;;) {
      const a = yield ctx.prompt.distance({
        message,
        default: { kind: 'distance', value: fallback ?? read(ctx, s, k) },
      });
      if (a.kind !== 'distance' && a.kind !== 'number') return false;
      if (!(a.value >= 0)) {
        ctx.message('Value must be positive or zero.');
        continue;
      }
      write(ctx, s, k, a.value);
      return true;
    }
  }

  /** The Radius, Distance, Angle, Method and Trim options: false when the command ends. */
  async function* option(ctx: CommandContext, keyword: string): Sub<boolean> {
    switch (keyword) {
      case 'Radius':
        return yield* distanceFor(ctx, 'radius', 'Specify fillet radius');
      case 'Distance': {
        if (!(yield* distanceFor(ctx, 'dist1', 'Specify first chamfer distance'))) return false;
        if (
          !(yield* distanceFor(
            ctx,
            'dist2',
            'Specify second chamfer distance',
            read(ctx, s, 'dist1'),
          ))
        )
          return false;
        await setAngleMethod(ctx, false);
        return true;
      }
      case 'Angle': {
        if (!(yield* distanceFor(ctx, 'length', 'Specify chamfer length on the first line')))
          return false;
        for (;;) {
          const a = yield ctx.prompt.angle({
            message: 'Specify chamfer angle from the first line',
            default: { kind: 'angle', value: read(ctx, s, 'angle') },
          });
          if (a.kind !== 'angle') return false;
          // A turn from the first line, 0 to 360.
          write(ctx, s, 'angle', normalizeAngle(a.value));
          break;
        }
        await setAngleMethod(ctx, true);
        return true;
      }
      case 'Method':
      case 'mEthod': {
        const m = yield ctx.prompt.keyword({
          message: 'Enter trim method',
          options: ['Distance', 'Angle'],
          default: { kind: 'keyword', keyword: s.angleMethod ? 'Angle' : 'Distance' },
        });
        if (m.kind !== 'keyword') return false;
        await setAngleMethod(ctx, m.keyword === 'Angle');
        return true;
      }
      case 'Trim': {
        const t = yield ctx.prompt.keyword({
          message: 'Enter Trim mode option',
          options: ['Trim', 'No trim'],
          default: { kind: 'keyword', keyword: s.trim ? 'Trim' : 'No trim' },
        });
        if (t.kind !== 'keyword') return false;
        s.trim = keywordOf(t) === 'Trim';
        await setOptionVariable(ctx, 'TRIMMODE', s.trim ? 1 : 0);
        return true;
      }
    }
    return true;
  }

  /** What is under a pick: the object a fillet (chamfer) can take, else any object. */
  async function pickAt(ctx: CommandContext, p: Vec2): Promise<EntityId | undefined> {
    const r = await ctx.view.request({ op: 'pick', point: p });
    const hits = (r.ok ? (r.ids ?? []) : []).filter(
      (id) => ctx.model.entity(id)?.owner === ctx.space,
    );
    return hits.find((h) => legOfId(ctx, h, p)) ?? hits[0];
  }

  function legOfId(ctx: CommandContext, id: EntityId, p: Vec2): Leg | undefined {
    const e = ctx.model.entity(id);
    return e && legOf(e.geom, p, tolOf(ctx, [e]));
  }

  /** The object picked at `p` as a leg, or undefined (with AutoCAD's message). */
  async function picked(ctx: CommandContext, p: Vec2): Promise<Picked | undefined> {
    const id = await pickAt(ctx, p);
    if (id === undefined) return undefined;
    const leg = legOfId(ctx, id, p);
    if (!leg || (!fillet && leg.carrier.kind !== 'line' && !isPolyline2d(leg.g))) {
      ctx.message(fillet ? 'Cannot fillet that object.' : 'Cannot chamfer that object.');
      return undefined;
    }
    if (locked(ctx.model, id)) {
      ctx.message('The object is on a locked layer.');
      return undefined;
    }
    return { id, leg };
  }

  const size = (ctx: CommandContext, sharp: boolean): ChamferSize =>
    sharp
      ? { method: 'distance', d1: 0, d2: 0 }
      : s.angleMethod
        ? { method: 'angle', length: read(ctx, s, 'length'), angle: read(ctx, s, 'angle') }
        : { method: 'distance', d1: read(ctx, s, 'dist1'), d2: read(ctx, s, 'dist2') };

  /**
   * The fillet (chamfer) of two picked objects: its edit, null when it is made with no change
   * (lines already meeting, radius 0), or undefined when it cannot be (with a message).
   */
  function corner(
    ctx: CommandContext,
    a: Picked,
    b: Picked,
    sharp: boolean,
  ): ChangeSet | null | undefined {
    const model = ctx.model;
    const ea = model.entity(a.id)!;
    const eb = model.entity(b.id)!;
    const tol = tolOf(ctx, [ea, eb]);
    const samePolyline = a.id === b.id && isPolyline2d(ea.geom);
    if (a.id === b.id && (!samePolyline || a.leg.segment === b.leg.segment)) {
      ctx.message(`Cannot ${w.verb} an object to itself.`);
      return undefined;
    }
    if (!fillet && (a.leg.carrier.kind !== 'line' || b.leg.carrier.kind !== 'line')) {
      ctx.message('Cannot chamfer arc segments.');
      return undefined;
    }
    let c: Corner | CornerProblem | 'not-lines';
    if (fillet) {
      c = filletCorner(a.leg, b.leg, sharp ? 0 : read(ctx, s, 'radius'), tol);
      if (c === 'parallel' && !sharp) c = parallelFillet(a.leg, b.leg, tol);
    } else c = chamferCorner(a.leg, b.leg, size(ctx, sharp), tol);
    if (typeof c === 'string') {
      ctx.message(problemMessage(c));
      return undefined;
    }
    const made = c;
    if (samePolyline) {
      if (!s.trim) {
        if (!made.piece) return null;
        return ctx.edit((bd) => {
          bd.addEntity({ owner: ctx.space, ...pieceProps(model, ea, eb), geom: made.piece!.geom });
        });
      }
      const g = samePolylineCorner(a.leg, b.leg, made, tol);
      if (typeof g === 'string') {
        ctx.message(problemMessage(g));
        return undefined;
      }
      return ctx.edit((bd) => reshapeObject(bd, model, a.id, [g]));
    }
    const edit = cornerEdit(a.leg, b.leg, made, s.trim, tol);
    if (typeof edit === 'string') {
      ctx.message(problemMessage(edit));
      return undefined;
    }
    if (edit.first === undefined && edit.second === undefined && !edit.added) return null;
    const props = pieceProps(model, ea, eb);
    return ctx.edit((bd) => {
      if (edit.first !== undefined) reshapeObject(bd, model, a.id, edit.first ? [edit.first] : []);
      if (edit.second !== undefined)
        reshapeObject(bd, model, b.id, edit.second ? [edit.second] : []);
      if (edit.added) bd.addEntity({ owner: ctx.space, ...props, geom: edit.added });
    });
  }

  function problemMessage(p: CornerProblem | 'not-lines' | 'polyline-segment'): string {
    switch (p) {
      case 'parallel':
        return 'Lines are parallel.';
      case 'too-large':
        return w.tooLarge;
      case 'no-fillet':
        return fillet ? 'No fillet with this radius is possible.' : 'Lines do not meet.';
      case 'not-lines':
        return fillet
          ? 'Cannot fillet parallel objects other than lines.'
          : 'Cannot chamfer arc segments.';
      case 'polyline-segment':
        return `Cannot ${w.verb} that polyline segment.`;
    }
  }

  /** The Polyline option on the polyline picked at `p`: its edit, or undefined. */
  function polylineOption(ctx: CommandContext, id: EntityId): ChangeSet | undefined {
    const e = ctx.model.entity(id)!;
    const tol = tolOf(ctx, [e]);
    const r = polylineCorners(
      e.geom,
      fillet ? { fillet: read(ctx, s, 'radius') } : { chamfer: size(ctx, false) },
      tol,
    );
    if (!r) {
      ctx.message('Object selected is not a 2D polyline.');
      return undefined;
    }
    const lines = (n: number) => `${n} ${n === 1 ? 'line was' : 'lines were'}`;
    ctx.message(`${lines(r.done)} ${fillet ? 'filleted' : 'chamfered'}`);
    if (r.tooShort > 0) ctx.message(`${r.tooShort} ${r.tooShort === 1 ? 'was' : 'were'} too short`);
    if (r.done === 0) return undefined;
    return ctx.edit((b) => reshapeObject(b, ctx.model, id, [r.geom]));
  }

  return {
    name: w.name,
    usesSelection: 'during',
    async *run(ctx) {
      s.trim = (await optionVariable(ctx, 'TRIMMODE', s.trim ? 1 : 0)) === 1;
      s.angleMethod = (await optionVariable(ctx, 'CHAMMODE', s.angleMethod ? 1 : 0)) === 1;
      ctx.message(settingsLine(ctx));
      let multiple = false;
      /** Each fillet (chamfer) made, for Undo. */
      const history: ChangeSet[] = [];
      for (;;) {
        const a = yield ctx.prompt.point({
          message: w.first,
          options: w.firstOptions,
          pickbox: true,
        });
        if (a.kind === 'keyword') {
          switch (a.keyword) {
            case 'Undo': {
              const last = history.pop();
              if (!last) ctx.message('Nothing to undo.');
              else ctx.edit((b) => revertChanges(b, last));
              continue;
            }
            case 'Multiple':
              multiple = true;
              continue;
            case 'Polyline': {
              const done = yield* polyline(ctx);
              if (done === 'end') return;
              if (done) history.push(done);
              if (done && !multiple) return;
              continue;
            }
            default:
              if (!(yield* option(ctx, a.keyword))) return;
              continue;
          }
        }
        if (a.kind !== 'point') return;
        const first = await picked(ctx, a.point);
        if (!first) continue;
        for (;;) {
          const b = yield ctx.prompt.point({
            message: w.second,
            options: w.secondOptions,
            pickbox: true,
          });
          if (b.kind === 'keyword') {
            if (!(yield* option(ctx, b.keyword))) return;
            continue;
          }
          if (b.kind !== 'point') return;
          const second = await picked(ctx, b.point);
          if (!second) continue;
          const cs = corner(ctx, first, second, b.shift === true);
          if (cs) history.push(cs);
          if (cs !== undefined && !multiple) return;
          break;
        }
      }
    },
  };

  /** "Select 2D polyline": the edit made, undefined for none, 'end' when the command ends. */
  async function* polyline(ctx: CommandContext): Sub<ChangeSet | undefined | 'end'> {
    for (;;) {
      const p = yield ctx.prompt.point({
        message: 'Select 2D polyline or',
        options: w.polylineOptions,
        pickbox: true,
      });
      if (p.kind === 'keyword') {
        if (!(yield* option(ctx, p.keyword))) return 'end';
        continue;
      }
      if (p.kind !== 'point') return 'end';
      const id = await pickAt(ctx, p.point);
      if (id === undefined) continue;
      if (locked(ctx.model, id)) {
        ctx.message('The object is on a locked layer.');
        continue;
      }
      return polylineOption(ctx, id);
    }
  }
}

/** The tolerance a fillet (chamfer) of these objects works to. */
function tolOf(ctx: CommandContext, es: readonly Entity[]): Tolerance {
  let best: Tolerance | undefined;
  for (const e of es) {
    const c = trimCurveOf(e.geom);
    if (!c) continue;
    const t = toleranceFor(ctx.model, c);
    if (!best || t.linear > best.linear) best = t;
  }
  return (
    best ?? toleranceFor(ctx.model, { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })
  );
}

/**
 * The fillet arc's (chamfer line's) properties: the layer of the objects when they share one,
 * else the current layer (AutoCAD 2024 Help, "About Filleting"); each other property the
 * objects share, else the current one.
 */
function pieceProps(model: DocumentModel, a: Entity, b: Entity) {
  const cur = currentProps(model);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  return {
    layer: a.layer === b.layer ? a.layer : cur.layer,
    color: same(a.color, b.color) ? a.color : cur.color,
    linetype: same(a.linetype, b.linetype) ? a.linetype : cur.linetype,
    lineweight: same(a.lineweight, b.lineweight) ? a.lineweight : cur.lineweight,
    transparency: same(a.transparency, b.transparency) ? a.transparency : cur.transparency,
    ltScale: a.ltScale === b.ltScale ? a.ltScale : cur.ltScale,
  };
}
