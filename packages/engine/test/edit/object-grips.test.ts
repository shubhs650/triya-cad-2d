// M3-05 part 6: grips on multilines, multileaders, regions and a non-associative hatch's
// boundary (AutoCAD 2024 Help, "Grips Reference", "To Modify Multileaders Using Grips", "To
// Modify Hatch Objects Using Grips").
import { describe, expect, it } from 'vitest';
import {
  gripFunctionEdit,
  gripFunctionsOf,
  gripsOf,
  moveGrip,
  moveGripBy,
  type EntityGeometry,
  type HatchGeometry,
  type MLineGeometry,
  type MultiLeaderGeometry,
  type RegionGeometry,
} from '../../src/index';
import { toleranceForSize } from '../../src/geom/tolerance';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pts = (g: EntityGeometry) => gripsOf(g).map((x) => [r6(x.point.x), r6(x.point.y), x.kind]);
const shape = <T extends EntityGeometry>(
  g: T,
  grip: { x: number; y: number },
  to: { x: number; y: number },
): T => {
  const r = moveGrip(g, grip, to);
  if (r.kind !== 'shape') throw new Error(`expected a shape, got ${r.kind}`);
  return r.geom as T;
};
const tol = toleranceForSize(100);
const xy = (p: { x: number; y: number }) => [r6(p.x), r6(p.y)];
const S = Math.SQRT1_2;

/** (0,0) → (10,0) → (10,10), elements at +0.5 and −0.5 (justification Zero). */
function mline(over: Partial<MLineGeometry> = {}): MLineGeometry {
  const el = (t: number) => [
    { parameters: [t], fillParameters: [] },
    { parameters: [-t], fillParameters: [] },
  ];
  return {
    kind: 'MLINE',
    style: 'S',
    scale: 1,
    justification: 1,
    flags: 1,
    start: { x: 0, y: 0 },
    vertices: [
      {
        position: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        miter: { x: 0, y: 1 },
        elements: el(0.5),
      },
      {
        position: { x: 10, y: 0 },
        direction: { x: 0, y: 1 },
        miter: { x: -S, y: S },
        elements: el(0.5 / S),
      },
      {
        position: { x: 10, y: 10 },
        direction: { x: 0, y: 1 },
        miter: { x: -1, y: 0 },
        elements: el(0.5),
      },
    ],
    ...over,
  };
}

/** Each element's perpendicular offset from the segment a vertex starts (or the last ends). */
function offsets(g: MLineGeometry): number[][] {
  return g.vertices.map((v) =>
    v.elements.map((e) => {
      const t = e.parameters[0]!;
      // Left of the direction is +.
      return r6(t * (v.miter.x * -v.direction.y + v.miter.y * v.direction.x));
    }),
  );
}

describe('multiline grips', () => {
  it('a grip at each vertex, which stretches it', () => {
    expect(pts(mline())).toEqual([
      [0, 0, 'mlineVertex'],
      [10, 0, 'mlineVertex'],
      [10, 10, 'mlineVertex'],
    ]);
  });

  it('the moved vertex’s segments turn: directions, miters and element offsets follow', () => {
    const m = shape(mline(), { x: 10, y: 0 }, { x: 10, y: -10 });
    expect(m.vertices.map((v) => xy(v.position))).toEqual([
      [0, 0],
      [10, -10],
      [10, 10],
    ]);
    expect(m.vertices.map((v) => xy(v.direction))).toEqual([
      [r6(S), r6(-S)],
      [0, 1],
      [0, 1],
    ]);
    // The middle miter halves the turn; the elements keep their offsets from each segment.
    const mid = m.vertices[1]!.miter;
    expect(r6(Math.hypot(mid.x, mid.y))).toBe(1);
    expect(xy(m.vertices[0]!.miter)).toEqual([r6(S), r6(S)]);
    expect(xy(mid)).toEqual([r6(-0.3826834), r6(0.9238795)]);
    expect(offsets(m)).toEqual([
      [0.5, -0.5],
      [0.5, -0.5],
      [0.5, -0.5],
    ]);
    // The other segment's far end is where it was.
    expect(m.start).toEqual({ x: 0, y: 0 });
    // The first vertex moved: start (DXF 10) follows it.
    const first = shape(mline(), { x: 0, y: 0 }, { x: 0, y: 5 });
    expect(xy(first.start)).toEqual([0, 5]);
    expect(offsets(first)).toEqual([
      [0.5, -0.5],
      [0.5, -0.5],
      [0.5, -0.5],
    ]);
  });

  it('a closed multiline’s first miter turns with its last segment', () => {
    const closed = mline({ flags: 3 });
    const m = shape(closed, { x: 10, y: 10 }, { x: 0, y: 10 });
    // Last segment (0,10) → (0,0) runs down: the first vertex's miter halves (0,−1) and (1,0).
    expect(xy(m.vertices[0]!.miter)).toEqual([r6(S), r6(S)]);
    // The closing segment starts at the moved vertex: its direction is (0,10) → (0,0)'s.
    expect(xy(m.vertices[2]!.direction)).toEqual([0, -1]);
    expect(offsets(m)).toEqual([
      [0.5, -0.5],
      [0.5, -0.5],
      [0.5, -0.5],
    ]);
  });

  it('onto its neighbour: no shape', () => {
    expect(moveGrip(mline(), { x: 10, y: 0 }, { x: 10, y: 10 }).kind).toBe('none');
  });
});

