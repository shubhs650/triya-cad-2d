// M4-07: HATCH's boundary detection (AutoCAD 2024 Help, "HATCH (Command)", "Boundaries",
// "About Hatch Boundaries and Islands"). A pick point gives the smallest area the objects enclose
// around it; closed objects inside it are islands, kept by the island detection style (Normal:
// every island, so nested ones alternate; Outer: the outermost only; Ignore: none); gaps up to
// HPGAPTOL are closed; and each loop's edges keep their type (lines, arcs, elliptical arcs,
// splines), walked end to end.
import { describe, expect, it } from 'vitest';
import {
  boundaryAt,
  boundaryOfObjects,
  boundedCurves,
  pointAt,
  type Curve,
  type HatchEdge,
  type HatchLoop,
  type Vec2,
} from '../../src/index';

const line = (x1: number, y1: number, x2: number, y2: number): Curve => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

/** A square's four lines, (x, y) to (x + s, y + s). */
const square = (x: number, y: number, s: number): Curve[] => [
  line(x, y, x + s, y),
  line(x + s, y, x + s, y + s),
  line(x + s, y + s, x, y + s),
  line(x, y + s, x, y),
];

const circle = (x: number, y: number, r: number): Curve => ({
  kind: 'CIRCLE',
  center: { x, y },
  radius: r,
});

const opts = { style: 'normal', gap: 0 } as const;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
/** Areas from a walk of 4096 chords per curve: to two places. */
const r2 = (v: number) => Math.round(v * 1e2) / 1e2 + 0;
const p6 = (p: Vec2) => ({ x: r6(p.x), y: r6(p.y) });

/** Where an edge starts and ends, as it is walked. */
function ends(e: HatchEdge): [Vec2, Vec2] {
  switch (e.type) {
    case 'line':
      return [e.start, e.end];
    case 'arc': {
      // A clockwise edge stores its angles negated (DXF 73 = 0).
      const a0 = e.ccw ? e.startAngle : -e.startAngle;
      const a1 = e.ccw ? e.endAngle : -e.endAngle;
      const at = (a: number) => ({
        x: e.center.x + e.radius * Math.cos(a),
        y: e.center.y + e.radius * Math.sin(a),
      });
      return [at(a0), at(a1)];
    }
    case 'ellipse': {
      const t0 = e.ccw ? e.startAngle : -e.startAngle;
      const t1 = e.ccw ? e.endAngle : -e.endAngle;
      const c: Curve = {
        kind: 'ELLIPSE',
        center: e.center,
        majorAxis: e.majorAxis,
        ratio: e.ratio,
        startParam: 0,
        endParam: 2 * Math.PI,
      };
      return [pointAt(c, t0), pointAt(c, t1)];
    }
    case 'spline': {
      const s: Curve = {
        kind: 'SPLINE',
        degree: e.degree,
        knots: e.knots,
        controlPoints: e.controlPoints,
      };
      return [pointAt(s, e.knots[e.degree]!), pointAt(s, e.knots.at(-e.degree - 1)!)];
    }
  }
}

/** Every edge of the loop starts where the one before it ends, and the last closes it. */
function chained(loop: HatchLoop): boolean {
  const edges = loop.edges ?? [];
  return edges.every((e, i) => {
    const next = edges[(i + 1) % edges.length]!;
    const a = ends(e)[1];
    const b = ends(next)[0];
    return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  });
}

/** The area a loop encloses (shoelace over its flattened outline), signed. */
function areaOf(loop: HatchLoop): number {
  const pts: Vec2[] = [];
  for (const e of loop.edges ?? []) {
    const [a] = ends(e);
    if (e.type === 'line') {
      pts.push(a);
      continue;
    }
    // A fine walk along the curve between its ends.
    const c = edgeCurve(e);
    for (let k = 0; k < 4096; k++) pts.push(c(k / 4096));
  }
  let s = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  });
  return s / 2;
}

