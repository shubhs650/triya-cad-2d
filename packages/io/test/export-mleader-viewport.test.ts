// TriyaToAcad writers for MULTILEADER and VIEWPORT (M1-75 part 5). Drawings are authored in
// memory with acad-ts and saved once, so "the file" is real bytes; the corpus-wide edit is in
// packages/testkit/src/export/export.corpus.test.ts. Every corpus multileader is mtext on +Z
// with one branch, so block content, −Z planes and branch edits are covered here.
import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  CadDocument,
  Circle,
  Color,
  Layer,
  Layout,
  LeaderLine,
  LeaderRoot,
  LineType,
  MultiLeader,
  MultiLeaderStyle,
  TextStyle,
  Viewport,
  VisualStyle,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type MultiLeaderGeometry,
  type ViewportGeometry,
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

function root(points: readonly XYZ[], connection: XYZ, index = 0): LeaderRoot {
  const r = new LeaderRoot();
  r.leaderIndex = index;
  r.connectionPoint = connection;
  r.direction = new XYZ(1, 0, 0);
  r.landingDistance = 2;
  const l = new LeaderLine();
  l.index = 0;
  l.points = [...points];
  r.lines = [l];
  return r;
}

/**
 * One drawing with: a text MULTILEADER at elevation 2 and a block MULTILEADER (style STANDARD,
 * text styles Standard and NOTES, content block TAG, arrowhead block DOT, linetype DASHED), and
 * in the layout's paper space the paper viewport and one model viewport freezing layer HIDDEN
 * (layers HIDDEN and NOTES, visual styles 2dWireframe and Conceptual).
 */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  const dicts = doc.rootDictionary!;
  const mleaderStyles = dicts.getEntry<CadDictionary>(CadDictionary.acadMLeaderStyle)!;
  const style = new MultiLeaderStyle('STANDARD');
  mleaderStyles.add(style);
  mleaderStyles.add(new MultiLeaderStyle('CALLOUT'));
  const visualStyles = dicts.getEntry<CadDictionary>(CadDictionary.acadVisualStyle)!;
  for (const name of ['2dWireframe', 'Conceptual']) visualStyles.add(new VisualStyle(name));
  doc.textStyles!.add(new TextStyle('NOTES'));
  for (const name of ['HIDDEN', 'NOTES']) doc.layers!.add(new Layer(name));
  const dashed = new LineType('DASHED');
  doc.lineTypes!.add(dashed);
  for (const name of ['TAG', 'DOT']) {
    const b = new BlockRecord(name);
    const c = new Circle();
    c.radius = 1;
    b.entities.add(c);
    doc.blockRecords!.add(b);
  }

  const text = new MultiLeader();
  const tc = text.contextData;
  tc.hasTextContents = true;
  tc.textLabel = 'NOTE 1';
  tc.textNormal = new XYZ(0, 0, 1);
  tc.textLocation = new XYZ(10, 5, 2);
  tc.direction = new XYZ(1, 0, 0);
  tc.textHeight = 2.5;
  tc.lineSpacingFactor = 1;
  tc.lineSpacing = 1;
  tc.textAttachmentPoint = 1;
  tc.flowDirection = 1;
  tc.textColor = Color.byBlock;
  tc.basePoint = new XYZ(0, 0, 2);
  tc.contentBasePoint = new XYZ(9, 4, 2);
  tc.arrowheadSize = 0.18;
  tc.landingGap = 0.09;
  tc.leaderRoots = [root([new XYZ(0, 0, 2), new XYZ(4, 4, 2)], new XYZ(8, 4, 2))];
  text.contentType = 2 as never;
  text.arrowheadSize = 0.18;
  text.landingDistance = 2;
  text.lineColor = Color.byBlock;

  const block = new MultiLeader();
  const bc = block.contextData;
  bc.hasContentsBlock = true;
  bc.blockContentNormal = new XYZ(0, 0, 1);
  bc.blockContentLocation = new XYZ(30, 10, 0);
  bc.blockContentScale = new XYZ(1, 1, 1);
  bc.blockContentColor = Color.byBlock;
  bc.contentBasePoint = new XYZ(29, 10, 0);
  bc.leaderRoots = [root([new XYZ(20, 0, 0)], new XYZ(28, 10, 0))];
  block.contentType = 1 as never;
  block.lineColor = Color.byBlock;

  const paper = new Viewport();
  paper.id = 1;
  paper.center = new XYZ(148.5, 105, 0);
  paper.width = 297;
  paper.height = 210;
  paper.viewCenter = new XY(148.5, 105);
  paper.viewHeight = 210;
  paper.status = 0x8060 as never;
  const view = new Viewport();
  view.id = 2;
  view.center = new XYZ(100, 100, 0);
  view.width = 80;
  view.height = 60;
  view.viewCenter = new XY(20, 15);
  view.viewHeight = 30;
  view.lensLength = 50;
  view.status = 0x8060 as never;
  view.styleSheetName = 'monochrome.ctb';

  // A new acad-ts document has no LAYOUT objects; AutoCAD links each space block to one.
  const layouts = dicts.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
  for (const [name, space] of [
    ['Model', doc.modelSpace!],
    ['Layout1', doc.paperSpace!],
  ] as const) {
    const layout = new Layout(name);
    layouts.add(layout);
    layout.associatedBlock = space;
  }
  for (const e of [text, block]) doc.entities!.add(e);
  for (const v of [paper, view]) doc.paperSpace!.entities.add(v);
  // References resolve through the document's collections, so they are set once it has them.
  for (const m of [text, block]) m.style = style;
  tc.textStyle = doc.textStyles!.get('Standard');
  text.textStyle = tc.textStyle;
  bc.blockContent = doc.blockRecords!.get('TAG');
  block.blockContentId = bc.blockContent;
  view.frozenLayers = [doc.layers!.get('HIDDEN')];
  view.visualStyle = visualStyles.getEntry<VisualStyle>('2dWireframe')!;
  // DWG: acad-ts's DXF reader drops a multileader's arrowhead and content block (M1-84).
  return writeCadDocument(doc, { format: 'dwg' });
}

