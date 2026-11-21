// M6-03: the current annotation scale and the annotative objects that support it.
//
// CANNOSCALE names one of the drawing's annotation scales (a SCALE of its ACAD_SCALELIST,
// M2-59 part 4; scale-list.ts), and an annotative object supports the scales its representations name (the
// context data objects' DXF 340, M1-75 part 37). ANNOALLVISIBLE 0 hides the annotative objects
// that do not support the current scale (AutoCAD 2024 Help, "ANNOALLVISIBLE (System
// Variable)": 0 "Only annotative objects that support the current annotation scale are
// displayed", 1 "All annotative objects are displayed"). Which representation an object draws
// at a scale it supports is M1-63's, post-launch (PRD FR-A6, DEC-047): objects draw as stored.
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { AnnotationScale, Entity } from '../model/types';
import { annotationScaleNamed } from './scale-list';

/** ANNOALLVISIBLE: annotative objects not supporting the current scale shown (1) or hidden (0). */
export const ANNOALLVISIBLE = 'ANNOALLVISIBLE';
/**
 * ANNOAUTOSCALE: while positive, AutoCAD adds the new annotation scale to annotative objects
 * when CANNOSCALE changes; Triya never does (DEC-013) and says so.
 */
export const ANNOAUTOSCALE = 'ANNOAUTOSCALE';

/** What CANNOSCALE change says while ANNOAUTOSCALE is on: no object gets the scale (DEC-013). */
export const ANNOAUTOSCALE_NOTICE =
  'Triya does not add annotation scales to objects: annotative objects keep the scales they have.';

/** The scale of the drawing's list that CANNOSCALE names, if any. */
export function currentAnnotationScale(
  model: Pick<DocumentModel, 'header' | 'objects'>,
): AnnotationScale | undefined {
  const name = model.header.get('CANNOSCALE');
  if (typeof name !== 'string') return undefined;
  return annotationScaleNamed(model, name);
}

/**
 * Whether an object supports the annotation scale whose SCALE is `scale`: true when one of its
 * representations names it, false when every one names another, undefined when it cannot be
 * said (not annotative, or a representation Triya does not read may name it).
 */
export function supportsAnnotationScale(
  e: Pick<Entity, 'annotative'>,
  scale: Handle,
): boolean | undefined {
  const reps = e.annotative?.representations;
  if (!reps || reps.length === 0) return undefined;
  if (reps.some((r) => r.scale === scale)) return true;
  return reps.every((r) => r.scale !== undefined) ? false : undefined;
}

/**
 * Whether ANNOALLVISIBLE (`allVisible` false for 0) hides `e` at the drawing's current annotation
 * scale: an annotative object known not to support it. Nothing is hidden while CANNOSCALE names
 * no scale of the list.
 */
export function annotationHidden(
  model: Pick<DocumentModel, 'header' | 'objects'>,
  e: Pick<Entity, 'annotative'>,
  allVisible: boolean,
): boolean {
  if (allVisible || e.annotative === undefined) return false;
  const scale = currentAnnotationScale(model)?.handle;
  return scale !== undefined && supportsAnnotationScale(e, scale) === false;
}
