// ARRAY (M3-03): ARRAY, ARRAYRECT, ARRAYPOLAR, ARRAYPATH and the classic -ARRAY, with AutoCAD
// 2024's prompts (AutoCAD 2024 Help: "ARRAY (Command)", "ARRAYRECT (Command)", "ARRAYPOLAR
// (Command)", "ARRAYPATH (Command)", "-ARRAY (Command)").
//
// As in AutoCAD, the array is made at once (4 columns by 3 rows, 6 items round a circle, items
// filling the path) and each option at "Select grip to edit array" remakes it, so the drafter
// watches it change; Enter or eXit keeps it, and so does Esc, since every edit a command made is
// kept when it is cancelled (as Esc keeps LINE's segments).
//
// An array is associative (one array object, M3-11) or separate objects, as ARRAYASSOCIATIVITY
// says (initially 1, as AutoCAD's) and the ASsociative option sets. While its options are edited
// the array is shown as separate copies; when it ends (Enter, eXit or Esc) an associative one is
// made into the array object (`edit/assoc-array.ts`, saved with its TRIYA_ARRAY record, DEC-059),
// which ARRAYEDIT changes. An associative array object made in AutoCAD (its ACDBASSOC* action
// objects) read from a file is kept as it is and saved back untouched. The 3D options (Levels, the
// incrementing row elevation, Z direction, Axis of rotation) and the Expression and Key point
// options are not offered: Triya draws in the XY plane and has no parameter expressions.
//
// Ambiguity, noted for the PR: AutoCAD's help does not say how it chooses the default spacings.
// Here the column, row and path item spacings start at 1.5 × the selection's width and height
// (the larger of the two for rows round a circle or along a path), which leaves a half-size gap
// between items, as AutoCAD's defaults look on screen.
import { followCenterMarks } from '../../edit/center-marks';
import { followLeaderBreaks } from '../../edit/leader-breaks';
import { removeCopies } from '../../edit/groups';
import type { Box } from '../../geom/bounds';
import type { Vec2 } from '../../geom/types';
import { distance, sub } from '../../geom/vec';
import { toleranceForSize } from '../../geom/tolerance';
import {
  arrayPath,
  MAX_ARRAY_ITEMS,
  measureMaxItems,
  pathCurveOf,
  pathFrame,
  pathItems,
  pathLength,
  pathStart,
  polarAngleBetween,
  polarItems,
  rectangularItems,
  type ArrayPath,
} from '../../edit/array';
import { carryConstraints, type ParameterCopyMode } from '../../edit/constraint-copy';
import { copyObjects, refusalMessages, transformObjects, type EditReport } from '../../edit/edit';
import {
  arrayItemAt,
  assocArrayOf,
  assocItems,
  closeSourceEdit,
  dropSourceEdit,
  insertMatrix,
  localParams,
  makeAssocArray,
  openSourceEdit,
  rebaseRectangular,
  remakeAssocArray,
  replacementBlock,
  sameItem,
  sourceEditIds,
  sourceEditOf,
  syncSourceEdit,
} from '../../edit/assoc-array';
import { applyPoint, compose, invert } from '../../geom/transform';
import type { ChangeSetBuilder } from '../../model/builder';
import type { ChangeSet } from '../../model/changeset';
import type { Handle } from '../../model/handle';
import {
  isAssocArray as isAssocArrayObject,
  type AssocArray,
  type AssocArrayParams,
  type Entity,
  type InsertGeometry,
} from '../../model/types';
import { currentProps } from '../../properties/current';
import type { Similarity } from '../../edit/similarity';
import type { TransformOptions } from '../../edit/transform';
import type { EntityId } from '../../model/entity-ids';
import type { DocumentModel } from '../../model/document';
import { endPoint, startPoint } from '../../geom/eval';
import { entityBounds } from '../../spatial/entity-bounds';
import type { Prompt, PromptAnswer } from '../prompt';
import { parseDistance } from '../parse';
import { drawingUnits, formatNumber } from '../units';
import type { CommandContext, CommandDef } from '../command';
import { parameterCopyModeOf } from '../constraint-upkeep';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const EDIT_PROMPT = 'Select grip to edit array or';
const TOO_MANY = `The array cannot have more than ${MAX_ARRAY_ITEMS} items.`;
const NOT_POSITIVE = 'Value must be positive and nonzero.';

function mirrorOptions(model: DocumentModel): TransformOptions {
  const on = (name: string) => {
    const v = model.header.get(name);
    return v === 1 || v === true;
  };
  return { mirrorText: on('$MIRRTEXT'), mirrorHatch: on('$MIRRHATCH') };
}

async function* selectObjects(ctx: CommandContext): Sub<readonly EntityId[]> {
  const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
  return a.kind === 'selection' ? a.ids : [];
}

/**
 * The selection's extents: the renderer's (text and blocks included) when there is one, else
 * the objects' own geometric bounds (scripts and tests), else a unit square at the origin.
 */
