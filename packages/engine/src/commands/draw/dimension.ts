// DIMLINEAR, DIMALIGNED, DIMRADIUS, DIMDIAMETER, DIMANGULAR, DIMCONTINUE and DIMBASELINE
// (M2-11), with AutoCAD 2024's prompts (AutoCAD 2024 Help, "DIMLINEAR (Command)" and the
// others):
//   Specify first extension line origin or <select object>:
//   Specify second extension line origin:
//   Specify dimension line location or [Mtext/Text/Angle/Horizontal/Vertical/Rotated]:
//   Dimension text = 10.0000
// DIMRADIUS and DIMDIAMETER: "Select arc or circle:"; DIMANGULAR: "Select arc, circle, line, or
// <specify vertex>:"; DIMCONTINUE and DIMBASELINE: "Specify a second extension line origin or
// [Undo/Select] <Select>:", from the last dimension made, or the one selected.
//
// M2-31 added DIMLINEAR and DIMALIGNED on a selected circle, DIMANGULAR's Quadrant, DIMCONTINUE
// and DIMBASELINE from an ordinate ("Specify feature location or [Undo/Select] <Select>:") or a
// two-line angular dimension, and the header's DIMVARs that differ from the current style as a
// new dimension's `DSTYLE` overrides (`headerDimensionXdata`).
//
// A dimension is made when its location is given, with the current dimension style (DIMSTYLE)
// on the current layer, and drawn by the dimension engine (`ctx.dimensions`) into a `*D` block
// of its own, as AutoCAD writes it. It is not associative (DIMASSOC 1): its definition points
// are where the picks put them, and its grips move them (edit/grips.ts). Where the placement
// rules come from is in edit/dimension.ts.
import type { Vec2 } from '../../geom/types';
import {
  add,
  angleOf,
  distance,
  dot,
  fromAngle,
  length,
  midpoint,
  perp,
  scale,
  sub,
} from '../../geom/vec';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { DimensionGeometry, Entity, EntityGeometry, Xdata } from '../../model/types';
import { dstyleOverrides } from '../../annotation/leader';
import { withDimvarOverride } from '../../annotation/dstyle';
import {
  angularAsThreePoint,
  baselineSpacing,
  currentDimStyle,
  dimensionDirection,
  headerDimensionXdata,
  newDimension,
  placeDimension,
  type DimPlacement,
  type NewDimension,
} from '../../edit/dimension';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { regenerateDimensions } from '../modify/dimensions';
import { currentLayer } from './line';
import { dimensionOverride, dimensionTextEditor } from './text';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
type Linear = Extract<DimensionGeometry, { dimType: 'linear' | 'aligned' }>;
type Angular3 = Extract<DimensionGeometry, { dimType: 'angular3pt' }>;
type Ordinate = Extract<DimensionGeometry, { dimType: 'ordinate' }>;

/** The dimension DIMCONTINUE and DIMBASELINE start from: the last one made, per drawing. */
interface DimensionState {
  last: Handle | undefined;
}

const unitOf = (v: Vec2): Vec2 | undefined => {
  const l = length(v);
  return l > 0 ? scale(v, 1 / l) : undefined;
};

/** The style a new dimension is made in, and the overrides it is made with. */
interface NewStyle {
  readonly handle: Handle;
  readonly xdata?: Xdata;
}

/**
 * The current dimension style, with the header's DIMVARs that differ from it as overrides;
 * undefined (and said) in a drawing without one.
 */
function currentStyle(ctx: CommandContext): NewStyle | undefined {
  const style = currentDimStyle(ctx.model);
  if (!style) {
    ctx.message('The drawing has no dimension style.');
    return undefined;
  }
  const xdata = headerDimensionXdata(ctx.model, style);
  return { handle: style.handle, ...(xdata && { xdata }) };
}

/**
 * The style a dimension going on from `base` is made in: the base's, with its overrides, as
 * AutoCAD's default DIMCONTINUEMODE 1 has it ("the dimension style of the selected base
 * dimension is used"; AutoCAD 2024 Help, DIMCONTINUEMODE).
 */
function styleOf(ctx: CommandContext, base: Entity): NewStyle {
  const g = base.geom as DimensionGeometry;
  let e: { readonly xdata?: Xdata } = {};
  for (const [name, value] of Object.entries(dstyleOverrides(base.xdata, ctx.model))) {
    const x = withDimvarOverride(e, g.style, ctx.model, name, value);
    if (x === 'no-acad') break;
    e = x === undefined ? {} : { xdata: x };
  }
  return { handle: g.style, ...(e.xdata && { xdata: e.xdata }) };
}

