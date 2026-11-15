// M3-07 part 2: MEASUREGEOM's Quick mode measures what the cursor is over (distances across it
// between the nearest objects, an object's length or radius, the angles at a line's ends, 90°
// marked) and the space a click is in (area and perimeter, islands taken out).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  enclosedSpace,
  quickMeasure,
  toleranceForSize,
  type EntityGeometry,
  type EntityInit,
  type Vec2,
} from '../../src/index';
import { SpatialIndex } from '../../src/spatial/index';
import { entityInit, sampleInit, lineGeom, circleGeom, MODEL_SPACE } from '../model/fixtures';

const tol = toleranceForSize(1000);
const VIEW = { minX: -50, minY: -50, maxX: 50, maxY: 50 };

let next = 0x100;
const e = (geom: EntityGeometry): EntityInit =>
  entityInit((next++).toString(16).toUpperCase(), geom);

function source(geoms: EntityGeometry[]) {
  const base = sampleInit();
  const model = DocumentModel.create({ ...base, entities: geoms.map(e) });
  return { model, index: SpatialIndex.build(model, { tol }), block: MODEL_SPACE, tol };
}

const rect = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: [
    { x: x0, y: y0, bulge: 0 },
    { x: x1, y: y0, bulge: 0 },
    { x: x1, y: y1, bulge: 0 },
    { x: x0, y: y1, bulge: 0 },
  ],
});

const at = (x: number, y: number): Vec2 => ({ x, y });
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

describe('quickMeasure', () => {
  it('measures across the cursor between the nearest objects on either side', () => {
    const src = source([rect(0, 0, 10, 10), lineGeom(6, -5, 6, 20)]);
    const m = quickMeasure(src, { point: at(3, 4), aperture: 0.2, view: VIEW });
    expect(m.spans).toEqual([
      { from: at(0, 4), to: at(6, 4), text: '6.0000' },
      { from: at(3, 0), to: at(3, 10), text: '10.0000' },
    ]);
    expect(m.angles).toEqual([]);
  });

  it('measures nothing across where one side has no object', () => {
    const src = source([lineGeom(0, -5, 0, 5)]);
    expect(quickMeasure(src, { point: at(3, 0), aperture: 0.2, view: VIEW }).spans).toEqual([]);
  });

  it('shows a line once when the cursor runs along it', () => {
    const src = source([rect(0, 0, 10, 10)]);
    const m = quickMeasure(src, { point: at(5, 0), aperture: 0.2, view: VIEW });
    // The cursor on the edge has nothing below it, and across it only the edge's own ends.
    expect(m.spans).toEqual([{ from: at(0, 0), to: at(10, 0), text: '10.0000' }]);
  });

  it("gives a hovered line's length and the angles at its ends, 90° marked", () => {
    const src = source([rect(0, 0, 10, 10), lineGeom(10, 0, 14, 4)]);
    const m = quickMeasure(src, { point: at(5, 0.1), aperture: 0.2, view: VIEW });
    expect(m.spans).toContainEqual({ from: at(0, 0), to: at(10, 0), text: '10.0000' });
    expect(m.angles.map((a) => [a.vertex, a.text, a.right])).toEqual(
      expect.arrayContaining([
        [at(0, 0), '90°', true],
        [at(10, 0), '90°', true],
        [at(10, 0), '135°', false],
      ]),
    );
    expect(m.angles).toHaveLength(3);
    const square = m.angles[0]!;
    expect(r4(square.start)).toBe(0);
    expect(r4(square.sweep)).toBe(r4(Math.PI / 2));
  });

  it("gives a hovered circle's radius towards the cursor", () => {
    const src = source([circleGeom(0, 0, 5)]);
    const m = quickMeasure(src, { point: at(0, 5.1), aperture: 0.2, view: VIEW });
    expect(m.spans.at(-1)).toEqual({ from: at(0, 0), to: at(0, 5), text: 'R5.0000' });
  });

  it('does not measure text, hatches or dimensions', () => {
    const src = source([
      rect(0, 0, 10, 10),
      {
        kind: 'TEXT',
        value: 'A',
        style: '0',
        position: at(1, 4),
        height: 1,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
      },
    ]);
    const m = quickMeasure(src, { point: at(3, 4), aperture: 0.2, view: VIEW });
    expect(m.spans[0]!.text).toBe('10.0000');
  });
});

describe('enclosedSpace', () => {
  it('measures the space a point is in, islands taken out and their perimeters added', () => {
    const src = source([rect(0, 0, 10, 10), circleGeom(5, 5, 2)]);
    const s = enclosedSpace(src, at(1, 1), VIEW)!;
    expect(r4(s.area)).toBe(r4(100 - 4 * Math.PI));
    expect(r4(s.perimeter)).toBe(r4(40 + 4 * Math.PI));
    expect(s.loops).toHaveLength(2);
    const disc = enclosedSpace(src, at(5, 5), VIEW)!;
    expect(r4(disc.area)).toBe(r4(4 * Math.PI));
    expect(r4(disc.perimeter)).toBe(r4(4 * Math.PI));
    expect(enclosedSpace(src, at(20, 20), VIEW)).toBeUndefined();
  });

  it('finds the spaces two crossing outlines make', () => {
    const src = source([rect(0, 0, 10, 10), rect(5, 5, 15, 15)]);
    const overlap = enclosedSpace(src, at(7, 7), VIEW)!;
    expect([r4(overlap.area), r4(overlap.perimeter)]).toEqual([25, 20]);
    const l = enclosedSpace(src, at(2, 2), VIEW)!;
    expect([r4(l.area), r4(l.perimeter)]).toEqual([75, 40]);
  });

  it('ignores lines that end in the open, and nested islands count once', () => {
    const src = source([
      rect(0, 0, 10, 10),
      lineGeom(0, 8, 4, 8),
      lineGeom(7, 9, 9, 9),
      circleGeom(5, 4, 3),
      circleGeom(5, 4, 1),
    ]);
    const s = enclosedSpace(src, at(0.5, 0.5), VIEW)!;
    expect(r4(s.area)).toBe(r4(100 - 9 * Math.PI));
    expect(r4(s.perimeter)).toBe(r4(40 + 6 * Math.PI));
    const ring = enclosedSpace(src, at(5, 6), VIEW)!;
    expect(r4(ring.area)).toBe(r4(8 * Math.PI));
  });

  it('measures spaces bounded by arcs: a half disc of a line and an arc', () => {
    const src = source([
      lineGeom(-4, 0, 4, 0),
      { kind: 'ARC', center: at(0, 0), radius: 4, startAngle: 0, endAngle: Math.PI },
    ]);
    const s = enclosedSpace(src, at(0, 1), VIEW)!;
    expect(r4(s.area)).toBe(r4(8 * Math.PI));
    expect(r4(s.perimeter)).toBe(r4(8 + 4 * Math.PI));
  });
});
