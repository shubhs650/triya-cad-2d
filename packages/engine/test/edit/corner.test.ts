// M3-02 part 3: FILLET's and CHAMFER's geometry (edit/corner.ts), as AutoCAD 2024 fillets and
// chamfers: the corner on the picked parts, objects trimmed or extended to it, parallel lines'
// half circle, circles left whole, polylines joined, polyline segments filleted inside the
// polyline, and the Polyline option. Includes tolerance-sensitive cases on an inch drawing.
import { describe, expect, it } from 'vitest';
import {
  chamferCorner,
  cornerEdit,
  cutLeg,
  filletCorner,
  legOf,
  meet,
  parallelFillet,
  polylineCorners,
  samePolylineCorner,
  sharpCorner,
  toleranceForSize,
  type Corner,
  type EntityGeometry,
  type Leg,
} from '../../src/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: { x: number; y: number }) => [r6(p.x), r6(p.y)];
const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});
const leg = (g: EntityGeometry, x: number, y: number, t = tol): Leg => legOf(g, { x, y }, t)!;
const corner = (c: ReturnType<typeof filletCorner>): Corner => {
  if (typeof c === 'string') throw new Error(c);
  return c;
};
const lwpoly = (pts: [number, number, number?][], closed = false): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  closed,
  vertices: pts.map(([x, y, bulge]) => ({ x, y, bulge: bulge ?? 0 })),
});
const verts = (g: EntityGeometry | null | undefined) =>
  (g as unknown as { vertices: { x: number; y: number; bulge: number }[] }).vertices.map((v) => [
    r6(v.x),
    r6(v.y),
    r6(v.bulge),
  ]);

