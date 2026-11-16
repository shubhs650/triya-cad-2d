// SPLINEDIT (M3-02 part 6), with AutoCAD 2024's prompts (AutoCAD Help, "SPLINEDIT (Command)"):
//
//   Select spline:
//   Enter an option [Close/Join/Fit data/Edit vertex/convert to Polyline/Reverse/Undo/eXit] <eXit>:
//     Fit data:     Enter a fit data option [Add/Close/Delete/Kink/Move/Purge/Tangents/toLerance/eXit] <eXit>:
//     Edit vertex:  Enter a vertex editing option [Add/Delete/Elevate order/Move/Weight/eXit] <eXit>:
//
// Close reads Open on a closed spline; Fit data is offered only while the spline has fit data.
// A spline-fit polyline picked becomes a spline at once (AutoCAD: "even if you immediately exit
// SPLINEDIT"). Fit edits refit through the fit points; control-vertex edits drop the fit data.
// Undo takes back the options one by one as far as the start of the command. Moving along fit
// points or control vertices marks the current one with an X, as PEDIT's Edit vertex does, and
// Edit vertex shows the control frame (M3-16). A closed spline's tangent shapes the curve at its
// seam, and toLerance refits within the tolerance (`geom/fit.ts`, M3-16). The geometry is
// `edit/splinedit.ts`'s.
//
// Prompts AutoCAD does not document word for word (the sub-prompts of Add, Delete, Kink, Move,
// Weight and Join) follow its documented option names; the messages for what cannot be done
// are ours.
import { reverseGeometry } from '../../edit/break';
import { eraseObjects, reshapeObject, revertChanges } from '../../edit/edit';
import { polylineFrom } from '../../edit/pedit';
import {
  MAX_SPLINE_ORDER,
  addControlVertex,
  closeControlFrame,
  controlPositions,
  controlWeight,
  deleteControlVertex,
  elevateOrder,
  fitEditOf,
  fitInsertIndex,
  hasFitData,
  joinToSpline,
  moveControlVertex,
  nearestIndex,
  pointOnSpline,
  purgeFitData,
  weightControlVertex,
  withFitData,
  type FitEdit,
} from '../../edit/splinedit';
import { toleranceForSize, type Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { distance } from '../../geom/vec';
import type { ChangeSet } from '../../model/changeset';
import type { EntityId } from '../../model/entity-ids';
import { splineCurve } from '../../model/spline';
import type { EntityGeometry, SplineGeometry } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { splineOfFitPolyline } from '../draw/spline';
import { toleranceFor } from './offset';
import { marker, precision } from './pedit';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

interface Step {
  readonly cs: ChangeSet;
  readonly id: EntityId;
}

/** One spline being edited, with the steps Undo takes back. */
class Session {
  readonly steps: Step[] = [];
  constructor(
    readonly ctx: CommandContext,
    public id: EntityId,
  ) {}

  /** The spline: it stays one until convert to Polyline, which ends the command. */
  get geom(): SplineGeometry {
    return this.ctx.model.entity(this.id)!.geom as SplineGeometry;
  }

  get tol(): Tolerance {
    const c = splineCurve(this.geom);
    return c ? toleranceFor(this.ctx.model, c) : toleranceForSize(1);
  }

  /** The spline reshaped to `g`; false (nothing done) when there is no `g`. */
  change(g: EntityGeometry | undefined, erase: readonly EntityId[] = []): boolean {
    if (!g) return false;
    const before = this.id;
    const cs = this.ctx.edit((b) => {
      this.id = reshapeObject(b, this.ctx.model, this.id, [g])[0]!;
      if (erase.length > 0) eraseObjects(b, this.ctx.model, erase);
    });
    this.steps.push({ cs, id: before });
    return true;
  }

  fit(f: (now: FitEdit, g: SplineGeometry) => FitEdit | undefined): boolean {
    const g = this.geom;
    const next = f(fitEditOf(g, this.tol), g);
    return next !== undefined && this.change(withFitData(g, next));
  }
}

export function splineditCommand(): CommandDef {
  return {
    name: 'SPLINEDIT',
    usesSelection: 'during',
    async *run(ctx) {
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select spline',
          single: true,
          pickfirst: true,
          editable: true,
        });
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        let id = a.ids[0]!;
        const g = ctx.model.entity(id)!.geom;
        if (g.kind !== 'SPLINE') {
          const s = splineOfFitPolyline(g);
          if (!s) {
            ctx.message('Object selected is not a spline or a spline-fit polyline.');
            continue;
          }
          ctx.edit((b) => {
            id = reshapeObject(b, ctx.model, id, [s])[0]!;
          });
        }
        yield* main(new Session(ctx, id));
        ctx.preview([]);
        return;
      }
    },
  };
}

