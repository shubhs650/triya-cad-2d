// Splines and Smooth in ConstraintModel (M9-02 part 2): GCSMOOTH's G2 continuity between a
// spline's end and the end of a line, arc, polyline or another spline (AutoCAD 2024 Help,
// "GCSMOOTH (Command)"), a spline's ends as constraint points, Fix on a spline, and an arc's
// midpoint as a constraint point. Continuity is checked on the curves the model hands back,
// evaluated by the engine's own NURBS code, not by the model's formulas.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { splineDerivatives, toleranceForSize, type SplineGeometry, type Vec2 } from '@triya/engine';
import {
  ConstraintModel,
  loadPlaneGcs,
  type GeometricConstraint,
  type GeometricKind,
  type GeomRef,
  type PlaneGcs,
} from '../src/index';
import { Drawing, curve, len, near, nearPt, pt } from './drawing';

const wasm = () => Promise.resolve(readFileSync(new URL('../wasm/planegcs.wasm', import.meta.url)));

let gcs: PlaneGcs;
beforeAll(async () => {
  gcs = await loadPlaneGcs(wasm);
});

let constraintHandle = 0x3000;
const con = (kind: GeometricKind, ...refs: GeomRef[]): GeometricConstraint => ({
  handle: (constraintHandle++).toString(16).toUpperCase(),
  kind,
  refs,
});

function setup() {
  const d = new Drawing();
  const m = new ConstraintModel(gcs, toleranceForSize(100));
  const add = (c: GeometricConstraint) => {
    const r = m.add(c, d.lookup);
    if (!r.ok) throw new Error(`${c.kind} refused: ${r.reason} ${r.message}`);
    d.apply(r.updated);
    return r;
  };
  return { d, m, add };
}

const unit = (v: Vec2) => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

/**
 * A spline's end as the curve leaves it: the point, the unit direction it runs in away from
 * the end, and its signed curvature that way (positive turning counter-clockwise).
 */
function leaving(g: SplineGeometry, end: 'start' | 'end') {
  const u = end === 'start' ? g.knots[g.degree]! : g.knots[g.knots.length - 1 - g.degree]!;
  const [c, d1, d2] = splineDerivatives(g, u, 2) as [Vec2, Vec2, Vec2];
  const sign = end === 'start' ? 1 : -1;
  const speed = Math.hypot(d1.x, d1.y);
  // Reversing the direction of travel reverses the sign of the curvature.
  const k = (sign * (d1.x * d2.y - d1.y * d2.x)) / speed ** 3;
  return { at: c, dir: unit({ x: sign * d1.x, y: sign * d1.y }), k };
}

/** An arc's end as the arc arrives at it: counter-clockwise into its end, clockwise into its start. */
function arrivingOnArc(
  g: { center: Vec2; radius: number; startAngle: number; endAngle: number },
  end: 'start' | 'end',
) {
  const t = end === 'end' ? g.endAngle : g.startAngle;
  const turn = end === 'end' ? 1 : -1;
  return {
    at: { x: g.center.x + g.radius * Math.cos(t), y: g.center.y + g.radius * Math.sin(t) },
    dir: { x: -Math.sin(t) * turn, y: Math.cos(t) * turn },
    k: turn / g.radius,
  };
}

const CURVATURE = 1e-6;

