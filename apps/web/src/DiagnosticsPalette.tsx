// The Diagnostics palette (M7-08, ARCHITECTURE.md §17 "an in-app diagnostics panel (frame time,
// entity counts, cache sizes, worker status, last command timing)"): what the app knows of its
// own health for the drawing on screen, read again every second while the palette shows. All of
// it stays on this device; nothing here is sent anywhere (the error report is the one request
// the app makes, and only on Send Report).
//
// Each canvas of the drawing (one per space shown) reports its renderer's place (worker or main
// thread), its frames' times and its scene cache, and how long it took to answer; a renderer that
// does not answer within NOT_RESPONDING_MS is said to be not responding. The drawing's engine
// says where it runs and how long its last command and its last input took (engines.ts).
import { useEffect, useMemo, useState } from 'react';
import type { RenderStats } from '@triya/render';
import { controllersOf } from './canvas/registry';
import { layoutsOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import type { EngineTimings } from './engine/engines';
import { drawingStatistics } from './error-report/build';

/** How often the palette reads the numbers again, ms. */
export const DIAGNOSTICS_INTERVAL_MS = 1000;
/** A renderer slower than this to answer is not responding. */
export const NOT_RESPONDING_MS = 2000;
/** Entity types listed by count; the rest are summed. */
const TOP_TYPES = 8;

interface CanvasSample {
  readonly label: string;
  readonly mode: 'worker' | 'main';
  /** Undefined while it does not answer. */
  readonly stats?: RenderStats;
  readonly replyMs?: number;
}

interface Sample {
  readonly canvases: readonly CanvasSample[];
  readonly engine: 'worker' | 'main' | undefined;
  readonly timings: EngineTimings;
  readonly pdf: { readonly pages: number; readonly bytes: number };
  /** The main thread's JavaScript heap, where the browser tells it (Chromium). */
  readonly heapBytes?: number;
}

const ms = (v: number): string => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const count = (n: number): string => n.toLocaleString('en-US');
const duration = (v: number): string => (v < 1000 ? ms(v) : `${(v / 1000).toFixed(1)} s`);

async function sampleCanvas(
  c: { block: string; rendererMode: 'worker' | 'main'; stats(): Promise<RenderStats> },
  label: string,
): Promise<CanvasSample> {
  const start = performance.now();
  const stats = await Promise.race([
    c.stats().catch(() => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), NOT_RESPONDING_MS)),
  ]);
  return stats
    ? { label, mode: c.rendererMode, stats, replyMs: performance.now() - start }
    : { label, mode: c.rendererMode };
}

