/**
 * Round-trip harness (docs/TESTING.md §3): open → save in the same version and format →
 * reopen → `structuralDiff(original, reopened)`.
 */
import type { CadDocument } from '@node-projects/acad-ts';
import { readCadDocument, writeCadDocument } from '@triya/io';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from './clock.ts';
import { structuralDiff, summarizeDiff, type Difference, type DiffSummary } from './diff.ts';

export type RoundTripStatus = 'clean' | 'diff' | 'read-error' | 'write-error' | 'reread-error';

export interface RoundTripResult {
  status: RoundTripStatus;
  /** First line of the error for the *-error statuses. */
  error?: string;
  format: 'dwg' | 'dxf-ascii' | 'dxf-binary' | 'unknown';
  bytesIn: number;
  bytesOut?: number;
  objectsA?: number;
  objectsB?: number;
  summary?: DiffSummary;
  /** The first differences, verbatim, for triage. */
  sample?: Difference[];
  ms: { read: number; write?: number; reread?: number; diff?: number };
}

export interface RoundTripOptions {
  /** How many differences to keep verbatim in `sample`. Default 25. */
  sampleSize?: number;
  maxDifferences?: number;
}

export function roundTrip(bytes: Uint8Array, options: RoundTripOptions = {}): RoundTripResult {
  return withPinnedClock(() => roundTripUnpinned(bytes, options));
}

function roundTripUnpinned(bytes: Uint8Array, options: RoundTripOptions): RoundTripResult {
  const { format } = sniffCadFile(bytes);
  const result: RoundTripResult = {
    status: 'clean',
    format,
    bytesIn: bytes.length,
    ms: { read: 0 },
  };
  const fail = (status: RoundTripStatus, err: unknown): RoundTripResult => ({
    ...result,
    status,
    error: errorLine(err),
  });

  let original: CadDocument;
  let working: CadDocument;
  let t = performance.now();
  try {
    // Two independent reads: writing may touch the document (handles, header times), and
    // the diff must compare against what the file actually said.
    original = readCadDocument(bytes);
    working = readCadDocument(bytes);
  } catch (err) {
    return fail('read-error', err);
  }
  result.ms.read = elapsed(t);

  let written: Uint8Array;
  t = performance.now();
  try {
    written = writeCadDocument(working, {
      format: format === 'dwg' ? 'dwg' : 'dxf',
      binary: format === 'dxf-binary',
    });
  } catch (err) {
    return fail('write-error', err);
  }
  result.ms.write = elapsed(t);
  result.bytesOut = written.length;

  let reopened: CadDocument;
  t = performance.now();
  try {
    reopened = readCadDocument(written);
  } catch (err) {
    return fail('reread-error', err);
  }
  result.ms.reread = elapsed(t);

  t = performance.now();
  const report = structuralDiff(original, reopened, {
    ...(options.maxDifferences === undefined ? {} : { maxDifferences: options.maxDifferences }),
  });
  result.ms.diff = elapsed(t);
  result.objectsA = report.objectsA;
  result.objectsB = report.objectsB;
  result.summary = summarizeDiff(report);
  result.sample = report.differences.slice(0, options.sampleSize ?? 25);
  result.status = report.differences.length === 0 ? 'clean' : 'diff';
  return result;
}

function elapsed(t0: number): number {
  return Math.round(performance.now() - t0);
}

function errorLine(err: unknown): string {
  const text = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
  return text.split('\n')[0]!.slice(0, 300);
}
