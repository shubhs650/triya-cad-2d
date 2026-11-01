/// <reference lib="dom" />
// Test page for tests/e2e/io: loads a drawing through readInWorker the way the app will (a
// module worker built by Vite, one per job) and exposes one function for Playwright to call.
// Only the client is imported here: acad-ts must load in the worker, never on this page.
// Importing the package index would pull read.ts, and with it acad-ts, onto this page.
import type { IoProgress, ReadSummary } from '../../../../packages/io/src/index';
import { readInWorker } from '../../../../packages/io/src/worker/client';

export interface LoadResult {
  readonly ok: boolean;
  readonly summary?: ReadSummary;
  readonly error?: string;
  readonly stages: IoProgress[];
  /** Wall time of the job, from spawning the worker to settling. */
  readonly durationMs: number;
  /** With `abortAfterStage`: from calling abort() to the job settling. */
  readonly settleAfterAbortMs?: number;
  /** Longest gap between 10 ms timer ticks on this page while the job ran. */
  readonly maxTickGapMs: number;
  /** Longest wait between an input event's timestamp and its handler running. */
  readonly maxInputDelayMs: number;
  readonly inputEvents: number;
  readonly workersCreated: number;
  readonly workersTerminated: number;
  /** A script whose URL names acad-ts was fetched by this page (not by a worker). */
  readonly mainThreadHasAcadTs: boolean;
}

export interface LoadOptions {
  /** Abort the job ABORT_DELAY_MS after the worker reports this stage. */
  readonly abortAfterStage?: IoProgress['stage'];
}

const ABORT_DELAY_MS = 200;

// This page imports everything it runs statically, so its module graph is complete once
// main.ts executes. Checked now, before any job, because Chromium also lists a worker's module
// fetches in the page's resource timeline.
const mainThreadHasAcadTs = performance
  .getEntriesByType('resource')
  .some((r) => r.name.includes('acad-ts'));

/** Records the longest main-thread stall while it runs: timer ticks and input handling. */
function probe() {
  let last = performance.now();
  let maxTickGapMs = 0;
  let maxInputDelayMs = 0;
  let inputEvents = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxTickGapMs = Math.max(maxTickGapMs, now - last);
    last = now;
  }, 10);
  const onInput = (e: Event) => {
    inputEvents++;
    maxInputDelayMs = Math.max(maxInputDelayMs, performance.now() - e.timeStamp);
  };
  window.addEventListener('pointermove', onInput);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pointermove', onInput);
    maxTickGapMs = Math.max(maxTickGapMs, performance.now() - last);
    return { maxTickGapMs, maxInputDelayMs, inputEvents };
  };
}

async function load(url: string, options: LoadOptions = {}): Promise<LoadResult> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const stages: IoProgress[] = [];
  let workersCreated = 0;
  let workersTerminated = 0;
  const controller = new AbortController();
  let abortedAt: number | undefined;
  const stop = probe();
  const start = performance.now();
  let summary: ReadSummary | undefined;
  let error: string | undefined;
  try {
    summary = await readInWorker(bytes, {
      createWorker: () => {
        workersCreated++;
        const w = new Worker(
          new URL('../../../../packages/io/src/worker/io.worker.ts', import.meta.url),
          { type: 'module' },
        );
        const terminate = w.terminate.bind(w);
        w.terminate = () => {
          workersTerminated++;
          terminate();
        };
        return w;
      },
      onProgress: (p) => {
        stages.push(p);
        if (p.stage === options.abortAfterStage) {
          setTimeout(() => {
            abortedAt = performance.now();
            controller.abort();
          }, ABORT_DELAY_MS);
        }
      },
      signal: controller.signal,
    });
  } catch (e) {
    error = e instanceof Error ? e.name : String(e);
  }
  const end = performance.now();
  return {
    ok: error === undefined,
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {}),
    stages,
    durationMs: end - start,
    ...(abortedAt !== undefined ? { settleAfterAbortMs: end - abortedAt } : {}),
    ...stop(),
    workersCreated,
    workersTerminated,
    mainThreadHasAcadTs,
  };
}

/** Control for the probes: blocks this page for `ms`, as parsing on it would. */
async function blockMainThread(ms: number): Promise<ReturnType<ReturnType<typeof probe>>> {
  const stop = probe();
  await new Promise((r) => setTimeout(r, 30));
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Busy-wait on purpose: this is what parsing on the main thread would do.
  }
  await new Promise((r) => setTimeout(r, 30));
  return stop();
}

declare global {
  interface Window {
    load(url: string, options?: LoadOptions): Promise<LoadResult>;
    blockMainThread(ms: number): ReturnType<typeof blockMainThread>;
  }
}

window.load = load;
window.blockMainThread = blockMainThread;
document.title = 'ready';
