// The boundary of a planar ACIS body (a REGION), as plan-view kernel curves.
//
// Topology: body → lump → shell → face → loop → coedge ring → edge → curve, with vertices on
// points. Field positions differ between save versions (later versions insert numbers such
// as edge parameters between pointers), so each record is read by the order of its pointers,
// which is stable, and its sense by the first forward/reversed field.

import type { RegionLoop, Vec2 } from '@triya/engine';
import { isPointer, type AcisModel, type AcisRecord, type AcisValue } from './records';

type RegionEdge = RegionLoop['edges'][number];

export interface RegionBoundary {
  readonly loops: readonly RegionLoop[];
  /** WCS Z of the region's plane. */
  readonly elevation: number;
  /** True when the face normal points down (−Z). */
  readonly down: boolean;
}

export type RegionFailure = 'tilted plane' | 'unsupported boundary';

type V3 = readonly [number, number, number];

const pointers = (r: AcisRecord): number[] => r.fields.filter(isPointer).map((v) => v.ptr);
const numbers = (r: AcisRecord): number[] =>
  r.fields.flatMap((v): number[] =>
    typeof v === 'number' ? [v] : Array.isArray(v) ? [...(v as V3)] : [],
  );
/** SAT writes forward/reversed; SAB writes false/true. */
const reversed = (r: AcisRecord): boolean => {
  const s = r.fields.find(
    (v: AcisValue) => v === 'forward' || v === 'reversed' || typeof v === 'boolean',
  );
  return s === 'reversed' || s === true;
};

/** An ACIS transform: rows of a 3 × 3 matrix applied to row vectors, then translation, then scale. */
interface Transform {
  readonly m: readonly number[];
  readonly t: V3;
  readonly s: number;
}
const IDENTITY: Transform = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], s: 1 };

function transformOf(r: AcisRecord | undefined): Transform {
  if (!r) return IDENTITY;
  const n = numbers(r);
  if (n.length < 13) return IDENTITY;
  return { m: n.slice(0, 9), t: [n[9]!, n[10]!, n[11]!], s: n[12]! };
}
const apply = (x: Transform, p: V3): V3 => {
  const [a, b, c] = p;
  const m = x.m;
  return [
    (a * m[0]! + b * m[3]! + c * m[6]!) * x.s + x.t[0],
    (a * m[1]! + b * m[4]! + c * m[7]!) * x.s + x.t[1],
    (a * m[2]! + b * m[5]! + c * m[8]!) * x.s + x.t[2],
  ];
};
/** Directions turn with the matrix only. */
const turn = (x: Transform, v: V3): V3 => {
  const m = x.m;
  return [
    v[0] * m[0]! + v[1] * m[3]! + v[2] * m[6]!,
    v[0] * m[1]! + v[1] * m[4]! + v[2] * m[7]!,
    v[0] * m[2]! + v[1] * m[5]! + v[2] * m[8]!,
  ];
};

class Unsupported extends Error {}

/** Reads the boundary of a planar region, or says why it cannot. */
export function regionBoundary(model: AcisModel): RegionBoundary | RegionFailure {
  try {
    return walk(model);
  } catch (e) {
    if (e instanceof Unsupported) return 'unsupported boundary';
    if (e instanceof TiltedPlane) return 'tilted plane';
    throw e;
  }
}

class TiltedPlane extends Error {}

