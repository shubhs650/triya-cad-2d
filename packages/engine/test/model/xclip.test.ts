import { describe, expect, it } from 'vitest';
import { clipBoundary, type SpatialFilter } from '../../src';

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
