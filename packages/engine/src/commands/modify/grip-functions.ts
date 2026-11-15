// A multi-functional grip's functions at the grip prompt (M3-05 part 1): what each asks, as
// AutoCAD 2024 shows it once Ctrl has cycled to it ("** ADD VERTEX **", then the point), and
// the edit it makes. The geometry is `edit/grip-functions.ts`'s.
import type { Vec2 } from '../../geom/types';
import { reshapeObject } from '../../edit/edit';
import { ARRAY_GRIP_FUNCTIONS, gripInfoOf } from '../../edit/array-grips';
import {
  COMMAND_FUNCTIONS,
  IMMEDIATE_FUNCTIONS,
  dimensionGripOverrides,
  dimensionLineEnd,
  gripFunctionEdit,
  gripFunctionValue,
  gripFunctionsOf,
  type GripFunction,
  type GripFunctionProblem,
} from '../../edit/grip-functions';
import { withDimvarOverride } from '../../annotation/dstyle';
import { regenerateDimensions } from './dimensions';
import { breakCurveOf } from '../../edit/break';
import { toleranceForSize, type Tolerance } from '../../geom/tolerance';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { ArcGeometry, DimensionGeometry, Entity, EntityGeometry } from '../../model/types';
import type { CommandContext } from '../command';
import { GRIP_CYCLE, type Prompt, type PromptAnswer, type ShortcutMenuItem } from '../prompt';
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
  'Origin Point': 'ORigin point',
  'Hatch Angle': 'ANgle',
  'Hatch Scale': 'HAtch scale',
  'Continue Dimension': 'COntinue dimension',
  'Baseline Dimension': 'BAseline dimension',
  'Flip Arrow': 'FLip arrow',
  'Move with Dim Line': 'DIm line',
  'Move Text Only': 'TExt only',
  'Move with Leader': 'LEader',
  'Above Dim Line': 'ABove dim line',
  'Center Vertically': 'CEnter vertically',
  'Reset Text Position': 'REset text position',
  'Lengthen Landing': 'LAnding',
};

/** Each function keyword's function; STretch is either Stretch, as the grip has it. */
export const FUNCTION_KEYWORDS: ReadonlyMap<string, GripFunction> = new Map(
  (Object.entries(KEYWORD_OF) as [GripFunction, string][])
    .filter(([f]) => f !== 'Stretch Vertex')
    .map(([f, k]) => [k, f]),
);

/**
 * Properties on the grip menu (M3-05 part 5), typed PR at any grip prompt: grip editing ends and
 * the Properties palette opens on the objects, which stay selected.
 */
export const PROPERTIES_KEYWORD = 'PRoperties';

/**
 * The grip modes' right-click menu (M3-05 part 5; AutoCAD 2024 Help, "To Use Grips to Stretch,
 * Move, Rotate, Scale or Mirror Objects", and its grip shortcut menu): Enter, the modes in the
 * menu's order (Move, Mirror, Rotate, Scale, Stretch), Base Point, Copy, Reference, Undo,
 * Properties and Exit. A multi-functional grip's functions follow Enter, by the names its hover
 * menu shows (Help shows them in the hover menu only; listing them here too keeps the
 * right-click a way to every function, the common expectation). `accepts`: the keywords the
 * prompt takes; the others are greyed (Reference outside ROTATE and SCALE).
 */
export function gripShortcutMenu(
  accepts: readonly string[],
  functions: readonly GripFunction[] = [],
): ShortcutMenuItem[] {
  const item = (label: string, keyword?: string, separatorBefore?: boolean): ShortcutMenuItem => ({
    label,
    ...(keyword !== undefined && { keyword }),
    ...(keyword !== undefined && !accepts.includes(keyword) && { disabled: true as const }),
    ...(separatorBefore && { separatorBefore: true as const }),
  });
  // A plain Stretch first function is the Stretch mode, listed with the modes.
  const own = functions.filter((f) => f !== 'Stretch');
  return [
    item('Enter'),
    ...own.map((f, i) => item(f, KEYWORD_OF[f], i === 0)),
    item('Move', 'MOve', true),
    item('Mirror', 'MIrror'),
    item('Rotate', 'ROtate'),
    item('Scale', 'SCale'),
    item('Stretch', 'STretch'),
    item('Base Point', 'Base point', true),
    item('Copy', 'Copy'),
    item('Reference', 'Reference'),
    item('Undo', 'Undo'),
    item('Properties', PROPERTIES_KEYWORD, true),
    item('Exit', 'eXit', true),
  ];
}

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
  'Origin Point': 'Specify origin point',
  'Hatch Angle': 'Specify hatch angle',
  'Hatch Scale': 'Specify hatch scale',
  'Move with Dim Line': 'Specify point to place text',
  'Move Text Only': 'Specify point to place text',
  'Move with Leader': 'Specify point to place text',
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
  | { readonly kind: 'refused' }
  /** Continue or Baseline Dimension: DIMCONTINUE or DIMBASELINE from the origin `from`. */
  | { readonly kind: 'chain'; readonly baseline: boolean; readonly from: Vec2 };