function walk(model: AcisModel): RegionBoundary {
  const rec = (i: number | undefined, type?: string): AcisRecord => {
    const r = i === undefined || i < 0 ? undefined : model.records[i];
    if (!r || (type && r.type !== type)) throw new Unsupported(`expected ${type} at ${i}`);
    return r;
  };
  const bodyIndex = model.records.findIndex((r) => r.type === 'body');
  if (bodyIndex < 0) throw new Unsupported('no body');
  const body = model.records[bodyIndex]!;
  const [firstLump, , transform] = pointers(body);
  const x = transformOf(transform !== undefined && transform >= 0 ? rec(transform) : undefined);

  const loops: RegionLoop[] = [];
  let elevation: number | undefined;
  let down: boolean | undefined;
  let face = 0;
  const point = (vertex: number): V3 => {
    const ps = pointers(rec(vertex, 'vertex'));
    const n = numbers(rec(ps[ps.length - 1], 'point'));
    return apply(x, [n[0]!, n[1]!, n[2]!]);
  };

  for (let l = firstLump; l !== undefined && l >= 0; l = pointers(rec(l, 'lump'))[0]) {
    for (let s = pointers(rec(l, 'lump'))[1]; s !== undefined && s >= 0;) {
      const shell = rec(s, 'shell');
      const [nextShell, , firstFace] = pointers(shell);
      for (let f = firstFace; f !== undefined && f >= 0; f = pointers(rec(f, 'face'))[0]) {
        const fr = rec(f, 'face');
        const [, firstLoop, , , surface] = pointers(fr);
        const plane = rec(surface, 'plane-surface');
        const pn = numbers(plane);
        const root = apply(x, [pn[0]!, pn[1]!, pn[2]!]);
        let normal = turn(x, [pn[3]!, pn[4]!, pn[5]!]);
        if (reversed(fr)) normal = [-normal[0], -normal[1], -normal[2]];
        const len = Math.hypot(...normal);
        if (len === 0 || Math.hypot(normal[0], normal[1]) > 1e-9 * len) throw new TiltedPlane();
        if (elevation === undefined) {
          elevation = root[2];
          down = normal[2] < 0;
        }
        for (let lp = firstLoop; lp !== undefined && lp >= 0; lp = pointers(rec(lp, 'loop'))[0]) {
          const first = pointers(rec(lp, 'loop'))[1];
          const edges: RegionEdge[] = [];
          let c = first;
          for (let guard = 0; c !== undefined && c >= 0; guard++) {
            if (guard > model.records.length) throw new Unsupported('open coedge ring');
            const co = rec(c, 'coedge');
            const [next, , , edge] = pointers(co);
            edges.push(edgeCurve(rec(edge, 'edge'), rec, point, x));
            c = next;
            if (c === first) break;
          }
          loops.push({ face, edges });
        }
        face++;
      }
      s = nextShell;
    }
  }
  if (elevation === undefined) throw new Unsupported('no face');
  return { loops, elevation, down: down ?? false };
}

const plan = (p: V3): Vec2 => ({ x: p[0], y: p[1] });

function edgeCurve(
  edge: AcisRecord,
  rec: (i: number | undefined, type?: string) => AcisRecord,
  point: (vertex: number) => V3,
  x: Transform,
): RegionEdge {
  const [sv, ev, , curve] = pointers(edge);
  const a = point(sv!);
  const b = point(ev!);
  const cr = rec(curve);
  if (cr.type === 'straight-curve') return { kind: 'LINE', start: plan(a), end: plan(b) };
  if (cr.type !== 'ellipse-curve') throw new Unsupported(cr.type);
  // ellipse-curve: centre, normal, major axis (from the centre), radius ratio.
  const n = numbers(cr);
  const center = apply(x, [n[0]!, n[1]!, n[2]!]);
  const normal = turn(x, [n[3]!, n[4]!, n[5]!]);
  const major = turn(x, [n[6]!, n[7]!, n[8]!]).map((v) => v * x.s) as unknown as V3;
  const ratio = n[9]!;
  if (Math.hypot(normal[0], normal[1]) > 1e-9 * Math.hypot(...normal)) throw new TiltedPlane();
  // The edge runs counter-clockwise about the curve's normal from its start vertex to its end
  // vertex, or the other way when reversed. In plan view a −Z normal turns that clockwise.
  const ccw = normal[2] > 0 !== reversed(edge);
  const [from, to] = ccw ? [a, b] : [b, a];
  const c = plan(center);
  const majorAxis = { x: major[0], y: major[1] };
  const r = Math.hypot(majorAxis.x, majorAxis.y);
  const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-9 * Math.max(1, r);
  if (Math.abs(ratio - 1) <= 1e-12) {
    if (closed) return { kind: 'CIRCLE', center: c, radius: r };
    const ang = (p: V3) => Math.atan2(p[1] - c.y, p[0] - c.x);
    return { kind: 'ARC', center: c, radius: r, startAngle: ang(from), endAngle: ang(to) };
  }
  // Eccentric anomaly of a point: its coordinates along the major and minor axes, scaled.
  const ux = majorAxis.x / r;
  const uy = majorAxis.y / r;
  const param = (p: V3) => {
    const dx = p[0] - c.x;
    const dy = p[1] - c.y;
    return Math.atan2((-uy * dx + ux * dy) / (r * ratio), (ux * dx + uy * dy) / r);
  };
  return {
    kind: 'ELLIPSE',
    center: c,
    majorAxis,
    ratio,
    startParam: closed ? 0 : param(from),
    endParam: closed ? 2 * Math.PI : param(to),
  };
}
