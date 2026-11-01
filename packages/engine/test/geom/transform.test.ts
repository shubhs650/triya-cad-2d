import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyPoint,
  applyVector,
  compose,
  determinant,
  domain,
  IDENTITY,
  invert,
  mirror,
  pointAt,
  rotation,
  scaling,
  similarityScale,
  transformCurve,
  translation,
  type Arc,
  type Curve,
  type Matrix2D,
  type Polyline,
} from '../../src/geom/index';
import { at, boundedCurve, expectNear, point, sizeOf, TOL } from './arbitraries';

const angle = fc.double({ min: -7, max: 7, noNaN: true });
const factor = fc.double({ min: 0.1, max: 10, noNaN: true });

const similarity: fc.Arbitrary<Matrix2D> = fc
  .record({ r: angle, s: factor, t: point, m: fc.boolean(), p: point })
  .map(({ r, s, t, m, p }) =>
    compose(
      rotation(r),
      scaling(s),
      m ? mirror(p, { x: p.x + 1, y: p.y + 2 }) : IDENTITY,
      translation(t.x, t.y),
    ),
  );

const affine: fc.Arbitrary<Matrix2D> = fc
  .record({ r: angle, sx: factor, sy: factor, sign: fc.boolean(), t: point, r2: angle })
  .map(({ r, sx, sy, sign, t, r2 }) =>
    compose(rotation(r), scaling(sign ? -sx : sx, sy), rotation(r2), translation(t.x, t.y)),
  );

describe('matrices', () => {
  it('builds the elementary transforms', () => {
    expectNear(applyPoint(translation(2, 3), { x: 1, y: 1 }), { x: 3, y: 4 });
    expectNear(applyPoint(rotation(Math.PI / 2), { x: 1, y: 0 }), { x: 0, y: 1 });
    expectNear(applyPoint(rotation(Math.PI, { x: 1, y: 1 }), { x: 2, y: 1 }), { x: 0, y: 1 });
    expectNear(applyPoint(scaling(2, 3), { x: 1, y: 1 }), { x: 2, y: 3 });
    expectNear(applyPoint(scaling(2, 2, { x: 1, y: 1 }), { x: 2, y: 2 }), { x: 3, y: 3 });
    expectNear(applyPoint(mirror({ x: 0, y: 0 }, { x: 1, y: 1 }), { x: 2, y: 0 }), { x: 0, y: 2 });
    expectNear(applyVector(translation(5, 5), { x: 1, y: 0 }), { x: 1, y: 0 });
    expect(determinant(mirror({ x: 0, y: 0 }, { x: 0, y: 1 }))).toBeCloseTo(-1, 15);
    expect(compose()).toEqual(IDENTITY);
  });

  it('compose applies left to right', () => {
    const m = compose(translation(1, 0), rotation(Math.PI / 2));
    expectNear(applyPoint(m, { x: 0, y: 0 }), { x: 0, y: 1 });
  });

  it('inverts', () => {
    fc.assert(
      fc.property(affine, point, (m, p) => {
        expectNear(applyPoint(invert(m), applyPoint(m, p)), p, 1e-6 * (1 + Math.hypot(p.x, p.y)));
      }),
    );
    expect(() => invert(scaling(0, 1))).toThrow(/singular/);
    expect(() => mirror({ x: 1, y: 1 }, { x: 1, y: 1 })).toThrow(/two distinct points/);
  });

  it('recognises similarities and their scale', () => {
    expect(similarityScale(compose(rotation(1), scaling(3)), TOL)).toBeCloseTo(3, 12);
    expect(
      similarityScale(compose(scaling(2), mirror({ x: 0, y: 0 }, { x: 1, y: 0 })), TOL),
    ).toBeCloseTo(2, 12);
    expect(similarityScale(scaling(2, 3), TOL)).toBeUndefined();
    expect(similarityScale({ a: 1, b: 1, c: 0, d: 1, e: 0, f: 0 }, TOL)).toBeUndefined();
  });
});

