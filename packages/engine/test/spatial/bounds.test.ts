// Entity bounds for the spatial index (M1-07). A box must always contain everything the
// entity draws in plan view, so a window or crossing query never misses it; it may be looser
// than the drawn shape (rotated block extents), never tighter.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_BOX,
  toleranceForSize,
  type Box,
  type EntityGeometry,
  type HatchGeometry,
  type InsertAttribute,
  type InsertGeometry,
} from '../../src/index';
import { entityBounds, type BoundsContext } from '../../src/spatial/index';

const tol = toleranceForSize(1000);

const ctx = (extents: Record<string, Box | 'unknown'> = {}, extra: Partial<BoundsContext> = {}) =>
  ({
    tol,
    blockExtents: (h: string) => extents[h],
    ...extra,
  }) satisfies BoundsContext;

const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({
  minX,
  minY,
  maxX,
  maxY,
});

function expectBox(actual: ReturnType<typeof entityBounds>, expected: Box, digits = 9): void {
  expect(actual.kind).toBe('box');
  if (actual.kind !== 'box') return;
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(actual.box[k]).toBeCloseTo(expected[k], digits);
  }
}

const insert = (over: Partial<InsertGeometry> = {}): InsertGeometry => ({
  kind: 'INSERT',
  block: 'B1',
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
  ...over,
});

describe('curves', () => {
  it('bounds a line, circle and arc exactly', () => {
    expectBox(
      entityBounds({ kind: 'LINE', start: { x: 3, y: 1 }, end: { x: -1, y: 4 } }, ctx()),
      box(-1, 1, 3, 4),
    );
    expectBox(
      entityBounds({ kind: 'CIRCLE', center: { x: 1, y: 2 }, radius: 3 }, ctx()),
      box(-2, -1, 4, 5),
    );
    // Quarter arc from 0 to 90 degrees: only the first quadrant.
    expectBox(
      entityBounds(
        { kind: 'ARC', center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: Math.PI / 2 },
        ctx(),
      ),
      box(0, 0, 2, 2),
    );
  });

  it('pads a wide lightweight polyline by half its widest segment', () => {
    const geom: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 0.5, endWidth: 2 },
        { x: 10, y: 0, bulge: 0 },
      ],
    };
    expectBox(entityBounds(geom, ctx()), box(-1, -1, 11, 1));
    expectBox(
      entityBounds(
        {
          ...geom,
          vertices: geom.vertices.map((v) => ({ ...v, startWidth: 0, endWidth: 0 })),
          constantWidth: 4,
        },
        ctx(),
      ),
      box(-2, -2, 12, 2),
    );
  });

  it('includes the bulge of a polyline arc segment', () => {
    // Bulge 1 from (0,0) to (2,0) is a CCW semicircle about (1,0): it dips to y = -1.
    const b = entityBounds(
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 1 },
          { x: 2, y: 0, bulge: 0 },
        ],
      },
      ctx(),
    );
    expectBox(b, box(0, -1, 2, 0));
  });

  it('bounds a heavyweight polyline from its drawn vertices and default widths', () => {
    expectBox(
      entityBounds(
        {
          kind: 'POLYLINE',
          closed: true,
          is3d: false,
          startWidth: 1,
          endWidth: 1,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 4, y: 0, bulge: 0 },
            { x: 4, y: 3, bulge: 0 },
          ],
        },
        ctx(),
      ),
      box(-0.5, -0.5, 4.5, 3.5),
    );
  });

  it('bounds a spline, ellipse, point, solid and 3D face', () => {
    expectBox(
      entityBounds(
        {
          kind: 'ELLIPSE',
          center: { x: 0, y: 0 },
          majorAxis: { x: 4, y: 0 },
          ratio: 0.5,
          startParam: 0,
          endParam: 2 * Math.PI,
        },
        ctx(),
      ),
      box(-4, -2, 4, 2),
    );
    const spline = entityBounds(
      {
        kind: 'SPLINE',
        degree: 1,
        knots: [0, 0, 1, 1],
        controlPoints: [
          { x: 0, y: 0 },
          { x: 5, y: 2 },
        ],
        closed: false,
        periodic: false,
      },
      ctx(),
    );
    // Spline boxes are padded by the tolerance so they always contain the curve.
    expectBox(spline, box(0, 0, 5, 2), 6);
    expectBox(entityBounds({ kind: 'POINT', position: { x: 7, y: 8 } }, ctx()), box(7, 8, 7, 8));
    const corners = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 2 },
      { x: 3, y: 5 },
    ] as const;
    expectBox(entityBounds({ kind: 'SOLID', corners }, ctx()), box(0, 0, 3, 5));
    expectBox(entityBounds({ kind: '3DFACE', corners, hiddenEdges: 0 }, ctx()), box(0, 0, 3, 5));
  });

  it('has no box for a polyline without vertices', () => {
    expect(entityBounds({ kind: 'LWPOLYLINE', closed: false, vertices: [] }, ctx()).kind).toBe(
      'empty',
    );
  });
});

