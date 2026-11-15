// M3-05 part 3: grips on ellipses, hatches and layout viewports (AutoCAD 2024 Help, "Grips
// Reference", "To Modify Hatch Objects Using Grips", "To Resize a Layout Viewport").
import { describe, expect, it } from 'vitest';
import {
  gripFunctionEdit,
  gripFunctionValue,
  gripFunctionsOf,
  gripsOf,
  moveGrip,
  moveGripBy,
  type EllipseGeometry,
  type EntityGeometry,
  type HatchGeometry,
  type ViewportGeometry,
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

const ellipse = (startParam = 0, endParam = 2 * Math.PI): EllipseGeometry => ({
  kind: 'ELLIPSE',
  center: { x: 0, y: 0 },
  majorAxis: { x: 10, y: 0 },
  ratio: 0.5,
  startParam,
  endParam,
});

const hatch = (over: Partial<HatchGeometry> = {}): HatchGeometry => ({
  kind: 'HATCH',
  pattern: 'ANSI31',
  solid: false,
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
          { x: 10, y: 6, bulge: 0 },
          { x: 0, y: 6, bulge: 0 },
        ],
      },
    },
  ],
  patternLines: [
    { angle: Math.PI / 4, base: { x: 0, y: 0 }, offset: { x: -1, y: 1 }, dashes: [2, -1] },
  ],
  seedPoints: [],
  ...over,
});

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100, y: 50 },
  width: 40,
  height: 20,
  id: 2,
  status: 1,
  flags: 0,
  viewCenter: { x: 10, y: 10 },
  viewHeight: 10,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
  ...over,
});

describe('ellipse grips', () => {
  it('a whole ellipse: its centre and its four axis ends', () => {
    expect(pts(ellipse())).toEqual([
      [0, 0, 'move'],
      [10, 0, 'axis'],
      [0, 5, 'axis'],
      [-10, 0, 'axis'],
      [0, -5, 'axis'],
    ]);
  });

  it('an elliptical arc: its centre, its ends and the axis ends on it', () => {
    expect(pts(ellipse(0, Math.PI))).toEqual([
      [0, 0, 'move'],
      [10, 0, 'ellipseEnd'],
      [0, 5, 'axis'],
      [-10, 0, 'ellipseEnd'],
    ]);
    // Across the parameter's zero: the quadrant at 0 is on it.
    expect(pts(ellipse(1.5 * Math.PI + 0.1, 0.5 * Math.PI + 0.1)).map((p) => p[2])).toEqual([
      'move',
      'ellipseEnd',
      'axis',
      'axis',
      'ellipseEnd',
    ]);
  });

  it('an axis end sets that axis’s length, its direction kept', () => {
    const longer = shape(ellipse(), { x: 10, y: 0 }, { x: 0, y: 12 });
    expect([r6(longer.majorAxis.x), r6(longer.majorAxis.y), r6(longer.ratio)]).toEqual([
      12,
      0,
      r6(5 / 12),
    ]);
    const minor = shape(ellipse(), { x: 0, y: -5 }, { x: 0, y: -8 });
    expect([r6(minor.majorAxis.x), r6(minor.ratio)]).toEqual([10, 0.8]);
  });

  it('dragged past the other axis, the axes change places', () => {
    // The minor axis longer than the major: it is the major axis now.
    const swapped = shape(ellipse(), { x: 0, y: 5 }, { x: 0, y: 16 });
    expect([r6(swapped.majorAxis.x), r6(swapped.majorAxis.y), r6(swapped.ratio)]).toEqual([
      0,
      16,
      r6(10 / 16),
    ]);
    expect([swapped.startParam, swapped.endParam]).toEqual([0, 2 * Math.PI]);
    // The major axis shorter than the minor: an arc's parameters turn with the axes, so the arc
    // keeps its ends' directions.
    const arc = ellipse(0, Math.PI);
    const short = shape(arc, { x: 0, y: 5 }, { x: 0, y: 20 });
    const ends = (e: EllipseGeometry) =>
      [e.startParam, e.endParam].map((t) => {
        const minor = { x: -e.majorAxis.y * e.ratio, y: e.majorAxis.x * e.ratio };
        return [
          r6(e.majorAxis.x * Math.cos(t) + minor.x * Math.sin(t)),
          r6(e.majorAxis.y * Math.cos(t) + minor.y * Math.sin(t)),
        ];
      });
    expect(ends(short)).toEqual([
      [10, 0],
      [-10, 0],
    ]);
    const flat = shape(ellipse(), { x: -10, y: 0 }, { x: -2, y: 0 });
    expect([r6(flat.majorAxis.x), r6(flat.majorAxis.y), r6(flat.ratio)]).toEqual([0, 5, 0.4]);
  });

  it('an elliptical arc’s end moves along the ellipse towards the point', () => {
    const e = shape(ellipse(0, Math.PI), { x: -10, y: 0 }, { x: 0, y: -50 });
    expect(r6(e.endParam)).toBe(r6(1.5 * Math.PI));
    const s = shape(ellipse(0, Math.PI), { x: 10, y: 0 }, { x: 0, y: 1 });
    expect(r6(s.startParam)).toBe(r6(Math.PI / 2));
    // Onto the other end, or onto the centre: no shape.
    expect(moveGrip(ellipse(0, Math.PI), { x: 10, y: 0 }, { x: -3, y: 0 }).kind).toBe('none');
    expect(moveGrip(ellipse(0, Math.PI), { x: 10, y: 0 }, { x: 0, y: 0 }).kind).toBe('none');
    expect(moveGrip(ellipse(), { x: 10, y: 0 }, { x: 0, y: 0 }).kind).toBe('none');
  });
});