async function* main(s: Session): Sub<void> {
  const { ctx } = s;
  for (;;) {
    const g = s.geom;
    const options = [
      g.closed ? 'Open' : 'Close',
      'Join',
      ...(hasFitData(g) ? ['Fit data'] : []),
      'Edit vertex',
      'convert to Polyline',
      'Reverse',
      'Undo',
      'eXit',
    ];
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options,
      defaultLabel: 'eXit',
    });
    if (a.kind !== 'keyword' || a.keyword === 'eXit') return;
    switch (a.keyword) {
      case 'Close':
      case 'Open': {
        const close = a.keyword === 'Close';
        if (hasFitData(g)) s.fit((f) => ({ ...f, closed: close }));
        else s.change(closeControlFrame(g, close));
        break;
      }
      case 'Join': {
        const j = yield ctx.prompt.selection({
          message: 'Select any open curves to join to the source',
          editable: true,
        });
        // Esc cancels the command (the bus returns the generator): a selection is all that comes.
        const others = (j as { ids: readonly EntityId[] }).ids
          .filter((x) => x !== s.id)
          .map((x) => ({ id: x, geom: ctx.model.entity(x)!.geom }));
        const r = joinToSpline(g, others, s.tol);
        const n = r?.joined.length ?? 0;
        if (r) s.change(r.geom, r.joined);
        ctx.message(`${n} object${n === 1 ? '' : 's'} joined to the spline`);
        break;
      }
      case 'Fit data':
        yield* fitData(s);
        break;
      case 'Edit vertex':
        yield* editVertex(s);
        break;
      case 'convert to Polyline': {
        const p = yield* precision(ctx, 'Specify a precision');
        s.change(polylineFrom(g, p!));
        return;
      }
      case 'Reverse':
        s.change(reverseGeometry(g));
        break;
      case 'Undo': {
        const last = s.steps.pop();
        if (!last) {
          ctx.message('All SPLINEDIT operations have been undone.');
          break;
        }
        ctx.edit((b) => revertChanges(b, last.cs));
        s.id = last.id;
        break;
      }
    }
  }
}

/** Marks point `i` of `pts` with an X. */
const mark = (s: Session, pts: readonly Vec2[], i: number) => s.ctx.preview(marker(pts, pts[i]!));

/**
 * The control frame (M3-16), shown while control vertices are edited as AutoCAD shows it: the
 * polygon through the editable vertices, closed round a closed spline.
 */
function controlFrame(g: SplineGeometry): EntityGeometry[] {
  const pts = controlPositions(g);
  if (pts.length < 2) return [];
  return [
    {
      kind: 'LWPOLYLINE',
      vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
      closed: g.closed && pts.length > 2,
    },
  ];
}

/** A point picked at an "<exit>" prompt: the point, or undefined for Enter (exit). */
async function* pointOrExit(s: Session, message: string): Sub<Vec2 | undefined> {
  const a = yield s.ctx.prompt.point({ message, defaultLabel: 'exit' });
  return a.kind === 'point' ? a.point : undefined;
}

/** The next index walking `n` points: round a closed spline, stopping at an open one's end. */
const step = (i: number, by: 1 | -1, n: number, closed: boolean) =>
  closed ? (i + by + n) % n : Math.max(0, Math.min(n - 1, i + by));

// ── Fit data ───────────────────────────────────────────────────────────────────────────────

async function* fitData(s: Session): Sub<void> {
  const { ctx } = s;
  for (;;) {
    ctx.preview([]);
    const g = s.geom;
    const a = yield ctx.prompt.keyword({
      message: 'Enter a fit data option',
      options: [
        'Add',
        g.closed ? 'Open' : 'Close',
        'Delete',
        'Kink',
        'Move',
        'Purge',
        'Tangents',
        'toLerance',
        'eXit',
      ],
      defaultLabel: 'eXit',
    });
    if (a.kind !== 'keyword') return;
    switch (a.keyword) {
      case 'eXit':
        return;
      case 'Add':
        yield* fitAdd(s);
        break;
      case 'Close':
      case 'Open': {
        const close = a.keyword === 'Close';
        s.fit((f) => ({ ...f, closed: close }));
        break;
      }
      case 'Delete':
        yield* fitDelete(s);
        break;
      case 'Kink':
        yield* fitKink(s);
        break;
      case 'Move':
        yield* walk(s, 'fit');
        break;
      case 'Purge':
        s.change(purgeFitData(g));
        return;
      case 'Tangents':
        yield* tangents(s);
        break;
      case 'toLerance': {
        for (;;) {
          const t = yield ctx.prompt.distance({
            message: 'Enter fit tolerance',
            default: { kind: 'distance', value: g.fitTolerance ?? 0 },
          });
          const v = (t as { value: number }).value;
          if (v < 0) {
            ctx.message('Value must be positive or zero.');
            continue;
          }
          // AutoCAD: "Refits the spline to the existing points with new tolerance values": the
          // curve passes within it of the fit points, or through them at 0 (fit.ts, M3-16).
          const { fitTolerance: _t, ...rest } = g;
          const next: SplineGeometry = v > 0 ? { ...rest, fitTolerance: v } : rest;
          s.change(withFitData(next, fitEditOf(g, s.tol)) ?? next);
          break;
        }
        break;
      }
    }
  }
}

