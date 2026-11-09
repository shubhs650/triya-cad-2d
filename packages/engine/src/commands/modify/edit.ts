// The core edit commands (M2-06): ERASE, MOVE, COPY, ROTATE, SCALE and MIRROR, with AutoCAD
// 2024's prompts and options (AutoCAD 2024 Help: ERASE, MOVE, COPY, ROTATE, SCALE and MIRROR
// (Command), MIRRTEXT, MIRRHATCH, COPYMODE). The geometry is `edit/`'s; these are the dialogues.
//
// While a second point, angle or scale is asked for, the objects are dragged with the cursor
// (`drag` on the prompt, part 2), as AutoCAD drags them (DRAGMODE Auto). STRETCH (part 2) takes
// the last crossing window of its selection.
import { angleOf, distance, sub } from '../../geom/vec';
import type { Vec2 } from '../../geom/types';
import type { EntityId } from '../../model/entity-ids';
import type { DocumentModel } from '../../model/document';
import {
  copyObjects,
  eraseObjects,
  planStretch,
  stretchObjects,
  type StretchWindow,
  refusalMessages,
  transformObjects,
  type EditReport,
} from '../../edit/edit';
import { mirrorIn, moveBy, scaleAbout, turnAbout, type Similarity } from '../../edit/similarity';
import type { TransformOptions } from '../../edit/transform';
import { formatNumber, type Prompt, type PromptAnswer, type SelectionWindow } from '../prompt';
import type { Box } from '../../geom/bounds';
import type { CommandContext, CommandDef } from '../command';
import { regenerateDimensions } from './dimensions';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** "Select objects" for an edit: objects on locked layers are refused. */
async function* selectObjects(ctx: CommandContext): Sub<readonly EntityId[]> {
  const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
  return a.kind === 'selection' ? a.ids : [];
}

/** MIRRTEXT and MIRRHATCH, each 0 unless the drawing says 1 (AutoCAD's defaults). */
function mirrorOptions(model: DocumentModel): TransformOptions {
  const on = (name: string) => {
    const v = model.header.get(name);
    return v === 1 || v === true;
  };
  return { mirrorText: on('$MIRRTEXT'), mirrorHatch: on('$MIRRHATCH') };
}

/** Applies an edit and says on the command line what it left out. */
function run(
  ctx: CommandContext,
  verb: string,
  edit: (b: Parameters<Parameters<CommandContext['edit']>[0]>[0]) => EditReport,
): EditReport {
  let report: EditReport | undefined;
  ctx.edit((b) => {
    report = edit(b);
  });
  for (const line of refusalMessages(report!.refused, verb)) ctx.message(line);
  if (report!.unannotated > 0) {
    const n = report!.unannotated;
    ctx.message(
      `${n} ${n === 1 ? 'copy is' : 'copies are'} not annotative (annotative copies are not saved yet).`,
    );
  }
  return report!;
}

const transform = (ctx: CommandContext, ids: readonly EntityId[], t: Similarity, verb: string) =>
  run(ctx, verb, (b) => transformObjects(b, ctx.model, ids, t, mirrorOptions(ctx.model)));

const copy = (ctx: CommandContext, ids: readonly EntityId[], t: Similarity, verb: string) =>
  run(ctx, verb, (b) => copyObjects(b, ctx.model, ids, t, mirrorOptions(ctx.model)));

const point = (a: PromptAnswer): Vec2 | undefined => (a.kind === 'point' ? a.point : undefined);

// ── ERASE ───────────────────────────────────────────────────────────────────────────────────

export function eraseCommand(): CommandDef {
  return {
    name: 'ERASE',
    erases: true,
    usesSelection: 'during',
    async *run(ctx) {
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      run(ctx, 'erased', (b) => eraseObjects(b, ctx.model, ids));
    },
  };
}

// ── MOVE and COPY ───────────────────────────────────────────────────────────────────────────

/**
 * "Specify displacement <0.0000,0.0000,0.0000>:" — the vector itself, the last one by default.
 * Undefined when cancelled by another answer.
 */
async function* displacement(ctx: CommandContext, last: Vec2): Sub<Vec2 | undefined> {
  const a = yield ctx.prompt.point({
    message: 'Specify displacement',
    default: { kind: 'point', point: last },
  });
  return point(a);
}

