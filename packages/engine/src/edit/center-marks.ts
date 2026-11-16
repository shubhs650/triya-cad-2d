// Center marks and centerlines Triya makes (CENTERMARK, CENTERLINE; M4-08). Each is one INSERT
// of an anonymous `*U` block of lines, as AutoCAD saves the visible part of one, so every reader
// draws it; a `CenterMark` record owned by the INSERT keeps it associative to
// the circle, arc or lines it was made on. As a command ends (the bus's `followAssociations`) a
// mark whose objects changed is drawn again from them, a mark whose object is gone goes with it,
// and a mark moved on its own lets go of its objects.
//
// AutoCAD 2024 Help ("CENTERMARK (Command)", "CENTERLINE (Command)", "CENTERCROSSSIZE",
// "CENTERCROSSGAP", "CENTEREXE", "CENTERMARKEXE", "CENTERLTYPE", "CENTERLTSCALE",
// "CENTERLAYER"): a center mark is a cross at the centre, CENTERCROSSSIZE across each arm,
// then a gap of CENTERCROSSGAP, then extension lines to CENTEREXE past the circle (when
// CENTERMARKEXE is 1); a size or gap followed by `x` is relative to the circle. The help does not
// say relative to what: Triya reads it as a factor of the diameter (0.1x gives arms a tenth of
// the diameter long), the most common reading of AutoCAD's own marks. A centerline runs along
// the bisector of two lines (midway between parallel ones), from the middle of their start
// points to the middle of their end points, CENTEREXE past each.
import type { Vec2 } from '../geom/types';
import { add, cross, dot, length, midpoint, normalize, scale, sub } from '../geom/vec';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import {
  isCenterMark,
  type CenterMark,
  type Entity,
  type EntityGeometry,
  type NonGraphicalObject,
} from '../model/types';
import type { GeneralProps } from '../properties/sheet';
import { AnonymousNames } from './edit';

/** What finding a mark's record reads of the drawing. */
export type CenterMarkSource = { readonly objects: ReadonlyMap<Handle, NonGraphicalObject> };

/** The record of the center mark or centerline whose INSERT is `insert`, if Triya made it. */
export function centerMarkOf(
  model: CenterMarkSource,
  insert: Pick<Entity, 'handle'> | undefined,
): CenterMark | undefined {
  if (!insert) return undefined;
  for (const o of model.objects.values()) {
    if (isCenterMark(o) && o.insert === insert.handle) return o;
  }
  return undefined;
}

/** The settings a new mark takes (the CENTER* variables). */
export interface CenterSettings {
  /** CENTERCROSSSIZE: a length, or a factor of the diameter followed by `x`. */
  readonly crossSize: string;
  /** CENTERCROSSGAP, the same way. */
  readonly crossGap: string;
  /** CENTEREXE: how far extension lines go past the object. */
  readonly extension: number;
  /** CENTERMARKEXE: a center mark has extension lines. */
  readonly showExtensions: boolean;
}

/** AutoCAD's initial values; CENTEREXE is 0.12 in imperial drawings and 3.5 in metric ones. */
export function defaultCenterSettings(metric: boolean): CenterSettings {
  return {
    crossSize: '0.1x',
    crossGap: '0.05x',
    extension: metric ? 3.5 : 0.12,
    showExtensions: true,
  };
}

/** The settings the drawing states: CENTEREXE when it holds one (a DICTIONARYVAR), else AutoCAD's. */
export function centerSettings(model: DocumentModel): CenterSettings {
  const measurement = model.header.get('$MEASUREMENT');
  const metric =
    typeof measurement === 'number' ? measurement === 1 : model.meta.measurement === 'metric';
  const out = defaultCenterSettings(metric);
  const exe = model.header.get('CENTEREXE');
  const n = typeof exe === 'string' ? Number(exe.trim()) : typeof exe === 'number' ? exe : NaN;
  return exe !== undefined && Number.isFinite(n) && n >= 0 ? { ...out, extension: n } : out;
}

