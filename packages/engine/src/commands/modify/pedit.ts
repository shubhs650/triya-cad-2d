// PEDIT (M3-02 part 5), with AutoCAD 2024's prompts (AutoCAD Help, "PEDIT (Command)", "2D
// Polyline Selection (PEDIT)", "3D Polyline Selection (PEDIT)"):
//
//   Select polyline or [Multiple]:
//   Object selected is not a polyline
//   Do you want to turn it into one? <Y>:
//   Enter an option [Close/Join/Width/Edit vertex/Fit/Spline/Decurve/Ltype gen/Reverse/Undo]:
//
// One polyline is edited option by option until Enter; a line, arc or spline picked is turned
// into one first (a spline at the precision asked for). Multiple edits every polyline chosen at
// once, Join then taking a fuzz distance and a Jointype. Undo takes back the options one by one
// as far as the start of the command. Edit vertex marks a vertex with an X and walks it along
// the polyline (the frame of a spline-fit one). The geometry is `edit/pedit.ts`'s.
//
// PEDITACCEPT (a registry variable, not saved in the drawing) is taken as 0: PEDIT always asks
// before turning a line, arc or spline into a polyline. Tangents given with Edit vertex Tangent
// are used by Fit while PEDIT runs; they are not saved (VERTEX DXF 50).
import { reverseGeometry } from '../../edit/break';
import { eraseObjects, reshapeObject, revertChanges } from '../../edit/edit';
import { joinObjects } from '../../edit/join';
import { offsetCurveOf } from '../../edit/offset';
import {
  breakVertices,
  closePolyline,
  decurvePolyline,
  editVertices,
  fitPolyline,
  fuzzyJoin,
  insertVertex,
  is3dPolyline,
  isPolyline,
  isSplineFit,
  moveVertex,
  polylineFrom,
  segmentWidth,
  splineFit,
  straightenVertices,
  widthPolyline,
  withEditVertices,
  withVertices,
  type EditablePolyline,
  type JoinType,
} from '../../edit/pedit';
import { toleranceForSize, type Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import type { ChangeSet } from '../../model/changeset';
import type { EntityId } from '../../model/entity-ids';
import type { EntityGeometry, PolylineVertex } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { toleranceFor } from './offset';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const CONVERTIBLE = new Set(['LINE', 'ARC', 'SPLINE']);

/** SPLINETYPE (5 quadratic, 6 cubic) and SPLINESEGS from the drawing, AutoCAD's 6 and 8 else. */
function splineSettings(ctx: CommandContext): { type: 5 | 6; segs: number } {
  const t = ctx.model.header.get('$SPLINETYPE');
  const s = ctx.model.header.get('$SPLINESEGS');
  return {
    type: t === 5 ? 5 : 6,
    segs: typeof s === 'number' && s !== 0 ? Math.abs(Math.round(s)) : 8,
  };
}

function toleranceOf(ctx: CommandContext, g: EntityGeometry): Tolerance {
  const c = offsetCurveOf(g);
  return c ? toleranceFor(ctx.model, c) : toleranceForSize(1);
}

/** One step PEDIT can take back: the edit, and the objects it worked on before it. */
interface Step {
  readonly cs: ChangeSet;
  readonly ids: readonly EntityId[];
}

/** Segments in a polyline. */
const segments = (g: EditablePolyline): number =>
  g.closed ? g.vertices.length : Math.max(0, g.vertices.length - 1);

async function* yesNo(ctx: CommandContext, message: string): Sub<boolean | undefined> {
  const a = yield ctx.prompt.keyword({ message, options: ['Yes', 'No'], defaultLabel: 'Y' });
  if (a.kind === 'enter') return true;
  if (a.kind !== 'keyword') return undefined;
  return a.keyword === 'Yes';
}

async function* precision(ctx: CommandContext, message: string): Sub<number | undefined> {
  for (;;) {
    const a = yield ctx.prompt.integer({ message, default: { kind: 'number', value: 10 } });
    if (a.kind !== 'number') return undefined;
    if (a.value >= 0 && a.value <= 99) return a.value;
    ctx.message('Requires an integer between 0 and 99.');
  }
}

export function peditCommand(): CommandDef {
  return {
    name: 'PEDIT',
    usesSelection: 'during',
    async *run(ctx) {
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select polyline or',
          options: ['Multiple'],
          single: true,
          pickfirst: true,
          editable: true,
        });
        if (a.kind === 'keyword') {
          yield* multiple(ctx);
          return;
        }
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        let id = a.ids[0]!;
        const g = ctx.model.entity(id)!.geom;
        if (!isPolyline(g)) {
          ctx.message('Object selected is not a polyline');
          if (!CONVERTIBLE.has(g.kind)) continue;
          const yes = yield* yesNo(ctx, 'Do you want to turn it into one?');
          if (yes === undefined) return;
          if (!yes) continue;
          let p = 10;
          if (g.kind === 'SPLINE') {
            const n = yield* precision(ctx, 'Specify a precision');
            if (n === undefined) return;
            p = n;
          }
          const poly = polylineFrom(g, p);
          if (!poly) continue;
          ctx.edit((b) => {
            id = reshapeObject(b, ctx.model, id, [poly])[0]!;
          });
        }
        yield* single(ctx, id);
        return;
      }
    },
  };
}