const FILE = drawing();

function open(): DocumentModel {
  return DocumentModel.create(documentInit(readCadDocument(FILE)));
}

/**
 * The mapping without the header dates acad-ts makes up on every read of a DWG that has none
 * (export.ts VOLATILE_HEADER).
 */
function stable(doc: ReturnType<typeof readCadDocument>) {
  const init = documentInit(doc);
  const header = new Map(init.header ?? []);
  for (const k of ['$TDCREATE', '$TDUCREATE', '$TDUPDATE', '$TDUUPDATE']) header.delete(k);
  return { ...init, header };
}

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const save = (model: DocumentModel, format: CadFormat = 'dxf'): Uint8Array =>
  exportDocument(readCadDocument(FILE), model, { format });

function reopened(bytes: Uint8Array, handle: string): EntityInit | undefined {
  return documentInit(readCadDocument(bytes)).entities?.find((e) => e.handle === handle);
}

const find = (model: DocumentModel, type: string, n = 0): Entity =>
  [...model.entities()].filter((e) => e.type === type)[n]!;

/** The handle of a named record or dictionary entry of the file. */
function handleOf(
  kind: 'block' | 'style' | 'layer' | 'linetype' | 'mleaderstyle' | 'visualstyle',
  name: string,
): string {
  const doc = readCadDocument(FILE);
  const o =
    kind === 'block'
      ? doc.blockRecords!.get(name)
      : kind === 'style'
        ? doc.textStyles!.get(name)
        : kind === 'layer'
          ? doc.layers!.get(name)
          : kind === 'linetype'
            ? doc.lineTypes!.get(name)
            : doc
                .rootDictionary!.getEntry<CadDictionary>(
                  kind === 'mleaderstyle'
                    ? CadDictionary.acadMLeaderStyle
                    : CadDictionary.acadVisualStyle,
                )!
                .getEntry(name)!;
  return o.handle.toString(16).toUpperCase();
}

/** Geometry values compared to 9 digits, −0 as 0, angles mod 2π. */
function expectGeometry(actual: EntityGeometry | undefined, expected: EntityGeometry): void {
  const round = (v: unknown, k = ''): unknown =>
    typeof v === 'number'
      ? Math.round((/angle|rotation|twist/i.test(k) ? v % (2 * Math.PI) : v) * 1e9) / 1e9 + 0
      : Array.isArray(v)
        ? v.map((x) => round(x, k))
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([key, x]) => [key, round(x, key)]))
          : v;
  expect(round(actual)).toEqual(round(expected));
}

const P = (x: number, y: number) => ({ x, y });
const MINUS_Z = { x: 0, y: 0, z: -1 };

function changed(g: EntityGeometry, changes: Record<string, unknown>): EntityGeometry {
  const merged: Record<string, unknown> = { ...g, ...changes };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged as unknown as EntityGeometry;
}

