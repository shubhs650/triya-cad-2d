// Small numeric helpers shared by bounds, closest point and tangents.

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * Minimiser of f on [lo, hi] by golden-section search, assuming f is unimodal there (callers
 * bracket a sampled local minimum). Returns the best of the search and the two ends.
 */
export function argmin(
  f: (u: number) => number,
  lo: number,
  hi: number,
): { x: number; fx: number } {
  let a = lo;
  let b = hi;
  let x1 = b - GOLDEN * (b - a);
  let x2 = a + GOLDEN * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 100 && b - a > Number.EPSILON * (Math.abs(a) + Math.abs(b)); i++) {
    if (f1 <= f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - GOLDEN * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + GOLDEN * (b - a);
      f2 = f(x2);
    }
  }
  let best = f1 <= f2 ? { x: x1, fx: f1 } : { x: x2, fx: f2 };
  for (const x of [lo, hi]) {
    const fx = f(x);
    if (fx < best.fx) best = { x, fx };
  }
  return best;
}

/** A root of g on [lo, hi] where g(lo) and g(hi) differ in sign, by bisection. */
export function bisect(g: (u: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  let ga = g(a);
  for (let i = 0; i < 100 && b - a > Number.EPSILON * (Math.abs(a) + Math.abs(b)); i++) {
    const m = (a + b) / 2;
    const gm = g(m);
    if (gm === 0) return m;
    if (gm < 0 === ga < 0) {
      a = m;
      ga = gm;
    } else {
      b = m;
    }
  }
  return (a + b) / 2;
}
