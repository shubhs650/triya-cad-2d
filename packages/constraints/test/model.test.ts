// ConstraintModel (M9-02): Triya entities mapped to PlaneGCS primitives, AutoCAD's geometric
// constraints, solve on edit, degrees of freedom, and over-constrained (conflicting or
// redundant) detection. Each scenario builds a few entities, constrains them as GEOMCONSTRAINT
// would, and checks the geometry the solver hands back.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bulgeArc,
  createEntity,
  toleranceForSize,
  type Entity,
  type EntityGeometry,
  type Handle,
  type Replacement,
  type Vec2,
} from '@triya/engine';
import {
  ConstraintModel,
  GEOMETRIC_KINDS,
  loadPlaneGcs,
  type CurveRef,
  type GeometricConstraint,
  type GeometricKind,
  type GeomRef,
  type PlaneGcs,
  type PointName,
  type PointRef,
} from '../src/index';

const wasm = () => Promise.resolve(readFileSync(new URL('../wasm/planegcs.wasm', import.meta.url)));

let gcs: PlaneGcs;
beforeAll(async () => {
  gcs = await loadPlaneGcs(wasm);
});

const EPS = 1e-7;
const near = (a: number, b: number, eps = EPS) => expect(Math.abs(a - b)).toBeLessThan(eps);
const nearPt = (a: Vec2, b: Vec2, eps = EPS) => {
  near(a.x, b.x, eps);
  near(a.y, b.y, eps);
};

/** A drawing: entities by handle, edited by the replacements the model hands back. */
class Drawing {
  readonly entities = new Map<Handle, Entity>();
  #id = 1;
  #handle = 0x200;
  readonly lookup = (h: Handle) => this.entities.get(h);

  add(geom: EntityGeometry): Handle {
    const handle = (this.#handle++).toString(16).toUpperCase();
    const entity = createEntity(this.#id++, {
      handle,
      owner: '1F',
      type: geom.kind,
      layer: '10',
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
      geom,
    });
    this.entities.set(handle, entity);
    return handle;
  }