describe('Smooth (G2) with a spline', () => {
  it('joins a spline to the end of a line: on it, running on along it, with no curvature', () => {
    const { d, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const s = d.spline([
      [10.5, 0.4],
      [13, 2],
      [16, 1],
      [18, 4],
      [20, 3],
    ]);
    add(con('smooth', pt(s, 'start'), pt(l, 'end')));
    const line = d.geom(l, 'LINE');
    nearPt(line.start, { x: 0, y: 0 });
    nearPt(line.end, { x: 10, y: 0 });
    const g = d.geom(s, 'SPLINE');
    const out = leaving(g, 'start');
    nearPt(out.at, { x: 10, y: 0 });
    nearPt(out.dir, { x: 1, y: 0 });
    near(out.k, 0, CURVATURE);
    // Only the end's first three control points move.
    nearPt(g.controlPoints[3]!, { x: 18, y: 4 });
    nearPt(g.controlPoints[4]!, { x: 20, y: 3 });
  });

  it("joins a spline's end to an arc's end with the arc's curvature, turning its way", () => {
    const { d, add } = setup();
    const a = d.arc(0, 0, 10, 0, 90);
    const s = d.spline([
      [-12, 18],
      [-10, 14],
      [-6, 13],
      [-2, 11],
      [0.3, 10.2],
    ]);
    add(con('smooth', pt(s, 'end'), pt(a, 'end')));
    const arc = d.geom(a, 'ARC');
    near(arc.radius, 10);
    nearPt(arc.center, { x: 0, y: 0 });
    const into = arrivingOnArc(arc, 'end');
    const out = leaving(d.geom(s, 'SPLINE'), 'end');
    nearPt(out.at, into.at);
    nearPt(out.dir, into.dir);
    near(out.k, into.k, CURVATURE);
  });

  it("follows an arc's start the other way round, turning clockwise", () => {
    const { d, add } = setup();
    const a = d.arc(0, 0, 5, 90, 180);
    const s = d.spline(
      [
        [0.2, 5.3],
        [3, 5],
        [5, 3],
        [6, 0],
      ],
      { degree: 2 },
    );
    add(con('smooth', pt(s, 'start'), pt(a, 'start')));
    const into = arrivingOnArc(d.geom(a, 'ARC'), 'start');
    const out = leaving(d.geom(s, 'SPLINE'), 'start');
    nearPt(out.at, { x: 0, y: 5 });
    nearPt(out.dir, into.dir);
    expect(into.k).toBeLessThan(0);
    near(out.k, into.k, CURVATURE);
  });

  it('works out the curvature of rational splines with uneven knots', () => {
    const { d, add } = setup();
    const a = d.arc(0, 0, 4, 0, 60);
    const s = d.spline(
      [
        [4.1, 0.3],
        [4.5, -3],
        [6, -6],
        [9, -7],
        [12, -9],
      ],
      { knots: [0, 0, 0, 0, 0.7, 3, 3, 3, 3], weights: [1, 2.5, 0.6, 1, 1.3] },
    );
    add(con('smooth', pt(s, 'start'), pt(a, 'start')));
    const into = arrivingOnArc(d.geom(a, 'ARC'), 'start');
    const out = leaving(d.geom(s, 'SPLINE'), 'start');
    nearPt(out.at, into.at);
    nearPt(out.dir, into.dir);
    near(out.k, into.k, CURVATURE);
  });

  it('joins two splines: one point, one tangent, the same curvature through it', () => {
    const { d, add } = setup();
    const first = d.spline([
      [0, 0],
      [3, 2],
      [6, 1],
      [9, 3],
    ]);
    const second = d.spline([
      [-0.2, 0.3],
      [-3, -1],
      [-5, 2],
      [-8, 1],
    ]);
    const before = d.geom(second, 'SPLINE');
    add(con('smooth', pt(first, 'start'), pt(second, 'start')));
    expect(d.geom(second, 'SPLINE')).toBe(before);
    const a = leaving(d.geom(first, 'SPLINE'), 'start');
    const b = leaving(before, 'start');
    nearPt(a.at, b.at);
    nearPt(a.dir, { x: -b.dir.x, y: -b.dir.y });
    // Through the joint the curve turns one way: leaving each end, opposite ways.
    near(a.k, -b.k, CURVATURE);
  });

  it("joins a spline to an open polyline's end: its last arc segment, or its first line", () => {
    const { d, add } = setup();
    const p = d.polyline([
      [0, 0],
      [10, 0, -0.4],
      [16, -4],
    ]);
    const s = d.spline([
      [16.2, -4.3],
      [17, -7],
      [16, -10],
      [13, -13],
    ]);
    add(con('smooth', pt(s, 'start'), pt(p, 'end')));
    const poly = d.geom(p, 'LWPOLYLINE');
    const g = d.geom(s, 'SPLINE');
    // The arc from (10, 0) to (16, -4), bulge -0.4: clockwise, arriving at its last vertex.
    const v = poly.vertices;
    const q = { x: v[2]!.x, y: v[2]!.y };
    const chord = len(v[1]!, q);
    const sweep = 4 * Math.atan(0.4);
    const radius = chord / (2 * Math.sin(sweep / 2));
    const out = leaving(g, 'start');
    nearPt(out.at, { x: 16, y: -4 });
    near(out.k, -1 / radius, CURVATURE);

    const t = d.spline([
      [0.3, -0.2],
      [-3, 1],
      [-6, 0],
      [-8, 3],
    ]);
    add(con('smooth', pt(t, 'start'), pt(p, 'start')));
    const back = leaving(d.geom(t, 'SPLINE'), 'start');
    nearPt(back.at, { x: 0, y: 0 });
    nearPt(back.dir, { x: -1, y: 0 });
    near(back.k, 0, CURVATURE);
  });

  it('turns round a spline that ran back along the curve, so it runs on', () => {
    const { d, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const s = d.spline([
      [10, 0],
      [7, 1],
      [5, 3],
      [2, 4],
    ]);
    add(con('smooth', pt(s, 'start'), pt(l, 'end')));
    const out = leaving(d.geom(s, 'SPLINE'), 'start');
    nearPt(out.at, { x: 10, y: 0 });
    nearPt(out.dir, { x: 1, y: 0 });
    near(out.k, 0, CURVATURE);
  });

  it('keeps continuity when the curve it joins is edited, and refuses an edit that reverses it', () => {
    const { d, m, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const s = d.spline([
      [10, 0],
      [12, 0],
      [14, 0],
      [16, 3],
      [18, 2],
    ]);
    add(con('smooth', pt(s, 'start'), pt(l, 'end')));
    const r = m.solveEdit([d.edit(l, { end: { x: 10, y: 4 } })], d.lookup);
    if (!r.ok) throw new Error(r.message);
    d.apply(r.updated);
    const line = d.geom(l, 'LINE');
    nearPt(line.end, { x: 10, y: 4 });
    const out = leaving(d.geom(s, 'SPLINE'), 'start');
    nearPt(out.at, line.end);
    nearPt(out.dir, unit({ x: 10, y: 4 }));
    near(out.k, 0, CURVATURE);
  });

  it('drops the fit points of a spline it reshapes', () => {
    const { d, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const s = d.spline(
      [
        [10, 1],
        [12, 3],
        [15, 2],
        [18, 4],
      ],
      {
        fitPoints: [
          { x: 10, y: 1 },
          { x: 14, y: 2.6 },
          { x: 18, y: 4 },
        ],
      },
    );
    add(con('smooth', pt(s, 'start'), pt(l, 'end')));
    const g = d.geom(s, 'SPLINE');
    expect(g.fitPoints).toBeUndefined();
    expect(g.controlPoints).toHaveLength(4);
  });

  it('refuses what is not a spline end joined to the end of a spline, line, arc or open polyline', () => {
    const { d, m } = setup();
    const l = d.line(0, 0, 10, 0);
    const c = d.circle(20, 0, 3);
    const s = d.spline([
      [10, 0],
      [12, 2],
      [14, 1],
      [16, 3],
    ]);
    const straight = d.spline(
      [
        [10, 0],
        [12, 2],
        [14, 1],
      ],
      { degree: 1 },
    );
    const closed = d.add({
      kind: 'SPLINE',
      degree: 3,
      knots: [0, 1, 2, 3, 4, 5, 6, 7],
      controlPoints: [
        { x: 0, y: 5 },
        { x: 2, y: 7 },
        { x: 4, y: 5 },
        { x: 2, y: 3 },
      ],
      closed: true,
      periodic: true,
    });
    const unclamped = d.spline(
      [
        [10, 0],
        [12, 2],
        [14, 1],
        [16, 3],
      ],
      { knots: [0, 1, 2, 3, 4, 5, 6, 7] },
    );
    const loop = d.polyline(
      [
        [0, 0],
        [5, 0],
        [5, 5],
      ],
      true,
    );
    const tries: [GeometricConstraint, string][] = [
      [con('smooth', pt(l, 'end'), pt(s, 'start')), 'invalid'],
      [con('smooth', curve(s), pt(l, 'end')), 'invalid'],
      [con('smooth', pt(s, 'start'), pt(c, 'center')), 'invalid'],
      [con('smooth', pt(s, 'start'), pt(s, 'end')), 'invalid'],
      [con('smooth', pt(s, 'start'), pt(l, 'mid')), 'invalid'],
      [con('smooth', pt(straight, 'start'), pt(l, 'end')), 'invalid'],
      [con('smooth', pt(closed, 'start'), pt(l, 'end')), 'invalid'],
      [con('smooth', pt(unclamped, 'start'), pt(l, 'end')), 'unsupported'],
      [con('smooth', pt(s, 'start'), pt(loop, 'end')), 'invalid'],
      [con('smooth', pt(s, 'start')), 'invalid'],
      [con('tangent', curve(s), curve(c)), 'unsupported'],
    ];
    for (const [c2, reason] of tries) {
      expect(m.add(c2, d.lookup), JSON.stringify(c2.refs)).toMatchObject({ ok: false, reason });
    }
    expect(m.constraints).toEqual([]);
  });

  it('refuses a second Smooth of the same ends, and one the curves cannot take', () => {
    const { d, m, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const s = d.spline([
      [10, 0],
      [12, 1],
      [14, 3],
      [16, 3],
    ]);
    add(con('smooth', pt(s, 'start'), pt(l, 'end')));
    const again = m.add(con('smooth', pt(s, 'start'), pt(l, 'end')), d.lookup);
    expect(again.ok).toBe(false);
    expect(['redundant', 'overconstrained']).toContain(!again.ok && again.reason);
    // A fixed spline cannot bend to the arc.
    const a = d.arc(30, 0, 5, 90, 180);
    const t = d.spline([
      [30, 5.2],
      [27, 6],
      [24, 5],
      [22, 7],
    ]);
    add(con('fix', curve(t)));
    const r = m.add(con('smooth', pt(t, 'start'), pt(a, 'start')), d.lookup);
    expect(r).toMatchObject({ ok: false, reason: 'overconstrained' });
  });
});

describe('spline ends and arc midpoints as constraint points', () => {
  it("puts a line's end on a spline's end, and Fix holds a whole spline", () => {
    const { d, m, add } = setup();
    const s = d.spline([
      [0, 0],
      [2, 3],
      [5, 2],
      [7, 5],
    ]);
    const l = d.line(10, 10, 20, 10);
    add(con('fix', curve(s)));
    add(con('coincident', pt(s, 'end'), pt(l, 'start')));
    nearPt(d.geom(l, 'LINE').start, { x: 7, y: 5 });
    const r = m.solveEdit([d.edit(l, { start: { x: 8, y: 5 } })], d.lookup);
    expect(r).toMatchObject({ ok: false, reason: 'overconstrained' });
    expect(m.diagnose(d.lookup)).toMatchObject({ ok: true, conflicting: [], redundant: [] });
  });

  it("takes an arc's midpoint, which follows the arc as it changes", () => {
    const { d, m, add } = setup();
    const a = d.arc(0, 0, 10, 0, 90);
    const p = d.point(3, 3);
    add(con('coincident', pt(a, 'mid'), pt(p, 'position')));
    const half = Math.SQRT1_2 * 10;
    nearPt(d.geom(p, 'POINT').position, { x: half, y: half });
    const r = m.solveEdit([d.edit(a, { endAngle: Math.PI })], d.lookup);
    if (!r.ok) throw new Error(r.message);
    d.apply(r.updated);
    nearPt(d.geom(p, 'POINT').position, { x: 0, y: 10 });
  });

  it("measures dimensional constraints to a spline's end and an arc's midpoint", () => {
    const { d, m } = setup();
    const s = d.spline([
      [0, 0],
      [2, 3],
      [5, 2],
      [7, 5],
    ]);
    const a = d.arc(20, 0, 5, 0, 180);
    const r = m.addDimension(
      { handle: 'D1', dimension: 'aligned', refs: [pt(s, 'end'), pt(a, 'mid')], expression: '12' },
      d.lookup,
    );
    if (!r.ok) throw new Error(r.message);
    d.apply(r.updated);
    const arc = d.geom(a, 'ARC');
    const top = { x: arc.center.x, y: arc.center.y + arc.radius };
    near(len(d.geom(s, 'SPLINE').controlPoints[3]!, top), 12);
  });

  it("takes a polyline arc segment's midpoint", () => {
    const { d, add } = setup();
    const poly = d.polyline([
      [0, 0],
      [10, 0, 1],
      [10, 10],
    ]);
    const l = d.line(20, 20, 30, 20);
    add(con('coincident', pt(poly, 'mid', 1), pt(l, 'start')));
    // A half circle from (10, 0) to (10, 10), counter-clockwise: its midpoint is (15, 5).
    nearPt(d.geom(l, 'LINE').start, { x: 15, y: 5 });
  });
});
