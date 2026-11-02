// TriyaToAcad writers for DIMENSION (every subclass), ARC_DIMENSION, LARGE_RADIAL_DIMENSION,
// LEADER and TOLERANCE (M1-75 part 3). Drawings are authored in memory with acad-ts and saved
// once, so "the file" is real bytes; the corpus-wide edit is in
// packages/testkit/src/export/export.corpus.test.ts. The corpus has no −Z annotation, so the
// mirrored planes are covered here.
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
  DimensionRadialLarge,
  DimensionRadius,
  DimensionStyle,
  Leader,
  LeaderCreationType,
  MText,
  Tolerance,
  XYZ,
  type Dimension,
  type Entity as AcadEntity,
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
  type CadFormat,
} from '../src/index';

const DOWN = new XYZ(0, 0, -1);

/** Shared AcDbDimension fields, so every subclass has a text and a definition point. */
function dim<T extends Dimension>(d: T, def: XYZ, text: XYZ, block?: BlockRecord): T {
  d.definitionPoint = def;
  d.textMiddlePoint = text;
  if (block) d.block = block;
  return d;
}

/** One drawing with a dimension of every kind, a LEADER and a TOLERANCE, some on −Z planes. */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.dimensionStyles!.add(new DimensionStyle('ISO'));
  const blocks = ['*D1', '*D2'].map((n) => {
    const b = new BlockRecord(n);
    doc.blockRecords!.add(b);
    return b;
  });
  const linear = dim(new DimensionLinear(), new XYZ(10, 5, 1), new XYZ(5, 5, 1), blocks[0]);
  linear.firstPoint = new XYZ(0, 0, 1);
  linear.secondPoint = new XYZ(10, 0, 1);
  linear.rotation = 0.2;
  const aligned = dim(new DimensionAligned(), new XYZ(4, 6, 0), new XYZ(-2, 6, 0));
  aligned.firstPoint = new XYZ(0, 0, 0);
  aligned.secondPoint = new XYZ(4, 3, 0);
  aligned.extLineRotation = 0.5;
  aligned.normal = DOWN;
  const angular = dim(new DimensionAngular2Line(), new XYZ(0, 5, 0), new XYZ(3, 3, 0));
  angular.firstPoint = new XYZ(1, 0, 0);
  angular.secondPoint = new XYZ(5, 0, 0);
  angular.angleVertex = new XYZ(0, 1, 0);
  angular.dimensionArc = new XYZ(4, 4, 0);
  const angular3 = dim(new DimensionAngular3Pt(), new XYZ(2, 2, 0), new XYZ(2.5, 2.5, 0));
  angular3.angleVertex = new XYZ(0, 0, 0);
  angular3.firstPoint = new XYZ(5, 0, 0);
  angular3.secondPoint = new XYZ(0, 5, 0);
  angular3.normal = DOWN;
  const radius = dim(new DimensionRadius(), new XYZ(0, 0, 0), new XYZ(2, 2, 0));
  radius.angleVertex = new XYZ(3, 0, 0);
  radius.leaderLength = 1;
  const diameter = dim(new DimensionDiameter(), new XYZ(-3, 0, 0), new XYZ(0, 1, 0));
  diameter.angleVertex = new XYZ(3, 0, 0);
  const ordinate = dim(new DimensionOrdinate(), new XYZ(0, 0, 0), new XYZ(7, 9, 0));
  ordinate.featureLocation = new XYZ(5, 5, 0);
  ordinate.leaderEndpoint = new XYZ(7, 9, 0);
  ordinate.isOrdinateTypeX = true;
  const jogged = dim(new DimensionRadialLarge(), new XYZ(0, 0, 0), new XYZ(6, 6, 0));
  jogged.chordPoint = new XYZ(4, 3, 0);
  jogged.overrideCenter = new XYZ(8, 0, 0);
  jogged.jogPoint = new XYZ(7, 2, 0);
  jogged.leaderLength = 0.5;
  const arc = dim(new DimensionArc(), new XYZ(0, 6, 0), new XYZ(0, 6.5, 0));
  arc.center = new XYZ(0, 0, 0);
  arc.firstPoint = new XYZ(5, 0, 0);
  arc.secondPoint = new XYZ(0, 5, 0);
  arc.startAngle = 0;
  arc.endAngle = Math.PI / 2;
  const note = new MText('NOTE');
  note.insertPoint = new XYZ(12, 12, 2);
  const leader = new Leader();
  leader.vertices = [new XYZ(0, 0, 2), new XYZ(10, 10, 2), new XYZ(12, 10, 2)];
  leader.arrowHeadEnabled = true;
  leader.creationType = LeaderCreationType.CreatedWithTextAnnotation;
  leader.textHeight = 2.5;
  leader.textWidth = 8;
  const tolerance = new Tolerance();
  tolerance.text = '{\\Fgdt;j}%%v0.1';
  tolerance.insertionPoint = new XYZ(1, 1, 0.5);
  tolerance.direction = new XYZ(1, 0, 0);
  for (const e of [
    linear,
    aligned,
    angular,
    angular3,
    radius,
    diameter,
    ordinate,
    jogged,
    arc,
    note,
    leader,
    tolerance,
  ] as AcadEntity[]) {
    doc.entities!.add(e);
  }
  leader.associatedAnnotation = note;
  return writeCadDocument(doc, { format: 'dxf' });
}