  line(x1: number, y1: number, x2: number, y2: number): Handle {
    return this.add({ kind: 'LINE', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
  }
  circle(x: number, y: number, radius: number): Handle {
    return this.add({ kind: 'CIRCLE', center: { x, y }, radius });
  }
  arc(x: number, y: number, radius: number, startDeg: number, endDeg: number): Handle {
    const rad = Math.PI / 180;
    return this.add({
      kind: 'ARC',
      center: { x, y },
      radius,
      startAngle: startDeg * rad,
      endAngle: endDeg * rad,
    });
  }
  point(x: number, y: number): Handle {
    return this.add({ kind: 'POINT', position: { x, y } });
  }
  polyline(vertices: [number, number, number?][], closed = false): Handle {
    return this.add({
      kind: 'LWPOLYLINE',
      closed,
      vertices: vertices.map(([x, y, bulge]) => ({ x, y, bulge: bulge ?? 0 })),
    });
  }

  /** Applies the replacements, checking each `before` is what the drawing holds. */
  apply(updated: readonly Replacement<Entity>[]): void {
    for (const { before, after } of updated) {
      expect(this.entities.get(before.handle)).toBe(before);
      this.entities.set(after.handle, after);
    }
  }

  /** The replacement an edit makes: `geom` patched onto the entity. */
  edit(handle: Handle, patch: Record<string, unknown>): Replacement<Entity> {
    const before = this.entities.get(handle)!;
    const after = { ...before, geom: { ...before.geom, ...patch } } as Entity;
    return { before, after };
  }

  geom<K extends EntityGeometry['kind']>(h: Handle, kind: K): Extract<EntityGeometry, { kind: K }> {
    const g = this.entities.get(h)!.geom;
    expect(g.kind).toBe(kind);
    return g as Extract<EntityGeometry, { kind: K }>;
  }
}

const curve = (entity: Handle, segment?: number): CurveRef =>
  segment === undefined ? { entity } : { entity, segment };
const pt = (entity: Handle, point: PointName, index?: number): PointRef =>
  index === undefined ? { entity, point } : { entity, point, index };

let constraintHandle = 0x1000;
const con = (kind: GeometricKind, ...refs: GeomRef[]): GeometricConstraint => ({
  handle: (constraintHandle++).toString(16).toUpperCase(),
  kind,
  refs,
});

function setup() {
  const d = new Drawing();
  const m = new ConstraintModel(gcs, toleranceForSize(100));
  /** Adds a constraint that must be accepted, and applies what it moves. */
  const add = (c: GeometricConstraint) => {
    const r = m.add(c, d.lookup);
    if (!r.ok) throw new Error(`${c.kind} refused: ${r.reason} ${r.message}`);
    d.apply(r.updated);
    return r;
  };
  return { d, m, add };
}

const angleOf = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
const len = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
/** Distance from `p` to the infinite line through `a` and `b`. */
const toLine = (p: Vec2, a: Vec2, b: Vec2) => Math.abs(cross(a, b, p)) / len(a, b);

describe('ConstraintModel kinds', () => {
  it("lists AutoCAD's twelve geometric constraints in GEOMCONSTRAINT's prompt order", () => {
    expect(GEOMETRIC_KINDS).toEqual([
      'horizontal',
      'vertical',
      'perpendicular',
      'parallel',
      'tangent',
      'smooth',
      'coincident',
      'concentric',
      'collinear',
      'symmetric',
      'equal',
      'fix',
    ]);
  });
});

describe('geometric constraints', () => {
  it('Horizontal on a line keeps its start and brings its end level', () => {
    const { d, add } = setup();
    const l = d.line(1, 2, 9, 5);
    const r = add(con('horizontal', curve(l)));
    const g = d.geom(l, 'LINE');
    nearPt(g.start, { x: 1, y: 2 });
    near(g.end.y, 2);
    expect(r.dofs).toBe(3);
  });

  it('Vertical on two points keeps the first and moves the second', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 4, 1);
    const b = d.circle(7, 6, 1);
    add(con('vertical', pt(a, 'end'), pt(b, 'center')));
    nearPt(d.geom(a, 'LINE').end, { x: 4, y: 1 });
    near(d.geom(b, 'CIRCLE').center.x, 4);
    near(d.geom(b, 'CIRCLE').radius, 1);
  });

  it('Parallel and Perpendicular turn the second line and leave the first', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 2);
    const b = d.line(0, 5, 8, 9);
    const c = d.line(20, 0, 25, 1);
    add(con('parallel', curve(a), curve(b)));
    add(con('perpendicular', curve(a), curve(c)));
    const ga = d.geom(a, 'LINE');
    nearPt(ga.start, { x: 0, y: 0 });
    nearPt(ga.end, { x: 10, y: 2 });
    const gb = d.geom(b, 'LINE');
    const gc = d.geom(c, 'LINE');
    near(Math.sin(angleOf(gb.start, gb.end) - angleOf(ga.start, ga.end)), 0);
    near(Math.cos(angleOf(gc.start, gc.end) - angleOf(ga.start, ga.end)), 0);
  });

  it('Coincident joins two points, the second moving to the first', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(10.4, 0.3, 10, 8);
    add(con('coincident', pt(a, 'end'), pt(b, 'start')));
    nearPt(d.geom(a, 'LINE').end, { x: 10, y: 0 });
    nearPt(d.geom(b, 'LINE').start, { x: 10, y: 0 });
  });

  it("Coincident puts a point on a circle, an arc or a line's extension", () => {
    const { d, add } = setup();
    const c = d.circle(0, 0, 5);
    const arc = d.arc(20, 0, 3, 0, 90);
    const l = d.line(0, 10, 10, 10);
    const p = d.point(6, 1);
    const q = d.point(20, 4);
    const s = d.point(30, 11);
    add(con('coincident', curve(c), pt(p, 'position')));
    add(con('coincident', pt(q, 'position'), curve(arc)));
    add(con('coincident', pt(s, 'position'), curve(l)));
    near(Math.hypot(d.geom(p, 'POINT').position.x, d.geom(p, 'POINT').position.y), 5);
    const qa = d.geom(q, 'POINT').position;
    near(Math.hypot(qa.x - 20, qa.y), 3);
    near(d.geom(s, 'POINT').position.y, 10);
    near(d.geom(c, 'CIRCLE').radius, 5);
  });

  it("Coincident at a line's midpoint", () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(4, 3, 4, 9);
    add(con('coincident', pt(a, 'mid'), pt(b, 'start')));
    nearPt(d.geom(b, 'LINE').start, { x: 5, y: 0 });
    nearPt(d.geom(a, 'LINE').end, { x: 10, y: 0 });
  });

  it('Collinear puts the second line on the first one', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(12, 1, 20, -1);
    add(con('collinear', curve(a), curve(b)));
    const gb = d.geom(b, 'LINE');
    near(gb.start.y, 0);
    near(gb.end.y, 0);
  });

  it('Concentric moves the second circle or arc onto the first centre', () => {
    const { d, add } = setup();
    const c = d.circle(0, 0, 5);
    const arc = d.arc(1, 1, 2, 0, 180);
    add(con('concentric', curve(c), curve(arc)));
    const g = d.geom(arc, 'ARC');
    nearPt(g.center, { x: 0, y: 0 });
    near(g.radius, 2);
    near(g.endAngle - g.startAngle, Math.PI, 1e-6);
  });

  it('Tangent between a line and a circle, and between two circles', () => {
    const { d, add } = setup();
    const l = d.line(-10, 0, 10, 0);
    const c = d.circle(0, 3, 2);
    const e = d.circle(5, 3, 1);
    add(con('tangent', curve(l), curve(c)));
    add(con('tangent', curve(c), curve(e)));
    const gl = d.geom(l, 'LINE');
    const gc = d.geom(c, 'CIRCLE');
    const ge = d.geom(e, 'CIRCLE');
    nearPt(gl.start, { x: -10, y: 0 });
    near(toLine(gc.center, gl.start, gl.end), gc.radius);
    near(len(gc.center, ge.center), gc.radius + ge.radius);
  });

  it('Tangent between a line and an arc', () => {
    const { d, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const arc = d.arc(5, 4, 3, 180, 360);
    add(con('tangent', curve(l), curve(arc)));
    const g = d.geom(arc, 'ARC');
    near(toLine(g.center, { x: 0, y: 0 }, { x: 10, y: 0 }), g.radius);
  });

  it('Tangent at the joined ends of a line and an arc (a fillet)', () => {
    const { d, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const arc = d.arc(10, 3, 3, 270, 0); // starts at (10, 0), a quarter turn
    add(con('fix', curve(l)));
    add(con('coincident', pt(l, 'end'), pt(arc, 'start')));
    add(con('tangent', curve(l), curve(arc)));
    const g = d.geom(arc, 'ARC');
    // Tangent at (10, 0): the centre straight above it, to the micrometre and better.
    near(g.center.x, 10, 1e-9);
    near(g.center.y, g.radius, 1e-9);
    nearPt(
      {
        x: g.center.x + g.radius * Math.cos(g.startAngle),
        y: g.center.y + g.radius * Math.sin(g.startAngle),
      },
      { x: 10, y: 0 },
      1e-9,
    );
  });

  it('Equal gives lines one length and circles and arcs one radius', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 6, 5);
    const c = d.circle(0, 20, 4);
    const arc = d.arc(20, 20, 2, 0, 90);
    add(con('equal', curve(a), curve(b)));
    add(con('equal', curve(c), curve(arc)));
    const gb = d.geom(b, 'LINE');
    near(len(gb.start, gb.end), 10);
    near(d.geom(arc, 'ARC').radius, 4);
    near(d.geom(c, 'CIRCLE').radius, 4);
  });

  it('Symmetric points and circles about a line', () => {
    const { d, add } = setup();
    const axis = d.line(0, -10, 0, 10);
    const p = d.point(-3, 2);
    const q = d.point(4, 1);
    const c1 = d.circle(-5, 5, 2);
    const c2 = d.circle(6, 4, 1);
    add(con('symmetric', pt(p, 'position'), pt(q, 'position'), curve(axis)));
    add(con('symmetric', curve(c1), curve(c2), curve(axis)));
    nearPt(d.geom(q, 'POINT').position, { x: 3, y: 2 });
    nearPt(d.geom(c2, 'CIRCLE').center, { x: 5, y: 5 });
    near(d.geom(c2, 'CIRCLE').radius, 2);
  });

  it("Symmetric lines mirror the line's angle, not its endpoints", () => {
    const { d, add } = setup();
    const axis = d.line(0, 0, 0, 10);
    const a = d.line(-6, 0, -2, 4); // 45°
    const b = d.line(3, 5, 9, 7); // drawn the other way round from a's mirror
    const c = d.line(8, 0, 2, 3); // drawn the same way round as a's mirror
    add(con('symmetric', curve(a), curve(b), curve(axis)));
    add(con('symmetric', curve(a), curve(c), curve(axis)));
    const gb = d.geom(b, 'LINE');
    const gc = d.geom(c, 'LINE');
    // The mirror of 45° about the Y axis is 135°, or -45° drawn the other way.
    near(Math.abs(Math.sin(angleOf(gb.start, gb.end) - (3 * Math.PI) / 4)), 0);
    near(Math.abs(Math.sin(angleOf(gc.start, gc.end) - (3 * Math.PI) / 4)), 0);
    nearPt(d.geom(a, 'LINE').start, { x: -6, y: 0 });
  });

  it('Fix holds a point or a whole object where it is', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 3);
    const b = d.circle(20, 0, 4);
    add(con('fix', pt(a, 'start')));
    add(con('fix', curve(b)));
    add(con('horizontal', pt(a, 'end'), pt(a, 'start')));
    nearPt(d.geom(a, 'LINE').start, { x: 0, y: 0 });
    near(d.geom(a, 'LINE').end.y, 0);
    expect(m.diagnose(d.lookup).dofs).toBe(1);
    const r = m.add(con('tangent', curve(b), curve(a)), d.lookup);
    expect(r).toMatchObject({ ok: false, reason: 'overconstrained' });
  });

  it('Smooth joins a spline, not two lines (smooth.test.ts has the splines)', () => {
    const { d, m } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(10, 0, 20, 5);
    const r = m.add(con('smooth', pt(a, 'end'), pt(b, 'start')), d.lookup);
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
    expect(m.constraints).toEqual([]);
  });
});