async function extentsOf(ctx: CommandContext, ids: readonly EntityId[]): Promise<Box> {
  const reply = await ctx.view.request({ op: 'bounds', ids });
  if (reply.ok && reply.box) return reply.box;
  let box: Box | undefined;
  const tol = toleranceForSize(1);
  for (const id of ids) {
    const e = ctx.model.entity(id);
    if (!e) continue;
    const b = entityBounds(e.geom, { tol, blockExtents: () => 'unknown' });
    if (b.kind !== 'box') continue;
    box = box
      ? {
          minX: Math.min(box.minX, b.box.minX),
          minY: Math.min(box.minY, b.box.minY),
          maxX: Math.max(box.maxX, b.box.maxX),
          maxY: Math.max(box.maxY, b.box.maxY),
        }
      : b.box;
  }
  return box ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

const centreOf = (b: Box): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/**
 * 1.5 × a size of the selection; a selection with no size that way (a horizontal line's
 * height) takes the other size, and a point 1.
 */
const defaultSpacing = (size: number, other = 0): number =>
  size > 0 ? size * 1.5 : other > 0 ? other * 1.5 : 1;

const isIdentity = (t: Similarity): boolean =>
  Math.abs(t.m.a - 1) <= 1e-12 &&
  Math.abs(t.m.b) <= 1e-12 &&
  Math.abs(t.m.c) <= 1e-12 &&
  Math.abs(t.m.d - 1) <= 1e-12 &&
  t.m.e === 0 &&
  t.m.f === 0;

/**
 * The array as the drawing shows it while its options are edited: the source objects stay
 * where they are as item 0 and every other item is a copy, remade as a whole each time.
 * When item 0 is not where the source is (a path array whose base point is off the path), a
 * copy stands for it until the end, when the source itself is carried there, so the array
 * keeps the source's handles.
 */
class LiveArray {
  #copies: EntityId[] = [];
  #first: EntityId[] = [];
  #item0: Similarity | undefined;
  #refused: ReadonlyMap<string, number> = new Map();
  #unannotated = 0;

  /** `mode`: PARAMETERCOPYMODE, what each item carries of the constraints among `ids` (M9-10). */
  constructor(
    readonly ids: readonly EntityId[],
    readonly mode: ParameterCopyMode = 1,
  ) {}

  show(ctx: CommandContext, items: readonly Similarity[]): void {
    const o = mirrorOptions(ctx.model);
    ctx.edit((b) => {
      removeCopies(b, this.#copies);
      this.#copies = [];
      this.#first = [];
      const refused = new Map<string, number>();
      let unannotated = 0;
      items.forEach((t, i) => {
        if (i === 0 && isIdentity(t)) return;
        const r = copyObjects(b, ctx.model, this.ids, t, o);
        carryConstraints(b, ctx.model, r.copies, t, this.mode);
        if (i === 0) this.#first = [...r.ids];
        this.#copies.push(...r.ids);
        unannotated = Math.max(unannotated, r.unannotated);
        for (const [k, n] of r.refused) refused.set(k, Math.max(refused.get(k) ?? 0, n));
      });
      this.#refused = refused;
      this.#unannotated = unannotated;
    });
    this.#item0 = items[0] && !isIdentity(items[0]) ? items[0] : undefined;
  }

  /** Puts the source in item 0's place and says what could not be arrayed. */
  finish(ctx: CommandContext): void {
    const item0 = this.#item0;
    if (item0) {
      const first = new Set(this.#first);
      ctx.edit((b) => {
        removeCopies(b, [...first]);
        transformObjects(b, ctx.model, this.ids, item0, mirrorOptions(ctx.model));
      });
      this.#copies = this.#copies.filter((id) => !first.has(id));
    }
    for (const line of refusalMessages(this.#refused, 'arrayed')) ctx.message(line);
    if (this.#unannotated > 0) {
      const n = this.#unannotated;
      ctx.message(
        `${n} ${n === 1 ? 'object is' : 'objects are'} arrayed without annotation scales (annotative copies are not saved yet).`,
      );
    }
  }

  /**
   * Takes the copies away and makes the associative array of the source objects in the same
   * edit (`make`), saying what it could not take in.
   */
  associate(ctx: CommandContext, make: (b: ChangeSetBuilder) => EditReport): void {
    let report: EditReport | undefined;
    ctx.edit((b) => {
      removeCopies(b, this.#copies);
      report = make(b);
    });
    this.#copies = [];
    for (const line of refusalMessages(report!.refused, 'arrayed')) ctx.message(line);
  }
}

// Esc cancels a command without answering its prompt, so each prompt below is answered by its
// kind or, where its default stands, by Enter: the helpers turn any other answer into the
// default rather than ending the array.

/** One of `options`, `current` by default. */
async function* choose(
  ctx: CommandContext,
  message: string,
  options: readonly string[],
  current: string,
): Sub<string> {
  const a = yield ctx.prompt.keyword({
    message,
    options,
    default: { kind: 'keyword', keyword: current },
  });
  return a.kind === 'keyword' ? a.keyword : current;
}

async function* yesNo(ctx: CommandContext, message: string, current: boolean): Sub<boolean> {
  return (yield* choose(ctx, message, ['Yes', 'No'], current ? 'Yes' : 'No')) === 'Yes';
}

/** A count of at least `min`, `current` by default. */
async function* count(ctx: CommandContext, message: string, current: number, min = 1): Sub<number> {
  for (;;) {
    const a = yield ctx.prompt.integer({ message, default: { kind: 'number', value: current } });
    const value = a.kind === 'number' ? a.value : current;
    if (value >= min) return value;
    ctx.message(min > 1 ? `Value must be an integer greater than ${min - 1}.` : NOT_POSITIVE);
  }
}

/** A spacing (a number or two points), or the Total from the first to the last. */
async function* spacing(
  ctx: CommandContext,
  message: string,
  current: number,
  n: number,
  totalMessage?: string,
): Sub<number> {
  for (;;) {
    const a = yield ctx.prompt.distance({
      message: totalMessage ? `${message} or` : message,
      ...(totalMessage && { options: ['Total'] }),
      default: { kind: 'distance', value: current },
    });
    if (a.kind === 'distance') {
      if (a.value !== 0) return a.value;
      ctx.message(NOT_POSITIVE);
      continue;
    }
    if (!totalMessage) return current;
    const t = yield ctx.prompt.distance({
      message: totalMessage,
      default: { kind: 'distance', value: current * Math.max(n - 1, 1) },
    });
    if (t.kind !== 'distance') return current;
    if (t.value === 0) {
      ctx.message(NOT_POSITIVE);
      continue;
    }
    return t.value / Math.max(n - 1, 1);
  }
}

/** "Specify base point <centroid>": a point, or Enter for `fallback`. */
async function* basePoint(ctx: CommandContext, fallback: Vec2, label: string): Sub<Vec2> {
  const a = yield ctx.prompt.point({ message: 'Specify base point', defaultLabel: label });
  return a.kind === 'point' ? a.point : fallback;
}

/** Two points, the second rubber-banded from the first (a unit cell's corners, a vector). */
async function* twoPoints(
  ctx: CommandContext,
  first: string,
  second: string,
  box: boolean,
): Sub<[Vec2, Vec2] | undefined> {
  const p = yield ctx.prompt.point({ message: first });
  if (p.kind !== 'point') return undefined;
  const q = yield ctx.prompt.point({ message: second, rubberBand: { from: p.point, box } });
  return q.kind === 'point' ? [p.point, q.point] : undefined;
}

/** A turn the drafter typed or picked, as a signed sweep (+ counterclockwise), ANGBASE and ANGDIR aside. */
function sweepOf(ctx: CommandContext, worldAngle: number): number {
  const base = ctx.model.header.get('$ANGBASE');
  const dir = ctx.model.header.get('$ANGDIR');
  const rel = worldAngle - (typeof base === 'number' ? base : 0);
  return dir === 1 || dir === true ? -rel : rel;
}

/** A sweep in degrees as the prompts show it: `360`, `-90`, `22.5`. */
function sweepText(ctx: CommandContext, sweep: number): string {
  const degrees = (sweep * 180) / Math.PI;
  const r = Math.round(degrees * 1e8) / 1e8;
  return formatNumber(r, Number.isInteger(r) ? 0 : drawingUnits(ctx.model.header).auprec);
}

const tooMany = (ctx: CommandContext, items: number): boolean => {
  if (items <= MAX_ARRAY_ITEMS) return false;
  ctx.message(TOO_MANY);
  return true;
};

/** The edit loop's answer: an option, or undefined when Enter, eXit or Esc ends the command. */
async function* editOption(
  ctx: CommandContext,
  options: readonly string[],
): Sub<string | undefined> {
  const a = yield ctx.prompt.keyword({
    message: EDIT_PROMPT,
    options: [...options, 'eXit'],
    default: { kind: 'keyword', keyword: 'eXit' },
  });
  return a.kind === 'keyword' && a.keyword !== 'eXit' ? a.keyword : undefined;
}

// ── Associative arrays (M3-11) ──────────────────────────────────────────────────────────────

const ASSOCIATIVITY = 'ARRAYASSOCIATIVITY';

/** ARRAYASSOCIATIVITY as the app keeps it: on (AutoCAD's initial 1) unless it says 0. */
async function associativity(ctx: CommandContext): Promise<boolean> {
  const r = await ctx.view.request({ op: 'sysvar', name: ASSOCIATIVITY });
  return !(r.ok && r.value === 0);
}

/** The ASsociative option: Yes or No, kept as ARRAYASSOCIATIVITY for the next array. */
async function* associative(ctx: CommandContext, current: boolean): Sub<boolean> {
  const on = yield* yesNo(ctx, 'Create associative array', current);
  await ctx.view.request({ op: 'sysvar', name: ASSOCIATIVITY, value: on ? 1 : 0 });
  return on;
}

const typeLine = (type: string, on: boolean): string =>
  `Type = ${type}  Associative = ${on ? 'Yes' : 'No'}`;

/**
 * Ends the array: separate objects stay as the live array made them; an associative one
 * replaces them with the array object, made from the source objects where they were.
 */
function finish(
  ctx: CommandContext,
  live: LiveArray,
  on: boolean,
  world: () => { params: AssocArrayParams; origin: Vec2 },
): void {
  if (!on) return live.finish(ctx);
  const { params, origin } = world();
  live.associate(ctx, (b) => {
    const r = makeAssocArray(b, ctx.model, live.ids, {
      space: ctx.space,
      props: currentProps(ctx.model),
      origin,
      params: localParams(params, origin),
      transform: mirrorOptions(ctx.model),
    });
    if (r.insert) ctx.setPrevious([r.insert.id]);
    return r.report;
  });
}

// ── Each type's options, shared by ARRAY and ARRAYEDIT ──────────────────────────────────────

interface RectState {
  columns: number;
  rows: number;
  columnSpacing: number;
  rowSpacing: number;
}

async function* rectOption(ctx: CommandContext, option: string, s: RectState): Sub<void> {
  if (option === 'COUnt') {
    const c = yield* count(ctx, 'Enter number of columns', s.columns);
    const r = yield* count(ctx, 'Enter number of rows', s.rows);
    if (!tooMany(ctx, c * r)) Object.assign(s, { columns: c, rows: r });
  } else if (option === 'Spacing') {
    const a = yield ctx.prompt.distance({
      message: 'Specify the distance between columns or',
      options: ['Unit cell'],
      default: { kind: 'distance', value: s.columnSpacing },
    });
    if (a.kind === 'keyword') {
      const cell = yield* twoPoints(
        ctx,
        'Specify first corner of unit cell',
        'Specify other corner',
        true,
      );
      const d = cell ? sub(cell[1], cell[0]) : { x: 0, y: 0 };
      if (d.x === 0 || d.y === 0) ctx.message(NOT_POSITIVE);
      else Object.assign(s, { columnSpacing: d.x, rowSpacing: d.y });
    } else {
      const c = a.kind === 'distance' ? a.value : s.columnSpacing;
      const r = yield* spacing(ctx, 'Specify the distance between rows', s.rowSpacing, s.rows);
      if (c === 0) ctx.message(NOT_POSITIVE);
      else Object.assign(s, { columnSpacing: c, rowSpacing: r });
    }
  } else if (option === 'COLumns') {
    const c = yield* count(ctx, 'Enter number of columns', s.columns);
    if (tooMany(ctx, c * s.rows)) return;
    const d = yield* spacing(
      ctx,
      'Specify the distance between columns',
      s.columnSpacing,
      c,
      'Specify the total distance between first and last columns',
    );
    Object.assign(s, { columns: c, columnSpacing: d });
  } else {
    // Rows
    const r = yield* count(ctx, 'Enter the number of rows', s.rows);
    if (tooMany(ctx, r * s.columns)) return;
    const d = yield* spacing(
      ctx,
      'Specify the distance between rows',
      s.rowSpacing,
      r,
      'Specify the total distance between start and end rows',
    );
    Object.assign(s, { rows: r, rowSpacing: d });
  }
}

interface PolarState {
  items: number;
  fillAngle: number;
  rows: number;
  rowSpacing: number;
  rotateItems: boolean;
}

/** A polar option; `center` is the centre where the drafter sees it, for the angle prompts. */
async function* polarOption(
  ctx: CommandContext,
  option: string,
  s: PolarState,
  center: Vec2,
): Sub<void> {
  if (option === 'Items') {
    const n = yield* count(ctx, 'Enter number of items in array', s.items);
    if (!tooMany(ctx, n * s.rows)) s.items = n;
  } else if (option === 'Angle between') {
    const step = polarAngleBetween(s.items, s.fillAngle);
    const a = yield ctx.prompt.angle({
      turn: true,
      message: 'Specify angle between items',
      defaultLabel: sweepText(ctx, step),
      base: center,
    });
    if (a.kind !== 'angle') return;
    const between = sweepOf(ctx, a.value);
    // Items that close the circle exactly fill it; otherwise the last item ends the fill.
    const closes = Math.abs(Math.abs(between * s.items) - 2 * Math.PI) <= 1e-9;
    const fill = closes ? Math.sign(between) * 2 * Math.PI : between * Math.max(s.items - 1, 1);
    if (between === 0) ctx.message(NOT_POSITIVE);
    else if (Math.abs(fill) > 2 * Math.PI + 1e-9) {
      ctx.message('The fill angle cannot exceed 360 degrees.');
    } else s.fillAngle = fill;
  } else if (option === 'Fill angle') {
    const a = yield ctx.prompt.angle({
      turn: true,
      message: 'Specify the angle to fill (+=ccw, -=cw)',
      defaultLabel: sweepText(ctx, s.fillAngle),
      base: center,
    });
    if (a.kind !== 'angle') return;
    const fill = sweepOf(ctx, a.value);
    if (fill === 0) ctx.message(NOT_POSITIVE);
    else if (Math.abs(fill) > 2 * Math.PI + 1e-9) {
      ctx.message('The fill angle cannot exceed 360 degrees.');
    } else s.fillAngle = fill;
  } else if (option === 'ROWs') {
    const r = yield* count(ctx, 'Enter number of rows', s.rows);
    if (tooMany(ctx, r * s.items)) return;
    const d = yield* spacing(
      ctx,
      'Specify the distance between rows',
      s.rowSpacing,
      r,
      'Specify the total distance between start and end rows',
    );
    Object.assign(s, { rows: r, rowSpacing: d });
  } else {
    // ROTate items
    s.rotateItems = yield* yesNo(ctx, 'Rotate arrayed items?', s.rotateItems);
  }
}

interface PathState {
  method: 'measure' | 'divide';
  spacing: number;
  items: number;
  rows: number;
  rowSpacing: number;
  align: boolean;
}

async function* pathOption(
  ctx: CommandContext,
  option: string,
  s: PathState,
  path: ArrayPath,
): Sub<void> {
  if (option === 'Method') {
    const method = yield* choose(
      ctx,
      'Enter path method',
      ['Divide', 'Measure'],
      s.method === 'divide' ? 'Divide' : 'Measure',
    );
    s.method = method === 'Divide' ? 'divide' : 'measure';
    if (s.method === 'measure') s.items = Math.min(s.items, measureMaxItems(path, s.spacing));
  } else if (option === 'Items') {
    if (s.method === 'divide') {
      const n = yield* count(ctx, 'Enter number of items along path', s.items);
      if (!tooMany(ctx, n * s.rows)) s.items = n;
      return;
    }
    const d = yield ctx.prompt.distance({
      message: 'Specify the distance between items along path',
      default: { kind: 'distance', value: s.spacing },
    });
    const step = d.kind === 'distance' ? d.value : s.spacing;
    if (!(step > 0)) {
      ctx.message(NOT_POSITIVE);
      return;
    }
    const max = measureMaxItems(path, step);
    ctx.message(`Maximum items = ${max}`);
    const n = yield ctx.prompt.integer({
      message: 'Specify number of items or',
      options: ['Fill entire path'],
      default: { kind: 'number', value: max },
    });
    // Fill entire path, or Enter: the most there is room for.
    const items = n.kind === 'number' ? n.value : max;
    if (items < 1 || items > max) {
      ctx.message(`Value must be between 1 and ${max}.`);
      return;
    }
    if (!tooMany(ctx, items * s.rows)) Object.assign(s, { spacing: step, items });
  } else if (option === 'Rows') {
    const r = yield* count(ctx, 'Enter number of rows', s.rows);
    if (tooMany(ctx, r * s.items)) return;
    const d = yield* spacing(
      ctx,
      'Specify the distance between rows',
      s.rowSpacing,
      r,
      'Specify the total distance between start and end rows',
    );
    Object.assign(s, { rows: r, rowSpacing: d });
  } else {
    // Align items
    s.align = yield* yesNo(ctx, 'Align arrayed items to the path?', s.align);
  }
}

// ── ARRAYRECT ───────────────────────────────────────────────────────────────────────────────

async function* rectangular(ctx: CommandContext, ids: readonly EntityId[]): Sub<void> {
  const box = await extentsOf(ctx, ids);
  const s = {
    columns: 4,
    rows: 3,
    columnSpacing: defaultSpacing(box.maxX - box.minX, box.maxY - box.minY),
    rowSpacing: defaultSpacing(box.maxY - box.minY, box.maxX - box.minX),
  };
  // The base point is the array object's position (its grip); separate items have no use for it.
  let base = centreOf(box);
  let on = await associativity(ctx);
  ctx.message(typeLine('Rectangular', on));
  const live = new LiveArray(ids, await parameterCopyModeOf(ctx));
  const show = () => live.show(ctx, rectangularItems(s));
  show();
  try {
    for (;;) {
      const option = yield* editOption(ctx, [
        'ASsociative',
        'Base point',
        'COUnt',
        'Spacing',
        'COLumns',
        'Rows',
      ]);
      if (option === undefined) break;
      if (option === 'ASsociative') on = yield* associative(ctx, on);
      else if (option === 'Base point') base = yield* basePoint(ctx, centreOf(box), 'centroid');
      else yield* rectOption(ctx, option, s);
      show();
    }
  } finally {
    finish(ctx, live, on, () => ({ params: { kind: 'rectangular', ...s }, origin: base }));
  }
}

// ── ARRAYPOLAR ──────────────────────────────────────────────────────────────────────────────

async function* polar(ctx: CommandContext, ids: readonly EntityId[]): Sub<void> {
  const box = await extentsOf(ctx, ids);
  let base = centreOf(box);
  let on = await associativity(ctx);
  ctx.message(typeLine('Polar', on));
  let center: Vec2 | undefined;
  while (!center) {
    const a = yield ctx.prompt.point({
      message: 'Specify center point of array or',
      options: ['Base point'],
    });
    if (a.kind === 'point') center = a.point;
    else if (a.kind === 'keyword') base = yield* basePoint(ctx, centreOf(box), 'centroid');
    else return;
  }
  const s = {
    center,
    base,
    items: 6,
    fillAngle: 2 * Math.PI,
    rows: 1,
    rowSpacing: defaultSpacing(Math.max(box.maxX - box.minX, box.maxY - box.minY)),
    rotateItems: true,
  };
  const live = new LiveArray(ids, await parameterCopyModeOf(ctx));
  const show = () => live.show(ctx, polarItems(s));
  show();
  try {
    for (;;) {
      const option = yield* editOption(ctx, [
        'ASsociative',
        'Base point',
        'Items',
        'Angle between',
        'Fill angle',
        'ROWs',
        'ROTate items',
      ]);
      if (option === undefined) break;
      if (option === 'ASsociative') on = yield* associative(ctx, on);
      else if (option === 'Base point') s.base = yield* basePoint(ctx, centreOf(box), 'centroid');
      else yield* polarOption(ctx, option, s, s.center);
      show();
    }
  } finally {
    finish(ctx, live, on, () => ({ params: { kind: 'polar', ...s }, origin: s.base }));
  }
}

// ── ARRAYPATH ───────────────────────────────────────────────────────────────────────────────

async function* pickPath(
  ctx: CommandContext,
  ids: readonly EntityId[],
): Sub<{ path: ArrayPath; handle: string } | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: 'Select path curve', single: true });
    const id = a.kind === 'selection' ? a.ids[0] : undefined;
    if (id === undefined) return undefined;
    const e = ctx.model.entity(id);
    const found = e && !ids.includes(id) ? pathCurveOf(e.geom) : undefined;
    if (!found) {
      ctx.message('The object selected is not a valid path curve.');
      continue;
    }
    // The items run from the end of the path nearer the pick.
    const from = startPoint(found.curve);
    const to = endPoint(found.curve);
    const reversed =
      !found.closed &&
      a.kind === 'selection' &&
      a.pick !== undefined &&
      distance(a.pick, to) < distance(a.pick, from);
    const path = arrayPath(found.curve, found.closed, reversed);
    if (pathLength(path) === 0) {
      ctx.message('The object selected is not a valid path curve.');
      continue;
    }
    return { path, handle: e!.handle };
  }
}

async function* along(ctx: CommandContext, ids: readonly EntityId[]): Sub<void> {
  const box = await extentsOf(ctx, ids);
  let on = await associativity(ctx);
  ctx.message(typeLine('Path', on));
  const picked = yield* pickPath(ctx, ids);
  if (!picked) return;
  const { path } = picked;
  const size = defaultSpacing(Math.max(box.maxX - box.minX, box.maxY - box.minY));
  const s: PathState & { base: Vec2; tangent?: Vec2 } = {
    method: 'measure',
    base: pathStart(path),
    spacing: size,
    items: 1,
    rows: 1,
    rowSpacing: size,
    align: true,
  };
  s.items = Math.min(measureMaxItems(path, s.spacing), MAX_ARRAY_ITEMS);
  const live = new LiveArray(ids, await parameterCopyModeOf(ctx));
  const show = () => live.show(ctx, pathItems({ path, ...s }));
  show();
  try {
    for (;;) {
      const option = yield* editOption(ctx, [
        'ASsociative',
        'Method',
        'Base point',
        'Tangent direction',
        'Items',
        'Rows',
        'Align items',
      ]);
      if (option === undefined) break;
      if (option === 'ASsociative') on = yield* associative(ctx, on);
      else if (option === 'Base point') {
        s.base = yield* basePoint(ctx, pathStart(path), 'end of path curve');
      } else if (option === 'Tangent direction') {
        const vector = yield* twoPoints(
          ctx,
          'Specify first point of tangent vector',
          'Specify second point of tangent vector',
          false,
        );
        const v = vector ? sub(vector[1], vector[0]) : { x: 0, y: 0 };
        if (v.x === 0 && v.y === 0) ctx.message('The tangent vector must have a length.');
        else s.tangent = v;
      } else yield* pathOption(ctx, option, s, path);
      show();
    }
  } finally {
    finish(ctx, live, on, () => ({
      params: {
        kind: 'path',
        path: picked.handle,
        method: s.method,
        base: s.base,
        // + 0: a direction of -0 is saved as 0.
        tangent: (({ x, y }) => ({ x: x + 0, y: y + 0 }))(
          s.tangent ?? pathFrame(path, 0).direction,
        ),
        spacing: s.spacing,
        items: s.items,
        rows: s.rows,
        rowSpacing: s.rowSpacing,
        align: s.align,
        reversed: path.reversed,
      },
      origin: s.base,
    }));
  }
}

// ── ARRAYEDIT (M3-11) ───────────────────────────────────────────────────────────────────────

/** An INSERT that looks like an associative array AutoCAD made: an anonymous block with reactors. */
const madeElsewhere = (ctx: CommandContext, e: Entity): boolean =>
  e.geom.kind === 'INSERT' &&
  (e.reactors?.length ?? 0) > 0 &&
  /^\*U/i.test(ctx.model.blocks.get(e.geom.block)?.name ?? '');

const EDIT_OPTIONS: Readonly<Record<AssocArrayParams['kind'], readonly string[]>> = {
  rectangular: ['Source', 'REPlace', 'Base point', 'Rows', 'Columns', 'RESet'],
  polar: [
    'Source',
    'REPlace',
    'Base point',
    'Items',
    'Angle between',
    'Fill angle',
    'Rows',
    'ROTate items',
    'RESet',
  ],
  path: ['Source', 'REPlace', 'Method', 'Base point', 'Items', 'Rows', 'Align items', 'RESet'],
};

const EDITING = 'An array is being edited: save or discard its changes with ARRAYCLOSE first.';

/**
 * ARRAYEDIT (AutoCAD 2024 Help, "ARRAYEDIT (Command)"): picks an associative array Triya made
 * and changes it option by option, each change remaking its items at once. Source opens one
 * item's objects for editing until ARRAYCLOSE; REPlace puts other objects in chosen items (or
 * in place of the source objects), and RESet takes the replaced items back. Not offered: Levels
 * and Z direction (3D), Key point and Expression (no parametric constraints or expressions). An
 * array made in AutoCAD keeps its parameters in undocumented objects (DEC-059), so it is
 * refused.
 */
function arrayEditCommand(): CommandDef {
  return {
    name: 'ARRAYEDIT',
    usesSelection: 'during',
    async *run(ctx) {
      if (sourceEditOf(ctx.model)) {
        ctx.message(EDITING);
        return;
      }
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select array',
          single: true,
          pickfirst: true,
        });
        const id = a.kind === 'selection' ? a.ids[0] : undefined;
        if (id === undefined) return;
        const e = ctx.model.entity(id)!;
        const record = assocArrayOf(ctx.model.objects.values(), e);
        if (record) return yield* editArray(ctx, e.handle, record.handle);
        ctx.message(
          madeElsewhere(ctx, e)
            ? 'Triya cannot edit this array: it was not made in Triya, and its parameters are not documented.'
            : 'The object selected is not an associative array.',
        );
      }
    },
  };
}

