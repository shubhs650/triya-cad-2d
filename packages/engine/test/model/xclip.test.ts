import { describe, expect, it } from 'vitest';
import {
  clipBoundary,
  clipFrame,
  invertedBoundary,
  type SpatialFilter,
  type Vec2,
} from '../../src';

// prettier-ignore
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
] as const;

const filter = (over: Partial<SpatialFilter>): SpatialFilter => ({
  handle: 'F1',
  type: 'SPATIAL_FILTER',
  owner: 'D1',
  insert: 'I1',
  boundary: [],
  normal: { x: 0, y: 0, z: 1 },
  origin: { x: 0, y: 0, z: 0 },
  enabled: true,
  inverseInsert: IDENTITY,
  boundaryTransform: IDENTITY,
  ...over,
});

describe('clipBoundary (XCLIP)', () => {
  it('takes a polygon through the inverse insert transform into block coordinates', () => {
    // ezdxf xclip.dxf: a reference at (35.502931650755, 6.561753025165), scale 1, clipped by
    // an eight-point polygon stored in drawing coordinates.
    // prettier-ignore
    const inverseInsert = [
      1, 0, 0, -35.502931650755,
      0, 1, 0, -6.561753025165,
      0, 0, 1, 0,
    ];
    const out = clipBoundary(
      filter({
        inverseInsert,
        boundary: [
          { x: 34.938399335129, y: 13.236809066789 },
          { x: 42.313863019801, y: 13.236809066789 },
          { x: 42.313863019801, y: 6.820808571821 },
        ],
      }),
    )!;
    expect(out).toHaveLength(3);
    expect(out[0]!.x).toBeCloseTo(34.938399335129 - 35.502931650755, 12);
    expect(out[0]!.y).toBeCloseTo(13.236809066789 - 6.561753025165, 12);
    expect(out[2]!.y).toBeCloseTo(6.820808571821 - 6.561753025165, 12);
  });

  it('makes a two-point boundary the rectangle on its corners, scaled into the block', () => {
    // ACadSharp sample_AC1032: the block is in millimetres, inserted at 1/25.4.
    // prettier-ignore
    const inverseInsert = [
      25.4, 0, 0, -1087.9486607765664,
      0, 25.4, 0, 942.6167510625767,
      0, 0, 25.4, 0,
    ];
    const out = clipBoundary(
      filter({
        inverseInsert,
        boundary: [
          { x: 49, y: -32 },
          { x: 46, y: -36 },
        ],
      }),
    )!;
    const x0 = 46 * 25.4 - 1087.9486607765664;
    const x1 = 49 * 25.4 - 1087.9486607765664;
    const y0 = -36 * 25.4 + 942.6167510625767;
    const y1 = -32 * 25.4 + 942.6167510625767;
    expect(out.map((p) => [p.x, p.y])).toEqual([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
  });

  it('turns with a rotated reference', () => {
    // The inverse of a 90° turn about the origin: (x, y) → (y, −x).
    // prettier-ignore
    const inverseInsert = [
      0, 1, 0, 0,
      -1, 0, 0, 0,
      0, 0, 1, 0,
    ];
    const out = clipBoundary(
      filter({
        inverseInsert,
        boundary: [
          { x: 0, y: 0 },
          { x: 0, y: 2 },
          { x: -1, y: 2 },
        ],
      }),
    )!;
    expect(out.map((p) => [p.x + 0, p.y + 0])).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
    ]);
  });

  it('has no boundary for fewer than two points or a degenerate rectangle', () => {
    expect(clipBoundary(filter({ boundary: [{ x: 1, y: 1 }] }))).toBeUndefined();
    expect(
      clipBoundary(
        filter({
          boundary: [
            { x: 1, y: 1 },
            { x: 1, y: 5 },
          ],
        }),
      ),
    ).toBeUndefined();
  });
});

/** Whether `p` is inside the closed polygon (nonzero winding, as the renderer clips). */
function inside(poly: readonly Vec2[], p: Vec2): boolean {
  let winding = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && side > 0) winding++;
    } else if (b.y <= p.y && side < 0) winding--;
  }
  return winding !== 0;
}

