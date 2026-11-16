// HATCH and -HATCH (M4-07) on the command line, with AutoCAD 2024's prompts (AutoCAD 2024
// Help, "HATCH (Command)", "-HATCH (Command)"; the option prompts are in hatch-options.ts):
//   Pick internal point or [Select objects/remove Boundaries/Undo]:                     (HATCH)
//   Specify internal point or [Properties/Select objects/draW boundary/remove Boundaries/
//     Advanced/DRaw order/Origin/hatch COlor/LAyer/Transparency/Undo]:                  (-HATCH)
//   Select objects or [picK internal point/Undo]:
//   Select objects or [Add boundaries]:                                      (remove Boundaries)
//   Retain polyline boundary? [Yes/No] <N>:  Specify start point:
//     Specify next point or [Arc/Length/Undo]:
//     Specify start point for new island boundary or <apply hatch>:          (draW boundary)
// Each pick point adds the area around it (edit/hatch-boundary.ts), each Select objects the
// closed objects chosen, previewed; Enter makes one hatch of them all, or one per area with
// separate hatches (HPSEPARATE), as one undo step. remove Boundaries takes islands back out of
// the areas found (an area's outer boundary stays, as AutoCAD keeps it). draW boundary hatches
// a boundary drawn point by point (with PLINE's arcs, as AREA draws them), each further one an
// island, and makes the hatch at once ("apply hatch").
// A new hatch goes behind its boundary unless DRaw order (HPDRAWORDER) says otherwise; its
// boundary is the objects its loops lie along (and the ones it keeps). Retain boundary keeps
// what pick points found as polylines (edit/hatch-retain.ts) on the current layer, as BOUNDARY
// makes them; draW boundary keeps its polylines when asked. Not here yet (later parts of
// M4-07): the Hatch Creation tab and the Hatch and Gradient dialog (seTtings), gradients,
// HATCHEDIT, and a hatch's background colour.
//
// - Hatches are made non-associative: associative hatches wait past launch (DEC-015, PRD
//   non-goal 5), so Associativity Yes is refused.
// - The boundary set is AutoCAD's default, the current viewport: the objects of the space shown
//   that lie in the view, on layers that are on and thawed; or the objects Advanced's Boundary
//   set chose (New). Lines, arcs, circles, ellipses, polylines, splines, xlines and rays (cut at
//   the view), what block references draw, regions, and text by its box, which makes it an
//   island. Hatches, dimensions, leaders, multileaders, tables and tolerances are left out:
//   AutoCAD's help does not say whether their lines bound a hatch, and a drafter hatching a
//   part expects its dimensions not to cut the hatch up.
// - The first pattern is TRIYA_LINES45 (45° lines 3 mm apart, the bundled stand-in for AutoCAD's
//   ANSI31 until M4-12), at scale 1, or 1/25.4 in an imperial drawing, as the bundled .pat file
//   says to use its millimetre patterns in inches.
// - LAyer names a layer the drawing may not have yet: the hatch makes it, as AutoCAD's HPLAYER
//   does ("Values that are not already defined in the drawing will create a new layer").
import type { Box } from '../../geom/bounds';
import { boxesOverlap, curveBounds } from '../../geom/bounds';
import type { Curve } from '../../geom/curves';
import type { Vec2 } from '../../geom/types';
import { moveInDrawOrder, type DrawOrderMove } from '../../edit/draw-order';
import {
  boundaryAt,
  boundaryOfObjects,
  type BoundaryOptions,
  type PickedBoundary,
} from '../../edit/hatch-boundary';
import { retainedBoundary } from '../../edit/hatch-retain';
import {
  edgeTexts,
  objectEdgeCurves,
  type EdgeOptions,
  type EdgeText,
} from '../../edit/trim-edges';
import type { ChangeSetBuilder } from '../../model/builder';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type {
  Entity,
  EntityGeometry,
  HatchGeometry,
  HatchLoop,
  HatchPatternLine,
  PolylineVertex,
} from '../../model/types';
import { currentProps, currentTransparency } from '../../properties/current';
import type { GeneralProps } from '../../properties/sheet';
import type { CommandContext, CommandDef } from '../command';
import { nextPoints } from '../inquiry/inquiry';
import { toleranceFor } from '../modify/offset';
import {
  HPTRANSPARENCY,
  SOLID,
  STYLES,
  USER,
  USE_CURRENT,
  advanced,
  drawOrder,
  hatchColor,
  hatchLayer,
  hatchTransparency,
  keyword,
  origin,
  placed,
  properties,
  yesNo,
  type HatchSettings,
  type Sub,
} from './hatch-options';

