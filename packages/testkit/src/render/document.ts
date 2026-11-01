// A corpus file as a Triya document, assembled from the AcadToTriya mappers the way the app
// will once M1-22 opens files: header, tables, every block definition with its base point, the
// mapped entities in block order, and the SORTENTSTABLEs. Layouts, and the objects M1-05's
// passthrough store keeps, are left out: nothing that reads this needs them yet.
import type { CadDocument } from '@node-projects/acad-ts';
import {
  DocumentModel,
  SpatialIndex,
  toleranceFromExtents,
  type AnnotationBounds,
  type DocumentInit,
  type HeaderValue,
  type TextMeasure,
  type Vec2,
} from '@triya/engine';
import { mapEntities, mapHeader, mapSortEnts, mapTables } from '@triya/io';

const hex = (h: number | bigint): string => h.toString(16).toUpperCase();

export function documentInit(doc: CadDocument): DocumentInit {
  const { header, meta, handSeed } = mapHeader(doc);
  return {
    meta,
    handSeed,
    header,
    tables: mapTables(doc),
    blocks: [...(doc.blockRecords ?? [])].map((b) => {
      const p = b.blockEntity?.basePoint;
      return { handle: hex(b.handle), name: b.name, basePoint: { x: p?.x ?? 0, y: p?.y ?? 0 } };
    }),
    objects: mapSortEnts(doc),
    entities: mapEntities(doc).entities,
  };
}

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
