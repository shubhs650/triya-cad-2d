// AcadToTriya for IMAGE, WIPEOUT and PDFUNDERLAY (M1-04 part 4a) on drawings authored in
// memory with acad-ts: placement, display settings, clip boundaries and the ±Z plane check.
// The corpus comparison is in packages/testkit/src/mapping/entities.corpus.test.ts.
import {
  ACadVersion,
  CadDocument,
  ClipType,
  ImageDefinition,
  PdfUnderlay,
  PdfUnderlayDefinition,
  RasterImage,
  Wipeout,
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

describe('IMAGE and WIPEOUT', () => {
  it('maps an image’s placement, display settings and clip polygon', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const def = new ImageDefinition('site-photo');
    // A new acad-ts document has no IMAGEDEF dictionary; give the definition a handle directly.
    def.handle = 0x7a1;
    const im = new RasterImage();
    im.definition = def;
    im.insertPoint = new XYZ(5, 6, 2);
    im.uVector = new XYZ(0.01, 0, 0);
    im.vVector = new XYZ(0, 0.01, 0);
    im.size = new XY(640, 480);
    im.flags = 7 as never;
    im.clippingState = true;
    im.brightness = 60;
    im.contrast = 40;
    im.fade = 10;
    im.clipType = 2 as never;
    im.clipMode = 1 as never;
    im.clipBoundaryVertices = [new XY(0, 0), new XY(640, 0), new XY(320, 480), new XY(0, 0)];

    expect(mapIn(doc, im)).toEqual({
      kind: 'IMAGE',
      definition: H(def),
      position: { x: 5, y: 6 },
      u: { x: 0.01, y: 0 },
      v: { x: 0, y: 0.01 },
      size: { x: 640, y: 480 },
      displayFlags: 7,
      clipping: true,
      brightness: 60,
      contrast: 40,
      fade: 10,
      clip: {
        type: 'polygon',
        vertices: [
          { x: 0, y: 0 },
          { x: 640, y: 0 },
          { x: 320, y: 480 },
          { x: 0, y: 0 },
        ],
        inverted: true,
      },
      elevation: 2,
    });
  });

  it('maps a wipeout, which has no definition', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const w = new Wipeout();
    w.size = new XY(1, 1);
    w.clipBoundaryVertices = [new XY(-0.5, -0.5), new XY(0.5, 0.5)];

    const g = mapIn(doc, w);
    expect(g).toMatchObject({
      kind: 'WIPEOUT',
      clip: { type: 'rectangle', inverted: false },
    });
    expect('definition' in g).toBe(false);
  });

  it('takes the clip boundary type from DXF 71, which acad-ts reads since patch 0123', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const w = new Wipeout();
    w.clipBoundaryVertices = [new XY(0, 0), new XY(1, 0), new XY(0, 1), new XY(0, 0)];
    w.clipType = ClipType.Polygonal;
    expect(mapIn(doc, w)).toMatchObject({ clip: { type: 'polygon' } });

    const r = new Wipeout();
    r.clipBoundaryVertices = [new XY(0, 0), new XY(1, 1)];
    expect(mapIn(new CadDocument(ACadVersion.AC1032), r)).toMatchObject({
      clip: { type: 'rectangle' },
    });
  });

  it('keeps a mirrored image in WCS and reports one on a tilted plane', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const im = new RasterImage();
    im.uVector = new XYZ(-1, 0, 0);
    im.vVector = new XYZ(0, 1, 0);
    expect(mapIn(doc, im)).toMatchObject({
      u: { x: -1, y: 0 },
      v: { x: 0, y: 1 },
      normal: { x: 0, y: 0, z: -1 },
    });

    const tilted = new RasterImage();
    tilted.vVector = new XYZ(0, 0, 1);
    const d2 = new CadDocument(ACadVersion.AC1032);
    d2.entities?.add(tilted);
    expect(mapEntities(d2).unmapped).toEqual([
      { handle: H(tilted), type: 'IMAGE', reason: 'tilted plane' },
    ]);
  });
});

describe('PDFUNDERLAY', () => {
  it('maps the definition, placement, display settings and clip boundary', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const def = new PdfUnderlayDefinition();
    def.handle = 0x7a2;
    const u = new PdfUnderlay(def);
    u.insertPoint = new XYZ(1, 2, 0);
    u.xScale = 2;
    u.yScale = 3;
    u.rotation = 0.5;
    u.flags = 3 as never;
    u.contrast = 80;
    u.fade = 25;
    u.clipBoundaryVertices = [new XY(0, 0), new XY(4, 3)];

    expect(mapIn(doc, u)).toEqual({
      kind: 'PDFUNDERLAY',
      definition: H(def),
      position: { x: 1, y: 2 },
      scale: { x: 2, y: 3, z: 1 },
      rotation: 0.5,
      flags: 3,
      contrast: 80,
      fade: 25,
      clip: [
        { x: 0, y: 0 },
        { x: 4, y: 3 },
      ],
    });
  });

  it('turns a −Z underlay’s rotation into its WCS angle and marks it mirrored', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const u = new PdfUnderlay();
    u.normal = new XYZ(0, 0, -1);
    u.insertPoint = new XYZ(1, 2, 3);
    u.rotation = 0.5;
    const g = mapIn(doc, u);

    expect(g).toMatchObject({
      position: { x: 1, y: 2 },
      upsideDown: true,
      elevation: 3,
      normal: { x: 0, y: 0, z: -1 },
    });
    if (g.kind !== 'PDFUNDERLAY') throw new Error(g.kind);
    expect(g.rotation).toBeCloseTo(Math.PI - 0.5, 12);
  });
});
