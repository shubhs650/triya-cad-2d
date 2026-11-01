// AcadToTriya for DIMENSION (every subclass), ARC_DIMENSION, LEADER and TOLERANCE (M1-04
// part 3a) on drawings authored in memory with acad-ts. The corpus comparison is in
// packages/testkit/src/mapping/entities.corpus.test.ts; the corpus has no −Z dimension,
// leader or tolerance, so those conversions are covered here.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  DimensionAligned,
  DimensionAngular2Line,
  DimensionAngular3Pt,
  DimensionArc,
  DimensionDiameter,
  DimensionLinear,
  DimensionOrdinate,
  DimensionRadius,
  Leader,
  Tolerance,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import type { EntityGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const DOWN = new XYZ(0, 0, -1);
const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function mapIn(doc: CadDocument, e: Entity): EntityGeometry {
  doc.entities?.add(e);
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  return entities.find((x) => x.handle === H(e))!.geom;
}
const mapOne = (e: Entity): EntityGeometry => mapIn(new CadDocument(ACadVersion.AC1032), e);

describe('DIMENSION', () => {
  it('maps the shared fields: style, block, text and its position', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('*D1');
    doc.blockRecords?.add(block);
    const d = new DimensionAligned();
    d.block = block;
    d.definitionPoint = new XYZ(10, 5, 0);
    d.textMiddlePoint = new XYZ(5, 6, 0);
    d.isTextUserDefinedLocation = true;
    d.text = '<> TYP';
    d.textRotation = 0.1;
    d.horizontalDirection = 0.2;
    d.attachmentPoint = 5 as never;
    d.lineSpacingFactor = 1.25;
    d.flipArrow2 = true;
    d.firstPoint = new XYZ(0, 0, 0);
    d.secondPoint = new XYZ(10, 0, 0);

    expect(mapIn(doc, d)).toEqual({
      kind: 'DIMENSION',
      dimType: 'aligned',
      style: H(doc.dimensionStyles!.tryGetValue('Standard')!),
      block: H(block),
      definitionPoint: { x: 10, y: 5 },
      textPosition: { x: 5, y: 6 },
      textUserPositioned: true,
      text: '<> TYP',
      textRotation: 0.1,
      horizontalDirection: 0.2,
      attachment: 5,
      lineSpacingStyle: 1,
      lineSpacing: 1.25,
      flipArrows: [false, true],
      first: { x: 0, y: 0 },
      second: { x: 10, y: 0 },
    });
  });

  it('gives each subclass its own points', () => {
    const lin = new DimensionLinear();
    lin.firstPoint = new XYZ(1, 1, 0);
    lin.secondPoint = new XYZ(4, 2, 0);
    lin.rotation = Math.PI / 2;
    lin.extLineRotation = 0.3;
    expect(mapOne(lin)).toMatchObject({
      dimType: 'linear',
      first: { x: 1, y: 1 },
      second: { x: 4, y: 2 },
      rotation: Math.PI / 2,
      oblique: 0.3,
    });

    const ang = new DimensionAngular2Line();
    ang.firstPoint = new XYZ(0, 0, 0);
    ang.secondPoint = new XYZ(1, 0, 0);
    ang.angleVertex = new XYZ(0, 1, 0);
    ang.dimensionArc = new XYZ(2, 2, 0);
    expect(mapOne(ang)).toMatchObject({
      dimType: 'angular',
      line1Start: { x: 0, y: 0 },
      line1End: { x: 1, y: 0 },
      line2Start: { x: 0, y: 1 },
      arcPoint: { x: 2, y: 2 },
    });

    const a3 = new DimensionAngular3Pt();
    a3.angleVertex = new XYZ(0, 0, 0);
    a3.firstPoint = new XYZ(1, 0, 0);
    a3.secondPoint = new XYZ(0, 1, 0);
    expect(mapOne(a3)).toMatchObject({ dimType: 'angular3pt', vertex: { x: 0, y: 0 } });

    const rad = new DimensionRadius();
    rad.angleVertex = new XYZ(3, 0, 0);
    rad.leaderLength = 2;
    expect(mapOne(rad)).toMatchObject({
      dimType: 'radius',
      chordPoint: { x: 3, y: 0 },
      leaderLength: 2,
    });
    expect(mapOne(new DimensionDiameter())).toMatchObject({ dimType: 'diameter' });

    const ord = new DimensionOrdinate();
    ord.isOrdinateTypeX = true;
    ord.featureLocation = new XYZ(5, 5, 0);
    ord.leaderEndpoint = new XYZ(5, 9, 0);
    expect(mapOne(ord)).toMatchObject({
      dimType: 'ordinate',
      axis: 'x',
      feature: { x: 5, y: 5 },
      leaderEnd: { x: 5, y: 9 },
    });
  });

  it('maps an ARC_DIMENSION with its leader', () => {
    const arc = new DimensionArc();
    arc.center = new XYZ(0, 0, 0);
    arc.firstPoint = new XYZ(1, 0, 0);
    arc.secondPoint = new XYZ(0, 1, 0);
    arc.startAngle = 0;
    arc.endAngle = Math.PI / 2;
    arc.hasLeader = true;
    arc.leaderPoint1 = new XYZ(2, 2, 0);
    arc.leaderPoint2 = new XYZ(3, 3, 0);
    expect(mapOne(arc)).toMatchObject({
      kind: 'ARC_DIMENSION',
      dimType: 'arc',
      center: { x: 0, y: 0 },
      partial: false,
      leader: [
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
    });
  });

  it('mirrors the OCS points and angles of a −Z dimension, not its WCS points', () => {
    const d = new DimensionLinear();
    d.normal = DOWN;
    d.definitionPoint = new XYZ(4, 1, 0); // WCS
    d.firstPoint = new XYZ(1, 1, 0); // WCS
    d.secondPoint = new XYZ(4, 3, 0); // WCS
    d.textMiddlePoint = new XYZ(2, 5, 7); // OCS
    d.rotation = 0.25; // OCS
    d.textRotation = 0.5; // OCS
    const g = mapOne(d);

    expect(g).toMatchObject({
      definitionPoint: { x: 4, y: 1 },
      first: { x: 1, y: 1 },
      second: { x: 4, y: 3 },
      textPosition: { x: -2, y: 5 },
      elevation: -7,
      normal: { x: 0, y: 0, z: -1 },
    });
    if (g.kind !== 'DIMENSION' || g.dimType !== 'linear') throw new Error(g.kind);
    expect(g.rotation).toBeCloseTo(Math.PI - 0.25, 12);
    expect(g.textRotation).toBeCloseTo(Math.PI - 0.5, 12);
  });
});

describe('LEADER and TOLERANCE', () => {
  it('maps a leader’s path, arrowhead, hook line and annotation link', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const tol = new Tolerance();
    doc.entities?.add(tol);
    const l = new Leader();
    l.vertices = [new XYZ(0, 0, 1), new XYZ(5, 5, 1), new XYZ(8, 5, 1)];
    l.arrowHeadEnabled = true;
    l.pathType = 1 as never;
    l.creationType = 1 as never;
    l.hookLineDirection = 1 as never;
    l.associatedAnnotation = tol;
    l.textHeight = 2.5;

    expect(mapIn(doc, l)).toMatchObject({
      kind: 'LEADER',
      style: H(doc.dimensionStyles!.tryGetValue('Standard')!),
      vertices: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 8, y: 5 },
      ],
      arrowhead: true,
      spline: true,
      creationType: 1,
      hookline: { sameDirection: true },
      annotation: H(tol),
      textHeight: 2.5,
      horizontalDirection: { x: 1, y: 0 },
    });
  });

  it('maps a tolerance frame, its direction WCS like MTEXT', () => {
    const t = new Tolerance();
    t.insertionPoint = new XYZ(3, 4, 0);
    t.direction = new XYZ(0, 1, 0);
    t.text = '{\\Fgdt;j}%%v0.1';
    t.normal = DOWN;

    expect(mapOne(t)).toMatchObject({
      kind: 'TOLERANCE',
      position: { x: 3, y: 4 },
      rotation: Math.PI / 2,
      upsideDown: true,
      text: '{\\Fgdt;j}%%v0.1',
    });
  });
});
