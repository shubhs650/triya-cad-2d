// DIMCONSTRAINT and the DC* commands (M9-03 part 3): AutoCAD's dimensional constraints applied
// to the drawing. Each puts a value on a distance or angle, kept as a parameter of the Parameters
// Manager (d1, ang1, rad1, dia1… or a name typed as `name=expression`), and the geometry is
// solved to it by the constraint service, the second object adjusting to the first.
//
// Prompts from AutoCAD 2024 Help ("DIMCONSTRAINT (Command)", "DCLINEAR", "DCHORIZONTAL",
// "DCVERTICAL", "DCALIGNED", "DCANGULAR", "DCRADIUS", "DCDIAMETER"): the objects or constraint
// points, "Specify dimension line location", then the dimension text, `name=value` with the
// measured value shown. Enter keeps the measured value as it is.
//
// Decisions where the Help is silent or shows a dialog:
//  - DCLINEAR is horizontal when the dimension line is placed above or below the points and
//    vertical when beside them, as DIMLINEAR places a dimension; inside (or at a corner) the
//    farther side decides, then the points (horizontal when as far across as up).
//  - AutoCAD's "Dimension Constraints - Over-constraining Geometry" task dialog ("Create a
//    reference constraint" or "Cancel") is asked at the command line: "Create a reference
//    constraint? [Yes/No] <Yes>".
//  - Constraint Form is CCONSTRAINTFORM (M9-03 part 8; AutoCAD 2024 Help, "CCONSTRAINTFORM
//    (System Variable)": 0 dynamic, 1 annotational, "Saved in: Registry", initially 0), the
//    app's: each command reads it as it starts and DIMCONSTRAINT's Form sets it. Where no app
//    keeps it (scripts, tests) the commands share their own for the session.
//
// Converting dimensions (M9-03 part 9): DCCONVERT ("Select associative dimensions to convert")
// and a dimension picked at DIMCONSTRAINT's first prompt become constraints of the current Form,
// each keeping the value it measures, the dimension erased, all one undo step. What a dimension
// converts to is `dimensionConstraintOf` (edit/dimension-convert.ts), which also takes Triya's
// own (non-associative) dimensions whose points lie on objects. Decisions where the Help is
// silent: a dimension whose value would over-constrain the geometry becomes a reference
// constraint without asking (one question per dimension of a selection would be a chore), and
// the command line says how many converted and why the others did not.
import type { CommandContext, CommandDef, CommandGenerator } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import {
  INVALID_OBJECT,
  isRef,
  objectPick,
  pointPick,
  sentence,
  setExpressions,
  toleranceOf,
} from './constraints';
import { drawingUnits } from './units';
import { optionVariable, setOptionVariable } from './modify/option-variables';
import {
  constraintPointsOf,
  parameterObjects,
  geometricConstraints,
  type ConstraintSolver,
  type DimensionalConstraintSpec,
  type ExpressionChange,
} from '../edit/constraints';
import { dimensionConstraintOf, type DimensionConversionProblem } from '../edit/dimension-convert';
import { eraseObjects } from '../edit/edit';
import { toleranceFor } from './modify/offset';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import { polylineSegment } from '../geom/eval';
import type { Vec2 } from '../geom/types';
import type {
  ConstraintCurveRef,
  ConstraintPointRef,
  ConstraintRef,
  DimensionalConstraintKind,
  DimensionalConstraintObject,
  Entity,
  ParameterObject,
} from '../model/types';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** DIMCONSTRAINT's types: its own Linear, then the kinds the drawing keeps. */
export type DimensionalCommandKind = DimensionalConstraintKind | 'linear';

/** The Constraint Form new dimensional constraints take, shared by DIMCONSTRAINT and DC*. */
interface Session {
  form: DimensionalConstraintObject['form'];
}

/** The system variable that keeps the Constraint Form: 0 dynamic, 1 annotational. */
const CCONSTRAINTFORM = 'CCONSTRAINTFORM';

/** Takes the Form the app keeps, where it keeps one, as a command starts. */
async function readForm(ctx: CommandContext, session: Session): Promise<void> {
  const v = await optionVariable(ctx, CCONSTRAINTFORM, session.form === 'annotational' ? 1 : 0);
  session.form = v === 1 ? 'annotational' : 'dynamic';
}

