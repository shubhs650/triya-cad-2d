// Array grips (M3-11 part 3): the multi-functional grips of an associative array Triya made,
// as AutoCAD 2024 shows them ("About Editing Associative Arrays", "To Work With Rectangular,
// Polar and Path Arrays"; its help names few of them and shows the rest in pictures, so the set
// follows AutoCAD's on screen). A square grip at the array's base moves it (a polar array's at
// its centre; its base grip stretches the radius), and triangles size it:
//
// - rectangular: the second column's and row's spacing (with three or more), the last column's
//   and row's count (or total spacing), and the far corner's row and column count (or both
//   total spacings); with one column or row the count grip stands where the next would;
// - polar: the second item's angle between items (three or more items), the last item's fill
//   angle, either of them also the item count;
// - path (Measure): the second item's spacing (three or more items) and the last item's count;
// - polar and path rows: the second row's spacing (three or more) and the last row's count.
//
// Each grip's functions are what AutoCAD's hover menu offers on it; the grip command asks for
// the first and offers the others as options. Everything is computed in the array block's
// coordinates (a path array's along its path in the drawing), so a turned or scaled array's
// grips size it along its own axes.
import { applyPoint, applyVector, invert, type Matrix2D } from '../geom/transform';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, dot, normalize, perp, scale, sub } from '../geom/vec';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Entity, AssocArray, AssocArrayParams, InsertGeometry } from '../model/types';
import {
  arrayPath,
  measureMaxItems,
  MAX_ARRAY_ITEMS,
  pathCurveOf,
  pathFrame,
  pathLength,
  pathStations,
  polarAngleBetween,
  type ArrayPath,
} from './array';
import { assocArrayOf, insertMatrix, remakeAssocArray } from './assoc-array';
import { transformObjects } from './edit';
import type { Grip } from './grips';
import { revcloudOf, type CloudInfo } from './revcloud';
import { moveBy } from './similarity';

/** What an array's triangle (or a polar array's base) grip sizes. */
export type ArrayGripRole =
  | 'columnSpacing'
  | 'columnCount'
  | 'rowSpacing'
  | 'rowCount'
  | 'corner'
  | 'radius'
  | 'itemAngle'
  | 'lastItem'
  | 'itemSpacing'
  | 'itemCount';

/** A grip's functions, the first what a drag does, as option keywords. */
export const ARRAY_GRIP_FUNCTIONS: Readonly<Record<ArrayGripRole, readonly string[]>> = {
  columnSpacing: ['Column spacing'],
  columnCount: ['Column count', 'Total spacing'],
  rowSpacing: ['Row spacing'],
  rowCount: ['Row count', 'Total spacing'],
  corner: ['Row and column count', 'Total spacing'],
  radius: ['Stretch radius'],
  itemAngle: ['Item angle', 'Count', 'Fill angle'],
  lastItem: ['Fill angle', 'Count'],
  itemSpacing: ['Item spacing'],
  itemCount: ['Count'],
};

/** The grips of an array, with the record they were found for. */
export interface ArrayGrips {
  readonly record: AssocArray;
  readonly grips: readonly Grip[];
}

/** What `gripsOf` needs besides an object's geometry: a cloud's arc, or an array's grips. */
export type GripInfo = CloudInfo | ArrayGrips;

export const isArrayGrips = (i: GripInfo | undefined): i is ArrayGrips =>
  i !== undefined && 'grips' in i;

/** The array's INSERT transform, from its block's coordinates to the drawing's. */
function arrayMatrix(model: DocumentModel, insert: Entity): Matrix2D {
  const g = insert.geom as InsertGeometry;
  return insertMatrix(g, model.blocks.get(g.block)?.basePoint ?? { x: 0, y: 0 });
}

/** The path a path array follows, undefined once it is gone. */
function pathOf(model: DocumentModel, p: AssocArrayParams & { kind: 'path' }) {
  const e = p.path === undefined ? undefined : model.entityByHandle(p.path);
  const found = e ? pathCurveOf(e.geom) : undefined;
  return found && arrayPath(found.curve, found.closed, p.reversed);
}