/**
 * MOVE: base point then second point, or a displacement (the Displacement option, Enter at the
 * base point, or Enter at the second point taking the base point as the vector).
 */
export function moveCommand(): CommandDef {
  let last: Vec2 = { x: 0, y: 0 };
  return {
    name: 'MOVE',
    usesSelection: 'during',
    async *run(ctx) {
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      const a = yield ctx.prompt.point({
        message: 'Specify base point or',
        options: ['Displacement'],
        defaultLabel: 'Displacement',
      });
      let d: Vec2 | undefined;
      if (a.kind === 'point') {
        const base = a.point;
        const b = yield ctx.prompt.point({
          message: 'Specify second point or',
          defaultLabel: 'use first point as displacement',
          rubberBand: { from: base },
          drag: { kind: 'move', ids, from: base },
        });
        if (b.kind === 'enter') d = base;
        else if (b.kind === 'point') d = sub(b.point, base);
      } else if (a.kind === 'enter' || a.kind === 'keyword') {
        d = yield* displacement(ctx, last);
      }
      if (!d) return;
      last = d;
      transform(ctx, ids, moveBy(d), 'moved');
    },
  };
}

/**
 * COPY: copies at each second point (COPYMODE Multiple, AutoCAD's default) until Enter, Exit or
 * Esc; Single makes one. Array copies a row of n items spaced by the second point, or fitted
 * between the base and the second point; Undo takes the last copy (or row) back.
 */
export function copyCommand(): CommandDef {
  let last: Vec2 = { x: 0, y: 0 };
  let multiple = true;
  return {
    name: 'COPY',
    usesSelection: 'during',
    async *run(ctx) {
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      let base: Vec2 | undefined;
      for (;;) {
        ctx.message(`Current settings:  Copy mode = ${multiple ? 'Multiple' : 'Single'}`);
        const a = yield ctx.prompt.point({
          message: 'Specify base point or',
          options: ['Displacement', 'mOde'],
          defaultLabel: 'Displacement',
        });
        if (a.kind === 'keyword' && a.keyword === 'mOde') {
          const m = yield ctx.prompt.keyword({
            message: 'Enter a copy mode option',
            options: ['Single', 'Multiple'],
            default: { kind: 'keyword', keyword: multiple ? 'Multiple' : 'Single' },
          });
          if (m.kind === 'keyword') multiple = m.keyword === 'Multiple';
          continue;
        }
        if (a.kind === 'point') base = a.point;
        else if (a.kind === 'enter' || a.kind === 'keyword') {
          const d = yield* displacement(ctx, last);
          if (!d) return;
          last = d;
          copy(ctx, ids, moveBy(d), 'copied');
          return;
        }
        break;
      }
      if (!base) return;
      const made: (readonly EntityId[])[] = [];
      // Once a copy is made the prompt keeps Exit and Undo, even after Undo takes them all back.
      let first = true;
      for (;;) {
        const a = yield ctx.prompt.point({
          message: 'Specify second point or',
          options: first ? ['Array'] : ['Array', 'Exit', 'Undo'],
          defaultLabel: first ? 'use first point as displacement' : 'Exit',
          rubberBand: { from: base },
          drag: { kind: 'move', ids, from: base },
        });
        if (a.kind === 'keyword' && a.keyword === 'Undo') {
          const ids = made.pop();
          if (ids) ctx.edit((b) => ids.forEach((id) => b.entity(id) && b.removeEntity(id)));
          continue;
        }
        if (a.kind === 'keyword' && a.keyword === 'Array') {
          const row = yield* copyArray(ctx, ids, base);
          if (row) {
            made.push(row);
            first = false;
          }
          if (!multiple && row) return;
          continue;
        }
        if (a.kind === 'enter' && first) {
          last = base;
          copy(ctx, ids, moveBy(base), 'copied');
          return;
        }
        const to = point(a);
        if (!to) return;
        const d = sub(to, base);
        last = d;
        made.push(copy(ctx, ids, moveBy(d), 'copied').ids);
        first = false;
        if (!multiple) return;
      }
    },
  };
}

