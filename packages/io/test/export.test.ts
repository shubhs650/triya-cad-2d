// TriyaToAcad (M1-05): a save starts from the retained original and applies the Triya
// document's changes by handle. Drawings are authored in memory with acad-ts and saved once,
// so "the file" is real bytes; the corpus-wide checks are in
// packages/testkit/src/export/export.corpus.test.ts.
import type { Polyline, Vertex3D } from '@node-projects/acad-ts';
import {
  ACadVersion,
  Arc,
  AttributeDefinition,
  AttributeEntity,
  BlockRecord,
  CadDocument,
  Circle,
  Ellipse,
  Face3D,
  Insert,
  Layer,
  Line,
  LwPolyline,
  LwPolylineVertex,
  MText,
  Polyline2D,
  Polyline3D,
  Seqend,
  Solid,
  Spline,
  TextEntity,
  Tolerance,
  Vertex2D,
  XY,
  XYZ,
  type CadObject,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type EntityInit,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
} from '../src/index';

const DOWN = new XYZ(0, 0, -1);
const hex = (n: number): string => n.toString(16).toUpperCase();

/** One drawing with an entity of every writable kind, half of them on −Z planes. */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.layers!.add(new Layer('MARKUP'));
  const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  doc.entities!.add(line);
  line.createExtendedDictionary();
  const circle = new Circle(new XYZ(3, 4, 2), 1);
  circle.normal = DOWN;
  const arc = new Arc(new XYZ(1, 0, 0), 2, 0, Math.PI / 2);
  arc.normal = DOWN;
  const pline = new LwPolyline([
    new LwPolylineVertex(new XY(0, 0)),
    new LwPolylineVertex(new XY(5, 0)),
    new LwPolylineVertex(new XY(5, 5)),
  ]);
  pline.vertices[0]!.bulge = 0.5;
  pline.normal = DOWN;
  pline.elevation = 3;
  const ellipse = new Ellipse();
  ellipse.center = new XYZ(1, 1, 0);
  ellipse.majorAxisEndPoint = new XYZ(4, 0, 0);
  ellipse.radiusRatio = 0.5;
  ellipse.startParameter = 0.25;
  ellipse.endParameter = 2;
  ellipse.normal = DOWN;
  const text = new TextEntity();
  text.value = 'NOTE';
  text.insertPoint = new XYZ(2, 3, 0);
  text.rotation = 0.3;
  text.normal = DOWN;
  const mtext = new MText('{\\LMARKUP}');
  mtext.insertPoint = new XYZ(7, 8, 0);
  mtext.rectangleWidth = 20;
  const solid = new Solid();
  solid.firstCorner = new XYZ(0, 0, 2);
  solid.secondCorner = new XYZ(1, 0, 2);
  solid.thirdCorner = new XYZ(0, 1, 2);
  solid.fourthCorner = new XYZ(1, 1, 2);
  solid.normal = DOWN;
  const trace = new Solid(new XYZ(0, 0, 0), new XYZ(2, 0, 0), new XYZ(0, 1, 0), new XYZ(2, 1, 0));
  trace.isTrace = true;
  const face = new Face3D();
  face.firstCorner = new XYZ(0, 0, 1);
  face.secondCorner = new XYZ(4, 0, 2);
  face.thirdCorner = new XYZ(4, 4, 3);
  face.fourthCorner = new XYZ(0, 4, 4);
  const spline = new Spline();
  spline.degree = 3;
  spline.controlPoints = [new XYZ(0, 0, 5), new XYZ(1, 2, 5), new XYZ(3, 2, 5), new XYZ(4, 0, 5)];
  spline.knots = [0, 0, 0, 0, 1, 1, 1, 1];
  spline.fitPoints = [new XYZ(0, 0, 5), new XYZ(4, 0, 5)];
  spline.flags = 8; // planar
  const pline2d = new Polyline2D([
    new Vertex2D(new XYZ(0, 0, 0)),
    new Vertex2D(new XYZ(6, 0, 0)),
    new Vertex2D(new XYZ(6, 3, 0)),
  ]);
  (pline2d.vertices[0] as Vertex2D).bulge = 0.4;
  (pline2d.vertices[1] as Vertex2D).startWidth = 0.5;
  pline2d.normal = DOWN;
  pline2d.elevation = 1.5;
  const pline3d = new Polyline3D([new XYZ(0, 0, 1), new XYZ(2, 0, 2), new XYZ(2, 2, 3)]);
  const tilted = new Circle(new XYZ(0, 0, 0), 1);
  tilted.normal = new XYZ(1, 0, 0);
  const part = new BlockRecord('PART');
  doc.blockRecords!.add(part);
  const insert = new Insert(part);
  insert.insertPoint = new XYZ(20, 20, 0);
  // A titled block: its ATTDEF on a −Z plane, and an INSERT of it with two ATTRIBs.
  const tag = new BlockRecord('TAG');
  doc.blockRecords!.add(tag);
  const attdef = new AttributeDefinition();
  attdef.tag = 'NO';
  attdef.prompt = 'Drawing number';
  attdef.value = '000';
  attdef.insertPoint = new XYZ(1, 1, 0);
  attdef.height = 2;
  attdef.normal = DOWN;
  tag.entities.add(attdef);
  const titled = new Insert(tag);
  titled.insertPoint = new XYZ(40, 10, 1);
  titled.rotation = 0.25;
  const tolerance = new Tolerance();
  tolerance.text = '{\\Fgdt;j}%%v0.1';
  tolerance.insertionPoint = new XYZ(1, 1, 0);
  for (const e of [
    circle,
    arc,
    pline,
    ellipse,
    text,
    mtext,
    solid,
    trace,
    face,
    spline,
    tilted,
    insert,
  ]) {
    doc.entities!.add(e);
  }
  doc.entities!.add(titled);
  doc.entities!.add(tolerance);
  // `new Insert(block)` makes an ATTRIB of each ATTDEF, under no handle; these are made by hand.
  titled.attributes.length = 0;
  for (const [name, value, x] of [
    ['NO', 'A-101', 41],
    ['REV', 'C', 45],
  ] as const) {
    const a = new AttributeEntity();
    a.tag = name;
    a.value = value;
    a.insertPoint = new XYZ(x, 11, 1);
    a.height = 1;
    a.layer = titled.layer;
    a.owner = titled;
    a.handle = doc.header!.handleSeed++;
    titled.attributes.push(a);
  }
  titled.attributes.seqend = new Seqend(titled);
  titled.attributes.seqend.handle = doc.header!.handleSeed++;
  for (const p of [pline2d, pline3d]) {
    doc.entities!.add(p);
    // acad-ts holds vertices and SEQEND inside the polyline and leaves their handles to the
    // file; a drawing authored in memory gives them handles the way AutoCAD would.
    for (const v of p.vertices) v.handle = doc.header!.handleSeed++;
    p.vertices.seqend = new Seqend(p);
    p.vertices.seqend.handle = doc.header!.handleSeed++;
  }
  return writeCadDocument(doc, { format: 'dxf' });
}