interface ArrayNow {
  readonly insert: Entity;
  readonly record: AssocArray;
}

async function* editArray(ctx: CommandContext, insertHandle: string, handle: string): Sub<void> {
  const current = (): ArrayNow => ({
    insert: ctx.model.entityByHandle(insertHandle)!,
    record: ctx.model.objects.get(handle) as AssocArray,
  });
  const kind = current().record.params.kind;
  for (;;) {
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options: [...EDIT_OPTIONS[kind], 'eXit'],
      default: { kind: 'keyword', keyword: 'eXit' },
    });
    if (a.kind !== 'keyword' || a.keyword === 'eXit') return;
    if (a.keyword === 'Source') {
      if (yield* editSource(ctx, current)) return;
      continue;
    }
    if (a.keyword === 'REPlace') {
      yield* replaceItems(ctx, current);
      continue;
    }
    const { insert, record } = current();
    if (a.keyword === 'RESet') {
      ctx.edit((b) =>
        remakeAssocArray(b, ctx.model, insert, record, record.params, { replaced: [] }),
      );
      continue;
    }
    const g = insert.geom as InsertGeometry;
    const w = insertMatrix(g, ctx.model.blocks.get(g.block)?.basePoint ?? { x: 0, y: 0 });
    const p = record.params;
    let next: AssocArrayParams;
    if (p.kind === 'rectangular') {
      if (a.keyword === 'Base point') {
        // The base point is the array's grip, where its INSERT is; the items stay put.
        const b = yield ctx.prompt.point({
          message: 'Specify base point',
          defaultLabel: 'current',
        });
        if (b.kind !== 'point') continue;
        const q = applyPoint(invert(w), b.point);
        ctx.edit((cs) => rebaseRectangular(cs, ctx.model, insert, record, q));
        continue;
      }
      const s = { ...p };
      yield* rectOption(ctx, a.keyword === 'Columns' ? 'COLumns' : a.keyword, s);
      next = s;
    } else if (p.kind === 'polar') {
      const s = { ...p };
      if (a.keyword === 'Base point') {
        const b = yield* basePoint(ctx, applyPoint(w, s.base), 'current');
        s.base = applyPoint(invert(w), b);
      } else {
        const option = a.keyword === 'Rows' ? 'ROWs' : a.keyword;
        yield* polarOption(ctx, option, s, applyPoint(w, s.center));
      }
      next = s;
    } else {
      const e = p.path === undefined ? undefined : ctx.model.entityByHandle(p.path);
      const found = e ? pathCurveOf(e.geom) : undefined;
      if (!found) {
        ctx.message("The array's path is gone: its items stay where they are.");
        continue;
      }
      const s = { ...p };
      if (a.keyword === 'Base point') {
        // The point is picked on item 0, whose base point lands on the start of the path.
        const items = assocItems(ctx.model, insert, p) as Similarity[];
        const item0 = compose(items[0]!.m, w);
        const b = yield* basePoint(ctx, applyPoint(item0, s.base), 'current');
        s.base = applyPoint(invert(item0), b);
      } else {
        const path = arrayPath(found.curve, found.closed, p.reversed);
        yield* pathOption(ctx, a.keyword, s, path);
      }
      next = s;
    }
    ctx.edit((b) => {
      const problem = remakeAssocArray(b, ctx.model, insert, record, next);
      if (problem) ctx.message(`The array cannot be remade: ${problem}.`);
    });
  }
}