const ml = (g: EntityGeometry): MultiLeaderGeometry => g as MultiLeaderGeometry;

/**
 * What acad-ts reads back: its DXF reader drops a multileader's arrowhead (342), content block
 * (344 and context 341) and leader line indexes (91), which the DXF writer writes (M1-84).
 */
function readBack(g: EntityGeometry, format: CadFormat): EntityGeometry {
  if (format !== 'dxf' || g.kind !== 'MULTILEADER') return g;
  const { block: _b, ...block } = g.block ?? { block: undefined };
  return changed(g, {
    arrowhead: undefined,
    ...(g.block ? { block } : {}),
    branches: g.branches.map((b) => ({ ...b, lines: b.lines.map((l) => ({ ...l, index: 0 })) })),
  });
}

describe('triyaToAcad multileaders and viewports', () => {
  it('reads the authored drawing as expected', () => {
    const model = open();
    expect([...model.entities()].filter((e) => e.type === 'MULTILEADER')).toHaveLength(2);
    expect([...model.entities()].filter((e) => e.type === 'VIEWPORT')).toHaveLength(2);
    const g = ml(find(model, 'MULTILEADER').geom);
    expect(g.text?.content).toBe('NOTE 1');
    expect(g.elevation).toBe(2);
    expect(ml(find(model, 'MULTILEADER', 1).geom).block?.block).toBe(handleOf('block', 'TAG'));
    expect((find(model, 'VIEWPORT', 1).geom as ViewportGeometry).frozenLayers).toEqual([
      handleOf('layer', 'HIDDEN'),
    ]);
  });

  const cases: [string, string, number, (g: EntityGeometry) => Record<string, unknown>][] = [
    [
      'every MULTILEADER field, a branch and a leader line added',
      'MULTILEADER',
      0,
      (g) => ({
        style: handleOf('mleaderstyle', 'CALLOUT'),
        overrideFlags: 1 | 4 | 32,
        pathType: 2,
        lineColor: { kind: 'rgb', r: 10, g: 20, b: 30 },
        linetype: handleOf('linetype', 'DASHED'),
        lineweight: 35,
        landing: false,
        dogleg: false,
        doglegLength: 3,
        arrowhead: handleOf('block', 'DOT'),
        arrowheadSize: 0.5,
        drawnArrowheadSize: 0.25,
        scale: 2,
        textLeftAttachment: 3,
        textRightAttachment: 5,
        textTopAttachment: 9,
        textBottomAttachment: 10,
        textAttachmentDirection: 1,
        textAngleType: 2,
        textAlignment: 1,
        textFrame: true,
        contentBase: P(12, 6),
        landingGap: 0.5,
        text: {
          ...ml(g).text!,
          content: '\\fArial|b1;NOTE\\P2',
          style: handleOf('style', 'NOTES'),
          position: P(13, 7),
          rotation: 0.5,
          height: 3.5,
          width: 20,
          boundaryHeight: 8,
          lineSpacing: 1.5,
          lineSpacingStyle: 2,
          attachment: 7,
          flow: 3,
          color: { kind: 'aci', index: 3 },
        },
        branches: [
          {
            ...ml(g).branches[0]!,
            connection: P(11, 6),
            direction: P(-1, 0),
            doglegLength: 4,
            lines: [
              { index: 0, vertices: [P(1, 1), P(5, 5)] },
              { index: 1, vertices: [P(1, 8)] },
            ],
          },
          {
            index: 1,
            connection: P(15, 6),
            direction: P(1, 0),
            doglegLength: 2,
            lines: [{ index: 2, vertices: [P(20, 0), P(18, 3)] }],
          },
        ],
        elevation: 4,
      }),
    ],
    [
      'a MULTILEADER mirrored onto −Z',
      'MULTILEADER',
      0,
      (g) => ({
        normal: MINUS_Z,
        text: { ...ml(g).text!, upsideDown: true, rotation: Math.PI },
      }),
    ],
    [
      'block content',
      'MULTILEADER',
      1,
      (g) => ({
        block: {
          block: handleOf('block', 'DOT'),
          position: P(31, 12),
          scale: { x: 2, y: 2, z: 1 },
          rotation: 0.75,
          color: { kind: 'aci', index: 5 },
        },
        branches: [{ ...ml(g).branches[0]!, lines: [{ index: 0, vertices: [P(21, 1)] }] }],
      }),
    ],
    [
      'block content turned into text',
      'MULTILEADER',
      1,
      () => ({
        contentType: 2,
        block: undefined,
        text: {
          content: 'TEXT',
          style: handleOf('style', 'Standard'),
          position: P(30, 10),
          rotation: 0,
          height: 2,
          width: 0,
          boundaryHeight: 0,
          lineSpacing: 1,
          lineSpacingStyle: 1,
          attachment: 1,
          flow: 1,
          color: { kind: 'byBlock' },
        },
      }),
    ],
    [
      'every VIEWPORT field',
      'VIEWPORT',
      1,
      () => ({
        center: P(120, 90),
        width: 100,
        height: 50,
        flags: 0x8060 | 0x4000,
        viewCenter: P(40, -10),
        viewHeight: 25,
        viewDirection: { x: 1, y: -1, z: 1 },
        viewTarget: { x: 5, y: 6, z: 7 },
        twist: 0.25,
        lensLength: 35,
        frontClip: 1,
        backClip: -1,
        frozenLayers: [handleOf('layer', 'NOTES'), handleOf('layer', 'HIDDEN')],
        renderMode: 2,
      }),
    ],
    // DWG does not store DXF 68 (AutoCAD derives it from the on flag and the stacking order),
    // and acad-ts writes no DWG style sheet or visual style (M1-85).
    [
      'a VIEWPORT’s DXF-only fields',
      'VIEWPORT',
      1,
      () => ({
        status: 2,
        plotStyleSheet: 'acad.ctb',
      }),
    ],
    ['a VIEWPORT thawing its layers', 'VIEWPORT', 1, () => ({ frozenLayers: [] })],
  ];

  for (const format of ['dxf', 'dwg'] as const) {
    const these = cases.filter(([what]) => format === 'dxf' || !/DXF-only/.test(what));
    it.each(these)(`writes %s to ${format} so it maps back`, (_what, type, n, changes) => {
      const model = open();
      const e = find(model, type, n);
      const next = changed(e.geom, changes(e.geom));
      edit(model, (b) => b.updateEntity(e.id, { geom: next }));

      expectGeometry(reopened(save(model, format), e.handle)?.geom, readBack(next, format));
    });
  }

  it('keeps a leader line’s own overrides and break points when its vertices move', () => {
    const model = open();
    const e = find(model, 'MULTILEADER');
    const g = ml(e.geom);
    const branches = [{ ...g.branches[0]!, lines: [{ index: 0, vertices: [P(-1, -1), P(4, 4)] }] }];
    edit(model, (b) => b.updateEntity(e.id, { geom: changed(g, { branches }) }));
    const original = readCadDocument(FILE).getCadObject(Number.parseInt(e.handle, 16));
    const saved = readCadDocument(save(model)).getCadObject(Number.parseInt(e.handle, 16));
    const line = (m: unknown) => (m as MultiLeader).contextData.leaderRoots[0]!.lines[0]!;

    expect(line(saved).points[0]).toEqual(new XYZ(-1, -1, 2));
    expect(line(saved).arrowheadSize).toBe(line(original).arrowheadSize);
    expect((saved as MultiLeader).contextData.leaderRoots[0]!.landingDistance).toBe(2);
  });

  it('adds new multileaders and viewports under the engine handles', () => {
    const model = open();
    const text = find(model, 'MULTILEADER');
    const view = find(model, 'VIEWPORT', 1);
    const geoms: [Entity, EntityGeometry][] = [
      [text, changed(text.geom, { contentBase: P(50, 50), elevation: undefined })],
      [
        text,
        changed(find(model, 'MULTILEADER', 1).geom, {
          normal: MINUS_Z,
          block: { ...ml(find(model, 'MULTILEADER', 1).geom).block!, position: P(-30, 10) },
        }),
      ],
      [view, changed(view.geom, { id: 3, center: P(200, 50), frozenLayers: [] })],
    ];
    const added: Entity[] = [];
    edit(model, (b) => {
      for (const [like, geom] of geoms) {
        added.push(b.addEntity({ owner: like.owner, layer: like.layer, geom }));
      }
    });
    for (const format of ['dxf', 'dwg'] as const) {
      const bytes = save(model, format);
      for (const e of added) {
        const back = reopened(bytes, e.handle);
        expect(back, `${format} ${e.type}`).toBeDefined();
        expectGeometry(back!.geom, readBack(e.geom, format));
      }
    }
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const geom = (m: DocumentModel, type: string, n = 0) => find(m, type, n).geom;
    const update =
      (type: string, n: number, changes: (g: EntityGeometry) => Record<string, unknown>) =>
      (b: ChangeSetBuilder, m: DocumentModel) => {
        const e = find(m, type, n);
        b.updateEntity(e.id, { geom: changed(e.geom, changes(geom(m, type, n))) });
      };
    const cases: ((b: ChangeSetBuilder, m: DocumentModel) => void)[] = [
      update('MULTILEADER', 0, () => ({ normal: { x: 0, y: 1, z: 0 } })),
      update('MULTILEADER', 0, () => ({ style: undefined })),
      update('MULTILEADER', 0, () => ({ style: handleOf('style', 'NOTES') })),
      update('MULTILEADER', 0, () => ({ linetype: 'FFFFF' })),
      update('MULTILEADER', 0, () => ({ arrowhead: handleOf('layer', 'NOTES') })),
      update('MULTILEADER', 0, (g) => ({ text: { ...ml(g).text!, style: 'FFFFF' } })),
      // AutoCAD has no mtext multileader without its text, nor block one without its block.
      update('MULTILEADER', 0, () => ({ text: undefined })),
      update('MULTILEADER', 1, (g) => ({ block: { ...ml(g).block!, block: undefined } })),
      update('MULTILEADER', 1, (g) => ({ block: { ...ml(g).block!, block: 'FFFFF' } })),
      // An annotative multileader needs its scale representations (left in M1-75).
      update('MULTILEADER', 0, () => ({ annotative: true })),
      update('MULTILEADER', 0, () => ({
        lineColor: { kind: 'rgb', r: 1, g: 2, b: 3, bookName: 'B', colorName: 'C' },
      })),
      // The text runs upside down exactly when the leader plane is −Z, as for MTEXT.
      update('MULTILEADER', 0, (g) => ({ text: { ...ml(g).text!, upsideDown: true } })),
      update('MULTILEADER', 0, () => ({ thickness: 1 })),
      // The clip boundary entity points back at the viewport through its reactors.
      update('VIEWPORT', 1, () => ({ clipBoundary: find(open(), 'MULTILEADER').handle })),
      update('VIEWPORT', 1, () => ({ frozenLayers: ['FFFFF'] })),
      update('VIEWPORT', 1, () => ({ visualStyle: handleOf('layer', 'NOTES') })),
      (b, m) => {
        // A viewport inside a block definition.
        b.addEntity({
          owner: handleOf('block', 'TAG'),
          layer: find(m, 'VIEWPORT').layer,
          geom: changed(geom(m, 'VIEWPORT', 1), { id: 3 }),
        });
      },
      (b, m) => {
        // A viewport belongs to a layout's paper space.
        b.addEntity({
          owner: find(m, 'MULTILEADER').owner,
          layer: find(m, 'MULTILEADER').layer,
          geom: changed(geom(m, 'VIEWPORT', 1), { id: 3 }),
        });
      },
    ];
    for (const f of cases) {
      const model = open();
      const init = stable(readCadDocument(FILE));
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(FILE);

      expect(() => triyaToAcad(doc, model), String(cases.indexOf(f))).toThrow(
        UnsupportedChangeError,
      );
      expect(stable(doc)).toEqual(init);
    }
  });

  it('writes a viewport’s visual style', () => {
    // acad-ts writes DXF VISUALSTYLE objects only as read from DXF, so this one, from a DWG,
    // would not reach a DXF save; the written reference is checked on the document instead.
    const model = open();
    const e = find(model, 'VIEWPORT', 1);
    const visualStyle = handleOf('visualstyle', 'Conceptual');
    edit(model, (b) => b.updateEntity(e.id, { geom: changed(e.geom, { visualStyle }) }));
    const doc = readCadDocument(FILE);
    triyaToAcad(doc, model, 'dxf');

    expect((doc.getCadObject(Number.parseInt(e.handle, 16)) as Viewport).visualStyle?.name).toBe(
      'Conceptual',
    );
  });

  it('refuses a viewport’s style sheet and visual style on a DWG save (M1-85)', () => {
    for (const changes of [
      { plotStyleSheet: 'acad.ctb' },
      { visualStyle: handleOf('visualstyle', 'Conceptual') },
    ]) {
      const model = open();
      const e = find(model, 'VIEWPORT', 1);
      edit(model, (b) => b.updateEntity(e.id, { geom: changed(e.geom, changes) }));

      expect(() => save(model, 'dwg'), JSON.stringify(changes)).toThrow(/VIEWPORT .*M1-85/);
      expect(() => save(model, 'dxf')).not.toThrow();
    }
  });
});
