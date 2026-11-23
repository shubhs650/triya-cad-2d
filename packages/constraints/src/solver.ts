// The engine's constraint solver (M9-05): `ConstraintModel` over PlaneGCS behind the engine's
// `ConstraintSolver` interface. The drawing keeps the constraints, so each call loads them into
// a fresh model: building one costs nothing, and every solve already builds its sketch anew.
import type { ConstraintSolver } from '@triya/engine';
import { ConstraintModel } from './model';
import type { PlaneGcs } from './planegcs';

export function constraintSolver(gcs: PlaneGcs): ConstraintSolver {
  return {
    add(constraints, constraint, lookup, tolerance) {
      const model = new ConstraintModel(gcs, tolerance);
      model.load(constraints);
      return model.add(constraint, lookup);
    },
  };
}