const DEFAULT_PATTERN = 'TRIYA_LINES45';
const NOT_FOUND = 'Valid hatch boundary not found.';

/** DXF 92 bits. */
const EXTERNAL = 1;
const POLYLINE = 2;
const OUTERMOST = 16;

/** Objects that bound no hatch (see the head comment). */
const NOT_BOUNDARIES = new Set([
  'HATCH',
  'DIMENSION',
  'ARC_DIMENSION',
  'LARGE_RADIAL_DIMENSION',
  'LEADER',
  'MULTILEADER',
  'TOLERANCE',
  'ACAD_TABLE',
  'VIEWPORT',
]);

const EDGES: EdgeOptions = { extend: false, hatches: false };

/**
 * One area to hatch: its loops and the objects each lies along; a picked area the point picked
 * in it, a selected one the objects chosen, a drawn one the polylines it keeps.
 */
type Area = { readonly loops: readonly HatchLoop[]; readonly sources: readonly EntityId[][] } & (
  | { readonly kind: 'pick'; readonly seed: Vec2 }
  | { readonly kind: 'select'; readonly ids: readonly EntityId[] }
  | { readonly kind: 'drawn'; readonly keep: readonly EntityGeometry[] }
);

/** The boundary set's curves, each with the object it is part of. */
interface Candidates {
  readonly curves: Curve[];
  readonly owners: EntityId[];
  readonly view: Box | undefined;
}

export function hatchCommand(): CommandDef {
  let settings: HatchSettings | undefined;
  return {
    name: 'HATCH',
    dashVariant: true,
    async *run(ctx) {
      settings ??= initialSettings(ctx);
      const s = settings;
      const run = new HatchRun(ctx, s);
      const options = (): string[] =>
        ctx.dash
          ? [
              'Properties',
              'Select objects',
              'draW boundary',
              'remove Boundaries',
              'Advanced',
              'DRaw order',
              'Origin',
              'hatch COlor',
              'LAyer',
              'Transparency',
              'Undo',
            ]
          : run.empty
            ? ['Select objects', 'Undo']
            : ['Select objects', 'remove Boundaries', 'Undo'];
      let selecting = false;
      for (;;) {
        await run.preview();
        if (selecting) {
          const a = yield ctx.prompt.selection({
            message: 'Select objects or',
            options: ['picK internal point', 'Undo'],
          });
          const k = keyword(a);
          if (k === 'picK internal point') selecting = false;
          else if (k === 'Undo') run.undo();
          else if (a.kind === 'selection' && a.ids.length > 0) run.select(a.ids);
          else return run.finish();
          continue;
        }
        const a = yield ctx.prompt.point({
          message: ctx.dash ? 'Specify internal point or' : 'Pick internal point or',
          options: options(),
        });
        const k = keyword(a);
        if (a.kind === 'point') await run.pick(a.point);
        else if (k === 'Select objects') selecting = true;
        else if (k === 'Undo') run.undo();
        else if (k === 'Properties') yield* properties(ctx, s);
        else if (k === 'Advanced') yield* advanced(ctx, s, run);
        else if (k === 'Origin') run.origin = (yield* origin(ctx, s)) ?? run.origin;
        else if (k === 'DRaw order') yield* drawOrder(ctx, s);
        else if (k === 'hatch COlor') yield* hatchColor(ctx, s);
        else if (k === 'LAyer') yield* hatchLayer(ctx, s);
        else if (k === 'Transparency') {
          const t = yield* hatchTransparency(ctx, run.transparency());
          // A system variable the drawing keeps, set at once as SETVAR would.
          if (t !== undefined) ctx.edit((b) => b.setHeader(HPTRANSPARENCY, t));
        } else if (k === 'remove Boundaries') yield* removeBoundaries(ctx, run);
        else if (k === 'draW boundary') {
          if (yield* drawBoundary(ctx, run)) return run.finish();
        } else return run.finish();
      }
    },
  };
}

