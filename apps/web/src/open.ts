// Opening a drawing (M1-22): the bytes go to a fresh I/O worker, which parses and maps them;
// only the client is imported here, so acad-ts never loads on the main thread.
import IoWorker from '@triya/io/worker?worker';
import { openInWorker } from '@triya/io/client';
import type { OpenResult } from '@triya/io';

export async function openDrawing(file: Blob | Uint8Array): Promise<OpenResult> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  return openInWorker(bytes, { createWorker: () => new IoWorker() });
}

/** The message shown when a file cannot be opened. */
export function openError(name: string, e: unknown): string {
  const reason = e instanceof Error ? e.message : String(e);
  return `${name} could not be opened: ${reason}`;
}