/** What a dimension measures, formatted, as the dimension engine shows it. */
function measurementOf(
  ctx: CommandContext,
  geom: DimensionGeometry,
  xdata: Xdata | undefined,
): string | undefined {
  const probe = { geom, ...(xdata && { xdata }) } as Entity;
  return ctx.dimensions?.(probe, ctx.model, () => 0)?.measurement;
}

/** The point of a circle nearest `p`. */
const onCircle = (c: Vec2, r: number, p: Vec2): Vec2 =>
  add(c, scale(unitOf(sub(p, c)) ?? fromAngle(0), r));

/** A location to measure the dimension at before the drafter gives one (the Text option). */
function sampleLocation(p: DimPlacement): Vec2 {
  switch (p.kind) {
    case 'linear':
    case 'aligned':
      return midpoint(p.first, p.second);
    case 'radius':
    case 'diameter':
      return add(p.center, fromAngle(Math.PI / 4, p.radius * 2));
    case 'angular3pt': {
      const a = unitOf(sub(p.first, p.vertex)) ?? fromAngle(0);
      const b = unitOf(sub(p.second, p.vertex)) ?? fromAngle(0);
      const r = Math.min(distance(p.first, p.vertex), distance(p.second, p.vertex));
      return add(p.vertex, scale(unitOf(add(a, b)) ?? perp(a), r));
    }
    case 'angular':
      return midpoint(p.line1[1], p.line2[1]);
  }
}

/**
 * "Specify dimension line location or [...]", with the dimension dragged under the cursor; the
 * options change the text, its angle or (DIMLINEAR) the dimension line's. Returns the
 * dimension as placed; undefined when the command ends.
 */
async function* askLocation(
  ctx: CommandContext,
  start: DimPlacement,
  xdata: Xdata | undefined,
  message: string,
  options: readonly string[],
): Sub<DimensionGeometry | undefined> {
  let place = start;
  const layer = currentLayer(ctx.model);
  for (;;) {
    const a = yield ctx.prompt.point({
      message,
      options,
      drag: { kind: 'dimension', place, layer, ...(xdata && { xdata }) },
    });
    if (a.kind === 'point') {
      const g = placeDimension(place, a.point);
      if (g) return g;
      ctx.message('Invalid point.');
      continue;
    }
    if (a.kind !== 'keyword') return undefined;
    const base = place.base;
    const sample = placeDimension(place, sampleLocation(place));
    switch (a.keyword) {
      case 'Mtext': {
        const at = sample?.textPosition ?? sampleLocation(place);
        const e = yield ctx.prompt.string({
          message: 'Enter dimension text',
          spaces: true,
          editor: dimensionTextEditor(ctx.model, base, at, base.text === '' ? '<>' : base.text),
        });
        if (e.kind === 'string') {
          place = { ...place, base: { ...base, text: dimensionOverride(e.value) } };
        }
        continue;
      }
      case 'Text': {
        const measured = sample && measurementOf(ctx, sample, xdata);
        const e = yield ctx.prompt.string({
          message: 'Enter dimension text',
          spaces: true,
          ...(measured !== undefined && { default: { kind: 'string', value: measured } }),
        });
        if (e.kind === 'string') {
          const text = e.value === measured ? '' : e.value;
          place = { ...place, base: { ...base, text } };
        }
        continue;
      }
      case 'Angle': {
        const e = yield ctx.prompt.angle({ message: 'Specify angle of dimension text' });
        if (e.kind === 'angle') place = { ...place, base: { ...base, textRotation: e.value } };
        continue;
      }
      case 'Horizontal':
      case 'Vertical':
      case 'Rotated': {
        if (place.kind !== 'linear') continue;
        let rotation = a.keyword === 'Vertical' ? Math.PI / 2 : 0;
        if (a.keyword === 'Rotated') {
          const e = yield ctx.prompt.angle({
            message: 'Specify angle of dimension line',
            default: { kind: 'angle', value: 0 },
          });
          if (e.kind !== 'angle') continue;
          rotation = e.value;
        }
        place = { ...place, rotation };
        continue;
      }
      case 'Quadrant': {
        // The angle measured stays the one this point is in, wherever the location goes.
        if (place.kind !== 'angular' && place.kind !== 'angular3pt') continue;
        const e = yield ctx.prompt.point({ message: 'Specify quadrant' });
        if (e.kind === 'point') place = { ...place, quadrant: e.point };
        continue;
      }
    }
  }
}

