// Dimensional constraints (M9-03 part 2): AutoCAD's DCHORIZONTAL, DCVERTICAL, DCALIGNED,
// DCANGULAR, DCRADIUS and DCDIAMETER in ConstraintModel, each with its parameter in the
// Parameters Manager's table, driven by expressions, or measuring as a reference parameter.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { toleranceForSize, type Handle, type Vec2 } from '@triya/engine';
import {
  ConstraintModel,
  DIMENSIONAL_KINDS,
  ParameterTable,
  loadPlaneGcs,
  measureDimension,
  type DimensionalKind,
  type DimensionSpec,
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

let handle = 0x2000;
const next = () => (handle++).toString(16).toUpperCase();
const dim = (
  dimension: DimensionalKind,
  refs: GeomRef[],
  options: Partial<Omit<DimensionSpec, 'dimension' | 'refs' | 'handle'>> = {},
): DimensionSpec => ({ handle: next(), dimension, refs, ...options });
const con = (kind: GeometricKind, ...refs: GeomRef[]): GeometricConstraint => ({
  handle: next(),
  kind,
  refs,
});

function setup() {
  const d = new Drawing();
  const m = new ConstraintModel(gcs, toleranceForSize(100));
  /** Adds a dimensional constraint that must be accepted, and applies what it moves. */
  const add = (spec: DimensionSpec) => {
    const r = m.addDimension(spec, d.lookup);
    if (!r.ok) throw new Error(`${spec.dimension} refused: ${r.reason} ${r.message}`);
    d.apply(r.updated);
    return r;
  };
  const geometric = (c: GeometricConstraint) => {
    const r = m.add(c, d.lookup);
    if (!r.ok) throw new Error(`${c.kind} refused: ${r.reason} ${r.message}`);
    d.apply(r.updated);
    return r;
  };
  /** Sets a parameter's expression, which must be accepted, and applies what it moves. */
  const set = (name: string, expression: string) => {
    const r = m.setExpression(name, expression, d.lookup);
    if (!r.ok) throw new Error(`${name} = ${expression} refused: ${r.reason} ${r.message}`);
    d.apply(r.updated);
    return r;
  };
  return { d, m, add, geometric, set };
}

const deg = Math.PI / 180;
const lineLength = (d: Drawing, h: Handle) => {
  const g = d.geom(h, 'LINE');
  return len(g.start, g.end);
};
const angleOf = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);

describe('dimensional constraint kinds', () => {
  it("lists AutoCAD's dimensional constraints in DIMCONSTRAINT's prompt order", () => {
    expect(DIMENSIONAL_KINDS).toEqual([
      'linear',
      'horizontal',
      'vertical',
      'aligned',
      'angular',
      'radial',
      'diameter',
    ]);
  });
});