describe('fillet of two lines', () => {
  it('fillets the corner of two lines that meet, trimming them to the arc', () => {
    // An L: (0,0)-(10,0) and (0,0)-(0,10); radius 2 → centre (2,2), tangent points (2,0) and (0,2).
    const a = leg(line(0, 0, 10, 0), 6, 0);
    const b = leg(line(0, 0, 0, 10), 0, 6);
    const c = corner(filletCorner(a, b, 2, tol));
    expect(pt(c.t1)).toEqual([2, 0]);
    expect(pt(c.t2)).toEqual([0, 2]);
    expect(c.piece!.geom).toMatchObject({ kind: 'ARC', center: { x: 2, y: 2 }, radius: 2 });
    const arc = c.piece!.geom as { startAngle: number; endAngle: number };
    expect(r6(arc.startAngle)).toBe(r6(Math.PI));
    expect(r6(arc.endAngle)).toBe(r6((3 * Math.PI) / 2));
    // Drawn from t1 (2,0) to t2 (0,2): clockwise, a quarter turn.
    expect(r6(c.piece!.bulge)).toBe(r6(-Math.tan(Math.PI / 8)));
    const e = cornerEdit(a, b, c, true, tol);
    if (typeof e === 'string') throw new Error(e);
    expect(e.first).toMatchObject({ start: { x: 2, y: 0 }, end: { x: 10, y: 0 } });
    expect(e.second).toMatchObject({ start: { x: 0, y: 2 }, end: { x: 0, y: 10 } });
    expect(e.added).toBe(c.piece!.geom);
  });

  it('keeps the picked parts of lines that cross', () => {
    // A cross at the origin: picks right on the horizontal, below on the vertical.
    const a = leg(line(-10, 0, 10, 0), 5, 0);
    const b = leg(line(0, -10, 0, 10), 0, -5);
    const c = corner(filletCorner(a, b, 1, tol));
    expect(c.piece!.geom).toMatchObject({ center: { x: 1, y: -1 } });
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    expect(e.first).toMatchObject({ start: { x: 1, y: 0 }, end: { x: 10, y: 0 } });
    expect(e.second).toMatchObject({ start: { x: 0, y: -10 }, end: { x: 0, y: -1 } });
  });

  it('extends lines short of the corner, and a pick nearer the corner than the arc still counts', () => {
    // A gap: (0,0)-(10,0) stops short of the vertical (12,2)-(12,10).
    const a = leg(line(0, 0, 10, 0), 5, 0);
    const b = leg(line(12, 2, 12, 10), 12, 6);
    const c = corner(filletCorner(a, b, 1, tol));
    expect(pt(c.t1)).toEqual([11, 0]);
    expect(pt(c.t2)).toEqual([12, 1]);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    expect(e.first).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 11, y: 0 } });
    expect(e.second).toMatchObject({ start: { x: 12, y: 1 }, end: { x: 12, y: 10 } });
  });

  it('says the radius is too large when nothing of a line would be left', () => {
    const a = leg(line(0, 0, 1, 0), 0.5, 0);
    const b = leg(line(0, 0, 0, 10), 0, 6);
    const c = corner(filletCorner(a, b, 2, tol));
    expect(cornerEdit(a, b, c, true, tol)).toBe('too-large');
    // No trim: the arc alone, whatever the lines' lengths.
    expect(cornerEdit(a, b, c, false, tol)).toEqual({ added: c.piece!.geom });
  });

  it('makes a sharp corner with radius 0: lines trimmed or extended to meet', () => {
    const a = leg(line(-10, 0, -2, 0), -5, 0);
    const b = leg(line(0, 3, 0, 10), 0, 6);
    const c = corner(filletCorner(a, b, 0, tol));
    expect(c.piece).toBeUndefined();
    expect(pt(c.t1)).toEqual([0, 0]);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    expect(e.first).toMatchObject({ start: { x: -10, y: 0 }, end: { x: 0, y: 0 } });
    expect(e.second).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 0, y: 10 } });
    expect(e).not.toHaveProperty('added');
  });

  it('joins parallel lines with a half circle at the first line’s picked end', () => {
    const a = leg(line(0, 0, 10, 0), 8, 0);
    const b = leg(line(2, 4, 14, 4), 6, 4);
    expect(filletCorner(a, b, 1, tol)).toBe('parallel');
    const c = parallelFillet(a, b, tol) as Corner;
    expect(c.piece!.geom).toMatchObject({ center: { x: 10, y: 2 }, radius: 2 });
    const arc = c.piece!.geom as { startAngle: number; endAngle: number };
    // From (10,0) round through (12,2) to (10,4): CCW from −90° to 90°.
    expect(r6(arc.startAngle)).toBe(r6((3 * Math.PI) / 2));
    expect(r6(arc.endAngle)).toBe(r6(Math.PI / 2));
    const e = cornerEdit(a, b, c, true, tol) as { first?: EntityGeometry; second: EntityGeometry };
    expect(e.first).toBeUndefined(); // already ends there
    expect(e.second).toMatchObject({ start: { x: 2, y: 4 }, end: { x: 10, y: 4 } });
    // An arc is no parallel line.
    const arcLeg = leg(
      { kind: 'ARC', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: 1 },
      1,
      0.5,
    );
    expect(parallelFillet(arcLeg, b, tol)).toBe('not-lines');
  });

  it('cuts rays and xlines: an xline becomes a ray, a ray kept from its base becomes a line', () => {
    const ray: EntityGeometry = { kind: 'RAY', base: { x: -5, y: 0 }, direction: { x: 1, y: 0 } };
    const xl: EntityGeometry = { kind: 'XLINE', base: { x: 0, y: 3 }, direction: { x: 0, y: 1 } };
    const a = leg(ray, -2, 0);
    const b = leg(xl, 0, 5);
    const c = corner(filletCorner(a, b, 1, tol));
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    expect(e.first).toMatchObject({ kind: 'LINE', start: { x: -5, y: 0 }, end: { x: -1, y: 0 } });
    expect(e.second).toMatchObject({
      kind: 'RAY',
      base: { x: 0, y: 1 },
      direction: { x: 0, y: 1 },
    });
  });
});