describe('lines keep their length (M9-08)', () => {
  // AutoCAD turns the second object about its held point, or moves it whole, rather than
  // stretching it: a least-change solve alone shortens a line it turns.
  it('Parallel turns the second line about its start, its length kept', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 60, 25);
    const before = len({ x: 0, y: 5 }, { x: 60, y: 25 });
    add(con('parallel', curve(a), curve(b)));
    const gb = d.geom(b, 'LINE');
    nearPt(gb.start, { x: 0, y: 5 });
    nearPt(gb.end, { x: before, y: 5 });
  });

  it('Perpendicular turns the second line about its start, its length kept', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const c = d.line(20, 0, 25, 1);
    const before = len({ x: 20, y: 0 }, { x: 25, y: 1 });
    add(con('perpendicular', curve(a), curve(c)));
    const gc = d.geom(c, 'LINE');
    nearPt(gc.start, { x: 20, y: 0 });
    nearPt(gc.end, { x: 20, y: before });
  });

  it('Horizontal and Vertical turn a line about its start, its length kept', () => {
    const { d, add } = setup();
    const h = d.line(1, 2, 9, 5);
    const v = d.line(30, 0, 33, 4);
    add(con('horizontal', curve(h)));
    add(con('vertical', curve(v)));
    nearPt(d.geom(h, 'LINE').start, { x: 1, y: 2 });
    nearPt(d.geom(h, 'LINE').end, { x: 1 + Math.hypot(8, 3), y: 2 });
    nearPt(d.geom(v, 'LINE').start, { x: 30, y: 0 });
    nearPt(d.geom(v, 'LINE').end, { x: 30, y: 5 });
  });

  it('Coincident moves the second line whole', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(10.4, 0.3, 10, 8);
    add(con('coincident', pt(a, 'end'), pt(b, 'start')));
    nearPt(d.geom(b, 'LINE').start, { x: 10, y: 0 });
    nearPt(d.geom(b, 'LINE').end, { x: 9.6, y: 7.7 });
  });

  it('a horizontal line made coincident with another line moves along, still horizontal', () => {
    const { d, add } = setup();
    // A least-change solve moved only the start, collapsing the line, and refused it.
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 10, 5);
    add(con('horizontal', curve(b)));
    add(con('coincident', pt(a, 'end'), pt(b, 'start')));
    nearPt(d.geom(a, 'LINE').start, { x: 0, y: 0 });
    nearPt(d.geom(a, 'LINE').end, { x: 10, y: 0 });
    const gb = d.geom(b, 'LINE');
    nearPt(gb.start, { x: 10, y: 0 });
    nearPt(gb.end, { x: 20, y: 0 });
  });

  it('a line joined to the one turned keeps its length too', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 6, 13);
    const c = d.line(6, 13, 9, 20);
    add(con('coincident', pt(b, 'end'), pt(c, 'start')));
    add(con('parallel', curve(a), curve(b)));
    const gb = d.geom(b, 'LINE');
    const gc = d.geom(c, 'LINE');
    near(len(gb.start, gb.end), 10);
    near(len(gc.start, gc.end), Math.hypot(3, 7));
    nearPt(gc.start, gb.end);
  });

  it("Equal keeps the second line's start and direction", () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 3, 9);
    add(con('equal', curve(a), curve(b)));
    const gb = d.geom(b, 'LINE');
    nearPt(gb.start, { x: 0, y: 5 });
    nearPt(gb.end, { x: 6, y: 13 });
  });
});

