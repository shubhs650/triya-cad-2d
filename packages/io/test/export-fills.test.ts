// TriyaToAcad writers for HATCH, IMAGE, WIPEOUT, PDFUNDERLAY and MLINE (M1-75 part 4).
// Drawings are authored in memory with acad-ts and saved once, so "the file" is real bytes; the
// corpus-wide edit is in packages/testkit/src/export/export.corpus.test.ts. The corpus has no
// −Z hatch edge loop or underlay, so the mirrored planes are covered here.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  ClipType,
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
  ImageDefinition,
  LwPolyline,
  LwPolylineVertex,
  MLine,
  MLineSegment,
  MLineStyle,
  MLineStyleElement,
  MLineVertex,
  PdfUnderlay,
  PdfUnderlayDefinition,
  RasterImage,
  Wipeout,
  XY,
  XYZ,
  type Entity as AcadEntity,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type HatchGeometry,
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

function line(x: number, y: number, z: number): LwPolylineVertex {
  const v = new LwPolylineVertex();
  v.location = new XY(x, y);
  v.bulge = z;
  return v;
}

function mlineVertex(p: XYZ, d: XYZ, offsets: readonly number[]): MLineVertex {
  const v = new MLineVertex();
  v.position = p;
  v.direction = d;
  v.miter = new XYZ(-d.y, d.x, 0);
  for (const o of offsets) {
    const s = new MLineSegment();
    s.parameters = [o, 0];
    v.segments.push(s);
  }
  return v;
}

function mlineStyle(name: string, offsets: readonly number[]): MLineStyle {
  const s = new MLineStyle(name);
  for (const o of offsets) {
    const e = new MLineStyleElement();
    e.offset = o;
    s.addElement(e);
  }
  return s;
}

