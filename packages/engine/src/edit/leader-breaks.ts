// DIMBREAK on leaders and multileaders (M4-15, DEC-064 as extended by DEC-065): AutoCAD 2024's
// DIMBREAK also breaks "multileaders (straight leaders only) and leaders (straight only)" (AutoCAD
// 2024 Help, "About Dimension Breaks"). The breaks are the same `TRIYA_DIMBREAK` record a
// dimension's are, in the leader's extension dictionary; its `dimension` field names the leader.
//
// A dimension draws its gaps into its `*D` block when it is regenerated; a leader and a
// multileader have no block, so the gaps are cut out of their parts each time the parts are drawn
// (`withLeaderBreaks`, which the renderer applies after `annotationParts`). The parts that break
// are the straight leader lines and landings (`AnnotationPart.breakable`); arrowheads, content,
// underlines and spline leaders stay whole.
//
// Gap sizes (AutoCAD 2024 Help, "Modify Multileader Style Dialog Box", Leader Format tab, "Break
// Size: Displays and sets the size used for the DIMBREAK command when the multileader is
// selected"; "Symbols and Arrows Tab (Dimension Style Manager)", Dimension Break): a
// multileader's is its style's Break size (DXF 143) times its overall scale; a leader's is its
// dimension style's Break size (`ACAD_DSTYLE_DIMBREAK`, its own override first) times DIMSCALE.
// Either is 0.125 when the style states none, as for dimensions.
//
// A leader is drawn again (touched in the change, so the renderer and the spatial index take it
// afresh) when its record changes or, as a command ends, when an object breaking it changes
// (`followLeaderBreaks`), as a dimension is regenerated (`restyledDimensions`).
import { boxesOverlap, curveBounds, unionBox, EMPTY_BOX, type Box } from '../geom/bounds';
import { closestPoint } from '../geom/closest';
import type { Curve } from '../geom/curves';
import { intersect } from '../geom/intersect';
import { toleranceForSize, type Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { leaderParts, dimVars, dimNum } from '../annotation/leader';
import { drawnDimStyle } from '../annotation/dimstyle-family';
import { dimStyleXdataVars } from '../annotation/dimstyle-xdata';
import { multiLeaderParts, type AnnotationPart } from '../annotation/multileader';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import {
  isDimBreak,
  type DimBreak,
  type Entity,
  type LeaderGeometry,
  type LwPolylineGeometry,
  type MultiLeaderGeometry,
} from '../model/types';
import { breakingCurves, dimBreakOf } from './dimension-records';

/** A leader or multileader. */
export type BreakableLeader = Entity & { geom: LeaderGeometry | MultiLeaderGeometry };

export const isBreakableLeader = (e: Entity | undefined): e is BreakableLeader =>
  e !== undefined && (e.geom.kind === 'LEADER' || e.geom.kind === 'MULTILEADER');

/** AutoCAD's Break size when the style states none. */
const DEFAULT_BREAK_SIZE = 0.125;

/** The parts a leader draws, before any break. */
function partsOf(model: DocumentModel, e: BreakableLeader): AnnotationPart[] {
  return e.geom.kind === 'LEADER'
    ? leaderParts(e.geom, e.xdata, model)
    : multiLeaderParts(e.geom, model);
}

/** The leader's tolerance, for its size. */
export function leaderTolerance(e: BreakableLeader): Tolerance {
  const g = e.geom;
  const pts: Vec2[] =
    g.kind === 'LEADER'
      ? [...g.vertices]
      : [
          g.contentBase,
          ...g.branches.flatMap((b) => [b.connection, ...b.lines.flatMap((l) => l.vertices)]),
        ];
  return toleranceForSize(Math.max(0, ...pts.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])));
}

