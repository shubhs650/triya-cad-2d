// Regeneration on touch (M2-10 part 3, DEC-011): a dimension draws its stored `*D` block until
// an edit changes what it measures (STRETCH of some of its points, SCALE); then the engine
// draws it afresh and the block is rewritten with what it draws, as AutoCAD regenerates a
// dimension it edits. The dimension's DXF 10 and 11 are written back as AutoCAD writes them:
// a linear or aligned dimension's DXF 10 on its second extension line, and DXF 11 where the
// engine placed the text (unless the user placed it, DXF 70 bit 128, when it stays).

import type { AnnotationTables, DimensionGeometry, Entity, TextMeasure } from '@triya/engine';
import { angularSweep } from './angular';
import { dimensionText, formatAngle, formatLinear } from './format';
import { dist, dot, fromAngle, lerp, sub, unit, type DimPart } from './geometry';
import { linearDefinitionPoint } from './linear';
import { dimensionParts, generates } from './parts';
import { dimStyle } from './style';

export interface RegeneratedDimension {
  /** What the dimension's `*D` block holds now, defpoints included. */
  readonly parts: DimPart[];
  /** The dimension with its DXF 10 and 11 as regeneration leaves them. */
  readonly geom: DimensionGeometry;
  /**
   * What it measures, formatted by its DIMVARs without its text override (AutoCAD's
   * "Dimension text = 10.0000" after a dimension command, M2-11).
   */
  readonly measurement?: string;
}

/**
 * The measurement a dimension shows, formatted (DIMDEC, DIMZIN, DIMPOST…, angles by DIMAUNIT,
 * the degree sign as `°`); undefined for the kinds the dimension commands do not make.
 */
export function measuredText(
  e: Pick<Entity, 'geom' | 'xdata'>,
  model: AnnotationTables,
): string | undefined {
  const g = e.geom;
  if (g.kind !== 'DIMENSION') return undefined;
  const vars = dimStyle(g.style, e.xdata, model).vars;
  const linear = (m: number) => dimensionText('', formatLinear(m, vars), vars);
  switch (g.dimType) {
    case 'linear':
    case 'aligned': {
      const u =
        g.dimType === 'aligned'
          ? (unit(sub(g.second, g.first)) ?? fromAngle(0))
          : fromAngle(g.rotation ?? 0);
      return linear(Math.abs(dot(sub(g.second, g.first), u)));
    }
    case 'radius':
      return linear(dist(g.definitionPoint, g.chordPoint));
    case 'diameter':
      return linear(2 * dist(lerp(g.definitionPoint, g.chordPoint, 0.5), g.chordPoint));
    case 'angular':
    case 'angular3pt': {
      const sweep = angularSweep(g);
      if (sweep === undefined) return undefined;
      return dimensionText('', formatAngle(sweep, vars), vars)?.replace(/%%d/gi, '°');
    }
    default:
      return undefined;
  }
}

/**
 * A dimension regenerated: its parts and its geometry; undefined for a kind the engine does
 * not draw, or while `measure` cannot measure its text.
 */
export function regenerateDimension(
  e: Pick<Entity, 'geom' | 'xdata'>,
  model: AnnotationTables,
  measure: TextMeasure,
): RegeneratedDimension | undefined {
  const g = e.geom;
  if (!('dimType' in g) || !generates(g)) return undefined;
  let geom: DimensionGeometry = g;
  if (geom.dimType === 'linear' || geom.dimType === 'aligned') {
    geom = { ...geom, definitionPoint: linearDefinitionPoint(geom) };
  }
  const parts = dimensionParts({ ...e, geom }, model, measure, { regenerate: true });
  if (!parts) return undefined;
  const at = parts.find((p) => p.textPosition)?.textPosition;
  if (at && !geom.textUserPositioned) geom = { ...geom, textPosition: at };
  const measurement = measuredText({ ...e, geom }, model);
  return { parts, geom, ...(measurement !== undefined && { measurement }) };
}