/** Fit data Add: new fit points after (or, at an open spline's start, before) one picked. */
async function* fitAdd(s: Session): Sub<void> {
  for (;;) {
    const pts = s.geom.fitPoints!;
    const p = yield* pointOrExit(s, 'Specify existing fit point');
    if (!p) return;
    let k = nearestIndex(pts, p);
    let before = false;
    for (;;) {
      const g = s.geom;
      const now = g.fitPoints!;
      mark(s, now, k);
      const first = !g.closed && k === 0;
      const a = yield {
        ...s.ctx.prompt.point({
          message: first ? 'Specify new fit point or' : 'Specify new fit point',
          ...(first && { options: ['After', 'Before'] }),
          defaultLabel: 'exit',
          rubberBand: { from: now[k]! },
        }),
      };
      if (a.kind === 'keyword') {
        before = a.keyword === 'Before';
        continue;
      }
      if (a.kind !== 'point') break;
      const at = before ? k : k + 1;
      s.fit((f) => ({
        ...f,
        points: [...f.points.slice(0, at), a.point, ...f.points.slice(at)],
        kinks: [...f.kinks.slice(0, at), false, ...f.kinks.slice(at)],
      }));
      if (!before) k = at;
    }
    s.ctx.preview([]);
  }
}

async function* fitDelete(s: Session): Sub<void> {
  for (;;) {
    const g = s.geom;
    const pts = g.fitPoints!;
    const p = yield* pointOrExit(s, 'Specify existing fit point');
    if (!p) return;
    const least = g.closed ? 3 : 2;
    if (pts.length <= least) {
      s.ctx.message(`A ${g.closed ? 'closed ' : ''}spline needs at least ${least} fit points.`);
      continue;
    }
    const k = nearestIndex(pts, p);
    s.fit((f) => ({
      ...f,
      points: f.points.filter((_, i) => i !== k),
      kinks: f.kinks.filter((_, i) => i !== k),
    }));
  }
}

async function* fitKink(s: Session): Sub<void> {
  for (;;) {
    const p = yield* pointOrExit(s, 'Specify new point on spline');
    if (!p) return;
    const g = s.geom;
    const tol = s.tol;
    const q = pointOnSpline(g, p, tol)!;
    const pts = g.fitPoints!;
    const same = pts.findIndex((f) => distance(f, q) <= tol.linear);
    const at = same >= 0 ? same : fitInsertIndex(g, q, tol);
    s.fit((f) =>
      same >= 0
        ? { ...f, kinks: f.kinks.map((k, i) => k || i === same) }
        : {
            ...f,
            points: [...f.points.slice(0, at), q, ...f.points.slice(at)],
            kinks: [...f.kinks.slice(0, at), true, ...f.kinks.slice(at)],
          },
    );
  }
}

/** Fit data Tangents: a point gives the direction from the end; System default takes it off. */
async function* tangents(s: Session): Sub<void> {
  const g = s.geom;
  const pts = g.fitPoints!;
  const ask = async function* (message: string, from: Vec2): Sub<Vec2 | undefined | null> {
    const a = yield s.ctx.prompt.point({
      message,
      options: ['System default'],
      rubberBand: { from },
    });
    if (a.kind === 'keyword') return null;
    if (a.kind !== 'point') return undefined;
    const t = { x: a.point.x - from.x, y: a.point.y - from.y };
    return t.x !== 0 || t.y !== 0 ? t : undefined;
  };
  // undefined keeps the tangent as it is, null is System default.
  const start = yield* ask(g.closed ? 'Specify tangent or' : 'Specify start tangent or', pts[0]!);
  let end: Vec2 | undefined | null = undefined;
  if (!g.closed) {
    end = yield* ask('Specify end tangent or', pts.at(-1)!);
  }
  if (start === undefined && end === undefined) return;
  s.fit((f) => ({
    ...f,
    startTangent: start === undefined ? f.startTangent : (start ?? undefined),
    endTangent: end === undefined ? f.endTangent : (end ?? undefined),
  }));
}