describe('fillet with arcs and circles', () => {
  it('fillets a line and an arc with an arc tangent to both, on the picked side', () => {
    // A line y = 0 and an arc of the circle at (5,3) r 5 that crosses it at x = 1 and 9.
    const arcG: EntityGeometry = {
      kind: 'ARC',
      center: { x: 5, y: 3 },
      radius: 5,
      startAngle: -Math.atan2(3, 4),
      endAngle: Math.PI + Math.atan2(3, 4),
    };
    const a = leg(line(-5, 0, 12, 0), -3, 0);
    const b = leg(arcG, 0, 3);
    const c = corner(filletCorner(a, b, 1, tol));
    const arc = c.piece!.geom as { center: { x: number; y: number }; radius: number };
    // Tangent to the line (centre 1 above it) and outside the circle (6 from its centre), left.
    expect(r6(arc.center.y)).toBe(1);
    expect(r6(Math.hypot(arc.center.x - 5, arc.center.y - 3))).toBe(6);
    expect(arc.center.x).toBeLessThan(1);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    const l = e.first as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect(pt(l.start)).toEqual([-5, 0]);
    expect(pt(l.end)).toEqual([r6(arc.center.x), 0]);
    // The arc (CCW from (9,0) over the top to (1,0)) now ends where the fillet meets it.
    const cut = e.second as { startAngle: number; endAngle: number };
    expect(cut.startAngle).toBe(-Math.atan2(3, 4));
    const meetsAt = Math.atan2(arc.center.y - 3, arc.center.x - 5) + 2 * Math.PI;
    expect(r6(cut.endAngle)).toBe(r6(meetsAt));
  });

  it('leaves a circle whole', () => {
    const circle: EntityGeometry = { kind: 'CIRCLE', center: { x: 0, y: 5 }, radius: 2 };
    const a = leg(line(-10, 0, 10, 0), 5, 0);
    const b = leg(circle, 2, 5);
    const c = corner(filletCorner(a, b, 2, tol));
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second?: EntityGeometry };
    expect(e.second).toBeUndefined();
    expect(e.first).toMatchObject({ start: c.t1, end: { x: 10, y: 0 } });
    // The fillet is right of the circle: centre 2 above the line, 4 from the circle's centre.
    const arc = c.piece!.geom as { center: { x: number; y: number } };
    expect(pt(arc.center)).toEqual([r6(Math.sqrt(7)), 2]);
    expect(arc.center.x).toBeGreaterThan(0);
  });

  it('fillets two circles outside each other on the side picked', () => {
    const a = leg({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 2 }, 1.5, 1.3);
    const b = leg({ kind: 'CIRCLE', center: { x: 6, y: 0 }, radius: 2 }, 4.5, 1.3);
    const c = corner(filletCorner(a, b, 2, tol));
    const arc = c.piece!.geom as { center: { x: number; y: number } };
    expect(pt(arc.center)).toEqual([3, r6(Math.sqrt(16 - 9))]);
    expect(filletCorner(a, b, 0.5, tol)).toBe('no-fillet');
  });

  it('makes a sharp corner of a line and an arc at their meeting nearer the picks', () => {
    const a = leg(line(-10, 0, 10, 0), 8, 0);
    const b = leg(
      { kind: 'ARC', center: { x: 0, y: 0 }, radius: 5, startAngle: 0.2, endAngle: 2 },
      3,
      4,
    );
    const c = corner(sharpCorner(a, b, tol));
    expect(pt(c.t1)).toEqual([5, 0]);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    expect(e.first).toMatchObject({ start: { x: 5, y: 0 }, end: { x: 10, y: 0 } });
    expect(e.second).toMatchObject({ startAngle: 0, endAngle: 2 });
  });

  it('extends an arc to a cut just past its end, and refuses one that would wrap round', () => {
    const arcG: EntityGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const t = (a: number) => ({ x: Math.cos(a), y: Math.sin(a) });
    const ccwAt = (a: number) => ({ x: -Math.sin(a), y: Math.cos(a) });
    const cwAt = (a: number) => ({ x: Math.sin(a), y: -Math.cos(a) });
    // Kept clockwise from 100°: the end goes on to 100°.
    const on = cutLeg(arcG, t((5 * Math.PI) / 9), cwAt((5 * Math.PI) / 9), tol);
    expect(on).toMatchObject({ startAngle: 0 });
    expect(r6((on as { endAngle: number }).endAngle)).toBe(r6((5 * Math.PI) / 9));
    // Kept clockwise from −17°, just before the start: it would wrap nearly all the way round.
    expect(cutLeg(arcG, t(-0.3), cwAt(-0.3), tol)).toBeUndefined();
    // Kept counter-clockwise from −17°: the start goes back to it.
    expect(r6((cutLeg(arcG, t(-0.3), ccwAt(-0.3), tol) as { startAngle: number }).startAngle)).toBe(
      r6(2 * Math.PI - 0.3),
    );
  });
});

