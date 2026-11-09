// Revision clouds and wipeouts as AutoCAD stores them (M2-08).
//
// A revision cloud is an LWPOLYLINE whose every segment is an arc of the same bulge, with
// `RevcloudProps` xdata that AutoCAD 2021+ uses to know it as a cloud: AutoCAD writes a bulge
// of 0.520567 (an arc of about 110°) and ezdxf's `revcloud.is_revcloud` requires it, with the
// xdata (1070 0, 1040 arc length) and a closed polyline. The arcs bulge out of the area the
// cloud encloses ("Normal"); reversing the direction turns them in. A Calligraphy cloud widens
// each arc from 0 to a tenth of the arc length, as ezdxf's `revcloud.add_entity` describes
// AutoCAD's. The arc length is the chord between an arc's ends (ezdxf's `segment_length`):
// AutoCAD's documentation says only "the length of the arcs".
//
// AutoCAD varies the arcs between the minimum and maximum arc length for a hand-drawn look. It
// does so at random; Triya uses a fixed pseudo-random sequence so a cloud drawn twice from the
// same points is the same cloud (and tests can check it).
//
// A wipeout is a WIPEOUT whose frame is a square on the boundary's lower-left corner as big as
// the boundary's larger side, the boundary given in that square's unit pixel space from -0.5 to
// 0.5 with Y down and the first vertex repeated at the end: what AutoCAD 2018 writes (the
// acadsharp sample_AC1032 wipeout) and ezdxf's `Wipeout.set_masking_area` reads.
import { flatten } from '../geom/flatten';
import type { BoundedCurve } from '../geom/curves';
import type { Vec2 } from '../geom/types';
import { distance, lerp } from '../geom/vec';
import type {
  EntityGeometry,
  ImageGeometry,
  LwPolylineGeometry,
  PolylineVertex,
} from '../model/types';

/** tan(θ/4) of AutoCAD's revision cloud arcs (θ ≈ 110°). */
export const REVCLOUD_BULGE = 0.520567050552;

/** The application AutoCAD files revision cloud xdata under. */
export const REVCLOUD_APP = 'RevcloudProps';

/** The most arcs one cloud may have: more means the arc length is far too small for it. */
export const REVCLOUD_MAX_ARCS = 10_000;

export interface CloudStyle {
  /** The arcs' chord lengths vary between these (equal for uniform arcs). */
  readonly minArc: number;
  readonly maxArc: number;
  readonly calligraphy: boolean;
}

/** A deterministic sequence in [0, 1) (mulberry32), so clouds are reproducible. */
export function cloudRandom(seed = 0x5eed): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The chords a run of `length` is cut into: about one per mean arc length, each between the
 * minimum and maximum where a whole number of them can be, and adding up to the run exactly.
 */
export function chordLengths(length: number, s: CloudStyle, next: () => number): number[] {
  if (!(length > 0)) return [];
  const { minArc: min, maxArc: max } = s;
  let n = Math.max(1, Math.round(length / ((min + max) / 2)));
  const lo = Math.max(1, Math.ceil(length / max - 1e-9));
  const hi = Math.floor(length / min + 1e-9);
  const fits = lo <= hi;
  if (fits) n = Math.min(Math.max(n, lo), hi);
  if (!fits || !(max > min)) return Array.from({ length: n }, () => length / n);
  const w = Array.from({ length: n }, () => min + (max - min) * next());
  const sum = w.reduce((a, b) => a + b, 0);
  // Pulled towards the minimum or the maximum until they add up, so each stays between them.
  if (sum > length) {
    const k = (length - n * min) / (sum - n * min);
    return w.map((x) => min + (x - min) * k);
  }
  const k = (n * max - length) / (n * max - sum);
  return w.map((x) => max - (max - x) * k);
}

/** How many arcs a cloud along these runs would have. */
export function cloudArcCount(runs: readonly (readonly Vec2[])[], s: CloudStyle): number {
  const mean = (s.minArc + s.maxArc) / 2;
  return runs.reduce((n, r) => n + Math.max(1, Math.round(runLength(r) / mean)), 0);
}

const runLength = (r: readonly Vec2[]): number => {
  let l = 0;
  for (let i = 1; i < r.length; i++) l += distance(r[i - 1]!, r[i]!);
  return l;
};

/** Twice the signed area of a closed polygon: > 0 counter-clockwise. */
export function signedArea2(points: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

/**
 * The cloud's vertices along `runs`: polylines that follow one another, the corners where they
 * meet kept as vertices. Each run is cut into chords on its own (`chordLengths`), measured
 * along the run. A closed cloud's last run ends where the first begins.
 */
export function cloudPoints(
  runs: readonly (readonly Vec2[])[],
  closed: boolean,
  s: CloudStyle,
  next: () => number = cloudRandom(),
): Vec2[] {
  const out: Vec2[] = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    out.push(run[0]!);
    const chords = chordLengths(runLength(run), s, next);
    let i = 1;
    let walked = 0; // along the run up to run[i - 1]
    let at = 0;
    for (const c of chords.slice(0, -1)) {
      at += c;
      while (i < run.length - 1 && walked + distance(run[i - 1]!, run[i]!) < at) {
        walked += distance(run[i - 1]!, run[i]!);
        i++;
      }
      const seg = distance(run[i - 1]!, run[i]!);
      out.push(lerp(run[i - 1]!, run[i]!, seg > 0 ? Math.min(1, (at - walked) / seg) : 0));
    }
  }
  if (!closed && runs.length > 0) {
    const last = runs.at(-1)!;
    if (last.length >= 2) out.push(last.at(-1)!);
  }
  return out;
}