describe('polylines', () => {
  it('constrains a straight segment and a vertex', () => {
    const { d, add } = setup();
    const p = d.polyline([
      [0, 0],
      [10, 1],
      [12, 8],
    ]);
    const l = d.line(30, 30, 40, 40);
    add(con('horizontal', curve(p, 0)));
    add(con('coincident', pt(p, 'vertex', 2), pt(l, 'start')));
    const g = d.geom(p, 'LWPOLYLINE');
    near(g.vertices[1]!.y, 0);
    nearPt(d.geom(l, 'LINE').start, g.vertices[2]!);
    expect(g.vertices.every((v) => v.bulge === 0)).toBe(true);
  });

  it('keeps an arc segment on its vertices and makes it tangent to the next segment', () => {
    const { d, add } = setup();
    // A slot end: a straight segment then a half-circle that starts a little off tangent.
    const p = d.polyline([
      [0, 0],
      [10, 0, 0.9],
      [10, 4],
    ]);
    add(con('horizontal', curve(p, 0)));
    add(con('fix', pt(p, 'vertex', 0)));
    add(con('tangent', curve(p, 0), curve(p, 1)));
    const g = d.geom(p, 'LWPOLYLINE');
    const [v0, v1, v2] = g.vertices;
    nearPt(v0!, { x: 0, y: 0 });
    near(v1!.y, 0);
    // Tangent at v1 to a horizontal line: the arc's centre is straight above v1.
    const arc = bulgeArc(v1!, v2!, v1!.bulge);
    expect(arc.sweep).toBeGreaterThan(0);
    near(arc.center.x, v1!.x, 1e-9);
    near(arc.radius, arc.center.y - v1!.y, 1e-9);
  });

  it('the midpoint and centre of a segment', () => {
    const { d, add } = setup();
    const p = d.polyline([
      [0, 0],
      [10, 0, -1],
      [10, -10],
    ]);
    const a = d.point(3, 3);
    const c = d.circle(1, 1, 1);
    add(con('coincident', pt(p, 'mid', 0), pt(a, 'position')));
    add(con('concentric', curve(p, 1), curve(c)));
    nearPt(d.geom(a, 'POINT').position, { x: 5, y: 0 });
    nearPt(d.geom(c, 'CIRCLE').center, { x: 10, y: -5 });
  });
});