async function* objectOnly(
  ctx: CommandContext,
  message: string,
): Sub<ConstraintCurveRef | undefined> {
  const r = yield* objectPick(ctx, message);
  return isRef(r) ? r : undefined;
}

async function* pointOnly(
  ctx: CommandContext,
  message: string,
): Sub<ConstraintPointRef | undefined> {
  const r = yield* pointPick(ctx, message);
  return isRef(r) ? r : undefined;
}

async function solverOf(ctx: CommandContext): Promise<ConstraintSolver | undefined> {
  try {
    const solver = await ctx.constraints?.();
    if (!solver) ctx.message('Dimensional constraints are not available here.');
    return solver;
  } catch (e) {
    ctx.message(`The constraint solver could not load: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/** Where a reference's point is, or a line's two ends for a line (segment) reference. */
function pointsOf(ctx: CommandContext, ref: ConstraintRef): Vec2[] {
  const e = ctx.model.entityByHandle(ref.entity);
  if (!e) return [];
  if ('point' in ref) {
    const at = constraintPointsOf(e).find(
      (c) => c.ref.point === ref.point && (c.ref as ConstraintPointRef).index === ref.index,
    );
    return at ? [at.at] : [];
  }
  const g = e.geom;
  if (g.kind === 'LINE') return [g.start, g.end];
  if (g.kind === 'LWPOLYLINE' && ref.segment !== undefined) {
    const s = polylineSegment(g, ref.segment);
    return 'line' in s ? [s.line.a, s.line.b] : [];
  }
  return [];
}

/**
 * DCLINEAR's direction from where the dimension line was placed: horizontal above or below the
 * points, vertical beside them, the farther side deciding at a corner, the points inside.
 */
export function linearDirection(p: Vec2, q: Vec2, at: Vec2): 'horizontal' | 'vertical' {
  const beyond = (v: number, a: number, b: number) =>
    Math.max(0, Math.min(a, b) - v, v - Math.max(a, b));
  const outX = beyond(at.x, p.x, q.x);
  const outY = beyond(at.y, p.y, q.y);
  if (outX > 0 || outY > 0) return outY >= outX ? 'horizontal' : 'vertical';
  return Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? 'horizontal' : 'vertical';
}

const NAMED = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/s;

/** The dimension text typed: `name=expression`, or an expression alone. */
export function parseDimensionText(
  text: string,
): { readonly parameter?: string; readonly expression?: string } | { readonly error: string } {
  const t = text.trim();
  if (t === '') return {};
  const m = NAMED.exec(t);
  if (!m) return { expression: t };
  const expression = m[2]!.trim();
  if (expression === '') return { error: `Enter a value or expression after "${m[1]}=".` };
  return { parameter: m[1]!, expression };
}

/**
 * Places a dimensional constraint on `refs`: the dimension line's location, the value, then the
 * constraint solved with the drawing's others. False when the drafter is to pick again (the
 * references cannot take it); true when the command is done.
 */
async function* place(
  ctx: CommandContext,
  session: Session,
  kind: DimensionalCommandKind,
  refs: readonly ConstraintRef[],
): Sub<boolean> {
  const solver = await solverOf(ctx);
  if (!solver) return true;
  const lookup = (h: string) => ctx.model.entityByHandle(h);
  const dims = parameterObjects(ctx.model);
  const first = solver.measure(dims, { dimension: kind, refs }, lookup);
  if (!first.ok) {
    ctx.message(sentence(first.message));
    return false;
  }
  const at = yield ctx.prompt.point({ message: 'Specify dimension line location' });
  if (at.kind !== 'point') return true;
  let dimension: DimensionalCommandKind = kind;
  if (kind === 'linear') {
    const pts = refs.flatMap((r) => pointsOf(ctx, r));
    if (pts.length === 2) dimension = linearDirection(pts[0]!, pts[1]!, at.point);
  }
  const m = dimension === kind ? first : solver.measure(dims, { dimension, refs }, lookup);
  if (!m.ok) {
    ctx.message(sentence(m.message));
    return false;
  }
  const u = drawingUnits(ctx.model.header);
  const shown = `${m.parameter}=${m.value.toFixed(m.dimension === 'angular' ? u.auprec : u.luprec)}`;
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Dimension text',
      spaces: true,
      default: { kind: 'string', value: shown },
    });
    if (a.kind !== 'string') return true;
    // The text shown, taken as it is, keeps the measured value to the last digit.
    const typed = a.value.trim() === shown ? {} : parseDimensionText(a.value);
    if ('error' in typed) {
      ctx.message(typed.error);
      continue;
    }
    const spec: DimensionalConstraintSpec = { dimension: m.dimension, refs, ...typed };
    const tol = toleranceOf(ctx, refs);
    const constraints = geometricConstraints(ctx.model);
    let reference = false;
    let r = solver.addDimension(constraints, dims, spec, lookup, tol);
    if (!r.ok && (r.reason === 'overconstrained' || r.reason === 'redundant')) {
      ctx.message(sentence(r.message));
      const b = yield ctx.prompt.keyword({
        message: 'Create a reference constraint?',
        options: ['Yes', 'No'],
        default: { kind: 'keyword', keyword: 'Yes' },
      });
      if (b.kind !== 'keyword' || b.keyword !== 'Yes') return true;
      reference = true;
      r = solver.addDimension(constraints, dims, { ...spec, reference }, lookup, tol);
    }
    if (!r.ok) {
      ctx.message(sentence(r.message));
      if (r.reason === 'invalid' && !reference) continue;
      return true;
    }
    const done = r;
    const owner = ctx.model.meta.rootDictionary ?? '0';
    ctx.edit((b) => {
      for (const moved of done.updated) b.updateEntity(moved.after.id, { geom: moved.after.geom });
      setExpressions(ctx, b, done.expressions);
      b.addObject({
        type: 'TRIYA_DIMCONSTRAINT',
        owner,
        dimension: done.dimension,
        refs,
        parameter: done.parameter,
        expression: done.expression,
        ...(reference ? { reference: true } : {}),
        location: at.point,
        form: session.form,
      } as Omit<DimensionalConstraintObject, 'handle'>);
    });
    return true;
  }
}

// ── Converting dimensions (M9-03 part 9) ────────────────────────────────────────────────────

/** Why dimensions were not converted, as the command line says it. */
const NOT_CONVERTED: Readonly<Record<DimensionConversionProblem['problem'] | 'locked', string>> = {
  kind: 'ordinate, arc length and jogged dimensions have no dimensional constraint',
  rotated: 'a linear dimension converts only when horizontal or vertical',
  unattached: 'their points are not on objects a constraint can take',
  locked: 'they or the objects they measure are on a locked layer',
};

const isDimension = (e: Entity | undefined): e is Entity =>
  e?.geom.kind === 'DIMENSION' ||
  e?.geom.kind === 'ARC_DIMENSION' ||
  e?.geom.kind === 'LARGE_RADIAL_DIMENSION';

/** The dimension of the current space under a pick, nearest first. */
async function dimensionAt(ctx: CommandContext, p: Vec2): Promise<Entity | undefined> {
  const r = await ctx.view.request({ op: 'pick', point: p });
  return (r.ok ? (r.ids ?? []) : [])
    .map((id) => ctx.model.entity(id))
    .find((e): e is Entity => isDimension(e) && e.owner === ctx.space);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The drawing's tolerance about a dimension: its points and the drawing's extents. */
function dimensionTolerance(ctx: CommandContext, dim: Entity) {
  const pts = Object.values(dim.geom).filter(
    (v): v is Vec2 =>
      typeof v === 'object' && v !== null && typeof (v as Vec2).x === 'number' && 'y' in v,
  );
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return toleranceFor(ctx.model, {
    kind: 'LINE',
    start: { x: Math.min(0, ...xs), y: Math.min(0, ...ys) },
    end: { x: Math.max(1, ...xs), y: Math.max(1, ...ys) },
  });
}

/**
 * Converts the dimensions `ids` to dimensional constraints of the session's Form, each keeping
 * its value (a reference constraint where the value would over-constrain), the dimensions
 * erased, one undo step; says how many converted and why any others did not.
 */
async function convertDimensions(
  ctx: CommandContext,
  session: Session,
  ids: readonly EntityId[],
): Promise<void> {
  const dims = ids.map((id) => ctx.model.entity(id)).filter(isDimension);
  if (dims.length === 0) {
    ctx.message('No dimensions selected.');
    return;
  }
  const solver = await solverOf(ctx);
  if (!solver) return;
  const owner = ctx.model.meta.rootDictionary ?? '0';
  const constraints = geometricConstraints(ctx.model);
  const moved = new Map<Handle, Entity>();
  const lookup = (h: Handle) => moved.get(h) ?? ctx.model.entityByHandle(h);
  const isLocked = (e: Entity | undefined) =>
    e !== undefined && ctx.model.tables.layers.get(e.layer)?.locked === true;
  let parameters: ParameterObject[] = parameterObjects(ctx.model);
  const expressions = new Map<string, string>();
  const added: DimensionalConstraintObject[] = [];
  const converted: EntityId[] = [];
  const problems = new Map<string, number>();
  const fail = (why: string) => problems.set(why, (problems.get(why) ?? 0) + 1);
  let references = 0;
  for (const dim of dims) {
    const c = dimensionConstraintOf(ctx.model, dim, dimensionTolerance(ctx, dim));
    if ('problem' in c) {
      fail(NOT_CONVERTED[c.problem]);
      continue;
    }
    if (isLocked(dim) || c.refs.some((r) => isLocked(ctx.model.entityByHandle(r.entity)))) {
      fail(NOT_CONVERTED.locked);
      continue;
    }
    const spec: DimensionalConstraintSpec = { dimension: c.dimension, refs: c.refs };
    const tol = toleranceOf(ctx, c.refs);
    let reference = false;
    let r = solver.addDimension(constraints, parameters, spec, lookup, tol);
    if (!r.ok && (r.reason === 'overconstrained' || r.reason === 'redundant')) {
      reference = true;
      r = solver.addDimension(constraints, parameters, { ...spec, reference }, lookup, tol);
    }
    if (!r.ok) {
      fail(r.message);
      continue;
    }
    if (reference) references++;
    for (const u of r.updated) moved.set(u.after.handle, u.after);
    for (const x of r.expressions) expressions.set(x.parameter, x.expression);
    // A handle of its own for the solver to tell it from the others by; the edit allocates the
    // real one.
    const constraint: DimensionalConstraintObject = {
      handle: `DV${added.length.toString(16).toUpperCase()}`,
      type: 'TRIYA_DIMCONSTRAINT',
      owner,
      dimension: r.dimension,
      refs: c.refs,
      parameter: r.parameter,
      expression: r.expression,
      ...(reference ? { reference: true } : {}),
      location: c.location,
      form: session.form,
    };
    added.push(constraint);
    converted.push(dim.id);
    parameters = [...parameters, constraint].map((p) => {
      const expression = expressions.get(p.parameter);
      return expression === undefined ? p : { ...p, expression };
    });
  }
  if (added.length) {
    const fresh = new Set(added.map((a) => a.parameter));
    const changes: ExpressionChange[] = [...expressions]
      .filter(([parameter]) => !fresh.has(parameter))
      .map(([parameter, expression]) => ({ parameter, expression }));
    ctx.edit((b) => {
      for (const e of moved.values()) b.updateEntity(e.id, { geom: e.geom });
      setExpressions(ctx, b, changes);
      for (const { handle: _, ...a } of added) {
        b.addObject({
          ...a,
          expression: expressions.get(a.parameter) ?? a.expression,
        } as Omit<DimensionalConstraintObject, 'handle'>);
      }
      eraseObjects(b, ctx.model, converted);
    });
    ctx.message(
      sentence(
        `${plural(added.length, 'dimension')} converted` +
          (references
            ? `, ${references} as ${references === 1 ? 'a reference constraint' : 'reference constraints'}`
            : ''),
      ),
    );
  }
  for (const [why, n] of problems) {
    ctx.message(sentence(`${plural(n, 'dimension')} not converted: ${why}`));
  }
}

// ── Each constraint's prompts ────────────────────────────────────────────────────────────────

/**
 * Linear, Horizontal, Vertical: two constraint points, or (Object, the default) a line whose
 * ends are measured.
 */
async function* linear(
  ctx: CommandContext,
  session: Session,
  kind: 'linear' | 'horizontal' | 'vertical',
): CommandGenerator {
  for (;;) {
    const a = yield* pointPick(ctx, 'Specify first constraint point or', ['Object'], 'Object');
    if (a === undefined || a === 'enter') return;
    let refs: ConstraintRef[];
    if (isRef(a)) {
      const b = yield* pointOnly(ctx, 'Specify second constraint point');
      if (!b) return;
      refs = [a, b];
    } else {
      const o = yield* objectOnly(ctx, 'Select object');
      if (!o) return;
      refs = [o];
    }
    if (yield* place(ctx, session, kind, refs)) return;
  }
}

/**
 * Aligned: two constraint points; a line (Object, the default); a point and a line (Point&line);
 * or two lines, the second made parallel (2Line).
 */
async function* aligned(ctx: CommandContext, session: Session): CommandGenerator {
  for (;;) {
    const a = yield* pointPick(
      ctx,
      'Specify first constraint point or',
      ['Object', 'Point&line', '2Line'],
      'Object',
    );
    if (a === undefined || a === 'enter') return;
    let refs: ConstraintRef[];
    if (isRef(a)) {
      const b = yield* pointOnly(ctx, 'Specify second constraint point');
      if (!b) return;
      refs = [a, b];
    } else if (a.keyword === 'Point&line') {
      const p = yield* pointOnly(ctx, 'Specify constraint point');
      if (!p) return;
      const l = yield* objectOnly(ctx, 'Select line');
      if (!l) return;
      refs = [p, l];
    } else if (a.keyword === '2Line') {
      const l = yield* objectOnly(ctx, 'Select first line');
      if (!l) return;
      const m = yield* objectOnly(ctx, 'Select second line to make parallel');
      if (!m) return;
      refs = [l, m];
    } else {
      const o = yield* objectOnly(ctx, 'Select object');
      if (!o) return;
      refs = [o];
    }
    if (yield* place(ctx, session, 'aligned', refs)) return;
  }
}

/** Whether a curve reference is an arc (an ARC, or a polyline's arc segment). */
function isArc(ctx: CommandContext, ref: ConstraintCurveRef): boolean {
  const g = ctx.model.entityByHandle(ref.entity)?.geom;
  if (g?.kind === 'ARC') return true;
  if (g?.kind !== 'LWPOLYLINE' || ref.segment === undefined) return false;
  return !('line' in polylineSegment(g, ref.segment));
}

/** Angular: two lines, an arc's included angle, or (3Point, the default) a vertex and two points. */
async function* angular(ctx: CommandContext, session: Session): CommandGenerator {
  for (;;) {
    const a = yield* objectPick(ctx, 'Select first line or arc or', ['3Point'], '3Point');
    if (a === undefined || a === 'enter') return;
    let refs: ConstraintRef[];
    if (isRef(a)) {
      if (isArc(ctx, a)) refs = [a];
      else {
        const b = yield* objectOnly(ctx, 'Select second line');
        if (!b) return;
        refs = [a, b];
      }
    } else {
      const v = yield* pointOnly(ctx, 'Specify angle vertex');
      if (!v) return;
      const p = yield* pointOnly(ctx, 'Specify first angle constraint point');
      if (!p) return;
      const q = yield* pointOnly(ctx, 'Specify second angle constraint point');
      if (!q) return;
      refs = [v, p, q];
    }
    if (yield* place(ctx, session, 'angular', refs)) return;
  }
}

/** Radius or Diameter: a circle or arc. */
async function* circular(
  ctx: CommandContext,
  session: Session,
  kind: 'radial' | 'diameter',
): CommandGenerator {
  for (;;) {
    const a = yield* objectOnly(ctx, 'Select arc or circle');
    if (!a) return;
    if (yield* place(ctx, session, kind, [a])) return;
  }
}

function flow(
  ctx: CommandContext,
  session: Session,
  kind: DimensionalCommandKind,
): CommandGenerator {
  switch (kind) {
    case 'linear':
    case 'horizontal':
    case 'vertical':
      return linear(ctx, session, kind);
    case 'aligned':
      return aligned(ctx, session);
    case 'angular':
      return angular(ctx, session);
    default:
      return circular(ctx, session, kind);
  }
}

/** DIMCONSTRAINT's types, in its prompt's order, with AutoCAD's capitals. */
const KEYWORDS: Readonly<Record<DimensionalCommandKind, string>> = {
  linear: 'LInear',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  aligned: 'ALigned',
  angular: 'ANgular',
  radial: 'Radius',
  diameter: 'Diameter',
};

const FORM: Readonly<Record<Session['form'], string>> = {
  dynamic: 'Dynamic',
  annotational: 'Annotational',
};

/** The DC* commands' names. */
const COMMAND_NAMES: Readonly<Record<DimensionalCommandKind, string>> = {
  linear: 'DCLINEAR',
  horizontal: 'DCHORIZONTAL',
  vertical: 'DCVERTICAL',
  aligned: 'DCALIGNED',
  angular: 'DCANGULAR',
  radial: 'DCRADIUS',
  diameter: 'DCDIAMETER',
};

/**
 * DIMCONSTRAINT (DCON) and DCLINEAR … DCDIAMETER, sharing the Constraint Form. DIMCONSTRAINT
 * asks for the type (the last one its default, Aligned at first) or Form, then the type's
 * prompts.
 */
export function dimensionalConstraintCommands(): CommandDef[] {
  const session: Session = { form: 'dynamic' };
  let last: DimensionalCommandKind = 'aligned';
  const kinds = Object.keys(KEYWORDS) as DimensionalCommandKind[];
  const dimconstraint: CommandDef = {
    name: 'DIMCONSTRAINT',
    solvesConstraints: true,
    async *run(ctx) {
      await readForm(ctx, session);
      for (;;) {
        ctx.message(`Current settings: Constraint Form = ${FORM[session.form]}`);
        const a = yield ctx.prompt.point({
          message: 'Select associative dimension to convert or',
          pickbox: true,
          options: [...kinds.map((k) => KEYWORDS[k]), 'Form'],
          default: { kind: 'keyword', keyword: KEYWORDS[last] },
        });
        if (a.kind === 'point') {
          const dim = await dimensionAt(ctx, a.point);
          if (dim) {
            await convertDimensions(ctx, session, [dim.id]);
            return;
          }
          ctx.message(
            INVALID_OBJECT.replace(
              'a line, circle, arc or polyline segment',
              'an associative dimension',
            ),
          );
          continue;
        }
        if (a.kind !== 'keyword') return;
        if (a.keyword === 'Form') {
          const f = yield ctx.prompt.keyword({
            message: 'Enter constraint form',
            options: ['Annotational', 'Dynamic'],
            default: { kind: 'keyword', keyword: FORM[session.form] },
          });
          if (f.kind !== 'keyword') return;
          session.form = f.keyword === 'Annotational' ? 'annotational' : 'dynamic';
          await setOptionVariable(ctx, CCONSTRAINTFORM, session.form === 'annotational' ? 1 : 0);
          continue;
        }
        const kind = kinds.find((k) => KEYWORDS[k] === a.keyword);
        if (!kind) return;
        last = kind;
        yield* flow(ctx, session, kind);
        return;
      }
    },
  };
  const dcconvert: CommandDef = {
    name: 'DCCONVERT',
    solvesConstraints: true,
    usesSelection: 'during',
    async *run(ctx) {
      await readForm(ctx, session);
      const a = yield ctx.prompt.selection({ message: 'Select associative dimensions to convert' });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      await convertDimensions(ctx, session, a.ids);
    },
  };
  return [
    dcconvert,
    dimconstraint,
    ...kinds.map((kind) => ({
      name: COMMAND_NAMES[kind],
      solvesConstraints: true,
      async *run(ctx: CommandContext) {
        await readForm(ctx, session);
        yield* flow(ctx, session, kind);
      },
    })),
  ];
}