/** A one-branch MTEXT multileader: arrowhead (0,0), landing (10,10)–(12.5,10), text (13,11.25). */
function mleader(over: Partial<MultiLeaderGeometry> = {}): MultiLeaderGeometry {
  return {
    kind: 'MULTILEADER',
    overrideFlags: 0,
    pathType: 1,
    lineColor: { kind: 'byBlock' },
    lineweight: -2,
    landing: true,
    dogleg: true,
    doglegLength: 2.5,
    arrowheadSize: 3,
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
        lines: [
          {
            index: 0,
            vertices: [
              { x: 0, y: 0 },
              { x: 5, y: 8 },
            ],
          },
        ],
      },
    ],
    ...over,
  };
}

describe('multileader grips', () => {
  it('its leader vertices, both ends of the landing and the content', () => {
    expect(pts(mleader())).toEqual([
      [0, 0, 'leaderVertex'],
      [5, 8, 'leaderVertex'],
      [10, 10, 'landing'],
      [12.5, 10, 'landing'],
      [13, 11.25, 'landing'],
    ]);
    // No dogleg drawn: one landing grip.
    expect(pts(mleader({ dogleg: false })).map((p) => p[2])).toEqual([
      'leaderVertex',
      'leaderVertex',
      'landing',
      'landing',
    ]);
  });

  it('a leader vertex (the arrowhead too) stretches alone', () => {
    const m = shape(mleader(), { x: 0, y: 0 }, { x: -2, y: 1 });
    expect(m.branches[0]!.lines[0]!.vertices).toEqual([
      { x: -2, y: 1 },
      { x: 5, y: 8 },
    ]);
    expect(m.text!.position).toEqual({ x: 13, y: 11.25 });
  });

  it('the landing and the content move together, the leader lines’ vertices staying', () => {
    for (const grip of [
      { x: 10, y: 10 },
      { x: 12.5, y: 10 },
      { x: 13, y: 11.25 },
    ]) {
      const m = shape(mleader(), grip, { x: grip.x, y: grip.y + 2 });
      expect(m.branches[0]!.connection).toEqual({ x: 10, y: 12 });
      expect(m.contentBase).toEqual({ x: 12.5, y: 12 });
      expect(m.text!.position).toEqual({ x: 13, y: 13.25 });
      expect(m.branches[0]!.lines[0]!.vertices).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 8 },
      ]);
    }
    // Block content moves with it.
    const { text: _t, ...plain } = mleader();
    const block: MultiLeaderGeometry = {
      ...plain,
      contentType: 1,
      block: {
        position: { x: 14, y: 10 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        color: { kind: 'byBlock' },
      },
    };
    const b = shape(block, { x: 14, y: 10 }, { x: 15, y: 10 });
    expect(b.block!.position).toEqual({ x: 15, y: 10 });
    expect(b.branches[0]!.connection).toEqual({ x: 11, y: 10 });
  });

  it('the landing’s far end: Stretch and Lengthen Landing', () => {
    const end = { x: 12.5, y: 10 };
    expect(gripFunctionsOf(mleader(), end)).toEqual(['Stretch', 'Lengthen Landing']);
    expect(gripFunctionsOf(mleader(), { x: 10, y: 10 })).toEqual([]);
    const m = gripFunctionEdit(mleader(), end, 'Lengthen Landing', { x: 15, y: 10.3 }, tol);
    if (typeof m === 'string' || m.kind !== 'MULTILEADER') throw new Error(String(m));
    expect(m.branches[0]!.doglegLength).toBe(5);
    expect(m.branches[0]!.connection).toEqual({ x: 10, y: 10 });
    expect(xy(m.contentBase)).toEqual([15, 10]);
    expect(xy(m.text!.position)).toEqual([15.5, 11.25]);
    // Behind the connection: no landing.
    expect(gripFunctionEdit(mleader(), end, 'Lengthen Landing', { x: 9, y: 10 }, tol)).toBe(
      'invalid',
    );
    expect(
      moveGripBy(mleader(), end, { x: 15, y: 10 }, undefined, 'Lengthen Landing'),
    ).toMatchObject({ kind: 'shape', geom: { contentBase: { x: 15, y: 10 } } });
  });
});

