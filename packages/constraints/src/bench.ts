// The sketch M9-01's acceptance times (solve 50 constraints in < 20 ms in Node and in the
// browser): six rectangles in a row, each held by two horizontal and two vertical
// constraints and a width and height, each joined to the one before at a corner, the first
// fixed, and a circle in each, centred by symmetry about its rectangle's diagonal with a
// set radius. 6 × 6 + 5 + 6 × 2 = 53 constraints (the symmetric ones add two to PlaneGCS),
// zero degrees of freedom, every coordinate drawn off where the constraints put it.
import { ConstraintKind, type PlaneGcs, type PlaneGcsSketch } from './planegcs';

export function fiftyConstraintSketch(gcs: PlaneGcs): PlaneGcsSketch {
  const s = gcs.sketch();
  let tag = 1;
  let previous: number | undefined;
  for (let r = 0; r < 6; r++) {
    const x = r * 10;
    // Off by a little, as the user drew them: the solver has real work to do.
    const wobble = (k: number) => Math.sin(r * 7 + k) * 0.6;
    const corners = [
      s.point(x + wobble(0), wobble(1)),
      s.point(x + 9 + wobble(2), wobble(3)),
      s.point(x + 9 + wobble(4), 6 + wobble(5)),
      s.point(x + wobble(6), 6 + wobble(7)),
    ];
    const [c0, c1, c2] = corners as [number, number, number, number];
    const lines = corners.map((p, i) => s.line(p, corners[(i + 1) % 4]!));
    s.constrain(ConstraintKind.Horizontal, [lines[0]!], tag++);
    s.constrain(ConstraintKind.Vertical, [lines[1]!], tag++);
    s.constrain(ConstraintKind.Horizontal, [lines[2]!], tag++);
    s.constrain(ConstraintKind.Vertical, [lines[3]!], tag++);
    s.constrain(ConstraintKind.P2PDistance, [c0, c1, s.param(10, 'fixed')], tag++);
    s.constrain(ConstraintKind.P2PDistance, [c1, c2, s.param(5 + r, 'fixed')], tag++);
    if (previous === undefined) s.fix(c0);
    else s.constrain(ConstraintKind.Coincident, [c0, previous], tag++);
    previous = c1;
    const circle = s.circle(s.point(x + 4 + wobble(8), 3 + wobble(9)), 2 + wobble(10));
    s.constrain(ConstraintKind.SymmetricPoint, [c0, c2, circle.center], tag++);
    s.constrain(ConstraintKind.CircleRadius, [circle.id, s.param(2, 'fixed')], tag++);
  }
  return s;
}