describe('parameters', () => {
  it('names each kind as AutoCAD does and takes the measured value when no expression is given', () => {
    const { d, m, add } = setup();
    const l = d.line(0, 0, 10, 3);
    const l2 = d.line(0, 10, 10, 13);
    const c = d.circle(20, 0, 2);
    const a = d.arc(40, 0, 5, 0, 90);
    const r1 = add(dim('horizontal', [pt(l, 'start'), pt(l, 'end')]));
    const r2 = add(dim('vertical', [curve(l)]));
    const r3 = add(dim('aligned', [curve(l2)]));
    const r4 = add(dim('radial', [curve(c)]));
    const r5 = add(dim('diameter', [curve(a)]));
    const r6 = add(dim('angular', [curve(a)]));
    expect([r1, r2, r3, r4, r5, r6].map((r) => r.parameter)).toEqual([
      'd1',
      'd2',
      'd3',
      'rad1',
      'dia1',
      'ang1',
    ]);
    for (const r of [r1, r2, r3, r4, r5, r6]) expect(r.updated).toEqual([]);
    const rows = m.parameters.rows();
    expect(rows.map((r) => [r.name, r.value, r.type, r.kind])).toEqual([
      ['d1', 10, 'Horizontal', 'constraint'],
      ['d2', 3, 'Vertical', 'constraint'],
      ['d3', expect.closeTo(Math.hypot(10, 3), 9), 'Aligned', 'constraint'],
      ['rad1', 2, 'Radial', 'constraint'],
      ['dia1', 10, 'Diameter', 'constraint'],
      ['ang1', expect.closeTo(90, 9), 'Angular', 'constraint'],
    ]);
    expect(m.dimensions.map((x) => x.parameter)).toEqual([
      'd1',
      'd2',
      'd3',
      'rad1',
      'dia1',
      'ang1',
    ]);
    expect(m.dimensionsOn(l).map((x) => x.parameter)).toEqual(['d1', 'd2']);
    // The geometric list is untouched by dimensional constraints.
    expect(m.constraints).toEqual([]);
  });

  it('takes a name and expression typed at the prompt (name = expression)', () => {
    const { d, m, add } = setup();
    m.parameters.add({ name: 'width', expression: '8' });
    const l = d.line(0, 0, 10, 0);
    const r = add(dim('horizontal', [curve(l)], { parameter: 'len', expression: 'width*2' }));
    expect(r.parameter).toBe('len');
    expect(m.parameters.get('len')).toMatchObject({ expression: 'width*2', value: 16 });
    nearPt(d.geom(l, 'LINE').start, { x: 0, y: 0 });
    nearPt(d.geom(l, 'LINE').end, { x: 16, y: 0 });
  });

  it('refuses a name already taken, an expression without a value, and a value out of range', () => {
    const { d, m } = setup();
    const l = d.line(0, 0, 10, 0);
    const c = d.circle(0, 0, 3);
    m.parameters.add({ name: 'd1', expression: '4' });
    const cases: DimensionSpec[] = [
      dim('aligned', [curve(l)], { parameter: 'd1' }),
      dim('aligned', [curve(l)], { expression: 'nope + 1' }),
      dim('aligned', [curve(l)], { expression: '0' }),
      dim('radial', [curve(c)], { expression: '-2' }),
      dim('angular', [curve(l), curve(l)]),
    ];
    for (const spec of cases) {
      const r = m.addDimension(spec, d.lookup);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    }
    expect(m.parameters.rows().map((r) => r.name)).toEqual(['d1']);
    expect(m.dimensions).toEqual([]);
  });

  it('refuses objects it cannot measure', () => {
    const { d, m } = setup();
    const p = d.point(1, 1);
    const c = d.circle(0, 0, 3);
    const e = d.add({
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 4, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    } as never);
    const bad = [
      dim('radial', [pt(p, 'position')]),
      dim('horizontal', [curve(c)]),
      dim('aligned', [pt(p, 'position'), pt(p, 'position')]),
      dim('radial', [curve(e)]),
    ];
    for (const spec of bad) expect(m.addDimension(spec, d.lookup).ok).toBe(false);
    expect(m.parameters.rows()).toEqual([]);
  });
});