/** COPY's Array: "Enter number of items to array:", then the spacing or the Fit length. */
async function* copyArray(
  ctx: CommandContext,
  ids: readonly EntityId[],
  base: Vec2,
): Sub<readonly EntityId[] | undefined> {
  let n: number | undefined;
  while (n === undefined) {
    const a = yield ctx.prompt.integer({ message: 'Enter number of items to array' });
    if (a.kind !== 'number') return undefined;
    if (a.value >= 2) n = a.value;
    else ctx.message('Value must be an integer greater than 1.');
  }
  let fit = false;
  let to: Vec2 | undefined;
  while (!to) {
    const a = yield ctx.prompt.point({
      message: fit ? 'Specify second point' : 'Specify second point or',
      ...(fit ? {} : { options: ['Fit'] }),
      rubberBand: { from: base },
    });
    if (a.kind === 'keyword' && a.keyword === 'Fit') fit = true;
    else if (a.kind === 'point') to = a.point;
    else return undefined;
  }
  const step = sub(to, base);
  const k = fit ? 1 / (n - 1) : 1;
  const out: EntityId[] = [];
  let report: EditReport | undefined;
  ctx.edit((b) => {
    for (let i = 1; i < n; i++) {
      report = copyObjects(
        b,
        ctx.model,
        ids,
        moveBy({ x: step.x * k * i, y: step.y * k * i }),
        mirrorOptions(ctx.model),
      );
      out.push(...report.ids);
    }
  });
  if (report) for (const line of refusalMessages(report.refused, 'copied')) ctx.message(line);
  return out;
}

// ── ROTATE and SCALE ────────────────────────────────────────────────────────────────────────

/** The angle from one point to another (ROTATE Reference's Points, ALIGN-style). */
async function* twoPointAngle(ctx: CommandContext): Sub<number | undefined> {
  const a = yield ctx.prompt.point({ message: 'Specify first point' });
  if (a.kind !== 'point') return undefined;
  const b = yield ctx.prompt.point({
    message: 'Specify second point',
    rubberBand: { from: a.point },
  });
  return b.kind === 'point' ? angleOf(sub(b.point, a.point)) : undefined;
}

/** ROTATE: about a base point by an angle, or from a reference angle to a new one; Copy keeps the originals. */
export function rotateCommand(): CommandDef {
  let last = 0;
  return {
    name: 'ROTATE',
    usesSelection: 'during',
    async *run(ctx) {
      const dir = ctx.model.header.get('$ANGDIR');
      const angbase = ctx.model.header.get('$ANGBASE');
      const degrees = typeof angbase === 'number' ? (angbase * 180) / Math.PI : 0;
      ctx.message(
        `Current positive angle in UCS:  ANGDIR=${dir === 1 || dir === true ? 'clockwise' : 'counterclockwise'}  ANGBASE=${formatNumber(degrees, Number.isInteger(degrees) ? 0 : 4)}`,
      );
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      const b = yield ctx.prompt.point({ message: 'Specify base point' });
      if (b.kind !== 'point') return;
      const base = b.point;
      let copying = false;
      for (;;) {
        const a = yield ctx.prompt.angle({
          message: 'Specify rotation angle or',
          options: ['Copy', 'Reference'],
          default: { kind: 'angle', value: last },
          base,
          drag: { kind: 'rotate', ids, base, reference: 0 },
        });
        if (a.kind === 'keyword' && a.keyword === 'Copy') {
          copying = !copying;
          ctx.message(
            copying ? 'Rotating a copy of the selected objects.' : 'Rotating the selected objects.',
          );
          continue;
        }
        let angle: number | undefined;
        if (a.kind === 'angle') angle = a.value;
        else if (a.kind === 'keyword' && a.keyword === 'Reference') {
          const r = yield ctx.prompt.angle({
            message: 'Specify the reference angle',
            default: { kind: 'angle', value: 0 },
          });
          if (r.kind !== 'angle') return;
          let to: number | undefined;
          for (;;) {
            const n = yield ctx.prompt.angle({
              message: 'Specify the new angle or',
              options: ['Points'],
              default: { kind: 'angle', value: 0 },
              base,
              drag: { kind: 'rotate', ids, base, reference: r.value },
            });
            if (n.kind === 'keyword') {
              to = yield* twoPointAngle(ctx);
              if (to === undefined) return;
            } else if (n.kind === 'angle') to = n.value;
            else return;
            break;
          }
          angle = to - r.value;
        }
        if (angle === undefined) return;
        last = angle;
        const t = turnAbout(base, angle);
        if (copying) copy(ctx, ids, t, 'copied');
        else transform(ctx, ids, t, 'rotated');
        return;
      }
    },
  };
}

