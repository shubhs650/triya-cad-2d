// M2-22 PDF underlay osnaps: a page's vector paths become snap geometry (lines, circular arcs
// found among its Bézier curves, other Béziers), placed through the underlay's insertion,
// scale, rotation and clip, and snapped to by the running modes while PDFOSNAP is on.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  toleranceForSize,
  type EntityGeometry,
  type EntityInit,
  type Vec2,
} from '../../src/index';
import { SpatialIndex } from '../../src/spatial/index';
import { OSNAP, osnap, type OsnapQuery } from '../../src/input/osnap';
import {
  UnderlaySnapBuilder,
  underlayMatrix,
  underlaySnapCurves,
  underlaySnapShown,
  type UnderlayContent,
  type UnderlaySnapPage,
} from '../../src/input/underlay-snap';
import { applyPoint } from '../../src/geom/transform';
import {
  blockRecord,
  entityInit,
  LAYER_0,
  layer,
  linetype,
  MODEL_SPACE,
  PAPER_SPACE,
} from '../model/fixtures';

const tol = toleranceForSize(100);
const DEF = '9A';
const K = 0.5522847498307936; // the cubic Bézier quarter circle's handle length

/** Page 2 of the M1-20 fixture (11 × 8.5 in): a triangle and a grid at 1 in, in inches. */
function fixturePage(): UnderlaySnapPage {
  const b = new UnderlaySnapBuilder();
  b.line(2, 2, 9, 2);
  b.line(9, 2, 5.5, 7);
  b.line(5.5, 7, 2, 2);
  for (let i = 1; i <= 10; i++) b.line(i, 0, i, 8.5);
  for (let i = 1; i <= 7; i++) b.line(0, i, 11, i);
  return b.build();
}

/** Page 2's pentagon clip, in its own inches. */
const CLIP: Vec2[] = [
  { x: 1, y: 1 },
  { x: 10, y: 1 },
  { x: 10, y: 6 },
  { x: 5.5, y: 7.5 },
  { x: 1, y: 6 },
];

const underlay = (o: Partial<Extract<EntityGeometry, { kind: 'PDFUNDERLAY' }>> = {}) =>
  ({
    kind: 'PDFUNDERLAY',
    definition: DEF,
    position: { x: 12, y: 0 },
    scale: { x: 0.5, y: 0.5, z: 0.5 },
    rotation: Math.PI / 6,
    flags: 11,
    contrast: 100,
    fade: 0,
    clip: CLIP,
    ...o,
  }) as EntityGeometry;

function source(geoms: EntityGeometry[], page: UnderlaySnapPage | null = fixturePage()) {
  let next = 0x100;
  const entities: EntityInit[] = geoms.map((g) => entityInit((next++).toString(16), g));
  const model = DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 1, measurement: 'imperial' },
    handSeed: '1000',
    tables: {
      layers: [layer(LAYER_0, '0')],
      linetypes: [linetype('14', 'Continuous')],
      blockRecords: [
        blockRecord(MODEL_SPACE, '*Model_Space'),
        blockRecord(PAPER_SPACE, '*Paper_Space'),
      ],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: PAPER_SPACE, name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE },
      { handle: '23', name: 'Layout1', tabOrder: 1, blockRecord: PAPER_SPACE },
    ],
    entities,
  });
  const pages = { width: 11, height: 8.5 };
  return {
    model,
    index: SpatialIndex.build(model, { tol, underlayPage: () => pages }),
    block: MODEL_SPACE,
    tol,
    underlays: (d: string) => (d === DEF ? (page ?? undefined) : undefined),
  };
}

/** A point of page 2 (inches) in the drawing, through the fixture's placement. */
const world = (x: number, y: number): Vec2 =>
  applyPoint(underlayMatrix(underlay() as never), { x, y });

const query = (point: Vec2, modes: number, extra: Partial<OsnapQuery> = {}): OsnapQuery => ({
  point,
  aperture: 0.1,
  modes,
  ...extra,
});