describe('linear constraints', () => {
  it('Horizontal between two points keeps the first and moves the second along X', () => {
    const { d, add, set } = setup();
    const l = d.line(0, 0, 10, 3);
    add(dim('horizontal', [pt(l, 'start'), pt(l, 'end')]));
    set('d1', '12');
    const g = d.geom(l, 'LINE');
    nearPt(g.start, { x: 0, y: 0 });
    nearPt(g.end, { x: 12, y: 3 });
  });

  it('Vertical on a line keeps its direction: a line running down stays running down', () => {
    const { d, add, set } = setup();
    const l = d.line(0, 10, 1, 4);
    const r = add(dim('vertical', [curve(l)]));
    expect(r.value).toBeCloseTo(6, 9);
    set('d1', '8');
    const g = d.geom(l, 'LINE');
    nearPt(g.start, { x: 0, y: 10 });
    nearPt(g.end, { x: 1, y: 2 });
  });

  it('Linear picks Horizontal or Vertical from the points, as DCLINEAR does without a dimension line location', () => {
    const { d, m, add } = setup();
    const wide = d.line(0, 0, 10, 2);
    const tall = d.line(20, 0, 22, 9);
    add(dim('linear', [curve(wide)]));
    add(dim('linear', [curve(tall)]));
    expect(m.dimensions.map((x) => x.dimension)).toEqual(['horizontal', 'vertical']);
    expect(m.parameters.rows().map((r) => [r.name, r.value])).toEqual([
      ['d1', 10],
      ['d2', 9],
    ]);
  });

  it('Aligned between two points keeps the first and moves the second along their line', () => {
    const { d, add, set } = setup();
    const a = d.point(1, 1);
    const b = d.point(4, 5);
    add(dim('aligned', [pt(a, 'position'), pt(b, 'position')]));
    set('d1', '10');
    nearPt(d.geom(a, 'POINT').position, { x: 1, y: 1 });
    nearPt(d.geom(b, 'POINT').position, { x: 7, y: 9 });
  });

  it("Aligned on a line sets its length from its start; on a polyline segment, from the segment's first vertex", () => {
    const { d, add, set } = setup();
    const l = d.line(2, 2, 5, 6);
    const p = d.polyline([
      [0, 20],
      [10, 20],
      [10, 30],
    ]);
    add(dim('aligned', [curve(l)]));
    add(dim('aligned', [curve(p, 1)]));
    set('d1', '10');
    set('d2', '4');
    const g = d.geom(l, 'LINE');
    nearPt(g.start, { x: 2, y: 2 });
    nearPt(g.end, { x: 8, y: 10 });
    const v = d.geom(p, 'LWPOLYLINE').vertices;
    nearPt(v[0]!, { x: 0, y: 20 });
    nearPt(v[1]!, { x: 10, y: 20 });
    nearPt(v[2]!, { x: 10, y: 24 });
  });

  it('Aligned from a point to a line keeps the point and moves the line parallel', () => {
    const { d, add, set } = setup();
    const p = d.point(0, 0);
    const l = d.line(-5, 3, 5, 3);
    const r = add(dim('aligned', [pt(p, 'position'), curve(l)]));
    expect(r.value).toBeCloseTo(3, 9);
    set('d1', '7');
    nearPt(d.geom(p, 'POINT').position, { x: 0, y: 0 });
    const g = d.geom(l, 'LINE');
    near(g.start.y, 7);
    near(g.end.y, 7);
    near(len(g.start, g.end), 10);
  });

  it('Aligned between two lines makes the second parallel to the first at the distance', () => {
    const { d, add } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(0, 4, 10, 6);
    add(dim('aligned', [curve(a), curve(b)], { expression: '5' }));
    const ga = d.geom(a, 'LINE');
    nearPt(ga.start, { x: 0, y: 0 });
    nearPt(ga.end, { x: 10, y: 0 });
    const gb = d.geom(b, 'LINE');
    near(gb.start.y, 5);
    near(gb.end.y, 5);
  });
});

