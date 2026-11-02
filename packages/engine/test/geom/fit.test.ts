// M1-47: splines stored only as fit points, interpolated the way AutoCAD does. The oracle is
// the one spline in the public corpus that AutoCAD saved with both its fit points and the
// control points it computed from them (uncommon.dxf, AC1032, no end tangents, chord knots).
import { describe, expect, it } from 'vitest';
import {
  fitSpline,
  splineDerivatives,
  splineDomain,
  splinePoint,
  type Spline,
  type Vec2,
} from '../../src/index';

const evaluate = splinePoint;
const evaluateDerivatives = (s: Spline, u: number, order: 1 | 2) => splineDerivatives(s, u, order);

const v = (x: number, y: number): Vec2 => ({ x, y });

// corpus/public/third-party/ezdxf/examples_dxf/uncommon.dxf, SPLINE 251 (written by AutoCAD).
const FIT = [
  v(26.24452338423296, 52.12407284762216),
  v(29.17497522423395, 52.63343431761065),
  v(28.53792042776579, 54.54353976746725),
  v(25.35264666917754, 53.74766245496015),
  v(24.52447543376894, 51.7102167002067),
  v(26.18081790458615, 51.00984471027263),
  v(30.06685193928936, 51.00984471027263),
  v(30.06685193928936, 55.05290123745573),
  v(28.88830056582327, 55.84877854996282),
  v(23.18666058493835, 54.47986955241856),
  v(23.18666058493835, 56.6446557372694),
  v(28.5697731675892, 57.50420326482518),
];
const AUTOCAD_CONTROL = [
  v(26.24452338423296, 52.12407284762216),
  v(27.57578628180457, 51.99354242958015),
  v(29.80825929358157, 51.774648298281),
  v(28.55159881944425, 55.61304424636155),
  v(25.38961189208948, 54.38819397225258),
  v(23.87457693634767, 51.48237136207908),
  v(27.01225850510402, 50.86326783506161),
  v(30.87446836339338, 49.80239279428019),
  v(30.92805184618542, 54.62700225322556),
  v(27.67416336652629, 56.96330653724901),
  v(22.8633969378717, 52.15201023841572),
  v(22.94563731768292, 58.54375095040222),
  v(26.22356133055738, 57.93786972490909),
  v(28.5697731675892, 57.50420326482518),
];
const AUTOCAD_KNOTS = [
  0, 0, 0, 0, 2.974390205348656, 4.987929786105638, 8.271127863242388, 10.4704579427714,
  12.26878808624257, 16.15482212094578, 20.19787864812887, 21.61999117407832, 27.48365984779983,
  29.64844603265067, 35.09975074158239, 35.09975074158239, 35.09975074158239, 35.09975074158239,
];

function expectPoints(actual: readonly Vec2[], expected: readonly Vec2[], digits = 9): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => {
    expect(p.x, `x of ${i}`).toBeCloseTo(expected[i]!.x, digits);
    expect(p.y, `y of ${i}`).toBeCloseTo(expected[i]!.y, digits);
  });
}

/** The spline's points at its knots: where a fit-point interpolation meets its fit points. */
function atKnots(s: Spline): Vec2[] {
  const out: Vec2[] = [];
  const { start, end } = splineDomain(s);
  for (const u of new Set(s.knots)) if (u >= start && u <= end) out.push(evaluate(s, u));
  return out;
}

const unit = (p: Vec2): Vec2 => {
  const l = Math.hypot(p.x, p.y);
  return v(p.x / l, p.y / l);
};

