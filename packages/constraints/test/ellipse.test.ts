// Ellipses and elliptical arcs in ConstraintModel (M9-02 part 3): their centre, axis ends
// (quadrants) and an arc's ends as constraint points, a point on one (Coincident), Concentric,
// Tangent with a line and Fix, as AutoCAD 2024's GEOMCONSTRAINT takes them. Results are checked
// on the ellipses the model hands back, by the engine's own evaluation.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ellipseSweep,
  pointAt,
  toleranceForSize,
  type EllipseGeometry,
  type Vec2,
} from '@triya/engine';
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

let constraintHandle = 0x4000;
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

/** Where `p` is in the ellipse's own frame, scaled to the unit circle: on it when its length is 1. */
function unitFrame(e: EllipseGeometry, p: Vec2): Vec2 {
  const a = Math.hypot(e.majorAxis.x, e.majorAxis.y);
  const u = { x: e.majorAxis.x / a, y: e.majorAxis.y / a };
  const dx = p.x - e.center.x;
  const dy = p.y - e.center.y;
  return { x: (dx * u.x + dy * u.y) / a, y: (-dx * u.y + dy * u.x) / (a * e.ratio) };
}
const onEllipse = (e: EllipseGeometry, p: Vec2) => {
  const q = unitFrame(e, p);
  near(Math.hypot(q.x, q.y), 1, 1e-6);
};

/** The ellipse's shape (axes' lengths, turn, sweep), which moving it whole keeps. */
const shape = (e: EllipseGeometry) => ({
  a: Math.hypot(e.majorAxis.x, e.majorAxis.y),
  turn: Math.atan2(e.majorAxis.y, e.majorAxis.x),
  ratio: e.ratio,
  sweep: ellipseSweep(e),
});
const sameShape = (e: EllipseGeometry, f: EllipseGeometry) => {
  const [s, t] = [shape(e), shape(f)];
  near(s.a, t.a, 1e-6);
  near(s.turn, t.turn, 1e-6);
  near(s.ratio, t.ratio, 1e-6);
  near(s.sweep, t.sweep, 1e-6);
};