/** Makes the dimension, has the engine draw it and says what it measures. */
async function makeDimension(
  ctx: CommandContext,
  state: DimensionState,
  geom: DimensionGeometry,
  xdata: Xdata | undefined,
): Promise<EntityId> {
  const layer = currentLayer(ctx.model);
  let made: Entity | undefined;
  ctx.edit((b) => {
    made = b.addEntity({ owner: ctx.space, layer, geom, ...(xdata && { xdata }) });
  });
  const id = made!.id;
  const drawn = await regenerateDimensions(ctx, [id]);
  const m = drawn.get(id)?.measurement;
  if (m !== undefined) ctx.message(`Dimension text = ${m}`);
  if (chainOf(made!, undefined, false)) state.last = made!.handle;
  return id;
}

/** A dimension made by this command taken back (DIMCONTINUE's Undo): it and its block. */
function unmake(ctx: CommandContext, id: EntityId): void {
  ctx.edit((b) => {
    const e = b.entity(id);
    if (!e) return;
    const block = 'dimType' in e.geom ? e.geom.block : undefined;
    b.removeEntity(id);
    if (block !== undefined && b.block(block)) {
      for (const inner of b.blockEntities(block)) b.removeEntity(inner);
      b.removeBlock(block);
    }
  });
}

/** "Select object": one object picked, with where it was picked; undefined when none. */
async function* pickObject(
  ctx: CommandContext,
  message: string,
  defaultLabel?: string,
): Sub<{ entity: Entity; at: Vec2 | undefined } | undefined | 'enter'> {
  const a = yield ctx.prompt.selection({
    message,
    single: true,
    ...(defaultLabel !== undefined && { defaultLabel }),
  });
  if (a.kind !== 'selection') return undefined;
  if (a.ids.length === 0) return 'enter';
  const entity = ctx.model.entity(a.ids[0]!);
  return entity && { entity, at: a.pick };
}

/** The two ends a line, an arc or the picked polyline segment gives DIMLINEAR/DIMALIGNED. */
function endsOf(g: EntityGeometry, at: Vec2 | undefined): [Vec2, Vec2] | undefined {
  switch (g.kind) {
    case 'LINE':
      return [g.start, g.end];
    case 'ARC':
      return [
        add(g.center, fromAngle(g.startAngle, g.radius)),
        add(g.center, fromAngle(g.endAngle, g.radius)),
      ];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const v = g.vertices;
      const n = g.closed ? v.length : v.length - 1;
      let best: [Vec2, Vec2] | undefined;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const a = v[i]!;
        const b = v[(i + 1) % v.length]!;
        const d = at ? distanceToSegment(at, a, b) : i;
        if (d < bestD) {
          bestD = d;
          best = [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
          ];
        }
      }
      return best;
    }
    default:
      return undefined;
  }
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return distance(p, add(a, scale(ab, t)));
}

/** A circle selected for DIMLINEAR or DIMALIGNED, and where it was picked. */
interface PickedCircle {
  readonly center: Vec2;
  readonly radius: number;
  readonly at: Vec2;
}

/**
 * DIMLINEAR or DIMALIGNED's two extension line origins, or the circle selected whose diameter
 * they measure; undefined when the command ends.
 */
async function* askOrigins(ctx: CommandContext): Sub<[Vec2, Vec2] | PickedCircle | undefined> {
  const a = yield ctx.prompt.point({
    message: 'Specify first extension line origin or',
    defaultLabel: 'select object',
  });
  if (a.kind === 'point') {
    for (;;) {
      const b = yield ctx.prompt.point({
        message: 'Specify second extension line origin',
        rubberBand: { from: a.point },
      });
      if (b.kind !== 'point') return undefined;
      if (distance(a.point, b.point) > 0) return [a.point, b.point];
      ctx.message('Extension line origins must be different points.');
    }
  }
  if (a.kind !== 'enter') return undefined;
  for (;;) {
    const o = yield* pickObject(ctx, 'Select object to dimension');
    if (o === undefined || o === 'enter') return undefined;
    const g = o.entity.geom;
    if (g.kind === 'CIRCLE' && g.radius > 0) {
      return {
        center: g.center,
        radius: g.radius,
        at: onCircle(g.center, g.radius, o.at ?? g.center),
      };
    }
    const ends = endsOf(g, o.at);
    if (ends && distance(ends[0], ends[1]) > 0) return ends;
    ctx.message('Object selected is not a line, arc, circle or polyline segment.');
  }
}

