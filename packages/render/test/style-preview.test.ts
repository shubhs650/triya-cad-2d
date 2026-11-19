// M4-14: the Text Style and Multileader Style dialogs' preview images, drawn as the Dimension
// Style Manager's (M4-03 part 3): the engine's sample drawing on a layer of its own the size of
// the dialog's picture, fitted, on the canvas background, handed over as a bitmap; through the
// worker as on the main thread.
import {
  mleaderStyleSettings,
  standardMLeaderStyle,
  textStyleSettings,
  toleranceForSize,
  type StylePreview,
  type TextStyleRecord,
} from '@triya/engine';
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
const FONTS: FontSources = { shx: [{ name: 'oet-simplex', source: JSON.stringify(simplex) }] };
const document = {
  init: drawingInit([entity('20', line(0, 0, 1000, 0))], { textStyles: [textStyle] }),
  block: MODEL,
  tol: toleranceForSize(1000),
};
const DARK = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const LIGHT = { background: '#ffffff', foreground: '#000000', showLineweights: false };

const TEXT_PREVIEW: StylePreview = { kind: 'textstyle', settings: textStyleSettings(textStyle) };
const MLEADER_PREVIEW: StylePreview = {
  kind: 'mleaderstyle',
  settings: {
    ...mleaderStyleSettings({ handle: '', ...standardMLeaderStyle(true, TEXT) }),
    lineColor: 'aci:1',
  },
};

type Layer = ReturnType<typeof surface>;

function setup() {
  const layers: Layer[] = [];
  const s = new RenderSession({
    now: () => 0,
    document,
    surface: surface('visible'),
    createLayer: () => {
      const l = surface(`layer${layers.length}`);
      layers.push(l);
      return l;
    },
    style: DARK,
    requestIdle: () => {},
    fonts: FONTS,
  });
  const bitmaps: CanvasImageSource[] = [];
  const createBitmap = (source: CanvasImageSource) => {
    bitmaps.push(source);
    return Promise.resolve({ width: 1 } as unknown as ImageBitmap);
  };
  return { s, layers, bitmaps, createBitmap };
}

const count = (layers: readonly Layer[], name: string) =>
  layers.reduce((n, l) => n + l.ctx.calls.filter((c) => c[0] === name).length, 0);

describe('text and multileader style preview images (M4-14)', () => {
  it('draws the text style’s sample fitted in the picture on the canvas background', async () => {
    const { s, layers, bitmaps, createBitmap } = setup();
    const before = layers.length;
    const size = { width: 240, height: 80, dpr: 2 };
    expect(await s.stylePreview(TEXT_PREVIEW, size, createBitmap)).toBeDefined();
    const made = layers.slice(before);
    const picture = made.at(-1)!;
    expect(bitmaps).toEqual([picture.image]);
    expect(picture.canvas).toEqual({ width: 480, height: 160 });
    expect(picture.ctx.calls).toContainEqual(['fillStyle', '#000000']);
    // "AaBb123" stroked in the SHX font: many strokes.
    expect(count(made, 'moveTo')).toBeGreaterThanOrEqual(10);
  });

  it('draws the multileader in the dialog’s colour, its arrowhead filled, on a light canvas', async () => {
    const { s, layers, createBitmap } = setup();
    s.renderer.setStyle(LIGHT);
    const before = layers.length;
    await s.stylePreview(MLEADER_PREVIEW, { width: 200, height: 150, dpr: 1 }, createBitmap);
    const made = layers.slice(before);
    expect(made.at(-1)!.ctx.calls).toContainEqual(['fillStyle', '#ffffff']);
    const strokes = made.flatMap((l) => l.ctx.calls.filter((c) => c[0] === 'strokeStyle'));
    expect(strokes.map((c) => String(c[1]).toLowerCase())).toContain('#ff0000');
    expect(count(made, 'fill')).toBeGreaterThanOrEqual(1);
  });

  it('shows nothing for an empty picture or a multileader style without a text style', async () => {
    const { s, createBitmap } = setup();
    expect(
      await s.stylePreview(TEXT_PREVIEW, { width: 0, height: 10, dpr: 1 }, createBitmap),
    ).toBeUndefined();
    const none: StylePreview = {
      kind: 'mleaderstyle',
      settings: { ...MLEADER_PREVIEW.settings, textStyle: 'FFFF' } as never,
    };
    expect(
      await s.stylePreview(none, { width: 100, height: 80, dpr: 1 }, createBitmap),
    ).toBeUndefined();
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
      expect(await host.stylePreview(MLEADER_PREVIEW, size)).toEqual({ width: 2 });
      expect(await host.stylePreview(TEXT_PREVIEW, size)).toEqual({ width: 2 });
      expect(bitmaps).toHaveLength(2);
      expect(await host.stylePreview(TEXT_PREVIEW, { ...size, width: 0 })).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