/**
 * The LWPOLYLINE of a cloud through `points`: every segment an arc of `REVCLOUD_BULGE`, on the
 * outside of the area they enclose unless `reverse` (an open cloud as though closed).
 */
export function cloudPolyline(
  points: readonly Vec2[],
  closed: boolean,
  s: CloudStyle,
  reverse = false,
): LwPolylineGeometry {
  const outward = signedArea2(points) >= 0 ? REVCLOUD_BULGE : -REVCLOUD_BULGE;
  const bulge = reverse ? -outward : outward;
  const width = s.calligraphy ? ((s.minArc + s.maxArc) / 2) * 0.1 : 0;
  const vertices: PolylineVertex[] = points.map((p, i) => {
    const last = !closed && i === points.length - 1;
    return {
      x: p.x,
      y: p.y,
      bulge: last ? 0 : bulge,
      ...(s.calligraphy && !last && { startWidth: 0, endWidth: width }),
    };
  });
  return { kind: 'LWPOLYLINE', closed, vertices };
}

/** A closed polygon's sides as runs (rectangles, polygons): each side cut on its own. */
export function polygonRuns(corners: readonly Vec2[]): Vec2[][] {
  return corners.map((p, i) => [p, corners[(i + 1) % corners.length]!]);
}

/** A rectangle's corners from two opposite ones, counter-clockwise from the first. */
export function rectangleCorners(a: Vec2, b: Vec2): Vec2[] {
  const ccw = (b.x - a.x) * (b.y - a.y) >= 0;
  const c1 = { x: b.x, y: a.y };
  const c2 = { x: a.x, y: b.y };
  return ccw ? [a, c1, b, c2] : [a, c2, b, c1];
}

/**
 * An object REVCLOUD's Object option converts, as runs (a polyline's segments each on its own,
 * so its corners stay corners) and whether it is closed; undefined for any other object.
 * AutoCAD converts circles, ellipses, polylines and splines.
 */
export function cloudRunsOf(
  g: EntityGeometry,
  deviation: number,
): { runs: Vec2[][]; closed: boolean } | undefined {
  switch (g.kind) {
    case 'CIRCLE':
    case 'SPLINE':
      return { runs: [flatten(g, deviation).points], closed: g.kind === 'CIRCLE' || g.closed };
    case 'ELLIPSE': {
      const full = Math.abs(g.endParam - g.startParam - 2 * Math.PI) < 1e-9;
      return { runs: [flatten(g, deviation).points], closed: full };
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (g.vertices.length < 2) return undefined;
      const curve: BoundedCurve = { kind: 'LWPOLYLINE', vertices: g.vertices, closed: g.closed };
      return { runs: segmentRuns(curve, deviation), closed: g.closed };
    }
    default:
      return undefined;
  }
}

/** A polyline flattened and cut at its vertices: one run per segment. */
function segmentRuns(p: BoundedCurve, deviation: number): Vec2[][] {
  const f = flatten(p, deviation);
  const runs: Vec2[][] = [];
  let run: Vec2[] = [f.points[0]!];
  for (let i = 1; i < f.points.length; i++) {
    run.push(f.points[i]!);
    if (Number.isInteger(f.params[i]!) || i === f.points.length - 1) {
      if (run.length >= 2 && runLength(run) > 0) runs.push(run);
      run = [f.points[i]!];
    }
  }
  return runs;
}

/** A boundary's vertices with consecutive duplicates (and a repeated first vertex) dropped. */
export function distinctVertices(points: readonly Vec2[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.length || distance(out.at(-1)!, p) > tol) out.push(p);
  while (out.length > 1 && distance(out[0]!, out.at(-1)!) <= tol) out.pop();
  return out;
}

/** A WIPEOUT masking the polygon `points` (three or more, not closed by repeating the first). */
export function wipeoutGeometry(points: readonly Vec2[]): ImageGeometry {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const side = Math.max(Math.max(...xs) - min.x, Math.max(...ys) - min.y);
  const pixel = (p: Vec2): Vec2 => ({
    x: (p.x - min.x) / side - 0.5,
    y: 0.5 - (p.y - min.y) / side,
  });
  const ring = [...points, points[0]!].map(pixel);
  return {
    kind: 'WIPEOUT',
    position: min,
    u: { x: side, y: 0 },
    v: { x: 0, y: side },
    size: { x: 1, y: 1 },
    // Show, show unaligned, clip: AutoCAD's 7.
    displayFlags: 7,
    clipping: true,
    brightness: 50,
    contrast: 50,
    fade: 0,
    clip: { type: 'polygon', vertices: ring, inverted: false },
  };
}