/** A CENTERCROSSSIZE-style value for a circle of `diameter`: `0.1x` is a tenth of it. */
export function centerLength(text: string, diameter: number): number {
  const t = text.trim();
  const relative = /x$/i.test(t);
  const n = Number(relative ? t.slice(0, -1) : t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return relative ? n * diameter : n;
}

/** Whether `text` is a value CENTERCROSSSIZE or CENTERCROSSGAP takes. */
export const isCenterLength = (text: string): boolean =>
  /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?x?$/i.test(text.trim());

type Segment = readonly [Vec2, Vec2];

/**
 * A center mark's lines in its block, the centre at the origin: the cross, then the extension
 * lines from the gap to `extensions` (left, right, top, bottom) past `radius`. An extension line
 * the cross reaches past is left out.
 */
export function centerMarkLines(
  radius: number,
  r: Pick<CenterMark, 'crossSize' | 'crossGap' | 'extensions' | 'showExtensions'>,
): Segment[] {
  const d = 2 * radius;
  const c = centerLength(r.crossSize ?? '0.1x', d);
  const g = centerLength(r.crossGap ?? '0.05x', d);
  const out: Segment[] = [];
  if (c > 0) {
    out.push([
      { x: -c, y: 0 },
      { x: c, y: 0 },
    ]);
    out.push([
      { x: 0, y: -c },
      { x: 0, y: c },
    ]);
  }
  if (!r.showExtensions) return out;
  const axes: Vec2[] = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  axes.forEach((u, k) => {
    const from = c + g;
    const to = radius + (r.extensions[k] ?? 0);
    if (to > from) out.push([scale(u, from), scale(u, to)]);
  });
  return out;
}

/**
 * A centerline between lines `a` and `b`, `extensions` (start, end) past the middle of their
 * ends; undefined when both lie on one line (no centerline between them).
 */
export function centerlineOf(
  a: Segment,
  b: Segment,
  extensions: readonly number[],
): Segment | undefined {
  const da = sub(a[1], a[0]);
  let [b0, b1] = b;
  // The second line is taken the way the first runs, so start meets start.
  if (dot(da, sub(b1, b0)) < 0) [b0, b1] = [b1, b0];
  const ua = normalize(da);
  const ub = normalize(sub(b1, b0));
  if (length(ua) === 0 || length(ub) === 0) return undefined;
  const m0 = midpoint(a[0], b0);
  const m1 = midpoint(a[1], b1);
  let origin = m0;
  let u = ua;
  const sin = cross(ua, ub);
  // Parallel lines on one line (end to end, or overlapping) have nothing between them.
  const size = Math.max(length(da), length(sub(b1, b0)));
  if (Math.abs(sin) <= 1e-9 && Math.abs(cross(ua, sub(b0, a[0]))) <= 1e-9 * size) return undefined;
  if (Math.abs(sin) > 1e-9) {
    // Not parallel: the bisector through where the lines (extended) cross.
    const t = cross(sub(b0, a[0]), ub) / cross(ua, ub);
    origin = add(a[0], scale(ua, t));
    u = normalize(add(ua, ub));
  }
  const on = (p: Vec2): number => dot(sub(p, origin), u);
  const s = on(m0) - (extensions[0] ?? 0);
  const e = on(m1) + (extensions[1] ?? 0);
  if (e - s <= 0) return undefined;
  return [add(origin, scale(u, s)), add(origin, scale(u, e))];
}

/** A line segment of `e` (a LINE), or undefined. */
function segmentOf(e: Entity | undefined): Segment | undefined {
  return e?.geom.kind === 'LINE' ? [e.geom.start, e.geom.end] : undefined;
}

/** What a mark is drawn from: the centre and radius, or the centerline itself. */
type Shape =
  | { readonly kind: 'mark'; readonly center: Vec2; readonly radius: number }
  | { readonly kind: 'line'; readonly line: Segment };

/** The mark's shape from its objects as `entityOf` gives them, or undefined when one is unfit. */
function shapeOf(
  r: Pick<CenterMark, 'kind' | 'objects' | 'extensions'>,
  entityOf: (h: Handle) => Entity | undefined,
): Shape | undefined {
  if (r.kind === 'mark') {
    const g = entityOf(r.objects[0]!)?.geom;
    if (g?.kind !== 'CIRCLE' && g?.kind !== 'ARC') return undefined;
    return { kind: 'mark', center: g.center, radius: g.radius };
  }
  const a = segmentOf(entityOf(r.objects[0]!));
  const b = segmentOf(entityOf(r.objects[1]!));
  const line = a && b && centerlineOf(a, b, r.extensions);
  return line && { kind: 'line', line };
}

/** Layer 0, where a block's contents take the reference's properties. */
function layerZero(model: DocumentModel): Handle {
  for (const l of model.tables.layers.values()) if (l.name === '0') return l.handle;
  return [...model.tables.layers.values()][0]!.handle;
}

/** Puts `segments` (block coordinates) into `block` in place of what it held. */
function fillBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  block: Handle,
  segments: readonly Segment[],
): void {
  for (const id of b.blockEntities(block)) b.removeEntity(id);
  const layer = layerZero(model);
  for (const [start, end] of segments) {
    b.addEntity({
      owner: block,
      layer,
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
      geom: { kind: 'LINE', start, end },
    });
  }
}

