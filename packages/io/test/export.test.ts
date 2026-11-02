// TriyaToAcad (M1-05): a save starts from the retained original and applies the Triya
// document's changes by handle. Drawings are authored in memory with acad-ts and saved once,
// so "the file" is real bytes; the corpus-wide checks are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  Arc,
  BlockRecord,
  CadDocument,
  Circle,
  Ellipse,
  Layer,
  Line,
  LwPolyline,
  LwPolylineVertex,
  MText,
  Solid,
  TextEntity,
  XY,
  XYZ,
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
  solid.firstCorner = new XYZ(0, 0, 0);
  solid.secondCorner = new XYZ(1, 0, 0);
  solid.thirdCorner = new XYZ(0, 1, 0);
  solid.fourthCorner = new XYZ(1, 1, 0);
  const tilted = new Circle(new XYZ(0, 0, 0), 1);
  tilted.normal = new XYZ(1, 0, 0);
  for (const e of [circle, arc, pline, ellipse, text, mtext, solid, tilted]) doc.entities!.add(e);
  doc.blockRecords!.add(new BlockRecord('PART'));
  return writeCadDocument(doc, { format: 'dxf' });
}

const FILE = drawing();

function open(bytes = FILE): { model: DocumentModel; init: ReturnType<typeof documentInit> } {
  const init = documentInit(readCadDocument(bytes));
  return { model: DocumentModel.create(init), init };
}

const byType = (model: DocumentModel, type: string): Entity =>
  [...model.entities()].find((e) => e.type === type)!;

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
  ] as const)('writes an edited %s so it maps back to the edit', (type, geom) => {
    const { model } = open();
    const e = byType(model, type);
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
  });

  it('refuses what it cannot write yet and leaves the original as it was', () => {
    const cases: ((b: ChangeSetBuilder, model: DocumentModel) => void)[] = [
      (b, m) => {
        const s = byType(m, 'SOLID');
        b.updateEntity(s.id, {
          geom: {
            ...s.geom,
            corners: [
              { x: 0, y: 0 },
              { x: 2, y: 0 },
              { x: 0, y: 2 },
              { x: 2, y: 2 },
            ],
          } as EntityGeometry,
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

      expect(() => triyaToAcad(doc, model)).toThrow(UnsupportedChangeError);
      expect(documentInit(doc)).toEqual(init);
    }
  });

  it('names each problem in the error', () => {
    const { model } = open();
    const s = byType(model, 'SOLID');
    edit(model, (b) =>
      b.updateEntity(s.id, { geom: { ...s.geom, thickness: 3 } as EntityGeometry }),
    );
    let error: unknown;
    try {
      triyaToAcad(readCadDocument(FILE), model);
    } catch (e) {
      error = e;
    }
    expect((error as UnsupportedChangeError).problems).toEqual([
      `SOLID ${s.handle}: geometry changes`,
    ]);
  });
});