const LINEAR_OPTIONS = ['Mtext', 'Text', 'Angle', 'Horizontal', 'Vertical', 'Rotated'];
const TEXT_OPTIONS = ['Mtext', 'Text', 'Angle'];
const ANGULAR_OPTIONS = ['Mtext', 'Text', 'Angle', 'Quadrant'];

/**
 * Where DIMLINEAR or DIMALIGNED measures a circle: DIMLINEAR the diameter across its dimension
 * line, horizontal for a pick near the north or south quadrant and vertical near the east or
 * west one until the location says otherwise (edit/dimension.ts); DIMALIGNED from the pick to
 * the opposite end of the diameter ("the point used to select the circle defines the origin of
 * the first extension line", AutoCAD Help, DIMALIGNED).
 */
function circlePlacement(
  kind: 'linear' | 'aligned',
  c: PickedCircle,
  base: NewDimension,
): DimPlacement {
  const opposite = sub(scale(c.center, 2), c.at);
  if (kind === 'aligned') return { kind, first: c.at, second: opposite, base };
  const d = sub(c.at, c.center);
  const vertical = Math.abs(d.x) > Math.abs(d.y);
  return {
    kind,
    first: c.at,
    second: opposite,
    circle: { center: c.center, radius: c.radius, vertical },
    base,
  };
}

function linearCommand(state: DimensionState, kind: 'linear' | 'aligned'): CommandDef {
  return {
    name: kind === 'linear' ? 'DIMLINEAR' : 'DIMALIGNED',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const style = currentStyle(ctx);
      if (style === undefined) return;
      const ends = yield* askOrigins(ctx);
      if (!ends) return;
      const base = newDimension(style.handle);
      const place: DimPlacement = Array.isArray(ends)
        ? { kind, first: ends[0], second: ends[1], base }
        : circlePlacement(kind, ends, base);
      const g = yield* askLocation(
        ctx,
        place,
        style.xdata,
        'Specify dimension line location or',
        kind === 'linear' ? LINEAR_OPTIONS : TEXT_OPTIONS,
      );
      if (g) await makeDimension(ctx, state, g, style.xdata);
    },
  };
}

function radialCommand(state: DimensionState, kind: 'radius' | 'diameter'): CommandDef {
  return {
    name: kind === 'radius' ? 'DIMRADIUS' : 'DIMDIAMETER',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const style = currentStyle(ctx);
      if (style === undefined) return;
      let circle: { center: Vec2; radius: number } | undefined;
      while (!circle) {
        const o = yield* pickObject(ctx, 'Select arc or circle');
        if (o === undefined || o === 'enter') return;
        const g = o.entity.geom;
        if (g.kind === 'CIRCLE' || g.kind === 'ARC') circle = g;
        else ctx.message('Object selected is not a circle or arc.');
      }
      const place: DimPlacement = {
        kind,
        center: circle.center,
        radius: circle.radius,
        base: newDimension(style.handle),
      };
      const g = yield* askLocation(
        ctx,
        place,
        style.xdata,
        'Specify dimension line location or',
        TEXT_OPTIONS,
      );
      if (g) await makeDimension(ctx, state, g, style.xdata);
    },
  };
}

