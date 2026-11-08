// TriyaToAcad for REGION (M1-75 part 39). Triya reads a REGION as the plan-view boundary of its
// ACIS body (acis/region.ts) and cannot make or reshape a body, so the only edits a save writes
// are those MOVE, ROTATE and SCALE make: the whole boundary moved, turned about +Z and scaled
// uniformly, edge for edge. The motion is recovered from the two boundaries and composed into the
// body's transform record (acis/transform.ts); the DWG wireframe point moves with it.
//
// Refused: a new REGION (COPY would need the source's ACIS body, which the model does not hold),
// a boundary that is not the original moved, turned and scaled (stretching or editing one edge
// reshapes the body), a mirrored one (a reflecting transform reverses the sense of the body's
// faces and curves, which no corpus file shows how AutoCAD saves), a change of plane direction,
// and a body whose DWG keeps isolines or silhouettes (wires cached per view, not re-derived here).

import { toleranceForSize, type RegionGeometry, type RegionLoop, type Vec2 } from '@triya/engine';
import type { Region } from '@node-projects/acad-ts';
import { XYZ } from '@node-projects/acad-ts';
import { moveBody, movePoint, type PlanMotion } from '../acis/transform';

type Edge = RegionLoop['edges'][number];

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec2): number => Math.hypot(v.x, v.y);
const onArc = (c: Vec2, r: number, a: number): Vec2 => ({
  x: c.x + r * Math.cos(a),
  y: c.y + r * Math.sin(a),
});

/** Points an edge carries that a similarity maps one to one (a circle's has no start). */
function anchors(e: Edge): Vec2[] {
  switch (e.kind) {
    case 'LINE':
      return [e.start, e.end];
    case 'ARC':
      return [
        e.center,
        onArc(e.center, e.radius, e.startAngle),
        onArc(e.center, e.radius, e.endAngle),
      ];
    case 'CIRCLE':
      return [e.center];
    case 'ELLIPSE':
      return [e.center, { x: e.center.x + e.majorAxis.x, y: e.center.y + e.majorAxis.y }];
  }
}

/** The largest coordinate or size of the boundary, for its tolerance (DEC-036). */
function magnitude(loops: readonly RegionLoop[]): number {
  let m = 0;
  for (const l of loops) {
    for (const e of l.edges) {
      for (const p of anchors(e)) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
      if (e.kind === 'ARC' || e.kind === 'CIRCLE') m = Math.max(m, e.radius);
      if (e.kind === 'ELLIPSE') m = Math.max(m, len(e.majorAxis));
    }
  }
  return m;
}

const angleGap = (a: number, b: number): number =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** `e` moved by `m` in plan. */
function moveEdge(m: PlanMotion, e: Edge): Edge {
  const p = (q: Vec2): Vec2 => {
    const r = movePoint(m, { x: q.x, y: q.y, z: 0 });
    return { x: r.x, y: r.y };
  };
  const turn = (v: Vec2): Vec2 => ({
    x: m.scale * (v.x * Math.cos(m.rotation) - v.y * Math.sin(m.rotation)),
    y: m.scale * (v.x * Math.sin(m.rotation) + v.y * Math.cos(m.rotation)),
  });
  switch (e.kind) {
    case 'LINE':
      return { ...e, start: p(e.start), end: p(e.end) };
    case 'ARC':
      return {
        ...e,
        center: p(e.center),
        radius: e.radius * m.scale,
        startAngle: e.startAngle + m.rotation,
        endAngle: e.endAngle + m.rotation,
      };
    case 'CIRCLE':
      return { ...e, center: p(e.center), radius: e.radius * m.scale };
    case 'ELLIPSE':
      return { ...e, center: p(e.center), majorAxis: turn(e.majorAxis) };
  }
}

/** Whether `a` and `b` are the same edge to `tol` (angles to its angular part). */
function sameEdge(a: Edge, b: Edge, linear: number, angular: number): boolean {
  const near = (p: Vec2, q: Vec2) => len(sub(p, q)) <= linear;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'LINE': {
      const o = b as typeof a;
      return near(a.start, o.start) && near(a.end, o.end);
    }
    case 'ARC': {
      const o = b as typeof a;
      return (
        near(a.center, o.center) &&
        Math.abs(a.radius - o.radius) <= linear &&
        anchors(a).every((p, i) => near(p, anchors(o)[i]!))
      );
    }
    case 'CIRCLE': {
      const o = b as typeof a;
      return near(a.center, o.center) && Math.abs(a.radius - o.radius) <= linear;
    }
    case 'ELLIPSE': {
      const o = b as typeof a;
      return (
        near(a.center, o.center) &&
        near(a.majorAxis, o.majorAxis) &&
        Math.abs(a.ratio - o.ratio) <= angular &&
        angleGap(a.startParam, o.startParam) <= angular &&
        angleGap(a.endParam, o.endParam) <= angular
      );
    }
  }
}

/**
 * The plan-view motion taking `before`'s boundary onto `after`'s, edge for edge, or why there
 * is none MOVE, ROTATE or SCALE could have made.
 */