// ── One polyline ────────────────────────────────────────────────────────────────────────────

async function* single(ctx: CommandContext, start: EntityId): Sub<void> {
  let id = start;
  const steps: Step[] = [];
  // Edit vertex Tangent's directions, by editing vertex, for Fit.
  let tangents: (number | undefined)[] = [];
  const geom = () => ctx.model.entity(id)?.geom as EditablePolyline | undefined;
  const change = (shapes: readonly EntityGeometry[]): void => {
    const before = id;
    const cs = ctx.edit((b) => {
      id = reshapeObject(b, ctx.model, id, shapes)[0] ?? id;
    });
    steps.push({ cs, ids: [before] });
  };
  for (;;) {
    const g = geom();
    if (!g) return;
    const three = is3dPolyline(g);
    const options = three
      ? [g.closed ? 'Open' : 'Close', 'Edit vertex', 'Spline curve', 'Decurve', 'Reverse', 'Undo']
      : [
          g.closed ? 'Open' : 'Close',
          'Join',
          'Width',
          'Edit vertex',
          'Fit',
          'Spline',
          'Decurve',
          'Ltype gen',
          'Reverse',
          'Undo',
        ];
    const a = yield ctx.prompt.keyword({ message: 'Enter an option', options });
    if (a.kind !== 'keyword') return;
    const tol = toleranceOf(ctx, g);
    switch (a.keyword) {
      case 'Close':
      case 'Open':
        change([closePolyline(g, a.keyword === 'Close', splineSettings(ctx), tol)]);
        break;
      case 'Join': {
        const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
        if (s.kind !== 'selection') return;
        const more = s.ids.filter((x) => x !== id);
        const source = decurvePolyline(g);
        const r = joinObjects(
          [{ id, geom: source }, ...more.map((x) => ({ id: x, geom: ctx.model.entity(x)!.geom }))],
          id,
          tol,
        );
        const j = r.joined.find((x) => x.keep === id);
        if (!j || g.closed) {
          ctx.message('0 segments added to polyline');
          break;
        }
        const before = id;
        const cs = ctx.edit((b) => {
          reshapeObject(b, ctx.model, id, [j.geom]);
          eraseObjects(
            b,
            ctx.model,
            j.parts.filter((x) => x !== id),
          );
        });
        steps.push({ cs, ids: [before] });
        const added = segments(j.geom as EditablePolyline) - segments(source);
        ctx.message(`${added} segments added to polyline`);
        break;
      }
      case 'Width': {
        const w = yield ctx.prompt.distance({ message: 'Specify new width for all segments' });
        if (w.kind !== 'distance') return;
        change([widthPolyline(g, Math.abs(w.value))]);
        break;
      }
      case 'Edit vertex': {
        const r = yield* editVertex(
          ctx,
          () => id,
          (x) => (id = x),
          steps,
          tangents,
        );
        tangents = r.tangents;
        if (r.cancelled) return;
        break;
      }
      case 'Fit':
        change([fitPolyline(g, tangents, tol)]);
        break;
      case 'Spline':
      case 'Spline curve': {
        const s = splineSettings(ctx);
        change([splineFit(g, s.type, s.segs)]);
        break;
      }
      case 'Decurve':
        change([decurvePolyline(g)]);
        break;
      case 'Ltype gen': {
        const on = g.plinegen === true;
        const l = yield ctx.prompt.keyword({
          message: 'Enter polyline linetype generation option',
          options: ['ON', 'OFF'],
          defaultLabel: on ? 'On' : 'Off',
        });
        if (l.kind === 'enter') break;
        if (l.kind !== 'keyword') return;
        const want = l.keyword === 'ON';
        if (want === on) break;
        const { plinegen: _p, ...rest } = g;
        change([want ? { ...g, plinegen: true } : rest]);
        break;
      }
      case 'Reverse': {
        const r = reverseGeometry(g);
        if (r) {
          change([r]);
          tangents = [...tangents].reverse();
        }
        break;
      }
      case 'Undo': {
        const last = steps.pop();
        if (!last) {
          ctx.message('All PEDIT operations have been undone.');
          break;
        }
        ctx.edit((b) => revertChanges(b, last.cs));
        id = last.ids[0]!;
        break;
      }
    }
  }
}