describe('hatch grips', () => {
  it('one control grip at the centre of its extents, which moves it', () => {
    // An associative hatch follows its boundary objects: the control grip alone (M3-05 part 6
    // gives a non-associative one its boundary's grips too: object-grips.test.ts).
    expect(pts(hatch({ associative: true }))).toEqual([[5, 3, 'move']]);
    expect(moveGrip(hatch(), { x: 5, y: 3 }, { x: 9, y: 9 }).kind).toBe('move');
    // Edges count too; a hatch without a boundary has no grip.
    const edged = hatch({
      associative: true,
      loops: [
        {
          flags: 1,
          edges: [
            { type: 'line', start: { x: -4, y: 0 }, end: { x: 4, y: 0 } },
            {
              type: 'arc',
              center: { x: 0, y: 0 },
              radius: 4,
              startAngle: 0,
              endAngle: Math.PI,
              ccw: true,
            },
          ],
        },
      ],
    });
    expect(pts(edged)).toEqual([[0, 2, 'move']]);
    expect(pts(hatch({ loops: [] }))).toEqual([]);
  });

  it('a patterned hatch’s grip: Stretch, Origin Point, Hatch Angle, Hatch Scale', () => {
    const at = { x: 5, y: 3 };
    expect(gripFunctionsOf(hatch(), at)).toEqual([
      'Stretch',
      'Origin Point',
      'Hatch Angle',
      'Hatch Scale',
    ]);
    // A solid fill or a gradient has nothing to lay out.
    expect(gripFunctionsOf(hatch({ solid: true, pattern: 'SOLID', patternLines: [] }), at)).toEqual(
      [],
    );
    expect(gripFunctionsOf(hatch(), { x: 0, y: 0 })).toEqual([]);
  });

  it('Origin Point moves the lines; Hatch Angle and Hatch Scale lay them out about the origin', () => {
    const at = { x: 5, y: 3 };
    const origin = gripFunctionEdit(hatch(), at, 'Origin Point', { x: 2, y: 3 }, tol);
    expect(origin).toMatchObject({ patternLines: [{ base: { x: 2, y: 3 }, angle: Math.PI / 4 }] });

    const turned = gripFunctionEdit(hatch(), at, 'Hatch Angle', { x: 5, y: 13 }, tol);
    if (typeof turned === 'string' || turned.kind !== 'HATCH') throw new Error(String(turned));
    expect(r6(turned.patternAngle)).toBe(r6(Math.PI / 2));
    const line = turned.patternLines[0]!;
    expect([r6(line.angle), r6(line.offset.x), r6(line.offset.y)]).toEqual([
      r6((3 * Math.PI) / 4),
      -1,
      -1,
    ]);
    expect(gripFunctionEdit(hatch(), at, 'Hatch Angle', at, tol)).toBe('invalid');

    const scaled = gripFunctionEdit(hatch(), at, 'Hatch Scale', { x: 7, y: 3 }, tol);
    expect(scaled).toMatchObject({
      patternScale: 2,
      patternLines: [{ offset: { x: -2, y: 2 }, dashes: [4, -2] }],
    });
    expect(gripFunctionEdit(hatch(), at, 'Hatch Scale', at, tol)).toBe('invalid');
    // The drag preview's edit is the same.
    expect(moveGripBy(hatch(), at, { x: 7, y: 3 }, undefined, 'Hatch Scale')).toMatchObject({
      kind: 'shape',
      geom: { patternScale: 2 },
    });
  });

  it('typed values are the angle and scale themselves', () => {
    const turned = gripFunctionValue(
      hatch({ patternAngle: 0.5 }),
      'Hatch Angle',
      -Math.PI / 2,
      tol,
    );
    expect(turned).toMatchObject({ patternAngle: 1.5 * Math.PI });
    // A file's scale of 0 counts as 1.
    expect(gripFunctionValue(hatch({ patternScale: 0 }), 'Hatch Scale', 3, tol)).toMatchObject({
      patternScale: 3,
      patternLines: [{ offset: { x: -3, y: 3 } }],
    });
    expect(gripFunctionValue(hatch(), 'Hatch Scale', 0, tol)).toBe('invalid');
  });
});

