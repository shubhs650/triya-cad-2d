// A dimension's parts by its type (M2-10: DIMENSION of every type, LARGE_RADIAL_DIMENSION and
// ARC_DIMENSION).

import {
  drawnDimStyle,
  jogHeightFactor,
  linearJog,
  radialArc,
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
import { withBreaks, withInspection, type RecordHolder } from './records';
import { annotationScaleOf, dimStyle, type DimensionTables } from './style';

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
  e: Pick<Entity, 'geom' | 'xdata' | 'annotative'> & RecordHolder,
  model: DimensionTables,
  measure: TextMeasure,
  options: { readonly regenerate?: boolean } = {},
): DimPart[] | undefined {
  const g = e.geom;
  if (!('dimType' in g) || !generates(g)) return undefined;
  // Its style's sub-style for its kind, when the drawing has one (M4-03 part 2).
  const style = drawnDimStyle(model, g);
  const s = dimStyle(style, e.xdata, model, annotationScaleOf(e, model));
  // The text stays where the writer put it while the dimension keeps its stored graphics or
  // the user moved it; otherwise the engine places it, as AutoCAD does when it regenerates.
  const stored = !options.regenerate && g.block !== undefined && !!model.blocks.get(g.block);
  const keepText = g.textUserPositioned || stored;
  const parts = typeParts();
  // DIMBREAK's gaps and DIMINSPECT's frame (M4-02 part 4), over what the type draws.
  return parts && withInspection(withBreaks(parts, e, style, model, s), e, model, s, measure);

  function typeParts(): DimPart[] | undefined {
    if (!('dimType' in g)) return undefined;
    switch (g.dimType) {
      case 'linear':
      case 'aligned': {
        const at = linearJog(e.xdata, model);
        const jog = at && { at, height: jogHeightFactor(style, e.xdata, model) * s.textHeight };
        return linearParts(g, s, model, measure, keepText, jog);
      }
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
}