function angularCommand(state: DimensionState): CommandDef {
  return {
    name: 'DIMANGULAR',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const style = currentStyle(ctx);
      if (style === undefined) return;
      const base = newDimension(style.handle);
      let place: DimPlacement | undefined;
      while (!place) {
        const o = yield* pickObject(ctx, 'Select arc, circle, line, or', 'specify vertex');
        if (o === undefined) return;
        if (o === 'enter') {
          const v = yield ctx.prompt.point({ message: 'Specify angle vertex' });
          if (v.kind !== 'point') return;
          const p1 = yield ctx.prompt.point({
            message: 'Specify first angle endpoint',
            rubberBand: { from: v.point },
          });
          if (p1.kind !== 'point') return;
          const p2 = yield ctx.prompt.point({
            message: 'Specify second angle endpoint',
            rubberBand: { from: v.point },
          });
          if (p2.kind !== 'point') return;
          place = { kind: 'angular3pt', vertex: v.point, first: p1.point, second: p2.point, base };
          continue;
        }
        const g = o.entity.geom;
        if (g.kind === 'ARC') {
          place = {
            kind: 'angular3pt',
            vertex: g.center,
            first: add(g.center, fromAngle(g.startAngle, g.radius)),
            second: add(g.center, fromAngle(g.endAngle, g.radius)),
            base,
          };
        } else if (g.kind === 'CIRCLE') {
          // The pick is the first end, on the circle; the second end is asked for.
          const first = onCircle(g.center, g.radius, o.at ?? add(g.center, fromAngle(0, 1)));
          const p2 = yield ctx.prompt.point({
            message: 'Specify second angle endpoint',
            rubberBand: { from: g.center },
          });
          if (p2.kind !== 'point') return;
          place = { kind: 'angular3pt', vertex: g.center, first, second: p2.point, base };
        } else if (g.kind === 'LINE') {
          const line1 = [g.start, g.end] as const;
          for (;;) {
            const o2 = yield* pickObject(ctx, 'Select second line');
            if (o2 === undefined || o2 === 'enter') return;
            const h = o2.entity.geom;
            if (h.kind !== 'LINE') {
              ctx.message('Object selected is not a line.');
              continue;
            }
            const candidate: DimPlacement = {
              kind: 'angular',
              line1,
              line2: [h.start, h.end],
              base,
            };
            if (!placeDimension(candidate, sampleLocation(candidate))) {
              ctx.message('Lines are parallel.');
              continue;
            }
            place = candidate;
            break;
          }
        } else {
          ctx.message('Object selected is not an arc, circle or line.');
        }
      }
      const g = yield* askLocation(
        ctx,
        place,
        style.xdata,
        'Specify dimension arc line location or',
        ANGULAR_OPTIONS,
      );
      if (g) await makeDimension(ctx, state, g, style.xdata);
    },
  };
}

/**
 * Where DIMCONTINUE or DIMBASELINE goes on from: a base dimension (a two-line angular one as
 * the three-point one measuring its angle) in its style, and its extension line.
 */
interface Chain {
  readonly base: Linear | Angular3 | Ordinate;
  readonly style: NewStyle;
  /** The extension line origin the next dimension starts from (an ordinate's feature). */
  readonly from: Vec2;
}

/** The chain a dimension starts: from its second extension line, or the one nearest `at`. */
function chainOf(
  e: Entity,
  at: Vec2 | undefined,
  baseline: boolean,
  ctx?: CommandContext,
): Chain | undefined {
  const style = (): NewStyle =>
    ctx ? styleOf(ctx, e) : { handle: (e.geom as DimensionGeometry).style };
  let g = e.geom;
  if (g.kind !== 'DIMENSION') return undefined;
  if (g.dimType === 'ordinate') return { base: g, style: style(), from: g.feature };
  if (g.dimType === 'angular') {
    const three = angularAsThreePoint(g);
    if (!three) return undefined;
    g = three;
  }
  if (g.dimType !== 'linear' && g.dimType !== 'aligned' && g.dimType !== 'angular3pt') {
    return undefined;
  }
  // DIMCONTINUE goes on from the second extension line, DIMBASELINE from the first; a pick
  // takes the one nearest it (AutoCAD 2024 Help, "DIMCONTINUE (Command)", Select).
  let from = baseline ? g.first : g.second;
  if (at) from = distance(at, g.first) <= distance(at, g.second) ? g.first : g.second;
  return { base: g, style: style(), from };
}

