/// <reference lib="dom" />
// Test page for the renderer specs: builds a drawing the way the engine will hand it over
// (a DocumentInit plus ChangeSets), draws it through RendererHost in the worker and/or on the
// main thread, and exposes a few functions for Playwright to call.
import {
  ChangeSetBuilder,
  DocumentModel,
  type DocumentInit,
  type EntityInit,
} from '../../../../packages/engine/src/index';
import { documentInit } from '../../../../packages/io/src/index';
import {
  RendererHost,
  decodeRaster,
  fitView,
  type RenderStyle,
  type RendererMode,
} from '../../../../packages/render/src/index';
import {
  drawingInit,
  entity,
  LAYER_RED,
  line,
  MODEL,
} from '../../../../packages/render/test/fixtures';
import { BENCH_100K, benchDocument } from '../../../../packages/testkit/src/bench/drawing';

export interface SetupOptions {
  /** `bench-100k` is the generated benchmark (M1-42, DEC-045), mapped as a file would be. */
  readonly drawing: 'sample' | 'synthetic' | 'bench-100k';
  /** Entities in the synthetic drawing. */
  readonly count?: number;
  readonly theme: 'dark' | 'light';
  readonly modes: readonly RendererMode[];
  readonly width: number;
  readonly height: number;
}

export interface SetupResult {
  readonly modes: Record<string, RendererMode>;
  /** Non-background pixels on the main-thread canvas (the worker's cannot be read back). */
  readonly ink: number;
  /** From creating the host to its first full frame being drawn, per mode. */
  readonly firstFrameMs: Record<string, number>;
}

export interface PanZoomResult {
  readonly frames: number;
  readonly fps: number;
  readonly maxFrameMs: number;
}

const THEMES: Record<SetupOptions['theme'], RenderStyle> = {
  dark: { background: '#212830', foreground: '#ffffff', showLineweights: true },
  light: { background: '#ffffff', foreground: '#000000', showLineweights: true },
};

/** One of every kind the renderer draws, in several colours and lineweights. */
function sample(): EntityInit[] {
  const c = (index: number) => ({ color: { kind: 'aci' as const, index } });
  return [
    entity('100', line(0, 0, 100, 60)),
    entity('101', line(0, 60, 100, 0), { ...c(1), lineweight: 50 }),
    entity('102', { kind: 'CIRCLE', center: { x: 50, y: 30 }, radius: 25 }, c(3)),
    entity(
      '103',
      { kind: 'ARC', center: { x: 20, y: 40 }, radius: 12, startAngle: 0.3, endAngle: 4 },
      { color: { kind: 'rgb', r: 255, g: 160, b: 30 } },
    ),
    entity(
      '104',
      {
        kind: 'ELLIPSE',
        center: { x: 75, y: 40 },
        majorAxis: { x: 15, y: 6 },
        ratio: 0.4,
        startParam: 0,
        endParam: 2 * Math.PI,
      },
      c(5),
    ),
    entity(
      '105',
      {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 10, y: 5, bulge: 0 },
          { x: 40, y: 5, bulge: 0.6 },
          { x: 40, y: 20, bulge: 0 },
          { x: 10, y: 20, bulge: -0.3 },
        ],
      },
      { ...c(4), lineweight: 30 },
    ),
    entity(
      '106',
      {
        kind: 'SPLINE',
        degree: 3,
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
        controlPoints: [
          { x: 55, y: 5 },
          { x: 65, y: 25 },
          { x: 85, y: -5 },
          { x: 95, y: 15 },
        ],
        closed: false,
        periodic: false,
      },
      c(6),
    ),
    entity(
      '107',
      {
        kind: 'SOLID',
        corners: [
          { x: 85, y: 50 },
          { x: 95, y: 50 },
          { x: 85, y: 58 },
          { x: 95, y: 58 },
        ],
      },
      { layer: LAYER_RED },
    ),
    entity('108', { kind: 'XLINE', base: { x: 0, y: 30 }, direction: { x: 1, y: 0.2 } }, c(8)),
    entity('109', { kind: 'POINT', position: { x: 5, y: 55 } }),
  ];
}