/** A polar array's measures in the array block: radius and the outward unit of item `i`. */
function polarFrame(p: AssocArrayParams & { kind: 'polar' }) {
  const radius = distance(p.base, p.center);
  const step = polarAngleBetween(p.items, p.fillAngle);
  const baseDir = angleOf(sub(p.base, p.center));
  // As `polarItems`: a base point on the centre grows its rings along +X turned.
  const unit = (i: number) => {
    const a = radius > 0 ? baseDir + i * step : i * step;
    return { x: Math.cos(a), y: Math.sin(a) };
  };
  const at = (i: number, r: number) => add(p.center, scale(unit(i), radius + r * p.rowSpacing));
  return { radius, step, baseDir, unit, at };
}

const tri = (point: Vec2, role: ArrayGripRole, towards: Vec2): Grip => ({
  point,
  kind: 'array',
  array: role,
  towards: normalize(towards),
});

const sign = (v: number) => (v < 0 ? -1 : 1);

function computeGrips(model: DocumentModel, insert: Entity, record: AssocArray): Grip[] {
  const p = record.params;
  const w = arrayMatrix(model, insert);
  const W = (q: Vec2) => applyPoint(w, q);
  const V = (v: Vec2) => applyVector(w, v);
  const out: Grip[] = [];
  if (p.kind === 'rectangular') {
    const { columns: c, rows: r, columnSpacing: sx, rowSpacing: sy } = p;
    const at = (i: number, j: number) => W({ x: i * sx, y: j * sy });
    const along = V({ x: sign(sx), y: 0 });
    const up = V({ x: 0, y: sign(sy) });
    out.push({ point: at(0, 0), kind: 'move' });
    if (c >= 3) out.push(tri(at(1, 0), 'columnSpacing', along));
    if (sx !== 0) out.push(tri(at(Math.max(c, 2) - 1, 0), 'columnCount', along));
    if (r >= 3) out.push(tri(at(0, 1), 'rowSpacing', up));
    if (sy !== 0) out.push(tri(at(0, Math.max(r, 2) - 1), 'rowCount', up));
    if (sx !== 0 && sy !== 0) {
      out.push(tri(at(Math.max(c, 2) - 1, Math.max(r, 2) - 1), 'corner', add(along, up)));
    }
    return out;
  }
  if (p.kind === 'polar') {
    const f = polarFrame(p);
    const turn = sign(p.fillAngle);
    const tangent = (i: number) => V(scale(perp(f.unit(i)), turn));
    out.push({ point: W(p.center), kind: 'move' });
    if (f.radius > 0) out.push({ point: W(p.base), kind: 'array', array: 'radius' });
    if (p.items >= 3) out.push(tri(W(f.at(1, 0)), 'itemAngle', tangent(1)));
    if (p.items >= 2) out.push(tri(W(f.at(p.items - 1, 0)), 'lastItem', tangent(p.items - 1)));
    if (p.rows >= 3) out.push(tri(W(f.at(0, 1)), 'rowSpacing', V(f.unit(0))));
    if (p.rowSpacing !== 0) {
      out.push(tri(W(f.at(0, Math.max(p.rows, 2) - 1)), 'rowCount', V(f.unit(0))));
    }
    return out;
  }
  const path = pathOf(model, p);
  if (!path)
    return [
      { point: insert.geom.kind === 'INSERT' ? insert.geom.position : W(p.base), kind: 'move' },
    ];
  // A path array's items are on its path in the drawing: their base points are the stations.
  const stations = pathStations({ ...p, path });
  const frame = (i: number) => pathFrame(path, stations[i] ?? 0);
  const left = perp(frame(0).direction);
  const at = (i: number, r: number) =>
    add(frame(i).point, scale(perp(frame(i).direction), r * p.rowSpacing));
  out.push({ point: at(0, 0), kind: 'move' });
  if (p.method === 'measure') {
    if (p.items >= 3) out.push(tri(at(1, 0), 'itemSpacing', frame(1).direction));
    if (p.items >= 2) out.push(tri(at(p.items - 1, 0), 'itemCount', frame(p.items - 1).direction));
  }
  if (p.rows >= 3) out.push(tri(at(0, 1), 'rowSpacing', left));
  if (p.rowSpacing !== 0) out.push(tri(at(0, Math.max(p.rows, 2) - 1), 'rowCount', left));
  return out;
}

