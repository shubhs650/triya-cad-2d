// AcadToTriya for entities (M1-04) on drawings authored in memory with acad-ts: the plan-view
// conversion of DEC-039, which the public corpus does not exercise for every type (it has no
// mirrored arcs, ellipses or bulged polylines). The corpus comparison is in
// packages/testkit/src/mapping/entities.corpus.test.ts.
import {
  ACadVersion,
  Arc,
  BlockRecord,
  CadDocument,
  Circle,
  Color,
  Ellipse,
  Face3D,
  Shape,
  Line,
  LwPolyline,
  LwPolylineVertex,
  PolyfaceMesh,
  Polyline2D,
  Polyline3D,
  Solid,
  Spline,
  Transparency,
  Vertex2D,
  Vertex3D,
  XLine,
  XY,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import type { EntityInit, Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const DOWN = new XYZ(0, 0, -1);

/** acad-ts's SeqendCollection is an Array at run time; its typed `add` does not exist. */
const verticesOf = (p: Polyline2D | Polyline3D): Entity[] => p.vertices as unknown as Entity[];

function mapOne(e: Entity): EntityInit {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.entities?.add(e);
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  return entities[0]!;
}

function unmappedOne(e: Entity) {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.entities?.add(e);
  return mapEntities(doc).unmapped[0];
}

const at = (c: Vec2, r: number, a: number): Vec2 => ({
  x: c.x + r * Math.cos(a),
  y: c.y + r * Math.sin(a),
});
const expectNear = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('common entity properties', () => {
  it('maps layer, colour, linetype, lineweight, transparency and visibility', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const line = new Line(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
    line.color = new Color(10, 20, 30);
    line.lineType = doc.lineTypes!.tryGetValue('ByBlock')!;
    line.lineWeight = 50 as never;
    line.transparency = new Transparency(50);
    line.lineTypeScale = 2;
    line.isInvisible = true;
    doc.entities?.add(line);
    const e = mapEntities(doc).entities[0]!;

    expect(e).toMatchObject({
      type: 'LINE',
      handle: line.handle.toString(16).toUpperCase(),
      owner: doc.modelSpace!.handle.toString(16).toUpperCase(),
      layer: line.layer.handle.toString(16).toUpperCase(),
      color: { kind: 'rgb', r: 10, g: 20, b: 30 },
      linetype: 'ByBlock',
      lineweight: 50,
      transparency: { alpha: 128 },
      ltScale: 2,
      visible: false,
      raw: { handle: line.handle.toString(16).toUpperCase() },
    });
  });

  it('takes the owner from the block record, so block definitions keep their entities', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('PART');
    doc.blockRecords?.add(block);
    block.entities.add(new Circle(new XYZ(0, 0, 0), 1));
    const e = mapEntities(doc).entities.find((x) => x.type === 'CIRCLE')!;

    expect(e.owner).toBe(block.handle.toString(16).toUpperCase());
  });
});

describe('plan view of OCS entities (DEC-039)', () => {
  it('mirrors a −Z circle in X and records its normal and elevation', () => {
    const c = new Circle(new XYZ(3, 4, 2), 1);
    c.normal = DOWN;
    const { geom } = mapOne(c);

    expect(geom).toEqual({
      kind: 'CIRCLE',
      center: { x: -3, y: 4 },
      radius: 1,
      elevation: -2,
      normal: { x: 0, y: 0, z: -1 },
    });
  });

  it('reverses a −Z arc so its ends and middle land where AutoCAD draws them', () => {
    const a = new Arc(new XYZ(1, 0, 0), 2, 0, Math.PI / 2);
    a.normal = DOWN;
    const { geom } = mapOne(a);
    if (geom.kind !== 'ARC') throw new Error(geom.kind);

    // OCS (x, y) is WCS (−x, y): the file's arc from 0° to 90° runs (3,0)→(1,2) in OCS.
    expectNear(at(geom.center, 2, geom.startAngle), { x: -1, y: 2 });
    expectNear(at(geom.center, 2, geom.endAngle), { x: -3, y: 0 });
    const mid = (geom.startAngle + geom.endAngle) / 2;
    expectNear(at(geom.center, 2, mid), { x: -1 - Math.SQRT2, y: Math.SQRT2 });
  });

  it('gives a −Z ellipse the parameters of the same points', () => {
    const el = new Ellipse();
    el.center = new XYZ(0, 0, 0);
    el.majorAxisEndPoint = new XYZ(2, 0, 0);
    el.radiusRatio = 0.5;
    el.startParameter = 0;
    el.endParameter = Math.PI / 2;
    el.normal = DOWN;
    const { geom } = mapOne(el);
    if (geom.kind !== 'ELLIPSE') throw new Error(geom.kind);
    const kernel = (t: number): Vec2 => ({
      x: Math.cos(t) * geom.majorAxis.x - Math.sin(t) * geom.ratio * geom.majorAxis.y,
      y: Math.cos(t) * geom.majorAxis.y + Math.sin(t) * geom.ratio * geom.majorAxis.x,
    });

    // The minor axis is normal × major = (0, −1): the file's t = 90° is (0, −1).
    expectNear(kernel(geom.startParam), { x: 0, y: -1 });
    expectNear(kernel(geom.endParam), { x: 2, y: 0 });
  });

  it('mirrors a −Z lightweight polyline and flips its bulges', () => {
    const p = new LwPolyline();
    const v1 = new LwPolylineVertex(new XY(0, 0));
    v1.bulge = 1;
    p.vertices.push(v1, new LwPolylineVertex(new XY(2, 0)));
    p.normal = DOWN;
    p.elevation = 5;
    const { geom } = mapOne(p);

    expect(geom).toMatchObject({
      kind: 'LWPOLYLINE',
      vertices: [
        { x: -0, y: 0, bulge: -1 },
        { x: -2, y: 0, bulge: -0 },
      ],
      closed: false,
      elevation: -5,
    });
  });

  it('mirrors −Z SOLID corners and keeps their order', () => {
    const s = new Solid();
    s.firstCorner = new XYZ(1, 1, 0);
    s.secondCorner = new XYZ(2, 1, 0);
    s.thirdCorner = new XYZ(1, 2, 0);
    s.fourthCorner = new XYZ(2, 2, 0);
    s.normal = DOWN;
    const { geom } = mapOne(s);

    expect(geom).toMatchObject({
      kind: 'SOLID',
      corners: [
        { x: -1, y: 1 },
        { x: -2, y: 1 },
        { x: -1, y: 2 },
        { x: -2, y: 2 },
      ],
    });
  });

  it('reports a circle on a tilted plane instead of guessing its projection', () => {
    const c = new Circle(new XYZ(0, 0, 0), 1);
    c.normal = new XYZ(0, 1, 1);

    expect(unmappedOne(c)).toMatchObject({ type: 'CIRCLE', reason: 'tilted plane' });
  });
});

describe('WCS entities', () => {
  it('drops Z from spline control points, keeping knots and weights', () => {
    const s = new Spline();
    s.degree = 2;
    s.controlPoints = [new XYZ(0, 0, 1), new XYZ(1, 1, 2), new XYZ(2, 0, 3)];
    s.knots = [0, 0, 0, 1, 1, 1];
    s.weights = [1, 2, 1];
    const { geom } = mapOne(s);

    expect(geom).toMatchObject({
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ],
      weights: [1, 2, 1],
    });
  });

  it('keeps a 3DFACE in plan view with its hidden edges', () => {
    const f = new Face3D();
    f.firstCorner = new XYZ(0, 0, 1);
    f.secondCorner = new XYZ(1, 0, 2);
    f.thirdCorner = new XYZ(1, 1, 3);
    f.fourthCorner = new XYZ(0, 1, 4);
    f.flags = 2 as never;

    expect(mapOne(f).geom).toMatchObject({ kind: '3DFACE', hiddenEdges: 2 });
  });

  it('reports a vertical construction line, which has no plan view', () => {
    const x = new XLine();
    x.direction = new XYZ(0, 0, 1);

    expect(unmappedOne(x)).toMatchObject({ type: 'XLINE', reason: 'no plan view' });
  });
});