describe('UnderlaySnapBuilder', () => {
  it('keeps line segments and drops zero-length ones', () => {
    const b = new UnderlaySnapBuilder();
    b.line(0, 0, 1, 0);
    b.line(2, 2, 2, 2);
    const page = b.build();
    expect(Array.from(page.lines)).toEqual([0, 0, 1, 0]);
    expect(page.arcs.length).toBe(0);
    expect(page.beziers.length).toBe(0);
  });

  it('recognises a Bézier quarter circle as an arc, either way round', () => {
    const b = new UnderlaySnapBuilder();
    // Centre (5, 5), radius 2: from (7, 5) counter-clockwise to (5, 7).
    b.cubic(7, 5, 7, 5 + 2 * K, 5 + 2 * K, 7, 5, 7);
    // The same quarter drawn clockwise, from (5, 7) to (7, 5).
    b.cubic(5, 7, 5 + 2 * K, 7, 7, 5 + 2 * K, 7, 5);
    const page = b.build();
    expect(page.arcs.length).toBe(10);
    for (let i = 0; i < 2; i++) {
      const [cx, cy, r, start, end] = Array.from(page.arcs.subarray(i * 5, i * 5 + 5));
      expect(cx).toBeCloseTo(5, 12);
      expect(cy).toBeCloseTo(5, 12);
      expect(r).toBeCloseTo(2, 12);
      expect(start).toBeCloseTo(0, 12);
      expect(end).toBeCloseTo(Math.PI / 2, 12);
    }
    expect(page.beziers.length).toBe(0);
  });

  it('keeps a Bézier that is no circular arc as a curve, and raises quadratics', () => {
    const b = new UnderlaySnapBuilder();
    b.cubic(0, 0, 1, 3, 2, -3, 3, 0);
    b.quadratic(0, 0, 1, 2, 2, 0);
    const page = b.build();
    expect(page.arcs.length).toBe(0);
    expect(page.beziers.length).toBe(16);
    // The raised quadratic keeps its ends and passes through its midpoint (1, 1).
    const raised = Array.from(page.beziers.subarray(8, 16));
    [0, 0, 2 / 3, 4 / 3, 4 / 3, 4 / 3, 2, 0].forEach((v, i) =>
      expect(raised[i]).toBeCloseTo(v, 12),
    );
  });

  it('turns a straight Bézier into a line', () => {
    const b = new UnderlaySnapBuilder();
    b.cubic(0, 0, 1, 1, 2, 2, 3, 3);
    const page = b.build();
    expect(Array.from(page.lines)).toEqual([0, 0, 3, 3]);
  });
});

