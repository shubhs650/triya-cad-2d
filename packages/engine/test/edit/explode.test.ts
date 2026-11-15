// M3-12 part 3: EXPLODE of leaders, multileaders, tables, regions, multilines and pattern hatches
// (`edit/explode.ts`), as AutoCAD 2024 explodes them (AutoCAD Help, "EXPLODE (Command)":
// "Leaders: Explodes into lines, splines, solids (arrow heads), block inserts (arrow heads,
// annotation blocks), multiline text, or tolerance objects", "Multiline: Explodes into lines and
// arcs", "Region: Explodes into lines, arcs, or splines"), with an inch drawing's tolerance case.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  explodeObjects,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type ExplodeServices,
  type HatchGeometry,
  type HeaderValue,
  type MLineGeometry,
  type MLineStyleRecord,
  type MultiLeaderGeometry,
} from '../../src/index';
import {
  blockRecord,
  entityInit,
  LAYER_0,
  LAYER_WALLS,
  layer,
  linetype,
  lineGeom,
  MODEL_SPACE,
} from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const BYBLOCK_LT = '13';
const DASHED = '15';
const ISO = '60';
const TABLE_BLOCK = '61';
const TAG = '62';
const STANDARD_ML = '63';
const RED_ML = '64';
const RED = { kind: 'aci', index: 1 } as const;
const BLUE = { kind: 'aci', index: 5 } as const;

const mlineStyle = (handle: string, name: string, extra: Partial<MLineStyleRecord>) =>
  ({
    handle,
    name,
    description: '',
    styleFlags: 0,
    fillColor: { kind: 'byLayer' },
    startAngle: Math.PI / 2,
    endAngle: Math.PI / 2,
    elements: [
      { offset: 0.5, color: { kind: 'byLayer' } },
      { offset: -0.5, color: { kind: 'byLayer' } },
    ],
    ...extra,
  }) as MLineStyleRecord;

/** A drawing of the objects `extra`, handles from 80 on, on WALLS. */
function setup(extra: (EntityGeometry | [EntityGeometry, Partial<EntityInit>])[]) {
  const model = DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 1, measurement: 'imperial' },
    handSeed: '200',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0'), layer(LAYER_WALLS, 'WALLS')],
      linetypes: [
        linetype(BYBLOCK_LT, 'ByBlock'),
        linetype('14', 'Continuous'),
        linetype(DASHED, 'DASHED'),
      ],
      dimStyles: [{ handle: ISO, name: 'ISO-25', vars: { DIMASZ: 2.5, DIMSCALE: 1 } }],
      blockRecords: [
        blockRecord(MODEL_SPACE, '*Model_Space'),
        blockRecord(TABLE_BLOCK, '*T1'),
        blockRecord(TAG, 'TAG'),
      ],
      mlineStyles: [
        mlineStyle(STANDARD_ML, 'STANDARD', {}),
        mlineStyle(RED_ML, 'CAPPED', {
          // Square start, round end, displayed joints; a red top element, dashed.
          styleFlags: 2 | 16 | 1024,
          elements: [
            { offset: 1, color: RED, linetype: DASHED },
            { offset: -1, color: BLUE },
          ],
        }),
      ],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: TABLE_BLOCK, name: '*T1', basePoint: { x: 0, y: 0 }, flags: 1 },
      { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [
      // The table's block: its frame line along the top and a cell line down, in table frame.
      entityInit('70', lineGeom(0, 0, 10, 0), { owner: TABLE_BLOCK }),
      entityInit('71', lineGeom(0, 0, 0, -4), {
        owner: TABLE_BLOCK,
        color: { kind: 'byBlock' },
      }),
      entityInit('72', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, { owner: TAG }),
      entityInit(
        '73',
        {
          kind: 'ATTDEF',
          tag: 'N',
          prompt: 'Number',
          value: '1',
          position: { x: 0, y: 0 },
          height: 0.5,
          rotation: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          style: '0',
          flags: 0,
          horizontal: 0,
          vertical: 0,
        } as unknown as EntityGeometry,
        { owner: TAG },
      ),
      ...extra.map((x, i) => {
        const [g, props] = Array.isArray(x) ? x : [x, {}];
        return entityInit((0x80 + i).toString(16).toUpperCase(), g, {
          layer: LAYER_WALLS,
          ...props,
        });
      }),
    ],
  });
  const explode = (services: ExplodeServices = {}) => {
    const b = new ChangeSetBuilder(model);
    const ids = model.blockEntities(MODEL_SPACE);
    const r = explodeObjects(b, model, ids, services);
    model.apply(b.build());
    return r;
  };
  const space = (): Entity[] => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  return { model, explode, space };
}

