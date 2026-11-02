// M1-52 part 1: a MULTILEADER as the parts AutoCAD draws, and its bounds as their union.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  entityBounds,
  multiLeaderParts,
  partEntity,
  SpatialIndex,
  toleranceForSize,
  type EntityGeometry,
  type EntityInit,
  type HeaderValue,
  type InsertGeometry,
  type LwPolylineGeometry,
  type MultiLeaderGeometry,
  type SolidGeometry,
} from '../../src/index';
import {
  blockRecord,
  entityInit,
  LAYER_0,
  layer,
  linetype,
  lineGeom,
  MODEL_SPACE,
  PAPER_SPACE,
} from '../model/fixtures';

const BYBLOCK_LT = '13';
const DASHED = '15';
const TICK = '30';
const CUSTOM = '31';
const STYLE = '40';

/** Model space, the ByBlock and DASHED linetypes, an _ArchTick block and a custom arrow. */
function model(extra: EntityInit[] = []): DocumentModel {
  const blocks = [
    [MODEL_SPACE, '*Model_Space'],
    [PAPER_SPACE, '*Paper_Space'],
    [TICK, '_ArchTick'],
    [CUSTOM, 'MyArrow'],
  ] as const;
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0')],
      linetypes: [
        linetype(BYBLOCK_LT, 'ByBlock'),
        linetype('14', 'Continuous'),
        linetype(DASHED, 'DASHED'),
      ],
      blockRecords: blocks.map(([h, n]) => blockRecord(h, n)),
    },
    blocks: blocks.map(([handle, name]) => ({ handle, name, basePoint: { x: 0, y: 0 } })),
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [
      // The tick: a unit slash about the origin, as AutoCAD's _ArchTick block is drawn.
      entityInit('50', lineGeom(-0.5, -0.5, 0.5, 0.5), { owner: TICK }),
      entityInit('51', lineGeom(-1, 0, 0, 0), { owner: CUSTOM }),
      ...extra,
    ],
  });
}

/** A leader from (0, 0) up to (10, 10), landing 2.5 to the right, text at (13, 10). */
function mleader(extra: Partial<MultiLeaderGeometry> = {}): MultiLeaderGeometry {
  return {
    kind: 'MULTILEADER',
    overrideFlags: 0,
    pathType: 1,
    lineColor: { kind: 'aci', index: 1 },
    linetype: DASHED,
    lineweight: 25,
    landing: true,
    dogleg: true,
    doglegLength: 2.5,
    arrowheadSize: 3,
    drawnArrowheadSize: 3,
    contentType: 2,
    scale: 1,
    annotative: false,
    textLeftAttachment: 1,
    textRightAttachment: 1,
    textTopAttachment: 9,
    textBottomAttachment: 9,
    textAttachmentDirection: 0,
    textAngleType: 1,
    textAlignment: 0,
    textFrame: false,
    contentBase: { x: 12.5, y: 10 },
    landingGap: 0.5,
    text: {
      content: 'NOTE',
      style: '0',
      position: { x: 13, y: 11.25 },
      rotation: 0,
      height: 2.5,
      width: 0,
      boundaryHeight: 0,
      lineSpacing: 1,
      lineSpacingStyle: 1,
      attachment: 1,
      flow: 1,
      color: { kind: 'byBlock' },
    },
    branches: [
      {
        index: 0,
        connection: { x: 10, y: 10 },
        direction: { x: 1, y: 0 },
        doglegLength: 2.5,
        lines: [{ index: 0, vertices: [{ x: 0, y: 0 }] }],
      },
    ],
    ...extra,
  };
}

/** The multileader without its text content. */
function noText(extra: Partial<MultiLeaderGeometry> = {}): MultiLeaderGeometry {
  const { text: _text, ...rest } = mleader(extra);
  return rest;
}

const kinds = (parts: readonly { geom: EntityGeometry }[]) => parts.map((p) => p.geom.kind);
const s = Math.SQRT1_2;