function initialSettings(ctx: CommandContext): HatchSettings {
  const m = ctx.model.header.get('$MEASUREMENT');
  const imperial = typeof m === 'number' ? m === 0 : ctx.model.meta.measurement === 'imperial';
  return {
    pattern: DEFAULT_PATTERN,
    custom: false,
    scale: imperial ? 1 / 25.4 : 1,
    angle: 0,
    spacing: 1,
    double: false,
    style: 'normal',
    islands: true,
    gap: 0,
    separate: false,
    origin: { x: 0, y: 0 },
    drawOrder: 'behind',
    color: undefined,
    layer: undefined,
    retain: false,
  };
}

/** One HATCH: the areas found so far and the pattern they are filled with. */
class HatchRun {
  readonly #areas: Area[] = [];
  /** The pattern's lines, placed for `#placed`. */
  #lines: readonly HatchPatternLine[] | undefined;
  #placed = '';
  origin: Vec2;
  /** Advanced's Boundary set: the only objects boundaries are found among. */
  boundarySet: readonly EntityId[] | undefined;
  constructor(
    readonly ctx: CommandContext,
    readonly s: HatchSettings,
  ) {
    this.origin = s.origin;
  }

  /** HPTRANSPARENCY as the drawing has it. */
  transparency(): string {
    const t = this.ctx.model.header.get(HPTRANSPARENCY);
    return typeof t === 'string' || typeof t === 'number' ? String(t) : USE_CURRENT;
  }

  get empty(): boolean {
    return this.#areas.length === 0;
  }