/** Picks an item of the array, again until one is found; undefined on Enter or Esc. */
async function* pickItem(
  ctx: CommandContext,
  now: () => ArrayNow,
  message: string,
  options: readonly string[] = [],
): Sub<ReturnType<typeof arrayItemAt> | string | undefined> {
  for (;;) {
    const a = yield ctx.prompt.point({
      message: options.length ? `${message} or` : message,
      options,
    });
    if (a.kind === 'keyword') return a.keyword;
    if (a.kind !== 'point') return undefined;
    const { insert, record } = now();
    const at = arrayItemAt(ctx.model, insert, record, a.point);
    if (at) return at;
    ctx.message('No item of the array is there.');
  }
}

/**
 * Source: opens the picked item's objects for editing (`openSourceEdit`) and ends ARRAYEDIT, as
 * AutoCAD's editing state does; true once it is open.
 */
async function* editSource(ctx: CommandContext, now: () => ArrayNow): Sub<boolean> {
  const at = yield* pickItem(ctx, now, 'Select item in array');
  if (at === undefined || typeof at === 'string') return false;
  const { insert, record } = now();
  let r: EditReport | string = '';
  ctx.edit((b) => {
    r = openSourceEdit(b, ctx.model, ctx.space, insert, record, at, mirrorOptions(ctx.model));
  });
  if (typeof r === 'string') {
    ctx.message(`The item cannot be edited: ${r}.`);
    return false;
  }
  for (const line of refusalMessages((r as EditReport).refused, 'opened for editing')) {
    ctx.message(line);
  }
  ctx.message('Edit the item, then save or discard the changes with ARRAYCLOSE.');
  return true;
}

