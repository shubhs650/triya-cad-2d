// PlaneGCS WASM module (M9-01): the module loads in Node from its bytes, solves geometric
// and dimensional constraints, reports degrees of freedom, conflicting and redundant
// constraints, and solves a 50-constraint sketch within the 20 ms budget (PRD FR-X3).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ConstraintKind,
  SolveStatus,
  loadPlaneGcs,
  type PlaneGcs,
  type PlaneGcsSketch,
} from '../src/index';
import { fiftyConstraintSketch } from '../src/bench';

const wasm = () => Promise.resolve(readFileSync(new URL('../wasm/planegcs.wasm', import.meta.url)));

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** A rectangle drawn slightly off: four lines whose corners are shared points. */
function rectangle(s: PlaneGcsSketch) {
  const corners = [
    [0, 0],
    [10.3, 0.4],
    [10.1, 5.2],
    [-0.2, 4.9],
  ].map(([x, y]) => s.point(x!, y!));
  const lines = corners.map((p, i) => s.line(p, corners[(i + 1) % 4]!));
  return { corners, lines };
}

describe('loadPlaneGcs', () => {
  it('loads the module once and reuses it', async () => {
    const a = await loadPlaneGcs(wasm);
    const b = await loadPlaneGcs(wasm);
    expect(a).toBe(b);
  });

  it('rejects bytes that are not the module', async () => {
    await expect(
      loadPlaneGcs(() => Promise.resolve(new Uint8Array([0, 1, 2, 3])), { cache: false }),
    ).rejects.toThrow();
  });
});

