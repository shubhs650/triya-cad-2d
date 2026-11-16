// HATCH and -HATCH (M4-07 part 1) on the command line, with AutoCAD 2024's prompts (AutoCAD 2024
// Help, "HATCH (Command)", "-HATCH (Command)"):
//   Pick internal point or [Select objects/Undo]:                                       (HATCH)
//   Specify internal point or [Properties/Select objects/Advanced/Origin/Undo]:         (-HATCH)
//   Select objects or [picK internal point/Undo]:
//   Enter a pattern name or [Solid/User defined] <TRIYA_LINES45>:                    (Properties)
//     Specify a scale for the pattern <1.0000>:  Specify an angle for the pattern <0>:
//     Specify angle for crosshatch lines <0>:  Specify spacing between the lines <1.0000>:
//     Double hatch area? [Yes/No] <N>:                                           (User defined)
//   Enter an option [Island detection/Style/Associativity/Gap tolerance/separate Hatches]:
//   [Use current origin/Set new origin] <Use current origin>:  Specify origin point:
//     Store as default origin? [Yes/No] <N>:                                          (Origin)
// Each pick point adds the area around it (edit/hatch-boundary.ts), each Select objects the
// closed objects chosen, previewed; Enter makes one hatch of them all, or one per area with
// separate hatches (HPSEPARATE), as one undo step. The settings are AutoCAD's HP* variables,
// which a drawing does not save; Triya keeps them while the drawing is open, as MATCHPROP keeps
// its settings. Not here yet (later parts of M4-07): the Hatch Creation tab and the Hatch and
// Gradient dialog (seTtings), gradients, draw order (HPDRAWORDER), Retain boundary, Boundary set,
// draW boundary, remove Boundaries, hatch COlor, LAyer and Transparency.
//
// - Hatches are made non-associative: associative hatches wait past launch (DEC-015, PRD
//   non-goal 5), so Associativity Yes is refused.
// - The boundary set is AutoCAD's default, the current viewport: the objects of the space shown
//   that lie in the view, on layers that are on and thawed. Lines, arcs, circles, ellipses,
//   polylines, splines, xlines and rays (cut at the view), what block references draw, regions,
//   and text by its box, which makes it an island. Hatches, dimensions, leaders, multileaders,
//   tables and tolerances are left out: AutoCAD's help does not say whether their lines bound a
//   hatch, and a drafter hatching a part expects its dimensions not to cut the hatch up.
// - The first pattern is TRIYA_LINES45 (45° lines 3 mm apart, the bundled stand-in for AutoCAD's
//   ANSI31 until M4-12), at scale 1, or 1/25.4 in an imperial drawing, as the bundled .pat file
//   says to use its millimetre patterns in inches.
import type { Box } from '../../geom/bounds';
import { boxesOverlap, curveBounds } from '../../geom/bounds';
import type { Curve } from '../../geom/curves';
import type { Vec2 } from '../../geom/types';
import {
  boundaryAt,
  boundaryOfObjects,
  type IslandStyle,
  type PickedBoundary,
} from '../../edit/hatch-boundary';
import {
  edgeTexts,
  objectEdgeCurves,
  type EdgeOptions,
  type EdgeText,
} from '../../edit/trim-edges';
import type { EntityId } from '../../model/entity-ids';
import type { Entity, HatchGeometry, HatchLoop, HatchPatternLine } from '../../model/types';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef } from '../command';
import { toleranceFor } from '../modify/offset';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The HP* settings HATCH starts from. */
interface HatchSettings {
  /** HPNAME: a pattern's name, SOLID, or _USER for user-defined lines. */
  pattern: string;
  /** From the user's own .pat files (DXF 76 = 2). */
  custom: boolean;
  /** HPSCALE. */
  scale: number;
  /** HPANG, radians. */
  angle: number;
  /** HPSPACE: user-defined lines' spacing. */
  spacing: number;
  /** HPDOUBLE. */
  double: boolean;
  /** HPISLANDDETECTION. */
  style: IslandStyle;
  /** HPISLANDDETECTIONMODE. */
  islands: boolean;
  /** HPGAPTOL. */
  gap: number;
  /** HPSEPARATE. */
  separate: boolean;
  /** HPORIGIN. */
  origin: Vec2;
}

const DEFAULT_PATTERN = 'TRIYA_LINES45';
const USER = '_USER';
const SOLID = 'SOLID';
const STYLES: readonly IslandStyle[] = ['normal', 'outer', 'ignore'];
const NOT_FOUND = 'Valid hatch boundary not found.';

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

const keyword = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

