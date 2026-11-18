// Drawing files as blocks (M5-01 part 4). The browser reads no folder by itself, so a drawing file
// typed at -INSERT (`name=file`) is found among what the app already holds: the drawings open, as
// they stand, and the files dropped for xrefs this session (App.tsx lists them). INSERT's
// Browse... reads the file picked instead (block-file-io.ts).
import { drawingContent, fileBlockName, type DocumentModel, type ViewReply } from '@triya/engine';

/** A drawing the app holds by name: one open, or a file that answered xrefs. */
export interface HeldDrawing {
  readonly name: string;
  readonly model: () => DocumentModel | Promise<DocumentModel>;
}

/**
 * The reply to -INSERT's `drawingFile`: the drawing `file` names (folders and extension aside,
 * any case) as a block's contents, the first held by that name; no drawing when none is.
 */
export async function drawingFileReply(
  file: string,
  held: readonly HeldDrawing[],
): Promise<ViewReply> {
  const key = fileBlockName(file).toUpperCase();
  const found = held.find((h) => fileBlockName(h.name).toUpperCase() === key);
  if (!found) return { ok: true };
  try {
    const content = drawingContent(await found.model()).clipboard;
    return { ok: true, drawing: { name: found.name, content } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `${found.name} could not be read: ${reason}` };
  }
}
