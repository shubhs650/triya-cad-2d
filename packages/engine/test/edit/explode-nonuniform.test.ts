// M3-12 part 7: EXPLODE of a block reference scaled differently in X and Y (`edit/explode.ts`), as
// AutoCAD 2024 explodes one (AutoCAD Help, "EXPLODE (Command)": "Arc: If within a nonuniformly
// scaled block, explodes into elliptical arcs", "Circle: If within a nonuniformly scaled block,
// explodes into ellipses", "When nonuniformly scaled blocks contain objects that cannot be
// exploded, they are collected into an anonymous block (named with a "*E" prefix) and referenced
// with the nonuniform scaling. If all the objects in such a block cannot be exploded, the
// selected block reference will not be exploded"; ObjectARX Developer's Guide, "Exploding
// Entities", lists what each object becomes in a nonuniformly scaled block).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  explodeObjects,
  type Entity,
  type EntityGeometry,
  type HeaderValue,
} from '../../src/index';
import {
  blockRecord,
  entityInit,
  LAYER_0,
  LAYER_WALLS,
  layer,
  lineGeom,
  MODEL_SPACE,
} from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const PARTS = '50';
const NESTED = '51';
const ONLY_TEXT = '52';
const STYLE = '11';

const text = (extra: Record<string, unknown> = {}) =>
  ({
    kind: 'TEXT',
    value: 'A',
    style: STYLE,
    position: { x: 0, y: 1 },
    height: 0.5,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
    ...extra,
  }) as EntityGeometry;

const mtext = {
  kind: 'MTEXT',
  contents: 'NOTE',
  style: STYLE,
  position: { x: 0, y: 2 },
  height: 0.5,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
} as EntityGeometry;

const insert = (block: string, extra: Record<string, unknown> = {}): EntityGeometry =>
  ({
    kind: 'INSERT',
    block,
    position: { x: 100, y: 0 },
    scale: { x: 2, y: 1, z: 1 },
    rotation: 0,
    attributes: [],
    ...extra,
  }) as EntityGeometry;

/**
 * Block PARTS holds a line on layer 0 drawn ByBlock, a circle, an arc, a spline, a straight
 * polyline, a polyline with an arc, a point, a solid, a text, an MTEXT, a reference to NESTED
 * (a circle), a text turned 45° and a turned reference to NESTED; ONLY_TEXT holds an MTEXT. Model space holds `extra`, on WALLS.
 */
function setup(extra: EntityGeometry[]) {
  const model = DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '200',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0'), layer(LAYER_WALLS, 'WALLS')],
      blockRecords: [
        blockRecord(MODEL_SPACE, '*Model_Space'),
        blockRecord(PARTS, 'PARTS'),
        blockRecord(NESTED, 'NESTED'),
        blockRecord(ONLY_TEXT, 'ONLY_TEXT'),
      ],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: PARTS, name: 'PARTS', basePoint: { x: 0, y: 0 } },
      { handle: NESTED, name: 'NESTED', basePoint: { x: 0, y: 0 } },
      { handle: ONLY_TEXT, name: 'ONLY_TEXT', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [
      entityInit('60', lineGeom(0, 0, 1, 0), { owner: PARTS, color: { kind: 'byBlock' } }),
      entityInit('61', { kind: 'CIRCLE', center: { x: 1, y: 0 }, radius: 0.5 }, { owner: PARTS }),
      entityInit(
        '62',
        { kind: 'ARC', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI / 2 },
        { owner: PARTS },
      ),
      entityInit(
        '63',
        {
          kind: 'SPLINE',
          degree: 2,
          knots: [0, 0, 0, 1, 1, 1],
          controlPoints: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 0 },
          ],
          closed: false,
          periodic: false,
        },
        { owner: PARTS },
      ),
      entityInit(
        '64',
        {
          kind: 'LWPOLYLINE',
          closed: true,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 1, y: 0, bulge: 0 },
            { x: 1, y: 1, bulge: 0 },
          ],
        },
        { owner: PARTS },
      ),
      entityInit(
        '65',
        {
          kind: 'LWPOLYLINE',
          closed: false,
          vertices: [
            { x: 0, y: 0, bulge: 1 },
            { x: 1, y: 0, bulge: 0 },
          ],
        },
        { owner: PARTS },
      ),
      entityInit('66', { kind: 'POINT', position: { x: 1, y: 1 } }, { owner: PARTS }),
      entityInit(
        '67',
        {
          kind: 'SOLID',
          corners: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
        { owner: PARTS },
      ),
      entityInit('68', text(), { owner: PARTS }),
      entityInit('69', mtext, { owner: PARTS }),
      entityInit('6A', insert(NESTED, { position: { x: 3, y: 0 }, scale: { x: 1, y: 1, z: 1 } }), {
        owner: PARTS,
      }),
      entityInit('6B', text({ rotation: Math.PI / 4 }), { owner: PARTS }),
      entityInit(
        '6C',
        insert(NESTED, { position: { x: 3, y: 3 }, scale: { x: 1, y: 1, z: 1 }, rotation: 1 }),
        { owner: PARTS },
      ),
      entityInit('70', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, { owner: NESTED }),
      entityInit('71', mtext, { owner: ONLY_TEXT }),
      ...extra.map((g, i) =>
        entityInit((0x80 + i).toString(16).toUpperCase(), g, { layer: LAYER_WALLS }),
      ),
    ],
  });
  const explode = () => {
    const b = new ChangeSetBuilder(model);
    const r = explodeObjects(b, model, model.blockEntities(MODEL_SPACE));
    model.apply(b.build());
    return r;
  };
  const space = (): Entity[] => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  return { model, explode, space };
}