describe('multiLeaderParts', () => {
  it('draws a closed filled arrow, the line from its back, the landing and the text', () => {
    const parts = multiLeaderParts(mleader(), model());
    expect(kinds(parts)).toEqual(['SOLID', 'LWPOLYLINE', 'LWPOLYLINE', 'MTEXT']);
    const [arrow, line, landing, text] = parts;
    // Tip at the first vertex, a third of the size wide at one size back along the line.
    const base = { x: 3 * s, y: 3 * s };
    const geom = arrow!.geom as SolidGeometry;
    expect(geom.corners[0]).toEqual({ x: 0, y: 0 });
    expect(geom.corners[1].x).toBeCloseTo(base.x - 0.5 * s);
    expect(geom.corners[1].y).toBeCloseTo(base.y + 0.5 * s);
    expect(geom.corners[2].x).toBeCloseTo(base.x + 0.5 * s);
    expect(geom.corners[2].y).toBeCloseTo(base.y - 0.5 * s);
    const v = (line!.geom as LwPolylineGeometry).vertices;
    expect(v[0]!.x).toBeCloseTo(base.x);
    expect(v[0]!.y).toBeCloseTo(base.y);
    expect(v[1]).toEqual({ x: 10, y: 10, bulge: 0 });
    expect(landing!.geom).toMatchObject({
      vertices: [
        { x: 10, y: 10 },
        { x: 12.5, y: 10 },
      ],
    });
    // Leader parts carry the leader line's colour, linetype and lineweight; text its own.
    expect(line).toMatchObject({
      color: { kind: 'aci', index: 1 },
      linetype: DASHED,
      lineweight: 25,
    });
    expect(text!.geom).toMatchObject({
      kind: 'MTEXT',
      contents: 'NOTE',
      position: { x: 13, y: 11.25 },
      attachment: 1,
    });
    expect(text!.color).toEqual({ kind: 'byBlock' });
  });

  it('runs straight to the landing end without a dogleg, and has no landing vertically', () => {
    const straight = multiLeaderParts(mleader({ dogleg: false }), model());
    expect(kinds(straight)).toEqual(['SOLID', 'LWPOLYLINE', 'MTEXT']);
    expect(straight[1]!.geom).toMatchObject({ vertices: [{}, { x: 12.5, y: 10 }] });
    const vertical = multiLeaderParts(mleader({ textAttachmentDirection: 1 }), model());
    expect(kinds(vertical)).toEqual(['SOLID', 'LWPOLYLINE', 'MTEXT']);
    expect(vertical[1]!.geom).toMatchObject({ vertices: [{}, { x: 10, y: 10 }] });
  });

  it('inserts an arrowhead block at the tip, pointing away from the line', () => {
    const tick = multiLeaderParts(mleader({ arrowhead: TICK }), model());
    expect(tick[0]!.geom).toMatchObject({
      kind: 'INSERT',
      block: TICK,
      position: { x: 0, y: 0 },
      scale: { x: 3, y: 3, z: 3 },
    });
    expect((tick[0]!.geom as InsertGeometry).rotation).toBeCloseTo((-3 * Math.PI) / 4);
    // A tick is drawn about the tip, so the line runs to it.
    expect(tick[1]!.geom).toMatchObject({ vertices: [{ x: 0, y: 0 }, {}] });
    // Any other block arrowhead: the line starts one size back.
    const custom = multiLeaderParts(mleader({ arrowhead: CUSTOM }), model());
    expect((custom[1]!.geom as LwPolylineGeometry).vertices[0]!.x).toBeCloseTo(3 * s);
    // An arrowhead block the drawing lacks falls back to closed filled.
    expect(kinds(multiLeaderParts(mleader({ arrowhead: '99' }), model()))[0]).toBe('SOLID');
  });

  it('takes the style arrowhead when the entity has none', () => {
    const m = model();
    const withStyle = DocumentModel.create({
      ...initOf(m),
      tables: { ...initOf(m).tables, mleaderStyles: [styleRecord(TICK)] },
    });
    expect(kinds(multiLeaderParts(mleader({ style: STYLE }), withStyle))[0]).toBe('INSERT');
  });

  it('draws nothing for invisible leaders but the text, and frames the text by the landing gap', () => {
    expect(kinds(multiLeaderParts(mleader({ pathType: 0 }), model()))).toEqual(['MTEXT']);
    const framed = multiLeaderParts(mleader({ textFrame: true }), model());
    expect(framed[3]!.geom).toMatchObject({ background: { flags: 16, scale: 1.2 } });
  });

  it('inserts block content at its location, scale and rotation in its colour', () => {
    const parts = multiLeaderParts(
      noText({
        contentType: 1,
        block: {
          block: CUSTOM,
          position: { x: 14, y: 10 },
          scale: { x: 2, y: 2, z: 1 },
          rotation: 0.5,
          color: { kind: 'aci', index: 3 },
        },
      }),
      model(),
    );
    expect(parts.at(-1)).toEqual({
      geom: {
        kind: 'INSERT',
        block: CUSTOM,
        position: { x: 14, y: 10 },
        scale: { x: 2, y: 2, z: 1 },
        rotation: 0.5,
        attributes: [],
      },
      color: { kind: 'aci', index: 3 },
    });
    // Text content draws only as text content (DXF 172 = 2), block content only as block (1).
    expect(kinds(multiLeaderParts(mleader({ contentType: 1 }), model())).at(-1)).toBe('LWPOLYLINE');
  });

  it('leaves spline leaders as fit-point splines', () => {
    const parts = multiLeaderParts(mleader({ pathType: 2 }), model());
    expect(kinds(parts)).toEqual(['SOLID', 'SPLINE', 'MTEXT']);
    expect(parts[1]!.geom).toMatchObject({
      controlPoints: [],
      fitPoints: [{}, { x: 10, y: 10 }],
      endTangent: { x: 1, y: 0 },
    });
  });

  it('paints a part as the owner with the part colour, linetype and lineweight unless ByBlock', () => {
    const owner = { ...entityInit('60', mleader()), id: 1 as never };
    const [, line, , text] = multiLeaderParts(mleader(), model());
    expect(partEntity(owner, line!)).toMatchObject({
      handle: '60',
      type: 'LWPOLYLINE',
      color: { kind: 'aci', index: 1 },
      linetype: DASHED,
      lineweight: 25,
    });
    expect(partEntity(owner, text!)).toMatchObject({ type: 'MTEXT', color: { kind: 'byLayer' } });
    const byBlock = multiLeaderParts(
      mleader({ linetype: BYBLOCK_LT, lineweight: 'ByBlock', lineColor: { kind: 'byBlock' } }),
      model(),
    );
    expect(partEntity(owner, byBlock[1]!)).toMatchObject({
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
    });
  });
});

