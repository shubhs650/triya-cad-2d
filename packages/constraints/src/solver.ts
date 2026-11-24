// The engine's constraint solver (M9-05): `ConstraintModel` over PlaneGCS behind the engine's
// `ConstraintSolver` interface. The drawing keeps the constraints, so each call loads them into
// a fresh model: building one costs nothing, and every solve already builds its sketch anew.
// `solveEdit` re-solves after a modify command (M9-06).
// Dimensional constraints (M9-03 part 3) bring their parameters: the Parameters Manager's table
// is built from their expressions on each call too. The Parameters Manager (M9-03 part 5) lists
// it and edits it: an expression set re-solves what its values drive, a rename or a delete
// rewrites the expressions that name the parameter.
import type {
  ConstraintRefusal,
  ConstraintSolver,
  DimensionalConstraintObject,
  ExpressionChange,
  GeometricConstraintObject,
} from '@triya/engine';
import { DIMENSION_PREFIX, DIMENSION_TYPE, measureDimension } from './measure';
import { ConstraintModel } from './model';
import { ParameterTable } from './parameters';
import type { PlaneGcs } from './planegcs';
import type { Tolerance } from '@triya/engine';

/** The parameters of the drawing's dimensional constraints, as the Parameters Manager lists them. */
export function parameterTableOf(
  dimensions: readonly DimensionalConstraintObject[],
): ParameterTable {
  return ParameterTable.load(
    dimensions.map((d) => ({
      name: d.parameter,
      expression: d.expression,
      kind: 'constraint' as const,
      type: DIMENSION_TYPE[d.dimension],
      ...(d.description === undefined ? {} : { description: d.description }),
    })),
  );
}

function modelOf(
  gcs: PlaneGcs,
  tolerance: Tolerance,
  constraints: readonly GeometricConstraintObject[],
  dimensions: readonly DimensionalConstraintObject[],
): ConstraintModel {
  const model = new ConstraintModel(gcs, tolerance, parameterTableOf(dimensions));
  model.load(constraints);
  model.loadDimensions(
    dimensions.map((d) => ({
      handle: d.handle,
      dimension: d.dimension,
      refs: d.refs,
      parameter: d.parameter,
      ...(d.reference ? { reference: true } : {}),
    })),
  );
  return model;
}

/** The expressions of the rows `names`, as the drawing's dimensional constraints keep them. */
const expressionsOf = (model: ConstraintModel, names: readonly string[]): ExpressionChange[] =>
  names.flatMap((parameter) => {
    const row = model.parameters.get(parameter);
    return row ? [{ parameter, expression: row.expression }] : [];
  });

const invalid = (message: string): ConstraintRefusal => ({
  ok: false,
  reason: 'invalid',
  message,
  conflicting: [],
});

export function constraintSolver(gcs: PlaneGcs): ConstraintSolver {
  return {
    add(constraints, constraint, lookup, tolerance, dimensions = []) {
      const model = modelOf(gcs, tolerance, constraints, dimensions);
      const r = model.add(constraint, lookup);
      if (!r.ok || !r.parameters?.length) return r;
      return { ...r, expressions: expressionsOf(model, r.parameters) };
    },
    measure(dimensions, spec, lookup) {
      const m = measureDimension(spec, lookup);
      if (!m.ok) return { ...m, conflicting: [] };
      const parameter = parameterTableOf(dimensions).nextName(DIMENSION_PREFIX[m.dimension]);
      return { ok: true, dimension: m.dimension, value: m.value, parameter };
    },
    addDimension(constraints, dimensions, spec, lookup, tolerance) {
      const model = modelOf(gcs, tolerance, constraints, dimensions);
      const r = model.addDimension(
        {
          handle: '0',
          dimension: spec.dimension,
          refs: spec.refs,
          ...(spec.parameter === undefined ? {} : { parameter: spec.parameter }),
          ...(spec.expression === undefined ? {} : { expression: spec.expression }),
          ...(spec.reference ? { reference: true } : {}),
        },
        lookup,
      );
      if (!r.ok) return r;
      return {
        ok: true,
        dimension: r.constraint.dimension,
        parameter: r.parameter,
        expression: model.parameters.get(r.parameter)!.expression,
        value: r.value,
        updated: r.updated,
        dofs: r.dofs,
        expressions: expressionsOf(model, r.parameters),
      };
    },
    solveEdit(constraints, edits, lookup, tolerance, whole, dimensions = []) {
      const model = modelOf(gcs, tolerance, constraints, dimensions);
      const r = model.solveEdit(edits, lookup, whole);
      if (!r.ok || !r.parameters?.length) return r;
      return { ...r, expressions: expressionsOf(model, r.parameters) };
    },
    parameters(dimensions) {
      const table = parameterTableOf(dimensions);
      return dimensions.flatMap((d) => {
        const row = table.get(d.parameter);
        if (!row) return [];
        return [
          {
            name: row.name,
            expression: row.expression,
            value: row.value,
            ...(row.error === undefined ? {} : { error: row.error }),
            type: row.type,
            description: row.description,
            reference: d.reference === true,
            constraint: d.handle,
          },
        ];
      });
    },
    setExpression(constraints, dimensions, name, expression, lookup, tolerance) {
      const model = modelOf(gcs, tolerance, constraints, dimensions);
      const r = model.setExpression(name, expression, lookup);
      if (!r.ok) return r;
      return { ok: true, updated: r.updated, expressions: expressionsOf(model, r.parameters) };
    },
    renameParameter(dimensions, from, to) {
      const table = parameterTableOf(dimensions);
      const r = table.rename(from, to);
      if (!r.ok) return invalid(r.error);
      const others = r.changed.filter((n) => n !== to);
      const expressions = others.map((parameter) => ({
        parameter,
        expression: table.get(parameter)!.expression,
      }));
      return { ok: true, updated: [], expressions };
    },
    deleteParameter(dimensions, name) {
      const table = parameterTableOf(dimensions);
      const r = table.delete(name);
      if (!r.ok) return invalid(r.error);
      const expressions = r.changed.map((parameter) => ({
        parameter,
        expression: table.get(parameter)!.expression,
      }));
      return { ok: true, updated: [], expressions };
    },
  };
}
