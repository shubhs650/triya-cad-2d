// The Parameters Manager's part of a stand-in `ConstraintSolver` (M9-03 part 5) for tests that
// never ask for it.
import type { ConstraintSolver } from '../../src/index';

const notAsked = (): never => {
  throw new Error('not asked');
};

export const NO_PARAMETERS: Pick<
  ConstraintSolver,
  | 'parameters'
  | 'setExpression'
  | 'setReference'
  | 'renameParameter'
  | 'deleteParameter'
  | 'solveDimensions'
> = {
  parameters: notAsked,
  setExpression: notAsked,
  setReference: notAsked,
  renameParameter: notAsked,
  deleteParameter: notAsked,
  solveDimensions: notAsked,
};