/**
 * The function `fn` of the grip at `hot` on `id`: its prompt until it is done, or left for
 * another mode or function. `hidden`: the keywords typed at it (modes and the grip's functions);
 * `menu`: its right-click menu (M3-05 part 5).
 */
export async function* runGripFunction(
  ctx: CommandContext,
  id: EntityId,
  hot: Vec2,
  fn: GripFunction,
  hidden: readonly string[],
  menu?: readonly ShortcutMenuItem[],
): AsyncGenerator<Prompt, GripFunctionResult, PromptAnswer> {
  const immediate = IMMEDIATE_FUNCTIONS.has(fn);
  for (;;) {
    const e = ctx.model.entity(id);
    if (!e) return { kind: 'done' };
    if (COMMAND_FUNCTIONS.has(fn)) {
      const d = e.geom as Extract<DimensionGeometry, { dimType: 'linear' | 'aligned' }>;
      const end = dimensionLineEnd(d, hot);
      return {
        kind: 'chain',
        baseline: fn === 'Baseline Dimension',
        from: end === 1 ? d.second : d.first,
      };
    }
    let to: Vec2 = hot;
    let value: number | undefined;
    if (!immediate) {
      ctx.message(`** ${fn.toUpperCase()} **`);
      const common = {
        message: `${ASKS[fn]!} or`,
        options: ['eXit'],
        hiddenOptions: hidden,
        ctrlCycles: true as const,
        ...(menu && { shortcutMenu: menu }),
        drag: { kind: 'grip' as const, ids: [id], grip: hot, from: hot, fn },
      };
      const a =
        fn === 'Radius'
          ? yield ctx.prompt.distance({ ...common, base: (e.geom as ArcGeometry).center })
          : fn === 'Hatch Scale'
            ? yield ctx.prompt.distance({ ...common, base: hot })
            : fn === 'Hatch Angle'
              ? yield ctx.prompt.angle({ ...common, base: hot })
              : yield ctx.prompt.point({ ...common, rubberBand: { from: hot } });
      if (a.kind === 'enter') return { kind: 'enter' };
      if (a.kind === 'keyword') {
        if (a.keyword === 'eXit') return { kind: 'done' };
        if (a.keyword === GRIP_CYCLE) return { kind: 'cycle' };
        return { kind: 'keyword', keyword: a.keyword };
      }
      if (a.kind === 'point') to = a.point;
      else if (a.kind === 'distance' || a.kind === 'angle') value = a.value;
      else return { kind: 'done' };
    }
    const tol = toleranceOf(ctx.model, e.geom, hot);
    const r =
      value === undefined
        ? gripFunctionEdit(e.geom, hot, fn, to, tol, gripInfoOf(ctx.model, e))
        : // A typed value is the radius, angle or scale itself, not a point's worked out again.
          gripFunctionValue(e.geom, fn as 'Radius' | 'Hatch Angle' | 'Hatch Scale', value, tol);
    if (typeof r === 'string') {
      ctx.message(PROBLEM[r]);
      if (immediate) return { kind: 'refused' };
      continue;
    }
    if ('dimType' in r) {
      await editDimension(ctx, e, r, fn);
      return { kind: 'done' };
    }
    ctx.edit((b) => reshapeObject(b, ctx.model, id, [r]));
    return { kind: 'done' };
  }
}

/**
 * A dimension's grip function done: its new geometry, with the DIMVAR overrides the function
 * sets on it (M3-05 part 4), and the dimension drawn afresh, in one undo step.
 */
async function editDimension(
  ctx: CommandContext,
  e: Entity,
  geom: DimensionGeometry,
  fn: GripFunction,
): Promise<void> {
  let xdata = e.xdata;
  for (const [name, value] of dimensionGripOverrides(fn)) {
    const x = withDimvarOverride(xdata ? { xdata } : {}, geom.style, ctx.model, name, value);
    // A drawing without the ACAD application keeps no overrides: the geometry still changes.
    if (x !== 'no-acad') xdata = x;
  }
  ctx.edit((b) => {
    b.updateEntity(e.id, { geom, ...(xdata !== e.xdata && { xdata }) });
  });
  await regenerateDimensions(ctx, [e.id]);
}

/**
 * The tolerance a function's edit is made to: a curve's, else one for the drawing's extents and
 * the grip (a hatch's).
 */
function toleranceOf(model: DocumentModel, geom: EntityGeometry, hot: Vec2): Tolerance {
  const c = breakCurveOf(geom);
  if (c) return toleranceFor(model, c);
  const min = model.header.get('$EXTMIN');
  const max = model.header.get('$EXTMAX');
  const isPoint = (v: unknown): v is Vec2 =>
    typeof v === 'object' && v !== null && 'x' in v && 'y' in v;
  // Empty extents (AutoCAD writes min 1e20, max -1e20) say nothing.
  const box =
    isPoint(min) && isPoint(max) && min.x <= max.x && min.y <= max.y ? [min, max, hot] : [hot];
  return toleranceForSize(Math.max(...box.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))));
}