  /** The boundary set's curves: what the view shows of the space (see the head comment). */
  async #candidates(): Promise<Candidates> {
    const { ctx } = this;
    const model = ctx.model;
    const r = await ctx.view.request({ op: 'get' });
    const view: Box | undefined =
      r.ok && r.view
        ? {
            minX: r.view.center.x - r.view.width / 2,
            minY: r.view.center.y - r.view.height / 2,
            maxX: r.view.center.x + r.view.width / 2,
            maxY: r.view.center.y + r.view.height / 2,
          }
        : undefined;
    const objects = (this.boundarySet ?? model.blockEntities(ctx.space))
      .map((id) => model.entity(id))
      .filter(
        (e): e is Entity => e !== undefined && shown(ctx, e) && !NOT_BOUNDARIES.has(e.geom.kind),
      );
    const boxes = await this.#textBoxes(objects);
    const tol = tolerance(ctx);
    const src = { model, tol, textBox: (key: object) => boxes.get(key) };
    const curves: Curve[] = [];
    const owners: EntityId[] = [];
    // A boundary set chosen is taken whole; the view's is what lies in it.
    const cull = this.boundarySet ? undefined : view;
    for (const e of objects) {
      for (const c of objectEdgeCurves(src, e, EDGES)) {
        const unbounded = c.kind === 'XLINE' || c.kind === 'RAY';
        if (!cull || unbounded || boxesOverlap(curveBounds(c, tol), cull, 0)) {
          curves.push(c);
          owners.push(e.id);
        }
      }
    }
    return { curves, owners, view };
  }

  /** The boxes the texts among `objects` are drawn in, as the canvas measures them. */
  async #textBoxes(objects: readonly Entity[]): Promise<Map<object, readonly Vec2[]>> {
    const keys: object[] = [];
    const texts: EdgeText[] = [];
    for (const e of objects) {
      for (const t of edgeTexts(this.ctx.model, e, EDGES)) {
        keys.push(t.key);
        texts.push(t.text);
      }
    }
    const out = new Map<object, readonly Vec2[]>();
    if (texts.length === 0) return out;
    const r = await this.ctx.view.request({ op: 'textOutlines', texts });
    if (r.ok && r.outlines) r.outlines.forEach((o, i) => o && out.set(keys[i]!, o.corners));
    return out;
  }

  #options(): BoundaryOptions {
    const s = this.s;
    return { style: s.islands ? s.style : 'ignore', gap: s.gap };
  }

  /** The area around `seed` among the candidates, leaving out the objects `without` names. */
  #areaAt(c: Candidates, seed: Vec2, without?: ReadonlySet<EntityId>): Area | undefined {
    const keep = c.curves.flatMap((_, i) => (without?.has(c.owners[i]!) ? [] : [i]));
    const found: PickedBoundary | undefined = boundaryAt(
      keep.map((i) => c.curves[i]!),
      seed,
      this.#options(),
      c.view,
    );
    if (!found) return undefined;
    const sources = found.sources.map((loop) => [...new Set(loop.map((i) => c.owners[keep[i]!]!))]);
    return { kind: 'pick', seed, loops: found.loops, sources };
  }

  async pick(point: Vec2): Promise<void> {
    const area = this.#areaAt(await this.#candidates(), point);
    if (!area) this.ctx.message(NOT_FOUND);
    else this.#areas.push(area);
  }

  #selected(ids: readonly EntityId[]): Area | undefined {
    const { ctx } = this;
    const tol = tolerance(ctx);
    const objects = ids.map((id) =>
      objectEdgeCurves({ model: ctx.model, tol }, ctx.model.entity(id)!, EDGES),
    );
    const loops = boundaryOfObjects(objects, this.#options());
    if (loops.length === 0) return undefined;
    // Only an object of one closed curve makes a loop, so a loop's object is the one whose
    // curve it outlines; the loops keep the order the objects were given in.
    const closed = ids.filter((_, i) => objects[i]!.length === 1);
    return { kind: 'select', ids, loops, sources: [closed] };
  }

  select(ids: readonly EntityId[]): void {
    const area = this.#selected(ids);
    if (!area) this.ctx.message(NOT_FOUND);
    else this.#areas.push(area);
  }

  /** A boundary drawn (draW boundary): its loops and the polylines kept. */
  addDrawn(loops: readonly HatchLoop[], keep: readonly EntityGeometry[]): void {
    this.#areas.push({ kind: 'drawn', loops, keep, sources: [] });
  }

  /**
   * remove Boundaries: each area found again without the objects removed, its outer boundary
   * kept; a selected area without them, dropped when none of its objects is left.
   */
  async remove(ids: readonly EntityId[]): Promise<void> {
    const removed = new Set(ids);
    let candidates: Candidates | undefined;
    for (let i = this.#areas.length - 1; i >= 0; i--) {
      const area = this.#areas[i]!;
      if (area.kind === 'select') {
        const left = area.ids.filter((id) => !removed.has(id));
        if (left.length === area.ids.length) continue;
        const again = this.#selected(left);
        if (again) this.#areas[i] = again;
        else this.#areas.splice(i, 1);
      } else if (area.kind === 'pick') {
        const outer = new Set(area.sources[0]);
        const without = new Set(ids.filter((id) => !outer.has(id)));
        if (!area.sources.slice(1).some((loop) => loop.some((id) => without.has(id)))) continue;
        candidates ??= await this.#candidates();
        this.#areas[i] = this.#areaAt(candidates, area.seed, without) ?? area;
      }
    }
  }

  undo(): void {
    this.#areas.pop();
  }

  /** The pattern's lines at the settings' placement, from the app's library; undefined if none. */
  async #patternLines(): Promise<readonly HatchPatternLine[] | undefined> {
    const s = this.s;
    if (s.pattern === SOLID) return [];
    if (s.pattern === USER) return userLines(s.angle, s.spacing, s.double, this.origin);
    const key = JSON.stringify([s.pattern, s.scale, s.angle, this.origin]);
    if (this.#placed === key && this.#lines) return this.#lines;
    const p = await placed(this.ctx, s.pattern, {
      angle: s.angle,
      scale: s.scale,
      origin: this.origin,
    });
    if (!p) return undefined;
    this.#placed = key;
    this.#lines = p.lines[0]!;
    return this.#lines;
  }

  #hatch(areas: readonly Area[], lines: readonly HatchPatternLine[]): HatchGeometry {
    const s = this.s;
    const solid = s.pattern === SOLID;
    const user = s.pattern === USER;
    return {
      kind: 'HATCH',
      pattern: s.pattern,
      solid,
      associative: false,
      style: s.islands ? STYLES.indexOf(s.style) : 2,
      patternType: user ? 0 : s.custom ? 2 : 1,
      patternAngle: solid ? 0 : s.angle,
      patternScale: solid ? 0 : user ? s.spacing : s.scale,
      double: user && s.double,
      loops: areas.flatMap((a) => a.loops),
      patternLines: lines,
      seedPoints: areas.flatMap((a) => (a.kind === 'pick' ? [a.seed] : [])),
    };
  }

  async preview(): Promise<void> {
    if (this.#areas.length === 0) {
      this.ctx.preview([]);
      return;
    }
    const lines = await this.#patternLines();
    this.ctx.preview(lines ? [this.#hatch(this.#areas, lines)] : []);
  }

  /** The properties a new hatch takes: the current ones, as COlor, LAyer and Transparency say. */
  #props(b: ChangeSetBuilder): GeneralProps {
    const { ctx, s } = this;
    const props = currentProps(ctx.model);
    const t = this.transparency();
    return {
      ...props,
      ...(s.color && { color: s.color }),
      ...(s.layer !== undefined && { layer: hatchLayerRecord(b, ctx, s.layer) }),
      ...(t !== USE_CURRENT && t !== '.' && { transparency: currentTransparency(t) }),
    };
  }

  async finish(): Promise<void> {
    this.ctx.preview([]);
    if (this.#areas.length === 0) return;
    const lines = await this.#patternLines();
    if (!lines) return;
    const groups = this.s.separate ? this.#areas.map((a) => [a]) : [this.#areas];
    const { ctx, s } = this;
    ctx.edit((b) => {
      const props = this.#props(b);
      const current = currentProps(ctx.model);
      for (const g of groups) {
        // The boundaries kept go on the current layer, as BOUNDARY puts them.
        const kept = g
          .flatMap((a) =>
            a.kind === 'drawn'
              ? a.keep
              : a.kind === 'pick' && s.retain
                ? a.loops.flatMap(retainedBoundary)
                : [],
          )
          .map((geom) => b.addEntity({ owner: ctx.space, ...current, geom }).id);
        const hatch = b.addEntity({ owner: ctx.space, ...props, geom: this.#hatch(g, lines) });
        const reference = [...new Set([...g.flatMap((a) => a.sources.flat()), ...kept])];
        const move = placement(s.drawOrder, reference);
        if (move) moveInDrawOrder(b, ctx.model, [hatch.id], move);
      }
    });
  }
}

/** Where HPDRAWORDER puts a new hatch, or undefined where it is drawn anyway (on top). */
function placement(
  order: HatchSettings['drawOrder'],
  reference: readonly EntityId[],
): DrawOrderMove | undefined {
  switch (order) {
    case 'back':
      return { to: 'back' };
    case 'behind':
      return { to: 'under', reference };
    case 'above':
      return { to: 'above', reference };
    default:
      return undefined;
  }
}

/** The layer HPLAYER names, made (as layer 0 is, colour 7) when the drawing has none. */
function hatchLayerRecord(b: ChangeSetBuilder, ctx: CommandContext, name: string): Handle {
  const u = name.toUpperCase();
  let zero: Handle | undefined;
  for (const l of ctx.model.tables.layers.values()) {
    if (l.name.toUpperCase() === u) return l.handle;
    if (l.name === '0') zero = l.handle;
  }
  // Every drawing has a layer 0 (`currentLayer` refuses one without).
  const z = b.tableRecord('layers', zero!)!;
  return b.addTableRecord('layers', {
    name,
    color: { kind: 'aci', index: 7 },
    linetype: z.linetype,
    lineweight: 'Default',
    transparency: z.transparency,
    plot: true,
    on: true,
    frozen: false,
    locked: false,
  }).handle;
}

/** remove Boundaries: the objects picked come out of the areas, until Enter or Add boundaries. */
async function* removeBoundaries(ctx: CommandContext, run: HatchRun): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: 'Select objects or',
      options: ['Add boundaries'],
    });
    if (a.kind !== 'selection' || a.ids.length === 0) return;
    await run.remove(a.ids);
    await run.preview();
  }
}