describe('hatches', () => {
  const hatch = (loops: HatchGeometry['loops']): HatchGeometry => ({
    kind: 'HATCH',
    pattern: 'SOLID',
    solid: true,
    associative: false,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops,
    patternLines: [],
    seedPoints: [],
  });

  it('is bounded by the union of its boundary loops', () => {
    const geom = hatch([
      {
        flags: 2,
        polyline: {
          closed: true,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0 },
            { x: 10, y: 5, bulge: 0 },
          ],
        },
      },
      {
        flags: 1,
        edges: [
          { type: 'line', start: { x: 20, y: 0 }, end: { x: 22, y: 1 } },
          // Arcs and ellipses count whole, whatever their (clockwise-negated) angles.
          {
            type: 'arc',
            center: { x: 20, y: 10 },
            radius: 1,
            startAngle: 0,
            endAngle: 0.1,
            ccw: false,
          },
          {
            type: 'ellipse',
            center: { x: -5, y: 0 },
            majorAxis: { x: 2, y: 0 },
            ratio: 0.5,
            startAngle: 0,
            endAngle: 1,
            ccw: true,
          },
          {
            type: 'spline',
            degree: 1,
            knots: [0, 0, 1, 1],
            controlPoints: [
              { x: 0, y: -3 },
              { x: 1, y: -4 },
            ],
            periodic: false,
          },
        ],
      },
    ]);
    expectBox(entityBounds(geom, ctx()), box(-7, -4, 22, 11));
  });

  it('draws nothing without loops', () => {
    expect(entityBounds(hatch([]), ctx()).kind).toBe('empty');
  });
});

describe('tables', () => {
  const table: EntityGeometry = {
    kind: 'ACAD_TABLE',
    position: { x: 10, y: 20 },
    direction: { x: 1, y: 0 },
    rowHeights: [8, 6],
    columnWidths: [30, 40],
    cells: [],
  };

  it('covers the grid whichever way it runs from its insertion point', () => {
    // The grid is 70 × 14; it may flow up or down and run along any direction.
    const r = Math.hypot(70, 14);
    const b = entityBounds(table, ctx());
    expectBox(b, box(10 - r, 20 - r, 10 + r, 20 + r));
  });

  it('draws nothing without rows or columns', () => {
    expect(entityBounds({ ...table, rowHeights: [], columnWidths: [] }, ctx()).kind).toBe('empty');
  });
});

describe('images and underlays', () => {
  const image: EntityGeometry = {
    kind: 'IMAGE',
    position: { x: 10, y: 20 },
    u: { x: 0.5, y: 0 },
    v: { x: 0, y: 0.5 },
    size: { x: 100, y: 40 },
    displayFlags: 7,
    clipping: false,
    brightness: 50,
    contrast: 50,
    fade: 0,
    clip: { type: 'rectangle', vertices: [], inverted: false },
  };

  it('covers an image from its corner along u and v', () => {
    expectBox(entityBounds(image, ctx()), box(10, 20, 60, 40));
  });

  it('follows rotated pixel axes', () => {
    const g = { ...image, u: { x: 0, y: 0.5 }, v: { x: -0.5, y: 0 } };
    expectBox(entityBounds(g, ctx()), box(-10, 20, 10, 70));
  });

  it('bounds an underlay by its clip boundary only', () => {
    const u: EntityGeometry = {
      kind: 'PDFUNDERLAY',
      position: { x: 1, y: 2 },
      scale: { x: 2, y: 2, z: 1 },
      rotation: Math.PI / 2,
      flags: 3,
      contrast: 100,
      fade: 0,
      clip: [
        { x: 0, y: 0 },
        { x: 4, y: 3 },
      ],
    };
    expectBox(entityBounds(u, ctx()), box(-5, 2, 1, 10));
    expect(entityBounds({ ...u, clip: [] }, ctx()).kind).toBe('unknown');
    // A two-corner clip is a rectangle: rotated 45°, all four of its corners count.
    const r = Math.SQRT1_2;
    expectBox(
      entityBounds(
        { ...u, position: { x: 0, y: 0 }, scale: { x: 1, y: 1, z: 1 }, rotation: Math.PI / 4 },
        ctx(),
      ),
      box(-3 * r, 0, 4 * r, 7 * r),
    );
  });
});