describe('underlaySnapCurves', () => {
  it('returns only the curves near a box of the page', () => {
    const near = underlaySnapCurves(fixturePage(), { minX: 2.9, minY: 0.9, maxX: 3.1, maxY: 1.1 });
    // The vertical at x = 3 and the horizontal at y = 1 (the triangle starts at y = 2).
    expect(near).toHaveLength(2);
    expect(near.map((c) => c.kind)).toEqual(['LINE', 'LINE']);
  });

  it('gives arcs and Béziers as engine curves', () => {
    const b = new UnderlaySnapBuilder();
    b.cubic(7, 5, 7, 5 + 2 * K, 5 + 2 * K, 7, 5, 7);
    b.cubic(0, 0, 1, 3, 2, -3, 3, 0);
    const near = underlaySnapCurves(b.build(), { minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(near.map((c) => c.kind).sort()).toEqual(['ARC', 'SPLINE']);
  });
});

describe('osnap on PDF underlays (PDFOSNAP)', () => {
  it('snaps END to the triangle vertices through scale, rotation and insertion', () => {
    const src = source([underlay()]);
    for (const [x, y] of [
      [2, 2],
      [9, 2],
      [5.5, 7],
    ] as const) {
      const p = world(x, y);
      const [hit] = osnap(src, query({ x: p.x + 0.01, y: p.y - 0.01 }, OSNAP.END));
      expect(hit?.mode).toBe('END');
      expect(Math.hypot(hit!.point.x - p.x, hit!.point.y - p.y)).toBeLessThan(1e-6);
    }
  });

  it('snaps INT to the grid corners inside the clip', () => {
    const src = source([underlay()]);
    for (const [x, y] of [
      [3, 4],
      [1, 1],
      [10, 6],
      [7, 5],
    ] as const) {
      const p = world(x, y);
      const [hit] = osnap(src, query({ x: p.x + 0.02, y: p.y + 0.01 }, OSNAP.INT));
      expect(hit?.mode).toBe('INT');
      expect(Math.hypot(hit!.point.x - p.x, hit!.point.y - p.y)).toBeLessThan(1e-6);
    }
  });

  it('snaps nothing outside the clip', () => {
    const src = source([underlay()]);
    const all = OSNAP.END | OSNAP.INT | OSNAP.MID | OSNAP.NEA | OSNAP.PER;
    // (9, 7) and (2, 7) are grid corners above the pentagon's roof; (10, 0.5) below its base.
    for (const [x, y] of [
      [9, 7],
      [2, 7],
      [10, 0.5],
    ] as const) {
      expect(osnap(src, query(world(x, y), all, { from: world(0, 0) }))).toEqual([]);
    }
  });

  it('snaps anywhere on the page with clipping off', () => {
    const src = source([underlay({ flags: 10 })]);
    const p = world(9, 7);
    const [hit] = osnap(src, query(p, OSNAP.INT));
    expect(Math.hypot(hit!.point.x - p.x, hit!.point.y - p.y)).toBeLessThan(1e-6);
  });

  it('snaps nothing with PDFOSNAP off, the underlay off or its page not read', () => {
    const p = world(3, 4);
    expect(osnap(source([underlay()]), query(p, OSNAP.INT, { underlays: false }))).toEqual([]);
    expect(osnap(source([underlay({ flags: 9 })]), query(p, OSNAP.INT))).toEqual([]);
    expect(osnap(source([underlay()], null), query(p, OSNAP.INT))).toEqual([]);
  });

  it('snaps CEN to a circle drawn as four Béziers, and MID to an arc', () => {
    const b = new UnderlaySnapBuilder();
    const [cx, cy, r] = [4, 4, 1];
    const k = r * K;
    b.cubic(cx + r, cy, cx + r, cy + k, cx + k, cy + r, cx, cy + r);
    b.cubic(cx, cy + r, cx - k, cy + r, cx - r, cy + k, cx - r, cy);
    b.cubic(cx - r, cy, cx - r, cy - k, cx - k, cy - r, cx, cy - r);
    b.cubic(cx, cy - r, cx + k, cy - r, cx + r, cy - k, cx + r, cy);
    const src = source([underlay({ flags: 10 })], b.build());
    const edge = world(cx + r, cy + 0.01);
    const c = world(cx, cy);
    const cen = osnap(src, query(edge, OSNAP.CEN)).find((h) => h.mode === 'CEN');
    expect(Math.hypot(cen!.point.x - c.x, cen!.point.y - c.y)).toBeLessThan(1e-6);
    const m = world(cx + r * Math.SQRT1_2, cy + r * Math.SQRT1_2);
    const [mid] = osnap(src, query(m, OSNAP.MID));
    expect(mid?.mode).toBe('MID');
    expect(Math.hypot(mid!.point.x - m.x, mid!.point.y - m.y)).toBeLessThan(1e-6);
  });

  it('snaps to an upside-down underlay with its Y axis reversed', () => {
    const src = source([underlay({ flags: 10, upsideDown: true, rotation: 0 })]);
    const p = { x: 12 + 0.5 * 3, y: -0.5 * 4 };
    const [hit] = osnap(src, query(p, OSNAP.INT));
    expect(Math.hypot(hit!.point.x - p.x, hit!.point.y - p.y)).toBeLessThan(1e-6);
  });
});

// M2-56 part 3: a path inside optional content (a PDF layer) is snapped to only while that
// content shows, as the page is drawn: the PDF's own default visibility with the layers the
// underlay names in `layersOff` (ULAYERS) turned off, under pdf.js's rules for an OCMD's
// policy and visibility expression.
describe('PDF layers in snap geometry (M2-56)', () => {
  const GROUPS = [
    { id: '5R', name: 'Walls', on: true },
    { id: '6R', name: 'Notes', on: true },
    { id: '7R', name: 'Draft', on: false },
  ];

  /** Three unit squares' bottom edges, each in its own content. */
  function layeredPage(): UnderlaySnapPage {
    const b = new UnderlaySnapBuilder();
    b.groups(GROUPS);
    b.line(0, 0, 1, 0);
    b.within([{ type: 'OCG', id: '5R' }]);
    b.line(2, 0, 3, 0);
    b.within([{ type: 'OCG', id: '7R' }]);
    b.cubic(4, 0, 4, 0.5, 5, 0.5, 5, 0);
    b.within([]);
    b.line(6, 0, 7, 0);
    return b.build();
  }

  it('records each item’s content and keeps a page without any as before', () => {
    const page = layeredPage();
    expect(page.layers?.groups).toEqual(GROUPS);
    expect(page.layers?.conditions).toEqual([
      [],
      [{ type: 'OCG', id: '5R' }],
      [{ type: 'OCG', id: '7R' }],
    ]);
    expect(Array.from(page.layers!.lines)).toEqual([0, 1, 0]);
    expect(Array.from(page.layers!.beziers)).toEqual([2]);
    expect(fixturePage().layers).toBeUndefined();
  });

  it('shows content by the PDF default with the layers named off', () => {
    const page = layeredPage();
    expect(Array.from(underlaySnapShown(page, undefined)!)).toEqual([1, 1, 0]);
    expect(Array.from(underlaySnapShown(page, ['Walls'])!)).toEqual([1, 0, 0]);
    expect(underlaySnapShown(fixturePage(), ['Walls'])).toBeUndefined();
  });

  it('leaves out the curves of content that does not show', () => {
    const page = layeredPage();
    const all = { minX: -1, minY: -1, maxX: 8, maxY: 1 };
    const starts = (shown: Uint8Array | undefined) =>
      underlaySnapCurves(page, all, shown).map((c) =>
        c.kind === 'LINE' ? c.start.x : c.kind === 'SPLINE' ? c.controlPoints[0]!.x : -1,
      );
    expect(starts(undefined)).toEqual([0, 2, 6, 4]);
    expect(starts(underlaySnapShown(page, undefined))).toEqual([0, 2, 6]);
    expect(starts(underlaySnapShown(page, ['Walls']))).toEqual([0, 6]);
  });

  it('nests content: every level must show', () => {
    const b = new UnderlaySnapBuilder();
    b.groups(GROUPS);
    b.within([
      { type: 'OCG', id: '5R' },
      { type: 'OCG', id: '6R' },
    ]);
    b.line(0, 0, 1, 0);
    const page = b.build();
    expect(Array.from(underlaySnapShown(page, [])!)).toEqual([1, 1]);
    expect(Array.from(underlaySnapShown(page, ['Notes'])!)).toEqual([1, 0]);
  });

  it('follows an OCMD policy and visibility expression as pdf.js does', () => {
    const b = new UnderlaySnapBuilder();
    b.groups(GROUPS);
    const conds: UnderlayContent[] = [
      { type: 'OCMD', ids: ['5R', '6R'], policy: null }, // AnyOn
      { type: 'OCMD', ids: ['5R', '6R'], policy: 'AllOn' },
      { type: 'OCMD', ids: ['5R', '7R'], policy: 'AnyOff' },
      { type: 'OCMD', ids: ['5R', '7R'], policy: 'AllOff' },
      { type: 'OCMD', id: '7R' },
      { type: 'OCMD', expression: ['Not', '7R'] },
      { type: 'OCMD', expression: ['And', '5R', ['Or', '7R', '6R']] },
      { type: 'OCMD', ids: ['5R'], policy: 'Odd' },
      { type: 'OCG', id: '99R' },
    ];
    for (const c of conds) {
      b.within([c]);
      b.line(0, 0, 1, 0);
    }
    const page = b.build();
    expect(Array.from(underlaySnapShown(page, [])!).slice(1)).toEqual([1, 1, 1, 0, 0, 1, 1, 1, 1]);
    expect(Array.from(underlaySnapShown(page, ['Walls', 'Notes'])!).slice(1)).toEqual([
      0, 0, 1, 1, 0, 1, 0, 1, 1,
    ]);
  });

  it('shows everything when the page names no groups, as pdf.js does', () => {
    const b = new UnderlaySnapBuilder();
    b.within([{ type: 'OCG', id: '5R' }]);
    b.line(0, 0, 1, 0);
    expect(Array.from(underlaySnapShown(b.build(), ['Walls'])!)).toEqual([1, 1]);
  });

  it('osnap skips the geometry of layers the underlay turns off', () => {
    const b = new UnderlaySnapBuilder();
    b.groups(GROUPS);
    b.within([{ type: 'OCG', id: '5R' }]);
    b.line(2, 2, 9, 2);
    b.within([{ type: 'OCG', id: '7R' }]);
    b.line(2, 4, 9, 4);
    b.within([{ type: 'OCG', id: '6R' }]);
    b.line(2, 6, 9, 6);
    const page = b.build();
    const plain = { flags: 10 };
    const at = (y: number, layersOff?: string[]) =>
      osnap(
        source([underlay({ ...plain, ...(layersOff && { layersOff }) })], page),
        query(world(2.01, y), OSNAP.END),
      ).length;
    expect([at(2), at(4), at(6)]).toEqual([1, 0, 1]);
    expect([at(2, ['Walls']), at(4, ['Walls']), at(6, ['Walls'])]).toEqual([0, 0, 1]);
  });
});