describe('chamfer', () => {
  it('chamfers two lines at two distances, the first on the first line', () => {
    const a = leg(line(0, 0, 10, 0), 6, 0);
    const b = leg(line(0, 0, 0, 10), 0, 6);
    const c = corner(chamferCorner(a, b, { method: 'distance', d1: 2, d2: 3 }, tol));
    expect(pt(c.t1)).toEqual([2, 0]);
    expect(pt(c.t2)).toEqual([0, 3]);
    expect(c.piece!.geom).toMatchObject({
      kind: 'LINE',
      start: { x: 2, y: 0 },
      end: { x: 0, y: 3 },
    });
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    expect(e.first).toMatchObject({ start: { x: 2, y: 0 } });
    expect(e.second).toMatchObject({ start: { x: 0, y: 3 } });
  });

  it('chamfers at a length and an angle from the first line', () => {
    const a = leg(line(0, 0, 10, 0), 6, 0);
    const b = leg(line(0, 0, 0, 10), 0, 6);
    const c = corner(chamferCorner(a, b, { method: 'angle', length: 2, angle: Math.PI / 3 }, tol));
    expect(pt(c.t1)).toEqual([2, 0]);
    // 60° from the first line: 2·tan 60° up the second.
    expect(pt(c.t2)).toEqual([0, r6(2 * Math.sqrt(3))]);
    expect(chamferCorner(a, b, { method: 'angle', length: 2, angle: Math.PI / 2 }, tol)).toBe(
      'too-large',
    );
  });

  it('refuses parallel lines and arcs', () => {
    const a = leg(line(0, 0, 10, 0), 6, 0);
    expect(
      chamferCorner(a, leg(line(0, 2, 10, 2), 6, 2), { method: 'distance', d1: 1, d2: 1 }, tol),
    ).toBe('parallel');
    const arc = leg({ kind: 'CIRCLE', center: { x: 0, y: 5 }, radius: 2 }, 0, 3);
    expect(chamferCorner(a, arc, { method: 'distance', d1: 1, d2: 1 }, tol)).toBe('not-lines');
  });

  it('meets lines and circles where they cross', () => {
    const l = { kind: 'line' as const, p: { x: -5, y: 0 }, d: { x: 1, y: 0 } };
    expect(meet(l, { kind: 'circle', c: { x: 0, y: 1 }, r: 1 }, tol).map(pt)).toEqual([[0, 0]]);
    expect(
      meet(
        { kind: 'circle', c: { x: 0, y: 0 }, r: 1 },
        { kind: 'circle', c: { x: 0, y: 0 }, r: 2 },
        tol,
      ),
    ).toEqual([]);
  });
});

