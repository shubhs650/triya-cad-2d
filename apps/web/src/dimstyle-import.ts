// Where Import Dimension Styles (M4-03 part 3) reads another drawing's styles from: another open
// drawing as it stands now (its file as opened with every change since replayed, as a canvas
// catching up does), or a drawing file read by a fresh I/O worker, as Open reads one, without
// opening it in a tab.
import { applyToReplica, DocumentModel, type ChangeSet } from '@triya/engine';
import type { OpenDocument } from './documents';
import { openDrawing } from './open';

/** A drawing the styles can come from. */
export interface StyleSource {
  readonly id: number;
  readonly name: string;
  /** The drawing as it stands; made when the drawing is picked. */
  readonly model: () => DocumentModel;
}

/** An open drawing's document as its engine holds it now. */
export function openDrawingModel(
  doc: Pick<OpenDocument, 'name' | 'opened'>,
  changes: readonly ChangeSet[],
): DocumentModel {
  // A copy: the opened init is the app's, which the model would freeze.
  const model = DocumentModel.create(structuredClone(doc.opened.init));
  for (const cs of changes) applyToReplica(model, cs, doc.name);
  return model;
}

/** A drawing file's document, as Open reads it. */
export async function drawingFileModel(file: Blob): Promise<DocumentModel> {
  const opened = await openDrawing(file);
  return DocumentModel.create(opened.init);
}