function edgeCurve(e: HatchEdge): (f: number) => Vec2 {
  if (e.type === 'arc' || e.type === 'ellipse') {
    const a0 = e.ccw ? e.startAngle : -e.startAngle;
    let a1 = e.ccw ? e.endAngle : -e.endAngle;
    if (e.ccw && a1 <= a0) a1 += 2 * Math.PI;
    if (!e.ccw && a1 >= a0) a1 -= 2 * Math.PI;
    const c: Curve =
      e.type === 'arc'
        ? { kind: 'CIRCLE', center: e.center, radius: e.radius }
        : {
            kind: 'ELLIPSE',
            center: e.center,
            majorAxis: e.majorAxis,
            ratio: e.ratio,
            startParam: 0,
            endParam: 2 * Math.PI,
          };
    return (f) => pointAt(c, a0 + (a1 - a0) * f);
  }
  if (e.type === 'spline') {
    const s: Curve = {
      kind: 'SPLINE',
      degree: e.degree,
      knots: e.knots,
      controlPoints: e.controlPoints,
    };
    const u0 = e.knots[e.degree]!;
    const u1 = e.knots.at(-e.degree - 1)!;
    return (f) => pointAt(s, u0 + (u1 - u0) * f);
  }
  return (f) => ({
    x: e.start.x + (e.end.x - e.start.x) * f,
    y: e.start.y + (e.end.y - e.start.y) * f,
  });
}