export function DiagnosticsPalette({
  doc,
  pdfCache,
  onClose,
}: {
  doc: OpenDocument;
  /** The PDF underlay page cache's size (underlay/pages.ts). */
  pdfCache: () => { readonly pages: number; readonly bytes: number };
  onClose: () => void;
}) {
  const [sample, setSample] = useState<Sample>();
  // Worked out again as the drawing changes, not every second.
  const drawing = useMemo(
    () =>
      drawingStatistics({
        name: doc.name,
        opened: doc.opened,
        changes: engines.changesOf(doc.id),
        edits: doc.edits,
      }),
    [doc.id, doc.revision, doc.edits],
  );

  useEffect(() => {
    let live = true;
    const read = async () => {
      const layouts = layoutsOf(doc.opened.init, engines.changesOf(doc.id));
      const labelOf = (block: string) =>
        block === doc.opened.modelSpace
          ? 'Model'
          : (layouts.find((l) => l.blockRecord === block)?.name ?? 'Block');
      const canvases = await Promise.all(
        [...controllersOf(doc.id)].map((c) => sampleCanvas(c, labelOf(c.block))),
      );
      const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      if (!live) return;
      setSample({
        canvases,
        engine: engines.modeOf(doc.id),
        timings: engines.timingsOf(doc.id),
        pdf: pdfCache(),
        ...(heap ? { heapBytes: heap.usedJSHeapSize } : {}),
      });
    };
    void read();
    const timer = setInterval(() => void read(), DIAGNOSTICS_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [doc.id, doc.opened, pdfCache]);

  const types = Object.entries(drawing.entities).sort(([, a], [, b]) => b - a);
  const total = types.reduce((n, [, c]) => n + c, 0);
  const others = types.slice(TOP_TYPES).reduce((n, [, c]) => n + c, 0);
  const last = sample?.timings.lastCommand;

  return (
    <aside className="palette diagnostics-palette" aria-labelledby="diagnostics-title">
      <header>
        <h2 id="diagnostics-title">Diagnostics</h2>
        <button type="button" aria-label="Close Diagnostics" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="diagnostics-body">
        <section aria-labelledby="diagnostics-drawing">
          <h3 id="diagnostics-drawing">Drawing</h3>
          <dl>
            <dt>Entities</dt>
            <dd data-testid="diagnostics-entities">{count(total)}</dd>
            {types.slice(0, TOP_TYPES).map(([type, n]) => (
              <div key={type} className="diagnostics-sub">
                <dt>{type}</dt>
                <dd>{count(n)}</dd>
              </div>
            ))}
            {others > 0 && (
              <div className="diagnostics-sub">
                <dt>Other types</dt>
                <dd>{count(others)}</dd>
              </div>
            )}
            <dt>Layers</dt>
            <dd>{count(drawing.counts.layers)}</dd>
            <dt>Blocks</dt>
            <dd>{count(drawing.counts.blocks)}</dd>
            <dt>Layouts</dt>
            <dd>{count(drawing.counts.layouts)}</dd>
            <dt>Edits since opened</dt>
            <dd>{count(drawing.counts.edits)}</dd>
          </dl>
        </section>
        <section aria-labelledby="diagnostics-rendering">
          <h3 id="diagnostics-rendering">Rendering</h3>
          {sample?.canvases.length === 0 && <p>No canvas shows this drawing.</p>}
          {sample?.canvases.map((c, i) => (
            <dl key={i} aria-label={`Canvas ${c.label}`} data-testid="diagnostics-canvas">
              <dt>Space</dt>
              <dd>{c.label}</dd>
              <dt>Renderer</dt>
              <dd>
                {c.mode === 'worker' ? 'Worker' : 'Main thread'}
                {c.stats ? `, answered in ${ms(c.replyMs!)}` : ', not responding'}
              </dd>
              {c.stats && (
                <>
                  <dt>Last frame</dt>
                  <dd data-testid="diagnostics-last-frame">{ms(c.stats.lastFrameMs)}</dd>
                  <dt>Frame time (last 60)</dt>
                  <dd>
                    {ms(c.stats.meanFrameMs)} mean, {ms(c.stats.maxFrameMs)} max
                  </dd>
                  <dt>Frames drawn</dt>
                  <dd data-testid="diagnostics-frames">{count(c.stats.frames)}</dd>
                  <dt>Scene cache</dt>
                  <dd>
                    {count(c.stats.entities)} entities, {count(c.stats.primitives)} primitives
                  </dd>
                </>
              )}
            </dl>
          ))}
        </section>
        <section aria-labelledby="diagnostics-engine">
          <h3 id="diagnostics-engine">Command engine</h3>
          <dl>
            <dt>Runs in</dt>
            <dd>
              {sample?.engine === 'worker'
                ? 'Worker'
                : sample?.engine === 'main'
                  ? 'Main thread'
                  : 'Not running'}
            </dd>
            <dt>Last command</dt>
            <dd data-testid="diagnostics-last-command">
              {last
                ? `${last.command}, ${duration(last.ms)}${last.cancelled ? ' (cancelled)' : ''}`
                : 'None yet'}
            </dd>
            <dt>Last input read in</dt>
            <dd data-testid="diagnostics-last-input">
              {sample?.timings.lastResponseMs !== undefined
                ? ms(sample.timings.lastResponseMs)
                : 'None yet'}
            </dd>
          </dl>
        </section>
        <section aria-labelledby="diagnostics-memory">
          <h3 id="diagnostics-memory">Caches and memory</h3>
          <dl>
            <dt>PDF underlay pages</dt>
            <dd>{sample ? `${count(sample.pdf.pages)} pages, ${mb(sample.pdf.bytes)}` : '…'}</dd>
            {sample?.heapBytes !== undefined && (
              <>
                <dt>JavaScript heap (main thread)</dt>
                <dd>{mb(sample.heapBytes)}</dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </aside>
  );
}