/** The INSERT geometry and block lines that draw `shape`, keeping the INSERT's rotation. */
function placement(
  shape: Shape,
  r: Pick<CenterMark, 'crossSize' | 'crossGap' | 'extensions' | 'showExtensions'>,
  rotation: number,
): { position: Vec2; rotation: number; segments: Segment[] } {
  if (shape.kind === 'mark') {
    return { position: shape.center, rotation, segments: centerMarkLines(shape.radius, r) };
  }
  const [s, e] = shape.line;
  const m = midpoint(s, e);
  return { position: m, rotation: 0, segments: [[sub(s, m), sub(e, m)]] };
}

export interface NewCenterMark {
  readonly space: Handle;
  readonly props: GeneralProps;
  readonly kind: CenterMark['kind'];
  /** The circle or arc; the two lines. */
  readonly objects: readonly Entity[];
  readonly settings: CenterSettings;
}

/**
 * Makes a center mark or centerline on `objects`: a new INSERT of a new anonymous block, with
 * its record. Returns the INSERT, or undefined when the objects make none (lines end to end).
 */
export function makeCenterMark(
  b: ChangeSetBuilder,
  model: DocumentModel,
  m: NewCenterMark,
  names: AnonymousNames = new AnonymousNames(model),
): Entity | undefined {
  const fields = {
    kind: m.kind,
    objects: m.objects.map((e) => e.handle),
    ...(m.kind === 'mark'
      ? {
          crossSize: m.settings.crossSize,
          crossGap: m.settings.crossGap,
          extensions: [1, 2, 3, 4].map(() => m.settings.extension),
          showExtensions: m.settings.showExtensions,
        }
      : { extensions: [m.settings.extension, m.settings.extension] }),
  };
  const byHandle = new Map(m.objects.map((e) => [e.handle, e]));
  const shape = shapeOf(fields, (h) => byHandle.get(h));
  if (!shape) return undefined;
  const p = placement(shape, fields, 0);
  const block = b.addBlock({ name: names.take('U'), basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
  fillBlock(b, model, block, p.segments);
  const insert = b.addEntity({
    owner: m.space,
    ...m.props,
    geom: {
      kind: 'INSERT',
      block,
      position: p.position,
      scale: { x: 1, y: 1, z: 1 },
      rotation: p.rotation,
      attributes: [],
    },
  });
  b.addObject({
    ...fields,
    type: 'TRIYA_CENTERMARK',
    owner: insert.handle,
    insert: insert.handle,
  } as Omit<CenterMark, 'handle'>);
  return insert;
}

/**
 * Draws the mark again from its objects as the change being built has them: its block's lines
 * and its INSERT's place (a center mark keeps its rotation; scale and mirroring go). Returns
 * false, changing nothing, when an object no longer makes a mark.
 */
export function remakeCenterMark(
  b: ChangeSetBuilder,
  model: DocumentModel,
  insert: Entity,
  r: CenterMark,
): boolean {
  if (insert.geom.kind !== 'INSERT') return false;
  const shape = shapeOf(r, (h) => {
    const e = model.entityByHandle(h);
    return e && b.entity(e.id);
  });
  if (!shape) return false;
  const p = placement(shape, r, insert.geom.rotation);
  fillBlock(b, model, insert.geom.block, p.segments);
  b.updateEntity(insert.id, {
    geom: {
      ...insert.geom,
      position: p.position,
      rotation: p.rotation,
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  return true;
}

/** Takes the record off a mark: it stays as drawn, a plain block reference. */
export function disassociateCenterMark(b: ChangeSetBuilder, r: CenterMark): void {
  b.removeObject(r.handle);
}

const sameGeometry = (a: EntityGeometry, b: EntityGeometry): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What the edits in `changes` carry along to the marks Triya made, in the same undo step (the
 * bus calls this as a command ends): a mark whose object changed is drawn again; one whose
 * object was erased (or no longer makes a mark) is erased; one moved, turned or scaled without
 * its objects lets go of them, staying where it was put. A mark erased takes its record along.
 */
export function followCenterMarks(
  model: DocumentModel,
  edit: (build: (b: ChangeSetBuilder) => void) => void,
  changes: readonly {
    readonly entities?: {
      readonly updated?: readonly { readonly before: Entity; readonly after: Entity }[];
      readonly removed?: readonly { readonly entity: Entity }[];
    };
  }[],
): void {
  const updated = new Set<Handle>();
  const moved = new Set<Handle>();
  const removed = new Set<Handle>();
  for (const cs of changes) {
    for (const u of cs.entities?.updated ?? []) {
      updated.add(u.after.handle);
      if (!sameGeometry(u.before.geom, u.after.geom)) moved.add(u.after.handle);
    }
    for (const r of cs.entities?.removed ?? []) removed.add(r.entity.handle);
  }
  if (updated.size === 0 && removed.size === 0) return;
  const work: { insert: Entity | undefined; r: CenterMark; act: 'remake' | 'erase' | 'drop' }[] =
    [];
  for (const o of model.objects.values()) {
    if (!isCenterMark(o)) continue;
    const insert = model.entityByHandle(o.insert);
    if (!insert) {
      // The mark itself was erased (or exploded): its record goes with it.
      if (removed.has(o.insert)) work.push({ insert, r: o, act: 'drop' });
      continue;
    }
    if (o.objects.some((h) => removed.has(h) || !model.entityByHandle(h))) {
      if (o.objects.some((h) => removed.has(h))) work.push({ insert, r: o, act: 'erase' });
      continue;
    }
    if (o.objects.some((h) => moved.has(h))) work.push({ insert, r: o, act: 'remake' });
    else if (moved.has(o.insert)) work.push({ insert, r: o, act: 'drop' });
  }
  if (work.length === 0) return;
  edit((b) => {
    for (const { insert, r, act } of work) {
      if (act === 'remake' && insert && remakeCenterMark(b, model, insert, r)) continue;
      if (act === 'drop' && insert) {
        disassociateCenterMark(b, r);
        continue;
      }
      b.removeObject(r.handle);
      if (insert && b.entity(insert.id)) b.removeEntity(insert.id);
    }
  });
}

/**
 * COPY gives each copy of a mark a block of its own (`copies`: original handle → copy), so that
 * drawing the original again leaves the copy be; a copy made with all its objects is a mark of
 * those copies, associative as the original is, and one made without them is a plain block.
 */
export function copyCenterMarks(
  b: ChangeSetBuilder,
  model: DocumentModel,
  copies: ReadonlyMap<Handle, Entity>,
  names: AnonymousNames,
): void {
  const objects = new Map([...b.objects()].map((o) => [o.handle, o]));
  for (const [original, copy] of copies) {
    const r = centerMarkOf({ objects }, model.entityByHandle(original));
    if (!r || copy.geom.kind !== 'INSERT') continue;
    const block = b.addBlock({ name: names.take('U'), basePoint: { x: 0, y: 0 }, flags: 1 });
    const segments: Segment[] = [];
    for (const id of b.blockEntities(copy.geom.block)) {
      const g = b.entity(id)?.geom;
      if (g?.kind === 'LINE') segments.push([g.start, g.end]);
    }
    fillBlock(b, model, block.handle, segments);
    b.updateEntity(copy.id, { geom: { ...copy.geom, block: block.handle } });
    if (!r.objects.every((h) => copies.has(h))) continue;
    const { handle: _h, owner: _o, insert: _i, ...fields } = r;
    b.addObject({
      ...fields,
      objects: r.objects.map((h) => copies.get(h)!.handle),
      owner: copy.handle,
      insert: copy.handle,
    } as Omit<CenterMark, 'handle'>);
  }
}