const FILE = drawing();

function open(bytes = FILE): { model: DocumentModel; init: ReturnType<typeof documentInit> } {
  const init = documentInit(readCadDocument(bytes));
  return { model: DocumentModel.create(init), init };
}

type InsertGeometry = Extract<EntityGeometry, { kind: 'INSERT' }>;

/** The INSERT of TAG, which has ATTRIBs. */
const titled = (model: DocumentModel): Entity & { geom: InsertGeometry } =>
  [...model.entities()].find(
    (e) => e.geom.kind === 'INSERT' && e.geom.attributes.length > 0,
  ) as Entity & { geom: InsertGeometry };

const blockNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name)!.handle;

/** The INSERT with this handle in a reopened save, with its held ATTRIBs and SEQEND. */
function acadInsert(bytes: Uint8Array, handle: string): Insert {
  return readCadDocument(bytes).getCadObject(Number.parseInt(handle, 16)) as Insert;
}

/** A new OLE2FRAME: a type with no writer (Triya never runs OLE servers, so it never makes one). */
const ole = (model: DocumentModel): { owner: string; layer: string; geom: EntityGeometry } => ({
  owner: byType(model, 'LINE').owner,
  layer: byType(model, 'LINE').layer,
  geom: {
    kind: 'OLE2FRAME',
    upperLeft: { x: 0, y: 1 },
    lowerRight: { x: 1, y: 0 },
    oleType: 2,
    paperSpace: false,
    application: '',
  },
});

const byType = (model: DocumentModel, type: string, is3d?: boolean): Entity =>
  [...model.entities()].find(
    (e) => e.type === type && (is3d === undefined || (e.geom as { is3d?: boolean }).is3d === is3d),
  )!;

/** The polyline with this handle in a reopened save, with its held vertices and SEQEND. */
function acadPolyline(bytes: Uint8Array, handle: string): Polyline {
  return readCadDocument(bytes).getCadObject(Number.parseInt(handle, 16)) as Polyline;
}

const handlesOf = (p: Polyline): number[] => [
  ...p.vertices.map((v: CadObject) => v.handle),
  p.vertices.seqend!.handle,
];

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