// Grips are asked for on every frame that shows them: kept while the array, its INSERT and its
// path are the same objects (the model replaces them on every change).
const cache = new WeakMap<AssocArray, { keys: readonly unknown[]; grips: readonly Grip[] }>();

/** The grips of the array `e` is, if it is an associative array Triya made. */
export function arrayGripsOf(model: DocumentModel, e: Entity): ArrayGrips | undefined {
  const record = assocArrayOf(model.objects.values(), e);
  if (!record || e.geom.kind !== 'INSERT') return undefined;
  const p = record.params;
  const keys = [
    e.geom,
    model.blocks.get(e.geom.block),
    p.kind === 'path' && p.path !== undefined ? model.entityByHandle(p.path)?.geom : undefined,
  ];
  const hit = cache.get(record);
  if (hit && hit.keys.every((k, i) => k === keys[i])) return { record, grips: hit.grips };
  const grips = computeGrips(model, e, record);
  cache.set(record, { keys, grips });
  return { record, grips };
}

/** What an object's grips depend on besides its geometry (`gripsOf`'s second argument). */
export function gripInfoOf(model: DocumentModel, e: Entity): GripInfo | undefined {
  return arrayGripsOf(model, e) ?? revcloudOf(model, e);
}

// ── What a grip does ────────────────────────────────────────────────────────────────────────

/** A grip function's answer: a picked point, or a typed number (a count, length or angle). */
export type ArrayGripInput = { readonly point: Vec2 } | { readonly value: number };

/** What a function reads a typed value as; `point` takes points only. */
export function functionValue(
  role: ArrayGripRole,
  fn: string,
): 'count' | 'distance' | 'angle' | 'point' {
  // The corner sizes two ways at once: a typed number cannot say both.
  if (role === 'corner') return 'point';
  if (fn.endsWith('count') || fn === 'Count') return 'count';
  if (fn.endsWith('angle')) return 'angle';
  return 'distance';
}

/** A grip's edit: the new parameters, and a shift of the item blocks' objects (Stretch radius). */
export interface ArrayGripEdit {
  readonly params: AssocArrayParams;
  readonly shift?: Vec2;
}

const NOT_POSITIVE = 'Value must be positive and nonzero.';
const NONZERO = 'Value must be nonzero.';
const TOO_MANY = `The array cannot have more than ${MAX_ARRAY_ITEMS} items.`;
const FULL = 2 * Math.PI;

/** A count read from a typed value or measured, refused below 1 or when not whole. */
function countOf(input: ArrayGripInput, measured: () => number): number | string {
  if ('value' in input) {
    return Number.isInteger(input.value) && input.value >= 1
      ? input.value
      : 'Requires a positive whole number.';
  }
  return Math.max(1, measured());
}

/**
 * The angle from `from` to `to` about the centre, the way the array turns (`turn`): in
 * (0, 2π] counter-clockwise, [−2π, 0) clockwise.
 */
function sweep(from: number, to: number, turn: number): number {
  let a = (to - from) * turn;
  a = ((a % FULL) + FULL) % FULL;
  if (a < 1e-9) a = FULL;
  return a * turn;
}

/**
 * What function `fn` of the grip `role` makes of the array for `input` (a point in the drawing);
 * a message when it cannot.
 */
export function arrayGripEdit(
  model: DocumentModel,
  insert: Entity,
  record: AssocArray,
  role: ArrayGripRole,
  fn: string,
  input: ArrayGripInput,
): ArrayGripEdit | string {
  const p = record.params;
  if ('value' in input && functionValue(role, fn) === 'point') return 'Requires a point.';
  let local: Vec2 | undefined;
  if ('point' in input) {
    try {
      local =
        p.kind === 'path'
          ? input.point
          : applyPoint(invert(arrayMatrix(model, insert)), input.point);
    } catch {
      return 'The array is not scaled uniformly.';
    }
  }
  const value = 'value' in input ? input.value : undefined;
  let next: AssocArrayParams | string;
  let shift: Vec2 | undefined;
  if (p.kind === 'rectangular') {
    next = rectangularEdit(p, role, fn, local, value, input);
  } else if (p.kind === 'polar') {
    const r = polarEdit(p, role, fn, local, value, input);
    if (typeof r !== 'string' && 'shift' in r) {
      shift = r.shift;
      next = r.params;
    } else next = r as AssocArrayParams | string;
  } else {
    const path = pathOf(model, p);
    if (!path) return "The array's path is gone: its items stay where they are.";
    next = pathEdit(p, path, role, fn, local, value, input);
  }
  if (typeof next === 'string') return next;
  const items = next.kind === 'rectangular' ? next.columns * next.rows : next.items * next.rows;
  if (items > MAX_ARRAY_ITEMS) return TOO_MANY;
  return shift ? { params: next, shift } : { params: next };
}