/** A straight polyline part's segments. */
function segments(g: LwPolylineGeometry): Curve[] {
  const out: Curve[] = [];
  for (let i = 0; i + 1 < g.vertices.length; i++) {
    const a = g.vertices[i]!;
    const b = g.vertices[i + 1]!;
    if (a.x !== b.x || a.y !== b.y) {
      out.push({ kind: 'LINE', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
    }
  }
  return out;
}

const breakableLines = (parts: readonly AnnotationPart[]): LwPolylineGeometry[] =>
  parts.flatMap((p) => (p.breakable && p.geom.kind === 'LWPOLYLINE' ? [p.geom] : []));

/** The straight leader lines and landings a break can cut, as line segments. */
export function leaderBreakCurves(model: DocumentModel, e: BreakableLeader): Curve[] {
  return breakableLines(partsOf(model, e)).flatMap(segments);
}

/**
 * Manual: the two points put on the straight leader line or landing segment nearest the first,
 * each where it is closest to it, as AutoCAD puts a dimension's manual break on the line nearest
 * its first point; undefined when the leader has no straight lines.
 */
export function leaderManualBreak(
  model: DocumentModel,
  e: BreakableLeader,
  a: Vec2,
  b: Vec2,
): readonly [Vec2, Vec2] | undefined {
  const tol = leaderTolerance(e);
  let best: { c: Curve; d: number } | undefined;
  for (const c of leaderBreakCurves(model, e)) {
    const d = closestPoint(c, a, tol).distance;
    if (!best || d < best.d) best = { c, d };
  }
  if (!best) return undefined;
  return [closestPoint(best.c, a, tol).point, closestPoint(best.c, b, tol).point] as const;
}

/** The size of a gap in the leader. */
export function leaderBreakSize(model: DocumentModel, e: BreakableLeader): number {
  const g = e.geom;
  if (g.kind === 'MULTILEADER') {
    const style = g.style === undefined ? undefined : model.tables.mleaderStyles.get(g.style);
    const size = style && style.breakGap >= 0 ? style.breakGap : DEFAULT_BREAK_SIZE;
    return size * (g.scale > 0 ? g.scale : 1);
  }
  const style = drawnDimStyle(model, g);
  const own = dimStyleXdataVars(model, e.xdata).DIMBREAK;
  const styled = dimStyleXdataVars(model, model.tables.dimStyles.get(style)?.xdata).DIMBREAK;
  const v = typeof own === 'number' ? own : typeof styled === 'number' ? styled : undefined;
  const dimscale = dimNum(dimVars(style, e.xdata, model).DIMSCALE, 1) || 1;
  return (v !== undefined && v >= 0 ? v : DEFAULT_BREAK_SIZE) * dimscale;
}

/** `[from, to]` intervals taken out of [0, end], what is left in order. */
function remaining(cuts: readonly (readonly [number, number])[], end: number): [number, number][] {
  const sorted = cuts
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(end, Math.max(a, b))] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [a, b] of sorted) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < end) out.push([at, end]);
  return out;
}

/** A polyline measured along its length. */
interface Path {
  readonly pts: readonly Vec2[];
  /** The distance along the path at each vertex. */
  readonly at: readonly number[];
}