describe('fitSpline', () => {
  it('reproduces AutoCAD’s control points and knots for a spline without end tangents', () => {
    const s = fitSpline({ fitPoints: FIT })!;
    expect(s.degree).toBe(3);
    expect(s.weights).toBeUndefined();
    expectPoints(s.controlPoints, AUTOCAD_CONTROL);
    expect(s.knots).toHaveLength(AUTOCAD_KNOTS.length);
    s.knots.forEach((k, i) => expect(k, `knot ${i}`).toBeCloseTo(AUTOCAD_KNOTS[i]!, 9));
  });

  it('leaves the second derivative zero at both ends when no tangent is given', () => {
    const s = fitSpline({ fitPoints: FIT })!;
    const { start, end } = splineDomain(s);
    for (const u of [start, end]) {
      const [, , d2] = evaluateDerivatives(s, u, 2);
      expect(Math.hypot(d2!.x, d2!.y)).toBeLessThan(1e-9);
    }
  });

  it('draws two fit points without tangents as a straight line', () => {
    const s = fitSpline({ fitPoints: [v(0, 0), v(3, 6)] })!;
    expectPoints(s.controlPoints, [v(0, 0), v(1, 2), v(2, 4), v(3, 6)]);
    expect(s.knots).toEqual([
      0,
      0,
      0,
      0,
      Math.hypot(3, 6),
      Math.hypot(3, 6),
      Math.hypot(3, 6),
      Math.hypot(3, 6),
    ]);
  });

  it('leaves along the given end tangents, the derivative one unit long per unit of chord', () => {
    // Only the tangents' directions count: AutoCAD keeps whatever length was picked.
    const fitPoints = [v(0, 0), v(10, 0), v(20, 5)];
    const s = fitSpline({ fitPoints, startTangent: v(0, 7), endTangent: v(-2, -2) })!;
    expectPoints(atKnots(s), fitPoints);
    const { start, end } = splineDomain(s);
    const [, d0] = evaluateDerivatives(s, start, 1);
    const [, d1] = evaluateDerivatives(s, end, 1);
    // Chord knots: |C′| = total chord / total parameter = 1 at the tangent ends.
    expectPoints([d0!, d1!], [v(0, 1), unit(v(-1, -1))]);
  });

  it('takes one end tangent and leaves the other end natural', () => {
    const s = fitSpline({ fitPoints: FIT, endTangent: v(1, 0) })!;
    expectPoints(atKnots(s), FIT);
    const { start, end } = splineDomain(s);
    const [, d1] = evaluateDerivatives(s, end, 1);
    expectPoints([d1!], [v(1, 0)]);
    const [, , d2] = evaluateDerivatives(s, start, 2);
    expect(Math.hypot(d2!.x, d2!.y)).toBeLessThan(1e-9);
  });

  it('passes through every fit point under each knot parameterization', () => {
    const chords = [0, ...FIT.slice(1).map((p, i) => Math.hypot(p.x - FIT[i]!.x, p.y - FIT[i]!.y))];
    const cumulative = (f: (d: number) => number) => {
      let t = 0;
      return chords.map((d, i) => (i === 0 ? 0 : (t += f(d))));
    };
    for (const [parameterization, steps] of [
      ['chord', cumulative((d) => d)],
      ['sqrt', cumulative(Math.sqrt)],
      ['uniform', cumulative(() => 1)],
    ] as const) {
      const s = fitSpline({ fitPoints: FIT, parameterization })!;
      expectPoints(atKnots(s), FIT);
      // The interior knots are the fit points' parameters.
      expect(s.knots.slice(3, -3).map((k) => +k.toFixed(9))).toEqual(
        steps.map((k) => +k.toFixed(9)),
      );
    }
  });

  it('closes a closed spline smoothly through its first point', () => {
    const fitPoints = [v(0, 0), v(10, 0), v(12, 8), v(3, 9)];
    const s = fitSpline({ fitPoints, closed: true })!;
    expectPoints(atKnots(s), [...fitPoints, fitPoints[0]!]);
    const { start, end } = splineDomain(s);
    const a = evaluateDerivatives(s, start, 2);
    const b = evaluateDerivatives(s, end, 2);
    expectPoints([a[1]!, a[2]!], [b[1]!, b[2]!]);
  });

  it('treats a closed spline’s repeated last point as the seam, not a second visit', () => {
    const open = [v(0, 0), v(10, 0), v(12, 8), v(3, 9)];
    const a = fitSpline({ fitPoints: open, closed: true })!;
    const b = fitSpline({ fitPoints: [...open, v(0, 0)], closed: true })!;
    expectPoints(b.controlPoints, a.controlPoints);
  });

  it('skips repeated points and returns nothing for fewer than two distinct points', () => {
    const a = fitSpline({ fitPoints: [v(0, 0), v(0, 0), v(4, 4), v(8, 0), v(8, 0)] })!;
    const b = fitSpline({ fitPoints: [v(0, 0), v(4, 4), v(8, 0)] })!;
    expectPoints(a.controlPoints, b.controlPoints);
    expect(fitSpline({ fitPoints: [v(1, 1), v(1, 1)] })).toBeUndefined();
    expect(fitSpline({ fitPoints: [v(1, 1)] })).toBeUndefined();
  });
});