describe('construction lines', () => {
  it('keeps XLINE and RAY as infinite lines with a unit direction', () => {
    const x = entityBounds(
      { kind: 'XLINE', base: { x: 1, y: 2 }, direction: { x: 0, y: 5 } },
      ctx(),
    );
    expect(x).toEqual({
      kind: 'infinite',
      base: { x: 1, y: 2 },
      direction: { x: 0, y: 1 },
      ray: false,
    });
    const r = entityBounds({ kind: 'RAY', base: { x: 0, y: 0 }, direction: { x: 3, y: 0 } }, ctx());
    expect(r).toEqual({
      kind: 'infinite',
      base: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      ray: true,
    });
  });
});

describe('text and annotations', () => {
  const text: EntityGeometry = {
    kind: 'TEXT',
    value: 'A',
    style: '11',
    position: { x: 0, y: 0 },
    height: 2.5,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
  };

  it('is unknown without exact text metrics, never estimated', () => {
    expect(entityBounds(text, ctx()).kind).toBe('unknown');
  });

  it('uses injected annotation bounds when they are given', () => {
    const c = ctx(
      {},
      {
        annotationBounds: (g) => ('kind' in g && g.kind === 'TEXT' ? box(0, 0, 2, 2.5) : undefined),
      },
    );
    expectBox(entityBounds(text, c), box(0, 0, 2, 2.5));
  });

  it('bounds a dimension by its *D block when nothing better is injected', () => {
    const dim = {
      kind: 'DIMENSION',
      dimType: 'linear',
      style: '27',
      block: 'D1',
      definitionPoint: { x: 0, y: 5 },
      textPosition: { x: 5, y: 6 },
      textUserPositioned: false,
      text: '',
      textRotation: 0,
      horizontalDirection: 0,
      attachment: 5,
      lineSpacingStyle: 1,
      lineSpacing: 1,
      first: { x: 0, y: 0 },
      second: { x: 10, y: 0 },
    } as const satisfies EntityGeometry;
    // The *D block is drawn in WCS: no transform.
    expectBox(entityBounds(dim, ctx({ D1: box(-1, -1, 11, 7) })), box(-1, -1, 11, 7));
    expect(entityBounds(dim, ctx({ D1: 'unknown' })).kind).toBe('unknown');
    const { block: _block, ...noBlock } = dim;
    expect(entityBounds(noBlock, ctx()).kind).toBe('unknown');
  });
});