describe('boundaryAt (M4-07 pick points)', () => {
  it('finds the area of lines around the point, as line edges walked counter-clockwise', () => {
    const b = boundaryAt(square(0, 0, 10), { x: 5, y: 5 }, opts)!;
    expect(b.loops).toHaveLength(1);
    const [outer] = b.loops;
    expect(outer!.flags & 1).toBe(1); // external
    expect(outer!.edges!.map((e) => e.type)).toEqual(['line', 'line', 'line', 'line']);
    expect(chained(outer!)).toBe(true);
    expect(r6(areaOf(outer!))).toBe(100);
  });

  it('finds nothing where the point is in no closed area', () => {
    expect(boundaryAt(square(0, 0, 10), { x: 15, y: 5 }, opts)).toBeUndefined();
    expect(boundaryAt([line(0, 0, 10, 0), line(10, 0, 10, 10)], { x: 5, y: 5 }, opts)).toBe(
      undefined,
    );
  });

  it('takes the smallest area around the point where lines divide it', () => {
    const b = boundaryAt([...square(0, 0, 10), line(5, -2, 5, 12)], { x: 7, y: 5 }, opts)!;
    expect(r6(areaOf(b.loops[0]!))).toBe(50);
    // The dividing line's ends stick out of the square: they bound nothing.
    const xs = b.loops[0]!.edges!.flatMap((e) => ends(e).map((p) => p.x));
    expect(Math.min(...xs)).toBe(5);
  });

  it('keeps every nested island in Normal style, the outermost in Outer, none in Ignore', () => {
    const curves = [
      ...square(0, 0, 100),
      circle(50, 50, 30),
      circle(50, 50, 20),
      circle(50, 50, 5),
    ];
    const at = { x: 10, y: 10 };
    const normal = boundaryAt(curves, at, opts)!;
    expect(normal.loops).toHaveLength(4);
    expect(normal.loops.slice(1).map((l) => r2(Math.abs(areaOf(l)) / Math.PI))).toEqual([
      900, 400, 25,
    ]);
    // Islands are arcs (a whole circle as one edge), outermost flagged as such.
    expect(normal.loops[1]!.edges).toHaveLength(1);
    expect(normal.loops[1]!.edges![0]!.type).toBe('arc');
    expect(normal.loops[1]!.flags & 16).toBe(16);
    expect(normal.loops[2]!.flags & 16).toBe(0);
    const outer = boundaryAt(curves, at, { ...opts, style: 'outer' })!;
    expect(outer.loops).toHaveLength(2);
    expect(r2(Math.abs(areaOf(outer.loops[1]!)) / Math.PI)).toBe(900);
    const ignore = boundaryAt(curves, at, { ...opts, style: 'ignore' })!;
    expect(ignore.loops).toHaveLength(1);
  });

  it('starts from the island the point is in', () => {
    const curves = [...square(0, 0, 100), circle(50, 50, 30), circle(50, 50, 20)];
    const b = boundaryAt(curves, { x: 50, y: 75 }, opts)!;
    // Between the circles: the ring.
    expect(b.loops).toHaveLength(2);
    expect(b.loops.map((l) => r2(Math.abs(areaOf(l)) / Math.PI))).toEqual([900, 400]);
  });

  it('makes a boundary touching an island follow it: no island of its own', () => {
    // A square sitting on the outer square's bottom edge.
    const curves = [
      ...square(0, 0, 100),
      line(40, 0, 40, 20),
      line(40, 20, 60, 20),
      line(60, 20, 60, 0),
    ];
    const b = boundaryAt(curves, { x: 10, y: 50 }, opts)!;
    expect(b.loops).toHaveLength(1);
    expect(r6(areaOf(b.loops[0]!))).toBe(10000 - 400);
  });

  it('types arc edges and walks a clockwise arc as DXF stores one', () => {
    // A half disc: the diameter and the upper half circle.
    const curves: Curve[] = [
      line(-10, 0, 10, 0),
      { kind: 'ARC', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI },
    ];
    const b = boundaryAt(curves, { x: 0, y: 5 }, opts)!;
    const types = b.loops[0]!.edges!.map((e) => e.type).sort();
    expect(types).toEqual(['arc', 'line']);
    expect(chained(b.loops[0]!)).toBe(true);
    expect(areaOf(b.loops[0]!)).toBeCloseTo(50 * Math.PI, 2);
    // The lower half, outside the arc, is open.
    expect(boundaryAt(curves, { x: 0, y: -5 }, opts)).toBeUndefined();
    // The island formed by the half disc inside a square is walked the other way round.
    const island = boundaryAt([...square(-20, -20, 40), ...curves], { x: 15, y: 15 }, opts)!;
    const arcEdge = island.loops[1]!.edges!.find((e) => e.type === 'arc')!;
    expect(arcEdge).toMatchObject({ type: 'arc', ccw: false });
    expect(chained(island.loops[1]!)).toBe(true);
    expect(areaOf(island.loops[1]!)).toBeCloseTo(-50 * Math.PI, 2);
  });

  it('types elliptical arcs and spline edges, cut where the lines meet them', () => {
    const ellipse: Curve = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 20, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    };
    const e = boundaryAt([ellipse, line(0, -20, 0, 20)], { x: 5, y: 0 }, opts)!;
    expect(e.loops[0]!.edges!.map((x) => x.type).sort()).toEqual(['ellipse', 'line']);
    expect(chained(e.loops[0]!)).toBe(true);
    expect(areaOf(e.loops[0]!)).toBeCloseTo((Math.PI * 20 * 10) / 2, 2);

    // A cubic spline arching over a line from (0, 0) to (30, 0).
    const spline: Curve = {
      kind: 'SPLINE',
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      controlPoints: [
        { x: -5, y: -5 },
        { x: 5, y: 20 },
        { x: 25, y: 20 },
        { x: 35, y: -5 },
      ],
    };
    const s = boundaryAt([spline, line(-10, 0, 40, 0)], { x: 15, y: 5 }, opts)!;
    const edges = s.loops[0]!.edges!;
    expect(edges.map((x) => x.type).sort()).toEqual(['line', 'spline']);
    expect(chained(s.loops[0]!)).toBe(true);
    // The spline edge runs between its crossings with the line only.
    const sp = edges.find((x) => x.type === 'spline')!;
    for (const p of ends(sp)) expect(Math.abs(p.y)).toBeLessThan(1e-6);
    expect(areaOf(s.loops[0]!)).toBeGreaterThan(0);
  });

  it('closes gaps up to the gap tolerance, and only then', () => {
    // The square's left side stops 0.5 short of its bottom.
    const open = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0.5)];
    expect(boundaryAt(open, { x: 5, y: 5 }, opts)).toBeUndefined();
    expect(boundaryAt(open, { x: 5, y: 5 }, { ...opts, gap: 0.4 })).toBeUndefined();
    const b = boundaryAt(open, { x: 5, y: 5 }, { ...opts, gap: 1 })!;
    expect(r6(areaOf(b.loops[0]!))).toBe(100);
    expect(chained(b.loops[0]!)).toBe(true);
    // An end short of a line (not of another end) is carried to the line.
    const short = [...square(0, 0, 10), line(5, 0, 5, 9.6)];
    expect(r6(areaOf(boundaryAt(short, { x: 2, y: 5 }, { ...opts, gap: 0.5 })!.loops[0]!))).toBe(
      50,
    );
  });

  it('bounds polylines by their segments, bulges as arcs', () => {
    const pline: Curve = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 1 },
        { x: 10, y: 10, bulge: 0 },
        { x: 0, y: 10, bulge: 0 },
      ],
    };
    const b = boundaryAt([pline], { x: 5, y: 5 }, opts)!;
    expect(b.loops[0]!.edges!.map((e) => e.type)).toContain('arc');
    expect(areaOf(b.loops[0]!)).toBeCloseTo(100 + 12.5 * Math.PI, 2);
  });

  it('gives the outline and islands as polygons too, for the preview', () => {
    const b = boundaryAt([...square(0, 0, 10), circle(5, 5, 2)], { x: 1, y: 1 }, opts)!;
    expect(b.rings).toHaveLength(2);
    const xs = b.rings[0]!.map((p) => p.x);
    const ys = b.rings[1]!.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 10]);
    expect(r6(Math.min(...ys))).toBe(3);
  });
});

