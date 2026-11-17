// Center marks and centerlines Triya makes (CENTERMARK, CENTERLINE; M4-08). Each is one INSERT
// of an anonymous `*U` block of lines, as AutoCAD saves the visible part of one, so every reader
// draws it; a `CenterMark` record in the INSERT's extension dictionary (a `TRIYA_CENTERMARK`
// XRECORD in the file, DEC-066) keeps it associative to the circle, arc or lines it was made on. As a command ends (the bus's `followAssociations`) a
// mark whose objects changed is drawn again from them, a mark whose object is gone goes with it,
// and a mark moved on its own lets go of its objects: it stays a center mark, associated to
// nothing (its record names no objects, part 3), as AutoCAD's disassociated marks are, until
// CENTERREASSOCIATE gives it objects again. A save writes such a mark as DEC-066 item 3 says, its
// dictionary empty, so a reopened one is a plain block reference.
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
//
// CENTERLINE also takes a polyline's straight segments (M4-29; AutoCAD 2024 Help, "CENTERLINE
// (Command)": "Creates a centerline associated with selected lines and linear polyline
// segments"): the record names the polyline and the vertex the segment starts at (`segments`,
// DEC-068), and the centerline follows that segment. A polyline edited so that the segment is
// gone or no longer straight makes no centerline, and the centerline goes, as a mark whose
// object makes none does.
import { bulgeArc } from '../geom/eval';
import type { Vec2 } from '../geom/types';
import { add, cross, dot, length, midpoint, normalize, scale, sub } from '../geom/vec';
import { centerLength, type CenterSettings } from './center-settings';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { RecordPatch } from '../model/update';
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
  insert: Pick<Entity, 'handle' | 'extDict'> | undefined,
): CenterMark | undefined {
  // Only a mark has an extension dictionary holding one: most block references have none.
  if (!insert || insert.extDict === undefined) return undefined;
  for (const o of model.objects.values()) {
    if (isCenterMark(o) && o.insert === insert.handle && o.owner === insert.extDict) return o;
  }
  return undefined;
}

/** Whether the mark follows objects: one CENTERDISASSOCIATE (or a move on its own) let go names none. */
export const isAssociated = (r: Pick<CenterMark, 'objects'>): boolean => r.objects.length > 0;

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

/** Whether `g` is a polyline whose segments a centerline may run along: a plan one, not fit. */
function isLinearPolyline(
  g: EntityGeometry,
): g is Extract<EntityGeometry, { kind: 'LWPOLYLINE' | 'POLYLINE' }> {
  if (g.kind === 'LWPOLYLINE') return true;
  return g.kind === 'POLYLINE' && !g.is3d && g.fit === undefined;
}

/** The segment of polyline `g` from vertex `i`, with its bulge; undefined past its last. */
function polylineSegment(
  g: Extract<EntityGeometry, { kind: 'LWPOLYLINE' | 'POLYLINE' }>,
  i: number,
): { segment: Segment; bulge: number } | undefined {
  const v = g.vertices;
  const n = g.closed ? v.length : v.length - 1;
  if (!Number.isInteger(i) || i < 0 || i >= n) return undefined;
  const p = v[i]!;
  const q = v[(i + 1) % v.length]!;
  return { segment: [p, q], bulge: p.bulge ?? 0 };
}

/**
 * A line segment of `e`: a LINE's, or a polyline's straight segment from vertex `index`;
 * undefined for anything else (a curved or zero-length segment, one past the polyline's last).
 */
function segmentOf(e: Entity | undefined, index = -1): Segment | undefined {
  if (!e) return undefined;
  if (e.geom.kind === 'LINE') return index < 0 ? [e.geom.start, e.geom.end] : undefined;
  if (index < 0 || !isLinearPolyline(e.geom)) return undefined;
  const s = polylineSegment(e.geom, index);
  if (!s || s.bulge !== 0 || length(sub(s.segment[1], s.segment[0])) === 0) return undefined;
  return s.segment;
}

/** What a pick on `e` gives CENTERLINE: a line (segment -1), a polyline's segment, or nothing. */
export type CenterlinePick =
  { readonly segment: number } | { readonly refused: 'not-line' | 'curved' };

/**
 * The segment of `e` a pick at `at` takes for a centerline: a LINE whole, a polyline's segment
 * nearest the pick (without one, its first straight segment), refused when that segment is an
 * arc or `e` is no line or plan polyline.
 */