describe('solve on edit', () => {
  /** A rectangle of four lines, corners coincident, sides horizontal and vertical. */
  function rectangle() {
    const s = setup();
    const { d, add } = s;
    const l = [d.line(0, 0, 10, 0), d.line(10, 0, 10, 5), d.line(10, 5, 0, 5), d.line(0, 5, 0, 0)];
    for (let i = 0; i < 4; i++)
      add(con('coincident', pt(l[i]!, 'end'), pt(l[(i + 1) % 4]!, 'start')));
    add(con('horizontal', curve(l[0]!)));
    add(con('vertical', curve(l[1]!)));
    add(con('horizontal', curve(l[2]!)));
    add(con('vertical', curve(l[3]!)));
    return { ...s, l };
  }

  it('keeps a rectangle when a corner grip is dragged', () => {
    const { d, m, l } = rectangle();
    // Grip-stretch the corner shared by sides 0 and 1 to (14, -2).
    const r = m.solveEdit(
      [d.edit(l[0]!, { end: { x: 14, y: -2 } }), d.edit(l[1]!, { start: { x: 14, y: -2 } })],
      d.lookup,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    const g = l.map((h) => d.geom(h, 'LINE'));
    nearPt(g[0]!.end, { x: 14, y: -2 });
    nearPt(g[1]!.start, { x: 14, y: -2 });
    near(g[0]!.start.y, -2);
    near(g[1]!.end.x, 14);
    for (let i = 0; i < 4; i++) nearPt(g[i]!.end, g[(i + 1) % 4]!.start);
    // Side 3 is free to stay where it was: the solver moves as little as it can.
    near(g[3]!.start.x, 0);
    expect(r.updated.map((u) => u.after.handle).sort()).toEqual([...l].sort());
  });

  it('moves the constrained neighbours of a moved line', () => {
    const { d, m, l } = rectangle();
    const r = m.solveEdit(
      [d.edit(l[2]!, { start: { x: 10, y: 8 }, end: { x: 0, y: 8 } })],
      d.lookup,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(l[1]!, 'LINE').end, { x: 10, y: 8 });
    nearPt(d.geom(l[3]!, 'LINE').start, { x: 0, y: 8 });
    nearPt(d.geom(l[0]!, 'LINE').start, { x: 0, y: 0 });
  });

  it('hands an edit of unconstrained geometry back unchanged', () => {
    const { d, m } = rectangle();
    const free = d.line(50, 50, 60, 60);
    const edit = d.edit(free, { end: { x: 70, y: 60 } });
    const r = m.solveEdit([edit], d.lookup);
    expect(r).toEqual({ ok: true, updated: [edit] });
  });

  it('refuses an edit that moves fixed geometry, naming the Fix', () => {
    const { d, m, l } = rectangle();
    const fix = con('fix', pt(l[0]!, 'start'));
    expect(m.add(fix, d.lookup).ok).toBe(true);
    const before = new Map(d.entities);
    const r = m.solveEdit(
      [d.edit(l[0]!, { start: { x: -3, y: -3 } }), d.edit(l[3]!, { end: { x: -3, y: -3 } })],
      d.lookup,
    );
    expect(r).toMatchObject({ ok: false, reason: 'overconstrained' });
    if (r.ok) return;
    expect(r.conflicting).toContain(fix.handle);
    expect(d.entities).toEqual(before);
  });

  it('an edit is free again once its constraint is deleted', () => {
    const { d, m } = setup();
    const a = d.line(0, 0, 10, 0);
    const h = con('horizontal', curve(a));
    expect(m.add(h, d.lookup).ok).toBe(true);
    expect(m.constraintsOn(a)).toEqual([h]);
    expect(m.remove(h.handle)).toBe(true);
    expect(m.remove(h.handle)).toBe(false);
    const edit = d.edit(a, { end: { x: 10, y: 4 } });
    expect(m.solveEdit([edit], d.lookup)).toEqual({ ok: true, updated: [edit] });
  });
});

describe('edits keep line lengths (M9-09)', () => {
  // A least-change solve of an edit spread a turn over both ends of a line it had to turn,
  // shortening it (a 20-long line left 17.5), and moved the dragged line's other end. Now the
  // edited entity stays as edited where it can, and a line an orientation constraint turns
  // (Parallel, Perpendicular, Collinear, Symmetric, an angle) keeps its length, turning about
  // its start where it can, everything else staying put.
  it('a grip drag of one line of a parallel pair turns the other about its start, its length kept', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 20, 0);
    const b = d.line(0, 5, 20, 5);
    add(con('parallel', curve(a), curve(b)));
    const r = m.solveEdit([d.edit(a, { end: { x: 16, y: 12 } })], d.lookup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    const ga = d.geom(a, 'LINE');
    const gb = d.geom(b, 'LINE');
    nearPt(ga.start, { x: 0, y: 0 });
    nearPt(ga.end, { x: 16, y: 12 });
    nearPt(gb.start, { x: 0, y: 5 });
    nearPt(gb.end, { x: 16, y: 17 });
  });

  it('a joined chain turned by a grip drag keeps every length', () => {
    const { d, m, add } = setup();
    // a, b and c joined end to start; b parallel to the reference r, c perpendicular to b.
    const ref = d.line(0, -10, 10, -10);
    const a = d.line(0, 0, 10, 0);
    const b = d.line(10, 0, 20, 0);
    const c = d.line(20, 0, 20, 6);
    add(con('coincident', pt(a, 'end'), pt(b, 'start')));
    add(con('coincident', pt(b, 'end'), pt(c, 'start')));
    add(con('parallel', curve(ref), curve(b)));
    add(con('perpendicular', curve(b), curve(c)));
    const r = m.solveEdit([d.edit(ref, { end: { x: 8, y: -4 } })], d.lookup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(ref, 'LINE').start, { x: 0, y: -10 });
    // a stays; b turns about the joint with a; c rides on b's end, still square to it.
    nearPt(d.geom(a, 'LINE').start, { x: 0, y: 0 });
    nearPt(d.geom(a, 'LINE').end, { x: 10, y: 0 });
    nearPt(d.geom(b, 'LINE').start, { x: 10, y: 0 });
    nearPt(d.geom(b, 'LINE').end, { x: 18, y: 6 });
    nearPt(d.geom(c, 'LINE').start, { x: 18, y: 6 });
    nearPt(d.geom(c, 'LINE').end, { x: 14.4, y: 10.8 });
    expect(r.updated.map((u) => u.after.handle).sort()).toEqual([ref, b, c].sort());
  });

  it("a modify command's edit turns a parallel line about its start, its length kept", () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 20, 5);
    add(con('parallel', curve(a), curve(b)));
    // ROTATE a 60 degrees about its start: the command holds a whole.
    const turn = { x: Math.cos(Math.PI / 3), y: Math.sin(Math.PI / 3) };
    const r = m.solveEdit([d.edit(a, { end: { x: 10 * turn.x, y: 10 * turn.y } })], d.lookup, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(b, 'LINE').start, { x: 0, y: 5 });
    nearPt(d.geom(b, 'LINE').end, { x: 20 * turn.x, y: 5 + 20 * turn.y });
  });

  it('an angular dimension turns its second line with its length kept', () => {
    const { d, m } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 0, 0, 8);
    const coincident = con('coincident', pt(a, 'start'), pt(b, 'start'));
    expect(m.add(coincident, d.lookup).ok).toBe(true);
    const dim = m.addDimension(
      { handle: 'D90', dimension: 'angular', refs: [curve(a), curve(b)] },
      d.lookup,
    );
    expect(dim.ok).toBe(true);
    const r = m.solveEdit([d.edit(a, { end: { x: 0, y: 10 } })], d.lookup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(b, 'LINE').start, { x: 0, y: 0 });
    nearPt(d.geom(b, 'LINE').end, { x: -8, y: 0 });
  });

  it('a line held only by a Coincident still stretches to a dragged corner', () => {
    const { d, m, add } = setup();
    // Lengths are free until a dimensional constraint sets them: a joint drags the line
    // joined to it as a polyline vertex would, its far end staying.
    const a = d.line(0, 0, 10, 0);
    const b = d.line(10, 0, 10, 10);
    add(con('coincident', pt(a, 'end'), pt(b, 'start')));
    const r = m.solveEdit([d.edit(a, { end: { x: 12, y: 3 } })], d.lookup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(a, 'LINE').start, { x: 0, y: 0 });
    nearPt(d.geom(b, 'LINE').start, { x: 12, y: 3 });
    nearPt(d.geom(b, 'LINE').end, { x: 10, y: 10 });
  });
});