describe('region grips', () => {
  it('one grip at the centre of its extents, which moves it', () => {
    const region: RegionGeometry = {
      kind: 'REGION',
      loops: [
        {
          face: 0,
          edges: [
            { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
            { kind: 'LINE', start: { x: 10, y: 0 }, end: { x: 10, y: 4 } },
            { kind: 'LINE', start: { x: 10, y: 4 }, end: { x: 0, y: 4 } },
            { kind: 'LINE', start: { x: 0, y: 4 }, end: { x: 0, y: 0 } },
          ],
        },
      ],
    };
    expect(pts(region)).toEqual([[5, 2, 'move']]);
    expect(moveGrip(region, { x: 5, y: 2 }, { x: 6, y: 2 }).kind).toBe('move');
    expect(pts({ kind: 'REGION', loops: [] })).toEqual([]);
  });
});

function hatch(over: Partial<HatchGeometry> = {}): HatchGeometry {
  return {
    kind: 'HATCH',
    pattern: 'SOLID',
    solid: true,
    associative: false,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops: [
      {
        flags: 3,
        polyline: {
          closed: true,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0 },
            { x: 10, y: 6, bulge: 0.5 },
            { x: 0, y: 6, bulge: 0 },
          ],
        },
      },
    ],
    patternLines: [],
    seedPoints: [],
    ...over,
  };
}

describe('a non-associative hatch’s boundary grips', () => {
  it('its control grip, then each boundary vertex', () => {
    expect(pts(hatch()).map((p) => p[2])).toEqual([
      'move',
      'boundary',
      'boundary',
      'boundary',
      'boundary',
    ]);
    expect(
      pts(hatch())
        .slice(1)
        .map((p) => [p[0], p[1]]),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ]);
    // Associative: the boundary objects have the grips.
    expect(pts(hatch({ associative: true })).map((p) => p[2])).toEqual(['move']);
  });

  it('a vertex grip stretches the boundary, an arc segment keeping its bulge', () => {
    const h = shape(hatch(), { x: 10, y: 6 }, { x: 12, y: 8 });
    expect(h.loops[0]!.polyline!.vertices).toEqual([
      { x: 0, y: 0, bulge: 0 },
      { x: 10, y: 0, bulge: 0 },
      { x: 12, y: 8, bulge: 0.5 },
      { x: 0, y: 6, bulge: 0 },
    ]);
    expect(gripFunctionsOf(hatch(), { x: 10, y: 6 })).toEqual([]);
  });

  it('line edges: the ends where two lines meet move together; arcs keep theirs', () => {
    const edged = hatch({
      loops: [
        {
          flags: 1,
          edges: [
            { type: 'line', start: { x: 0, y: 0 }, end: { x: 8, y: 0 } },
            { type: 'line', start: { x: 8, y: 0 }, end: { x: 4, y: 6 } },
            { type: 'line', start: { x: 4, y: 6 }, end: { x: 0, y: 0 } },
          ],
        },
        {
          flags: 0,
          edges: [
            {
              type: 'arc',
              center: { x: 4, y: 2 },
              radius: 1,
              startAngle: 0,
              endAngle: 2 * Math.PI,
              ccw: true,
            },
          ],
        },
      ],
    });
    expect(pts(edged).slice(1)).toEqual([
      [0, 0, 'boundary'],
      [8, 0, 'boundary'],
      [4, 6, 'boundary'],
    ]);
    const h = shape(edged, { x: 8, y: 0 }, { x: 9, y: 1 });
    expect(h.loops[0]!.edges!.slice(0, 2)).toEqual([
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 9, y: 1 } },
      { type: 'line', start: { x: 9, y: 1 }, end: { x: 4, y: 6 } },
    ]);
    expect(h.loops[1]).toBe(edged.loops[1]);
  });
});
