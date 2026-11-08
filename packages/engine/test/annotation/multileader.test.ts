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

// M1-111: block content attribute values, per-leader-line overrides, and the text underline and
// overline attachments.
describe('multiLeaderParts (M1-111)', () => {
  const NO = '52';
  const CONST = '53';
  /** An ATTDEF in the custom block, its text 1 right of the block's origin, 2 high. */
  const attdef = (handle: string, tag: string, flags = 0): EntityInit =>
    entityInit(
      handle,
      {
        kind: 'ATTDEF',
        tag,
        prompt: '',
        flags,
        value: 'default',
        style: '0',
        position: { x: 1, y: 0 },
        alignmentPoint: { x: 1, y: 0.5 },
        height: 2,
        rotation: 0,
        widthFactor: 0.8,
        oblique: 0,
        halign: 1,
        valign: 2,
        backward: false,
        upsideDown: false,
      },
      { owner: CUSTOM, color: { kind: 'byBlock' } },
    );
  const content = (attributes: NonNullable<MultiLeaderGeometry['block']>['attributes']) =>
    noText({
      contentType: 1,
      block: {
        block: CUSTOM,
        position: { x: 14, y: 10 },
        scale: { x: 2, y: 2, z: 2 },
        rotation: Math.PI / 2,
        color: { kind: 'aci', index: 3 },
        ...(attributes ? { attributes } : {}),
      },
    });

  it('draws block content with the attribute values the MULTILEADER states', () => {
    const m = model([attdef(NO, 'NO'), attdef(CONST, 'C', 2)]);
    const g = content([
      { definition: NO, index: 0, width: 1, value: '12' },
      // A value whose ATTDEF the drawing lacks, or that is not an ATTDEF, draws nothing.
      { definition: '99', index: 1, width: 1, value: 'lost' },
      { definition: TICK, index: 2, width: 1, value: 'not an attdef' },
    ]);
    const insert = multiLeaderParts(g, m).at(-1)!.geom as InsertGeometry;
    expect(insert.attributes).toHaveLength(1);
    const a = insert.attributes[0]!;
    // The ATTDEF's text where the block puts it: turned a quarter, twice the size.
    expect(a).toMatchObject({
      handle: NO,
      tag: 'NO',
      value: '12',
      flags: 0,
      height: 4,
      widthFactor: 0.8,
      halign: 1,
      valign: 2,
      color: { kind: 'byBlock' },
      layer: LAYER_0,
    });
    expect(a.position.x).toBeCloseTo(14);
    expect(a.position.y).toBeCloseTo(12);
    expect(a.alignmentPoint!.x).toBeCloseTo(13);
    expect(a.alignmentPoint!.y).toBeCloseTo(12);
    expect(a.rotation).toBeCloseTo(Math.PI / 2);
    // Without values the block draws as before.
    expect(
      (multiLeaderParts(content(undefined), m).at(-1)!.geom as InsertGeometry).attributes,
    ).toEqual([]);
  });

  it('bounds block content with its attribute values', () => {
    const m = model([attdef(NO, 'NO')]);
    const g = content([{ definition: NO, index: 0, width: 1, value: '12' }]);
    const ctx = {
      tol: toleranceForSize(1000),
      tables: m,
      blockExtents: () => ({ minX: -1, minY: 0, maxX: 0, maxY: 0 }),
      annotationBounds: () => ({ minX: 100, minY: 100, maxX: 101, maxY: 101 }),
    };
    const b = entityBounds(g, ctx);
    expect(b.kind === 'box' && b.box.maxX).toBe(101);
  });

  it('draws a leader line in the colour, linetype and lineweight it overrides', () => {
    const g = mleader({
      branches: [
        {
          ...mleader().branches[0]!,
          lines: [
            { index: 0, vertices: [{ x: 0, y: 0 }] },
            {
              index: 1,
              vertices: [{ x: 0, y: 5 }],
              overrides: {
                flags: 2 | 4 | 8,
                color: { kind: 'aci', index: 5 },
                linetype: BYBLOCK_LT,
                lineweight: 50,
              },
            },
          ],
        },
      ],
    });
    const parts = multiLeaderParts(g, model());
    expect(kinds(parts)).toEqual([
      'SOLID',
      'LWPOLYLINE',
      'SOLID',
      'LWPOLYLINE',
      'LWPOLYLINE',
      'MTEXT',
    ]);
    const own = { color: { kind: 'aci', index: 1 }, linetype: DASHED, lineweight: 25 };
    expect(parts[0]).toMatchObject(own);
    expect(parts[1]).toMatchObject(own);
    const over = { color: { kind: 'aci', index: 5 }, linetype: 'ByBlock', lineweight: 50 };
    expect(parts[2]).toMatchObject(over);
    expect(parts[3]).toMatchObject(over);
    // The landing is the MULTILEADER's.
    expect(parts[4]).toMatchObject(own);
  });

  it('draws a leader line with the arrowhead, size and path type it overrides', () => {
    const line = (
      overrides: MultiLeaderGeometry['branches'][number]['lines'][number]['overrides'],
    ) =>
      mleader({
        branches: [
          {
            ...mleader().branches[0]!,
            lines: [{ index: 0, vertices: [{ x: 0, y: 0 }], ...(overrides ? { overrides } : {}) }],
          },
        ],
      });
    const tick = multiLeaderParts(
      line({ flags: 16 | 32, arrowhead: TICK, arrowheadSize: 1.5 }),
      model(),
    );
    expect(tick[0]!.geom).toMatchObject({ kind: 'INSERT', block: TICK, scale: { x: 1.5, y: 1.5 } });
    // The line's own size takes the MULTILEADER's overall scale, as its drawn size (140) does.
    const scaled = multiLeaderParts(
      { ...line({ flags: 16, arrowheadSize: 1.5 }), arrowheadSize: 1.5, drawnArrowheadSize: 3 },
      model(),
    );
    expect((scaled[0]!.geom as SolidGeometry).corners[1].x).toBeCloseTo(3 * s - 0.5 * s);
    // Flag 32 without an arrowhead is the closed filled arrow, whatever the MULTILEADER has.
    const filled = multiLeaderParts({ ...line({ flags: 32 }), arrowhead: TICK }, model());
    expect(filled[0]!.geom.kind).toBe('SOLID');
    // Path type 2 makes that line a spline; 0 hides it and its arrowhead.
    expect(kinds(multiLeaderParts(line({ flags: 1, pathType: 2 }), model()))).toEqual([
      'SOLID',
      'SPLINE',
      'LWPOLYLINE',
      'MTEXT',
    ]);
    expect(kinds(multiLeaderParts(line({ flags: 1, pathType: 0 }), model()))).toEqual([
      'LWPOLYLINE',
      'MTEXT',
    ]);
    // Values the flags do not name are not drawn.
    const unflagged = multiLeaderParts(
      line({ flags: 2, color: { kind: 'aci', index: 5 }, lineweight: 100, arrowhead: TICK }),
      model(),
    );
    expect(unflagged[0]).toMatchObject({ geom: { kind: 'SOLID' }, lineweight: 25 });
    expect(unflagged[1]).toMatchObject({ color: { kind: 'aci', index: 5 }, lineweight: 25 });
  });

  const measure = () => 7;

  it('underlines the text from the landing end for horizontal attachments 5, 6 and 8', () => {
    for (const attachment of [5, 6, 8]) {
      const parts = multiLeaderParts(mleader({ textLeftAttachment: attachment }), model(), measure);
      expect(kinds(parts)).toEqual(['SOLID', 'LWPOLYLINE', 'LWPOLYLINE', 'LWPOLYLINE', 'MTEXT']);
      // Landing gap plus the text's width, in the leader line's properties.
      expect(parts[3]).toMatchObject({
        geom: {
          vertices: [
            { x: 12.5, y: 10 },
            { x: 20, y: 10 },
          ],
        },
        color: { kind: 'aci', index: 1 },
        linetype: DASHED,
        lineweight: 25,
      });
    }
    // Other attachments, a right attachment on the left, or text not yet measurable: none.
    for (const extra of [{ textLeftAttachment: 4 }, { textRightAttachment: 5 }])
      expect(kinds(multiLeaderParts(mleader(extra), model(), measure))).toHaveLength(4);
    expect(kinds(multiLeaderParts(mleader({ textLeftAttachment: 5 }), model()))).toHaveLength(4);
    expect(
      kinds(multiLeaderParts(mleader({ textLeftAttachment: 5 }), model(), () => undefined)),
    ).toHaveLength(4);
    // Block content, and invisible leaders, have no underline.
    expect(
      kinds(multiLeaderParts(mleader({ textLeftAttachment: 5, pathType: 0 }), model(), measure)),
    ).toEqual(['MTEXT']);
  });

  it('underlines towards the text when the leader comes from the right', () => {
    const g = mleader({
      textRightAttachment: 6,
      text: { ...mleader().text!, position: { x: 0, y: 11.25 }, attachment: 3 },
      branches: [
        { ...mleader().branches[0]!, connection: { x: 15, y: 10 }, direction: { x: -1, y: 0 } },
      ],
    });
    const parts = multiLeaderParts(g, model(), measure);
    expect(parts[3]!.geom).toMatchObject({
      vertices: [
        { x: 12.5, y: 10 },
        { x: 5, y: 10 },
      ],
    });
  });

  it('draws the overline or underline of vertical attachment 10 across the text', () => {
    const vertical = (extra: Partial<MultiLeaderGeometry>, y: number) =>
      mleader({
        textAttachmentDirection: 1,
        text: { ...mleader().text!, position: { x: 10, y }, attachment: 2 },
        ...extra,
      });
    // Text below the leader's end: its top attachment.
    const over = multiLeaderParts(vertical({ textTopAttachment: 10 }, 9), model(), measure);
    expect(kinds(over)).toEqual(['SOLID', 'LWPOLYLINE', 'LWPOLYLINE', 'MTEXT']);
    expect(over[2]!.geom).toMatchObject({
      vertices: [
        { x: 6.5, y: 10 },
        { x: 13.5, y: 10 },
      ],
    });
    expect(
      kinds(multiLeaderParts(vertical({ textTopAttachment: 10 }, 12), model(), measure)),
    ).toHaveLength(3);
    // Text above it: its bottom attachment.
    const under = multiLeaderParts(vertical({ textBottomAttachment: 10 }, 12), model(), measure);
    expect(kinds(under)).toHaveLength(4);
    expect(
      kinds(multiLeaderParts(vertical({ textBottomAttachment: 9 }, 12), model(), measure)),
    ).toHaveLength(3);
  });

  it('bounds the underline with the rest', () => {
    const m = model();
    const ctx = {
      tol: toleranceForSize(1000),
      tables: m,
      blockExtents: () => undefined,
      annotationBounds: () => ({ minX: 13, minY: 8.75, maxX: 17, maxY: 11.25 }),
      measureText: measure,
    };
    const b = entityBounds(mleader({ textLeftAttachment: 5 }), ctx);
    expect(b.kind === 'box' && b.box.maxX).toBe(20);
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