describe('ellipses as constraint geometry', () => {
  it('puts a point on an ellipse, and keeps the ellipse', () => {
    const { d, add } = setup();
    const e = d.ellipse(0, 0, [6, 2], 0.5);
    const p = d.point(9, 9);
    const before = d.geom(e, 'ELLIPSE');
    add(con('coincident', curve(e), pt(p, 'position')));
    onEllipse(d.geom(e, 'ELLIPSE'), d.geom(p, 'POINT').position);
    expect(d.geom(e, 'ELLIPSE')).toBe(before);
  });

  it("takes an ellipse's centre and the ends of its axes", () => {
    const { d, add } = setup();
    const e = d.ellipse(5, 5, [0, 4], 0.25);
    const ls = [0, 1, 2, 3].map((i) => d.line(20 + i, 20, 30, 30));
    ls.forEach((l, i) => add(con('coincident', pt(e, 'quadrant', i), pt(l, 'start'))));
    const c = d.line(40, 40, 50, 50);
    add(con('coincident', pt(e, 'center'), pt(c, 'end')));
    // The major axis points up: 0 is its top end, 1 the minor axis's end a quarter turn on (left).
    const ends = [
      { x: 5, y: 9 },
      { x: 4, y: 5 },
      { x: 5, y: 1 },
      { x: 6, y: 5 },
    ];
    ls.forEach((l, i) => nearPt(d.geom(l, 'LINE').start, ends[i]!));
    nearPt(d.geom(c, 'LINE').end, { x: 5, y: 5 });
  });

  it("takes an elliptical arc's ends, and moves the arc whole to a point", () => {
    const { d, add } = setup();
    const e = d.ellipse(0, 0, [4, 0], 0.5, [0, 90]);
    const l = d.line(10, 10, 20, 10);
    const before = d.geom(e, 'ELLIPSE');
    add(con('coincident', pt(l, 'start'), pt(e, 'end')));
    const after = d.geom(e, 'ELLIPSE');
    sameShape(after, before);
    nearPt(pointAt(after, after.startParam + ellipseSweep(after)), { x: 10, y: 10 });
    nearPt(after.center, { x: 10, y: 8 });
  });

  it('makes a circle concentric with an ellipse, and an ellipse with a circle', () => {
    const { d, add } = setup();
    const e = d.ellipse(0, 0, [4, 3], 0.5);
    const c = d.circle(7, 1, 2);
    add(con('concentric', curve(e), curve(c)));
    nearPt(d.geom(c, 'CIRCLE').center, { x: 0, y: 0 });
    const f = d.ellipse(20, 20, [3, 0], 0.3, [10, 200]);
    const before = d.geom(f, 'ELLIPSE');
    add(con('concentric', curve(c), curve(f)));
    nearPt(d.geom(f, 'ELLIPSE').center, { x: 0, y: 0 });
    sameShape(d.geom(f, 'ELLIPSE'), before);
  });

  it('makes a line tangent to an ellipse', () => {
    const { d, add } = setup();
    const e = d.ellipse(0, 0, [5, 0], 0.4);
    const l = d.line(-8, 4, 8, 5);
    add(con('tangent', curve(e), curve(l)));
    const g = d.geom(e, 'ELLIPSE');
    const line = d.geom(l, 'LINE');
    // In the frame where the ellipse is the unit circle the line is 1 from the centre.
    const a = unitFrame(g, line.start);
    const b = unitFrame(g, line.end);
    const cross = a.x * b.y - a.y * b.x;
    near(Math.abs(cross) / len(a, b), 1, 1e-6);
  });

  it('holds a fixed ellipse, and moves an axis end as the ellipse is edited', () => {
    const { d, m, add } = setup();
    const e = d.ellipse(0, 0, [4, 0], 0.5);
    const l = d.line(10, 10, 20, 10);
    add(con('coincident', pt(e, 'quadrant', 1), pt(l, 'start')));
    nearPt(d.geom(l, 'LINE').start, { x: 0, y: 2 });
    let r = m.solveEdit([d.edit(e, { center: { x: 3, y: 1 }, ratio: 0.75 })], d.lookup);
    if (!r.ok) throw new Error(r.message);
    d.apply(r.updated);
    nearPt(d.geom(l, 'LINE').start, { x: 3, y: 4 });
    add(con('fix', curve(e)));
    r = m.solveEdit([d.edit(l, { start: { x: 0, y: 0 } })], d.lookup);
    expect(r).toMatchObject({ ok: false, reason: 'overconstrained' });
  });

  it('turns an ellipse to keep an axis end on a point', () => {
    const { d, add } = setup();
    const e = d.ellipse(0, 0, [4, 0], 0.5);
    const p = d.point(0, 4);
    add(con('fix', pt(p, 'position')));
    add(con('fix', pt(e, 'center')));
    const before = d.geom(e, 'ELLIPSE');
    add(con('coincident', pt(p, 'position'), pt(e, 'quadrant', 0)));
    const after = d.geom(e, 'ELLIPSE');
    nearPt(after.center, { x: 0, y: 0 });
    nearPt(pointAt(after, 0), { x: 0, y: 4 });
    near(shape(after).ratio, shape(before).ratio, 1e-6);
  });

  it('measures a dimensional constraint to an axis end', () => {
    const { d, m } = setup();
    const e = d.ellipse(0, 0, [4, 0], 0.5);
    const p = d.point(10, 0);
    const r = m.addDimension(
      {
        handle: 'D1',
        dimension: 'aligned',
        refs: [pt(e, 'quadrant', 0), pt(p, 'position')],
        expression: '3',
      },
      d.lookup,
    );
    if (!r.ok) throw new Error(r.message);
    d.apply(r.updated);
    near(len(pointAt(d.geom(e, 'ELLIPSE'), 0), d.geom(p, 'POINT').position), 3);
  });

  it('refuses what PlaneGCS cannot do with an ellipse, and an ellipse that is a circle', () => {
    const { d, m } = setup();
    const e = d.ellipse(0, 0, [4, 0], 0.5);
    const f = d.ellipse(20, 0, [4, 0], 0.5);
    const c = d.circle(10, 10, 2);
    const round = d.ellipse(40, 0, [4, 0], 1);
    const l = d.line(0, 0, 10, 0);
    const tries: [GeometricConstraint, string][] = [
      [con('tangent', curve(e), curve(c)), 'unsupported'],
      [con('tangent', curve(e), curve(f)), 'unsupported'],
      [con('equal', curve(e), curve(f)), 'invalid'],
      [con('symmetric', curve(e), curve(f), curve(l)), 'invalid'],
      [con('parallel', curve(e), curve(l)), 'invalid'],
      [con('coincident', pt(e, 'start'), pt(l, 'start')), 'invalid'],
      [con('coincident', pt(e, 'quadrant', 4), pt(l, 'start')), 'invalid'],
      [con('coincident', pt(round, 'center'), pt(l, 'start')), 'unsupported'],
    ];
    for (const [c2, reason] of tries) {
      expect(m.add(c2, d.lookup), JSON.stringify(c2.refs)).toMatchObject({ ok: false, reason });
    }
  });
});