// ── Edit vertex ────────────────────────────────────────────────────────────────────────────

/** The X PEDIT marks a vertex with, sized to the polyline. */
function marker(vs: readonly Vec2[], at: Vec2): EntityGeometry[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of vs) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const s = Math.max(Math.hypot(maxX - minX, maxY - minY) * 0.02, 1e-6);
  const line = (dx: number, dy: number): EntityGeometry => ({
    kind: 'LINE',
    start: { x: at.x - dx, y: at.y - dy },
    end: { x: at.x + dx, y: at.y + dy },
  });
  return [line(s, s), line(s, -s)];
}

async function* editVertex(
  ctx: CommandContext,
  current: () => EntityId,
  setCurrent: (id: EntityId) => void,
  steps: Step[],
  given: (number | undefined)[],
): Sub<{ cancelled: boolean; tangents: (number | undefined)[] }> {
  let tangents = [...given];
  let i = 0;
  const geom = () => ctx.model.entity(current())!.geom as EditablePolyline;
  const segs = () => splineSettings(ctx).segs;
  const change = (shapes: readonly EntityGeometry[]): void => {
    const before = current();
    const cs = ctx.edit((b) => {
      setCurrent(reshapeObject(b, ctx.model, current(), shapes)[0] ?? current());
    });
    steps.push({ cs, ids: [before] });
  };
  const done = (cancelled: boolean) => {
    ctx.preview([]);
    return { cancelled, tangents };
  };
  for (;;) {
    const g = geom();
    const three = is3dPolyline(g);
    const vs = editVertices(g);
    i = Math.min(i, vs.length - 1);
    ctx.preview(marker(vs, vs[i]!));
    const options = three
      ? ['Next', 'Previous', 'Break', 'Insert', 'Move', 'Regen', 'eXit']
      : [
          'Next',
          'Previous',
          'Break',
          'Insert',
          'Move',
          'Regen',
          'Straighten',
          'Tangent',
          'Width',
          'eXit',
        ];
    const a = yield ctx.prompt.keyword({
      message: 'Enter a vertex editing option',
      options,
      defaultLabel: 'N',
    });
    const k = a.kind === 'enter' ? 'Next' : a.kind === 'keyword' ? a.keyword : undefined;
    if (k === undefined) return done(true);
    switch (k) {
      case 'Next':
        i = Math.min(i + 1, vs.length - 1);
        break;
      case 'Previous':
        i = Math.max(i - 1, 0);
        break;
      case 'Break':
      case 'Straighten': {
        let j = i;
        let go: boolean;
        for (;;) {
          ctx.preview([...marker(vs, vs[i]!), ...marker(vs, vs[j]!)]);
          const b = yield ctx.prompt.keyword({
            message: 'Enter an option',
            options: ['Next', 'Previous', 'Go', 'eXit'],
            defaultLabel: 'N',
          });
          const kk = b.kind === 'enter' ? 'Next' : b.kind === 'keyword' ? b.keyword : undefined;
          if (kk === undefined) return done(true);
          if (kk === 'Next') j = Math.min(j + 1, vs.length - 1);
          else if (kk === 'Previous') j = Math.max(j - 1, 0);
          else {
            go = kk === 'Go';
            break;
          }
        }
        if (!go) break;
        if (k === 'Straighten') {
          const s = straightenVertices(vs, i, j);
          if (s) change([withEditVertices(g, s, segs())]);
          i = Math.min(i, j);
          break;
        }
        const r = breakVertices(vs, g.closed, i, j);
        if (typeof r === 'string') {
          ctx.message('*Invalid*');
          break;
        }
        // Breaking discards the curve fitting (AutoCAD: "The Break option discards the spline").
        change(r.map((p) => withVertices(g, p, false)));
        tangents = [];
        i = 0;
        break;
      }
      case 'Insert': {
        const p = yield ctx.prompt.point({
          message: 'Specify location for new vertex',
          rubberBand: { from: vs[i]! },
        });
        if (p.kind !== 'point') return done(true);
        change([withEditVertices(g, insertVertex(vs, i, p.point), segs())]);
        tangents.splice(i + 1, 0, undefined);
        break;
      }
      case 'Move': {
        const p = yield ctx.prompt.point({
          message: 'Specify new location for marked vertex',
          rubberBand: { from: vs[i]! },
        });
        if (p.kind !== 'point') return done(true);
        change([withEditVertices(g, moveVertex(vs, i, p.point), segs())]);
        break;
      }
      case 'Regen':
        break;
      case 'Tangent': {
        const t = yield ctx.prompt.angle({
          message: 'Specify direction of vertex tangent',
          base: vs[i]!,
        });
        if (t.kind !== 'angle') return done(true);
        // A spline-fit polyline ignores tangents (AutoCAD: "The Tangent option has no effect").
        if (!isSplineFit(g)) {
          tangents = [...tangents];
          tangents[i] = t.value;
        }
        break;
      }
      case 'Width': {
        const v: PolylineVertex = vs[i]!;
        const s = yield ctx.prompt.distance({
          message: 'Specify starting width for next segment',
          default: { kind: 'distance', value: v.startWidth ?? 0 },
        });
        if (s.kind !== 'distance') return done(true);
        const e = yield ctx.prompt.distance({
          message: 'Specify ending width for next segment',
          default: { kind: 'distance', value: s.value },
        });
        if (e.kind !== 'distance') return done(true);
        change([
          withEditVertices(g, segmentWidth(vs, i, Math.abs(s.value), Math.abs(e.value)), segs()),
        ]);
        break;
      }
      case 'eXit':
        return done(false);
    }
  }
}