/** The next dimension of a chain, to `to`. */
function chained(
  ctx: CommandContext,
  c: Chain,
  to: Vec2,
  baseline: boolean,
): DimensionGeometry | undefined {
  const g = c.base;
  const base = newDimension(c.style.handle);
  if (g.dimType === 'ordinate') {
    // The same origin and axis; the leader ends in line with the base's (AutoCAD lines up the
    // texts of continued ordinate dimensions), DIMBASELINE as DIMCONTINUE.
    const ucsX = fromAngle(-g.horizontalDirection);
    const along = g.axis === 'x' ? perp(ucsX) : ucsX;
    const leaderEnd = add(to, scale(along, dot(sub(g.leaderEnd, to), along)));
    if (distance(leaderEnd, to) === 0) return undefined;
    return {
      kind: 'DIMENSION',
      ...base,
      dimType: 'ordinate',
      axis: g.axis,
      horizontalDirection: g.horizontalDirection,
      definitionPoint: g.definitionPoint,
      feature: to,
      leaderEnd,
      textPosition: leaderEnd,
    };
  }
  if (g.dimType === 'angular3pt') {
    const r = distance(g.vertex, g.definitionPoint);
    const radius = baseline ? r + baselineSpacing(ctx.model, g) : r;
    const a = unitOf(sub(c.from, g.vertex));
    const b = unitOf(sub(to, g.vertex));
    if (!a || !b) return undefined;
    const mid = unitOf(add(a, b)) ?? perp(a);
    return placeDimension(
      { kind: 'angular3pt', vertex: g.vertex, first: c.from, second: to, base },
      add(g.vertex, scale(mid, radius)),
    );
  }
  // Continued and baseline dimensions run the base's way: rotated dimensions at its angle.
  const u = dimensionDirection(g);
  let at = g.definitionPoint;
  if (baseline) {
    const n0 = perp(u);
    const side = dot(sub(g.definitionPoint, c.from), n0) < 0 ? -1 : 1;
    at = add(at, scale(n0, side * baselineSpacing(ctx.model, g)));
  }
  return placeDimension(
    { kind: 'linear', first: c.from, second: to, rotation: angleOf(u), base },
    at,
  );
}

function chainCommand(state: DimensionState, baseline: boolean): CommandDef {
  const what = baseline ? 'base' : 'continued';
  return {
    name: baseline ? 'DIMBASELINE' : 'DIMCONTINUE',
    usesSelection: 'none',
    async *run(ctx): CommandGenerator {
      const select = async function* (): Sub<Chain | undefined> {
        for (;;) {
          const o = yield* pickObject(ctx, `Select ${what} dimension`);
          if (o === undefined || o === 'enter') return undefined;
          const c = chainOf(o.entity, o.at, baseline, ctx);
          if (c) return c;
          ctx.message('Dimension must be linear, ordinate, or angular.');
        }
      };
      const last = state.last === undefined ? undefined : ctx.model.entityByHandle(state.last);
      let chain: Chain | undefined = last ? chainOf(last, undefined, baseline, ctx) : undefined;
      if (!chain) chain = yield* select();
      if (!chain) return;
      const made: { id: EntityId; chain: Chain }[] = [];
      for (;;) {
        const a: PromptAnswer = yield ctx.prompt.point({
          message:
            chain.base.dimType === 'ordinate'
              ? 'Specify feature location or'
              : 'Specify a second extension line origin or',
          options: ['Undo', 'Select'],
          default: { kind: 'keyword', keyword: 'Select' },
        });
        if (a.kind === 'point') {
          const g = chained(ctx, chain, a.point, baseline);
          if (!g) {
            ctx.message('Invalid point.');
            continue;
          }
          const id = await makeDimension(ctx, state, g, chain.style.xdata);
          made.push({ id, chain });
          const e = ctx.model.entity(id)!;
          // The next one goes on from this one: its second origin (DIMCONTINUE), or the same
          // first origin a spacing further out (DIMBASELINE).
          const next = e.geom as Linear | Angular3 | Ordinate;
          chain = { ...chain, base: next, from: baseline ? chain.from : a.point };
          continue;
        }
        if (a.kind !== 'keyword') return;
        if (a.keyword === 'Undo') {
          const undone = made.pop();
          if (!undone) {
            ctx.message('Everything has been undone.');
            continue;
          }
          unmake(ctx, undone.id);
          chain = undone.chain;
          continue;
        }
        // Select (Enter): another dimension to go on from; Enter there ends the command.
        const c = yield* select();
        if (!c) return;
        chain = c;
      }
    },
  };
}

/** The dimension commands of one drawing, sharing the last dimension made. */
export function dimensionCommands(): CommandDef[] {
  const state: DimensionState = { last: undefined };
  return [
    linearCommand(state, 'linear'),
    linearCommand(state, 'aligned'),
    radialCommand(state, 'radius'),
    radialCommand(state, 'diameter'),
    angularCommand(state),
    chainCommand(state, false),
    chainCommand(state, true),
  ];
}