type Rect = AssocArrayParams & { kind: 'rectangular' };
type Polar = AssocArrayParams & { kind: 'polar' };
type PathParams = AssocArrayParams & { kind: 'path' };

function rectangularEdit(
  p: Rect,
  role: ArrayGripRole,
  fn: string,
  q: Vec2 | undefined,
  value: number | undefined,
  input: ArrayGripInput,
): Rect | string {
  const columnsWay = role === 'columnSpacing' || role === 'columnCount';
  if (role === 'corner') {
    const at = q!;
    if (fn === 'Total spacing') {
      if (p.columns < 2 || p.rows < 2) return 'The array needs two rows and two columns.';
      if (at.x === 0 || at.y === 0) return NONZERO;
      return { ...p, columnSpacing: at.x / (p.columns - 1), rowSpacing: at.y / (p.rows - 1) };
    }
    return {
      ...p,
      columns: Math.max(1, Math.round(at.x / p.columnSpacing) + 1),
      rows: Math.max(1, Math.round(at.y / p.rowSpacing) + 1),
    };
  }
  const along = (v: Vec2) => (columnsWay ? v.x : v.y);
  const spacing = columnsWay ? p.columnSpacing : p.rowSpacing;
  const count = columnsWay ? p.columns : p.rows;
  const set = (n: number, s: number): Rect =>
    columnsWay ? { ...p, columns: n, columnSpacing: s } : { ...p, rows: n, rowSpacing: s };
  if (fn === 'Column spacing' || fn === 'Row spacing') {
    const s = value ?? along(q!);
    return s === 0 ? NONZERO : set(count, s);
  }
  if (fn === 'Total spacing') {
    if (count < 2) return `The array has one ${columnsWay ? 'column' : 'row'}.`;
    const total = value ?? along(q!);
    return total === 0 ? NONZERO : set(count, total / (count - 1));
  }
  const n = countOf(input, () => Math.round(along(q!) / spacing) + 1);
  return typeof n === 'string' ? n : set(n, spacing);
}

/** Rows outward from the first ring (polar) or to the left of the path (path). */
function rowsEdit<T extends Polar | PathParams>(
  p: T,
  fn: string,
  out: number | undefined,
  value: number | undefined,
  input: ArrayGripInput,
): T | string {
  if (fn === 'Row spacing') {
    const s = value ?? out!;
    return s === 0 ? NONZERO : { ...p, rowSpacing: s };
  }
  if (fn === 'Total spacing') {
    if (p.rows < 2) return 'The array has one row.';
    const total = value ?? out!;
    return total === 0 ? NONZERO : { ...p, rowSpacing: total / (p.rows - 1) };
  }
  const n = countOf(input, () => Math.round(out! / p.rowSpacing) + 1);
  return typeof n === 'string' ? n : { ...p, rows: n };
}