/** `count` entities spread over a 10 000-unit square: lines, circles, arcs and polylines. */
function synthetic(count: number): EntityInit[] {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const out: EntityInit[] = [];
  for (let i = 0; i < count; i++) {
    const handle = (0x1000 + i).toString(16).toUpperCase();
    const x = rand() * 10_000;
    const y = rand() * 10_000;
    const s = 5 + rand() * 40;
    const extra = { color: { kind: 'aci' as const, index: 1 + (i % 7) } };
    const k = i % 20;
    if (k < 10) out.push(entity(handle, line(x, y, x + s, y + s * (rand() - 0.5)), extra));
    else if (k < 14)
      out.push(entity(handle, { kind: 'CIRCLE', center: { x, y }, radius: s / 2 }, extra));
    else if (k < 17)
      out.push(
        entity(
          handle,
          {
            kind: 'ARC',
            center: { x, y },
            radius: s / 2,
            startAngle: rand() * 6,
            endAngle: rand() * 6,
          },
          extra,
        ),
      );
    else
      out.push(
        entity(
          handle,
          {
            kind: 'LWPOLYLINE',
            closed: false,
            vertices: [
              { x, y, bulge: 0 },
              { x: x + s, y, bulge: 0.4 },
              { x: x + s, y: y + s, bulge: 0 },
              { x, y: y + s, bulge: 0 },
            ],
          },
          extra,
        ),
      );
  }
  return out;
}

let engine: DocumentModel | undefined;
let hosts: { mode: RendererMode; host: RendererHost }[] = [];
let size = { width: 0, height: 0 };
/** The drawing's extents, which pan/zoom moves about. */
let extents = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
let background = '#000000';

function createWorker() {
  return new Worker(new URL('../../../../packages/render/src/worker.ts', import.meta.url), {
    type: 'module',
  });
}

function inkOf(canvas: HTMLCanvasElement, background: string): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bg = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== bg[0] || data[i + 1] !== bg[1] || data[i + 2] !== bg[2]) ink++;
  }
  return ink;
}

async function setup(o: SetupOptions): Promise<SetupResult> {
  let init: DocumentInit;
  let block = MODEL;
  const box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  if (o.drawing === 'bench-100k') {
    init = documentInit(benchDocument(BENCH_100K));
    block = init.tables!.blockRecords!.find((r) => r.name.toLowerCase() === '*model_space')!.handle;
    // 1000 columns of 20-unit cells (packages/testkit/src/bench/drawing.ts).
    Object.assign(box, { maxX: 20_000, maxY: (BENCH_100K.entities / 1000) * 20 });
  } else {
    const entities = o.drawing === 'sample' ? sample() : synthetic(o.count ?? 1000);
    init = { ...drawingInit(entities), handSeed: '100000' };
    if (o.drawing === 'sample') Object.assign(box, { maxX: 100, maxY: 60 });
    else Object.assign(box, { maxX: 10_050, maxY: 10_050 });
  }
  engine = DocumentModel.create(init);
  size = { width: o.width, height: o.height };
  extents = box;
  const style = THEMES[o.theme];
  background = style.background;
  const view = fitView(box, o.width, o.height);

  const firstFrameMs: Record<string, number> = {};
  const modes: Record<string, RendererMode> = {};
  let ink = 0;
  hosts = [];
  for (const mode of o.modes) {
    const canvas = document.createElement('canvas');
    canvas.id = mode;
    canvas.style.width = `${o.width}px`;
    canvas.style.height = `${o.height}px`;
    document.body.append(canvas);
    const start = performance.now();
    const host = new RendererHost({
      canvas,
      document: { init, block },
      mode,
      createWorker,
      style,
    });
    host.resize(o.width, o.height, devicePixelRatio);
    host.setView(view);
    host.frame();
    await host.flush();
    firstFrameMs[mode] = performance.now() - start;
    modes[mode] = host.mode;
    hosts.push({ mode, host });
    if (host.mode === 'main') ink = inkOf(canvas, style.background);
  }
  return { modes, ink, firstFrameMs };
}

