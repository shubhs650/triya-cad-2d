// A dimension's parts by its type (M2-10: DIMENSION of every type, LARGE_RADIAL_DIMENSION and
// ARC_DIMENSION).

import {
  radialArc,
  type AnnotationTables,
  type Entity,
  type EntityGeometry,
  type TextMeasure,
} from '@triya/engine';
import { angularParts } from './angular';
import { arcLengthParts } from './arclength';
import type { DimPart } from './geometry';
import { joggedParts } from './jogged';
import { linearParts } from './linear';
import { ordinateParts } from './ordinate';
import { radialParts } from './radial';
import { dimStyle } from './style';

/** Whether the engine draws this kind of dimension. */
export function generates(g: EntityGeometry): boolean {
  return (
    g.kind === 'DIMENSION' || g.kind === 'LARGE_RADIAL_DIMENSION' || g.kind === 'ARC_DIMENSION'
  );
}

/**
 * The parts a dimension draws, in drawing coordinates; undefined for a dimension the engine
 * does not draw yet, or while `measure` cannot measure its text. `regenerate` draws it as its
 * block is about to be rewritten (M2-10 part 3), which places the text afresh.
 */
export function dimensionParts(
  e: Pick<Entity, 'geom' | 'xdata'>,
  model: AnnotationTables,
  measure: TextMeasure,
  options: { readonly regenerate?: boolean } = {},
): DimPart[] | undefined {
  const g = e.geom;
  if (!('dimType' in g) || !generates(g)) return undefined;
  const s = dimStyle(g.style, e.xdata, model);
  // The text stays where the writer put it while the dimension keeps its stored graphics or
  // the user moved it; otherwise the engine places it, as AutoCAD does when it regenerates.
  const stored = !options.regenerate && g.block !== undefined && !!model.blocks.get(g.block);
  const keepText = g.textUserPositioned || stored;
  switch (g.dimType) {
    case 'linear':
    case 'aligned':
      return linearParts(g, s, model, measure, keepText);
    case 'radius':
    case 'diameter':
      return radialParts(g, s, model, measure, keepText, radialArc(e.xdata, model));
    case 'angular':
    case 'angular3pt':
      return angularParts(g, s, model, measure, keepText);
    case 'ordinate':
      return ordinateParts(g, s, model, measure, keepText);
    case 'jogged':
      return joggedParts(g, s, model, measure, keepText);
    case 'arc':
      return arcLengthParts(g, s, model, measure, keepText);
  }
}
