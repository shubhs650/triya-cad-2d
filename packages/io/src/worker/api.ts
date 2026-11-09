// What the I/O worker exposes over Comlink (ARCHITECTURE.md §3). Pure functions of their
// arguments, so the same object runs behind a real Worker or, in tests, a MessageChannel.
import type { ChangeSet } from '@triya/engine';
import * as Comlink from 'comlink';
import { saveSession } from '../export/save';
import { openDocument, type OpenedDocument } from '../map/document';
import {
  detectFormat,
  readCadDocument,
  summarizeDocument,
  type CadFormat,
  type ReadSummary,
} from '../read';

/**
 * A job's progress. acad-ts parses in one synchronous call, so progress is reported per stage
 * (parse 0, summarize or map 0.9, done 1) rather than per byte.
 */
export interface IoProgress {
  readonly stage: 'parse' | 'summarize' | 'map' | 'write' | 'done';
  readonly fraction: number;
}

/** An opened drawing: its summary and the Triya document the app builds on (M1-22). */
export interface OpenResult extends OpenedDocument {
  readonly summary: ReadSummary;
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

  /**
   * Parses a DWG or DXF and maps it to a Triya document (AcadToTriya), with its summary. The
   * result is plain data, so it crosses postMessage as a structured clone.
   */
  async open(
    bytes: Uint8Array,
    format?: CadFormat,
    onProgress?: ProgressCallback,
  ): Promise<OpenResult> {
    await onProgress?.({ stage: 'parse', fraction: 0 });
    const f = format ?? detectFormat(bytes);
    const doc = readCadDocument(bytes, f);
    await onProgress?.({ stage: 'map', fraction: 0.9 });
    const result = { summary: summarizeDocument(doc, f), ...openDocument(doc) };
    await onProgress?.({ stage: 'done', fraction: 1 });
    return result;
  },

  /**
   * Save and Save As (M2-13): the drawing `bytes` held, with the change sets its engine applied
   * since it opened, as an AC1032 DXF (`saveSession`). Throws `UnsupportedChangeError` for a
   * change no writer handles yet.
   */
  async save(
    bytes: Uint8Array,
    changes: readonly ChangeSet[],
    format?: CadFormat,
    onProgress?: ProgressCallback,
  ): Promise<Uint8Array> {
    await onProgress?.({ stage: 'write', fraction: 0 });
    const out = saveSession(bytes, changes, format);
    await onProgress?.({ stage: 'done', fraction: 1 });
    return Comlink.transfer(out, [out.buffer]);
  },
};

export type IoApi = typeof ioApi;