/** "Value must be positive and nonzero." for a scale factor or length that is not. */
const positive = (ctx: CommandContext, v: number): boolean => {
  if (v > 0 && Number.isFinite(v)) return true;
  ctx.message('Value must be positive and nonzero.');
  return false;
};

/** SCALE: about a base point by a factor, or from a reference length to a new one; Copy keeps the originals. */
export function scaleCommand(): CommandDef {
  let last = 1;
  return {
    name: 'SCALE',
    usesSelection: 'during',
    async *run(ctx) {
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      const b = yield ctx.prompt.point({ message: 'Specify base point' });
      if (b.kind !== 'point') return;
      const base = b.point;
      let copying = false;
      for (;;) {
        const a = yield ctx.prompt.distance({
          message: 'Specify scale factor or',
          options: ['Copy', 'Reference'],
          default: { kind: 'distance', value: last },
          base,
          drag: { kind: 'scale', ids, base, reference: 1 },
        });
        if (a.kind === 'keyword' && a.keyword === 'Copy') {
          copying = !copying;
          ctx.message(
            copying ? 'Scaling a copy of the selected objects.' : 'Scaling the selected objects.',
          );
          continue;
        }
        let factor: number | undefined;
        if (a.kind === 'distance') {
          if (!positive(ctx, a.value)) continue;
          factor = a.value;
        } else if (a.kind === 'keyword' && a.keyword === 'Reference') {
          let ref: number | undefined;
          while (ref === undefined) {
            const r = yield ctx.prompt.distance({
              message: 'Specify reference length',
              default: { kind: 'distance', value: 1 },
            });
            if (r.kind !== 'distance') return;
            if (positive(ctx, r.value)) ref = r.value;
          }
          let to: number | undefined;
          while (to === undefined) {
            const n = yield ctx.prompt.distance({
              message: 'Specify new length or',
              options: ['Points'],
              default: { kind: 'distance', value: 1 },
              base,
              drag: { kind: 'scale', ids, base, reference: ref },
            });
            let v: number | undefined;
            if (n.kind === 'keyword') {
              const p = yield ctx.prompt.point({ message: 'Specify first point' });
              if (p.kind !== 'point') return;
              const q = yield ctx.prompt.point({
                message: 'Specify second point',
                rubberBand: { from: p.point },
              });
              if (q.kind !== 'point') return;
              v = distance(p.point, q.point);
            } else if (n.kind === 'distance') v = n.value;
            else return;
            if (positive(ctx, v)) to = v;
          }
          factor = to / ref;
        }
        if (factor === undefined) return;
        last = factor;
        const t = scaleAbout(base, factor);
        const report = copying ? copy(ctx, ids, t, 'copied') : transform(ctx, ids, t, 'scaled');
        // A scaled dimension measures the scaled distance, in its own text height.
        await regenerateDimensions(ctx, report.regenerate ?? []);
        return;
      }
    },
  };
}

// ── MIRROR ──────────────────────────────────────────────────────────────────────────────────

/** MIRROR: a mirror line, then whether the originals stay (copies) or go (mirrored in place). */
export function mirrorCommand(): CommandDef {
  return {
    name: 'MIRROR',
    usesSelection: 'during',
    async *run(ctx) {
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      const a = yield ctx.prompt.point({ message: 'Specify first point of mirror line' });
      if (a.kind !== 'point') return;
      let p2: Vec2 | undefined;
      while (!p2) {
        const b = yield ctx.prompt.point({
          message: 'Specify second point of mirror line',
          rubberBand: { from: a.point },
          drag: { kind: 'mirror', ids, from: a.point },
        });
        if (b.kind !== 'point') return;
        if (b.point.x === a.point.x && b.point.y === a.point.y) {
          ctx.message('Mirror line points must be different.');
        } else p2 = b.point;
      }
      const e = yield ctx.prompt.keyword({
        message: 'Erase source objects?',
        options: ['Yes', 'No'],
        default: { kind: 'keyword', keyword: 'No' },
      });
      if (e.kind !== 'keyword') return;
      const t = mirrorIn(a.point, p2);
      // Erasing the source mirrors the objects themselves, keeping their handles (the drawing
      // AutoCAD leaves is the same; Triya keeps every link and passthrough datum with them).
      if (e.keyword === 'Yes') transform(ctx, ids, t, 'mirrored');
      else copy(ctx, ids, t, 'mirrored');
    },
  };
}