describe('boundedCurves', () => {
  it('cuts xlines and rays at the box and keeps the rest', () => {
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const out = boundedCurves(
      [
        { kind: 'XLINE', base: { x: 5, y: 5 }, direction: { x: 1, y: 0 } },
        { kind: 'RAY', base: { x: 5, y: 5 }, direction: { x: 0, y: 1 } },
        { kind: 'XLINE', base: { x: 50, y: 50 }, direction: { x: 1, y: 0 } },
        circle(5, 5, 1),
      ],
      box,
    );
    expect(out.map((c) => c.kind)).toEqual(['LINE', 'LINE', 'CIRCLE']);
    const [a, b] = out as { start: Vec2; end: Vec2 }[];
    expect([p6(a!.start), p6(a!.end)]).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect([p6(b!.start), p6(b!.end)]).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 10 },
    ]);
  });
});

describe('boundaryOfObjects (M4-07 Select objects)', () => {
  it('makes a loop of each closed object, islands by style', () => {
    const objects = [[circle(0, 0, 10)], [circle(0, 0, 5)], [circle(0, 0, 2)], [line(0, 0, 1, 1)]];
    const normal = boundaryOfObjects(objects, opts);
    expect(normal.map((l) => l.edges![0]!.type)).toEqual(['arc', 'arc', 'arc']);
    expect(normal[0]!.flags & 1).toBe(1);
    expect(boundaryOfObjects(objects, { ...opts, style: 'outer' })).toHaveLength(2);
    expect(boundaryOfObjects(objects, { ...opts, style: 'ignore' })).toHaveLength(1);
  });

  it('keeps a closed polyline as a polyline loop, and finds none in open objects', () => {
    const pline: Curve = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0.5 },
        { x: 10, y: 10, bulge: 0 },
      ],
    };
    const [loop] = boundaryOfObjects([[pline]], opts);
    expect(loop!.flags & 2).toBe(2);
    expect(loop!.polyline!.vertices.map((v) => v.bulge)).toEqual([0, 0.5, 0]);
    expect(boundaryOfObjects([[line(0, 0, 1, 0)]], opts)).toEqual([]);
  });
});