/** One area to hatch: its loops, and the point picked in it (none for selected objects). */
interface Area {
  readonly loops: readonly HatchLoop[];
  readonly seed?: Vec2;
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
          ? ['Properties', 'Select objects', 'Advanced', 'Origin', 'Undo']
          : ['Select objects', 'Undo'];
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
        else if (k === 'Advanced') yield* advanced(ctx, s);
        else if (k === 'Origin') run.origin = (yield* origin(ctx, s)) ?? run.origin;
        else return run.finish();
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
  };
}

/** One HATCH: the areas found so far and the pattern they are filled with. */
class HatchRun {
  readonly #areas: Area[] = [];
  /** The pattern's lines, placed for `#placed`. */
  #lines: readonly HatchPatternLine[] | undefined;
  #placed = '';
  origin: Vec2;

  constructor(
    readonly ctx: CommandContext,
    readonly s: HatchSettings,
  ) {
    this.origin = s.origin;
  }

  /** The boundary set's curves: what the view shows of the space (see the head comment). */
  async #curves(): Promise<{ curves: Curve[]; view: Box | undefined }> {
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
    const objects = model
      .blockEntities(ctx.space)
      .map((id) => model.entity(id))
      .filter(
        (e): e is Entity => e !== undefined && shown(ctx, e) && !NOT_BOUNDARIES.has(e.geom.kind),
      );
    const boxes = await this.#textBoxes(objects);
    const tol = toleranceFor(model, {
      kind: 'XLINE',
      base: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    });
    const src = { model, tol, textBox: (key: object) => boxes.get(key) };
    const curves: Curve[] = [];
    for (const e of objects) {
      for (const c of objectEdgeCurves(src, e, EDGES)) {
        const unbounded = c.kind === 'XLINE' || c.kind === 'RAY';
        if (!view || unbounded || boxesOverlap(curveBounds(c, tol), view, 0)) curves.push(c);
      }
    }
    return { curves, view };
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