describe('angular, radial and diameter constraints', () => {
  it('Angular between two lines measures the angle between them as drawn and turns the second about the corner', () => {
    const { d, add, set } = setup();
    const a = d.line(0, 0, 10, 0);
    const b = d.line(5, 5, 0, 0); // runs into the corner: the angle is still 45°
    const r = add(dim('angular', [curve(a), curve(b)]));
    expect(r.parameter).toBe('ang1');
    expect(r.value).toBeCloseTo(45, 9);
    set('ang1', '60');
    const ga = d.geom(a, 'LINE');
    nearPt(ga.start, { x: 0, y: 0 });
    nearPt(ga.end, { x: 10, y: 0 });
    const gb = d.geom(b, 'LINE');
    nearPt(gb.end, { x: 0, y: 0 });
    near(angleOf(gb.end, gb.start), 60 * deg);
    near(len(gb.start, gb.end), Math.hypot(5, 5));
  });

  it('Angular between lines that do not meet measures at their extensions crossing', () => {
    const { d, add } = setup();
    const a = d.line(2, 0, 10, 0);
    const b = d.line(-1, 1, -3, 3); // its extension meets a's at the origin: 135°
    const r = add(dim('angular', [curve(a), curve(b)]));
    expect(r.value).toBeCloseTo(135, 9);
  });

  it('Angular on an arc sets its included angle from its start', () => {
    const { d, add, set } = setup();
    const a = d.arc(0, 0, 5, 30, 120);
    const r = add(dim('angular', [curve(a)]));
    expect(r.value).toBeCloseTo(90, 9);
    set('ang1', '45');
    const g = d.geom(a, 'ARC');
    nearPt(g.center, { x: 0, y: 0 });
    near(g.radius, 5);
    near(g.startAngle, 30 * deg);
    near(g.endAngle, 75 * deg);
  });

  it('Angular by three points (vertex, first, second) turns the second point about the vertex', () => {
    const { d, add, set } = setup();
    const v = d.point(1, 1);
    const p = d.point(5, 1);
    const q = d.point(1, 4);
    const r = add(dim('angular', [pt(v, 'position'), pt(p, 'position'), pt(q, 'position')]));
    expect(r.value).toBeCloseTo(90, 9);
    set('ang1', '30');
    nearPt(d.geom(v, 'POINT').position, { x: 1, y: 1 });
    nearPt(d.geom(p, 'POINT').position, { x: 5, y: 1 });
    const gq = d.geom(q, 'POINT').position;
    near(angleOf({ x: 1, y: 1 }, gq), 30 * deg);
    near(len({ x: 1, y: 1 }, gq), 3);
  });

  it('Radius and Diameter keep the centre', () => {
    const { d, add, set } = setup();
    const c = d.circle(3, 4, 2);
    const a = d.arc(10, 0, 1, 0, 180);
    add(dim('radial', [curve(c)]));
    add(dim('diameter', [curve(a)]));
    set('rad1', '5');
    set('dia1', '6');
    const gc = d.geom(c, 'CIRCLE');
    nearPt(gc.center, { x: 3, y: 4 });
    near(gc.radius, 5);
    const ga = d.geom(a, 'ARC');
    nearPt(ga.center, { x: 10, y: 0 });
    near(ga.radius, 3);
    near(ga.startAngle, 0);
    near(ga.endAngle, Math.PI);
  });

  it("Radius on a polyline's arc segment changes its bulge, the segment's first vertex staying", () => {
    const { d, add, set } = setup();
    // A half circle of radius 5 from (0,0) to (10,0), then a line.
    const p = d.polyline([
      [0, 0, 1],
      [10, 0],
      [10, -5],
    ]);
    const r = add(dim('radial', [curve(p, 0)]));
    expect(r.value).toBeCloseTo(5, 9);
    set('rad1', '6');
    const v = d.geom(p, 'LWPOLYLINE').vertices;
    nearPt(v[0]!, { x: 0, y: 0 });
    // The arc segment now has radius 6.
    const chord = len(v[0]!, v[1]!);
    const sweep = 4 * Math.atan(v[0]!.bulge);
    near(chord / (2 * Math.abs(Math.sin(sweep / 2))), 6);
  });
});