const FILE = drawing();

function open(): DocumentModel {
  return DocumentModel.create(documentInit(readCadDocument(FILE)));
}

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const save = (model: DocumentModel, format: CadFormat = 'dxf'): Uint8Array =>
  exportDocument(readCadDocument(FILE), model, { format });

/** The reopened entity with this handle, as Triya maps it. */
function reopened(bytes: Uint8Array, handle: string): EntityInit | undefined {
  return documentInit(readCadDocument(bytes)).entities?.find((e) => e.handle === handle);
}

/** The entity of this kind (and DIMENSION type, for DIMENSION). */
function find(model: DocumentModel, type: string, dimType?: string): Entity {
  return [...model.entities()].find(
    (e) =>
      e.type === type &&
      (dimType === undefined || (e.geom as { dimType?: string }).dimType === dimType),
  )!;
}

const styleNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.dimStyles.values()].find((s) => s.name === name)!.handle;
const blockNamed = (model: DocumentModel, name: string): string =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name)!.handle;

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

const P = (x: number, y: number) => ({ x, y });
const UP_TO_DOWN = { normal: { x: 0, y: 0, z: -1 } };

/** Fields every DIMENSION edit below changes, on a −Z plane at a new elevation. */
const SHARED = {
  definitionPoint: P(20, 25),
  textPosition: P(-15, 26),
  textUserPositioned: true,
  text: '<> TYP',
  textRotation: 0.3,
  horizontalDirection: 0.4,
  attachment: 2,
  lineSpacingStyle: 2,
  lineSpacing: 1.5,
  flipArrows: [true, false],
  elevation: -3,
  ...UP_TO_DOWN,
};

