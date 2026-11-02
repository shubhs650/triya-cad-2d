// A corpus file as a Triya document, assembled by `documentInit` from @triya/io: the same
// mapping the app opens files with (M1-22).
import type { CadDocument } from '@node-projects/acad-ts';
import {
  DocumentModel,
  SpatialIndex,
  toleranceFromExtents,
  type AnnotationBounds,
  type HeaderValue,
  type TextMeasure,
  type Vec2,
} from '@triya/engine';
import { documentInit } from '@triya/io';

export { documentInit };

const point = (v: HeaderValue | undefined): Vec2 | undefined =>
  typeof v === 'object' ? { x: v.x, y: v.y } : undefined;

/**
 * The document and its spatial index, with the tolerance from `$EXTMIN`/`$EXTMAX`, and text
 * bounds when `annotationBounds` is given one (it gets the model, for the text styles), and
 * text widths for TOLERANCE frames when `measureText` is.
 */
export function corpusDrawing(
  doc: CadDocument,
  annotationBounds?: (model: DocumentModel) => AnnotationBounds,
  measureText?: (model: DocumentModel) => TextMeasure,
): { model: DocumentModel; index: SpatialIndex } {
  const model = DocumentModel.create(documentInit(doc));
  const min = point(model.header.get('$EXTMIN'));
  const max = point(model.header.get('$EXTMAX'));
  // A file without extents gets the unit-size tolerance, as toleranceFromExtents gives empty ones.
  const tol = toleranceFromExtents(min ?? { x: 1, y: 1 }, max ?? { x: 0, y: 0 });
  const bounds = annotationBounds?.(model);
  const measure = measureText?.(model);
  return {
    model,
    index: SpatialIndex.build(model, {
      tol,
      ...(bounds ? { annotationBounds: bounds } : {}),
      ...(measure ? { measureText: measure } : {}),
    }),
  };
}
