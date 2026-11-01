import {
  detectFormat,
  readCadDocument,
  summarizeDocument,
  type CadFormat,
  type ReadSummary,
} from '../read';

// Message contract between the main thread and the I/O worker. Plain structured-cloneable
// objects for now; M1-06 replaces the transport with Comlink, progress and cancellation.
export interface ReadRequest {
  id: number;
  kind: 'read';
  bytes: Uint8Array;
  /** Defaults to sniffing the bytes with `detectFormat`. */
  format?: CadFormat;
}

export type IoRequest = ReadRequest;

export type IoResponse =
  { id: number; ok: true; summary: ReadSummary } | { id: number; ok: false; error: string };

/** Pure request handler; the worker entry only binds it to the message port. */
export function handleIoRequest(req: IoRequest): IoResponse {
  try {
    const format = req.format ?? detectFormat(req.bytes);
    const doc = readCadDocument(req.bytes, format);
    return { id: req.id, ok: true, summary: summarizeDocument(doc, format) };
  } catch (err: unknown) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { id: req.id, ok: false, error: error || 'unknown read error' };
  }
}
