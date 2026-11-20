// The I/O worker's part of M5-01 part 4: a drawing file picked with INSERT's Browse..., read as
// Open reads one, and WBLOCK's new drawing, written by a fresh worker and handed over as EXPORT
// hands its DXF.
import IoWorker from '@triya/io/worker?worker';
import { writeBlockInWorker } from '@triya/io/client';
import { drawingContent, type BlockDrawing, type Clipboard } from '@triya/engine';
import { drawingFileModel } from './dimstyle-import';

/** A drawing file picked with Browse...: its model space, as INSERT makes a block of it. */
export async function browsedDrawing(file: Blob): Promise<Clipboard> {
  return drawingContent(await drawingFileModel(file)).clipboard;
}

/** WBLOCK's (and LAYOUT SAveas's) new drawing as an AC1032 DXF, written by a fresh I/O worker. */
export function writeBlockFile(drawing: BlockDrawing): Promise<Uint8Array> {
  return writeBlockInWorker(
    drawing.content,
    drawing.header,
    { createWorker: () => new IoWorker() },
    drawing.layout,
  );
}
