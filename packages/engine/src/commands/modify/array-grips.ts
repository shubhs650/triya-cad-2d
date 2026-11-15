// Editing an associative array by its grips (M3-11 part 3): a click on one of an array's
// triangle grips (or a polar array's base grip) makes it hot and asks for what its first function
// sets; AutoCAD's hover menu offers the grip's other functions, which the prompt offers as
// options. A pick sets it as dragging the grip there would, and a typed number is the count,
// distance or angle itself. The array is remade in one undo step and stays selected.
import type { Vec2 } from '../../geom/types';
import {
  applyArrayGripEdit,
  arrayGripEdit,
  ARRAY_GRIP_FUNCTIONS,
  arrayGripsOf,
  functionValue,
  type ArrayGripInput,
  type ArrayGripRole,
} from '../../edit/array-grips';
import { sameGrip } from '../../edit/grips';
import { sourceEditOf } from '../../edit/assoc-array';
import type { EntityId } from '../../model/entity-ids';
import type { DocumentModel } from '../../model/document';
import type { CommandContext } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { parseAngleValue, parseDistance, parseNumber } from '../parse';
import { drawingUnits } from '../units';

/** The array grip at `hot` of one of `ids`, if it is one (the first array that has it). */
export function arrayGripAt(
  model: DocumentModel,
  ids: readonly EntityId[],
  hot: Vec2,
): { id: EntityId; role: ArrayGripRole } | undefined {
  for (const id of ids) {
    const e = model.entity(id);
    const found = e && arrayGripsOf(model, e);
    const grip = found?.grips.find((g) => g.array && sameGrip(g.point, hot));
    if (grip) return { id, role: grip.array! };
  }
  return undefined;
}

/** What each function asks, as AutoCAD words its array prompts. */
const ASKS: Readonly<Record<string, string>> = {
  'Column spacing': 'Specify the distance between columns',
  'Row spacing': 'Specify the distance between rows',
  'Column count': 'Specify number of columns',
  'Row count': 'Specify number of rows',
  'Row and column count': 'Specify number of rows and columns',
  'Stretch radius': 'Specify radius',
  'Item angle': 'Specify the angle between items',
  'Fill angle': 'Specify the angle to fill',
  Count: 'Specify number of items',
  'Item spacing': 'Specify the distance between items',
};

/** "Total spacing" asks for the distance between the first and last of what the grip counts. */
const TOTAL: Readonly<Partial<Record<ArrayGripRole, string>>> = {
  columnCount: 'Specify the distance between first and last columns',
  rowCount: 'Specify the distance between first and last rows',
  corner: 'Specify the distance between first and last rows and columns',
};

/** A typed answer read as the function's value; a message when it does not read. */
function typedValue(
  model: DocumentModel,
  role: ArrayGripRole,
  fn: string,
  text: string,
): number | string {
  const kind = functionValue(role, fn);
  const v =
    kind === 'angle'
      ? parseAngleValue(text)
      : kind === 'distance'
        ? parseDistance(text, drawingUnits(model.header).lunits)
        : kind === 'count'
          ? parseNumber(text)
          : undefined;
  if (v !== undefined) return v;
  return kind === 'point'
    ? 'Requires a point.'
    : kind === 'count'
      ? 'Requires an integer.'
      : 'Invalid input.';
}

/** The array `id` edited by its grip `role` at `hot`, until a value is given, eXit or Esc. */
export async function* editArrayByGrip(
  ctx: CommandContext,
  id: EntityId,
  role: ArrayGripRole,
  hot: Vec2,
): AsyncGenerator<Prompt, void, PromptAnswer> {
  const functions = ARRAY_GRIP_FUNCTIONS[role];
  let fn = functions[0]!;
  for (;;) {
    const insert = ctx.model.entity(id);
    const record = insert && arrayGripsOf(ctx.model, insert)?.record;
    if (!insert || !record) return;
    if (sourceEditOf(ctx.model)?.insert === insert.handle) {
      ctx.message('An array is being edited: save or discard its changes with ARRAYCLOSE first.');
      return;
    }
    ctx.message(`** ${fn.toUpperCase()} **`);
    const options = [...functions.filter((f) => f !== fn), 'eXit'];
    const a = yield ctx.prompt.point({
      message: `${fn === 'Total spacing' ? TOTAL[role]! : ASKS[fn]!} or`,
      options,
      rubberBand: { from: hot },
      arbitrary: true,
    });
    if (a.kind === 'keyword') {
      if (a.keyword === 'eXit') return;
      fn = a.keyword;
      continue;
    }
    let input: ArrayGripInput;
    if (a.kind === 'point') input = { point: a.point };
    else if (a.kind === 'string') {
      const v = typedValue(ctx.model, role, fn, a.value);
      if (typeof v === 'string') {
        ctx.message(v);
        continue;
      }
      input = { value: v };
    } else return;
    const edit = arrayGripEdit(ctx.model, insert, record, role, fn, input);
    if (typeof edit === 'string') {
      ctx.message(edit);
      continue;
    }
    let problem: string | undefined;
    ctx.edit((b) => {
      problem = applyArrayGripEdit(b, ctx.model, insert, record, edit);
    });
    if (problem) ctx.message(`The array cannot be remade: ${problem}.`);
    return;
  }
}
