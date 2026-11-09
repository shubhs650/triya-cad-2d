// Main-thread side of the I/O worker (ARCHITECTURE.md §3: "I/O worker is spawned per heavy job
// and terminated after"). Every job gets a fresh worker that is terminated when the job ends,
// however it ends, so a 30 MB parse never blocks interaction and its memory is released.
//
// io compiles without DOM types, so the worker and the abort signal are typed structurally;
// a browser `Worker` and `AbortSignal` satisfy them.
import * as Comlink from 'comlink';
import type { ChangeSet } from '@triya/engine';
import type { CadFormat, ReadSummary } from '../read';
import type { IoApi, IoProgress, OpenResult } from './api';

export type IoWorker = Comlink.Endpoint & { terminate(): void };

export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface ReadInWorkerOptions {
  /** Spawns the worker, e.g. `() => new Worker(new URL('@triya/io/worker', import.meta.url), { type: 'module' })`. */
  readonly createWorker: () => IoWorker;
  /** Defaults to sniffing the bytes. */
  readonly format?: CadFormat;
  readonly onProgress?: (p: IoProgress) => void;
  /** Aborting rejects the job with an `AbortError` and terminates its worker at once. */
  readonly signal?: AbortSignalLike;
}

function abortError(): Error {
  const e = new Error('The I/O job was cancelled.');
  e.name = 'AbortError';
  return e;
}

/**
 * Parses `bytes` in a new worker and resolves with the summary. The bytes are transferred,
 * not copied: afterwards the caller's buffer is detached. A view into a larger buffer is
 * copied first, so the rest of that buffer stays usable.
 */
export function readInWorker(
  bytes: Uint8Array,
  options: ReadInWorkerOptions,
): Promise<ReadSummary> {
  return runJob(bytes, options, (remote, own, progress) =>
    remote.read(own, options.format, progress),
  );
}

/**
 * Opens a drawing in a new worker (M1-22): parses `bytes` and resolves with its summary and
 * the Triya document mapped from it. The bytes are transferred as by `readInWorker`.
 */
export function openInWorker(bytes: Uint8Array, options: ReadInWorkerOptions): Promise<OpenResult> {
  return runJob(bytes, options, (remote, own, progress) =>
    remote.open(own, options.format, progress),
  );
}

export interface SaveInWorkerOptions extends ReadInWorkerOptions {
  /** The change sets the drawing's engine applied since it opened, in order. */
  readonly changes: readonly ChangeSet[];
}

/**
 * Save and Save As (M2-13): writes the drawing opened from `bytes`, with `changes`, as an AC1032
 * DXF in a new worker. `bytes` are copied, not transferred: the app keeps them for later saves.
 */
export function saveInWorker(bytes: Uint8Array, options: SaveInWorkerOptions): Promise<Uint8Array> {
  return runJob(bytes.slice(), options, (remote, own, progress) =>
    remote.save(own, options.changes, options.format, progress),
  );
}

async function runJob<T>(
  bytes: Uint8Array,
  options: ReadInWorkerOptions,
  call: (
    remote: Comlink.Remote<IoApi>,
    own: Uint8Array,
    progress: ((p: IoProgress) => void) | undefined,
  ) => Promise<T>,
): Promise<T> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const own =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  const worker = options.createWorker();
  const remote = Comlink.wrap<IoApi>(worker);
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    const progress = options.onProgress && Comlink.proxy(options.onProgress);
    const job = call(remote, Comlink.transfer(own, [own.buffer]), progress);
    return await Promise.race([job, aborted]);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    // Terminating discards the worker's whole heap (the parsed document included).
    worker.terminate();
  }
}