/** The transformed curve traced forward equals the original traced forward (or backward). */
function expectImage(c: Curve, m: Matrix2D, image: Curve): void {
  const eps = 1e-7 * sizeOf(c) * Math.max(1, Math.abs(determinant(m)));
  if (image.kind === 'CIRCLE') {
    // A circle has no distinguished start point, so only check that the image is on it.
    for (const s of [0, 0.3, 0.5, 0.8]) {
      const q = applyPoint(m, at(c, s));
      expect(
        Math.abs(Math.hypot(q.x - image.center.x, q.y - image.center.y) - image.radius),
      ).toBeLessThan(eps);
    }
    return;
  }
  const fwd = [0, 0.3, 0.5, 1].every(
    (s) =>
      Math.hypot(
        at(image, s).x - applyPoint(m, at(c, s)).x,
        at(image, s).y - applyPoint(m, at(c, s)).y,
      ) < eps,
  );
  const bwd = [0, 0.3, 0.5, 1].every(
    (s) =>
      Math.hypot(
        at(image, s).x - applyPoint(m, at(c, 1 - s)).x,
        at(image, s).y - applyPoint(m, at(c, 1 - s)).y,
      ) < eps,
  );
  if (!fwd && !bwd) {
    const s = 0.3;
    expectNear(at(image, s), applyPoint(m, at(c, s)), eps);
  }
}

describe('transformCurve', () => {
  it('maps every curve type under similarities, keeping its kind', () => {
    fc.assert(
      fc.property(boundedCurve, similarity, (c, m) => {
        const image = transformCurve(c, m, TOL);
        expect(image.kind).toBe(c.kind);
        expectImage(c, m, image);
      }),
      { numRuns: 400 },
    );
  });

  it('maps circles, arcs and ellipses to ellipses under non-uniform scaling', () => {
    fc.assert(
      fc.property(
        boundedCurve.filter((c) => ['CIRCLE', 'ARC', 'ELLIPSE', 'LINE', 'SPLINE'].includes(c.kind)),
        affine.filter((m) => similarityScale(m, TOL) === undefined),
        (c, m) => {
          const image = transformCurve(c, m, TOL);
          if (c.kind === 'CIRCLE' || c.kind === 'ARC') expect(image.kind).toBe('ELLIPSE');
          if (image.kind === 'ELLIPSE') {
            expect(image.ratio).toBeGreaterThan(0);
            expect(image.ratio).toBeLessThanOrEqual(1);
          }
          expectImage(c, m, image);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('a mirrored arc is still CCW, from the image of its end to the image of its start', () => {
    const a: Arc = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const m = mirror({ x: 0, y: 0 }, { x: 0, y: 1 });
    const image = transformCurve(a, m, TOL) as Arc;
    expect(image.kind).toBe('ARC');
    expectNear(pointAt(image, domain(image).start), { x: 0, y: 1 });
    expectNear(pointAt(image, domain(image).end), { x: -1, y: 0 });
  });

  it('a mirrored polyline keeps vertex order and flips its bulges', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0.5 },
        { x: 2, y: 0, bulge: 0 },
      ],
    };
    const image = transformCurve(p, mirror({ x: 0, y: 0 }, { x: 1, y: 0 }), TOL) as Polyline;
    expect(image.vertices.map((v) => v.bulge)).toEqual([-0.5, 0]);
  });

  it('refuses a non-uniform scale of a polyline with arcs, but not of a straight one', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0.5 },
        { x: 2, y: 0, bulge: 0 },
      ],
    };
    expect(() => transformCurve(p, scaling(1, 2), TOL)).toThrow(/non-uniform/);
    const straight: Polyline = { ...p, vertices: p.vertices.map((v) => ({ ...v, bulge: 0 })) };
    expectImage(straight, scaling(1, 2), transformCurve(straight, scaling(1, 2), TOL));
  });

  it('maps rays and xlines', () => {
    const r: Curve = { kind: 'RAY', base: { x: 1, y: 0 }, direction: { x: 1, y: 0 } };
    const image = transformCurve(r, compose(rotation(Math.PI / 2), scaling(3)), TOL);
    expect(image.kind).toBe('RAY');
    expectNear(pointAt(image, 3), { x: 0, y: 6 });
    const x = transformCurve({ ...r, kind: 'XLINE' }, translation(0, 1), TOL);
    expect(x.kind).toBe('XLINE');
    expectNear(pointAt(x, -1), { x: 0, y: 1 });
  });

  it('refuses a singular transform', () => {
    expect(() =>
      transformCurve({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, scaling(1, 0), TOL),
    ).toThrow(/singular/);
  });
});
