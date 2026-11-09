// A DIMENSION's parts by its type (M2-10 part 1).

import type { AnnotationTables, Entity, EntityGeometry, TextMeasure } from '@triya/engine';
import { angularParts } from './angular';
import type { DimPart } from './geometry';
import { linearParts } from './linear';
import { radialParts } from './radial';
import { dimStyle } from './style';


/** Whether the engine draws this kind of dimension. */
export function generates(g: EntityGeometry): boolean {
  return (
    g.kind === 'DIMENSION' &&
    (g.dimType === 'linear' ||
      g.dimType === 'aligned' ||
      g.dimType === 'radius' ||
      g.dimType === 'diameter' ||
      g.dimType === 'angular' ||
      g.dimType === 'angular3pt')
  );
}

/**
 * The parts a dimension draws, in drawing coordinates; undefined for a dimension the engine
 * does not draw yet, or while `measure` cannot measure its text.
 */
export function dimensionParts(
  e: Pick<Entity, 'geom' | 'xdata'>,
  model: AnnotationTables,
  measure: TextMeasure,
): DimPart[] | undefined {
  const g = e.geom;
  if (g.kind !== 'DIMENSION' || !generates(g)) return undefined;
  const s = dimStyle(g.style, e.xdata, model);
  switch (g.dimType) {
    case 'linear':
    case 'aligned':
      return linearParts(g, s, model, measure);
    case 'radius':
    case 'diameter':
      return radialParts(g, s, model, measure);
    case 'angular':
    case 'angular3pt':
      return angularParts(g, s, model, measure);
    default:
      return undefined;
  }
}