describe('Invert clip (M5-04 part 11)', () => {
  it('cuts the inner boundary out of the outer bounds through a slit from its nearest extreme vertex', () => {
    // A rectangle 1–3 × 1–2 in −1–10 × 0–4: its lowest vertices are nearest a side (the bottom, 1
    // away); the first of them clockwise bridges to it. Outer counter-clockwise, inner clockwise.
    const out = invertedBoundary(
      [
        { x: 1, y: 1 },
        { x: 3, y: 2 },
      ],
      { minX: -1, minY: 0, maxX: 10, maxY: 4 },
    );
    expect(out.map((p) => [p.x, p.y])).toEqual([
      [3, 0],
      [10, 0],
      [10, 4],
      [-1, 4],
      [-1, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 2],
      [3, 2],
      [3, 1],
    ]);
    expect(inside(out, { x: 2, y: 1.5 })).toBe(false);
    expect(inside(out, { x: 5, y: 1.5 })).toBe(true);
    expect(inside(out, { x: 0.5, y: 3.5 })).toBe(true);
    expect(inside(out, { x: 11, y: 1 })).toBe(false);
  });

  it('bridges a concave boundary from an extreme vertex, so the slit crosses none of its edges', () => {
    // A U open to the left: only the U is hidden, its notch shows.
    const u = [
      { x: 2, y: 1 },
      { x: 6, y: 1 },
      { x: 6, y: 5 },
      { x: 2, y: 5 },
      { x: 2, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 2 },
      { x: 2, y: 2 },
    ];
    const out = invertedBoundary(u, { minX: 0, minY: 0, maxX: 7, maxY: 6 });
    expect(inside(out, { x: 5.5, y: 3 })).toBe(false); // the U's spine
    expect(inside(out, { x: 3, y: 1.5 })).toBe(false); // its lower arm
    expect(inside(out, { x: 3, y: 3 })).toBe(true); // the notch shows
    expect(inside(out, { x: 6.5, y: 3 })).toBe(true);
    expect(inside(out, { x: 1, y: 3 })).toBe(true);
  });

  it('shows everything around the inner boundary, well beyond the stored bounds, and frames the inner boundary', () => {
    // ezdxf xclip.dxf 822 ("Inverted Concave Clipping Path"): AutoCAD stored the outer bounds
    // and a slit but left the U out of the boundary; the ACAD_INVERTEDCLIP_ROUNDTRIP record holds it.
    const u = [
      { x: -0.5645, y: 6.6751 },
      { x: 6.8109, y: 6.6751 },
      { x: 6.8109, y: 0.2591 },
      { x: -0.5628, y: 0.2591 },
      { x: -0.5628, y: 2.1501 },
      { x: 5.4194, y: 2.1501 },
      { x: 5.4194, y: 5.3137 },
      { x: -0.5628, y: 5.3137 },
    ];
    const f = filter({
      boundary: [
        { x: -0.5645, y: 6.6751 },
        { x: -0.9428, y: 6.6751 },
        { x: -0.9428, y: 7.35 },
        { x: 7.3782, y: 7.35 },
        { x: 7.3782, y: -0.35 },
        { x: -0.9428, y: -0.35 },
        { x: -0.9428, y: 6.675 },
        { x: -0.5645, y: 6.675 },
      ],
      inverted: u,
    });
    const region = clipBoundary(f)!;
    expect(inside(region, { x: 6, y: 3 })).toBe(false);
    expect(inside(region, { x: 3, y: 1 })).toBe(false);
    expect(inside(region, { x: 3, y: 3.5 })).toBe(true);
    expect(inside(region, { x: 7.2, y: 3 })).toBe(true);
    // Beyond what AutoCAD stored: what the block grew to since still shows.
    expect(inside(region, { x: 12, y: 3 })).toBe(true);
    expect(inside(region, { x: -5, y: -5 })).toBe(true);
    expect(clipFrame(f)).toEqual(u);
  });

  it('frames a two-point inner boundary as its rectangle, through the inverse insert', () => {
    // prettier-ignore
    const inverseInsert = [
      1, 0, 0, -10,
      0, 1, 0, -20,
      0, 0, 1, 0,
    ];
    const f = filter({
      inverseInsert,
      boundary: invertedBoundary(
        [
          { x: 11, y: 21 },
          { x: 13, y: 22 },
        ],
        { minX: 9, minY: 19, maxX: 16, maxY: 25 },
      ),
      inverted: [
        { x: 11, y: 21 },
        { x: 13, y: 22 },
      ],
    });
    expect(clipFrame(f)!.map((p) => [p.x, p.y])).toEqual([
      [1, 1],
      [3, 1],
      [3, 2],
      [1, 2],
    ]);
    const region = clipBoundary(f)!;
    expect(inside(region, { x: 2, y: 1.5 })).toBe(false);
    expect(inside(region, { x: 4, y: 1.5 })).toBe(true);
  });

  it('frames an ordinary clip as its boundary, and has no frame without one', () => {
    const f = filter({
      boundary: [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
      ],
    });
    expect(clipFrame(f)).toEqual(clipBoundary(f));
    expect(clipFrame(filter({ boundary: [] }))).toBeUndefined();
    expect(
      clipBoundary(filter({ boundary: [{ x: 0, y: 0 }], inverted: [{ x: 1, y: 1 }] })),
    ).toBeUndefined();
  });
});