describe('expressions drive geometry', () => {
  it('a user parameter drives every constraint whose expression names it', () => {
    const { d, m, add, set } = setup();
    m.parameters.add({ name: 'size', expression: '4' });
    const c1 = d.circle(0, 0, 1);
    const c2 = d.circle(10, 0, 1);
    add(dim('radial', [curve(c1)], { expression: 'size' }));
    add(dim('diameter', [curve(c2)], { expression: 'size * 3' }));
    near(d.geom(c1, 'CIRCLE').radius, 4);
    near(d.geom(c2, 'CIRCLE').radius, 6);
    const r = set('size', '2');
    expect(r.parameters).toEqual(['size', 'rad1', 'dia1']);
    near(d.geom(c1, 'CIRCLE').radius, 2);
    near(d.geom(c2, 'CIRCLE').radius, 3);
    nearPt(d.geom(c2, 'CIRCLE').center, { x: 10, y: 0 });
  });

  it('works with geometric constraints: a rectangle sized by two parameters', () => {
    const { d, m, add, geometric, set } = setup();
    const p = d.polyline(
      [
        [0, 0],
        [9, 0.5],
        [9.5, 4],
        [-0.5, 3.5],
      ],
      true,
    );
    geometric(con('fix', pt(p, 'vertex', 0)));
    geometric(con('horizontal', curve(p, 0)));
    geometric(con('perpendicular', curve(p, 0), curve(p, 1)));
    geometric(con('parallel', curve(p, 0), curve(p, 2)));
    geometric(con('parallel', curve(p, 1), curve(p, 3)));
    add(dim('horizontal', [curve(p, 0)], { parameter: 'width', expression: '12' }));
    add(dim('vertical', [curve(p, 1)], { parameter: 'height', expression: 'width / 2' }));
    expect(m.diagnose(d.lookup)).toMatchObject({ ok: true, dofs: 0 });
    let v = d.geom(p, 'LWPOLYLINE').vertices;
    nearPt(v[0]!, { x: 0, y: 0 });
    nearPt(v[1]!, { x: 12, y: 0 });
    nearPt(v[2]!, { x: 12, y: 6 });
    nearPt(v[3]!, { x: 0, y: 6 });
    set('width', '20');
    v = d.geom(p, 'LWPOLYLINE').vertices;
    nearPt(v[2]!, { x: 20, y: 10 });
    nearPt(v[3]!, { x: 0, y: 10 });
  });

  it('refuses a value the geometry cannot take, leaving the table and the drawing as they were', () => {
    const { d, m, add, geometric } = setup();
    const base = d.line(0, 0, 10, 0);
    const p = d.point(4, 3);
    geometric(con('fix', curve(base)));
    add(dim('aligned', [pt(base, 'start'), pt(p, 'position')], { expression: '5' }));
    add(dim('aligned', [pt(base, 'end'), pt(p, 'position')], { expression: '7' }));
    const before = d.geom(p, 'POINT').position;
    const r = m.setExpression('d1', '1', d.lookup); // 1 + 7 < 10: no triangle
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('overconstrained');
    expect(m.parameters.get('d1')).toMatchObject({ expression: '5', value: 5 });
    nearPt(d.geom(p, 'POINT').position, before);
  });

  it('refuses an expression that puts a driving value out of range', () => {
    const { d, m, add } = setup();
    m.parameters.add({ name: 'k', expression: '2' });
    const c = d.circle(0, 0, 1);
    add(dim('radial', [curve(c)], { expression: 'k' }));
    const r = m.setExpression('k', '-1', d.lookup);
    expect(r.ok).toBe(false);
    expect(m.parameters.value('k')).toBe(2);
  });

  it('refuses an over-constraining dimension, keeping no parameter for it', () => {
    const { d, m, add, geometric } = setup();
    const l = d.line(0, 0, 10, 0);
    geometric(con('fix', curve(l)));
    const r = m.addDimension(dim('aligned', [curve(l)], { expression: '12' }), d.lookup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('overconstrained');
    expect(m.parameters.rows()).toEqual([]);
    const same = m.addDimension(dim('aligned', [curve(l)]), d.lookup);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.reason).toBe('redundant');
    expect(add).toBeDefined();
  });
});