describe('a quarter turn of a constrained line (M9-11)', () => {
  // PlaneGCS's Parallel is the cross product of the two directions, which has no slope when
  // they are square to each other: an edit that turns one of a parallel pair exactly 90
  // degrees left the solver no way to start turning the other, and was refused (89 worked).
  // The lines an orientation constraint turns with the edited one now start turned by the
  // edit's turn.
  it('ROTATE 90 of one of a parallel pair turns the other about its start, its length kept', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 20, 5);
    add(con('parallel', curve(a), curve(b)));
    // ROTATE a 90 degrees about its start: the command holds a whole.
    const r = m.solveEdit([d.edit(a, { end: { x: 0, y: 10 } })], d.lookup, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(a, 'LINE').start, { x: 0, y: 0 });
    nearPt(d.geom(a, 'LINE').end, { x: 0, y: 10 });
    nearPt(d.geom(b, 'LINE').start, { x: 0, y: 5 });
    nearPt(d.geom(b, 'LINE').end, { x: 0, y: 25 });
  });

  it('ROTATE -90 about its midpoint turns the other line the same way', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 20, 5);
    add(con('parallel', curve(a), curve(b)));
    const r = m.solveEdit(
      [d.edit(a, { start: { x: 5, y: 5 }, end: { x: 5, y: -5 } })],
      d.lookup,
      true,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(b, 'LINE').start, { x: 0, y: 5 });
    nearPt(d.geom(b, 'LINE').end, { x: 0, y: -15 });
  });

  it('a 90-degree grip drag of one of a parallel pair turns the other about its start', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 20, 0);
    const b = d.line(0, 5, 20, 5);
    add(con('parallel', curve(a), curve(b)));
    // The end grip dragged straight up: a turns 90 degrees and grows to 12.
    const r = m.solveEdit([d.edit(a, { end: { x: 0, y: 12 } })], d.lookup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(a, 'LINE').start, { x: 0, y: 0 });
    nearPt(d.geom(a, 'LINE').end, { x: 0, y: 12 });
    nearPt(d.geom(b, 'LINE').start, { x: 0, y: 5 });
    nearPt(d.geom(b, 'LINE').end, { x: 0, y: 25 });
  });

  it('a quarter turn carries a perpendicular line round too', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(20, 0, 20, 8);
    add(con('perpendicular', curve(a), curve(b)));
    const r = m.solveEdit([d.edit(a, { end: { x: 0, y: 10 } })], d.lookup, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    nearPt(d.geom(b, 'LINE').start, { x: 20, y: 0 });
    nearPt(d.geom(b, 'LINE').end, { x: 12, y: 0 });
  });

  it('a quarter turn still refuses what a Fix holds', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 20, 5);
    add(con('parallel', curve(a), curve(b)));
    add(con('fix', curve(b)));
    const r = m.solveEdit([d.edit(a, { end: { x: 0, y: 10 } })], d.lookup, true);
    expect(r).toMatchObject({ ok: false, reason: 'overconstrained' });
  });
});