describe('viewport grips', () => {
  it('a layout viewport’s four corners; none on the paper space viewport or a clipped one', () => {
    expect(pts(viewport())).toEqual([
      [80, 40, 'viewport'],
      [120, 40, 'viewport'],
      [120, 60, 'viewport'],
      [80, 60, 'viewport'],
    ]);
    expect(pts(viewport({ id: 1 }))).toEqual([]);
    expect(pts(viewport({ clipBoundary: '9A' }))).toEqual([]);
  });

  it('a corner resizes it about the opposite one, the drawing staying where it is on the sheet', () => {
    const v = shape(viewport(), { x: 120, y: 60 }, { x: 130, y: 70 });
    expect(v).toMatchObject({
      center: { x: 105, y: 55 },
      width: 50,
      height: 30,
      viewHeight: 15,
      viewCenter: { x: 12.5, y: 12.5 },
    });
    // The drawing's point at the fixed corner is the same before and after.
    const at = (g: ViewportGeometry, p: { x: number; y: number }) => {
      const k = g.height / g.viewHeight;
      return [g.viewCenter.x + (p.x - g.center.x) / k, g.viewCenter.y + (p.y - g.center.y) / k];
    };
    expect(at(v, { x: 80, y: 40 })).toEqual(at(viewport(), { x: 80, y: 40 }));
    // Past the opposite corner, the frame turns over; onto its line, no shape.
    expect(shape(viewport(), { x: 80, y: 40 }, { x: 130, y: 70 })).toMatchObject({
      center: { x: 125, y: 65 },
      width: 10,
      height: 10,
    });
    expect(moveGrip(viewport(), { x: 80, y: 40 }, { x: 120, y: 30 }).kind).toBe('none');
  });
});
