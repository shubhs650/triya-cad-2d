// M3-14: what an MLINE draws — its elements vertex to vertex, cut where MLEDIT broke them, its
// style's caps and joints, and its fill between the outermost elements under the lines.
import { describe, expect, it } from 'vitest';
import {
  annotationParts,
  DocumentModel,
  mlineParts,
  mlineProblem,
  type EntityGeometry,
  type HeaderValue,
  type MLineGeometry,
  type MLineStyleRecord,
} from '../../src/index';
import { blockRecord, LAYER_0, layer, linetype, MODEL_SPACE } from '../model/fixtures';

const STANDARD = '40';
const FILLED = '41';
const CAPPED = '42';
const RED = { kind: 'aci', index: 1 } as const;
const BLUE = { kind: 'aci', index: 5 } as const;
const YELLOW = { kind: 'aci', index: 2 } as const;

const style = (handle: string, name: string, extra: Partial<MLineStyleRecord>) =>
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

function model(): DocumentModel {
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0')],
      linetypes: [linetype('14', 'Continuous')],
      blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space')],
      mlineStyles: [
        style(STANDARD, 'STANDARD', {}),
        // Fill on, yellow.
        style(FILLED, 'FILLED', { styleFlags: 1, fillColor: YELLOW }),
        // Square start and round end caps, a red top element.
        style(CAPPED, 'CAPPED', {
          styleFlags: 16 | 1024,
          elements: [
            { offset: 1, color: RED },
            { offset: -1, color: BLUE },
          ],
        }),
      ],
    },
    blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [],
  });
}

/** An L from (0, 0) to (10, 0) to (10, 10), elements 1 above and below. */
const mline = (extra: Partial<MLineGeometry> = {}): MLineGeometry => ({
  kind: 'MLINE',
  style: STANDARD,
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

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const ends = (g: EntityGeometry) =>
  g.kind === 'LINE' ? [g.start.x, g.start.y, g.end.x, g.end.y].map(r6) : [];

describe('multiline parts (M3-14)', () => {
  it('draws each element from vertex to vertex, through annotationParts', () => {
    const parts = annotationParts(mline(), model())!;
    expect(parts.map((p) => ends(p.geom))).toEqual([
      [0, 1, 9, 1],
      [0, -1, 11, -1],
      [9, 1, 9, 10],
      [11, -1, 11, 10],
    ]);
    expect(parts[0]!.color).toEqual({ kind: 'byLayer' });
  });

  it('leaves out the pieces MLEDIT cut', () => {
    // The bottom element of the first segment shows 0–3 and 5–end; the top one starts at 2.
    const m = mline();
    const [v0, ...rest] = m.vertices;
    const cut = {
      ...v0!,
      elements: [
        { parameters: [1, 2], fillParameters: [] },
        { parameters: [-1, 0, 3, 5], fillParameters: [] },
      ],
    };
    const parts = mlineParts({ ...m, vertices: [cut, ...rest] }, model(), { fill: true });
    expect(parts.map((p) => ends(p.geom))).toEqual([
      [2, 1, 9, 1],
      [0, -1, 3, -1],
      [5, -1, 11, -1],
      [9, 1, 9, 10],
      [11, -1, 11, 10],
    ]);
  });

  it('draws nothing of a segment cut past its end', () => {
    const m = mline();
    const [v0, ...rest] = m.vertices;
    const cut = {
      ...v0!,
      elements: [
        { parameters: [1, 20], fillParameters: [] },
        { parameters: [-1, 0, 50], fillParameters: [] },
      ],
    };
    const parts = mlineParts({ ...m, vertices: [cut, ...rest] }, model(), { fill: true });
    expect(parts.map((p) => ends(p.geom))).toEqual([
      [0, -1, 11, -1],
      [9, 1, 9, 10],
      [11, -1, 11, 10],
    ]);
  });

  it('fills between the outermost elements under the lines, in the fill colour', () => {
    const parts = mlineParts(mline({ style: FILLED }), model(), { fill: true });
    const fill = parts[0]!;
    expect(fill.color).toEqual(YELLOW);
    if (fill.geom.kind !== 'HATCH') throw new Error('expected the fill first');
    expect(fill.geom.solid).toBe(true);
    expect(fill.geom.loops).toHaveLength(1);
    const pts = fill.geom.loops[0]!.polyline!.vertices.map((v) => [r6(v.x), r6(v.y)]);
    // Down the bottom element, back along the top one.
    expect(pts).toEqual([
      [0, -1],
      [11, -1],
      [11, 10],
      [9, 10],
      [9, 1],
      [0, 1],
    ]);
    expect(parts.slice(1).every((p) => p.geom.kind === 'LINE')).toBe(true);
    // EXPLODE's pieces leave the fill out.
    expect(mlineParts(mline({ style: FILLED }), model(), { fill: false })).toHaveLength(4);
  });

  it('fills a closed multiline as the ring between its outermost elements', () => {
    const parts = mlineParts(mline({ style: FILLED, flags: 3 }), model(), { fill: true });
    const fill = parts[0]!.geom;
    if (fill.kind !== 'HATCH') throw new Error('expected the fill first');
    expect(fill.loops.map((l) => l.polyline!.vertices.length)).toEqual([3, 3]);
    expect(fill.style).toBe(0);
    // Three segments of two elements.
    expect(parts.slice(1)).toHaveLength(6);
  });

  it("draws its style's caps unless the multiline suppresses them", () => {
    const kinds = (flags: number) =>
      mlineParts(mline({ style: CAPPED, flags }), model(), { fill: true }).map((p) => p.geom.kind);
    // Square start (two lines), four element lines, round end in two colours.
    expect(kinds(1)).toEqual(['LINE', 'LINE', 'LINE', 'LINE', 'LINE', 'LINE', 'ARC', 'ARC']);
    // DXF 71 bit 4: no start caps; bit 8: no end caps.
    expect(kinds(1 | 4)).toEqual(['LINE', 'LINE', 'LINE', 'LINE', 'ARC', 'ARC']);
    expect(kinds(1 | 8)).toEqual(['LINE', 'LINE', 'LINE', 'LINE', 'LINE', 'LINE']);
  });

  it('draws nothing for a multiline it cannot read, and says why', () => {
    const m = mline();
    const short = { ...m, vertices: m.vertices.slice(0, 1) };
    expect(mlineProblem(short, model())).toBe('the multiline has fewer than two vertices');
    expect(mlineParts(short, model(), { fill: true })).toEqual([]);
    expect(mlineProblem(mline({ style: '99' }), model())).toBe('the multiline has no style');
    expect(mlineProblem(m, model())).toBeUndefined();
  });

  it('keeps an inch drawing’s tiny cut pieces (tolerance case)', () => {
    // A 1/64" multiline cut in the middle of its bottom element: the pieces are tiny but whole.
    const k = 1 / 64;
    const m = mline();
    const scaled = m.vertices.map((v, i) => ({
      ...v,
      position: { x: v.position.x * k, y: v.position.y * k },
      elements: v.elements.map((e, j) => ({
        ...e,
        parameters:
          i === 0 && j === 1 ? [e.parameters[0]! * k, 0, 3 * k, 5 * k] : [e.parameters[0]! * k, 0],
      })),
    }));
    const parts = mlineParts({ ...m, vertices: scaled }, model(), { fill: true });
    expect(parts).toHaveLength(5);
    expect(ends(parts[1]!.geom)).toEqual([0, -k, 3 * k, -k].map(r6));
  });
});