// ── Multiple ───────────────────────────────────────────────────────────────────────────────

async function* multiple(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
  if (a.kind !== 'selection' || a.ids.length === 0) return;
  let ids = a.ids.filter((id) => {
    const g = ctx.model.entity(id)!.geom;
    return isPolyline(g) || CONVERTIBLE.has(g.kind);
  });
  const others = ids.filter((id) => !isPolyline(ctx.model.entity(id)!.geom));
  if (others.length > 0) {
    const yes = yield* yesNo(ctx, 'Convert Lines, Arcs and Splines to polylines');
    if (yes === undefined) return;
    if (!yes) ids = ids.filter((id) => !others.includes(id));
    else {
      let p = 10;
      if (others.some((id) => ctx.model.entity(id)!.geom.kind === 'SPLINE')) {
        const n = yield* precision(ctx, 'Specify a precision for spline conversion');
        if (n === undefined) return;
        p = n;
      }
      ctx.edit((b) => {
        ids = ids.map((id) => {
          const g = ctx.model.entity(id)!.geom;
          if (isPolyline(g)) return id;
          const poly = polylineFrom(g, p);
          return poly ? reshapeObject(b, ctx.model, id, [poly])[0]! : id;
        });
      });
    }
  }
  if (ids.length === 0) return;
  const steps: Step[] = [];
  let fuzz = 0;
  let type: JoinType = 'Extend';
  const geoms = () =>
    ids.flatMap((id) => {
      const g = ctx.model.entity(id)?.geom;
      return g && isPolyline(g) ? [{ id, geom: g }] : [];
    });
  const each = (f: (g: EditablePolyline, tol: Tolerance) => EntityGeometry | undefined): void => {
    const before = ids;
    const cs = ctx.edit((b) => {
      ids = ids.map((id) => {
        const g = ctx.model.entity(id)?.geom;
        if (!g || !isPolyline(g)) return id;
        const out = f(g, toleranceOf(ctx, g));
        return out && out !== g ? (reshapeObject(b, ctx.model, id, [out])[0] ?? id) : id;
      });
    });
    steps.push({ cs, ids: before });
  };
  for (;;) {
    const o = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options: [
        'Close',
        'Open',
        'Join',
        'Width',
        'Fit',
        'Spline',
        'Decurve',
        'Ltype gen',
        'Reverse',
        'Undo',
      ],
    });
    if (o.kind !== 'keyword') return;
    const flat = (f: (g: EditablePolyline, tol: Tolerance) => EntityGeometry | undefined) =>
      each((g, tol) => (is3dPolyline(g) ? undefined : f(g, tol)));
    switch (o.keyword) {
      case 'Close':
      case 'Open': {
        const closed = o.keyword === 'Close';
        each((g, tol) =>
          g.closed === closed ? undefined : closePolyline(g, closed, splineSettings(ctx), tol),
        );
        break;
      }
      case 'Join': {
        for (;;) {
          const f = yield ctx.prompt.distance({
            message: 'Enter fuzz distance or',
            options: ['Jointype'],
            default: { kind: 'distance', value: fuzz },
          });
          if (f.kind === 'distance') {
            fuzz = Math.abs(f.value);
            break;
          }
          if (f.kind !== 'keyword') return;
          const t = yield ctx.prompt.keyword({
            message: 'Enter Join Type',
            options: ['Extend', 'Add', 'Both'],
            defaultLabel: type,
          });
          if (t.kind === 'keyword') type = t.keyword as JoinType;
          else if (t.kind !== 'enter') return;
        }
        const parts = geoms();
        const tol = parts[0] ? toleranceOf(ctx, parts[0].geom) : toleranceForSize(1);
        const joined = fuzzyJoin(parts, fuzz, type, tol);
        let added = 0;
        const before = ids;
        const cs = ctx.edit((b) => {
          for (const j of joined) {
            const keep = reshapeObject(b, ctx.model, j.keep, [j.geom])[0] ?? j.keep;
            const gone = j.parts.filter((x) => x !== j.keep);
            eraseObjects(b, ctx.model, gone);
            ids = ids.filter((x) => !gone.includes(x)).map((x) => (x === j.keep ? keep : x));
            added += j.added;
          }
        });
        steps.push({ cs, ids: before });
        ctx.message(`${added} segments added to polyline`);
        break;
      }
      case 'Width': {
        const w = yield ctx.prompt.distance({ message: 'Specify new width for all segments' });
        if (w.kind !== 'distance') return;
        flat((g) => widthPolyline(g, Math.abs(w.value)));
        break;
      }
      case 'Fit':
        flat((g, tol) => fitPolyline(g, [], tol));
        break;
      case 'Spline': {
        const s = splineSettings(ctx);
        each((g) => splineFit(g, s.type, s.segs));
        break;
      }
      case 'Decurve':
        each((g) => decurvePolyline(g));
        break;
      case 'Ltype gen': {
        const l = yield ctx.prompt.keyword({
          message: 'Enter polyline linetype generation option',
          options: ['ON', 'OFF'],
          defaultLabel: 'Off',
        });
        if (l.kind !== 'keyword' && l.kind !== 'enter') return;
        const on = l.kind === 'keyword' && l.keyword === 'ON';
        flat((g) => {
          if ((g.plinegen === true) === on) return undefined;
          const { plinegen: _p, ...rest } = g;
          return on ? { ...g, plinegen: true } : rest;
        });
        break;
      }
      case 'Reverse':
        each((g) => reverseGeometry(g));
        break;
      case 'Undo': {
        const last = steps.pop();
        if (!last) {
          ctx.message('All PEDIT operations have been undone.');
          break;
        }
        ctx.edit((b) => revertChanges(b, last.cs));
        ids = [...last.ids];
        break;
      }
    }
  }
}