describe('MULTILEADER bounds', () => {
  const tol = toleranceForSize(1000);
  it('are the union of its parts, text through the annotation provider', () => {
    const m = model();
    const ctx = {
      tol,
      tables: m,
      blockExtents: () => undefined,
      annotationBounds: () => ({ minX: 13, minY: 8.75, maxX: 20, maxY: 11.25 }),
    };
    expect(entityBounds(mleader(), ctx)).toEqual({
      kind: 'box',
      box: { minX: 0, minY: 0, maxX: 20, maxY: 11.25 },
    });
    // Without text bounds the MULTILEADER is unknown.
    expect(entityBounds(mleader(), { ...ctx, annotationBounds: () => undefined }).kind).toBe(
      'unknown',
    );
    // A spline leader is the cubic through its vertices (M1-47), bounded like the rest.
    expect(entityBounds(mleader({ pathType: 2 }), ctx).kind).toBe('box');
    expect(entityBounds(noText({ branches: [] }), ctx).kind).toBe('empty');
  });

  it('follow its arrowhead block through the spatial index', () => {
    const g = noText({
      arrowhead: TICK,
      contentType: 0,
      branches: [{ ...mleader().branches[0]!, lines: [{ index: 0, vertices: [{ x: 0, y: 10 }] }] }],
    });
    const m = model([entityInit('60', g)]);
    const index = SpatialIndex.build(m, { tol });
    const id = m.ids.idOf('60')!;
    // The tick (a unit slash) scaled by 3 and turned to point left reaches 1.5 about the tip.
    const first = index.bounds(id);
    if (first?.kind !== 'box') throw new Error('expected a box');
    expect(first.box.minX).toBeCloseTo(-1.5);
    expect(first.box.minY).toBeCloseTo(8.5);
    expect(first.box.maxX).toBeCloseTo(12.5);
    expect(first.box.maxY).toBeCloseTo(11.5);
    // Lengthening the tick block along +X lengthens the arrowhead back past the tip.
    const b = new ChangeSetBuilder(m);
    b.addEntity({ owner: TICK, layer: LAYER_0, geom: lineGeom(0, 0, 5, 0) });
    const cs = b.build();
    m.apply(cs);
    index.apply(cs);
    const second = index.bounds(id);
    expect(second?.kind === 'box' && second.box.minX).toBeCloseTo(-15);
  });
});

function initOf(m: DocumentModel) {
  return {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0')],
      linetypes: [...m.tables.linetypes.values()],
      blockRecords: [...m.tables.blockRecords.values()],
    },
    blocks: [...m.blocks.values()],
    layouts: [...m.layouts],
    entities: [],
  } as const;
}

function styleRecord(arrowhead: string) {
  return {
    handle: STYLE,
    name: 'Standard',
    description: '',
    contentType: 2,
    mleaderDrawOrder: 0,
    leaderDrawOrder: 0,
    maxLeaderPoints: 2,
    firstSegmentAngle: 0,
    secondSegmentAngle: 0,
    pathType: 1,
    lineColor: { kind: 'byBlock' as const },
    lineweight: 'ByBlock' as const,
    landing: true,
    landingGap: 0.5,
    dogleg: true,
    doglegLength: 2.5,
    arrowhead,
    arrowheadSize: 3,
    defaultText: '',
    textLeftAttachment: 1,
    textRightAttachment: 1,
    textTopAttachment: 9,
    textBottomAttachment: 9,
    textAttachmentDirection: 0,
    textAngleType: 1,
    textAlignment: 0,
    textColor: { kind: 'byBlock' as const },
    textHeight: 2.5,
    textFrame: false,
    textAlignAlwaysLeft: false,
    alignSpace: 4,
    blockColor: { kind: 'byBlock' as const },
    blockScale: { x: 1, y: 1, z: 1 },
    blockScaleOn: false,
    blockRotation: 0,
    blockRotationOn: false,
    blockConnection: 0,
    scale: 1,
    overwriteProperties: false,
    annotative: false,
    breakGap: 0.125,
  };
}