export function centerlinePick(e: Entity, at: Vec2 | undefined): CenterlinePick {
  if (e.geom.kind === 'LINE') return { segment: -1 };
  if (!isLinearPolyline(e.geom)) return { refused: 'not-line' };
  const g = e.geom;
  const n = g.closed ? g.vertices.length : g.vertices.length - 1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const s = polylineSegment(g, i)!;
    if (!at) {
      if (segmentOf(e, i)) return { segment: i };
      continue;
    }
    const d = s.bulge === 0 ? toSegment(at, s.segment) : toBulge(at, s.segment, s.bulge);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0 || !segmentOf(e, best)) return { refused: 'curved' };
  return { segment: best };
}

/** How far `p` is from the segment. */
function toSegment(p: Vec2, [a, b]: Segment): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return length(sub(p, add(a, scale(ab, t))));
}

/** How far `p` is from the arc a segment with `bulge` draws. */
function toBulge(p: Vec2, [a, b]: Segment, bulge: number): number {
  const arc = bulgeArc(a, b, bulge);
  const t = Math.atan2(p.y - arc.center.y, p.x - arc.center.x) - arc.startAngle;
  const sweep = arc.sweep;
  // Where `p` lies round from the arc's start, the way it turns, in [0, 2π).
  const round = (((sweep >= 0 ? t : -t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (round <= Math.abs(sweep)) return Math.abs(length(sub(p, arc.center)) - arc.radius);
  return Math.min(length(sub(p, a)), length(sub(p, b)));
}

/** What a mark is drawn from: the centre and radius, or the centerline itself. */
type Shape =
  | { readonly kind: 'mark'; readonly center: Vec2; readonly radius: number }
  | { readonly kind: 'line'; readonly line: Segment };

/** The mark's shape from its objects as `entityOf` gives them, or undefined when one is unfit. */
function shapeOf(
  r: Pick<CenterMark, 'kind' | 'objects' | 'extensions' | 'segments'>,
  entityOf: (h: Handle) => Entity | undefined,
): Shape | undefined {
  if (!isAssociated(r)) return undefined;
  if (r.kind === 'mark') {
    const g = entityOf(r.objects[0]!)?.geom;
    if (g?.kind !== 'CIRCLE' && g?.kind !== 'ARC') return undefined;
    return { kind: 'mark', center: g.center, radius: g.radius };
  }
  const a = segmentOf(entityOf(r.objects[0]!), r.segments?.[0]);
  const b = segmentOf(entityOf(r.objects[1]!), r.segments?.[1]);
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
  /** The circle or arc; the two lines (LINEs or polylines). */
  readonly objects: readonly Entity[];
  /** A centerline's segment of each object: a polyline's vertex index, -1 for a LINE. */
  readonly segments?: readonly number[];
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
      : {
          extensions: [m.settings.extension, m.settings.extension],
          ...segmentsField(m.segments),
        }),
  };
  const byHandle = new Map(m.objects.map((e) => [e.handle, e]));
  const shape = shapeOf(fields, (h) => byHandle.get(h));
  if (!shape) return undefined;
  const p = placement(shape, fields, 0);
  const block = b.addBlock({ name: names.take('U'), basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
  fillBlock(b, model, block, p.segments);
  const dictionary = b.allocateHandle();
  const insert = b.addEntity({
    owner: m.space,
    ...m.props,
    extDict: dictionary,
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
    owner: dictionary,
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

/**
 * The record's `segments` for a centerline's objects' segments: absent when every object is a
 * LINE, so a centerline between lines keeps the record DEC-066 set out (version 1).
 */
export function segmentsField(segments: readonly number[] | undefined): {
  segments?: readonly number[];
} {
  return segments?.some((i) => i >= 0) ? { segments: [...segments] } : {};
}

/** A record patch; a field set to undefined leaves the record. */
const patchOf = (fields: {
  readonly [K in keyof CenterMark]?: CenterMark[K] | undefined;
}): RecordPatch<NonGraphicalObject> => fields as RecordPatch<NonGraphicalObject>;

/**
 * Lets a mark go of its objects (CENTERDISASSOCIATE, or the mark moved on its own): it stays as
 * drawn, a center mark associated to nothing.
 */
export function disassociateCenterMark(b: ChangeSetBuilder, r: CenterMark): void {
  b.updateObject(r.handle, patchOf({ objects: [], segments: undefined }));
}

/** The lines of `block` as the change being built has them. */
function blockLines(b: ChangeSetBuilder, block: Handle): Segment[] {
  const out: Segment[] = [];
  for (const id of b.blockEntities(block)) {
    const g = b.entity(id)?.geom;
    if (g?.kind === 'LINE') out.push([g.start, g.end]);
  }
  return out;
}

/** Whether `a` and `b` are the same lines, in any order and either way round. */
function sameSegments(a: readonly Segment[], b: readonly Segment[], tol: number): boolean {
  if (a.length !== b.length) return false;
  const near = (p: Vec2, q: Vec2) => length(sub(p, q)) <= tol;
  const left = [...b];
  for (const [p, q] of a) {
    const i = left.findIndex(([s, e]) => (near(p, s) && near(q, e)) || (near(p, e) && near(q, s)));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/**
 * The radius of the circle a center mark's `lines` (its block's, centred on the origin) were
 * drawn for with the record `r`: the radius whose mark they are, tried from each line end less
 * each extension, and from a relative cross size or gap; undefined when none draws them.
 */
function markRadius(lines: readonly Segment[], r: CenterMark): number | undefined {
  const tries = new Set<number>();
  const factor = (t: string | undefined) =>
    t !== undefined && /x$/i.test(t.trim()) ? Number(t.trim().slice(0, -1)) : NaN;
  for (const [p, q] of lines) {
    for (const d of [length(p), length(q)]) {
      for (const e of r.extensions) tries.add(d - e);
      for (const f of [factor(r.crossSize), factor(r.crossSize) + factor(r.crossGap)]) {
        if (f > 0) tries.add(d / (2 * f));
      }
    }
  }
  for (const radius of tries) {
    if (!(radius > 0)) continue;
    const tol = 1e-7 * Math.max(1, radius + Math.max(0, ...r.extensions));
    if (sameSegments(centerMarkLines(radius, r), lines, tol)) return radius;
  }
  return undefined;
}

/**
 * Draws a mark associated to nothing again with the record `after` from the lines it draws now
 * (its block, drawn with `before`), where it is: a centerline keeps its line and changes how far
 * it goes past its ends, a center mark the circle its lines were drawn for. Extensions are in
 * the drawing, the block in its own units (a mark scaled on its own has a scale other than 1).
 * Returns false, changing nothing, when its lines are not a mark `before` draws.
 */
function redrawFree(
  b: ChangeSetBuilder,
  model: DocumentModel,
  insert: Entity,
  before: CenterMark,
  after: CenterMark,
): boolean {
  if (insert.geom.kind !== 'INSERT') return false;
  const k = Math.abs(insert.geom.scale.x) || 1;
  const inBlock = (r: CenterMark): CenterMark => ({
    ...r,
    extensions: r.extensions.map((e) => e / k),
  });
  const lines = blockLines(b, insert.geom.block);
  let segments: Segment[];
  if (before.kind === 'line') {
    if (lines.length !== 1) return false;
    const [s, e] = lines[0]!;
    const u = normalize(sub(e, s));
    if (length(u) === 0) return false;
    const was = inBlock(before).extensions;
    const now = inBlock(after).extensions;
    const s0 = add(s, scale(u, (was[0] ?? 0) - (now[0] ?? 0)));
    const e0 = add(e, scale(u, (now[1] ?? 0) - (was[1] ?? 0)));
    if (dot(sub(e0, s0), u) <= 0) return false;
    segments = [[s0, e0]];
  } else {
    const radius = markRadius(lines, inBlock(before));
    if (radius === undefined) return false;
    segments = centerMarkLines(radius, inBlock(after));
  }
  fillBlock(b, model, insert.geom.block, segments);
  return true;
}

/**
 * Gives the mark of `insert` the record `after` (the same record, changed: CENTERRESET's
 * extensions, MATCHPROP's Center object, CENTERREASSOCIATE's objects) and draws it again: from
 * its objects when it has them, else from the lines it draws now. Returns false, changing
 * nothing, when it cannot be drawn so (an object that makes no mark).
 */
export function redrawCenterMark(
  b: ChangeSetBuilder,
  model: DocumentModel,
  insert: Entity,
  before: CenterMark,
  after: CenterMark,
): boolean {
  const drawn = isAssociated(after)
    ? remakeCenterMark(b, model, insert, after)
    : redrawFree(b, model, insert, before, after);
  if (!drawn) return false;
  const { handle: _h, ...fields } = after;
  // Segments the record no longer has (a centerline moved onto lines) leave it.
  b.updateObject(after.handle, patchOf({ segments: undefined, ...fields }));
  return true;
}

/**
 * MATCHPROP's Center object (AutoCAD 2024 Help, "Property Settings Dialog Box": "Changes the
 * center mark or centerline of the destination object to match those of the source"): the
 * target's record with the source's cross size, gap, extension lines shown and extensions, or
 * undefined when the setting is off or nothing changes. Between a center mark and a centerline
 * only the extension goes over (the source's first, left or start, to each of the target's);
 * the linetype and its scale are the Basic Properties' Ltype and Ltscale.
 */
export function matchedCenterMark(
  source: CenterMark,
  target: CenterMark,
  on: boolean,
): CenterMark | undefined {
  if (!on) return undefined;
  const next: CenterMark =
    source.kind === target.kind
      ? {
          ...target,
          extensions: [...source.extensions],
          ...(target.kind === 'mark' && {
            crossSize: source.crossSize,
            crossGap: source.crossGap,
            showExtensions: source.showExtensions,
          }),
        }
      : { ...target, extensions: target.extensions.map(() => source.extensions[0] ?? 0) };
  return JSON.stringify(next) === JSON.stringify(target) ? undefined : next;
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
    readonly objects?: { readonly updated?: readonly { readonly after: NonGraphicalObject }[] };
  }[],
): void {
  const updated = new Set<Handle>();
  const moved = new Set<Handle>();
  const removed = new Set<Handle>();
  // Records the command changed itself (CENTERREASSOCIATE, CENTERRESET, MATCHPROP): their marks
  // are where it drew them.
  const redrawn = new Set<Handle>();
  for (const cs of changes) {
    for (const u of cs.objects?.updated ?? []) redrawn.add(u.after.handle);
    for (const u of cs.entities?.updated ?? []) {
      updated.add(u.after.handle);
      if (!sameGeometry(u.before.geom, u.after.geom)) moved.add(u.after.handle);
    }
    for (const r of cs.entities?.removed ?? []) removed.add(r.entity.handle);
  }
  if (updated.size === 0 && removed.size === 0) return;
  const work: {
    insert: Entity | undefined;
    r: CenterMark;
    act: 'remake' | 'erase' | 'drop' | 'free';
  }[] = [];
  for (const o of model.objects.values()) {
    if (!isCenterMark(o)) continue;
    const insert = model.entityByHandle(o.insert);
    if (!insert) {
      // The mark itself was erased (or exploded): its record goes with it.
      if (removed.has(o.insert)) work.push({ insert, r: o, act: 'drop' });
      continue;
    }
    // A mark associated to nothing stays as it is whatever happens around it.
    if (!isAssociated(o)) continue;
    if (o.objects.some((h) => removed.has(h) || !model.entityByHandle(h))) {
      if (o.objects.some((h) => removed.has(h))) work.push({ insert, r: o, act: 'erase' });
      continue;
    }
    if (o.objects.some((h) => moved.has(h))) work.push({ insert, r: o, act: 'remake' });
    else if (moved.has(o.insert) && !redrawn.has(o.handle)) {
      work.push({ insert, r: o, act: 'free' });
    }
  }
  if (work.length === 0) return;
  edit((b) => {
    for (const { insert, r, act } of work) {
      if (act === 'remake' && insert && remakeCenterMark(b, model, insert, r)) continue;
      if (act === 'free') {
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
 * drawing the original again leaves the copy be, and a record of its own in a dictionary of its
 * own: a copy made with all its objects is a mark of those copies, associative as the original
 * is, and one made without them a mark associated to nothing.
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
    const dictionary = b.allocateHandle();
    b.updateEntity(copy.id, { extDict: dictionary });
    const { handle: _h, owner: _o, insert: _i, segments: picked, ...fields } = r;
    const all = isAssociated(r) && r.objects.every((h) => copies.has(h));
    b.addObject({
      ...fields,
      ...(all && segmentsField(picked)),
      objects: all ? r.objects.map((h) => copies.get(h)!.handle) : [],
      owner: dictionary,
      insert: copy.handle,
    } as Omit<CenterMark, 'handle'>);
  }
}