describe('PlaneGCS sketch', () => {
  let gcs: PlaneGcs;
  const sketch = async () => {
    gcs ??= await loadPlaneGcs(wasm);
    return gcs.sketch();
  };

  it('solves a fully constrained rectangle', async () => {
    const s = await sketch();
    const { corners, lines } = rectangle(s);
    const [l0, l1, l2, l3] = lines;
    s.fix(corners[0]!);
    s.constrain(ConstraintKind.Horizontal, [l0!], 1);
    s.constrain(ConstraintKind.Vertical, [l1!], 2);
    s.constrain(ConstraintKind.Horizontal, [l2!], 3);
    s.constrain(ConstraintKind.Vertical, [l3!], 4);
    const width = s.param(12, 'fixed');
    const height = s.param(5, 'fixed');
    s.constrain(ConstraintKind.P2PDistance, [corners[0]!, corners[1]!, width], 5);
    s.constrain(ConstraintKind.P2PDistance, [corners[1]!, corners[2]!, height], 6);

    expect(s.diagnose()).toEqual({
      dofs: 0,
      conflicting: [],
      redundant: [],
      partiallyRedundant: [],
    });
    expect(s.solve()).toBe(SolveStatus.Success);
    const at = corners.map((p) => s.pointAt(p));
    close(at[0]!.x, 0);
    close(at[0]!.y, 0);
    close(at[1]!.x, 12);
    close(at[1]!.y, 0);
    close(at[2]!.x, 12);
    close(at[2]!.y, 5);
    close(at[3]!.x, 0);
    close(at[3]!.y, 5);
    s.dispose();
  });

  it('counts the degrees of freedom left', async () => {
    const s = await sketch();
    const { lines } = rectangle(s);
    // 8 coordinates; four horizontal/vertical constraints leave 4 (position 2, width, height).
    s.constrain(ConstraintKind.Horizontal, [lines[0]!], 1);
    s.constrain(ConstraintKind.Vertical, [lines[1]!], 2);
    s.constrain(ConstraintKind.Horizontal, [lines[2]!], 3);
    s.constrain(ConstraintKind.Vertical, [lines[3]!], 4);
    expect(s.diagnose().dofs).toBe(4);
    s.dispose();
  });

  it('reports a redundant constraint by its tag', async () => {
    const s = await sketch();
    const { lines } = rectangle(s);
    s.constrain(ConstraintKind.Horizontal, [lines[0]!], 1);
    s.constrain(ConstraintKind.Vertical, [lines[1]!], 2);
    s.constrain(ConstraintKind.Horizontal, [lines[2]!], 3);
    s.constrain(ConstraintKind.Vertical, [lines[3]!], 4);
    // Parallel to line 0 is already implied by both lines being horizontal. PlaneGCS
    // diagnoses at the current geometry, where a Jacobian row is only dependent once the
    // constraints hold, so the sketch is solved first, as FreeCAD's Sketcher does.
    s.constrain(ConstraintKind.Parallel, [lines[0]!, lines[2]!], 5);
    expect(s.solve()).toBe(SolveStatus.Success);
    const d = s.diagnose();
    expect(d.dofs).toBe(4);
    expect(d.conflicting).toEqual([]);
    expect([...d.redundant, ...d.partiallyRedundant]).toContain(5);
    s.dispose();
  });

  it('reports conflicting constraints (over-constrained) and does not move the geometry', async () => {
    const s = await sketch();
    const a = s.point(0, 0);
    const b = s.point(10, 0.5);
    s.fix(a);
    const ab = s.line(a, b);
    s.constrain(ConstraintKind.Horizontal, [ab], 1);
    s.constrain(ConstraintKind.P2PDistance, [a, b, s.param(10, 'fixed')], 2);
    s.constrain(ConstraintKind.P2PDistance, [a, b, s.param(20, 'fixed')], 3);
    const d = s.diagnose();
    expect(d.conflicting).toEqual(expect.arrayContaining([2, 3]));
    expect(s.solve()).toBe(SolveStatus.Failed);
    expect(s.pointAt(b)).toEqual({ x: 10, y: 0.5 });
    s.dispose();
  });

  it('solves circles and arcs: tangency, equal radius, concentric, arc rules', async () => {
    const s = await sketch();
    const c1 = s.circle(s.point(0, 0), 5);
    const c2 = s.circle(s.point(12, 1), 4);
    s.fix(c1.center);
    s.fixParam(c1.radius);
    s.constrain(ConstraintKind.EqualRadiusCC, [c1.id, c2.id], 1);
    s.constrain(ConstraintKind.TangentCC, [c1.id, c2.id], 2);
    const arc = s.arc(s.point(12, 1), 3, 0, Math.PI / 2);
    s.constrain(ConstraintKind.Coincident, [arc.center, c2.center], 3);
    s.constrain(ConstraintKind.ArcRadius, [arc.id, s.param(2, 'fixed')], 4);
    expect(s.solve()).toBe(SolveStatus.Success);
    const centre = s.pointAt(c2.center);
    close(Math.hypot(centre.x, centre.y), 10, 1e-8);
    close(s.value(c2.radius), 5, 1e-8);
    const start = s.pointAt(arc.start);
    const arcCentre = s.pointAt(arc.center);
    close(Math.hypot(start.x - arcCentre.x, start.y - arcCentre.y), 2, 1e-8);
    s.dispose();
  });

  it('computes a driven (reference) dimension without driving the geometry', async () => {
    const s = await sketch();
    const a = s.point(0, 0);
    const b = s.point(3, 4);
    s.fix(a);
    s.fix(b);
    const measured = s.param(0, 'driven');
    s.constrain(ConstraintKind.P2PDistance, [a, b, measured], 1, { driving: false });
    expect(s.solve()).toBe(SolveStatus.Success);
    close(s.value(measured), 5, 1e-8);
    expect(s.pointAt(b)).toEqual({ x: 3, y: 4 });
    s.dispose();
  });

  it('removes constraints by tag', async () => {
    const s = await sketch();
    const a = s.point(0, 0);
    const b = s.point(10, 3);
    s.fix(a);
    const ab = s.line(a, b);
    s.constrain(ConstraintKind.Horizontal, [ab], 1);
    s.constrain(ConstraintKind.CoordinateY, [b, s.param(5, 'fixed')], 2);
    expect(s.diagnose().conflicting).toEqual([1, 2]);
    s.remove(2);
    expect(s.diagnose().conflicting).toEqual([]);
    s.dispose();
  });

  // M9-02: PlaneGCS keeps its diagnosis until a constraint changes, and solving uses it to
  // set constraints aside. Parameters fixed for one solve and freed again must not leave
  // the constraints that had no unknowns while they were fixed out of the next solve.
  it('solves with every constraint after parameter kinds change', async () => {
    const s = await sketch();
    const a = s.point(0, 0);
    const b = s.point(10, 0);
    const ab = s.line(a, b);
    s.fix(a);
    s.constrain(ConstraintKind.HorizontalPoints, [b, a], 1);
    const c = s.point(20, 0);
    const circle = s.circle(c, 4);
    s.constrain(ConstraintKind.CoordinateX, [c, s.param(20, 'fixed')], 2);
    s.constrain(ConstraintKind.CoordinateY, [c, s.param(0, 'fixed')], 2);
    s.constrain(ConstraintKind.CircleRadius, [circle.id, s.param(4, 'fixed')], 2);
    s.constrain(ConstraintKind.TangentLC, [ab, circle.id], 3);
    const held = [...s.pointParams(c), circle.radius];
    held.forEach((p) => s.setParamKind(p, 'fixed'));
    expect(s.solve()).toBe(SolveStatus.Failed);
    held.forEach((p) => s.setParamKind(p, 'unknown'));
    // The circle's position and radius are constrained (2) and the line cannot reach it.
    expect(s.solve()).toBe(SolveStatus.Failed);
    expect(s.pointAt(c)).toEqual({ x: 20, y: 0 });
    s.dispose();
  });

  it('refuses ids that are not in the sketch', async () => {
    const s = await sketch();
    const a = s.point(0, 0);
    expect(() => s.constrain(ConstraintKind.Coincident, [a, 7], 1)).toThrow(/point 7/);
    expect(() => s.constrain(ConstraintKind.Horizontal, [3], 1)).toThrow(/line 3/);
    expect(() => s.constrain(ConstraintKind.Coincident, [a, a], 0)).toThrow(/tag/);
    expect(() => s.constrain(ConstraintKind.Coincident, [a], 1)).toThrow(/2 ids/);
    s.dispose();
  });

  it('solves a 50-constraint sketch in under 20 ms', async () => {
    gcs ??= await loadPlaneGcs(wasm);
    // Warm the module (first calls compile lazily), then take the best of five, so a busy
    // CI runner's scheduling noise does not decide the result (CLAUDE.md, flaky timings).
    fiftyConstraintSketch(gcs).dispose();
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const s = fiftyConstraintSketch(gcs);
      const status = s.solve();
      times.push(performance.now() - t0);
      expect(s.constraintCount).toBeGreaterThanOrEqual(50);
      expect(status).toBe(SolveStatus.Success);
      expect(s.diagnose().conflicting).toEqual([]);
      s.dispose();
    }
    expect(Math.min(...times)).toBeLessThan(20);
  });
});