// ── Edit vertex ────────────────────────────────────────────────────────────────────────────

async function* editVertex(s: Session): Sub<void> {
  const { ctx } = s;
  const frame = () => ctx.preview(controlFrame(s.geom));
  for (;;) {
    frame();
    const a = yield ctx.prompt.keyword({
      message: 'Enter a vertex editing option',
      options: ['Add', 'Delete', 'Elevate order', 'Move', 'Weight', 'eXit'],
      defaultLabel: 'eXit',
    });
    if (a.kind !== 'keyword') return;
    switch (a.keyword) {
      case 'eXit':
        ctx.preview([]);
        return;
      case 'Add':
        for (;;) {
          frame();
          const p = yield* pointOrExit(s, 'Specify a point on the spline');
          if (!p) break;
          if (!s.change(addControlVertex(s.geom, p, s.tol))) {
            ctx.message('A control vertex cannot be added there.');
          }
        }
        break;
      case 'Delete':
        for (;;) {
          frame();
          const p = yield* pointOrExit(s, 'Specify control point');
          if (!p) break;
          const g = s.geom;
          const k = nearestIndex(controlPositions(g), p);
          if (!s.change(deleteControlVertex(g, k))) {
            ctx.message(`The spline needs more control points than its order (${g.degree + 1}).`);
          }
        }
        break;
      case 'Elevate order': {
        const g = s.geom;
        const order = g.degree + 1;
        for (;;) {
          const o = yield ctx.prompt.integer({
            message: 'Enter new order',
            default: { kind: 'number', value: order },
          });
          const v = (o as { value: number }).value;
          if (v >= order && v <= MAX_SPLINE_ORDER) {
            if (v > order) s.change(elevateOrder(g, v));
            break;
          }
          ctx.message(`Requires an integer between ${order} and ${MAX_SPLINE_ORDER}.`);
        }
        break;
      }
      case 'Move':
        yield* walk(s, 'move');
        break;
      case 'Weight':
        yield* walk(s, 'weight');
        break;
    }
  }
}

/**
 * Fit data Move ('fit'), Edit vertex Move ('move') and Weight ('weight'): the current fit point
 * or control vertex is marked, Next and Previous walk, Select point picks one.
 */
async function* walk(s: Session, what: 'fit' | 'move' | 'weight'): Sub<void> {
  const { ctx } = s;
  const points = () => (what === 'fit' ? s.geom.fitPoints! : controlPositions(s.geom));
  let i = 0;
  for (;;) {
    const g = s.geom;
    const pts = points();
    i = Math.min(i, pts.length - 1);
    if (what === 'fit') mark(s, pts, i);
    else ctx.preview([...controlFrame(g), ...marker(pts, pts[i]!)]);
    const options = ['Next', 'Previous', 'Select point', 'eXit'];
    const a: PromptAnswer =
      what === 'weight'
        ? yield ctx.prompt.real({
            message: `Enter new weight (current = ${controlWeight(g, i).toFixed(4)}) or`,
            options,
            defaultLabel: 'N',
          })
        : yield ctx.prompt.point({
            message: 'Specify new location or',
            options,
            defaultLabel: 'N',
            rubberBand: { from: pts[i]! },
          });
    const k = a.kind === 'enter' ? 'Next' : a.kind === 'keyword' ? a.keyword : undefined;
    if (k === 'eXit') return;
    if (k === 'Next' || k === 'Previous') {
      i = step(i, k === 'Next' ? 1 : -1, pts.length, g.closed);
      continue;
    }
    if (k === 'Select point') {
      const p = yield* pointOrExit(
        s,
        what === 'fit' ? 'Specify existing fit point' : 'Specify control point',
      );
      if (p) i = nearestIndex(pts, p);
      continue;
    }
    if (a.kind === 'point') {
      const to = a.point;
      if (what === 'fit') {
        s.fit((f) => ({ ...f, points: f.points.map((q, j) => (j === i ? to : q)) }));
      } else s.change(moveControlVertex(g, i, to));
      continue;
    }
    const w = (a as { value: number }).value;
    if (!(w > 0)) {
      ctx.message('Value must be positive.');
      continue;
    }
    s.change(weightControlVertex(g, i, w));
  }
}