/** An edit the engine applies, forwarded to every host: add a circle, move a line, hide RED. */
async function edit(): Promise<number> {
  if (!engine) throw new Error('setup first');
  const b = new ChangeSetBuilder(engine);
  b.addEntity(entity('0', { kind: 'CIRCLE', center: { x: 30, y: 30 }, radius: 8 }, {}));
  b.updateEntity(engine.ids.idOf('100')!, { geom: line(0, 10, 100, 50) });
  b.updateTableRecord('layers', LAYER_RED, { color: { kind: 'aci', index: 2 } });
  const cs = b.build();
  engine.apply(cs);
  for (const { host } of hosts) {
    host.apply(cs);
    host.setTransient([{ kind: 'point', x: 50, y: 50, color: '#00ff00' }]);
    host.frame();
  }
  await Promise.all(hosts.map(({ host }) => host.flush()));
  const main = document.getElementById('main') as HTMLCanvasElement | null;
  return main ? inkOf(main, background) : 0;
}

/**
 * Pans and zooms one host for `ms` as the app does: one view change and frame per animation
 * frame, waiting for each to be drawn before the next, so `fps` is frames shown per second
 * (at most the display rate) rather than how fast the renderer can take messages.
 */
async function panZoom(mode: RendererMode, ms: number): Promise<PanZoomResult> {
  const h = hosts.find((x) => x.mode === mode)?.host;
  if (!h) throw new Error(`no ${mode} host`);
  const base = fitView(extents, size.width, size.height);
  // About 8 % of the drawing's size each way (800 units on the 10 050-unit synthetic one).
  const swingX = 0.08 * (extents.maxX - extents.minX);
  const swingY = 0.08 * (extents.maxY - extents.minY);
  const start = performance.now();
  let frames = 0;
  let maxFrameMs = 0;
  while (performance.now() - start < ms) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const t = (performance.now() - start) / 1000;
    const f0 = performance.now();
    h.setView({
      center: {
        x: base.center.x + swingX * Math.sin(t),
        y: base.center.y + swingY * Math.cos(t),
      },
      scale: base.scale * (1 + 0.2 * Math.sin(t * 1.7)),
    });
    h.frame();
    await h.flush();
    maxFrameMs = Math.max(maxFrameMs, performance.now() - f0);
    frames++;
  }
  const seconds = (performance.now() - start) / 1000;
  return { frames, fps: frames / seconds, maxFrameMs };
}

/** An image file through `decodeRaster` with the browser's own codecs (M1-19 part 2). */
async function decodeImage(
  bytes: number[],
): Promise<{ width: number; height: number; data: number[]; bitonal: boolean }> {
  const p = await decodeRaster(new Uint8Array(bytes));
  return { width: p.width, height: p.height, data: [...p.data], bitonal: p.bitonal === true };
}

/** A canvas filled with `rgba` encoded by the browser as `type` (for lossy formats). */
async function encodeImage(type: string, rgba: number[], width: number): Promise<number[]> {
  const c = new OffscreenCanvas(width, rgba.length / 4 / width);
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width), 0, 0);
  return [...new Uint8Array(await (await c.convertToBlob({ type, quality: 1 })).arrayBuffer())];
}

declare global {
  interface Window {
    decodeImage: typeof decodeImage;
    encodeImage: typeof encodeImage;
    setup(o: SetupOptions): Promise<SetupResult>;
    edit(): Promise<number>;
    panZoom(mode: RendererMode, ms: number): Promise<PanZoomResult>;
  }
}

window.decodeImage = decodeImage;
window.encodeImage = encodeImage;
window.setup = setup;
window.edit = edit;
window.panZoom = panZoom;
document.title = 'ready';
