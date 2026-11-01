// AcadToTriya for OLE2FRAME and ACAD_PROXY_ENTITY (M1-04 part 4d) on drawings authored in
// memory with acad-ts. No public corpus file has either type, so these tests are the only check.
import {
  ACadVersion,
  CadDocument,
  DxfClass,
  Matrix4,
  Ole2Frame,
  ProxyCircle,
  ProxyCircularArc,
  ProxyCircularArc3Pt,
  ProxyExtents,
  ProxyModelTransform,
  ProxyPolygon,
  ProxyPolyline,
  ProxyRawGeometry,
  ProxyScalarGeometry,
  ProxyEntity,
  GraphicsType,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import type { EntityGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function mapIn(e: Entity): EntityGeometry {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.entities?.add(e);
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  return entities.find((x) => x.handle === H(e))!.geom;
}

const P = (x: number, y: number, z = 0) => new XYZ(x, y, z);

describe('OLE2FRAME', () => {
  it('maps the frame corners, the OLE object type, the space and the source application', () => {
    const o = new Ole2Frame();
    o.upperLeftCorner = P(1, 9, 2);
    o.lowerRightCorner = P(7, 3, 2);
    o.oleObjectType = 2 as never;
    o.isPaperSpace = true;
    o.sourceApplication = 'Excel.Sheet.12';
    expect(mapIn(o)).toEqual({
      kind: 'OLE2FRAME',
      upperLeft: { x: 1, y: 9 },
      lowerRight: { x: 7, y: 3 },
      oleType: 2,
      paperSpace: true,
      application: 'Excel.Sheet.12',
      elevation: 2,
    });
  });
});

describe('ACAD_PROXY_ENTITY', () => {
  function proxy(...gs: ProxyEntity['proxyGeometries']): ProxyEntity {
    const p = new ProxyEntity();
    const c = new DxfClass();
    c.dxfName = 'AECC_SURFACE';
    p.dxfClass = c;
    p.proxyGeometries = gs;
    return p;
  }
  const circle = (c: XYZ, r: number, n = P(0, 0, 1)) =>
    Object.assign(new ProxyCircle(), { center: c, radius: r, normal: n });
  const poly = (k: typeof ProxyPolyline | typeof ProxyPolygon, ...pts: XYZ[]) =>
    Object.assign(new k(), { points: pts });

  it('draws circles, arcs, polylines and polygons from its proxy graphics, in plan view', () => {
    const arc = Object.assign(new ProxyCircularArc(), {
      center: P(10, 0),
      radius: 2,
      normal: P(0, 0, 1),
      startVectorDirection: P(0, 1),
      sweepAngle: Math.PI / 2,
    });
    const arc3 = Object.assign(new ProxyCircularArc3Pt(), {
      point1: P(1, 0),
      point2: P(0, 1),
      point3: P(-1, 0),
    });
    const ext = Object.assign(new ProxyExtents(), { min: P(-5, -5, -1), max: P(20, 5, 1) });
    const colour = new ProxyScalarGeometry(GraphicsType.SubentColor, 1);
    expect(
      mapIn(
        proxy(
          ext,
          colour,
          circle(P(0, 0, 3), 1),
          arc,
          arc3,
          poly(ProxyPolyline, P(0, 0, 0), P(4, 0, 9), P(4, 4, 0)),
          poly(ProxyPolygon, P(0, 0), P(1, 0), P(0, 1)),
        ),
      ),
    ).toEqual({
      kind: 'ACAD_PROXY_ENTITY',
      className: 'AECC_SURFACE',
      extents: { min: { x: -5, y: -5 }, max: { x: 20, y: 5 } },
      curves: [
        { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 },
        {
          kind: 'ARC',
          center: { x: 10, y: 0 },
          radius: 2,
          startAngle: Math.PI / 2,
          endAngle: Math.PI,
        },
        { kind: 'ARC', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI },
        {
          kind: 'LWPOLYLINE',
          closed: false,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 4, y: 0, bulge: 0 },
            { x: 4, y: 4, bulge: 0 },
          ],
        },
        {
          kind: 'LWPOLYLINE',
          closed: true,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 1, y: 0, bulge: 0 },
            { x: 0, y: 1, bulge: 0 },
          ],
        },
      ],
      skipped: 0,
    });
  });

  it('turns an arc about −Z into the counter-clockwise arc it draws in plan view', () => {
    const arc = Object.assign(new ProxyCircularArc(), {
      center: P(0, 0),
      radius: 1,
      normal: P(0, 0, -1),
      startVectorDirection: P(1, 0),
      sweepAngle: Math.PI / 2,
    });
    const g = mapIn(proxy(arc));
    if (g.kind !== 'ACAD_PROXY_ENTITY') throw new Error(g.kind);
    expect(g.curves[0]).toMatchObject({ kind: 'ARC', radius: 1 });
    const a = g.curves[0] as { startAngle: number; endAngle: number };
    expect(a.startAngle).toBeCloseTo(-Math.PI / 2, 12);
    expect(a.endAngle).toBeCloseTo(0, 12);
  });

  it('applies pushed model transforms until they are popped', () => {
    // Rotate 90° about Z and move by (10, 0): AcGeMatrix3d rows, translation in the last column.
    const m = new Matrix4([0, -1, 0, 10, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const g = mapIn(
      proxy(
        new ProxyModelTransform(GraphicsType.PushModelTransform, m),
        poly(ProxyPolyline, P(0, 0), P(1, 0)),
        circle(P(1, 0), 0.5),
        new ProxyRawGeometry(GraphicsType.PopModelTransform, new Uint8Array()),
        poly(ProxyPolyline, P(0, 0), P(1, 0)),
      ),
    );
    if (g.kind !== 'ACAD_PROXY_ENTITY') throw new Error(g.kind);
    const v = (i: number) =>
      (g.curves[i] as unknown as { vertices: { x: number; y: number }[] }).vertices;
    expect(v(0)[1]!.x).toBeCloseTo(10, 12);
    expect(v(0)[1]!.y).toBeCloseTo(1, 12);
    expect(g.curves[1]).toMatchObject({ kind: 'CIRCLE', radius: 0.5 });
    expect((g.curves[1] as { center: { x: number } }).center.x).toBeCloseTo(10, 12);
    expect(v(2)[1]).toEqual({ x: 1, y: 0, bulge: 0 });
  });

  it('keeps an arc under a mirroring transform on the side it is drawn', () => {
    // A quarter arc in the first quadrant, mirrored in X, lies in the second.
    const m = new Matrix4([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const arc = Object.assign(new ProxyCircularArc(), {
      center: P(0, 0),
      radius: 1,
      normal: P(0, 0, 1),
      startVectorDirection: P(1, 0),
      sweepAngle: Math.PI / 2,
    });
    const g = mapIn(proxy(new ProxyModelTransform(GraphicsType.PushModelTransform, m), arc));
    if (g.kind !== 'ACAD_PROXY_ENTITY') throw new Error(g.kind);
    const a = g.curves[0] as unknown as { startAngle: number; endAngle: number };
    expect(a.startAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(a.endAngle).toBeCloseTo(Math.PI, 12);
  });

  it('counts what has no plan-view curve: text, meshes and circles on tilted planes', () => {
    const text = new ProxyRawGeometry(GraphicsType.Text, new Uint8Array(8));
    const g = mapIn(proxy(text, circle(P(0, 0), 1, P(1, 0, 0))));
    expect(g).toEqual({
      kind: 'ACAD_PROXY_ENTITY',
      className: 'AECC_SURFACE',
      curves: [],
      skipped: 2,
    });
  });
});
