// A multi-functional grip's functions at the grip prompt (M3-05 part 1): what each asks, as
// AutoCAD 2024 shows it once Ctrl has cycled to it ("** ADD VERTEX **", then the point), and
// the edit it makes. The geometry is `edit/grip-functions.ts`'s.
import type { Vec2 } from '../../geom/types';
import { reshapeObject } from '../../edit/edit';
import { ARRAY_GRIP_FUNCTIONS, gripInfoOf } from '../../edit/array-grips';
import {
  gripFunctionEdit,
  gripFunctionsOf,
  type GripFunction,
  type GripFunctionProblem,
} from '../../edit/grip-functions';
import { breakCurveOf } from '../../edit/break';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { ArcGeometry } from '../../model/types';
import type { CommandContext } from '../command';
import { GRIP_CYCLE, type Prompt, type PromptAnswer } from '../prompt';
import { toleranceFor } from './offset';
import { arrayGripAt } from './array-grips';

/** The grip mode names typed at a grip prompt, in GRIP_MODES' order. */
export const MODE_KEYWORDS = ['STretch', 'MOve', 'ROtate', 'SCale', 'MIrror'] as const;

/** The keyword each function is typed by (hidden: AutoCAD offers them in the grip's menu). */
const KEYWORD_OF: Readonly<Record<GripFunction, string>> = {
  Stretch: 'STretch',
  'Stretch Vertex': 'STretch',
  Lengthen: 'LEngthen',
  Radius: 'RAdius',
  'Add Vertex': 'ADd vertex',
  'Remove Vertex': 'REMove vertex',
  'Extend Vertex': 'EXTend vertex',
  'Convert to Arc': 'ARc',
  'Convert to Line': 'LIne',
};

/** Each function keyword's function; STretch is either Stretch, as the grip has it. */
export const FUNCTION_KEYWORDS: ReadonlyMap<string, GripFunction> = new Map(
  (Object.entries(KEYWORD_OF) as [GripFunction, string][])
    .filter(([f]) => f !== 'Stretch Vertex')
    .map(([f, k]) => [k, f]),
);

export interface GripFunctions {
  /** The object the functions edit: the first selected one with the hot grip that has them. */
  readonly id: EntityId;
  readonly functions: readonly GripFunction[];
  /** Their keywords, but STretch's (a grip mode name too). */
  readonly keywords: readonly string[];
}

/** The hot grip's functions, if one of `ids` has more than one there. */
export function functionsAt(
  model: DocumentModel,
  ids: readonly EntityId[],
  hot: Vec2,
): GripFunctions | undefined {
  for (const id of ids) {
    const e = model.entity(id);
    if (!e) continue;
    const functions = gripFunctionsOf(e.geom, hot, gripInfoOf(model, e));
    if (functions.length === 0) continue;
    // A function edits functions[0]'s match: Stretch Vertex is typed as STretch.
    const fixed = functions.map((f) => (f === 'Stretch Vertex' ? 'Stretch' : f));
    return {
      id,
      functions: fixed,
      keywords: fixed.slice(1).map((f) => KEYWORD_OF[f]),
    };
  }
  return undefined;
}

/**
 * What the hover menu of the grip at `hot` offers (M3-05 part 2): an array grip's functions, or
 * the first selected object with that grip's, by AutoCAD's names ("Stretch Vertex"); fewer than
 * two means no menu.
 */
export function gripMenuAt(
  model: DocumentModel,
  ids: readonly EntityId[],
  hot: Vec2,
): readonly string[] {
  const array = arrayGripAt(model, ids, hot);
  if (array) return ARRAY_GRIP_FUNCTIONS[array.role];
  for (const id of ids) {
    const e = model.entity(id);
    const functions = e ? gripFunctionsOf(e.geom, hot, gripInfoOf(model, e)) : [];
    if (functions.length > 0) return functions;
  }
  return [];
}

const PROBLEM: Readonly<Record<GripFunctionProblem, string>> = {
  invalid: 'The point gives no shape.',
  'too few': 'A polyline needs at least two vertices.',
  'too long': 'Arc cannot be full 360 degrees.',
};

/** What each function that takes a point asks. */
const ASKS: Readonly<Partial<Record<GripFunction, string>>> = {
  Lengthen: 'Specify new end point',
  Radius: 'Specify radius',
  'Add Vertex': 'Specify new vertex point',
  'Extend Vertex': 'Specify new vertex point',
  'Convert to Arc': 'Specify arc midpoint',
};

export type GripFunctionResult =
  /** The edit was made, or eXit or Esc: grip editing ends. */
  | { readonly kind: 'done' }
  /** Enter: on to MOVE. */
  | { readonly kind: 'enter' }
  /** Ctrl: on to the next function. */
  | { readonly kind: 'cycle' }
  /** A mode or function typed: the grip command goes there. */
  | { readonly kind: 'keyword'; readonly keyword: string }
  /** An immediate function that could not be done: back to STRETCH. */
  | { readonly kind: 'refused' };

/**
 * The function `fn` of the grip at `hot` on `id`: its prompt until it is done, or left for
 * another mode or function. `hidden`: the keywords typed at it (modes and the grip's functions).
 */
export async function* runGripFunction(
  ctx: CommandContext,
  id: EntityId,
  hot: Vec2,
  fn: GripFunction,
  hidden: readonly string[],
): AsyncGenerator<Prompt, GripFunctionResult, PromptAnswer> {
  const immediate = fn === 'Remove Vertex' || fn === 'Convert to Line';
  for (;;) {
    const e = ctx.model.entity(id);
    const c = e && breakCurveOf(e.geom);
    if (!e || !c) return { kind: 'done' };
    let to: Vec2 = hot;
    let radius: number | undefined;
    if (!immediate) {
      ctx.message(`** ${fn.toUpperCase()} **`);
      const common = {
        message: `${ASKS[fn]!} or`,
        options: ['eXit'],
        hiddenOptions: hidden,
        ctrlCycles: true as const,
        drag: { kind: 'grip' as const, ids: [id], grip: hot, from: hot, fn },
      };
      const arc = e.geom as ArcGeometry;
      const a =
        fn === 'Radius'
          ? yield ctx.prompt.distance({ ...common, base: arc.center })
          : yield ctx.prompt.point({ ...common, rubberBand: { from: hot } });
      if (a.kind === 'enter') return { kind: 'enter' };
      if (a.kind === 'keyword') {
        if (a.keyword === 'eXit') return { kind: 'done' };
        if (a.keyword === GRIP_CYCLE) return { kind: 'cycle' };
        return { kind: 'keyword', keyword: a.keyword };
      }
      if (a.kind === 'point') to = a.point;
      else if (a.kind === 'distance') radius = a.value;
      else return { kind: 'done' };
    }
    const tol = toleranceFor(ctx.model, c);
    const r =
      radius === undefined
        ? gripFunctionEdit(e.geom, hot, fn, to, tol, gripInfoOf(ctx.model, e))
        : // A typed radius is the radius itself, not a point's distance worked out again.
          radius > tol.linear
          ? { ...(e.geom as ArcGeometry), radius }
          : 'invalid';
    if (typeof r === 'string') {
      ctx.message(PROBLEM[r]);
      if (immediate) return { kind: 'refused' };
      continue;
    }
    ctx.edit((b) => reshapeObject(b, ctx.model, id, [r]));
    return { kind: 'done' };
  }
}