describe('block references', () => {
  const unit = { B1: box(0, 0, 2, 1) };

  it('places the block extents relative to the base point', () => {
    expectBox(
      entityBounds(
        insert({ position: { x: 10, y: 20 } }),
        ctx(unit, { basePoint: () => ({ x: 1, y: 0 }) }),
      ),
      box(9, 20, 11, 21),
    );
  });

  it('scales, mirrors and rotates', () => {
    // Scale (2, 1) then rotate 90°: x' = -y, y' = 2x.
    expectBox(
      entityBounds(insert({ scale: { x: 2, y: 1, z: 1 }, rotation: Math.PI / 2 }), ctx(unit)),
      box(-1, 0, 0, 4),
    );
    // A -Z extrusion folds into scale.x < 0 (DEC-039): mirrored in X.
    expectBox(entityBounds(insert({ scale: { x: -1, y: 1, z: -1 } }), ctx(unit)), box(-2, 0, 0, 1));
  });

  it('covers every cell of a MINSERT array along the rotated, unscaled axes', () => {
    const geom = insert({
      scale: { x: 2, y: 2, z: 1 },
      array: { columns: 3, rows: 2, columnSpacing: 10, rowSpacing: -5 },
    });
    expectBox(entityBounds(geom, ctx(unit)), box(0, -5, 24, 2));
    expectBox(entityBounds({ ...geom, rotation: Math.PI }, ctx(unit)), box(-24, -2, 0, 5));
  });

  it('is a point at the insertion for an empty or missing block', () => {
    expectBox(
      entityBounds(insert({ position: { x: 3, y: 4 } }), ctx({ B1: EMPTY_BOX })),
      box(3, 4, 3, 4),
    );
    expectBox(
      entityBounds(insert({ position: { x: 3, y: 4 }, block: 'NOPE' }), ctx()),
      box(3, 4, 3, 4),
    );
  });

  it('is unknown when the block holds something unknown', () => {
    expect(entityBounds(insert(), ctx({ B1: 'unknown' })).kind).toBe('unknown');
  });

  it('includes visible attributes, through the injected text bounds', () => {
    const attr = {
      handle: 'A1',
      value: 'X',
      tag: 'T',
      flags: 0,
      style: '11',
      position: { x: 50, y: 50 },
      height: 1,
      rotation: 0,
      widthFactor: 1,
      oblique: 0,
      halign: 0,
      valign: 0,
      backward: false,
      upsideDown: false,
      layer: '10',
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
    } satisfies InsertAttribute;
    const geom = insert({ attributes: [attr] });
    expect(entityBounds(geom, ctx(unit)).kind).toBe('unknown');
    const withText = ctx(unit, {
      annotationBounds: (g) => ('tag' in g ? box(50, 50, 51, 51) : undefined),
    });
    expectBox(entityBounds(geom, withText), box(0, 0, 51, 51));
    // An invisible attribute (DXF 70 bit 1) draws nothing.
    expectBox(
      entityBounds(insert({ attributes: [{ ...attr, flags: 1 }] }), ctx(unit)),
      box(0, 0, 2, 1),
    );
  });
});

describe('multilines and viewports', () => {
  const el = (d: number) => ({ parameters: [d, 0], fillParameters: [] });
  const mline: EntityGeometry = {
    kind: 'MLINE',
    scale: 1,
    justification: 1,
    flags: 1,
    start: { x: 0, y: 0 },
    vertices: [
      {
        position: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        miter: { x: 0, y: 1 },
        elements: [el(1), el(-1)],
      },
      {
        position: { x: 10, y: 0 },
        direction: { x: 1, y: 0 },
        miter: { x: 0, y: 1 },
        elements: [el(1), el(-1)],
      },
    ],
  };

  it('covers every element of a multiline, plus room for its end caps', () => {
    // Elements at y = ±1; caps may reach half the 2-unit spread past each end.
    expectBox(entityBounds(mline, ctx()), box(-1, -2, 11, 2));
  });

  it('follows elements offset to one side, as top justification draws them', () => {
    const g = {
      ...mline,
      vertices: mline.vertices.map((v) => ({ ...v, elements: [el(0), el(-3)] })),
    };
    expectBox(entityBounds(g, ctx()), box(-1.5, -4.5, 11.5, 1.5));
    expect(entityBounds({ ...mline, vertices: [] }, ctx()).kind).toBe('empty');
  });

  it('bounds a viewport by its frame on the sheet', () => {
    const vp: EntityGeometry = {
      kind: 'VIEWPORT',
      center: { x: 5, y: 4 },
      width: 8,
      height: 6,
      id: 2,
      status: 1,
      flags: 0,
      viewCenter: { x: 1000, y: 1000 },
      viewHeight: 500,
      viewDirection: { x: 0, y: 0, z: 1 },
      viewTarget: { x: 0, y: 0, z: 0 },
      twist: 0,
      lensLength: 50,
      frontClip: 0,
      backClip: 0,
      frozenLayers: [],
      plotStyleSheet: '',
      renderMode: 0,
    };
    expectBox(entityBounds(vp, ctx()), box(1, 1, 9, 7));
  });
});

describe('regions', () => {
  it('bounds a region by the curves of all its loops', () => {
    const region: EntityGeometry = {
      kind: 'REGION',
      loops: [
        {
          face: 0,
          edges: [
            { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
            { kind: 'ARC', center: { x: 5, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI },
          ],
        },
        { face: 0, edges: [{ kind: 'CIRCLE', center: { x: 5, y: 2 }, radius: 1 }] },
      ],
    };
    expectBox(entityBounds(region, ctx()), box(0, 0, 10, 5));
    expect(entityBounds({ kind: 'REGION', loops: [] }, ctx()).kind).toBe('empty');
  });
});