function save(model: DocumentModel): Uint8Array {
  return exportDocument(readCadDocument(FILE), model, { format: 'dxf' });
}

/** The reopened entity with this handle, as Triya maps it. */
function reopened(bytes: Uint8Array, handle: string): EntityInit | undefined {
  return documentInit(readCadDocument(bytes)).entities?.find((e) => e.handle === handle);
}

/** Geometry values compared to 9 digits, −0 as 0 (the −Z plan view mirrors 0 to −0). */
function expectGeometry(actual: EntityGeometry | undefined, expected: EntityGeometry): void {
  const round = (v: unknown): unknown =>
    typeof v === 'number'
      ? Math.round(v * 1e9) / 1e9 + 0
      : Array.isArray(v)
        ? v.map(round)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
          : v;
  expect(round(actual)).toEqual(round(expected));
}

describe('passthrough store', () => {
  it('lists every handle Triya keeps without mapping, and none it maps', () => {
    const { init, model } = open();
    const passthrough = new Set(init.passthrough);
    const tilted = readCadDocument(FILE);
    const tiltedCircle = [...tilted.entities!].find(
      (e) => e instanceof Circle && e.normal.x === 1,
    )!;

    expect(passthrough.has(hex(tiltedCircle.handle))).toBe(true);
    expect(passthrough.has(hex(tilted.rootDictionary!.handle))).toBe(true);
    for (const e of init.entities ?? []) expect(passthrough.has(e.handle)).toBe(false);
    for (const h of passthrough) expect(model.hasHandle(h)).toBe(true);
  });
});