/**
 * REPlace: the replacement objects (they stay in the drawing) go into a block of their own
 * with their base point at its origin, and each item picked shows it in place of its objects,
 * its base point where the item's is; Source objects puts it in place of the source objects,
 * for every item not replaced already.
 */
async function* replaceItems(ctx: CommandContext, now: () => ArrayNow): Sub<void> {
  const picked = yield ctx.prompt.selection({ message: 'Select replacement objects' });
  const all = picked.kind === 'selection' ? picked.ids : [];
  const ids = all.filter((id) => ctx.model.entity(id)?.handle !== now().insert.handle);
  if (ids.length < all.length) ctx.message('An array cannot replace its own items.');
  if (ids.length === 0) return;
  const box = await extentsOf(ctx, ids);
  const a = yield ctx.prompt.point({
    message: 'Select base point of replacement objects',
    defaultLabel: 'centroid',
  });
  const base = a.kind === 'point' ? a.point : centreOf(box);
  let block: Handle | undefined;
  /** Makes the replacement block on first use, in the edit that first uses it. */
  const blockIn = (b: ChangeSetBuilder): Handle | undefined => {
    if (block !== undefined) return block;
    const made = replacementBlock(b, ctx.model, ids, base, mirrorOptions(ctx.model));
    for (const line of refusalMessages(made.report.refused, 'used')) ctx.message(line);
    return (block = made.block);
  };
  for (;;) {
    const at = yield* pickItem(ctx, now, 'Select an item in array to replace', ['Source objects']);
    if (at === undefined) return;
    const { insert, record } = now();
    ctx.edit((b) => {
      const into = blockIn(b);
      if (into === undefined) return;
      if (typeof at === 'string') {
        remakeAssocArray(b, ctx.model, insert, record, record.params, { source: into });
      } else {
        const replaced = (record.replaced ?? []).filter((r) => !sameItem(r, at.key));
        replaced.push({ ...at.key, block: into });
        remakeAssocArray(b, ctx.model, insert, record, record.params, { replaced });
      }
    });
    if (block === undefined || typeof at === 'string') return;
  }
}