function polarEdit(
  p: Polar,
  role: ArrayGripRole,
  fn: string,
  q: Vec2 | undefined,
  value: number | undefined,
  input: ArrayGripInput,
): Polar | { params: Polar; shift: Vec2 } | string {
  const f = polarFrame(p);
  if (role === 'rowSpacing' || role === 'rowCount') {
    const out = q && dot(sub(q, f.at(0, 0)), f.unit(0));
    return rowsEdit(p, fn, out, value, input);
  }
  if (fn === 'Stretch radius') {
    // The items move out from the centre, the first too: its objects shift with its base.
    const r = value ?? dot(sub(q!, p.center), f.unit(0));
    if (!(r > 0)) return NOT_POSITIVE;
    const shift = scale(f.unit(0), r - f.radius);
    return { params: { ...p, base: add(p.base, shift) }, shift };
  }
  const turn = sign(p.fillAngle);
  const angle = q && sweep(f.baseDir, angleOf(sub(q, p.center)), turn);
  if (fn === 'Count') {
    // Typed, the fill angle stays, as ARRAYPOLAR's Items; dragged, the items run on at the
    // angle between them to the cursor (a full circle stays one).
    const n = countOf(input, () => Math.round(angle! / f.step) + 1);
    if (typeof n === 'string') return n;
    if (value !== undefined || Math.abs(Math.abs(p.fillAngle) - FULL) <= 1e-9 || n < 2) {
      return { ...p, items: n };
    }
    const fill = f.step * (n - 1);
    if (Math.abs(fill) > FULL + 1e-9) return 'The items would go round more than once.';
    return { ...p, items: n, fillAngle: fill };
  }
  if (fn === 'Item angle') {
    // A typed angle between items keeps the way the array turns.
    const step = value === undefined ? angle! : value * turn;
    if (step === 0) return NONZERO;
    const n = p.items;
    if (Math.abs(Math.abs(step * n) - FULL) <= 1e-9) return { ...p, fillAngle: sign(step) * FULL };
    const fill = step * (n - 1);
    if (Math.abs(fill) > FULL + 1e-9) return 'The items would go round more than once.';
    return { ...p, fillAngle: fill };
  }
  // Fill angle.
  const fill = value ?? angle!;
  if (fill === 0) return NONZERO;
  if (Math.abs(fill) > FULL + 1e-9) return 'The fill angle cannot be more than 360 degrees.';
  return { ...p, fillAngle: Math.abs(Math.abs(fill) - FULL) <= 1e-9 ? sign(fill) * FULL : fill };
}

/** The distance along the path of its point nearest `q`. */
export function nearestStation(path: ArrayPath, q: Vec2): number {
  const length = pathLength(path);
  const n = 256;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * length;
    const d = distance(pathFrame(path, s).point, q);
    if (d < bestD) [best, bestD] = [s, d];
  }
  // Then along the tangent from there (Newton's step on the distance), exact on straight spans.
  for (let i = 0; i < 8; i++) {
    const f = pathFrame(path, best);
    const step = dot(sub(q, f.point), f.direction);
    const next = Math.min(length, Math.max(0, best + step));
    if (distance(pathFrame(path, next).point, q) > distance(f.point, q)) break;
    best = next;
  }
  return best;
}

function pathEdit(
  p: PathParams,
  path: ArrayPath,
  role: ArrayGripRole,
  fn: string,
  q: Vec2 | undefined,
  value: number | undefined,
  input: ArrayGripInput,
): PathParams | string {
  if (role === 'rowSpacing' || role === 'rowCount') {
    const start = pathFrame(path, 0);
    const out = q && dot(sub(q, start.point), perp(start.direction));
    return rowsEdit(p, fn, out, value, input);
  }
  const s = q && nearestStation(path, q);
  if (fn === 'Item spacing') {
    const spacing = value ?? s!;
    if (!(spacing > 0)) return NOT_POSITIVE;
    // Items that no longer fit along the path are dropped, as ARRAYPATH's Measure does.
    return { ...p, spacing, items: Math.min(p.items, measureMaxItems(path, spacing)) };
  }
  const most = measureMaxItems(path, p.spacing);
  const n = countOf(input, () => Math.round(s! / p.spacing) + 1);
  if (typeof n === 'string') return n;
  if (n > most) return `Only ${most} items fit along the path.`;
  return { ...p, items: n };
}

/** Carries out a grip's edit: the item blocks' objects shifted, the array remade. */
export function applyArrayGripEdit(
  b: ChangeSetBuilder,
  model: DocumentModel,
  insert: Entity,
  record: AssocArray,
  edit: ArrayGripEdit,
): string | undefined {
  if (edit.shift) {
    const blocks = new Set([record.source, ...(record.replaced ?? []).map((r) => r.block)]);
    for (const block of blocks)
      transformObjects(b, model, b.blockEntities(block), moveBy(edit.shift));
  }
  return remakeAssocArray(b, model, insert, record, edit.params);
}