const pt = (p: { x: number; y: number }) => [r6(p.x), r6(p.y)];

describe('EXPLODE of nonuniformly scaled block references', () => {
  it('turns circles and arcs into ellipses and carries the rest by the scale', () => {
    const { explode, space } = setup([insert(PARTS)]);
    const r = explode();
    expect(r.exploded).toBe(1);
    expect(r.refused.size).toBe(0);
    const made = space();
    expect(made.map((e) => e.geom.kind)).toEqual([
      'LINE',
      'ELLIPSE',
      'ELLIPSE',
      'SPLINE',
      'LWPOLYLINE',
      'POINT',
      'SOLID',
      'TEXT',
      'INSERT',
      'INSERT',
    ]);
    const [line, circle, arc, spline, pline, point, solid, txt] = made.map((e) => e.geom) as [
      Extract<EntityGeometry, { kind: 'LINE' }>,
      Extract<EntityGeometry, { kind: 'ELLIPSE' }>,
      Extract<EntityGeometry, { kind: 'ELLIPSE' }>,
      Extract<EntityGeometry, { kind: 'SPLINE' }>,
      Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>,
      Extract<EntityGeometry, { kind: 'POINT' }>,
      Extract<EntityGeometry, { kind: 'SOLID' | 'TRACE' }>,
      Extract<EntityGeometry, { kind: 'TEXT' }>,
    ];
    expect([...pt(line.start), ...pt(line.end)]).toEqual([100, 0, 102, 0]);
    // The circle (1,0) r 0.5 at 2 × 1: an ellipse 2 by 1 round (102,0), whole.
    expect(pt(circle.center)).toEqual([102, 0]);
    expect(pt(circle.majorAxis)).toEqual([1, 0]);
    expect(r6(circle.ratio)).toBe(0.5);
    expect(r6(circle.endParam - circle.startParam)).toBe(r6(2 * Math.PI));
    // The quarter arc r 1: a quarter of the ellipse 4 by 2 round the insertion point.
    expect(pt(arc.center)).toEqual([100, 0]);
    expect(pt(arc.majorAxis)).toEqual([2, 0]);
    expect(r6(arc.ratio)).toBe(0.5);
    expect([r6(arc.startParam), r6(arc.endParam)]).toEqual([0, r6(Math.PI / 2)]);
    expect(spline.controlPoints.map(pt)).toEqual([
      [100, 0],
      [102, 1],
      [104, 0],
    ]);
    expect(pline.vertices.map(pt)).toEqual([
      [100, 0],
      [102, 0],
      [102, 1],
    ]);
    expect(pline.closed).toBe(true);
    expect(pt(point.position)).toEqual([102, 1]);
    expect(solid.corners.map(pt)).toEqual([
      [100, 0],
      [102, 0],
      [100, 1],
      [102, 1],
    ]);
    // Text along the stretched axis keeps its height and is twice as wide.
    expect(pt(txt.position)).toEqual([100, 1]);
    expect([r6(txt.height), r6(txt.widthFactor), r6(txt.rotation)]).toEqual([0.5, 2, 0]);
    // The nested reference stays a reference, now scaled 2 × 1 itself (one level at a time).
    const nested = made[8]!.geom as Extract<EntityGeometry, { kind: 'INSERT' }>;
    expect([nested.block, ...pt(nested.position), r6(nested.rotation)]).toEqual([
      NESTED,
      106,
      0,
      0,
    ]);
    expect(nested.scale).toEqual({ x: 2, y: 1, z: 1 });
    // The pieces keep their own layer and colour, as a uniform explode's do.
    expect(made[0]).toMatchObject({ layer: LAYER_0, color: { kind: 'byBlock' } });
  });

  it('collects what cannot be scaled so into a *E block referenced at the scale', () => {
    const { model, explode, space } = setup([insert(PARTS, { rotation: Math.PI / 6 })]);
    explode();
    const e = space().at(-1)!;
    const g = e.geom as Extract<EntityGeometry, { kind: 'INSERT' }>;
    expect(e.layer).toBe(LAYER_WALLS);
    expect(pt(g.position)).toEqual([100, 0]);
    expect(g.scale).toEqual({ x: 2, y: 1, z: 1 });
    expect(r6(g.rotation)).toBe(r6(Math.PI / 6));
    const def = model.blocks.get(g.block)!;
    expect(def.name).toBe('*E1');
    expect(pt(def.basePoint)).toEqual([0, 0]);
    // The polyline with an arc, the MTEXT, and the text and reference turned out of square with
    // the scale's axes, as they were in the block.
    expect(model.blockEntities(g.block).map((id) => model.entity(id)!.geom.kind)).toEqual([
      'LWPOLYLINE',
      'MTEXT',
      'TEXT',
      'INSERT',
    ]);
    // The reference in square with the axes comes out turned with the reference.
    const nested = space().at(-2)!.geom as Extract<EntityGeometry, { kind: 'INSERT' }>;
    expect([...pt(nested.position), r6(nested.rotation)]).toEqual([
      r6(100 + 6 * Math.cos(Math.PI / 6)),
      r6(6 * Math.sin(Math.PI / 6)),
      r6(Math.PI / 6),
    ]);
    // The block itself is left as it was.
    expect(model.blockEntities(PARTS)).toHaveLength(13);
  });

  it('turns a circle of a turned reference into an ellipse along the turned axes', () => {
    const { explode, space } = setup([insert(NESTED, { rotation: Math.PI / 2 })]);
    explode();
    const [g] = space().map((e) => e.geom) as [Extract<EntityGeometry, { kind: 'ELLIPSE' }>];
    expect(g.kind).toBe('ELLIPSE');
    expect(pt(g.center)).toEqual([100, 0]);
    // X (scaled 2) turned onto Y: the major axis is vertical, 2 long.
    expect(pt(g.majorAxis).map(Math.abs)).toEqual([0, 2]);
    expect(r6(g.ratio)).toBe(0.5);
  });

  it('keeps the reference when nothing in the block can be exploded at its scale', () => {
    const { explode, space } = setup([insert(ONLY_TEXT)]);
    const r = explode();
    expect(r.exploded).toBe(0);
    expect([...r.refused]).toEqual([
      ['nothing in a nonuniformly scaled block reference can be exploded', 1],
    ]);
    expect(space().map((e) => e.geom.kind)).toEqual(['INSERT']);
  });

  it('mirrors through a negative scale (tolerance case: an inch drawing’s tiny scale)', () => {
    const { explode, space } = setup([
      insert(NESTED, { scale: { x: -1 / 25.4, y: 2 / 25.4, z: 1 } }),
    ]);
    explode();
    const [g] = space().map((e) => e.geom) as [Extract<EntityGeometry, { kind: 'ELLIPSE' }>];
    expect(g.kind).toBe('ELLIPSE');
    expect(pt(g.center)).toEqual([100, 0]);
    expect(r6(Math.hypot(g.majorAxis.x, g.majorAxis.y))).toBe(r6(2 / 25.4));
    expect(r6(g.ratio)).toBe(0.5);
  });
});