describe('triyaToAcad annotations', () => {
  it.each([
    ['DIMENSION', 'linear', { ...SHARED, first: P(1, 2), second: P(9, 3), rotation: 1 }],
    // From −Z back to +Z, losing the oblique angle.
    [
      'DIMENSION',
      'aligned',
      {
        definitionPoint: P(5, 7),
        textPosition: P(1, 7),
        first: P(1, 1),
        second: P(5, 4),
        normal: undefined,
        oblique: undefined,
      },
    ],
    [
      'DIMENSION',
      'angular',
      { ...SHARED, line1Start: P(2, 0), line1End: P(6, 1), line2Start: P(0, 2), arcPoint: P(5, 5) },
    ],
    ['DIMENSION', 'angular3pt', { vertex: P(1, 1), first: P(6, 1), second: P(1, 6) }],
    ['DIMENSION', 'radius', { ...SHARED, chordPoint: P(0, 3), leaderLength: 2 }],
    [
      'DIMENSION',
      'diameter',
      { chordPoint: P(0, 3), definitionPoint: P(0, -3), leaderLength: 0.5 },
    ],
    ['DIMENSION', 'ordinate', { ...SHARED, axis: 'y', feature: P(6, 4), leaderEnd: P(9, 4) }],
    [
      'LARGE_RADIAL_DIMENSION',
      'jogged',
      {
        ...SHARED,
        chordPoint: P(3, 4),
        overrideCenter: P(9, 1),
        jogPoint: P(8, 3),
        leaderLength: 1,
      },
    ],
    [
      'ARC_DIMENSION',
      'arc',
      {
        ...SHARED,
        first: P(4, 0),
        second: P(0, 4),
        center: P(0, 0),
        startAngle: 0.1,
        endAngle: 1.4,
        partial: true,
        leader: [P(3, 3), P(5, 5)],
      },
    ],
  ] as const)('writes an edited %s (%s) so it maps back to the edit', (type, dimType, changes) => {
    const model = open();
    const e = find(model, type, dimType);
    const merged: Record<string, unknown> = { ...e.geom, ...changes };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const next = merged as unknown as EntityGeometry;
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));

    expectGeometry(reopened(save(model), e.handle)?.geom, next);
  });

  it('writes the line spacing factor and the oblique angle, through a DXF save (M1-82)', () => {
    const model = open();
    const linear = find(model, 'DIMENSION', 'linear');
    const aligned = find(model, 'DIMENSION', 'aligned');
    const nextLinear = {
      ...linear.geom,
      lineSpacing: 1.5,
      oblique: 1.2,
      ...UP_TO_DOWN,
    } as EntityGeometry;
    const nextAligned = { ...aligned.geom, lineSpacing: 0.8, oblique: 0.25 } as EntityGeometry;
    edit(model, (b) => {
      b.updateEntity(linear.id, { geom: nextLinear });
      b.updateEntity(aligned.id, { geom: nextAligned });
    });
    const doc = readCadDocument(FILE);
    triyaToAcad(doc, model);
    const acad = (h: string) => doc.getCadObject(Number.parseInt(h, 16)) as DimensionLinear;

    expect(acad(linear.handle).lineSpacingFactor).toBe(1.5);
    // Under −Z an OCS angle θ is the WCS angle π − θ.
    expect(acad(linear.handle).extLineRotation).toBeCloseTo(Math.PI - 1.2, 12);
    // The aligned dimension is on −Z already.
    expect(acad(aligned.handle).extLineRotation).toBeCloseTo(Math.PI - 0.25, 12);
    // acad-ts's DXF reader skipped 41 and its writer left out 52 until patch 0128.
    const bytes = save(model);
    expectGeometry(reopened(bytes, linear.handle)?.geom, nextLinear);
    expectGeometry(reopened(bytes, aligned.handle)?.geom, nextAligned);
  });

  it('restyles a dimension and points it at another block', () => {
    const model = open();
    const e = find(model, 'DIMENSION', 'linear');
    const next = {
      ...e.geom,
      style: styleNamed(model, 'ISO'),
      block: blockNamed(model, '*D2'),
    } as EntityGeometry;
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));

    expectGeometry(reopened(save(model), e.handle)?.geom, next);
  });

  it('keeps the Z of the WCS points it only moves in plan', () => {
    const model = open();
    const e = find(model, 'DIMENSION', 'linear');
    edit(model, (b) =>
      b.updateEntity(e.id, { geom: { ...e.geom, first: P(2, 2) } as EntityGeometry }),
    );
    const d = readCadDocument(save(model)).getCadObject(Number.parseInt(e.handle, 16));

    expect((d as DimensionLinear).firstPoint).toMatchObject({ x: 2, y: 2, z: 1 });
    expect((d as DimensionLinear).secondPoint).toMatchObject({ x: 10, y: 0, z: 1 });
  });

  it('writes an edited LEADER and keeps its annotation', () => {
    const model = open();
    const e = find(model, 'LEADER');
    const next = {
      ...e.geom,
      style: styleNamed(model, 'ISO'),
      vertices: [P(1, 1), P(8, 9), P(11, 9), P(13, 9)],
      arrowhead: false,
      spline: true,
      hookline: { sameDirection: true },
      textHeight: 3,
      textWidth: 12,
      horizontalDirection: P(-1, 0),
      blockOffset: P(0.5, 0.25),
      annotationOffset: P(1, -1),
      elevation: 4,
    } as EntityGeometry;
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));
    const bytes = save(model);

    expectGeometry(reopened(bytes, e.handle)?.geom, next);
    expect((e.geom as { annotation?: string }).annotation).toBeDefined();
  });

  it('writes an edited TOLERANCE, on a −Z plane too', () => {
    for (const changes of [
      { position: P(4, 5), rotation: 0.75, text: '{\\Fgdt;r}%%v0.2', elevation: 2 },
      { position: P(-4, 5), rotation: 2, upsideDown: true, normal: { x: 0, y: 0, z: -1 } },
    ]) {
      const model = open();
      const e = find(model, 'TOLERANCE');
      const next = { ...e.geom, ...changes, style: styleNamed(model, 'ISO') } as EntityGeometry;
      edit(model, (b) => b.updateEntity(e.id, { geom: next }));
      expectGeometry(reopened(save(model), e.handle)?.geom, next);
    }
  });

  it('adds new dimensions, leaders and tolerances under the engine handles', () => {
    const model = open();
    const space = find(model, 'LEADER').owner;
    const layer = find(model, 'LEADER').layer;
    const style = styleNamed(model, 'ISO');
    const block = blockNamed(model, '*D2');
    const shared = {
      style,
      block,
      definitionPoint: P(10, 5),
      textPosition: P(5, 5),
      textUserPositioned: false,
      text: '',
      textRotation: 0,
      horizontalDirection: 0,
      attachment: 5,
      lineSpacingStyle: 1,
      lineSpacing: 1.25,
    };
    const geoms: EntityGeometry[] = [
      {
        ...shared,
        kind: 'DIMENSION',
        dimType: 'linear',
        first: P(0, 0),
        second: P(10, 0),
        rotation: 0,
      },
      {
        ...shared,
        kind: 'DIMENSION',
        dimType: 'aligned',
        first: P(0, 0),
        second: P(10, 0),
        elevation: 2,
      },
      {
        ...shared,
        kind: 'DIMENSION',
        dimType: 'angular',
        line1Start: P(1, 0),
        line1End: P(5, 0),
        line2Start: P(0, 1),
        arcPoint: P(4, 4),
        normal: { x: 0, y: 0, z: -1 },
      },
      {
        ...shared,
        kind: 'DIMENSION',
        dimType: 'angular3pt',
        vertex: P(0, 0),
        first: P(5, 0),
        second: P(0, 5),
      },
      { ...shared, kind: 'DIMENSION', dimType: 'radius', chordPoint: P(3, 0), leaderLength: 1 },
      { ...shared, kind: 'DIMENSION', dimType: 'diameter', chordPoint: P(3, 0), leaderLength: 0 },
      {
        ...shared,
        kind: 'DIMENSION',
        dimType: 'ordinate',
        axis: 'x',
        feature: P(5, 5),
        leaderEnd: P(5, 9),
      },
      {
        ...shared,
        kind: 'LARGE_RADIAL_DIMENSION',
        dimType: 'jogged',
        chordPoint: P(4, 3),
        overrideCenter: P(8, 0),
        jogPoint: P(7, 2),
        leaderLength: 0.5,
      },
      {
        ...shared,
        kind: 'ARC_DIMENSION',
        dimType: 'arc',
        first: P(5, 0),
        second: P(0, 5),
        center: P(0, 0),
        startAngle: 0,
        endAngle: Math.PI / 2,
        partial: false,
      },
      {
        kind: 'LEADER',
        style,
        vertices: [P(0, 0), P(5, 5), P(7, 5)],
        arrowhead: true,
        spline: false,
        creationType: 3,
        textHeight: 0,
        textWidth: 0,
        horizontalDirection: P(1, 0),
        blockOffset: P(0, 0),
        annotationOffset: P(0, 0),
      },
      {
        kind: 'LEADER',
        style,
        vertices: [P(0, 0), P(5, 5)],
        arrowhead: true,
        spline: false,
        creationType: 0,
        hookline: { sameDirection: false },
        textHeight: 2,
        textWidth: 4,
        annotation: find(model, 'MTEXT').handle,
        horizontalDirection: P(1, 0),
        blockOffset: P(0, 0),
        annotationOffset: P(0, 0),
      },
      { kind: 'TOLERANCE', style, position: P(3, 3), rotation: 0.5, text: '{\\Fgdt;j}%%v0.1' },
    ];
    const added: Entity[] = [];
    edit(model, (b) => {
      for (const geom of geoms) added.push(b.addEntity({ owner: space, layer, geom }));
    });
    const bytes = save(model);

    for (const e of added) {
      const back = reopened(bytes, e.handle);
      expect(back, e.type).toBeDefined();
      expectGeometry(back!.geom, e.geom);
    }
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const cases: ((b: ChangeSetBuilder, m: DocumentModel) => void)[] = [
      (b, m) => {
        // A linear dimension and a radius dimension are different objects.
        const e = find(m, 'DIMENSION', 'linear');
        const g = find(m, 'DIMENSION', 'radius').geom;
        const style = (e.geom as { style: string }).style;
        b.updateEntity(e.id, { geom: { ...g, style } as EntityGeometry });
      },
      (b, m) => {
        const e = find(m, 'DIMENSION', 'linear');
        b.updateEntity(e.id, { geom: { ...e.geom, style: 'FFFFF' } as EntityGeometry });
      },
      (b, m) => {
        const e = find(m, 'DIMENSION', 'linear');
        b.updateEntity(e.id, { geom: { ...e.geom, block: 'FFFFF' } as EntityGeometry });
      },
      (b, m) => {
        // A dimension drawn by model space itself.
        const e = find(m, 'DIMENSION', 'linear');
        b.updateEntity(e.id, { geom: { ...e.geom, block: e.owner } as EntityGeometry });
      },
      (b, m) => {
        // AutoCAD draws a dimension from its block, so dropping it would leave nothing to draw.
        const e = find(m, 'DIMENSION', 'linear');
        const { block: _block, ...g } = e.geom as { block?: string };
        b.updateEntity(e.id, { geom: g as EntityGeometry });
      },
      (b, m) => {
        const e = find(m, 'DIMENSION', 'radius');
        const { block: _block, ...g } = e.geom as { block?: string };
        b.addEntity({ owner: e.owner, layer: e.layer, geom: g as EntityGeometry });
      },
      (b, m) => {
        const e = find(m, 'DIMENSION', 'radius');
        b.updateEntity(e.id, {
          geom: { ...e.geom, normal: { x: 1, y: 0, z: 0 } } as EntityGeometry,
        });
      },
      (b, m) => {
        const e = find(m, 'LEADER');
        b.updateEntity(e.id, { geom: { ...e.geom, annotation: 'FFFFF' } as EntityGeometry });
      },
      (b, m) => {
        // acad-ts writes a hook line exactly when a leader has text and a horizontal direction.
        const e = find(m, 'LEADER');
        b.updateEntity(e.id, { geom: { ...e.geom, creationType: 3 } as EntityGeometry });
      },
      (b, m) => {
        const e = find(m, 'TOLERANCE');
        b.updateEntity(e.id, { geom: { ...e.geom, upsideDown: true } as EntityGeometry });
      },
      (b, m) => {
        const e = find(m, 'TOLERANCE');
        b.updateEntity(e.id, { geom: { ...e.geom, style: 'FFFFF' } as EntityGeometry });
      },
    ];
    for (const f of cases) {
      const model = open();
      const init = documentInit(readCadDocument(FILE));
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(FILE);

      expect(() => triyaToAcad(doc, model), String(cases.indexOf(f))).toThrow(
        UnsupportedChangeError,
      );
      expect(documentInit(doc)).toEqual(init);
    }
  });

  it('refuses a jogged radius dimension on a DWG save, which acad-ts cannot write (M1-74)', () => {
    const model = open();
    const e = find(model, 'LARGE_RADIAL_DIMENSION');
    edit(model, (b) =>
      b.updateEntity(e.id, { geom: { ...e.geom, leaderLength: 3 } as EntityGeometry }),
    );

    expect(() => save(model, 'dwg')).toThrow(/LARGE_RADIAL_DIMENSION .*DWG/);
  });
});