const ends = (g: EntityGeometry) => {
  const l = g as { start: { x: number; y: number }; end: { x: number; y: number } };
  return [l.start.x, l.start.y, l.end.x, l.end.y].map(r6);
};

function mleader(extra: Partial<MultiLeaderGeometry> = {}): MultiLeaderGeometry {
  return {
    kind: 'MULTILEADER',
    overrideFlags: 0,
    pathType: 1,
    lineColor: RED,
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

function withoutText(extra: Partial<MultiLeaderGeometry>): MultiLeaderGeometry {
  const { text: _text, ...rest } = mleader(extra);
  return rest;
}

describe('EXPLODE of leaders', () => {
  it('turns a leader into its lines and arrowhead solid, leaving its annotation', () => {
    const { explode, space } = setup([
      [
        {
          kind: 'LEADER',
          style: ISO,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
          arrowhead: true,
          spline: false,
          creationType: 3,
          textHeight: 0,
          textWidth: 0,
          horizontalDirection: { x: 1, y: 0 },
          blockOffset: { x: 0, y: 0 },
          annotationOffset: { x: 0, y: 0 },
        },
        { color: BLUE },
      ],
    ]);
    const r = explode();
    expect(r.exploded).toBe(1);
    const made = space();
    expect(made.map((e) => e.geom.kind)).toEqual(['SOLID', 'LINE', 'LINE']);
    // The line runs from the arrowhead's back to the hook; each part keeps the leader's
    // layer and colour.
    expect(ends(made[2]!.geom)).toEqual([10, 10, 20, 10]);
    for (const e of made) expect(e).toMatchObject({ layer: LAYER_WALLS, color: BLUE });
  });

  it('turns a spline leader into a spline with control points', () => {
    const { explode, space } = setup([
      {
        kind: 'LEADER',
        style: ISO,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        arrowhead: false,
        spline: true,
        creationType: 3,
        textHeight: 0,
        textWidth: 0,
        horizontalDirection: { x: 1, y: 0 },
        blockOffset: { x: 0, y: 0 },
        annotationOffset: { x: 0, y: 0 },
      },
    ]);
    explode();
    const [s] = space();
    expect(s!.geom.kind).toBe('SPLINE');
    const g = s!.geom as Extract<EntityGeometry, { kind: 'SPLINE' }>;
    expect(g.controlPoints.length).toBeGreaterThan(2);
    expect(g.knots.length).toBe(g.controlPoints.length + 4);
    expect(g.fitPoints?.length).toBe(3);
  });

  it('turns a multileader into its arrowhead, lines, landing and MTEXT', () => {
    const { explode, space } = setup([mleader()]);
    explode();
    const made = space();
    expect(made.map((e) => e.geom.kind)).toEqual(['SOLID', 'LINE', 'LINE', 'MTEXT']);
    // The leader lines draw in the multileader's leader colour and linetype; the text, ByBlock
    // there, in the multileader's own.
    expect(made[1]).toMatchObject({ color: RED, linetype: DASHED });
    expect(made[3]).toMatchObject({ color: { kind: 'byLayer' }, layer: LAYER_WALLS });
    expect(made[3]!.geom).toMatchObject({ contents: 'NOTE', position: { x: 13, y: 11.25 } });
    expect(ends(made[2]!.geom)).toEqual([10, 10, 12.5, 10]);
  });

  it("keeps a multileader's underline when its text can be measured", () => {
    const { explode, space } = setup([mleader({ textLeftAttachment: 5 })]);
    explode({ measure: () => 8 });
    expect(space().map((e) => e.geom.kind)).toEqual(['SOLID', 'LINE', 'LINE', 'LINE', 'MTEXT']);
  });

  it('turns block content into a reference with ATTRIBs of its own', () => {
    const { explode, space, model } = setup([
      withoutText({
        contentType: 1,
        block: {
          block: TAG,
          position: { x: 14, y: 10 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          color: { kind: 'byBlock' },
          attributes: [{ definition: '73', index: 0, width: 0, value: '7' }],
        },
      }),
    ]);
    explode();
    const insert = space().find((e) => e.geom.kind === 'INSERT')!;
    const g = insert.geom as Extract<EntityGeometry, { kind: 'INSERT' }>;
    expect(g).toMatchObject({ block: TAG, position: { x: 14, y: 10 } });
    expect(g.attributes).toHaveLength(1);
    expect(g.attributes[0]).toMatchObject({ tag: 'N', value: '7' });
    // A handle of its own, not the ATTDEF's.
    expect(g.attributes[0]!.handle).not.toBe('73');
    expect(model.entityByHandle('73')).toBeDefined();
  });
});

describe('EXPLODE of tables, regions, multilines and hatches', () => {
  it("copies a table's block out in the table's frame, ByBlock taking the table's", () => {
    const { explode, space } = setup([
      [
        {
          kind: 'ACAD_TABLE',
          block: TABLE_BLOCK,
          position: { x: 100, y: 50 },
          direction: { x: 0, y: 1 },
          rowHeights: [4],
          columnWidths: [10],
          cells: [],
        } as unknown as EntityGeometry,
        { color: RED },
      ],
    ]);
    const r = explode();
    expect(r.exploded).toBe(1);
    const made = space();
    // Turned a quarter: the top line runs up from the insertion point, the cell line to its right.
    expect(made.map((e) => ends(e.geom))).toEqual([
      [100, 50, 100, 60],
      [100, 50, 104, 50],
    ]);
    expect(made[1]!.color).toEqual(RED);
    expect(made[0]!.color).toEqual({ kind: 'byLayer' });
  });

  it("turns a region into its loops' lines, arcs and circles", () => {
    const { explode, space } = setup([
      {
        kind: 'REGION',
        loops: [
          {
            face: 0,
            edges: [
              { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
              {
                kind: 'ARC',
                center: { x: 10, y: 5 },
                radius: 5,
                startAngle: -Math.PI / 2,
                endAngle: Math.PI / 2,
              },
              { kind: 'LINE', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
              { kind: 'LINE', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
            ],
          },
          { face: 0, edges: [{ kind: 'CIRCLE', center: { x: 5, y: 5 }, radius: 1 }] },
        ],
        elevation: 2,
      },
    ]);
    explode();
    const made = space();
    expect(made.map((e) => e.geom.kind)).toEqual(['LINE', 'ARC', 'LINE', 'LINE', 'CIRCLE']);
    // Arc angles as the file has them, in [0, 2π); the region's elevation kept.
    expect(r6(made[1]!.geom.kind === 'ARC' ? made[1]!.geom.startAngle : 0)).toBe(
      r6((3 * Math.PI) / 2),
    );
    for (const e of made) expect(e.geom).toMatchObject({ elevation: 2 });
  });

  const mline = (extra: Partial<MLineGeometry>): MLineGeometry => ({
    kind: 'MLINE',
    style: STANDARD_ML,
    scale: 1,
    justification: 1,
    flags: 1,
    start: { x: 0, y: 0 },
    vertices: [
      {
        position: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        miter: { x: 0, y: 1 },
        elements: [
          { parameters: [1, 0], fillParameters: [] },
          { parameters: [-1, 0], fillParameters: [] },
        ],
      },
      {
        position: { x: 10, y: 0 },
        direction: { x: 0, y: 1 },
        miter: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
        elements: [
          { parameters: [Math.SQRT2, 0], fillParameters: [] },
          { parameters: [-Math.SQRT2, 0], fillParameters: [] },
        ],
      },
      {
        position: { x: 10, y: 10 },
        direction: { x: 0, y: 1 },
        miter: { x: -1, y: 0 },
        elements: [
          { parameters: [1, 0], fillParameters: [] },
          { parameters: [-1, 0], fillParameters: [] },
        ],
      },
    ],
    ...extra,
  });

  it("turns a multiline into its elements' lines", () => {
    const { explode, space } = setup([mline({})]);
    explode();
    const made = space();
    expect(made.map((e) => ends(e.geom))).toEqual([
      [0, 1, 9, 1],
      [0, -1, 11, -1],
      [9, 1, 9, 10],
      [11, -1, 11, 10],
    ]);
    for (const e of made)
      expect(e).toMatchObject({ layer: LAYER_WALLS, color: { kind: 'byLayer' } });
  });

  it("adds its style's caps and joints, in each element's colour and linetype", () => {
    const { explode, space } = setup([mline({ style: RED_ML })]);
    explode();
    const made = space();
    expect(made.map((e) => e.geom.kind)).toEqual([
      // Square start cap: top to middle, bottom to middle.
      'LINE',
      'LINE',
      // Two segments of two elements.
      'LINE',
      'LINE',
      'LINE',
      'LINE',
      // The joint at the corner.
      'LINE',
      'LINE',
      // Round end cap, a quarter circle in each element's colour.
      'ARC',
      'ARC',
    ]);
    expect(ends(made[0]!.geom)).toEqual([0, 1, 0, 0]);
    expect(made[0]).toMatchObject({ color: RED, linetype: DASHED });
    expect(made[1]).toMatchObject({ color: BLUE, linetype: 'ByLayer' });
    expect(made[8]!.geom).toMatchObject({ center: { x: 10, y: 10 }, radius: 1 });
    expect(made[8]!.color).toEqual(BLUE);
    expect(made[9]!.color).toEqual(RED);
  });

  it('closes a closed multiline round to its first vertex, with no caps', () => {
    const { explode, space } = setup([mline({ style: RED_ML, flags: 3 })]);
    explode();
    // Three segments of two elements and a joint at each of the three vertices.
    expect(space().map((e) => e.geom.kind)).toEqual(Array(12).fill('LINE'));
  });

  it('refuses a multiline whose vertices do not match its style', () => {
    const m = mline({});
    const { explode } = setup([
      { ...m, vertices: m.vertices.map((v) => ({ ...v, elements: v.elements.slice(0, 1) })) },
      (({ style: _style, ...rest }) => rest)(m),
    ]);
    const r = explode();
    expect(r.refused).toEqual(
      new Map([
        ['the multiline does not match its style', 1],
        ['the multiline has no style', 1],
      ]),
    );
  });

  const hatch = (extra: Partial<HatchGeometry> = {}): HatchGeometry => ({
    kind: 'HATCH',
    pattern: 'ANSI31',
    solid: false,
    associative: false,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops: [],
    patternLines: [],
    seedPoints: [],
    ...extra,
  });

  it("turns a pattern hatch into its pattern's lines and dots, refusing solid fills", () => {
    const { explode, space } = setup([
      [hatch({ elevation: 3 }), { color: RED }],
      hatch({ solid: true, pattern: 'SOLID' }),
    ]);
    const r = explode({
      hatchLines: () => ({ segments: [0, 0, 1, 1, 2, 0, 3, 1], dots: [5, 5] }),
    });
    expect(r.exploded).toBe(1);
    expect(r.refused).toEqual(new Map([['a solid or gradient fill cannot be exploded', 1]]));
    const made = space().filter((e) => e.geom.kind !== 'HATCH');
    expect(made.map((e) => e.geom.kind)).toEqual(['LINE', 'LINE', 'POINT']);
    expect(ends(made[1]!.geom)).toEqual([2, 0, 3, 1]);
    expect(made[2]!.geom).toMatchObject({ position: { x: 5, y: 5 }, elevation: 3 });
    for (const e of made) expect(e.color).toEqual(RED);
  });

  it('leaves a hatch alone without the hatch engine or with nothing to draw', () => {
    const { explode } = setup([hatch(), hatch()]);
    expect(explode().refused).toEqual(new Map([['the hatch has no pattern lines to explode', 2]]));
    expect(explode({ hatchLines: () => undefined }).exploded).toBe(0);
  });

  it("keeps an inch drawing's tiny multiline caps (tolerance case)", () => {
    // A 1/64" multiline: the caps and pieces are tiny but whole.
    const k = 1 / 64;
    const m = mline({ style: RED_ML });
    const { explode, space } = setup([
      {
        ...m,
        vertices: m.vertices.map((v) => ({
          ...v,
          position: { x: v.position.x * k, y: v.position.y * k },
          elements: v.elements.map((e) => ({ ...e, parameters: [e.parameters[0]! * k, 0] })),
        })),
      },
    ]);
    explode();
    const made = space();
    expect(made).toHaveLength(10);
    expect(made[8]!.geom).toMatchObject({ radius: k });
  });
});