describe('heavyweight polylines', () => {
  it('folds 2D vertices in and keeps only the drawn ones of a spline fit', () => {
    const p = new Polyline2D();
    const frame = new Vertex2D(new XYZ(0, 5, 0));
    frame.flags = 16 as never;
    const fitted = [new Vertex2D(new XYZ(0, 0, 0)), new Vertex2D(new XYZ(1, 1, 0))];
    for (const v of fitted) v.flags = 8 as never;
    verticesOf(p).push(frame, ...fitted);
    p.flags = (1 | 4) as never;
    p.smoothSurface = 6 as never;
    const { geom } = mapOne(p);

    expect(geom).toMatchObject({
      kind: 'POLYLINE',
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 1, y: 1, bulge: 0 },
      ],
      frame: [{ x: 0, y: 5 }],
      closed: true,
      is3d: false,
      fit: 'cubic',
    });
  });

  it('gives a 3D polyline its plan view', () => {
    const p = new Polyline3D();
    verticesOf(p).push(new Vertex3D(new XYZ(0, 0, 7)), new Vertex3D(new XYZ(3, 4, 9)));

    expect(mapOne(p).geom).toMatchObject({
      kind: 'POLYLINE',
      is3d: true,
      vertices: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
    });
  });

  it('reports meshes as not mapped yet', () => {
    expect(unmappedOne(new PolyfaceMesh())).toMatchObject({ reason: 'not mapped yet' });
  });
});

it('reports types not mapped yet', () => {
  expect(unmappedOne(new Shape())).toMatchObject({
    type: 'SHAPE',
    reason: 'not mapped yet',
  });
});