describe('degrees of freedom and over-constrained geometry', () => {
  it('counts the degrees of freedom left', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 1);
    const b = d.line(10, 1, 10, 6);
    add(con('horizontal', curve(a)));
    expect(m.diagnose(d.lookup).dofs).toBe(3);
    add(con('coincident', pt(a, 'end'), pt(b, 'start')));
    expect(m.diagnose(d.lookup).dofs).toBe(5);
    add(con('perpendicular', curve(a), curve(b)));
    add(con('fix', pt(a, 'start')));
    add(con('equal', curve(a), curve(b)));
    const diag = m.diagnose(d.lookup);
    expect(diag).toMatchObject({ ok: true, dofs: 1, conflicting: [], redundant: [] });
  });

  it('refuses a constraint that contradicts the others, and leaves the geometry', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 10, 5);
    const ha = con('horizontal', curve(a));
    const hb = con('horizontal', curve(b));
    add(ha);
    add(hb);
    const before = new Map(d.entities);
    const perp = con('perpendicular', curve(a), curve(b));
    const r = m.add(perp, d.lookup);
    expect(r).toMatchObject({ ok: false, reason: 'overconstrained' });
    if (r.ok) return;
    // PlaneGCS would shrink one line to a point; AutoCAD calls it over-constrained.
    expect(r.conflicting).toContain(perp.handle);
    expect(m.constraints).toEqual([ha, hb]);
    expect(d.entities).toEqual(before);
  });

  it('refuses a constraint the others already imply', () => {
    const { d, m, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 10, 5);
    add(con('horizontal', curve(a)));
    add(con('horizontal', curve(b)));
    const r = m.add(con('parallel', curve(a), curve(b)), d.lookup);
    expect(r).toMatchObject({ ok: false, reason: 'redundant' });
    expect(m.constraints).toHaveLength(2);
  });

  it('reports conflicting and redundant constraints in a loaded set', () => {
    const { d, m } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 5, 10, 5);
    const c = d.line(20, 0, 30, 0);
    const ha = con('horizontal', curve(a));
    const hb = con('horizontal', curve(b));
    const perp = con('perpendicular', curve(a), curve(b));
    m.load([ha, hb, perp]);
    const conflict = m.diagnose(d.lookup);
    expect(conflict.ok).toBe(false);
    expect(conflict.conflicting).toContain(perp.handle);

    m.remove(perp.handle);
    const hc = con('horizontal', curve(c));
    const pc = con('parallel', curve(a), curve(c));
    m.load([...m.constraints, hc, pc]);
    const redundant = m.diagnose(d.lookup);
    expect(redundant.ok).toBe(true);
    expect(redundant.conflicting).toEqual([]);
    expect(redundant.redundant.some((h) => h === hc.handle || h === pc.handle)).toBe(true);
  });

  it('adding a constraint that already holds moves nothing', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    expect(add(con('horizontal', curve(a))).updated).toEqual([]);
  });
});