  #options() {
    const s = this.s;
    return { style: s.islands ? s.style : ('ignore' as const), gap: s.gap };
  }

  async pick(point: Vec2): Promise<void> {
    const { curves, view } = await this.#curves();
    const found: PickedBoundary | undefined = boundaryAt(curves, point, this.#options(), view);
    if (!found) {
      this.ctx.message(NOT_FOUND);
      return;
    }
    this.#areas.push({ loops: found.loops, seed: point });
  }

  select(ids: readonly EntityId[]): void {
    const { ctx } = this;
    const tol = toleranceFor(ctx.model, {
      kind: 'XLINE',
      base: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    });
    const objects = ids.flatMap((id) => {
      const e = ctx.model.entity(id);
      return e ? [objectEdgeCurves({ model: ctx.model, tol }, e, EDGES)] : [];
    });
    const loops = boundaryOfObjects(objects, this.#options());
    if (loops.length === 0) {
      ctx.message(NOT_FOUND);
      return;
    }
    this.#areas.push({ loops });
  }

  undo(): void {
    if (this.#areas.pop() === undefined)
      this.ctx.message('All selected objects have been removed.');
  }

  /** The pattern's lines at the settings' placement, from the app's library; undefined if none. */
  async #patternLines(): Promise<readonly HatchPatternLine[] | undefined> {
    const s = this.s;
    if (s.pattern === SOLID) return [];
    if (s.pattern === USER) return userLines(s.angle, s.spacing, s.double, this.origin);
    const key = JSON.stringify([s.pattern, s.scale, s.angle, this.origin]);
    if (this.#placed === key && this.#lines) return this.#lines;
    const r = await this.ctx.view.request({
      op: 'hatchPattern',
      name: s.pattern,
      placements: [{ angle: s.angle, scale: s.scale, origin: this.origin }],
    });
    if (!r.ok || !r.pattern) {
      this.ctx.message(r.ok ? `Pattern "${s.pattern}" is not in the pattern library.` : r.message);
      return undefined;
    }
    this.#placed = key;
    this.#lines = r.pattern.lines[0] ?? [];
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
      seedPoints: areas.flatMap((a) => (a.seed ? [a.seed] : [])),
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

  async finish(): Promise<void> {
    this.ctx.preview([]);
    if (this.#areas.length === 0) return;
    const lines = await this.#patternLines();
    if (!lines) return;
    const groups = this.s.separate ? this.#areas.map((a) => [a]) : [this.#areas];
    const { ctx } = this;
    ctx.edit((b) => {
      for (const g of groups) {
        b.addEntity({ owner: ctx.space, ...currentProps(ctx.model), geom: this.#hatch(g, lines) });
      }
    });
  }
}

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

/** -HATCH Properties: the pattern and its scale and angle, or user-defined lines. */
async function* properties(ctx: CommandContext, s: HatchSettings): Sub<void> {
  for (;;) {
    const current = s.pattern === USER ? 'U' : s.pattern;
    const a = yield ctx.prompt.string({
      message: 'Enter a pattern name or',
      options: ['Solid', 'User defined'],
      defaultLabel: current,
    });
    const k = keyword(a);
    if (k === 'Solid') {
      s.pattern = SOLID;
      s.custom = false;
      return;
    }
    if (k === 'User defined') {
      s.angle = yield* angle(ctx, 'Specify angle for crosshatch lines', s.angle);
      s.spacing = yield* positive(ctx, 'Specify spacing between the lines', s.spacing);
      s.double = yield* yesNo(ctx, 'Double hatch area?', s.double);
      s.pattern = USER;
      s.custom = false;
      return;
    }
    const name = a.kind === 'string' ? a.value.trim() : s.pattern;
    if (name === '' || name.toUpperCase() === SOLID || name.toUpperCase() === USER) return;
    // The library says whether it knows the name, and how its file spells it.
    const r = await ctx.view.request({
      op: 'hatchPattern',
      name,
      placements: [{ angle: 0, scale: 1, origin: { x: 0, y: 0 } }],
    });
    if (!r.ok || !r.pattern) {
      ctx.message(r.ok ? `Pattern "${name}" is not in the pattern library.` : r.message);
      continue;
    }
    s.pattern = r.pattern.name;
    s.custom = r.pattern.custom;
    s.scale = yield* positive(ctx, 'Specify a scale for the pattern', s.scale);
    s.angle = yield* angle(ctx, 'Specify an angle for the pattern', s.angle);
    return;
  }
}

async function* angle(ctx: CommandContext, message: string, current: number): Sub<number> {
  const a = yield ctx.prompt.angle({ message, default: { kind: 'angle', value: current } });
  return a.kind === 'angle' ? a.value : current;
}

async function* positive(ctx: CommandContext, message: string, current: number): Sub<number> {
  for (;;) {
    const a = yield ctx.prompt.real({ message, default: { kind: 'number', value: current } });
    if (a.kind !== 'number') return current;
    if (a.value > 0) return a.value;
    ctx.message('Value must be positive and nonzero.');
  }
}

async function* yesNo(ctx: CommandContext, message: string, current: boolean): Sub<boolean> {
  const a = yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    defaultLabel: current ? 'Y' : 'N',
  });
  const k = keyword(a);
  return k === undefined ? current : k === 'Yes';
}

/** -HATCH Advanced: island detection and style, associativity, gap tolerance, separate hatches. */
async function* advanced(ctx: CommandContext, s: HatchSettings): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options: ['Island detection', 'Style', 'Associativity', 'Gap tolerance', 'separate Hatches'],
    });
    switch (keyword(a)) {
      case 'Island detection':
        s.islands = yield* yesNo(ctx, 'Do you want island detection?', s.islands);
        break;
      case 'Style': {
        const names = ['Ignore', 'Outer', 'Normal'];
        const b = yield ctx.prompt.keyword({
          message: 'Enter island detection style',
          options: names,
          default: { kind: 'keyword', keyword: names[2 - STYLES.indexOf(s.style)]! },
        });
        const k = keyword(b);
        if (k) s.style = STYLES[2 - names.indexOf(k)]!;
        break;
      }
      case 'Associativity':
        if (yield* yesNo(ctx, 'Do you want associativity?', false)) {
          ctx.message('Triya makes non-associative hatches.');
        }
        break;
      case 'Gap tolerance': {
        const b = yield ctx.prompt.real({
          message: 'Specify a boundary gap tolerance value',
          default: { kind: 'number', value: s.gap },
        });
        if (b.kind === 'number') {
          // HPGAPTOL: "Valid values are from 0 to 5000".
          if (b.value < 0 || b.value > 5000) ctx.message('Value must be between 0 and 5000.');
          else s.gap = b.value;
        }
        break;
      }
      case 'separate Hatches':
        s.separate = yield* yesNo(ctx, 'Create separate hatches?', s.separate);
        break;
      default:
        return;
    }
  }
}

/** -HATCH Origin: this hatch's pattern origin, stored as HPORIGIN when asked. */
async function* origin(ctx: CommandContext, s: HatchSettings): Sub<Vec2 | undefined> {
  const a = yield ctx.prompt.keyword({
    message: '',
    options: ['Use current origin', 'Set new origin'],
    default: { kind: 'keyword', keyword: 'Use current origin' },
  });
  if (keyword(a) !== 'Set new origin') return undefined;
  const p = yield ctx.prompt.point({ message: 'Specify origin point' });
  if (p.kind !== 'point') return undefined;
  if (yield* yesNo(ctx, 'Store as default origin?', false)) s.origin = p.point;
  return p.point;
}