/**
 * One drawing with: an associative pattern HATCH bounded by an LWPOLYLINE, a gradient HATCH on
 * −Z with line, arc, ellipse and spline edges, two IMAGEs of two definitions, a WIPEOUT, two
 * PDFUNDERLAYs (one on −Z) and an MLINE of a two-element style (a three-element one is unused).
 */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  const root = doc.rootDictionary!;
  const images = root.getEntry<CadDictionary>(CadDictionary.acadImageDict)!;
  const defs = ['photo', 'plan'].map((name) => {
    const def = new ImageDefinition(name);
    def.fileName = `${name}.png`;
    def.size = new XY(640, 480);
    images.add(def);
    return def;
  });
  const pdfs = new CadDictionary(CadDictionary.acadPdfDefinitions);
  root.add(pdfs);
  const pdfDefs = ['sheet-1', 'sheet-2'].map((name) => {
    const def = new PdfUnderlayDefinition();
    def.name = name;
    def.file = 'sheet.pdf';
    def.page = name.slice(-1);
    pdfs.add(def);
    return def;
  });
  const styles = root.getEntry<CadDictionary>(CadDictionary.acadMLineStyle)!;
  const two = mlineStyle('STANDARD', [0.5, -0.5]);
  styles.add(two);
  styles.add(mlineStyle('TRIPLE', [1, 0, -1]));

  const boundary = new LwPolyline();
  boundary.vertices = [line(0, 0, 0), line(10, 0, 0.5), line(10, 10, 0), line(0, 10, 0)];
  boundary.isClosed = true;
  const pattern = new Hatch();
  pattern.isAssociative = true;
  pattern.patternType = 1 as never;
  pattern.pattern = new HatchPattern('ANSI31');
  const pl = new HatchPatternLine();
  pl.angle = Math.PI / 4;
  pl.basePoint = new XY(0, 0);
  pl.offset = new XY(-2.2, 2.2);
  pattern.pattern.lines = [pl];
  const loop = new HatchBoundaryPath();
  const poly = new HatchBoundaryPathPolyline();
  poly.isClosed = true;
  poly.vertices = boundary.vertices.map((v) => new XYZ(v.location.x, v.location.y, v.bulge));
  loop.edges = [poly];
  loop.flags = (1 | 2) as never;
  pattern.paths = [loop];
  pattern.seedPoints = [new XY(5, 5)];
  pattern.elevation = 1;

  const gradient = new Hatch();
  gradient.normal = DOWN;
  gradient.isSolid = true;
  gradient.patternType = 1 as never;
  gradient.elevation = 2;
  const edges = new HatchBoundaryPath();
  const l = new HatchBoundaryPathLine();
  l.start = new XY(0, 0);
  l.end = new XY(4, 0);
  const a = new HatchBoundaryPathArc();
  a.center = new XY(4, 2);
  a.radius = 2;
  a.startAngle = -Math.PI / 2;
  a.endAngle = Math.PI / 2;
  a.counterClockWise = true;
  const el = new HatchBoundaryPathEllipse();
  el.center = new XY(2, 4);
  el.majorAxisEndPoint = new XY(2, 0);
  el.minorToMajorRatio = 0.5;
  el.startAngle = 0;
  el.endAngle = Math.PI;
  el.counterClockWise = true;
  const s = new HatchBoundaryPathSpline();
  s.degree = 3;
  s.knots = [0, 0, 0, 0, 1, 1, 1, 1];
  s.controlPoints = [new XYZ(0, 4, 1), new XYZ(-1, 3, 1), new XYZ(-1, 1, 1), new XYZ(0, 0, 1)];
  edges.edges = [l, a, el, s];
  edges.flags = 1 as never;
  gradient.paths = [edges];
  gradient.gradientColor.enabled = true;
  gradient.gradientColor.name = 'LINEAR';
  gradient.gradientColor.angle = 0.3;
  for (const [value, aci] of [
    [0, 1],
    [1, 5],
  ] as const) {
    const c = new GradientColor();
    c.value = value;
    c.color = new Color(aci);
    gradient.gradientColor.colors.push(c);
  }

  const photo = new RasterImage();
  const plan = new RasterImage();
  const wipeout = new Wipeout();
  wipeout.clipType = ClipType.Polygonal;
  wipeout.uVector = new XYZ(4, 0, 0);
  wipeout.vVector = new XYZ(0, 4, 0);
  wipeout.size = new XY(1, 1);
  wipeout.clipBoundaryVertices = [new XY(-0.5, -0.5), new XY(0.5, -0.5), new XY(0, 0.5)];
  const sheet = new PdfUnderlay();
  const flipped = new PdfUnderlay();
  flipped.normal = DOWN;
  flipped.rotation = 0.25;
  const mline = new MLine();
  mline.startPoint = new XYZ(0, 0, 3);
  mline.vertices = [
    mlineVertex(new XYZ(0, 0, 3), new XYZ(1, 0, 0), [0.5, -0.5]),
    mlineVertex(new XYZ(10, 0, 3), new XYZ(0, 1, 0), [0.5, -0.5]),
  ];
  for (const e of [boundary, pattern, gradient, photo, plan, wipeout, sheet, flipped, mline]) {
    doc.entities!.add(e as AcadEntity);
  }
  // References resolve through the document's collections, so they are set once it has them.
  for (const [i, im] of [photo, plan].entries()) {
    im.definition = defs[i]!;
    im.insertPoint = new XYZ(20 * i, 20, 0);
    im.uVector = new XYZ(0.01, 0, 0);
    im.vVector = new XYZ(0, 0.01, 0);
    im.size = new XY(640, 480);
    im.flags = 7 as never;
    // AutoCAD states a rectangular clip as two pixel corners, the whole image unclipped.
    im.clipBoundaryVertices = [new XY(-0.5, -0.5), new XY(639.5, 479.5)];
  }
  sheet.definition = pdfDefs[0]!;
  flipped.definition = pdfDefs[1]!;
  mline.style = two;
  loop.entities = [boundary];
  boundary.addReactor(pattern);
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

/** The entities of this kind, in drawing order; the n-th one by default the first. */
const find = (model: DocumentModel, type: string, n = 0): Entity =>
  [...model.entities()].filter((e) => e.type === type)[n]!;

const DICTIONARIES = {
  IMAGEDEF: CadDictionary.acadImageDict,
  PDFDEFINITION: CadDictionary.acadPdfDefinitions,
  MLINESTYLE: CadDictionary.acadMLineStyle,
} as const;

/** The handle of the named object of the file (Triya does not map these objects' names). */
function objectNamed(type: keyof typeof DICTIONARIES, name: string): string {
  const dict = readCadDocument(FILE).rootDictionary!.getEntry<CadDictionary>(DICTIONARIES[type]);
  return dict!.getEntry(name)!.handle.toString(16).toUpperCase();
}