// ── STRETCH ─────────────────────────────────────────────────────────────────────────────────

/** The window corners as a box. */
const boxOf = (w: SelectionWindow): Box => ({
  minX: Math.min(w.a.x, w.b.x),
  minY: Math.min(w.a.y, w.b.y),
  maxX: Math.max(w.a.x, w.b.x),
  maxY: Math.max(w.a.y, w.b.y),
});

/**
 * What the canvas says of STRETCH's window: what lies wholly inside it and what it crosses.
 * Without a canvas (scripts) neither is known and points decide alone.
 */
async function stretchWindow(ctx: CommandContext, w: SelectionWindow): Promise<StretchWindow> {
  const ask = async (crossing: boolean) => {
    const r = await ctx.view.request({ op: 'select', a: w.a, b: w.b, crossing });
    return r.ok && r.ids ? new Set(r.ids) : undefined;
  };
  const inside = await ask(false);
  const crossing = inside && (await ask(true));
  return { box: boxOf(w), ...(inside && { inside }), ...(crossing && { crossing }) };
}

/**
 * STRETCH: the points of the selected objects inside the last crossing window move by a
 * displacement, objects wholly inside it or picked individually move whole (AutoCAD 2024 Help,
 * "STRETCH (Command)"). Its base point and displacement are MOVE's.
 */
export function stretchCommand(): CommandDef {
  let last: Vec2 = { x: 0, y: 0 };
  return {
    name: 'STRETCH',
    usesSelection: 'during',
    async *run(ctx) {
      ctx.message('Select objects to stretch by crossing-window or crossing-polygon...');
      const sel = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      if (sel.kind !== 'selection' || sel.ids.length === 0) return;
      const ids = sel.ids;
      const w = sel.window ? await stretchWindow(ctx, sel.window) : undefined;
      // Dimensions stretch when they can be regenerated (M2-10 part 3).
      const options = { dimensions: ctx.dimensions !== undefined };
      const a = yield ctx.prompt.point({
        message: 'Specify base point or',
        options: ['Displacement'],
        defaultLabel: 'Displacement',
      });
      let d: Vec2 | undefined;
      if (a.kind === 'point') {
        const base = a.point;
        // What moves whole and what is reshaped does not depend on the displacement.
        const plan = planStretch(ctx.model, ids, w, { x: 0, y: 0 }, options);
        const b = yield ctx.prompt.point({
          message: 'Specify second point or',
          defaultLabel: 'use first point as displacement',
          rubberBand: { from: base },
          drag: {
            kind: 'stretch',
            ids: plan.move,
            shape: [...plan.shape.keys()],
            window: w?.box ?? { minX: 0, minY: 0, maxX: -1, maxY: -1 },
            from: base,
          },
        });
        if (b.kind === 'enter') d = base;
        else if (b.kind === 'point') d = sub(b.point, base);
      } else if (a.kind === 'enter' || a.kind === 'keyword') {
        d = yield* displacement(ctx, last);
      }
      if (!d) return;
      last = d;
      const disp = d;
      const report = run(ctx, 'stretched', (b) =>
        stretchObjects(b, ctx.model, ids, w, disp, options),
      );
      await regenerateDimensions(ctx, report.regenerate ?? []);
    },
  };
}

export const EDIT_COMMANDS: readonly (() => CommandDef)[] = [
  eraseCommand,
  moveCommand,
  copyCommand,
  rotateCommand,
  scaleCommand,
  mirrorCommand,
  stretchCommand,
];