// ── ARRAYCLOSE, and what follows edits (M3-11 part 2) ───────────────────────────────────────

/**
 * ARRAYCLOSE (AutoCAD 2024 Help, "ARRAYCLOSE (Command)"): ends ARRAYEDIT Source's editing
 * state. Yes keeps the edits in the array (all erased leaves nothing to keep: the changes are
 * discarded), No puts the objects back as they were.
 */
function arrayCloseCommand(): CommandDef {
  return {
    name: 'ARRAYCLOSE',
    usesSelection: 'none',
    async *run(ctx) {
      const edit = sourceEditOf(ctx.model);
      if (!edit) {
        ctx.message('No array is being edited.');
        return;
      }
      let save = (yield* choose(ctx, 'Save changes to array', ['Yes', 'No'], 'Yes')) === 'Yes';
      if (save && sourceEditIds(ctx.model, edit).length === 0) {
        ctx.message("The item's objects are all erased: the changes are discarded.");
        save = false;
      }
      ctx.edit((b) => closeSourceEdit(b, ctx.model, save, mirrorOptions(ctx.model)));
    },
  };
}

/**
 * What a command's edits carry along as it ends, in its undo step (the bus calls this): an
 * array's item being edited takes the edits made to its objects (and the objects drawn beside
 * them) into its block, and a path array is remade along its path when the path changed.
 * Undo and redo do not come here: they put back these follow-ups with the rest.
 */
