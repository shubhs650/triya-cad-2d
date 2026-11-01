// What the I/O worker exposes over Comlink (ARCHITECTURE.md §3). Pure functions of their
// arguments, so the same object runs behind a real Worker or, in tests, a MessageChannel.
import {
  detectFormat,
  readCadDocument,
  summarizeDocument,
  type CadFormat,
  type ReadSummary,
} from '../read';

/**
 * A job's progress. acad-ts parses in one synchronous call, so progress is reported per stage
 * (parse 0, summarize 0.9, done 1) rather than per byte.
 */
export interface IoProgress {
  readonly stage: 'parse' | 'summarize' | 'done';
  readonly fraction: number;
}

export type ProgressCallback = (p: IoProgress) => void | Promise<void>;

export const ioApi = {
  /** Parses a DWG or DXF and summarises it. Throws the reader's error on an unreadable file. */
  async read(
    bytes: Uint8Array,
    format?: CadFormat,
    onProgress?: ProgressCallback,
  ): Promise<ReadSummary> {
    // Progress goes back over the port; awaiting it keeps the stages in order.
    await onProgress?.({ stage: 'parse', fraction: 0 });
    const f = format ?? detectFormat(bytes);
    const doc = readCadDocument(bytes, f);
    await onProgress?.({ stage: 'summarize', fraction: 0.9 });
    const summary = summarizeDocument(doc, f);
    await onProgress?.({ stage: 'done', fraction: 1 });
    return summary;
  },
};

export type IoApi = typeof ioApi;