export function regionMotion(before: RegionGeometry, after: RegionGeometry): PlanMotion | string {
  const shape = 'a boundary that is not the original moved, turned or scaled';
  if (before.loops.length !== after.loops.length) return shape;
  const pairs: [Vec2, Vec2][] = [];
  const circles: [number, number][] = [];
  for (const [i, l] of before.loops.entries()) {
    const k = after.loops[i]!;
    if (l.face !== k.face || l.edges.length !== k.edges.length) return shape;
    for (const [j, e] of l.edges.entries()) {
      const f = k.edges[j]!;
      if (e.kind !== f.kind) return shape;
      const [a, b] = [anchors(e), anchors(f)];
      a.forEach((p, n) => pairs.push([p, b[n]!]));
      if (e.kind === 'CIRCLE' && f.kind === 'CIRCLE') circles.push([e.radius, f.radius]);
    }
  }
  const tol = toleranceForSize(Math.max(magnitude(before.loops), magnitude(after.loops)));
  const [p0, q0] = pairs[0]!;
  // The scale and turn from the anchor farthest from the first; concentric circles alone have
  // only their radii (and no turn that shows).
  let far = 0;
  pairs.forEach(([p], n) => {
    if (len(sub(p, p0)) > len(sub(pairs[far]![0], p0))) far = n;
  });
  const v = sub(pairs[far]![0], p0);
  const w = sub(pairs[far]![1], q0);
  let scale: number;
  let rotation = 0;
  if (len(v) > tol.linear) {
    scale = len(w) / len(v);
    rotation = Math.atan2(v.x * w.y - v.y * w.x, v.x * w.x + v.y * w.y);
  } else if (circles.length > 0) scale = circles[0]![1] / circles[0]![0];
  else return shape;
  if (!(scale > 0) || !Number.isFinite(scale)) return shape;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const from = before.elevation ?? 0;
  const motion: PlanMotion = {
    rotation,
    scale,
    offset: { x: q0.x - scale * (p0.x * c - p0.y * s), y: q0.y - scale * (p0.x * s + p0.y * c) },
    from,
    to: after.elevation ?? 0,
  };
  for (const [i, l] of before.loops.entries()) {
    for (const [j, e] of l.edges.entries()) {
      if (!sameEdge(moveEdge(motion, e), after.loops[i]!.edges[j]!, tol.linear, tol.angular)) {
        // A mirrored boundary keeps its lengths but not its turn.
        return mirrored(before, after) ? 'a mirrored boundary' : shape;
      }
    }
  }
  return motion;
}

/**
 * Whether `after` is `before` reflected: the polygon through the first loop's line ends, in
 * order, turns the other way.
 */
function mirrored(before: RegionGeometry, after: RegionGeometry): boolean {
  const area = (l: RegionLoop | undefined) => {
    const ps = (l?.edges ?? []).flatMap((e) => (e.kind === 'LINE' ? [e.start, e.end] : []));
    let a = 0;
    ps.forEach((p, i) => {
      const q = ps[(i + 1) % ps.length]!;
      a += p.x * q.y - q.x * p.y;
    });
    return a;
  };
  return area(before.loops[0]) * area(after.loops[0]) < 0;
}

/** Why a REGION cannot go from `before` (undefined: new) to `after`, by its geometry alone. */
export function regionProblems(
  before: RegionGeometry | undefined,
  after: RegionGeometry,
): string[] {
  if (!before) return ['a new REGION (Triya cannot make an ACIS body)'];
  const out: string[] = [];
  const n = (g: RegionGeometry) => g.normal ?? { x: 0, y: 0, z: 1 };
  if (n(before).z !== n(after).z || n(before).x !== n(after).x || n(before).y !== n(after).y) {
    out.push('a change of plane direction');
  }
  if (before.thickness !== after.thickness) out.push('a thickness, which a REGION does not have');
  const m = regionMotion(before, after);
  if (typeof m === 'string') out.push(m);
  return out;
}

/** Why the original `region` cannot take the motion from `before` to `after`. */
export function regionDataProblems(
  region: Region,
  before: RegionGeometry,
  after: RegionGeometry,
): string[] {
  const m = regionMotion(before, after);
  if (typeof m === 'string') return [];
  if (region.wires.length > 0 || region.silhouettes.length > 0) {
    return ['a DWG REGION with isolines or silhouettes'];
  }
  const moved = moveBody(region.binaryData, m);
  return typeof moved === 'string' ? [moved] : [];
}

/** Writes the motion from `before` to `after` into `region`'s ACIS body and DWG point. */
export function writeRegion(region: Region, before: RegionGeometry, after: RegionGeometry): void {
  const m = regionMotion(before, after);
  if (typeof m === 'string') throw new Error(`REGION ${region.handle.toString(16)}: ${m}`);
  const moved = moveBody(region.binaryData, m);
  if (typeof moved === 'string') throw new Error(`REGION ${region.handle.toString(16)}: ${moved}`);
  region.binaryData = moved;
  const p = region.point;
  if (p.x !== 0 || p.y !== 0 || p.z !== 0) {
    const q = movePoint(m, p);
    region.point = new XYZ(q.x, q.y, q.z);
  }
}
