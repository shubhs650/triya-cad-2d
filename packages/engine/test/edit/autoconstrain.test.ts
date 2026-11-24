// M9-05 part 3: which constraints AUTOCONSTRAIN tries (AutoCAD 2024 Help, "AutoConstrain Tab
// (Constraint Settings Dialog Box)"): the types in the tab's order, those whose Apply is clear
// left out; Distance tolerance for coincident, concentric, tangent and collinear, Angle for
// horizontal, vertical, parallel, perpendicular, tangent and collinear; tangent and perpendicular
// objects sharing a point when the tab's checks say so.
import { describe, expect, it } from 'vitest';
import {
  AUTOCONSTRAIN_DEFAULTS,
  AUTOCONSTRAIN_KINDS,
  autoConstraints,
  autoConstrainSettingsOf,
  createEntity,
  type AutoConstrainKind,
  type AutoConstrainSettings,
  type Entity,
  type EntityGeometry,
} from '../../src/index';
import { circleGeom, lineGeom } from '../model/fixtures';

let next = 1;
const entity = (handle: string, geom: EntityGeometry): Entity =>
  createEntity(next++, {
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

const only = (...kinds: AutoConstrainKind[]): AutoConstrainSettings => ({
  ...AUTOCONSTRAIN_DEFAULTS,
  order: AUTOCONSTRAIN_DEFAULTS.order.map((o) => ({ ...o, apply: kinds.includes(o.kind) })),
});

const kinds = (es: Entity[], s: AutoConstrainSettings = AUTOCONSTRAIN_DEFAULTS) =>
  autoConstraints(es, s).map((c) => `${c.kind} ${c.refs.map((r) => JSON.stringify(r)).join(' ')}`);

describe('autoConstraints (M9-05 part 3)', () => {
  it("offers a rectangle's constraints in the tab's order, each type once per group", () => {
    // A 10 x 5 rectangle of lines, the top's ends 0.01 off the sides'.
    const es = [
      entity('A', lineGeom(0, 0, 10, 0)),
      entity('B', lineGeom(10, 0, 10, 5)),
      entity('C', lineGeom(10.01, 5, 0, 5)),
      entity('D', lineGeom(0, 5, 0, 0)),
    ];
    const out = autoConstraints(es, AUTOCONSTRAIN_DEFAULTS);
    expect(out.map((c) => c.kind)).toEqual([
      'coincident',
      'coincident',
      'coincident',
      'coincident',
      'parallel',
      'parallel',
      'perpendicular',
      'perpendicular',
      'perpendicular',
      'perpendicular',
      'horizontal',
      'horizontal',
      'vertical',
      'vertical',
      'equal',
      'equal',
    ]);
    // Coincident joins each corner's two ends; parallel pairs A with C and B with D.
    expect(out[0]!.refs).toEqual([
      { entity: 'A', point: 'end' },
      { entity: 'B', point: 'start' },
    ]);
    expect(out.filter((c) => c.kind === 'parallel').map((c) => c.refs)).toEqual([
      [{ entity: 'A' }, { entity: 'C' }],
      [{ entity: 'B' }, { entity: 'D' }],
    ]);
  });

  it('leaves out the types not applied, and follows the order the tab gives', () => {
    const es = [entity('A', lineGeom(0, 0, 10, 0)), entity('B', lineGeom(0, 3, 10, 3))];
    expect(autoConstraints(es, only('horizontal')).map((c) => c.kind)).toEqual([
      'horizontal',
      'horizontal',
    ]);
    const reordered: AutoConstrainSettings = {
      ...AUTOCONSTRAIN_DEFAULTS,
      order: [...AUTOCONSTRAIN_DEFAULTS.order].reverse(),
    };
    expect(autoConstraints(es, reordered).map((c) => c.kind)).toEqual([
      'equal',
      'horizontal',
      'horizontal',
      'parallel',
    ]);
  });

  it('works within the distance and angle tolerances', () => {
    // 0.5° off horizontal is within 1°; 2° is not.
    const t = (deg: number) => Math.tan((deg * Math.PI) / 180) * 10;
    const es = [entity('A', lineGeom(0, 0, 10, t(0.5))), entity('B', lineGeom(0, 3, 10, 3 + t(2)))];
    expect(kinds(es, only('horizontal'))).toEqual(['horizontal {"entity":"A"}']);
    expect(kinds(es, { ...only('horizontal'), angle: 3 })).toHaveLength(2);
    // Ends 0.04 apart meet within 0.05, 0.06 apart do not.
    const near = [entity('A', lineGeom(0, 0, 10, 0)), entity('B', lineGeom(10.04, 0, 10, 8))];
    expect(kinds(near, only('coincident'))).toHaveLength(1);
    const far = [entity('A', lineGeom(0, 0, 10, 0)), entity('B', lineGeom(10.06, 0, 10, 8))];
    expect(kinds(far, only('coincident'))).toHaveLength(0);
    expect(kinds(far, { ...only('coincident'), distance: 0.1 })).toHaveLength(1);
  });

  it('makes an end lying on the middle of another object coincident with it', () => {
    const es = [
      entity('A', lineGeom(0, 0, 10, 0)),
      entity('B', lineGeom(4, 0, 4, 6)),
      entity('C', circleGeom(20, 0, 5)),
      entity('D', lineGeom(25, 0, 30, 0)),
    ];
    expect(kinds(es, only('coincident'))).toEqual([
      'coincident {"entity":"A"} {"entity":"B","point":"start"}',
      'coincident {"entity":"C"} {"entity":"D","point":"start"}',
    ]);
  });

  it('tells collinear from parallel lines', () => {
    const es = [
      entity('A', lineGeom(0, 0, 10, 0)),
      entity('B', lineGeom(12, 0.01, 20, 0.01)),
      entity('C', lineGeom(0, 4, 10, 4)),
    ];
    expect(kinds(es, only('collinear', 'parallel'))).toEqual([
      'collinear {"entity":"A"} {"entity":"B"}',
      'parallel {"entity":"A"} {"entity":"C"}',
    ]);
  });

  it('asks perpendicular lines to meet while the check is on', () => {
    const apart = [entity('A', lineGeom(0, 0, 10, 0)), entity('B', lineGeom(20, 1, 20, 9))];
    expect(kinds(apart, only('perpendicular'))).toHaveLength(0);
    expect(kinds(apart, { ...only('perpendicular'), perpendicularTouch: false })).toHaveLength(1);
    // Crossing, or meeting within the distance tolerance, is enough.
    const crossing = [entity('A', lineGeom(0, 0, 10, 0)), entity('B', lineGeom(5, -3, 5, 3))];
    expect(kinds(crossing, only('perpendicular'))).toHaveLength(1);
    const touching = [entity('A', lineGeom(0, 0, 10, 0)), entity('B', lineGeom(5, 0.03, 5, 3))];
    expect(kinds(touching, only('perpendicular'))).toHaveLength(1);
  });

  it('finds lines and circles tangent, touching when the check is on', () => {
    const es = [
      entity('A', lineGeom(-10, 5.02, 10, 5.02)),
      entity('B', circleGeom(0, 0, 5)),
      entity('C', circleGeom(12, 0, 7)),
      entity('D', lineGeom(30, 5, 40, 5)),
    ];
    // A touches B; C touches B outside; D lies along B's tangent but far from it.
    expect(kinds(es, only('tangent'))).toEqual([
      'tangent {"entity":"A"} {"entity":"B"}',
      'tangent {"entity":"B"} {"entity":"C"}',
    ]);
    expect(kinds(es, { ...only('tangent'), tangentTouch: false })).toEqual([
      'tangent {"entity":"A"} {"entity":"B"}',
      'tangent {"entity":"D"} {"entity":"B"}',
      'tangent {"entity":"B"} {"entity":"C"}',
    ]);
    // A circle inside another, touching it.
    const inside = [entity('E', circleGeom(0, 0, 10)), entity('F', circleGeom(6, 0, 4))];
    expect(kinds(inside, only('tangent'))).toHaveLength(1);
  });

  it('groups concentric and equal circles round the first', () => {
    const es = [
      entity('A', circleGeom(0, 0, 5)),
      entity('B', circleGeom(0.01, 0, 3)),
      entity('C', circleGeom(20, 0, 5)),
      entity('D', circleGeom(40, 0, 5.02)),
    ];
    expect(kinds(es, only('concentric', 'equal'))).toEqual([
      'concentric {"entity":"A"} {"entity":"B"}',
      'equal {"entity":"A"} {"entity":"C"}',
      'equal {"entity":"A"} {"entity":"D"}',
    ]);
  });

  it("takes a polyline's segments and vertices", () => {
    const pl = entity('E', {
      kind: 'LWPOLYLINE',
      closed: false,
      constantWidth: 0,
      elevation: 0,
      thickness: 0,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 0, endWidth: 0 },
        { x: 10, y: 0, bulge: 0, startWidth: 0, endWidth: 0 },
        { x: 10, y: 5, bulge: 0, startWidth: 0, endWidth: 0 },
      ],
    } as unknown as EntityGeometry);
    const es = [pl, entity('F', lineGeom(10, 5, 0, 5))];
    expect(kinds(es, only('coincident', 'perpendicular'))).toEqual([
      'coincident {"entity":"E","point":"vertex","index":2} {"entity":"F","point":"start"}',
      'perpendicular {"entity":"E","segment":0} {"entity":"E","segment":1}',
      'perpendicular {"entity":"E","segment":1} {"entity":"F"}',
    ]);
  });

  it('reads settings back, mending what is missing or out of range', () => {
    expect(autoConstrainSettingsOf(undefined)).toBe(AUTOCONSTRAIN_DEFAULTS);
    const s = autoConstrainSettingsOf({
      order: [{ kind: 'equal', apply: false }, { kind: 'bogus' }, { kind: 'equal' }],
      distance: -1,
      angle: 45,
      tangentTouch: false,
    });
    expect(s.order[0]).toEqual({ kind: 'equal', apply: false });
    expect(s.order.map((o) => o.kind).sort()).toEqual([...AUTOCONSTRAIN_KINDS].sort());
    expect(s.distance).toBe(0.05);
    expect(s.angle).toBe(45);
    expect(s.tangentTouch).toBe(false);
    expect(s.perpendicularTouch).toBe(true);
  });
});