export function followAssociations(ctx: CommandContext, changes: readonly ChangeSet[]): void {
  // Center marks and centerlines follow their objects (M4-08).
  followCenterMarks(ctx.model, (build) => ctx.edit(build), changes);
  // Leaders and multileaders broken by what the command changed are drawn again (M4-15).
  followLeaderBreaks(ctx.model, (build) => ctx.edit(build), changes);
  const updated = new Set<Handle>();
  const touched = new Set<Handle>();
  const added: Entity[] = [];
  for (const cs of changes) {
    for (const u of cs.entities?.updated ?? []) {
      updated.add(u.after.handle);
      touched.add(u.after.handle);
    }
    for (const r of cs.entities?.removed ?? []) touched.add(r.entity.handle);
    for (const a of cs.entities?.added ?? []) added.push(a.entity);
  }
  const edit = sourceEditOf(ctx.model);
  if (edit) {
    const insert = ctx.model.entityByHandle(edit.insert);
    const record = ctx.model.objects.get(edit.record);
    if (!insert || !assocArrayOf(ctx.model.objects.values(), insert) || !record) {
      dropSourceEdit(ctx.model);
    } else {
      let changed = [...edit.handles].some((h) => touched.has(h));
      for (const e of added) {
        if (e.owner !== edit.space || edit.handles.has(e.handle) || e.handle === edit.insert)
          continue;
        edit.handles.add(e.handle);
        changed = true;
      }
      if (changed) ctx.edit((b) => syncSourceEdit(b, ctx.model, edit, mirrorOptions(ctx.model)));
    }
  }
  if (updated.size === 0) return;
  const follow: AssocArray[] = [];
  for (const o of ctx.model.objects.values()) {
    if (!isAssocArrayObject(o) || o.params.kind !== 'path' || o.params.path === undefined) continue;
    if (updated.has(o.params.path) && ctx.model.entityByHandle(o.insert)) follow.push(o);
  }
  if (follow.length === 0) return;
  ctx.edit((b) => {
    for (const r of follow) {
      const problem = remakeAssocArray(
        b,
        ctx.model,
        ctx.model.entityByHandle(r.insert)!,
        r,
        r.params,
      );
      if (problem) ctx.message(`An array along the path cannot be remade: ${problem}.`);
    }
  });
}

