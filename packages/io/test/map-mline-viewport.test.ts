// AcadToTriya for MLINE and VIEWPORT (M1-04 part 4b) on drawings authored in memory with
// acad-ts. The corpus comparison is in packages/testkit/src/mapping/entities.corpus.test.ts.
import {
  ACadVersion,
  CadDocument,
  Circle,
  Layer,
  MLine,
  MLineSegment,
  MLineStyle,
  MLineVertex,
  Viewport,
  XY,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import type { EntityGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function mapIn(doc: CadDocument, e: Entity): EntityGeometry {
  doc.entities?.add(e);
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  return entities.find((x) => x.handle === H(e))!.geom;
}

function vertex(p: [number, number, number], d: [number, number, number]): MLineVertex {
  const v = new MLineVertex();
  v.position = new XYZ(...p);
  v.direction = new XYZ(...d);
  v.miter = new XYZ(-d[1], d[0], 0);
  for (const params of [
    [0.5, 0],
    [-0.5, 0],
  ]) {
    const s = new MLineSegment();
    s.parameters = params;
    v.segments.push(s);
  }
  return v;
}

describe('MLINE', () => {
  it('maps style, scale, justification, flags and each vertex with its element parameters', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const m = new MLine();
    // A new acad-ts document has no ACAD_MLINESTYLE dictionary; give the style a handle.
    const style = new MLineStyle('STANDARD');
    style.handle = 0x7b0;
    m.style = style;
    m.scaleFactor = 20;
    m.justification = 2 as never;
    m.flags = (1 | 2) as never;
    m.startPoint = new XYZ(0, 0, 4);
    m.vertices = [vertex([0, 0, 4], [1, 0, 0]), vertex([10, 0, 4], [0, 1, 0])];

    expect(mapIn(doc, m)).toEqual({
      kind: 'MLINE',
      style: H(style),
      scale: 20,
      justification: 2,
      flags: 3,
      start: { x: 0, y: 0 },
      vertices: [
        {
          position: { x: 0, y: 0 },
          direction: { x: 1, y: 0 },
          miter: { x: -0, y: 1 },
          elements: [
            { parameters: [0.5, 0], fillParameters: [] },
            { parameters: [-0.5, 0], fillParameters: [] },
          ],
        },
        {
          position: { x: 10, y: 0 },
          direction: { x: 0, y: 1 },
          miter: { x: -1, y: 0 },
          elements: [
            { parameters: [0.5, 0], fillParameters: [] },
            { parameters: [-0.5, 0], fillParameters: [] },
          ],
        },
      ],
      elevation: 4,
    });
  });

  it('records a −Z normal without moving its WCS points, and reports a tilted one', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const m = new MLine();
    m.normal = new XYZ(0, 0, -1);
    m.startPoint = new XYZ(3, 4, 0);
    expect(mapIn(doc, m)).toMatchObject({ start: { x: 3, y: 4 }, normal: { x: 0, y: 0, z: -1 } });

    const d2 = new CadDocument(ACadVersion.AC1032);
    const t = new MLine();
    t.normal = new XYZ(1, 0, 1);
    d2.entities?.add(t);
    expect(mapEntities(d2).unmapped).toEqual([
      { handle: H(t), type: 'MLINE', reason: 'tilted plane' },
    ]);
  });
});

describe('VIEWPORT', () => {
  it('maps the paper-space frame, the view it shows, its clip boundary and frozen layers', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const layer = new Layer('HIDDEN-IN-VP');
    doc.layers?.add(layer);
    const clip = new Circle(new XYZ(5, 5, 0), 2);
    doc.entities?.add(clip);
    const v = new Viewport();
    v.center = new XYZ(5, 5, 0);
    v.width = 8;
    v.height = 6;
    v.id = 2;
    v.activeStatus = 1 as never;
    v.status = 0x8060 as never;
    v.viewCenter = new XY(100, 50);
    v.viewHeight = 60;
    v.viewDirection = new XYZ(0, 0, 1);
    v.viewTarget = new XYZ(0, 0, 0);
    v.twistAngle = 0.25;
    v.lensLength = 50;
    v.boundary = clip;
    v.frozenLayers.push(layer);
    v.styleSheetName = 'monochrome.ctb';

    expect(mapIn(doc, v)).toEqual({
      kind: 'VIEWPORT',
      center: { x: 5, y: 5 },
      width: 8,
      height: 6,
      id: 2,
      status: 1,
      flags: 0x8060,
      viewCenter: { x: 100, y: 50 },
      viewHeight: 60,
      viewDirection: { x: 0, y: 0, z: 1 },
      viewTarget: { x: 0, y: 0, z: 0 },
      twist: 0.25,
      lensLength: 50,
      frontClip: 0,
      backClip: 0,
      clipBoundary: H(clip),
      frozenLayers: [H(layer)],
      plotStyleSheet: 'monochrome.ctb',
      renderMode: 0,
    });
  });
});