describe('reference parameters', () => {
  it('a redundant dimension can be made a reference: it measures and follows the geometry', () => {
    const { d, m, add, geometric, set } = setup();
    const l = d.line(0, 0, 10, 0);
    geometric(con('horizontal', curve(l)));
    add(dim('aligned', [curve(l)]));
    const refused = m.addDimension(dim('horizontal', [curve(l)]), d.lookup);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('redundant');
    const r = add(dim('horizontal', [curve(l)], { reference: true }));
    expect(r.parameter).toBe('d2');
    expect(m.parameters.get('d2')).toMatchObject({ value: 10, type: 'Horizontal' });
    const changed = set('d1', '14');
    expect(changed.parameters).toEqual(['d1', 'd2']);
    expect(m.parameters.value('d2')).toBeCloseTo(14, 9);
  });

  it('is read only, and no driving expression may follow from it', () => {
    const { d, m, add } = setup();
    const c = d.circle(0, 0, 2);
    const e = d.circle(10, 0, 1);
    add(dim('radial', [curve(c)], { reference: true }));
    const ro = m.setExpression('rad1', '3', d.lookup);
    expect(ro.ok).toBe(false);
    m.parameters.add({ name: 'twice', expression: 'rad1 * 2' });
    const driving = m.addDimension(dim('radial', [curve(e)], { expression: 'twice' }), d.lookup);
    expect(driving.ok).toBe(false);
    if (!driving.ok) expect(driving.message).toMatch(/reference/);
    const ok = add(dim('radial', [curve(e)], { expression: '1.5' }));
    const via = m.setExpression(ok.parameter, 'twice', d.lookup);
    expect(via.ok).toBe(false);
    expect(m.parameters.get('rad2')?.expression).toBe('1.5');
  });

  it('follows geometric constraints and edits', () => {
    const { d, m, add, geometric } = setup();
    const a = d.circle(0, 0, 4);
    const b = d.circle(10, 0, 1);
    add(dim('radial', [curve(b)], { reference: true }));
    const r = geometric(con('equal', curve(a), curve(b)));
    expect(r.parameters).toEqual(['rad1']);
    expect(m.parameters.value('rad1')).toBeCloseTo(4, 9);
    const edit = m.solveEdit([d.edit(b, { radius: 6 })], d.lookup);
    expect(edit.ok).toBe(true);
    if (edit.ok) {
      d.apply(edit.updated);
      expect(edit.parameters).toEqual(['rad1']);
    }
    expect(m.parameters.value('rad1')).toBeCloseTo(6, 9);
  });

  // M9-03 part 10: the Properties palette's Reference row (AutoCAD 2024 Help, "About Applying
  // Dimensional Constraints": "You can set the Reference property in the Properties palette to
  // convert a dynamic or annotational constraint to a reference parameter … You cannot change a
  // reference parameter back to a dimensional constraint if doing so would overconstrain the
  // geometry").
  it('setReference makes a driving constraint measure, and back while it fits', () => {
    const { d, m, add, set } = setup();
    const l = d.line(0, 0, 10, 0);
    const r = add(dim('aligned', [curve(l)], { expression: '12' }));
    expect(lineLength(d, l)).toBeCloseTo(12, 9);
    const on = m.setReference(r.constraint.handle, true, d.lookup);
    expect(on).toMatchObject({ ok: true, updated: [], parameters: ['d1'] });
    expect(m.dimensions[0]!.reference).toBe(true);
    // Its expression is the measured value, and it no longer drives.
    expect(m.parameters.get('d1')?.expression).toBe('12');
    expect(m.setExpression('d1', '20', d.lookup).ok).toBe(false);
    const back = m.setReference(r.constraint.handle, false, d.lookup);
    expect(back.ok).toBe(true);
    expect(m.dimensions[0]!.reference).toBeUndefined();
    set('d1', '15');
    expect(lineLength(d, l)).toBeCloseTo(15, 9);
  });

  it('setReference refuses a driving constraint back that would over-constrain', () => {
    const { d, m, add, geometric } = setup();
    const l = d.line(0, 0, 10, 0);
    geometric(con('horizontal', curve(l)));
    add(dim('aligned', [curve(l)]));
    const ref = add(dim('horizontal', [curve(l)], { reference: true }));
    const back = m.setReference(ref.constraint.handle, false, d.lookup);
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.message).toMatch(/over-constrain/);
    expect(m.dimensions.find((c) => c.parameter === 'd2')?.reference).toBe(true);
  });

  it('setReference refuses a constraint a driving expression follows from', () => {
    const { d, m, add } = setup();
    const a = d.circle(0, 0, 2);
    const b = d.circle(10, 0, 1);
    const ra = add(dim('radial', [curve(a)]));
    add(dim('radial', [curve(b)], { expression: 'rad1 / 2' }));
    const r = m.setReference(ra.constraint.handle, true, d.lookup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/rad2/);
    expect(m.dimensions[0]!.reference).toBeUndefined();
    expect(m.parameters.get('rad1')?.expression).toBe('2');
  });

  it('setReference to what it is already changes nothing', () => {
    const { d, m, add } = setup();
    const l = d.line(0, 0, 10, 0);
    const r = add(dim('aligned', [curve(l)]));
    expect(m.setReference(r.constraint.handle, false, d.lookup)).toEqual({
      ok: true,
      updated: [],
      parameters: [],
    });
    expect(m.setReference('FFFF', true, d.lookup).ok).toBe(false);
  });

  it('measures with measureDimension', () => {
    const { d } = setup();
    const l = d.line(0, 0, 3, 4);
    expect(measureDimension({ dimension: 'aligned', refs: [curve(l)] }, d.lookup)).toEqual({
      ok: true,
      dimension: 'aligned',
      value: 5,
    });
  });
});