function pathOf(g: LwPolylineGeometry): Path {
  const pts = g.vertices.map((v) => ({ x: v.x, y: v.y }));
  const at = [0];
  for (let i = 1; i < pts.length; i++) {
    at.push(at[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  }
  return { pts, at };
}

/** The point at distance `s` along the path. */
function pointAt(p: Path, s: number): Vec2 {
  for (let i = 1; i < p.pts.length; i++) {
    if (s <= p.at[i]! || i === p.pts.length - 1) {
      const len = p.at[i]! - p.at[i - 1]!;
      const k = len > 0 ? (s - p.at[i - 1]!) / len : 0;
      const a = p.pts[i - 1]!;
      const b = p.pts[i]!;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return p.pts[0]!;
}

/** The distance along the path of `q`, when it lies on the path (within `near`). */
function distanceAlong(p: Path, q: Vec2, near: number): number | undefined {
  let best: { s: number; d: number } | undefined;
  for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1]!;
    const b = p.pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (!(l2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
    const d = Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t));
    if (d <= near && (!best || d < best.d)) best = { s: p.at[i - 1]! + t * Math.sqrt(l2), d };
  }
  return best?.s;
}

/** The pieces of the path between `from` and `to` along it. */
function piece(p: Path, from: number, to: number): Vec2[] {
  const out = [pointAt(p, from)];
  for (let i = 0; i < p.pts.length; i++) if (p.at[i]! > from && p.at[i]! < to) out.push(p.pts[i]!);
  out.push(pointAt(p, to));
  return out;
}

/** The polyline with the record's gaps cut out: its pieces, or itself when nothing cuts it. */
function brokenLine(
  g: LwPolylineGeometry,
  record: Pick<DimBreak, 'manual'>,
  curves: readonly Curve[],
  size: number,
): LwPolylineGeometry[] {
  const p = pathOf(g);
  const end = p.at[p.at.length - 1] ?? 0;
  if (!(end > 0)) return [g];
  const scale = Math.max(1, ...p.pts.flatMap((v) => [Math.abs(v.x), Math.abs(v.y)]));
  const tol = toleranceForSize(scale * 10);
  const near = 1e-6 * scale;
  const cuts: [number, number][] = [];
  segments(g).forEach((seg) => {
    for (const c of curves) {
      for (const x of intersect(seg, c, tol)) {
        const s = distanceAlong(p, x.point, near);
        if (s !== undefined) cuts.push([s - size / 2, s + size / 2]);
      }
    }
  });
  for (const [a, b] of record.manual) {
    const sa = distanceAlong(p, a, near);
    const sb = distanceAlong(p, b, near);
    if (sa !== undefined && sb !== undefined) cuts.push([sa, sb]);
  }
  if (cuts.length === 0) return [g];
  return remaining(cuts, end).map(([a, b]) => ({
    ...g,
    vertices: piece(p, a, b).map((v) => ({ x: v.x, y: v.y, bulge: 0 })),
  }));
}

/**
 * The leader's parts with its breaks cut out of its straight leader lines and landings, when it
 * has a record of them; the parts as they are otherwise.
 */
export function withLeaderBreaks(
  model: DocumentModel,
  e: Entity,
  parts: AnnotationPart[],
): AnnotationPart[] {
  if (!isBreakableLeader(e) || e.extDict === undefined) return parts;
  const record = dimBreakOf(model, e);
  if (!record || (record.objects.length === 0 && record.manual.length === 0)) return parts;
  const curves = breakingCurves(model, e, record, leaderTolerance(e));
  const size = leaderBreakSize(model, e);
  const out: AnnotationPart[] = [];
  for (const part of parts) {
    if (!part.breakable || part.geom.kind !== 'LWPOLYLINE') {
      out.push(part);
      continue;
    }
    for (const geom of brokenLine(part.geom, record, curves, size)) out.push({ ...part, geom });
  }
  return out;
}

const boundsOf = (curves: readonly Curve[], tol: Tolerance): Box =>
  curves.reduce((b, c) => unionBox(b, curveBounds(c, tol)), EMPTY_BOX);

/**
 * DIMBREAK's Auto on a leader: the objects of its space that cross its straight leader lines and
 * landings, in drawing order. A LEADER's own annotation (its MTEXT, TOLERANCE or block) is left
 * out: it sits on the hook line.
 */
export function leaderCrossingObjects(model: DocumentModel, e: BreakableLeader): Handle[] {
  const tol = leaderTolerance(e);
  const own = leaderBreakCurves(model, e);
  if (own.length === 0) return [];
  const box = boundsOf(own, tol);
  const skip = new Set([e.handle]);
  if (e.geom.kind === 'LEADER' && e.geom.annotation !== undefined) skip.add(e.geom.annotation);
  const out: Handle[] = [];
  for (const id of model.blockEntities(e.owner)) {
    const o = model.entity(id);
    if (!o || skip.has(o.handle)) continue;
    const layer = model.tables.layers.get(o.layer);
    if (layer && (!layer.on || layer.frozen)) continue;
    const curves = breakingCurves(model, e, { objects: [o.handle] }, tol);
    if (curves.length === 0 || !boxesOverlap(boundsOf(curves, tol), box, tol.linear)) continue;
    if (curves.some((c) => own.some((d) => intersect(c, d, tol).length > 0))) out.push(o.handle);
  }
  return out;
}

/** Has the leader drawn again: a change to it the renderer and spatial index take afresh. */
export function redrawLeader(b: ChangeSetBuilder, e: Pick<Entity, 'id'>): void {
  if (b.entity(e.id)) b.updateEntity(e.id, {});
}

/**
 * As a command ends (the bus's `followAssociations`): the leaders and multileaders broken by an
 * object the command changed, added or erased are drawn again, in its undo step. A leader the
 * command changed itself is drawn again already.
 */
export function followLeaderBreaks(
  model: DocumentModel,
  edit: (build: (b: ChangeSetBuilder) => void) => void,
  changes: readonly {
    readonly entities?: {
      readonly added?: readonly { readonly entity: Entity }[];
      readonly updated?: readonly { readonly before: Entity; readonly after: Entity }[];
      readonly removed?: readonly { readonly entity: Entity }[];
    };
  }[],
): void {
  const touched = new Set<Handle>();
  const leaders = new Set<Handle>();
  for (const cs of changes) {
    for (const u of cs.entities?.updated ?? []) {
      touched.add(u.after.handle);
      leaders.add(u.after.handle);
    }
    for (const { entity } of [...(cs.entities?.added ?? []), ...(cs.entities?.removed ?? [])])
      touched.add(entity.handle);
  }
  if (touched.size === 0) return;
  const redraw: Entity[] = [];
  for (const o of model.objects.values()) {
    if (!isDimBreak(o) || leaders.has(o.dimension) || !o.objects.some((h) => touched.has(h)))
      continue;
    const e = model.entityByHandle(o.dimension);
    if (isBreakableLeader(e)) redraw.push(e);
  }
  if (redraw.length === 0) return;
  edit((b) => {
    for (const e of redraw) redrawLeader(b, e);
  });
}
