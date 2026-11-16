// M4-03 part 3: the Dimension Style Manager's preview image. The render session draws the
// engine's preview drawing (a plate dimensioned in the style) on a layer of its own the size of
// the dialog's picture, fitted, on the canvas background, in the drawing's fonts, and hands it
// over as a bitmap; through the worker as on the main thread.
import { toleranceForSize, type DimStyleRecord, type TextStyleRecord } from '@triya/engine';
import { describe, expect, it, vi } from 'vitest';
import {
  RenderSession,
  RendererHost,
  serveRenderer,
  type FontSources,
  type HostCanvas,
  type HostMessage,
  type RenderWorker,
  type WorkerMessage,
} from '../src/index';
import simplex from '../../../assets/fonts/oet-simplex.json';
import { drawingInit, entity, line, MODEL, surface } from './fixtures';

const TEXT = '30';
const STANDARD = '31';
const ISO = '32';
const textStyle: TextStyleRecord = {
  handle: TEXT,
  name: 'Standard',
  font: 'romans.shx',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};
const dimStyles: DimStyleRecord[] = [
  { handle: STANDARD, name: 'Standard', vars: { DIMTXT: 0.18, DIMASZ: 0.18, DIMTXSTY: TEXT } },
  { handle: ISO, name: 'ISO-25', vars: { DIMTXT: 2.5, DIMASZ: 2.5, DIMTXSTY: TEXT } },
];
const FONTS: FontSources = { shx: [{ name: 'oet-simplex', source: JSON.stringify(simplex) }] };
const document = {
  init: drawingInit([entity('20', line(0, 0, 1000, 0))], { textStyles: [textStyle], dimStyles }),
  block: MODEL,
  tol: toleranceForSize(1000),
};
const DARK = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const LIGHT = { background: '#ffffff', foreground: '#000000', showLineweights: false };

type Layer = ReturnType<typeof surface>;

function setup(fonts: FontSources | undefined = FONTS) {
  const layers: Layer[] = [];
  const s = new RenderSession({
    document,
    surface: surface('visible'),
    createLayer: () => {
      const l = surface(`layer${layers.length}`);
      layers.push(l);
      return l;
    },
    style: DARK,
    requestIdle: () => {},
    ...(fonts && { fonts }),
  });
  const bitmaps: { source: CanvasImageSource; options: ImageBitmapOptions }[] = [];
  const createBitmap = (source: CanvasImageSource, options: ImageBitmapOptions) => {
    bitmaps.push({ source, options });
    return Promise.resolve({ width: 1 } as unknown as ImageBitmap);
  };
  return { s, layers, bitmaps, createBitmap };
}

describe('dimension style preview image (M4-03 part 3)', () => {
  it('draws the style’s sample fitted in the picture on the canvas background', async () => {
    const { s, layers, bitmaps, createBitmap } = setup();
    const before = layers.length;
    const bitmap = await s.dimStylePreview(
      { style: 'ISO-25' },
      { width: 240, height: 160, dpr: 2 },
      createBitmap,
    );
    expect(bitmap).toBeDefined();
    const made = layers.slice(before);
    // The picture is the last layer made, the size asked for in device pixels, its background
    // filled first and the drawn scene laid over it.
    const picture = made.at(-1)!;
    expect(bitmaps).toHaveLength(1);
    expect(bitmaps[0]!.source).toBe(picture.image);
    expect(picture.canvas).toEqual({ width: 480, height: 320 });
    const calls = picture.ctx.calls.map((c) => c[0]);
    expect(picture.ctx.calls).toContainEqual(['fillStyle', '#000000']);
    expect(calls.indexOf('fillRect')).toBeLessThan(calls.indexOf('drawImage'));
    // The scene layers hold the sample: its lines, arcs and text stroked, arrowheads filled.
    const count = (name: string) =>
      made.reduce((n, l) => n + l.ctx.calls.filter((c) => c[0] === name).length, 0);
    expect(count('moveTo')).toBeGreaterThanOrEqual(40);
    expect(count('arc')).toBeGreaterThanOrEqual(2);
    expect(count('fill')).toBeGreaterThanOrEqual(7);
  });

  it('follows the canvas display style, and draws in the dialog’s DIMVARs', async () => {
    const { s, layers, createBitmap } = setup();
    s.renderer.setStyle(LIGHT);
    await s.dimStylePreview(
      { vars: { DIMTXT: 2.5, DIMASZ: 2.5, DIMTXSTY: TEXT, DIMCLRD: 1 } },
      { width: 200, height: 150, dpr: 1 },
      createBitmap,
    );
    const picture = layers.at(-1)!;
    expect(picture.ctx.calls).toContainEqual(['fillStyle', '#ffffff']);
    // DIMCLRD 1: the dimension lines are red; ACI 7 (the plate) draws in the light foreground.
    const strokes = layers.flatMap((l) => l.ctx.calls.filter((c) => c[0] === 'strokeStyle'));
    expect(strokes.map((c) => String(c[1]).toLowerCase())).toEqual(
      expect.arrayContaining(['#ff0000', '#000000']),
    );
  });

  it('shows nothing for a style the drawing lacks or an empty picture', async () => {
    const { s, createBitmap } = setup();
    const size = { width: 200, height: 150, dpr: 1 };
    expect(await s.dimStylePreview({ style: 'Missing' }, size, createBitmap)).toBeUndefined();
    const empty = { width: 0, height: 150, dpr: 1 };
    expect(await s.dimStylePreview({ style: 'ISO-25' }, empty, createBitmap)).toBeUndefined();
  });

  it('is answered through the render worker as on the main thread', async () => {
    vi.stubGlobal('OffscreenCanvas', class {});
    try {
      const bitmaps: CanvasImageSource[] = [];
      const toWorker: ((e: { data: HostMessage }) => void)[] = [];
      const toHost: ((e: { data: WorkerMessage }) => void)[] = [];
      serveRenderer(
        {
          postMessage: (m) => {
            const data = structuredClone(m);
            queueMicrotask(() => toHost.forEach((l) => l({ data })));
          },
          addEventListener: (_type, l) => toWorker.push(l),
        },
        {
          surfaceOf: (canvas) => canvas as Layer,
          createLayer: () => surface('layer'),
          requestIdle: () => undefined,
          createBitmap: (source) => {
            bitmaps.push(source);
            return Promise.resolve({ width: 2 } as unknown as ImageBitmap);
          },
        },
      );
      const worker: RenderWorker = {
        postMessage(m: HostMessage) {
          const data: HostMessage =
            m.type === 'init'
              ? { ...structuredClone({ ...m, canvas: undefined }), canvas: m.canvas }
              : structuredClone(m);
          queueMicrotask(() => toWorker.forEach((l) => l({ data })));
        },
        addEventListener(_type: 'message', l: (e: { data: WorkerMessage }) => void) {
          toHost.push(l);
        },
        terminate() {},
      };
      const visible = surface('visible');
      const canvas: HostCanvas = {
        width: 0,
        height: 0,
        getContext: () => visible.ctx,
        transferControlToOffscreen: () => visible,
      };
      const host = new RendererHost({ canvas, document, createWorker: () => worker, fonts: FONTS });
      expect(host.mode).toBe('worker');
      const size = { width: 100, height: 80, dpr: 1 };
      expect(await host.dimStylePreview({ style: 'Standard' }, size)).toEqual({ width: 2 });
      expect(bitmaps).toHaveLength(1);
      expect(await host.dimStylePreview({ style: 'Missing' }, size)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