describe('editing, removing and renaming', () => {
  it('an edit keeps driving dimensions: the dragged end stays and the other follows', () => {
    const { d, m, add } = setup();
    const l = d.line(0, 0, 10, 0);
    add(dim('aligned', [curve(l)]));
    const r = m.solveEdit([d.edit(l, { end: { x: 20, y: 0 } })], d.lookup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d.apply(r.updated);
    const g = d.geom(l, 'LINE');
    nearPt(g.end, { x: 20, y: 0 });
    near(len(g.start, g.end), 10);
  });

  it('remove deletes the parameter; expressions that named it keep its value', () => {
    const { d, m, add } = setup();
    const a = d.circle(0, 0, 2);
    const b = d.circle(10, 0, 1);
    const ra = add(dim('radial', [curve(a)]));
    add(dim('radial', [curve(b)], { expression: 'rad1 + 1' }));
    const h = m.dimensions[0]!.handle;
    expect(ra.parameter).toBe('rad1');
    expect(m.remove(h)).toBe(true);
    expect(m.dimensions.map((x) => x.parameter)).toEqual(['rad2']);
    expect(m.parameters.rows().map((r) => [r.name, r.expression])).toEqual([['rad2', '3']]);
  });

  it('renaming a parameter renames it in the constraint and in every expression', () => {
    const { d, m, add } = setup();
    const a = d.circle(0, 0, 2);
    const b = d.circle(10, 0, 1);
    add(dim('radial', [curve(a)]));
    add(dim('radial', [curve(b)], { expression: 'rad1 / 2' }));
    const r = m.renameParameter('rad1', 'hole');
    expect(r.ok).toBe(true);
    expect(m.dimensions.map((x) => x.parameter)).toEqual(['hole', 'rad2']);
    expect(m.parameters.get('rad2')?.expression).toBe('hole / 2');
    expect(m.renameParameter('rad2', 'hole').ok).toBe(false);
  });

  it('diagnose counts the degrees of freedom dimensional constraints take', () => {
    const { d, m, add, geometric } = setup();
    const l = d.line(0, 0, 10, 0);
    geometric(con('horizontal', curve(l)));
    add(dim('aligned', [curve(l)]));
    expect(m.diagnose(d.lookup)).toMatchObject({ ok: true, dofs: 2 });
    add(dim('vertical', [pt(l, 'start'), pt(d.point(0, 5), 'position')], { reference: true }));
    // A reference constraint takes none.
    expect(m.diagnose(d.lookup)).toMatchObject({ ok: true, dofs: 2 });
  });

  it('loads dimensional constraints with a table as a drawing stores them', () => {
    const { d } = setup();
    const c = d.circle(0, 0, 3);
    const table = ParameterTable.load([
      { name: 'rad1', expression: '3', kind: 'constraint', type: 'Radial' },
    ]);
    const m = new ConstraintModel(gcs, toleranceForSize(100), table);
    m.loadDimensions([{ handle: 'AB', dimension: 'radial', refs: [curve(c)], parameter: 'rad1' }]);
    expect(m.parameters).toBe(table);
    expect(m.dimensionsOn(c as Handle).map((x) => x.handle)).toEqual(['AB']);
    expect(m.diagnose(d.lookup)).toMatchObject({ ok: true, dofs: 2 });
    const r = m.setExpression('rad1', '4', d.lookup);
    expect(r.ok).toBe(true);
    if (r.ok) d.apply(r.updated);
    near(d.geom(c, 'CIRCLE').radius, 4);
  });
});