// ── The commands ────────────────────────────────────────────────────────────────────────────

type ArrayKind = 'Rectangular' | 'PAth' | 'POlar';

const make = (kind: ArrayKind, ctx: CommandContext, ids: readonly EntityId[]): Sub<void> =>
  kind === 'Rectangular'
    ? rectangular(ctx, ids)
    : kind === 'POlar'
      ? polar(ctx, ids)
      : along(ctx, ids);

/**
 * ARRAY: asks for the type (the last one by default, as ARRAYTYPE keeps it), then runs it;
 * -ARRAY is the classic command-line array (`dashArray`).
 */
export function arrayCommand(): CommandDef {
  let last: ArrayKind = 'Rectangular';
  const classic = dashArray();
  return {
    name: 'ARRAY',
    dashVariant: true,
    usesSelection: 'during',
    async *run(ctx) {
      if (ctx.dash) return yield* classic(ctx);
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      last = (yield* choose(
        ctx,
        'Enter array type',
        ['Rectangular', 'PAth', 'POlar'],
        last,
      )) as ArrayKind;
      yield* make(last, ctx, ids);
    },
  };
}

const typed = (name: string, kind: ArrayKind): CommandDef => ({
  name,
  usesSelection: 'during',
  async *run(ctx) {
    const ids = yield* selectObjects(ctx);
    if (ids.length === 0) return;
    yield* make(kind, ctx, ids);
  },
});

/**
 * -ARRAY, AutoCAD's classic array at the command line: Rectangular asks for rows and columns
 * and their spacings (a unit cell's corners give both); Polar for the centre, the number of
 * items, the angle to fill and whether to rotate them. The items are made at once.
 */
function dashArray(): (ctx: CommandContext) => Sub<void> {
  let last: 'Rectangular' | 'Polar' = 'Rectangular';
  return async function* (ctx) {
    {
      const ids = yield* selectObjects(ctx);
      if (ids.length === 0) return;
      last = (yield* choose(
        ctx,
        'Enter the type of array',
        ['Rectangular', 'Polar'],
        last,
      )) as typeof last;
      const live = new LiveArray(ids, await parameterCopyModeOf(ctx));
      if (last === 'Rectangular') {
        const rows = yield* count(ctx, 'Enter the number of rows (---)', 1);
        const columns = yield* count(ctx, 'Enter the number of columns (|||)', 1);
        if (rows * columns === 1) {
          ctx.message('One-element array, nothing to do.');
          return;
        }
        if (tooMany(ctx, rows * columns)) return;
        let rowSpacing = 0;
        let columnSpacing = 0;
        if (rows === 1) {
          const c = yield ctx.prompt.distance({
            message: 'Specify the distance between columns (|||)',
          });
          if (c.kind !== 'distance') return;
          columnSpacing = c.value;
        } else {
          // A number is the row distance; a point is a unit cell's first corner.
          let cell: Vec2 | undefined;
          for (;;) {
            const r = yield ctx.prompt.point({
              message: 'Enter the distance between rows or specify unit cell (---)',
              arbitrary: true,
            });
            if (r.kind === 'point') cell = r.point;
            else if (r.kind === 'string') {
              const d = parseDistance(r.value, drawingUnits(ctx.model.header).lunits);
              if (d === undefined) {
                ctx.message('Requires a distance or a point.');
                continue;
              }
              rowSpacing = d;
            } else return;
            break;
          }
          if (cell) {
            const q = yield ctx.prompt.point({
              message: 'Specify opposite corner',
              rubberBand: { from: cell, box: true },
            });
            if (q.kind !== 'point') return;
            rowSpacing = q.point.y - cell.y;
            columnSpacing = q.point.x - cell.x;
          } else if (columns > 1) {
            const c = yield ctx.prompt.distance({
              message: 'Specify the distance between columns (|||)',
            });
            if (c.kind !== 'distance') return;
            columnSpacing = c.value;
          }
        }
        live.show(ctx, rectangularItems({ rows, columns, rowSpacing, columnSpacing }));
      } else {
        const box = await extentsOf(ctx, ids);
        let base = centreOf(box);
        let center: Vec2 | undefined;
        while (!center) {
          const c = yield ctx.prompt.point({
            message: 'Specify center point of array or',
            options: ['Base'],
          });
          if (c.kind === 'point') center = c.point;
          else if (c.kind === 'keyword') {
            const p = yield ctx.prompt.point({ message: 'Specify base point of objects' });
            if (p.kind !== 'point') return;
            base = p.point;
          } else return;
        }
        const n = yield* count(ctx, 'Enter the number of items in the array', 4, 2);
        if (tooMany(ctx, n)) return;
        let fill = 2 * Math.PI;
        for (;;) {
          const f = yield ctx.prompt.angle({
            turn: true,
            message: 'Specify the angle to fill (+=ccw, -=cw)',
            defaultLabel: '360',
            base: center,
          });
          if (f.kind !== 'angle') break;
          const sweep = sweepOf(ctx, f.value);
          if (sweep !== 0 && Math.abs(sweep) <= 2 * Math.PI + 1e-9) {
            fill = sweep;
            break;
          }
          ctx.message(sweep === 0 ? NOT_POSITIVE : 'The fill angle cannot exceed 360 degrees.');
        }
        const rotate = yield* yesNo(ctx, 'Rotate arrayed objects?', true);
        live.show(
          ctx,
          polarItems({
            center,
            base,
            items: n,
            fillAngle: fill,
            rows: 1,
            rowSpacing: 0,
            rotateItems: rotate,
          }),
        );
      }
      live.finish(ctx);
    }
  };
}

export const ARRAY_COMMANDS: readonly (() => CommandDef)[] = [
  arrayCommand,
  () => typed('ARRAYRECT', 'Rectangular'),
  () => typed('ARRAYPOLAR', 'POlar'),
  () => typed('ARRAYPATH', 'PAth'),
  arrayEditCommand,
  arrayCloseCommand,
];
