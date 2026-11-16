// TRIM and EXTEND (M3-02 part 2), with AutoCAD 2024's prompts and options (AutoCAD 2024 Help,
// "TRIM (Command)", "EXTEND (Command)", TRIMEXTENDMODE, EDGEMODE, PROJMODE):
//
//   Current settings: Projection=UCS, Edge=None, Mode=Quick
//   Select object to trim or shift-select to extend or
//   [cuTting edges/Crossing/mOde/Project/eRase/Undo]:
//
// Quick mode (TRIMEXTENDMODE 1, the default) takes every object as a cutting (boundary) edge; a
// pick on an object trims (extends) it, a pick on nothing starts a fence whose second point
// trims (extends) every object it crosses, and an object no edge crosses is deleted by TRIM.
// Standard mode (TRIMEXTENDMODE 0) first asks for the edges ("Select objects or [mOde] <select
// all>:", Enter taking every object) and offers Fence and Edge; a pick on nothing starts a
// crossing window. Both take Crossing (a window), Project, mOde, Undo (of the last trim, fence
// or window) and, for TRIM, eRase; cuTting edges (Boundary edges) chooses the edges again.
// Shift with a pick does the other command's work with the same edges: TRIM extends, EXTEND
// trims. Mode, Edge and Project are TRIMEXTENDMODE, EDGEMODE and PROJMODE, shared by TRIM and
// EXTEND, which the app keeps (M3-12, `option-variables.ts`): each starts from them and sets them
// when its option changes.
//
// Picks go through the canvas's `pick` (what is under the pickbox); fences and windows are
// worked out here, on the objects' curves. The geometry is `edit/trim.ts`'s.
//
// AutoCAD's Crossing "resolves the selection by following along the rectangular crossing window
// from the first point to objects encountered" and leaves the rest ambiguous: an object a window
// takes is trimmed (extended) where it is nearest the window's first corner inside the window,
// the most common drafter expectation.
//
// Block references, dimensions, tables, leaders, multileaders, text, regions, viewports and
// (chosen) hatches are edges too (M3-12 part 4, `edit/trim-edges.ts`): before each pick, fence
// or window the canvas measures the boxes of the texts among the edges (`textOutlines`), once
// per text for the command.
//
// M3-12 part 6: COMMANDPREVIEW (`command-preview.ts`) shows what a pick at the cursor would trim
// (extend; Shift held, the other), and in Quick mode a press on nothing dragged and let go is a
// freehand fence (AutoCAD 2024 Help, "TRIM (Command)": "click and drag to start a freehand
// selection path"), trimming (extending) every object the path crosses. Projection has nothing
// to do in plan (DEC-039).
import { boxOf, curveBounds } from '../../geom/bounds';
import type { Curve } from '../../geom/curves';
import { domain, pointAt } from '../../geom/eval';
import { intersect } from '../../geom/intersect';
import { closestPoint } from '../../geom/closest';
import type { Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { distance } from '../../geom/vec';
import { eraseObjects, reshapeObject, revertChanges } from '../../edit/edit';
import { cutParams, extendGeometry, pickParam, trimCurveOf, trimGeometry } from '../../edit/trim';
import {
  edgeTexts,
  objectEdgeCurves,
  type EdgeOptions,
  type EdgeText,
} from '../../edit/trim-edges';
import type { ChangeSet } from '../../model/changeset';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { Entity, EntityGeometry } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import { reshapePreview, type CommandPreview, type PreviewQuery } from '../command-preview';
import type { Prompt, PromptAnswer } from '../prompt';
import { toleranceFor } from './offset';
import { optionVariable, setOptionVariable } from './option-variables';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
type Work = 'trim' | 'extend';

/** TRIMEXTENDMODE, EDGEMODE and PROJMODE, which TRIM and EXTEND share. */
export interface TrimSettings {
  quick: boolean;
  /** EDGEMODE 1: edges cut where they would if they went on. */
  extendEdges: boolean;
  projection: 'None' | 'Ucs' | 'View';
}

export const trimSettings = (): TrimSettings => ({
  quick: true,
  extendEdges: false,
  projection: 'Ucs',
});

/** The edges: every object, or those chosen (Standard mode, cuTting edges). */
type Edges = 'all' | ReadonlySet<EntityId>;

/** The option a keyword prompt with a default answered: Enter gives the default. */
const keywordOf = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

const PROJECTION_LABEL = { None: 'None', Ucs: 'UCS', View: 'View' } as const;

/** PROJMODE's values: 0 None, 1 UCS, 2 View. */
const PROJECTIONS: readonly TrimSettings['projection'][] = ['None', 'Ucs', 'View'];

/** The settings from the app's variables, where it keeps them. */
async function loadSettings(ctx: CommandContext, s: TrimSettings): Promise<void> {
  s.quick = (await optionVariable(ctx, 'TRIMEXTENDMODE', s.quick ? 1 : 0)) === 1;
  s.extendEdges = (await optionVariable(ctx, 'EDGEMODE', s.extendEdges ? 1 : 0)) === 1;
  const p = await optionVariable(ctx, 'PROJMODE', PROJECTIONS.indexOf(s.projection));
  s.projection = PROJECTIONS[p] ?? s.projection;
}

/** Mode chosen: TRIMEXTENDMODE. */
async function setQuick(ctx: CommandContext, s: TrimSettings, quick: boolean): Promise<void> {
  s.quick = quick;
  await setOptionVariable(ctx, 'TRIMEXTENDMODE', quick ? 1 : 0);
}

/** The other command's work, which Shift does. */
const other = (w: Work): Work => (w === 'trim' ? 'extend' : 'trim');

/** "Object does not intersect an edge." */
const NO_EDGE = 'Object does not intersect an edge.';

/**
 * The object a pick takes of the objects `hits` under it: in the space, one with a curve first
 * (under a hatch the line it is drawn up to is what a drafter means).
 */
function pickTarget(ctx: CommandContext, hits: readonly EntityId[]): EntityId | undefined {
  const here = hits.filter((id) => ctx.model.entity(id)?.owner === ctx.space);
  return here.find((h) => trimCurveOf(ctx.model.entity(h)!.geom)) ?? here[0];
}

/** Objects on layers that are off or frozen are not drawn, so they are no edges. */
function shown(model: DocumentModel, id: EntityId): boolean {
  const e = model.entity(id);
  if (!e || !e.visible) return false;
  const l = model.tables.layers.get(e.layer);
  return !l || (l.on && !l.frozen);
}

const locked = (model: DocumentModel, id: EntityId): boolean =>
  model.tables.layers.get(model.entity(id)?.layer ?? '')?.locked === true;

/** The words that differ between TRIM and EXTEND. */
interface Words {
  readonly name: 'TRIM' | 'EXTEND';
  readonly work: Work;
  readonly select: string;
  readonly edges: string;
  readonly edgeOption: string;
  readonly modeMessage: string;
}

const TRIM_WORDS: Words = {
  name: 'TRIM',
  work: 'trim',
  select: 'Select object to trim or shift-select to extend or',
  edges: 'Select cutting edges ...',
  edgeOption: 'cuTting edges',
  modeMessage: 'Enter a trim mode option',
};

const EXTEND_WORDS: Words = {
  name: 'EXTEND',
  work: 'extend',
  select: 'Select object to extend or shift-select to trim or',
  edges: 'Select boundary edges ...',
  edgeOption: 'Boundary edges',
  modeMessage: 'Enter an extend mode option',
};

export const trimCommand = (s: TrimSettings): CommandDef => trimExtend(s, TRIM_WORDS);
export const extendCommand = (s: TrimSettings): CommandDef => trimExtend(s, EXTEND_WORDS);

function trimExtend(s: TrimSettings, w: Words): CommandDef {
  const options = (): string[] => [
    w.edgeOption,
    ...(s.quick ? [] : ['Fence']),
    'Crossing',
    'mOde',
    'Project',
    ...(s.quick ? [] : ['Edge']),
    ...(w.work === 'trim' ? ['eRase'] : []),
    'Undo',
  ];

  return {
    name: w.name,
    usesSelection: 'during',
    async *run(ctx) {
      await loadSettings(ctx, s);
      const settings = (): string =>
        `Current settings: Projection=${PROJECTION_LABEL[s.projection]}, Edge=${
          s.extendEdges ? 'Extend' : 'None'
        }, Mode=${s.quick ? 'Quick' : 'Standard'}`;
      ctx.message(settings());
      let edges: Edges = 'all';
      if (!s.quick) edges = yield* chooseEdges(ctx, true);
      /** Each trim, fence, window or erase made, for Undo: its edits in order. */
      const history: ChangeSet[][] = [];
      const run = new Runner(ctx, s, () => edges);
      for (;;) {
        const a = yield ctx.prompt.point({
          message: w.select,
          options: options(),
          pickbox: true,
          commandPreview: {
            hover: true,
            at: (q) => run.preview(q, q.shift ? other(w.work) : w.work),
          },
        });
        if (a.kind === 'keyword') {
          switch (a.keyword) {
            case w.edgeOption:
              edges = yield* chooseEdges(ctx, false);
              continue;
            case 'mOde': {
              const m = yield ctx.prompt.keyword({
                message: w.modeMessage,
                options: ['Quick', 'Standard'],
                default: { kind: 'keyword', keyword: s.quick ? 'Quick' : 'Standard' },
              });
              await setQuick(ctx, s, keywordOf(m) === 'Quick');
              ctx.message(settings());
              // Standard mode asks for its edges, as starting in it does; Quick takes them all.
              edges = s.quick ? 'all' : yield* chooseEdges(ctx, false);
              continue;
            }
            case 'Project': {
              const p = yield ctx.prompt.keyword({
                message: 'Enter a projection option',
                options: ['None', 'Ucs', 'View'],
                default: { kind: 'keyword', keyword: s.projection },
              });
              s.projection = keywordOf(p) as TrimSettings['projection'];
              await setOptionVariable(ctx, 'PROJMODE', PROJECTIONS.indexOf(s.projection));
              continue;
            }
            case 'Edge': {
              const e = yield ctx.prompt.keyword({
                message: 'Enter an implied edge extension mode',
                options: ['Extend', 'No extend'],
                default: { kind: 'keyword', keyword: s.extendEdges ? 'Extend' : 'No extend' },
              });
              s.extendEdges = keywordOf(e) === 'Extend';
              await setOptionVariable(ctx, 'EDGEMODE', s.extendEdges ? 1 : 0);
              continue;
            }
            case 'eRase': {
              const r = yield ctx.prompt.selection({
                message: 'Select objects to erase or',
                defaultLabel: 'exit',
                editable: true,
              });
              if (r.kind !== 'selection' || r.ids.length === 0) continue;
              history.push([ctx.edit((b) => eraseObjects(b, ctx.model, r.ids))]);
              continue;
            }
            case 'Undo': {
              const last = history.pop();
              if (!last) {
                ctx.message('Nothing to undo.');
                continue;
              }
              for (const cs of [...last].reverse()) ctx.edit((b) => revertChanges(b, cs));
              continue;
            }
            case 'Fence': {
              const first = yield ctx.prompt.point({ message: 'Specify first fence point' });
              if (first.kind !== 'point') continue;
              const points = yield* fencePoints(ctx, first.point, false);
              await run.measure();
              const done = run.fence(points, w.work);
              if (done.length > 0) history.push(done);
              continue;
            }
            case 'Crossing': {
              const first = yield ctx.prompt.point({ message: 'Specify first corner' });
              if (first.kind !== 'point') continue;
              const done = yield* crossing(ctx, run, first.point, w.work);
              if (done.length > 0) history.push(done);
              continue;
            }
          }
          continue;
        }
        if (a.kind !== 'point') return;
        const work: Work = a.shift ? other(w.work) : w.work;
        const r = await ctx.view.request({ op: 'pick', point: a.point });
        const id = pickTarget(ctx, r.ok ? (r.ids ?? []) : []);
        if (id !== undefined) {
          await run.measure();
          const cs = run.one(id, a.point, work, true);
          if (cs) history.push([cs]);
          continue;
        }
        // A pick on nothing: Quick mode's fence of two points, Standard mode's crossing window.
        let done: ChangeSet[];
        if (s.quick) {
          const points = yield* fencePoints(ctx, a.point, true);
          await run.measure();
          done = run.fence(points, work);
        } else done = yield* crossing(ctx, run, a.point, work, true);
        if (done.length > 0) history.push(done);
      }
    },
  };

  /** "Select cutting edges ...": the objects chosen, all of them on Enter. */
  async function* chooseEdges(ctx: CommandContext, first: boolean): Sub<Edges> {
    ctx.message(w.edges);
    for (;;) {
      const a = yield ctx.prompt.selection({
        message: 'Select objects or',
        ...(first && { options: ['mOde'] }),
        defaultLabel: 'select all',
      });
      if (a.kind === 'keyword' && a.keyword === 'mOde') {
        const m = yield ctx.prompt.keyword({
          message: w.modeMessage,
          options: ['Quick', 'Standard'],
          default: { kind: 'keyword', keyword: s.quick ? 'Quick' : 'Standard' },
        });
        await setQuick(ctx, s, keywordOf(m) === 'Quick');
        if (s.quick) return 'all';
        continue;
      }
      return a.kind === 'selection' && a.ids.length > 0 ? new Set(a.ids) : 'all';
    }
  }
}

/**
 * The rest of a fence after its first point: Quick mode's ends at the second point, Standard
 * mode's Fence at Enter; none when Undo or Enter leaves it a single point.
 */
async function* fencePoints(ctx: CommandContext, first: Vec2, quick: boolean): Sub<Vec2[]> {
  const points = [first];
  for (;;) {
    const a = yield ctx.prompt.point({
      message: 'Specify next fence point or',
      options: ['Undo'],
      // Quick mode's fence starts where a press found nothing; dragged, it is freehand.
      rubberBand: { from: points.at(-1)!, ...(quick && { freehand: true as const }) },
    });
    if (a.kind === 'point' && a.freehand && quick) {
      // The path from where the press began, which is the fence's first point.
      return [first, ...a.freehand.filter((p, i) => i > 0 || distance(p, first) > 0)];
    }
    if (a.kind === 'keyword') {
      if (points.length > 1) points.pop();
      else return [];
      continue;
    }
    if (a.kind !== 'point') return points.length > 1 ? points : [];
    points.push(a.point);
    if (quick) return points;
  }
}

/** A crossing window from `first`: what it trims (extends); nothing on Enter. */
async function* crossing(
  ctx: CommandContext,
  run: Runner,
  first: Vec2,
  work: Work,
  implied = false,
): Sub<ChangeSet[]> {
  const a = yield ctx.prompt.point({
    message: 'Specify opposite corner',
    rubberBand: { from: first, box: true, selection: implied ? 'auto' : 'crossing' },
  });
  if (a.kind !== 'point') return [];
  await run.measure();
  return run.window(first, a.point, work);
}

/** What one TRIM or EXTEND does to the drawing. */
class Runner {
  readonly #ctx: CommandContext;
  readonly #s: TrimSettings;
  readonly #edges: () => Edges;

  constructor(ctx: CommandContext, s: TrimSettings, edges: () => Edges) {
    this.#ctx = ctx;
    this.#s = s;
    this.#edges = edges;
  }

  /** The boxes of the texts among the edges, by `edgeTexts`' keys; null where none is drawn. */
  readonly #boxes = new Map<object, readonly Vec2[] | null>();
  /** The objects whose texts were measured. */
  readonly #measured = new WeakSet<object>();
  /** Each object's edge curves, by its geometry, for each pair of edge options. */
  readonly #curves = new Map<string, WeakMap<object, Curve[]>>();

  /** The edges shown in the space, as objects. */
  #edgeObjects(): Entity[] {
    const model = this.#ctx.model;
    const chosen = this.#edges();
    const ids =
      chosen === 'all'
        ? model.blockEntities(this.#ctx.space)
        : [...chosen].filter((id) => model.entity(id)?.owner === this.#ctx.space);
    return ids.filter((id) => shown(model, id)).map((id) => model.entity(id)!);
  }

  #options(): EdgeOptions {
    // Hatches are edges only when chosen as edges (`edit/trim-edges.ts`).
    return { extend: this.#s.extendEdges, hatches: this.#edges() !== 'all' };
  }

  /**
   * Has the canvas measure the texts among the edges not yet measured (`textOutlines`), so
   * they cut with the boxes they are drawn in. A canvas without fonts measures nothing.
   */
  async measure(): Promise<void> {
    const model = this.#ctx.model;
    const o = this.#options();
    const keys: object[] = [];
    const texts: EdgeText[] = [];
    for (const e of this.#edgeObjects()) {
      if (this.#measured.has(e.geom)) continue;
      this.#measured.add(e.geom);
      for (const t of edgeTexts(model, e, o)) {
        if (this.#boxes.has(t.key)) continue;
        this.#boxes.set(t.key, null);
        keys.push(t.key);
        texts.push(t.text);
      }
    }
    if (texts.length === 0) return;
    const r = await this.#ctx.view.request({ op: 'textOutlines', texts });
    if (!r.ok || !r.outlines) return;
    r.outlines.forEach((outline, i) => {
      if (outline) this.#boxes.set(keys[i]!, outline.corners);
    });
  }

  /** The edge curves, all but `except`'s. */
  #edgeCurves(except: EntityId): Curve[] {
    const model = this.#ctx.model;
    const o = this.#options();
    const k = `${o.extend}/${o.hatches}`;
    let cache = this.#curves.get(k);
    if (!cache) this.#curves.set(k, (cache = new WeakMap()));
    const src = {
      model,
      tol: toleranceFor(model, { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } }),
      textBox: (key: object) => this.#boxes.get(key) ?? undefined,
    };
    const out: Curve[] = [];
    for (const e of this.#edgeObjects()) {
      if (e.id === except) continue;
      let curves = cache.get(e.geom);
      if (!curves) cache.set(e.geom, (curves = objectEdgeCurves(src, e, o)));
      out.push(...curves);
    }
    return out;
  }

  /**
   * What trimming (extending) `id` where `at` is on it makes: the shapes it becomes (none: it
   * goes), or AutoCAD's message for why it cannot be.
   */
  result(id: EntityId, at: Vec2, work: Work): readonly EntityGeometry[] | string {
    const ctx = this.#ctx;
    const e = ctx.model.entity(id);
    const c = e && trimCurveOf(e.geom);
    if (!e || !c)
      return work === 'trim' ? 'Cannot trim that object.' : 'Cannot extend that object.';
    if (locked(ctx.model, id)) return 'The object is on a locked layer.';
    const tol = toleranceFor(ctx.model, c);
    const edges = this.#edgeCurves(id);
    const t = pickParam(c, at, tol);
    if (work === 'extend') {
      const g = extendGeometry(e.geom, c, edges, t, tol);
      return g ? [g] : NO_EDGE;
    }
    const cuts = cutParams(c, edges, tol);
    const geoms = trimGeometry(e.geom, c, cuts, t, tol);
    // Quick mode deletes an object no edge crosses (AutoCAD 2021 and later).
    if (!geoms && this.#s.quick && cuts.length === 0) return [];
    return geoms ?? NO_EDGE;
  }

  /**
   * Trims (extends) `id` where `at` is on it: the edit, or undefined (with AutoCAD's message)
   * when it does nothing. `say` is false for the objects of a fence or window, which pass over
   * what they cannot work on.
   */
  one(id: EntityId, at: Vec2, work: Work, say: boolean): ChangeSet | undefined {
    const ctx = this.#ctx;
    const r = this.result(id, at, work);
    if (typeof r === 'string') {
      if (say) ctx.message(r);
      return undefined;
    }
    return ctx.edit((b) => reshapeObject(b, ctx.model, id, r));
  }

  /**
   * COMMANDPREVIEW (M3-12 part 6): what a pick at the cursor would do, on the object a pick
   * there would take.
   */
  async preview(q: PreviewQuery, work: Work): Promise<CommandPreview | undefined> {
    const id = pickTarget(this.#ctx, q.hits);
    if (id === undefined) return undefined;
    await this.measure();
    const r = this.result(id, q.cursor, work);
    return typeof r === 'string' ? undefined : reshapePreview(this.#ctx.model, [[id, r]]);
  }

  /** The objects that can be trimmed or extended: in the space, shown and not locked. */
  #targets(): { id: EntityId; c: Curve; tol: Tolerance }[] {
    const model = this.#ctx.model;
    const out: { id: EntityId; c: Curve; tol: Tolerance }[] = [];
    for (const id of model.blockEntities(this.#ctx.space)) {
      if (!shown(model, id) || locked(model, id)) continue;
      const c = trimCurveOf(model.entity(id)!.geom);
      if (c) out.push({ id, c, tol: toleranceFor(model, c) });
    }
    return out;
  }

  /**
   * Works on each object at each point of `at` in turn: an object an earlier point cut in two
   * is found again as the piece the point is on (none when that part went).
   */
  #each(at: readonly { id: EntityId; point: Vec2 }[], work: Work): ChangeSet[] {
    const model = this.#ctx.model;
    const now = new Map<EntityId, EntityId[]>();
    const done: ChangeSet[] = [];
    for (const { id, point } of at) {
      const pieces = now.get(id) ?? [id];
      const on = pieces.find((p) => {
        const e = model.entity(p);
        const c = e && trimCurveOf(e.geom);
        if (!c) return false;
        const tol = toleranceFor(model, c);
        return closestPoint(c, point, tol).distance <= tol.linear * 1e3;
      });
      if (on === undefined) continue;
      const before = new Set(model.blockEntities(this.#ctx.space));
      const cs = this.one(on, point, work, false);
      if (!cs) continue;
      done.push(cs);
      const made = model.blockEntities(this.#ctx.space).filter((x) => !before.has(x));
      now.set(id, [...pieces.filter((p) => model.entity(p)), ...made]);
    }
    return done;
  }

  /** A fence: every object it crosses, at each crossing, in the fence's order. */
  fence(points: readonly Vec2[], work: Work): ChangeSet[] {
    if (points.length < 2) return [];
    // A freehand fence has many short segments: each is tried only on the objects whose
    // bounds it reaches.
    const targets = this.#targets().map((t) => ({ ...t, box: curveBounds(t.c, t.tol) }));
    const at: { id: EntityId; point: Vec2; k: number; along: number }[] = [];
    for (let k = 0; k + 1 < points.length; k++) {
      const seg: Curve = { kind: 'LINE', start: points[k]!, end: points[k + 1]! };
      const s = boxOf([seg.start, seg.end]);
      for (const { id, c, tol, box } of targets) {
        const pad = tol.linear;
        if (
          s.minX > box.maxX + pad ||
          s.maxX < box.minX - pad ||
          s.minY > box.maxY + pad ||
          s.maxY < box.minY - pad
        )
          continue;
        for (const x of intersect(seg, c, tol)) at.push({ id, point: x.point, k, along: x.ta });
      }
    }
    at.sort((a, b) => a.k - b.k || a.along - b.along);
    return this.#each(at, work);
  }

  /** A crossing window: each object in it or crossing it, nearest the first corner. */
  window(a: Vec2, b: Vec2, work: Work): ChangeSet[] {
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
    const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
    const inside = (p: Vec2, tol: Tolerance): boolean =>
      p.x >= lo.x - tol.linear &&
      p.x <= hi.x + tol.linear &&
      p.y >= lo.y - tol.linear &&
      p.y <= hi.y + tol.linear;
    const corners = [lo, { x: hi.x, y: lo.y }, hi, { x: lo.x, y: hi.y }];
    const sides: Curve[] = corners.map((p, i) => ({
      kind: 'LINE',
      start: p,
      end: corners[(i + 1) % 4]!,
    }));
    const at: { id: EntityId; point: Vec2; d: number }[] = [];
    for (const { id, c, tol } of this.#targets()) {
      const p = nearestInside(c, sides, a, (q) => inside(q, tol), tol);
      if (p) at.push({ id, point: p, d: distance(p, a) });
    }
    at.sort((x, y) => x.d - y.d);
    return this.#each(at, work);
  }
}

/**
 * The point of `c` inside the window nearest its first corner `a`: where `c` is nearest `a`, if
 * that is inside, else just inside from the window side it crosses nearest `a`; undefined when
 * `c` neither crosses the window nor lies in it.
 */
function nearestInside(
  c: Curve,
  sides: readonly Curve[],
  a: Vec2,
  inside: (p: Vec2) => boolean,
  tol: Tolerance,
): Vec2 | undefined {
  const near = closestPoint(c, a, tol);
  if (inside(near.point)) return near.point;
  const d = domain(c);
  const ts = sides
    .flatMap((side) => intersect(c, side, tol).map((x) => x.ta))
    .sort((x, y) => x - y);
  if (ts.length === 0) return undefined;
  // Between two crossings of the window's sides the curve is wholly inside or outside it.
  const bounds = [
    Number.isFinite(d.start) ? d.start : ts[0]! - 1,
    ...ts,
    Number.isFinite(d.end) ? d.end : ts.at(-1)! + 1,
  ];
  let best: { p: Vec2; d: number } | undefined;
  for (let i = 1; i < bounds.length - 1; i++) {
    const t = bounds[i]!;
    const p = pointAt(c, t);
    for (const other of [bounds[i - 1]!, bounds[i + 1]!]) {
      if (other === t) continue;
      if (!inside(pointAt(c, (t + other) / 2))) continue;
      const q = pointAt(c, t + (other - t) * 1e-6);
      const dd = distance(p, a);
      if (!best || dd < best.d) best = { p: q, d: dd };
    }
  }
  return best?.p;
}