/** Geometry values compared to 9 digits, −0 as 0, angles mod 2π. */
function expectGeometry(actual: EntityGeometry | undefined, expected: EntityGeometry): void {
  const round = (v: unknown, k = ''): unknown =>
    typeof v === 'number'
      ? Math.round((/angle|rotation/i.test(k) ? v % (2 * Math.PI) : v) * 1e9) / 1e9 + 0
      : Array.isArray(v)
        ? v.map((x) => round(x, k))
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([key, x]) => [key, round(x, key)]))
          : v;
  expect(round(actual)).toEqual(round(expected));
}

const P = (x: number, y: number) => ({ x, y });
const MINUS_Z = { x: 0, y: 0, z: -1 };

/** `g` with `changes` merged in; an undefined change drops the field. */
function changed(g: EntityGeometry, changes: Record<string, unknown>): EntityGeometry {
  const merged: Record<string, unknown> = { ...g, ...changes };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged as unknown as EntityGeometry;
}

describe('triyaToAcad fills, images, underlays and multilines', () => {
  it('reads the authored drawing as expected', () => {
    const model = open();
    for (const [type, n] of [
      ['HATCH', 2],
      ['IMAGE', 2],
      ['WIPEOUT', 1],
      ['PDFUNDERLAY', 2],
      ['MLINE', 1],
    ] as const) {
      expect(
        [...model.entities()].filter((e) => e.type === type),
        type,
      ).toHaveLength(n);
    }
    expect((find(model, 'HATCH').geom as HatchGeometry).loops[0]!.sources).toEqual([
      find(model, 'LWPOLYLINE').handle,
    ]);
  });

  it.each([
    [
      'HATCH',
      0,
      (g: EntityGeometry) => ({
        loops: [
          {
            ...(g as HatchGeometry).loops[0]!,
            polyline: {
              closed: true,
              vertices: [P(1, 1), P(11, 1), P(11, 11), P(1, 11)].map((p, i) => ({
                ...p,
                bulge: i === 1 ? -0.25 : 0,
              })),
            },
          },
        ],
        seedPoints: [P(6, 6), P(2, 2)],
        style: 1,
        double: true,
        elevation: -4,
        patternLines: [
          { angle: 0.5, base: P(1, 1), offset: P(-1, 1), dashes: [3, -1] },
          { angle: 2, base: P(0, 0), offset: P(1, 1), dashes: [] },
        ],
      }),
    ],
    // The gradient hatch on −Z: every edge type, mirrored.
    [
      'HATCH',
      1,
      (g: EntityGeometry) => ({
        loops: [
          {
            flags: 1,
            edges: [
              { type: 'line', start: P(-1, 0), end: P(-5, 0) },
              {
                type: 'arc',
                center: P(-5, 2),
                radius: 2,
                startAngle: 0.5,
                endAngle: 2,
                ccw: false,
              },
              {
                type: 'ellipse',
                center: P(-2, 4),
                majorAxis: P(-2, 0.5),
                ratio: 0.4,
                startAngle: 0.2,
                endAngle: 3,
                ccw: true,
              },
              {
                type: 'spline',
                degree: 2,
                knots: [0, 0, 0, 1, 1, 1],
                controlPoints: [P(0, 4), P(1, 2), P(0, 0)],
                weights: [1, 0.5, 1],
                periodic: false,
                fitPoints: [P(0, 4), P(0, 0)],
                startTangent: P(1, -1),
              },
            ],
          },
        ],
        gradient: {
          ...(g as HatchGeometry).gradient!,
          name: 'CYLINDER',
          angle: 1,
          shift: 0.25,
          singleColor: true,
          tint: 0.5,
          colors: [{ value: 0, color: { kind: 'rgb', r: 10, g: 20, b: 30 } }],
        },
        seedPoints: [P(-2, 2)],
      }),
    ],
    // Back from −Z to +Z, turned into a pattern fill.
    [
      'HATCH',
      1,
      () => ({
        normal: undefined,
        elevation: 5,
        gradient: undefined,
        solid: false,
        pattern: 'ANSI37',
        patternType: 1,
        patternAngle: 0.75,
        patternScale: 2,
        patternLines: [{ angle: 0.75, base: P(0, 0), offset: P(0, 3), dashes: [] }],
      }),
    ],
    [
      'IMAGE',
      0,
      () => ({
        position: P(3, 4),
        elevation: 2,
        u: P(0, 0.02),
        v: P(-0.02, 0),
        size: P(320, 240),
        displayFlags: 15,
        clipping: true,
        brightness: 70,
        contrast: 30,
        fade: 20,
        clip: { type: 'polygon', vertices: [P(0, 0), P(320, 0), P(160, 240)], inverted: true },
      }),
    ],
    // An image mirrored onto −Z: its normal is u × v.
    ['IMAGE', 1, () => ({ u: P(0, 0.01), v: P(0.01, 0), normal: { x: 0, y: 0, z: -1e-4 } })],
    [
      'WIPEOUT',
      0,
      () => ({
        position: P(-1, -1),
        u: P(2, 0),
        v: P(0, 3),
        clip: { type: 'rectangle', vertices: [P(-0.5, -0.5), P(0.5, 0.5)], inverted: false },
      }),
    ],
    [
      'PDFUNDERLAY',
      0,
      () => ({
        position: P(7, 8),
        elevation: 1,
        scale: { x: 2, y: 2, z: 1 },
        rotation: 1.25,
        flags: 10,
        contrast: 60,
        fade: 30,
      }),
    ],
    ['PDFUNDERLAY', 1, () => ({ position: P(-7, 8), rotation: 2.5, elevation: -1 })],
    [
      'MLINE',
      0,
      (g: EntityGeometry) => ({
        scale: 2,
        justification: 1,
        flags: 1 | 2 | 8,
        start: P(1, 1),
        elevation: 6,
        vertices: [
          ...(g as Extract<EntityGeometry, { kind: 'MLINE' }>).vertices,
          {
            position: P(10, 10),
            direction: P(-1, 0),
            miter: P(0, 1),
            elements: [
              { parameters: [1, 0], fillParameters: [] },
              { parameters: [-1, 0], fillParameters: [0.5] },
            ],
          },
        ],
      }),
    ],
  ] as const)('writes an edited %s (#%i) so it maps back to the edit', (type, n, changes) => {
    const model = open();
    const e = find(model, type, n);
    const next = changed(e.geom, changes(e.geom));
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));

    expectGeometry(reopened(save(model), e.handle)?.geom, next);
  });

  it('writes an underlay’s normal and clip boundary to DWG and DXF (M1-83)', () => {
    for (const changes of [
      { clip: [P(0, 0), P(4, 0), P(4, 3)] },
      { rotation: 0.5, upsideDown: true, normal: MINUS_Z },
    ]) {
      const model = open();
      const e = find(model, 'PDFUNDERLAY');
      const next = changed(e.geom, changes);
      edit(model, (b) => b.updateEntity(e.id, { geom: next }));

      expectGeometry(reopened(save(model, 'dwg'), e.handle)?.geom, next);
      expectGeometry(reopened(save(model), e.handle)?.geom, next);
    }
  });

  it('keeps the stored pattern lines when only the pattern angle and scale change', () => {
    const model = open();
    const e = find(model, 'HATCH');
    const next = changed(e.geom, { patternAngle: 1, patternScale: 3 });
    edit(model, (b) => b.updateEntity(e.id, { geom: next }));

    expectGeometry(reopened(save(model), e.handle)?.geom, next);
  });

  it('keeps an associative loop’s boundary objects and the other loops as read', () => {
    const model = open();
    const e = find(model, 'HATCH');
    const g = e.geom as HatchGeometry;
    const added = { flags: 1, edges: [{ type: 'line', start: P(2, 2), end: P(3, 3) }] };
    edit(model, (b) =>
      b.updateEntity(e.id, { geom: { ...g, loops: [...g.loops, added] } as EntityGeometry }),
    );
    const h = readCadDocument(save(model)).getCadObject(Number.parseInt(e.handle, 16)) as Hatch;

    expect(h.paths[0]!.entities.map((x) => x.handle.toString(16).toUpperCase())).toEqual([
      find(model, 'LWPOLYLINE').handle,
    ]);
    expect(h.paths[1]!.entities).toEqual([]);
  });

  it('moves an image to another definition with its IMAGEDEF_REACTOR', () => {
    const model = open();
    const e = find(model, 'IMAGE');
    const plan = objectNamed('IMAGEDEF', 'plan');
    edit(model, (b) => b.updateEntity(e.id, { geom: changed(e.geom, { definition: plan }) }));
    const doc = readCadDocument(save(model));
    const im = doc.getCadObject(Number.parseInt(e.handle, 16)) as RasterImage;
    const reactor = im.definitionReactor!;
    const def = (name: string) =>
      doc.getCadObject(Number.parseInt(objectNamed('IMAGEDEF', name), 16)) as ImageDefinition;

    expect(im.definition).toBe(def('plan'));
    expect(def('plan').reactors).toContain(reactor);
    expect(def('photo').reactors).not.toContain(reactor);
  });

  it('adds new hatches, images, wipeouts, underlays and multilines under the engine handles', () => {
    const model = open();
    const space = find(model, 'MLINE').owner;
    const layer = find(model, 'MLINE').layer;
    const imageGeom = changed(find(model, 'IMAGE').geom, { position: P(50, 50) });
    const geoms: EntityGeometry[] = [
      {
        kind: 'HATCH',
        pattern: 'SOLID',
        solid: true,
        associative: false,
        style: 0,
        patternType: 1,
        // DXF states the angle and scale (52, 41) for pattern fills only, so a solid fill reads
        // back with the reader's 0 and 0, which on −Z is the WCS angle π.
        patternAngle: Math.PI,
        patternScale: 0,
        double: false,
        loops: [
          {
            flags: 1,
            edges: [
              { type: 'arc', center: P(0, 0), radius: 1, startAngle: 0, endAngle: 0, ccw: true },
            ],
          },
        ],
        patternLines: [],
        seedPoints: [P(0, 0)],
        elevation: 1,
        normal: MINUS_Z,
      },
      {
        kind: 'HATCH',
        pattern: 'ANSI31',
        solid: false,
        associative: false,
        style: 1,
        patternType: 1,
        patternAngle: 0.5,
        patternScale: 2,
        double: false,
        loops: [
          {
            flags: 3,
            polyline: {
              closed: true,
              vertices: [P(0, 0), P(4, 0), P(4, 4)].map((p) => ({ ...p, bulge: 0 })),
            },
          },
        ],
        patternLines: [{ angle: 1.285, base: P(0, 0), offset: P(-4.4, 4.4), dashes: [] }],
        seedPoints: [],
      },
      imageGeom,
      {
        kind: 'WIPEOUT',
        position: P(5, 5),
        u: P(1, 0),
        v: P(0, 1),
        size: P(1, 1),
        displayFlags: 7,
        clipping: true,
        brightness: 50,
        contrast: 50,
        fade: 0,
        clip: {
          type: 'polygon',
          vertices: [P(-0.5, -0.5), P(0.5, -0.5), P(0, 0.5)],
          inverted: false,
        },
      },
      {
        kind: 'PDFUNDERLAY',
        definition: objectNamed('PDFDEFINITION', 'sheet-2'),
        position: P(1, 1),
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0.5,
        flags: 2,
        contrast: 100,
        fade: 0,
        clip: [],
      },
      {
        // M1-83: a −Z underlay with an inverted polygonal clip survives a DXF save.
        kind: 'PDFUNDERLAY',
        definition: objectNamed('PDFDEFINITION', 'sheet-1'),
        position: P(-2, 3),
        scale: { x: 2, y: 2, z: 1 },
        rotation: 1,
        upsideDown: true,
        flags: 1 | 2 | 16,
        contrast: 100,
        fade: 0,
        clip: [P(0, 0), P(4, 0), P(4, 3), P(1, 2)],
        normal: MINUS_Z,
      },
      {
        kind: 'MLINE',
        style: objectNamed('MLINESTYLE', 'TRIPLE'),
        scale: 1,
        justification: 0,
        flags: 1,
        start: P(0, 0),
        vertices: [P(0, 0), P(5, 0)].map((position) => ({
          position,
          direction: P(1, 0),
          miter: P(0, 1),
          elements: [1, 0, -1].map((o) => ({ parameters: [o, 0], fillParameters: [] })),
        })),
      },
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
    // The writer gives the new image the IMAGEDEF_REACTOR AutoCAD links it to its file with.
    const im = readCadDocument(bytes).getCadObject(Number.parseInt(added[2]!.handle, 16));
    expect((im as RasterImage).definitionReactor?.owner).toBe(im);
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const geom = (m: DocumentModel, type: string, n = 0) => find(m, type, n).geom;
    const cases: ((b: ChangeSetBuilder, m: DocumentModel) => void)[] = [
      (b, m) => {
        // An associative hatch left without boundary objects, which still point at it (the
        // accepted changes are in export-hatch-boundaries.test.ts).
        const g = geom(m, 'HATCH') as HatchGeometry;
        const loops = [{ ...g.loops[0]!, sources: undefined }];
        b.updateEntity(find(m, 'HATCH').id, { geom: changed(g, { loops }) });
      },
      (b, m) => {
        // Boundary objects on a hatch that is not associative.
        const g = geom(m, 'HATCH', 1) as HatchGeometry;
        const loops = [{ ...g.loops[0]!, sources: [find(m, 'LWPOLYLINE').handle] }];
        b.updateEntity(find(m, 'HATCH', 1).id, { geom: changed(g, { loops }) });
      },
      (b, m) => {
        b.updateEntity(find(m, 'HATCH').id, { geom: changed(geom(m, 'HATCH'), { thickness: 1 }) });
      },
      (b, m) => {
        const normal = { x: 0, y: 1, z: 0 };
        b.updateEntity(find(m, 'HATCH').id, { geom: changed(geom(m, 'HATCH'), { normal }) });
      },
      (b, m) => {
        // A spline edge whose knots do not fit its control points.
        const g = geom(m, 'HATCH', 1) as HatchGeometry;
        const edges = g.loops[0]!.edges!.map((x) =>
          x.type === 'spline' ? { ...x, knots: [0, 1] } : x,
        );
        b.updateEntity(find(m, 'HATCH', 1).id, {
          geom: changed(g, { loops: [{ ...g.loops[0]!, edges }] }),
        });
      },
      (b, m) => {
        const g = geom(m, 'HATCH', 1) as HatchGeometry;
        const gradient = {
          ...g.gradient!,
          colors: [
            { value: 0, color: { kind: 'rgb', r: 1, g: 2, b: 3, bookName: 'B', colorName: 'C' } },
          ],
        };
        b.updateEntity(find(m, 'HATCH', 1).id, { geom: changed(g, { gradient }) });
      },
      (b, m) => {
        // AutoCAD has no IMAGE without its IMAGEDEF.
        b.updateEntity(find(m, 'IMAGE').id, {
          geom: changed(geom(m, 'IMAGE'), { definition: undefined }),
        });
      },
      (b, m) => {
        const definition = objectNamed('MLINESTYLE', 'TRIPLE');
        b.updateEntity(find(m, 'IMAGE').id, { geom: changed(geom(m, 'IMAGE'), { definition }) });
      },
      (b, m) => {
        const definition = objectNamed('IMAGEDEF', 'plan');
        b.updateEntity(find(m, 'WIPEOUT').id, {
          geom: changed(geom(m, 'WIPEOUT'), { definition }),
        });
      },
      (b, m) => {
        b.updateEntity(find(m, 'IMAGE').id, { geom: changed(geom(m, 'IMAGE'), { fade: 101 }) });
      },
      (b, m) => {
        // u × v points down, but the image says +Z.
        b.updateEntity(find(m, 'IMAGE').id, {
          geom: changed(geom(m, 'IMAGE'), { u: P(0, 0.01), v: P(0.01, 0) }),
        });
      },
      (b, m) => {
        b.updateEntity(find(m, 'IMAGE').id, {
          geom: changed(geom(m, 'IMAGE'), { u: P(1, 0), v: P(2, 0) }),
        });
      },
      (b, m) => {
        const clip = { type: 'rectangle', vertices: [P(0, 0), P(1, 1), P(2, 0)], inverted: false };
        b.updateEntity(find(m, 'IMAGE').id, { geom: changed(geom(m, 'IMAGE'), { clip }) });
      },
      (b, m) => {
        const scale = { x: 0, y: 1, z: 1 };
        b.updateEntity(find(m, 'PDFUNDERLAY').id, {
          geom: changed(geom(m, 'PDFUNDERLAY'), { scale }),
        });
      },
      (b, m) => {
        // An underlay's Y axis is reversed exactly on −Z.
        b.updateEntity(find(m, 'PDFUNDERLAY').id, {
          geom: changed(geom(m, 'PDFUNDERLAY'), { upsideDown: true }),
        });
      },
      (b, m) => {
        b.updateEntity(find(m, 'PDFUNDERLAY').id, {
          geom: changed(geom(m, 'PDFUNDERLAY'), { definition: 'FFFFF' }),
        });
      },
      (b, m) => {
        b.updateEntity(find(m, 'MLINE').id, {
          geom: changed(geom(m, 'MLINE'), { style: objectNamed('MLINESTYLE', 'TRIPLE') }),
        });
      },
      (b, m) => {
        b.updateEntity(find(m, 'MLINE').id, {
          geom: changed(geom(m, 'MLINE'), { style: undefined }),
        });
      },
      (b, m) => {
        const normal = { x: 1, y: 0, z: 0 };
        b.updateEntity(find(m, 'MLINE').id, { geom: changed(geom(m, 'MLINE'), { normal }) });
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
});