describe('polylines', () => {
  it('joins a line filleted to a polyline’s end segment into the polyline', () => {
    const p = lwpoly([
      [0, 10],
      [0, 0],
      [10, 0],
    ]);
    const a = leg(p, 6, 0); // last segment
    const b = leg(line(14, 2, 14, 10), 14, 6);
    const c = corner(filletCorner(a, b, 1, tol));
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: null };
    expect(e.second).toBeNull();
    expect(e.first.kind).toBe('LWPOLYLINE');
    expect(verts(e.first)).toEqual([
      [0, 10, 0],
      [0, 0, 0],
      [13, 0, r6(Math.tan(Math.PI / 8))],
      [14, 1, 0],
      [14, 10, 0],
    ]);
  });

  it('joins at the polyline’s first vertex, and a picked line first keeps the polyline', () => {
    const p = lwpoly([
      [10, 0],
      [0, 0],
      [0, 10],
    ]);
    const a = leg(line(14, 2, 14, 10), 14, 6);
    const b = leg(p, 6, 0); // first segment
    const c = corner(filletCorner(a, b, 0, tol));
    const e = cornerEdit(a, b, c, true, tol) as { first: null; second: EntityGeometry };
    expect(e.first).toBeNull();
    expect(verts(e.second)).toEqual([
      [14, 10, 0],
      [14, 0, 0],
      [0, 0, 0],
      [0, 10, 0],
    ]);
  });

  it('refuses a polyline segment that is not at a free end', () => {
    const p = lwpoly([
      [0, 10],
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const a = leg(p, 5, 0); // the middle segment
    const b = leg(line(-5, -2, -5, -10), -5, -5);
    const c = corner(filletCorner(a, b, 1, tol));
    expect(cornerEdit(a, b, c, true, tol)).toBe('polyline-segment');
    // A closed polyline has no free end.
    const sq = lwpoly(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      true,
    );
    const s = leg(sq, 5, 0);
    expect(cornerEdit(s, b, corner(filletCorner(s, b, 1, tol)), true, tol)).toBe(
      'polyline-segment',
    );
  });

  it('fillets two segments of one polyline inside it, next to each other or one apart', () => {
    const p = lwpoly([
      [0, 10],
      [0, 0],
      [10, 0],
    ]);
    const a = leg(p, 0, 6);
    const b = leg(p, 6, 0);
    const c = corner(filletCorner(a, b, 2, tol));
    expect(verts(samePolylineCorner(a, b, c, tol) as EntityGeometry)).toEqual([
      [0, 10, 0],
      [0, 2, r6(Math.tan(Math.PI / 8))],
      [2, 0, 0],
      [10, 0, 0],
    ]);
    // An old fillet arc between them goes: the polyline is filleted again at radius 1.
    const filleted = lwpoly([
      [0, 10],
      [0, 2, Math.tan(Math.PI / 8)],
      [2, 0],
      [10, 0],
    ]);
    const a2 = leg(filleted, 0, 6);
    const b2 = leg(filleted, 6, 0);
    const c2 = corner(filletCorner(a2, b2, 1, tol));
    expect(
      verts(
        samePolylineCorner(
          b2,
          a2,
          {
            ...c2,
            t1: c2.t2,
            t2: c2.t1,
            k1: c2.k2,
            k2: c2.k1,
            piece: { ...c2.piece!, bulge: -c2.piece!.bulge },
          },
          tol,
        ) as EntityGeometry,
      ),
    ).toEqual([
      [0, 10, 0],
      [0, 1, r6(Math.tan(Math.PI / 8))],
      [1, 0, 0],
      [10, 0, 0],
    ]);
  });

  it('fillets across the closing vertex of a closed polyline', () => {
    const sq = lwpoly(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      true,
    );
    const a = leg(sq, 0, 5); // segment 3, (0,10)→(0,0)
    const b = leg(sq, 5, 0); // segment 0
    const c = corner(filletCorner(a, b, 1, tol));
    const g = samePolylineCorner(a, b, c, tol) as EntityGeometry;
    expect(verts(g)).toEqual([
      [0, 10, 0],
      [0, 1, r6(Math.tan(Math.PI / 8))],
      [1, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    expect(g).toMatchObject({ closed: true });
  });

  it('fillets every corner with the Polyline option, counting those too short', () => {
    const rect = lwpoly(
      [
        [0, 0],
        [10, 0],
        [10, 4],
        [0, 4],
      ],
      true,
    );
    const r = polylineCorners(rect, { fillet: 1 }, tol)!;
    expect(r.done).toBe(4);
    expect(r.tooShort).toBe(0);
    const q = Math.tan(Math.PI / 8);
    expect(verts(r.geom)).toEqual([
      [1, 0, 0],
      [9, 0, r6(q)],
      [10, 1, 0],
      [10, 3, r6(q)],
      [9, 4, 0],
      [1, 4, r6(q)],
      [0, 3, 0],
      [0, 1, r6(q)],
    ]);
    // Again at radius 3: the 4-high sides take one fillet each, not two.
    const big = polylineCorners(r.geom, { fillet: 3 }, tol)!;
    expect(big.done).toBe(2);
    expect(big.tooShort).toBe(2);
    // Radius 0 takes the fillets out.
    const sharp = polylineCorners(r.geom, { fillet: 0 }, tol)!;
    expect(verts(sharp.geom)).toEqual(verts(rect));
    expect(polylineCorners(line(0, 0, 1, 1), { fillet: 1 }, tol)).toBeUndefined();
  });

  it('chamfers every corner of an open polyline, keeping its widths', () => {
    const p: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 10, bulge: 0, startWidth: 0.5, endWidth: 0.5 },
        { x: 0, y: 0, bulge: 0, startWidth: 0.5, endWidth: 0.5 },
        { x: 10, y: 0, bulge: 0 },
      ],
    };
    const r = polylineCorners(p, { chamfer: { method: 'distance', d1: 2, d2: 3 } }, tol)!;
    expect(r.done).toBe(1);
    expect(verts(r.geom)).toEqual([
      [0, 10, 0],
      [0, 2, 0],
      [3, 0, 0],
      [10, 0, 0],
    ]);
    const vs = (r.geom as unknown as { vertices: { startWidth?: number }[] }).vertices;
    expect(vs[0]).toMatchObject({ startWidth: 0.5, endWidth: 0.5 });
    expect(vs[1]).toMatchObject({ startWidth: 0.5, endWidth: 0.5 });
    expect(vs[2]).toMatchObject({ startWidth: 0.5, endWidth: 0.5 });
    expect(vs[3]).not.toHaveProperty('startWidth');
  });
});

describe('inch drawings: tolerance-sensitive cases', () => {
  // A site plan in inches far from the origin: coordinates near 1.2e5, where the drawing's
  // tolerance is about 1e-5.
  const big = toleranceForSize(2e5);
  const X = 120000;
  const Y = 85000;

  it('fillets lines meeting at a slight angle far from the origin with a 1/2" radius', () => {
    const a = leg(line(X - 120, Y, X, Y), X - 60, Y, big);
    const b = leg(line(X, Y, X + 120, Y + 0.5), X + 60, Y + 0.25, big);
    const c = corner(filletCorner(a, b, 0.5, big));
    const arc = c.piece!.geom as { center: { x: number; y: number }; radius: number };
    // Tangent to both: half an inch from each line.
    expect(Math.abs(arc.center.y - Y - 0.5)).toBeLessThan(1e-6);
    const d = Math.abs(
      ((arc.center.x - X) * 0.5 - (arc.center.y - Y) * 120) / Math.hypot(120, 0.5),
    );
    expect(Math.abs(d - 0.5)).toBeLessThan(1e-6);
  });

  it('treats lines already ending a hair from the corner as meeting there', () => {
    // The vertical ends 1e-7" short of the horizontal: radius 0 makes them meet exactly.
    const a = leg(line(X - 50, Y, X, Y), X - 10, Y, big);
    const b = leg(line(X, Y + 1e-7, X, Y + 50), X, Y + 10, big);
    const c = corner(filletCorner(a, b, 0, big));
    const e = cornerEdit(a, b, c, true, big) as { first: EntityGeometry; second: EntityGeometry };
    expect(e.second).toMatchObject({ start: { x: X, y: Y }, end: { x: X, y: Y + 50 } });
  });

  it('takes lines a hair off parallel as parallel', () => {
    const a = leg(line(X, Y, X + 100, Y), X + 50, Y, big);
    const b = leg(line(X, Y + 3, X + 100, Y + 3 + 1e-12), X + 50, Y + 3, big);
    expect(filletCorner(a, b, 1, big)).toBe('parallel');
  });
});