/**
 * draW boundary: a boundary drawn point by point, then islands; true at "apply hatch", false
 * when no start point is given for the first.
 */
async function* drawBoundary(ctx: CommandContext, run: HatchRun): Sub<boolean> {
  const keep = yield* yesNo(ctx, 'Retain polyline boundary?', false);
  const loops: HatchLoop[] = [];
  const kept: EntityGeometry[] = [];
  for (;;) {
    const first = loops.length === 0;
    const a = yield first
      ? ctx.prompt.point({ message: 'Specify start point' })
      : ctx.prompt.point({
          message: 'Specify start point for new island boundary or',
          defaultLabel: 'apply hatch',
        });
    if (a.kind !== 'point') {
      if (first) return false;
      run.addDrawn(loops, kept);
      return true;
    }
    // Esc cancels the command; nothing else ends the path without its points.
    const path = (yield* nextPoints(ctx, a.point, { prefix: '', closed: true, total: false }))!;
    const vertices: PolylineVertex[] = path.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));
    // A path ending where it began closes there.
    const last = vertices.at(-1)!;
    if (vertices.length > 1 && last.x === vertices[0]!.x && last.y === vertices[0]!.y) {
      vertices.pop();
    }
    if (vertices.length < 3 && !vertices.some((v) => v.bulge !== 0)) {
      ctx.message(NOT_FOUND);
      continue;
    }
    loops.push({
      flags: POLYLINE | (first ? EXTERNAL : OUTERMOST),
      polyline: { vertices, closed: true },
    });
    if (keep) kept.push({ kind: 'LWPOLYLINE', closed: true, vertices });
  }
}

const tolerance = (ctx: CommandContext) =>
  toleranceFor(ctx.model, { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } });

/** On a layer that is on and thawed, and not made invisible. */
function shown(ctx: CommandContext, e: Entity): boolean {
  if (!e.visible) return false;
  const l = ctx.model.tables.layers.get(e.layer);
  return !l || (l.on && !l.frozen);
}

/**
 * User-defined lines (DXF 76 = 0): continuous lines at the angle, `spacing` apart, a second
 * family at 90° when doubled (as the hatch package's `userDefinedLines`).
 */
function userLines(
  angle: number,
  spacing: number,
  double: boolean,
  origin: Vec2,
): HatchPatternLine[] {
  const family = (a: number): HatchPatternLine => ({
    angle: a,
    base: origin,
    offset: { x: -Math.sin(a) * spacing, y: Math.cos(a) * spacing },
    dashes: [],
  });
  return double ? [family(angle), family(angle + Math.PI / 2)] : [family(angle)];
}
