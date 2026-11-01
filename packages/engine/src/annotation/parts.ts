// Annotations drawn as parts (M1-52): which kinds, and a part as an entity of its own.

import type { Entity, EntityGeometry } from '../model/types';
import { leaderParts } from './leader';
import { multiLeaderParts, type AnnotationPart, type AnnotationTables } from './multileader';

/** The parts of an annotation that draws through parts; undefined for every other entity. */
export function annotationParts(
  g: EntityGeometry,
  model: AnnotationTables,
  xdata?: Entity['xdata'],
): AnnotationPart[] | undefined {
  if (g.kind === 'MULTILEADER') return multiLeaderParts(g, model);
  if (g.kind === 'LEADER') return leaderParts(g, xdata, model);
  return undefined;
}

/**
 * A part as an entity of its own, for the renderer's paint and block expansion: the owner's
 * handle, layer and properties, with the part's colour, linetype and lineweight where they
 * are not ByBlock.
 */
export function partEntity(owner: Entity, part: AnnotationPart): Entity {
  const { color, linetype, lineweight } = part;
  return {
    ...owner,
    geom: part.geom,
    type: part.geom.kind,
    ...(color && color.kind !== 'byBlock' ? { color } : {}),
    ...(linetype !== undefined && linetype !== 'ByBlock' ? { linetype } : {}),
    ...(lineweight !== undefined && lineweight !== 'ByBlock' ? { lineweight } : {}),
  };
}