describe('refused references', () => {
  it('names geometry the model does not map, and references that do not fit the kind', () => {
    const { d, m } = setup();
    const e = d.add({
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 5, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    });
    const l = d.line(0, 0, 10, 0);
    const c = d.circle(0, 0, 3);
    const p = d.polyline([
      [0, 0],
      [5, 0, 1],
      [5, 5],
    ]);
    const tries: [GeometricConstraint, string][] = [
      [con('concentric', curve(e), curve(c)), 'unsupported'],
      [con('parallel', curve(l), curve(c)), 'invalid'],
      [con('tangent', curve(l), curve(l)), 'invalid'],
      [con('horizontal', pt(l, 'center')), 'invalid'],
      [con('coincident', pt(l, 'start'), pt(l, 'start')), 'invalid'],
      [con('parallel', curve(l), curve(p, 1)), 'invalid'],
      [con('equal', curve(l), curve(p, 7)), 'invalid'],
      [con('horizontal', curve('FFFF')), 'invalid'],
      [con('symmetric', curve(l), curve(c), curve(l)), 'invalid'],
    ];
    for (const [c2, reason] of tries) {
      expect(m.add(c2, d.lookup), c2.kind).toMatchObject({ ok: false, reason });
    }
    expect(m.constraints).toEqual([]);
  });
});
