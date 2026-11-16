// A hatch's loops as the areas it fills (M4-07 part 4), for HATCHEDIT's separate Hatches
// (AutoCAD 2024 Help, "-HATCHEDIT (Command)": "Separate Hatches: Separates a single hatch object
// that has several separate boundaries into individual hatch objects") and for finding the
// objects a hatch's loops lie along (its boundary, for DRaw order and Remove boundaries).
//
// An area is an outer loop and the islands directly inside it, as the island detection style
// fills them: Normal (DXF 75 = 0) fills every other nesting level, so an island inside an island
// starts an area of its own; Outer and Ignore fill only from the outermost loops in, so each
// outermost loop is one area with everything inside it.
import { boxOf } from '../geom/bounds';
import type { Curve } from '../geom/curves';
import { closestPoint } from '../geom/closest';
import { flattenPiece, piecePoint, piecesOf } from '../geom/pieces';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import type { HatchGeometry, HatchLoop } from '../model/types';
import { hatchEdgeCurve } from './trim-edges';

/** A loop's curves: a polyline loop whole, an edge loop edge by edge. */
export function loopCurves(loop: HatchLoop): Curve[] {
  const p = loop.polyline;
  if (p) {
    return p.vertices.length >= 2
      ? [
          {
            kind: 'LWPOLYLINE',
            closed: true,
            vertices: p.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge ?? 0 })),
          },
        ]
      : [];
  }
  return (loop.edges ?? []).flatMap((e) => {
    const c = hatchEdgeCurve(e);
    return c ? [c] : [];
  });
}

/** A loop as a polygon whose chords stay within `dev` of it. */
function ring(loop: HatchLoop, dev: number): Vec2[] {
  const out: Vec2[] = [];
  for (const c of loopCurves(loop)) {
    for (const pc of piecesOf(c)) {
      for (const p of flattenPiece(pc, dev).points) {
        const last = out.at(-1);
        if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
      }
    }
  }
  return out;
}

function signedArea(r: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function inside(r: readonly Vec2[], p: Vec2): boolean {
  let n = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!;
    const b = r[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) n = !n;
  }
  return n;
}

function distanceToRing(r: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dd = dx * dx + dy * dy;
    const f = dd === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / dd));
    best = Math.min(best, Math.hypot(p.x - a.x - f * dx, p.y - a.y - f * dy));
  }
  return best;
}

/** Whether ring `a` lies inside ring `b`: the first of its points not on `b`'s outline is. */
function within(a: readonly Vec2[], b: readonly Vec2[], dev: number): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    for (const s of [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }]) {
      if (distanceToRing(b, s) > 4 * dev) return inside(b, s);
    }
  }
  return false;
}

/** One area of a hatch: the indices of its loops (the outer one first) and of its seed points. */
export interface HatchArea {
  readonly loops: readonly number[];
  readonly seeds: readonly number[];
}

/** A hatch's areas, in the order of their outer loops (see the head comment). */
export function hatchAreas(g: HatchGeometry): HatchArea[] {
  const rings0 = g.loops.map((l) => ring(l, 1));
  const pts = rings0.flat();
  if (pts.length === 0) return [];
  const b = boxOf(pts);
  const dev = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9) * 1e-4;
  const rings = g.loops.map((l) => ring(l, dev));
  const sizes = rings.map((r) => Math.abs(signedArea(r)));
  // Each loop's containers, smallest first: its parent is the first.
  const containers = rings.map((r, i) =>
    rings
      .map((_, j) => j)
      .filter((j) => j !== i && sizes[j]! > sizes[i]! && within(r, rings[j]!, dev))
      .sort((x, y) => sizes[x]! - sizes[y]!),
  );
  const depth = containers.map((c) => c.length);
  const normal = g.style === 0;
  // The loop each loop's area starts from: under Normal the nearest even-depth container (or
  // itself), else the outermost one.
  const outerOf = (i: number): number => {
    const c = containers[i]!;
    if (!normal) return c.at(-1) ?? i;
    return depth[i]! % 2 === 0 ? i : c[0]!;
  };
  const areas = new Map<number, number[]>();
  g.loops.forEach((_, i) => {
    const o = outerOf(i);
    if (!areas.has(o)) areas.set(o, []);
    if (o !== i) areas.get(o)!.push(i);
  });
  const outers = [...areas.keys()].sort((x, y) => x - y);
  const seedArea = g.seedPoints.map((p) => {
    // The area whose outer loop holds the seed most tightly.
    let best: number | undefined;
    for (const o of outers) {
      if (inside(rings[o]!, p) && (best === undefined || sizes[o]! < sizes[best]!)) best = o;
    }
    return best;
  });
  return outers.map((o) => ({
    loops: [o, ...areas.get(o)!],
    seeds: seedArea.flatMap((a, k) => (a === o ? [k] : [])),
  }));
}

/**
 * Points on each loop, one in the middle of each piece of its curves: an object whose outline
 * passes through one of them lies along the loop.
 */
export function loopSamples(loop: HatchLoop): Vec2[] {
  return loopCurves(loop).flatMap((c) =>
    piecesOf(c).map((pc) => piecePoint(pc, (pc.s0 + pc.s1) / 2)),
  );
}

/** Whether one of `curves` passes through one of `samples`. */
export function passesThrough(
  curves: readonly Curve[],
  samples: readonly Vec2[],
  tol: Tolerance,
): boolean {
  const near = Math.max(tol.linear * 1000, 1e-9);
  return samples.some((p) =>
    curves.some((c) => {
      try {
        return closestPoint(c, p, tol).distance <= near;
      } catch {
        return false;
      }
    }),
  );
}