describe('triyaToAcad', () => {
  it('leaves the original untouched when nothing changed', () => {
    const { model, init } = open();
    const doc = readCadDocument(FILE);
    const summary = triyaToAcad(doc, model);

    expect(summary).toMatchObject({ updated: 0, added: 0, removed: 0 });
    expect(summary.passthrough).toBe(init.passthrough!.length);
    expect(documentInit(doc)).toEqual(init);
  });

  it('moves and restyles a LINE by handle, keeping its extension dictionary', () => {
    const { model, init } = open();
    const line = byType(model, 'LINE');
    const markup = [...model.tables.layers.values()].find((l) => l.name === 'MARKUP')!;
    edit(model, (b) =>
      b.updateEntity(line.id, {
        layer: markup.handle,
        color: { kind: 'rgb', r: 200, g: 10, b: 10 },
        linetype: 'ByBlock',
        lineweight: 35,
        transparency: { alpha: 128 },
        ltScale: 2,
        visible: false,
        geom: { kind: 'LINE', start: { x: 5, y: 5 }, end: { x: 15, y: 5 } },
      }),
    );
    const bytes = save(model);
    const after = reopened(bytes, line.handle)!;

    expect(after).toMatchObject({
      layer: markup.handle,
      color: { kind: 'rgb', r: 200, g: 10, b: 10 },
      linetype: 'ByBlock',
      lineweight: 35,
      transparency: { alpha: 128 },
      ltScale: 2,
      visible: false,
      extDict: line.extDict,
      geom: { kind: 'LINE', start: { x: 5, y: 5 }, end: { x: 15, y: 5 } },
    });
    // Every other entity reads back exactly as the file had it.
    const others = (init.entities ?? []).filter((e) => e.handle !== line.handle);
    const back = documentInit(readCadDocument(bytes)).entities!.filter(
      (e) => e.handle !== line.handle,
    );
    expect(back).toEqual(others);
  });

  it.each([
    [
      'CIRCLE',
      {
        kind: 'CIRCLE',
        center: { x: -8, y: 1 },
        radius: 3,
        elevation: -2,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'ARC',
      {
        kind: 'ARC',
        center: { x: 4, y: -1 },
        radius: 5,
        startAngle: 0.5,
        endAngle: 4,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'ELLIPSE',
      {
        kind: 'ELLIPSE',
        center: { x: 2, y: 2 },
        majorAxis: { x: 0, y: 3 },
        ratio: 0.25,
        startParam: 1,
        endParam: 5,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'ELLIPSE',
      {
        kind: 'ELLIPSE',
        center: { x: 2, y: 2 },
        majorAxis: { x: 0, y: 3 },
        ratio: 0.25,
        startParam: 0,
        endParam: 2 * Math.PI,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'LWPOLYLINE',
      {
        kind: 'LWPOLYLINE',
        vertices: [
          { x: 1, y: 1, bulge: -0.25, startWidth: 1, endWidth: 2 },
          { x: 4, y: 1, bulge: 0 },
          { x: 4, y: 6, bulge: 0 },
          { x: 0, y: 6, bulge: 0 },
        ],
        closed: true,
        plinegen: true,
        constantWidth: 0.5,
        elevation: -1,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'TEXT',
      {
        kind: 'TEXT',
        value: 'REV B',
        position: { x: -2, y: 3 },
        alignmentPoint: { x: -6, y: 3 },
        height: 2.5,
        rotation: 1.2,
        widthFactor: 0.8,
        oblique: 0.1,
        halign: 2,
        valign: 0,
        backward: true,
        upsideDown: false,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'MTEXT',
      {
        kind: 'MTEXT',
        contents: 'Check {\\Ldimension}',
        position: { x: 1, y: 2 },
        height: 3.5,
        width: 40,
        definedHeight: 10,
        rotation: 0.7,
        attachment: 5,
        direction: 1,
        lineSpacingStyle: 2,
        lineSpacing: 1.5,
        background: { flags: 1, color: { kind: 'aci', index: 3 }, scale: 1.25 },
      },
    ],
    [
      'SOLID',
      {
        kind: 'SOLID',
        corners: [
          { x: 1, y: 1 },
          { x: 3, y: 1 },
          { x: 1, y: 2 },
          { x: 3, y: 3 },
        ],
        elevation: -4,
        thickness: 0.5,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'TRACE',
      {
        kind: 'TRACE',
        corners: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 0, y: 1 },
          { x: 4, y: 1 },
        ],
        elevation: 2,
      },
    ],
    [
      '3DFACE',
      {
        kind: '3DFACE',
        corners: [
          { x: -1, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        hiddenEdges: 5,
      },
    ],
    [
      'SPLINE',
      {
        kind: 'SPLINE',
        degree: 2,
        knots: [0, 0, 0, 0.5, 1, 1, 1],
        controlPoints: [
          { x: 0, y: 0 },
          { x: 2, y: 3 },
          { x: 4, y: 3 },
          { x: 6, y: 0 },
        ],
        weights: [1, 0.5, 0.5, 1],
        fitPoints: [
          { x: 0, y: 0 },
          { x: 3, y: 2 },
          { x: 6, y: 0 },
        ],
        startTangent: { x: 1, y: 1 },
        endTangent: { x: 1, y: -1 },
        closed: false,
        periodic: false,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'POLYLINE',
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 1, y: 1, bulge: -0.5, startWidth: 0.25, endWidth: 0.75 },
          { x: 5, y: 1, bulge: 0 },
          { x: 5, y: 4, bulge: 0.2 },
          { x: 2, y: 6, bulge: 0 },
        ],
        closed: true,
        is3d: false,
        startWidth: 0.1,
        endWidth: 0.2,
        plinegen: true,
        elevation: -2,
        thickness: 1,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
    [
      'POLYLINE',
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 0, y: 1, bulge: 0 },
          { x: 3, y: 1, bulge: 0 },
        ],
        closed: true,
        is3d: true,
      },
    ],
    [
      'POLYLINE',
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 1, y: 1, bulge: 0 },
          { x: 2, y: 1.5, bulge: 0 },
          { x: 3, y: 1, bulge: 0 },
          { x: 4, y: 0, bulge: 0 },
        ],
        closed: false,
        is3d: false,
        fit: 'cubic',
        frame: [
          { x: 0, y: 0 },
          { x: 2, y: 3 },
          { x: 4, y: 0 },
        ],
      },
    ],
    [
      'ATTDEF',
      {
        kind: 'ATTDEF',
        value: '001',
        position: { x: 2, y: -1 },
        alignmentPoint: { x: 4, y: -1 },
        height: 1.25,
        rotation: 0.4,
        widthFactor: 0.9,
        oblique: 0,
        halign: 1,
        valign: 0,
        backward: false,
        upsideDown: true,
        tag: 'SHEET',
        flags: 9,
        lockPosition: true,
        prompt: 'Sheet number',
        elevation: 0.5,
        normal: { x: 0, y: 0, z: -1 },
      },
    ],
  ] as const)('writes an edited %s so it maps back to the edit', (type, geom) => {
    const { model } = open();
    const e = byType(model, type, 'is3d' in geom ? geom.is3d : undefined);
    const style = 'style' in e.geom ? { style: e.geom.style } : {};
    const next = { ...geom, ...style } as unknown as EntityGeometry;
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));

    expectGeometry(reopened(save(model), e.handle)?.geom, next);
  });

  it('keeps a polyline vertex that did not change exactly as it was', () => {
    const { model } = open();
    const e = byType(model, 'LWPOLYLINE');
    if (e.geom.kind !== 'LWPOLYLINE') throw new Error('not a polyline');
    const vertices = e.geom.vertices.map((v, i) => (i === 2 ? { ...v, x: v.x + 1 } : v));
    edit(model, (b) => b.updateEntity(e.id, { geom: { ...e.geom, vertices } as EntityGeometry }));

    expect(reopened(save(model), e.handle)?.geom).toEqual({ ...e.geom, vertices });
  });

  it('keeps the Z of 3D points it only moves in plan, and their vertex handles', () => {
    const { model } = open();
    const face = byType(model, '3DFACE');
    const spline = byType(model, 'SPLINE');
    const p3 = byType(model, 'POLYLINE', true);
    const shift = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + 1 });
    edit(model, (b) => {
      for (const e of [face, spline, p3]) {
        const g = e.geom as unknown as Record<string, unknown>;
        const next = Object.fromEntries(
          Object.entries(g).map(([k, v]) => [
            k,
            k === 'corners' || k === 'controlPoints' || k === 'fitPoints' || k === 'vertices'
              ? (v as { x: number; y: number }[]).map(shift)
              : v,
          ]),
        );
        b.updateEntity(e.id, { geom: next as unknown as EntityGeometry });
      }
    });
    const bytes = save(model);
    const doc = readCadDocument(bytes);
    const f = doc.getCadObject(Number.parseInt(face.handle, 16)) as Face3D;
    const s = doc.getCadObject(Number.parseInt(spline.handle, 16)) as Spline;
    const before = acadPolyline(FILE, p3.handle);
    const after = acadPolyline(bytes, p3.handle);

    expect([f.firstCorner, f.secondCorner, f.thirdCorner, f.fourthCorner].map((c) => c.z)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(f.firstCorner.x).toBe(1);
    expect(s.controlPoints.map((c) => c.z)).toEqual([5, 5, 5, 5]);
    expect(s.fitPoints.map((c) => c.z)).toEqual([5, 5]);
    expect([...after.vertices].map((v) => (v as Vertex3D).location.z)).toEqual([1, 2, 3]);
    expect(handlesOf(after)).toEqual(handlesOf(before));
  });

  it('gives vertices a polyline gains new handles above the seed, and keeps the rest', () => {
    const { model } = open();
    const p2 = byType(model, 'POLYLINE', false);
    const p3 = byType(model, 'POLYLINE', true);
    const g2 = p2.geom as Extract<EntityGeometry, { kind: 'POLYLINE' }>;
    const g3 = p3.geom as Extract<EntityGeometry, { kind: 'POLYLINE' }>;
    const seed = Number.parseInt(model.handSeed, 16);
    edit(model, (b) => {
      b.updateEntity(p2.id, {
        geom: {
          ...g2,
          vertices: [...g2.vertices, { x: 9, y: 9, bulge: 0 }, { x: 9, y: 12, bulge: 0.1 }],
        },
      });
      b.updateEntity(p3.id, { geom: { ...g3, vertices: g3.vertices.slice(0, 2) } });
    });
    const bytes = save(model);
    const before2 = handlesOf(acadPolyline(FILE, p2.handle));
    const after2 = acadPolyline(bytes, p2.handle);
    const after3 = acadPolyline(bytes, p3.handle);
    const added = handlesOf(after2).slice(3, 5);

    expect(handlesOf(after2).slice(0, 3)).toEqual(before2.slice(0, 3));
    expect(after2.vertices.seqend!.handle).toBe(before2[3]);
    expect(new Set(added).size).toBe(2);
    for (const h of added) expect(h).toBeGreaterThanOrEqual(seed);
    expect(readCadDocument(bytes).header!.handleSeed).toBeGreaterThan(Math.max(...added));
    // The vertices keep the polyline's layer, as AutoCAD writes them.
    expect(after2.vertices.every((v) => v.layer.name === after2.layer.name)).toBe(true);
    expect([...after3.vertices].map((v) => (v as Vertex3D).location.z)).toEqual([1, 2]);
    expectGeometry(reopened(bytes, p2.handle)?.geom, model.entity(p2.id)!.geom);
    expectGeometry(reopened(bytes, p3.handle)?.geom, model.entity(p3.id)!.geom);
  });

  it('writes a new polyline with its vertices and SEQEND to DWG too', () => {
    const { model } = open();
    const line = byType(model, 'LINE');
    const geoms: EntityGeometry[] = [
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 0.5 },
          { x: 3, y: 0, bulge: 0 },
          { x: 3, y: 3, bulge: 0 },
        ],
        closed: true,
        is3d: false,
      },
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 3, y: 4, bulge: 0 },
        ],
        closed: false,
        is3d: true,
      },
    ];
    const added: Entity[] = [];
    edit(model, (b) => {
      for (const geom of geoms) {
        added.push(b.addEntity({ owner: line.owner, layer: line.layer, geom }));
      }
    });
    const bytes = exportDocument(readCadDocument(FILE), model, { format: 'dwg' });

    for (const e of added) {
      expectGeometry(reopened(bytes, e.handle)?.geom, e.geom);
      expect(acadPolyline(bytes, e.handle).vertices.seqend).not.toBeNull();
    }
  });

  it('writes an edited INSERT and its ATTRIBs by handle', () => {
    const { model } = open();
    const e = titled(model);
    const markup = [...model.tables.layers.values()].find((l) => l.name === 'MARKUP')!;
    const [no, rev] = e.geom.attributes;
    const next: InsertGeometry = {
      ...e.geom,
      position: { x: -3, y: 7 },
      scale: { x: -2, y: 3, z: -1 },
      rotation: 5.5,
      elevation: -2,
      normal: { x: 0, y: 0, z: -1 },
      attributes: [
        {
          ...no!,
          value: 'A-102',
          position: { x: -4, y: 8 },
          rotation: 1,
          height: 1.5,
          layer: markup.handle,
          color: { kind: 'aci', index: 2 },
          flags: 8,
          lockPosition: true,
          upsideDown: true,
          normal: { x: 0, y: 0, z: -1 },
        },
        rev!,
      ],
    };
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));
    const bytes = save(model);

    expectGeometry(reopened(bytes, e.handle)?.geom, next);
    const before = acadInsert(FILE, e.handle);
    const after = acadInsert(bytes, e.handle);
    expect(after.attributes.map((a) => a.handle)).toEqual(before.attributes.map((a) => a.handle));
    expect(after.attributes.seqend!.handle).toBe(before.attributes.seqend!.handle);
  });

  it('turns an INSERT into a MINSERT of another block', () => {
    const { model } = open();
    const e = byType(model, 'INSERT');
    const next = {
      ...e.geom,
      block: blockNamed(model, 'TAG'),
      array: { columns: 3, rows: 2, columnSpacing: -5, rowSpacing: 4 },
      normal: { x: 0, y: 0, z: -1 },
    } as EntityGeometry;
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));
    const bytes = save(model);

    expectGeometry(reopened(bytes, e.handle)?.geom, next);
    expect(acadInsert(bytes, e.handle).isMultiple).toBe(true);
  });

  it('adds ATTRIBs under the handles the engine gave them and drops removed ones', () => {
    const { model } = open();
    const e = titled(model);
    const [no, rev] = e.geom.attributes;
    let added = '';
    edit(model, (b) => {
      added = model.handles.allocate();
      b.updateEntity(e.id, {
        geom: {
          ...e.geom,
          attributes: [
            rev!,
            {
              ...no!,
              handle: added,
              raw: { handle: added },
              tag: 'SHEET',
              value: '2',
              position: { x: 50, y: 11 },
            },
          ],
        },
      });
    });
    const bytes = save(model);
    const back = reopened(bytes, e.handle)!.geom as InsertGeometry;

    expect(back.attributes.map((a) => [a.handle, a.tag, a.value])).toEqual([
      [rev!.handle, 'REV', 'C'],
      [added, 'SHEET', '2'],
    ]);
    const before = acadInsert(FILE, e.handle);
    expect(acadInsert(bytes, e.handle).attributes.seqend!.handle).toBe(
      before.attributes.seqend!.handle,
    );
    // The removed ATTRIB is gone from the file.
    expect(readCadDocument(bytes).getCadObject(Number.parseInt(no!.handle, 16))).toBeFalsy();

    // An INSERT that loses all its ATTRIBs loses its SEQEND too, as AutoCAD writes it.
    const { model: m2 } = open();
    const e2 = titled(m2);
    edit(m2, (b) => b.updateEntity(e2.id, { geom: { ...e2.geom, attributes: [] } }));
    const bare = acadInsert(save(m2), e2.handle);
    expect(bare.attributes.length).toBe(0);
    expect(bare.attributes.seqend).toBeNull();
  });

  it.each(['dxf', 'dwg'] as const)(
    'writes a new INSERT with ATTRIBs and a SEQEND to %s',
    (format) => {
      const { model } = open();
      const proto = titled(model);
      let e!: Entity;
      edit(model, (b) => {
        const attributes = proto.geom.attributes.map((a, i) => {
          const handle = model.handles.allocate();
          // The mapping names each object's own raw record by its handle.
          return { ...a, handle, raw: { handle }, value: `V${i}` };
        });
        e = b.addEntity({
          owner: proto.owner,
          layer: proto.layer,
          geom: { ...proto.geom, position: { x: 70, y: 0 }, rotation: 0, attributes },
        });
      });
      const bytes = exportDocument(readCadDocument(FILE), model, { format });

      expectGeometry(reopened(bytes, e.handle)?.geom, e.geom);
      const doc = readCadDocument(bytes);
      const seqend = (doc.getCadObject(Number.parseInt(e.handle, 16)) as Insert).attributes.seqend!;
      expect(seqend.handle).toBeGreaterThanOrEqual(Number.parseInt(model.handSeed, 16));
      expect(seqend.handle).toBeLessThan(doc.header!.handleSeed);
    },
  );

  it('deletes an entity with the extension dictionary only it owns, not the shared layer', () => {
    const { model } = open();
    const line = byType(model, 'LINE');
    edit(model, (b) => b.removeEntity(line.id));
    const doc = readCadDocument(save(model));

    expect(doc.getCadObject(Number.parseInt(line.handle, 16))).toBeNull();
    expect(doc.getCadObject(Number.parseInt(line.extDict!, 16))).toBeNull();
    expect(doc.getCadObject(Number.parseInt(line.layer, 16))).not.toBeNull();
  });

  it('adds entities under the handles the engine allocated and writes $HANDSEED back', () => {
    const { model } = open();
    const space = byType(model, 'LINE').owner;
    const layer = byType(model, 'LINE').layer;
    const style = (byType(model, 'TEXT').geom as { style: string }).style;
    const geoms: EntityGeometry[] = [
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
      { kind: 'XLINE', base: { x: 1, y: 2 }, direction: { x: 0, y: 1 } },
      { kind: 'RAY', base: { x: 1, y: 2 }, direction: { x: 1, y: 0 } },
      { kind: 'CIRCLE', center: { x: 4, y: 4 }, radius: 2 },
      { kind: 'ARC', center: { x: 4, y: 4 }, radius: 2, startAngle: 1, endAngle: 2 },
      {
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 2, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: 2 * Math.PI,
      },
      { kind: 'POINT', position: { x: 9, y: 9 } },
      {
        kind: 'SOLID',
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: 1 },
        ],
      },
      {
        kind: '3DFACE',
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        hiddenEdges: 2,
      },
      {
        kind: 'SPLINE',
        degree: 3,
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
        controlPoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 0 },
        ],
        closed: false,
        periodic: false,
      },
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 0.5 },
          { x: 3, y: 0, bulge: 0, startWidth: 1 },
          { x: 3, y: 3, bulge: 0 },
        ],
        closed: true,
        is3d: false,
        elevation: 2,
      },
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 3, y: 0, bulge: 0 },
        ],
        closed: false,
        is3d: true,
      },
      {
        kind: 'POLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 1, y: 0.5, bulge: 0 },
          { x: 2, y: 0, bulge: 0 },
        ],
        closed: false,
        is3d: false,
        // Quadratic and Bezier fits do not survive a DXF save yet: acad-ts writes POLYLINE 75
        // for polygon meshes only (roadmap M1-80).
        fit: 'cubic',
        frame: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
        ],
      },
      {
        kind: 'LWPOLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 1 },
          { x: 2, y: 0, bulge: 0 },
        ],
        closed: false,
      },
      {
        kind: 'TEXT',
        value: 'A',
        style,
        position: { x: 1, y: 1 },
        height: 2,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
      },
      {
        kind: 'ATTDEF',
        value: 'X',
        style,
        position: { x: 1, y: 3 },
        height: 2,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
        tag: 'NAME',
        flags: 1,
        prompt: 'Name',
      },
      {
        kind: 'MTEXT',
        contents: 'B',
        style,
        position: { x: 1, y: 5 },
        height: 2,
        width: 10,
        rotation: 0,
        attachment: 1,
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      },
    ];
    const added: Entity[] = [];
    edit(model, (b) => {
      for (const geom of geoms)
        added.push(b.addEntity({ owner: space, layer, geom, color: { kind: 'aci', index: 1 } }));
    });
    const bytes = save(model);
    const doc = readCadDocument(bytes);

    for (const e of added) {
      const back = reopened(bytes, e.handle);
      expect(back, e.type).toBeDefined();
      expect(back!.owner).toBe(space);
      expect(back!.color).toEqual({ kind: 'aci', index: 1 });
      expectGeometry(back!.geom, e.geom);
    }
    expect(doc.header!.handleSeed).toBeGreaterThanOrEqual(Number.parseInt(model.handSeed, 16));
    // A new polyline's vertices and SEQEND get handles of their own above every other one.
    const held = added
      .filter((e) => e.type === 'POLYLINE')
      .flatMap((e) => handlesOf(doc.getCadObject(Number.parseInt(e.handle, 16)) as Polyline));
    expect(new Set(held).size).toBe(held.length);
    for (const h of held) {
      expect(h).toBeGreaterThanOrEqual(Number.parseInt(model.handSeed, 16));
      expect(h).toBeLessThan(doc.header!.handleSeed);
    }
  });

  it('refuses what it cannot write yet and leaves the original as it was', () => {
    const cases: ((b: ChangeSetBuilder, model: DocumentModel) => void)[] = [
      (b, m) => {
        b.addEntity(ole(m));
      },
      (b, m) => {
        const s = byType(m, 'INSERT');
        b.updateEntity(s.id, { geom: { ...s.geom, block: 'FFFFF' } as EntityGeometry });
      },
      (b, m) => {
        // A block inserted into itself would recurse forever.
        const tag = blockNamed(m, 'TAG');
        b.addEntity({
          owner: tag,
          layer: titled(m).layer,
          geom: { ...titled(m).geom, attributes: [] },
        });
      },
      (b, m) => {
        const e = titled(m);
        const [no] = e.geom.attributes;
        b.updateEntity(e.id, {
          geom: { ...e.geom, attributes: [{ ...no!, normal: { x: 1, y: 0, z: 0 } }] },
        });
      },
      (b, m) => {
        // A new ATTRIB under a handle the file already uses (here the LINE's).
        const e = titled(m);
        const [no] = e.geom.attributes;
        b.updateEntity(e.id, {
          geom: { ...e.geom, attributes: [no!, { ...no!, handle: byType(m, 'LINE').handle }] },
        });
      },
      (b, m) => {
        const e = titled(m);
        const [no, rev] = e.geom.attributes;
        b.updateEntity(e.id, {
          geom: {
            ...e.geom,
            attributes: [{ ...no!, xdata: [] }, rev!],
          },
        });
      },
      (b, m) => {
        // Single-line to multiline: older DXF versions keep the text where Triya does not write.
        const e = titled(m);
        const [no, rev] = e.geom.attributes;
        const mtext = byType(m, 'MTEXT').geom as Extract<EntityGeometry, { kind: 'MTEXT' }>;
        b.updateEntity(e.id, { geom: { ...e.geom, attributes: [{ ...no!, mtext }, rev!] } });
      },
      (b, m) => {
        // A knot vector that does not fit the control points would write a broken SPLINE.
        const s = byType(m, 'SPLINE');
        b.updateEntity(s.id, {
          geom: { ...s.geom, knots: [0, 0, 1, 1] } as EntityGeometry,
        });
      },
      (b, m) => {
        const s = byType(m, 'SPLINE');
        b.updateEntity(s.id, {
          geom: { ...s.geom, weights: [1, 2] } as EntityGeometry,
        });
      },
      (b, m) => {
        const p = byType(m, 'POLYLINE', false);
        b.updateEntity(p.id, { geom: { ...p.geom, is3d: true } as EntityGeometry });
      },
      (b, m) => {
        const p = byType(m, 'POLYLINE', true);
        const g = p.geom as Extract<EntityGeometry, { kind: 'POLYLINE' }>;
        b.updateEntity(p.id, {
          geom: { ...g, vertices: g.vertices.map((v) => ({ ...v, bulge: 0.5 })) },
        });
      },
      (b, m) => {
        const p = byType(m, 'SOLID');
        b.updateEntity(p.id, {
          geom: { ...p.geom, normal: { x: 1, y: 0, z: 0 } } as EntityGeometry,
        });
      },
      (b) => b.setHeader('$LTSCALE', 7),
      (b, m) => {
        const part = [...m.tables.blockRecords.values()].find((r) => r.name === 'PART')!;
        b.moveEntity(byType(m, 'LINE').id, part.handle);
      },
      (b, m) => b.updateEntity(byType(m, 'LINE').id, { xdata: [] }),
    ];
    for (const f of cases) {
      const { model, init } = open();
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(FILE);

      expect(() => triyaToAcad(doc, model), String(cases.indexOf(f))).toThrow(
        UnsupportedChangeError,
      );
      expect(documentInit(doc)).toEqual(init);
    }
  });

  it('names each problem in the error', () => {
    const { model } = open();
    let s: Entity | undefined;
    edit(model, (b) => {
      s = b.addEntity(ole(model));
    });
    let error: unknown;
    try {
      triyaToAcad(readCadDocument(FILE), model);
    } catch (e) {
      error = e;
    }
    expect((error as UnsupportedChangeError).problems).toEqual([
      `OLE2FRAME ${s!.handle}: new entities`,
    ]);
  });
});
