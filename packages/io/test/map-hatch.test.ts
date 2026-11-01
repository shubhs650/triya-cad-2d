// AcadToTriya for HATCH (M1-04 part 3b) on drawings authored in memory with acad-ts: loops of
// every edge type, pattern lines, gradients and the −Z mirror, which the public corpus has
// no example of. The corpus comparison is in packages/testkit/src/mapping/entities.corpus.test.ts.
import {
  ACadVersion,
  CadDocument,
  Circle,
  Color,
  GradientColor,
  Hatch,
  HatchBoundaryPath,
  HatchBoundaryPathArc,
  HatchBoundaryPathEllipse,
  HatchBoundaryPathLine,
  HatchBoundaryPathPolyline,
  HatchBoundaryPathSpline,
  HatchPattern,
  HatchPatternLine,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import type { HatchEdge, HatchGeometry, Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function mapHatch(h: Hatch, doc = new CadDocument(ACadVersion.AC1032)): HatchGeometry {
  doc.entities?.add(h);
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  const g = entities.find((e) => e.handle === H(h))!.geom;
  if (g.kind !== 'HATCH') throw new Error(g.kind);
  return g;
}

function line(a: [number, number], b: [number, number]): HatchBoundaryPathLine {
  const l = new HatchBoundaryPathLine();
  l.start = new XY(...a);
  l.end = new XY(...b);
  return l;
}

/** Points along an edge as AutoCAD draws it: clockwise edges store their angles negated. */
function edgePoints(e: HatchEdge): Vec2[] {
  const ts = [0, 0.5, 1];
  if (e.type === 'arc') {
    const s = e.ccw ? e.startAngle : -e.startAngle;
    let en = e.ccw ? e.endAngle : -e.endAngle;
    const dir = e.ccw ? 1 : -1;
    while (dir * (en - s) <= 0) en += dir * 2 * Math.PI;
    return ts.map((t) => {
      const a = s + (en - s) * t;
      return { x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) };
    });
  }
  if (e.type === 'ellipse') {
    const s = e.ccw ? e.startAngle : -e.startAngle;
    let en = e.ccw ? e.endAngle : -e.endAngle;
    const dir = e.ccw ? 1 : -1;
    while (dir * (en - s) <= 0) en += dir * 2 * Math.PI;
    const M = e.majorAxis;
    return ts.map((t) => {
      const u = s + (en - s) * t;
      return {
        x: e.center.x + Math.cos(u) * M.x - Math.sin(u) * e.ratio * M.y,
        y: e.center.y + Math.cos(u) * M.y + Math.sin(u) * e.ratio * M.x,
      };
    });
  }
  throw new Error(e.type);
}

const expectNear = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('HATCH', () => {
  it('maps pattern, style, loops of every edge type and pattern lines', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const src = new Circle(new XYZ(0, 0, 0), 1);
    doc.entities?.add(src);
    const h = new Hatch();
    h.pattern = new HatchPattern('ANSI31');
    const pl = new HatchPatternLine();
    pl.angle = Math.PI / 4;
    pl.basePoint = new XY(0, 0);
    pl.offset = new XY(-2, 2);
    pl.dashLengths = [1, -0.5];
    h.pattern.lines.push(pl);
    h.patternType = 1 as never;
    h.isAssociative = true;
    h.elevation = 3;

    const outer = new HatchBoundaryPath();
    outer.flags = 1 as never;
    const poly = new HatchBoundaryPathPolyline();
    poly.vertices = [new XYZ(0, 0, 0), new XYZ(10, 0, 1), new XYZ(10, 10, 0)];
    poly.isClosed = true;
    outer.edges.push(poly);
    const inner = new HatchBoundaryPath();
    const arc = new HatchBoundaryPathArc();
    arc.center = new XY(5, 5);
    arc.radius = 1;
    arc.startAngle = 0;
    arc.endAngle = Math.PI;
    arc.counterClockWise = true;
    const ell = new HatchBoundaryPathEllipse();
    ell.center = new XY(5, 5);
    ell.majorAxisEndPoint = new XY(1, 0);
    ell.minorToMajorRatio = 0.5;
    ell.startAngle = Math.PI;
    ell.endAngle = 2 * Math.PI;
    ell.counterClockWise = true;
    const sp = new HatchBoundaryPathSpline();
    sp.degree = 2;
    sp.knots = [0, 0, 0, 1, 1, 1];
    sp.controlPoints = [new XYZ(4, 5, 1), new XYZ(5, 6, 2), new XYZ(6, 5, 1)];
    sp.isRational = true;
    inner.edges.push(arc, line([4, 5], [6, 5]), ell, sp);
    inner.entities.push(src);
    h.paths.push(outer, inner);
    h.seedPoints = [new XY(1, 1)];

    expect(mapHatch(h, doc)).toEqual({
      kind: 'HATCH',
      pattern: 'ANSI31',
      solid: false,
      associative: true,
      style: 0,
      patternType: 1,
      patternAngle: 0,
      patternScale: 0,
      double: false,
      loops: [
        {
          flags: 1 | 2,
          polyline: {
            vertices: [
              { x: 0, y: 0, bulge: 0 },
              { x: 10, y: 0, bulge: 1 },
              { x: 10, y: 10, bulge: 0 },
            ],
            closed: true,
          },
        },
        {
          flags: 0,
          sources: [H(src)],
          edges: [
            {
              type: 'arc',
              center: { x: 5, y: 5 },
              radius: 1,
              startAngle: 0,
              endAngle: Math.PI,
              ccw: true,
            },
            { type: 'line', start: { x: 4, y: 5 }, end: { x: 6, y: 5 } },
            {
              type: 'ellipse',
              center: { x: 5, y: 5 },
              majorAxis: { x: 1, y: 0 },
              ratio: 0.5,
              startAngle: Math.PI,
              endAngle: 2 * Math.PI,
              ccw: true,
            },
            {
              type: 'spline',
              degree: 2,
              knots: [0, 0, 0, 1, 1, 1],
              controlPoints: [
                { x: 4, y: 5 },
                { x: 5, y: 6 },
                { x: 6, y: 5 },
              ],
              weights: [1, 2, 1],
              periodic: false,
            },
          ],
        },
      ],
      patternLines: [
        { angle: Math.PI / 4, base: { x: 0, y: 0 }, offset: { x: -2, y: 2 }, dashes: [1, -0.5] },
      ],
      seedPoints: [{ x: 1, y: 1 }],
      elevation: 3,
    });
  });

  it('maps a gradient fill', () => {
    const h = new Hatch();
    h.isSolid = true;
    h.gradientColor.enabled = true;
    h.gradientColor.name = 'LINEAR';
    h.gradientColor.angle = 0.5;
    const c1 = new GradientColor();
    c1.value = 0;
    c1.color = new Color(5);
    const c2 = new GradientColor();
    c2.value = 1;
    c2.color = new Color(10, 20, 30);
    h.gradientColor.colors = [c1, c2];

    expect(mapHatch(h).gradient).toEqual({
      name: 'LINEAR',
      angle: 0.5,
      shift: 0,
      singleColor: false,
      tint: 0,
      colors: [
        { value: 0, color: { kind: 'aci', index: 5 } },
        { value: 1, color: { kind: 'rgb', r: 10, g: 20, b: 30 } },
      ],
    });
  });

  it('mirrors a −Z hatch exactly: edges keep their points, whichever way they run', () => {
    for (const ccw of [true, false]) {
      const h = new Hatch();
      h.normal = new XYZ(0, 0, -1);
      h.elevation = 2;
      const path = new HatchBoundaryPath();
      const arc = new HatchBoundaryPathArc();
      arc.center = new XY(3, 1);
      arc.radius = 2;
      arc.startAngle = 0.3;
      arc.endAngle = 1.9;
      arc.counterClockWise = ccw;
      const ell = new HatchBoundaryPathEllipse();
      ell.center = new XY(-1, 2);
      ell.majorAxisEndPoint = new XY(2, 1);
      ell.minorToMajorRatio = 0.4;
      ell.startAngle = 0.2;
      ell.endAngle = 2.5;
      ell.counterClockWise = ccw;
      path.edges.push(arc, ell);
      h.paths.push(path);
      const g = mapHatch(h);
      const edges = g.loops[0]!.edges!;

      // The file's edges in OCS, then OCS (x, y) → WCS (−x, y).
      const file = [
        { type: 'arc', center: { x: 3, y: 1 }, radius: 2, startAngle: 0.3, endAngle: 1.9, ccw },
        {
          type: 'ellipse',
          center: { x: -1, y: 2 },
          majorAxis: { x: 2, y: 1 },
          ratio: 0.4,
          startAngle: 0.2,
          endAngle: 2.5,
          ccw,
        },
      ] as HatchEdge[];
      file.forEach((f, k) => {
        const want = edgePoints(f).map((p) => ({ x: -p.x, y: p.y }));
        const got = edgePoints(edges[k]!);
        want.forEach((w, i) => expectNear(got[i]!, w));
      });
      expect(g).toMatchObject({ elevation: -2, normal: { x: 0, y: 0, z: -1 } });
    }
  });
});
