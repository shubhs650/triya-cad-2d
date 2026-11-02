// Tessellation (M1-12): entity geometry → render primitives, once per change. Curves stay
// exact as canvas arcs and ellipses; only splines are flattened.
import { describe, expect, it } from 'vitest';
import {
  PATH_A,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Z,
  fitView,
  screenToWorld,
  tessellate,
  visibleBox,
  worldToScreen,
  type RenderPrimitive,
} from '../src/index';

const paint = { color: '#ff0000' };
const path = (p: RenderPrimitive | undefined): readonly number[] =>
  p && 'path' in p ? p.path : [];

describe('tessellate', () => {
  it('draws a line as a move and a line', () => {
    const [p] = tessellate({ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 3, y: 4 } }, paint);
    expect(p).toEqual({ kind: 'stroke', path: [PATH_M, 0, 0, PATH_L, 3, 4], color: '#ff0000' });
  });

  it('keeps circles, arcs and ellipses exact', () => {
    const c = tessellate({ kind: 'CIRCLE', center: { x: 1, y: 2 }, radius: 3 }, paint);
    expect(path(c[0])).toEqual([PATH_M, 4, 2, PATH_A, 1, 2, 3, 0, 2 * Math.PI, 1, PATH_Z]);
    // An arc whose end angle is below its start wraps through 0, counter-clockwise.
    const a = tessellate(
      {
        kind: 'ARC',
        center: { x: 0, y: 0 },
        radius: 1,
        startAngle: 1.5 * Math.PI,
        endAngle: 0.5 * Math.PI,
      },
      paint,
    );
    const ap = path(a[0]);
    expect(ap.slice(0, 3)).toEqual([PATH_M, expect.closeTo(0, 12), -1]);
    expect(ap.slice(3)).toEqual([PATH_A, 0, 0, 1, 1.5 * Math.PI, 2.5 * Math.PI, 1]);
    const e = tessellate(
      {
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 0, y: 2 },
        ratio: 0.5,
        startParam: 0,
        endParam: Math.PI,
      },
      paint,
    );
    const ep = path(e[0]);
    expect(ep.slice(0, 3)).toEqual([PATH_M, expect.closeTo(0, 12), 2]);
    expect(ep.slice(3)).toEqual([PATH_E, 0, 0, 2, 1, Math.PI / 2, 0, Math.PI, 1]);
  });

  it('draws bulge segments as arcs with their direction', () => {
    const [p] = tessellate(
      {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 1 }, // a CCW half circle to (2, 0)
          { x: 2, y: 0, bulge: 0 },
          { x: 2, y: 2, bulge: -1 }, // a CW half circle back to (0, 0)... closing segment
        ],
      },
      paint,
    );
    const a = path(p);
    expect(a.slice(0, 3)).toEqual([PATH_M, 0, 0]);
    expect(a[3]).toBe(PATH_A);
    expect(a.slice(4, 7)).toEqual([
      expect.closeTo(1, 12),
      expect.closeTo(0, 12),
      expect.closeTo(1, 12),
    ]);
    expect(a[8]! - a[7]!).toBeCloseTo(Math.PI, 12);
    expect(a[9]).toBe(1);
    expect(a.slice(10, 13)).toEqual([PATH_L, 2, 2]);
    expect(a[13]).toBe(PATH_A);
    expect(a[19]).toBe(0);
    expect(a[a.length - 1]).toBe(PATH_Z);
  });

  it('flattens a spline from its first to its last point', () => {
    const [p] = tessellate(
      {
        kind: 'SPLINE',
        degree: 2,
        knots: [0, 0, 0, 1, 1, 1],
        controlPoints: [
          { x: 0, y: 0 },
          { x: 5, y: 10 },
          { x: 10, y: 0 },
        ],
        closed: false,
        periodic: false,
      },
      paint,
    );
    const a = path(p);
    expect(a.slice(0, 3)).toEqual([PATH_M, 0, 0]);
    expect(a.slice(-3)).toEqual([PATH_L, 10, 0]);
    expect(a.length / 3).toBeGreaterThan(20);
  });

  it('draws a spline stored only as fit points through them (M1-47)', () => {
    const fitPoints = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const [p] = tessellate(
      {
        kind: 'SPLINE',
        degree: 3,
        knots: [],
        controlPoints: [],
        fitPoints,
        closed: false,
        periodic: false,
      },
      paint,
    );
    const a = path(p);
    expect(a.slice(0, 3)).toEqual([PATH_M, 0, 0]);
    const last = a.slice(-2);
    expect(last[0]).toBeCloseTo(20, 9);
    expect(last[1]).toBeCloseTo(0, 9);
    // The middle fit point is on the flattened curve: some vertex within the deviation.
    let nearest = Infinity;
    for (let i = 0; i < a.length; i += 3)
      nearest = Math.min(nearest, Math.hypot(a[i + 1]! - 10, a[i + 2]! - 5));
    expect(nearest).toBeLessThan(0.05);
    expect(a.length / 3).toBeGreaterThan(20);
  });

  it('fills SOLID corners in the order 1–2–4–3', () => {
    const [p] = tessellate(
      {
        kind: 'SOLID',
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
      },
      paint,
    );
    expect(p).toMatchObject({
      kind: 'fill',
      path: [PATH_M, 0, 0, PATH_L, 1, 0, PATH_L, 1, 1, PATH_L, 0, 1, PATH_Z],
    });
  });

  it('leaves out hidden 3DFACE edges', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ] as const;
    const [p] = tessellate({ kind: '3DFACE', corners, hiddenEdges: 1 | 4 }, paint);
    expect(path(p)).toEqual([PATH_M, 1, 0, PATH_L, 1, 1, PATH_M, 0, 1, PATH_L, 0, 0]);
  });

  it('fills a solid hatch with odd parity; a pattern hatch without lines draws nothing', () => {
    const hatch = {
      kind: 'HATCH' as const,
      pattern: 'SOLID',
      solid: true,
      associative: false,
      style: 0,
      patternType: 1,
      patternAngle: 0,
      patternScale: 1,
      double: false,
      patternLines: [],
      seedPoints: [],
      loops: [
        {
          flags: 1,
          edges: [
            { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
            {
              type: 'arc' as const,
              center: { x: 1, y: 0 },
              radius: 1,
              startAngle: 0,
              endAngle: Math.PI,
              ccw: true,
            },
          ],
        },
        {
          flags: 2,
          polyline: {
            closed: true,
            vertices: [
              { x: 0.5, y: 0.1, bulge: 0 },
              { x: 1.5, y: 0.1, bulge: 0 },
              { x: 1, y: 0.5, bulge: 0 },
            ],
          },
        },
      ],
    };
    const [p] = tessellate(hatch, paint);
    expect(p).toMatchObject({ kind: 'fill', evenOdd: true });
    expect(
      path(p).filter((v, i, a) => i === 0 || a[i - 1] === PATH_Z || v === PATH_M).length,
    ).toBeGreaterThan(0);
    expect(path(p)).toContain(PATH_A);
    // A clockwise edge's stored angles are negated: drawn from −start to −end.
    const cw = tessellate(
      {
        ...hatch,
        loops: [
          {
            flags: 1,
            edges: [
              {
                type: 'arc',
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0,
                endAngle: Math.PI / 2,
                ccw: false,
              },
            ],
          },
        ],
      },
      paint,
    );
    expect(path(cw[0]).slice(3, 10)).toEqual([PATH_A, 0, 0, 1, -0, -Math.PI / 2, 0]);
    expect(tessellate({ ...hatch, solid: false }, paint)).toEqual([]);
  });

  it('draws ellipse and spline hatch edges', () => {
    const [p] = tessellate(
      {
        kind: 'HATCH',
        pattern: 'SOLID',
        solid: true,
        associative: false,
        style: 2,
        patternType: 1,
        patternAngle: 0,
        patternScale: 1,
        double: false,
        patternLines: [],
        seedPoints: [],
        loops: [
          {
            flags: 1,
            edges: [
              {
                type: 'ellipse',
                center: { x: 0, y: 0 },
                majorAxis: { x: 2, y: 0 },
                ratio: 0.5,
                startAngle: 0,
                endAngle: Math.PI,
                ccw: true,
              },
              {
                type: 'spline',
                degree: 1,
                knots: [0, 0, 1, 1],
                controlPoints: [
                  { x: -2, y: 0 },
                  { x: 2, y: 0 },
                ],
                periodic: false,
              },
            ],
          },
        ],
      },
      paint,
    );
    // Style 2 (ignore) fills with the non-zero rule.
    expect(p).toMatchObject({ kind: 'fill', evenOdd: false });
    const a = path(p);
    expect(a.slice(0, 3)).toEqual([PATH_M, 2, 0]);
    expect(a.slice(3, 12)).toEqual([PATH_E, 0, 0, 2, 1, 0, 0, Math.PI, 1]);
    expect(a.slice(12, 15)).toEqual([PATH_L, -2, 0]);
    expect(a.slice(-4, -1)).toEqual([PATH_L, 2, 0]);
    expect(a[a.length - 1]).toBe(PATH_Z);
  });

  it('draws XLINE and RAY as infinite primitives and POINT as a dot', () => {
    expect(
      tessellate({ kind: 'XLINE', base: { x: 1, y: 1 }, direction: { x: 1, y: 0 } }, paint)[0],
    ).toMatchObject({
      kind: 'infinite',
      both: true,
    });
    expect(
      tessellate({ kind: 'RAY', base: { x: 1, y: 1 }, direction: { x: 1, y: 0 } }, paint)[0],
    ).toMatchObject({
      both: false,
    });
    expect(tessellate({ kind: 'POINT', position: { x: 2, y: 3 } }, paint)).toEqual([
      { kind: 'point', x: 2, y: 3, color: '#ff0000' },
    ]);
  });

  it('carries the lineweight', () => {
    const [p] = tessellate(
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { color: 'foreground', lineweight: 0.5 },
    );
    expect(p).toMatchObject({ color: 'foreground', lineweight: 0.5 });
  });
});

describe('view transform', () => {
  const view = { center: { x: 100, y: 50 }, scale: 2 };

  it('maps world to screen with y down, and back', () => {
    expect(worldToScreen(view, 400, 200, { x: 100, y: 50 })).toEqual({ x: 200, y: 100 });
    expect(worldToScreen(view, 400, 200, { x: 110, y: 60 })).toEqual({ x: 220, y: 80 });
    expect(screenToWorld(view, 400, 200, { x: 220, y: 80 })).toEqual({ x: 110, y: 60 });
  });

  it('gives the visible world box', () => {
    expect(visibleBox(view, 400, 200)).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
  });

  it('fits a box with a margin, keeping the aspect ratio', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 10 }, 220, 110, 0.05);
    expect(v.center).toEqual({ x: 50, y: 5 });
    expect(v.scale).toBeCloseTo(1.98, 12);
    expect(fitView({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 100, 100).scale).toBe(1);
  });
});
