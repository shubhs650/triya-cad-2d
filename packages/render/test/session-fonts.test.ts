// M1-72: the bundled fonts reach the renderer wherever it runs. The app hands a session its
// stroke fonts as the committed JSON sources; the session loads them into a FontBook, so TEXT
// draws (a font the drawing names but nobody has, here romans.shx, through its bundled
// equivalent), and the spatial index bounds text by its glyphs instead of leaving it unknown.
// The worker gets the same sources in its init message and draws the same calls.
import { toleranceForSize, type EntityInit, type TextStyleRecord } from '@triya/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import complex from '../../../assets/fonts/oet-complex.json';
import simplex from '../../../assets/fonts/oet-simplex.json';
import { drawingInit, entity, MODEL, surface } from './fixtures';

type Recorded = ReturnType<typeof surface>;

const STYLE = '30';
const style: TextStyleRecord = {
  handle: STYLE,
  name: 'Standard',
  font: 'romans.shx',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

const text: EntityInit = entity('20', {
  kind: 'TEXT',
  value: 'HELLO',
  style: STYLE,
  position: { x: 0, y: 0 },
  height: 10,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

const FONTS: FontSources = {
  shx: [
    { name: 'oet-simplex', source: JSON.stringify(simplex) },
    { name: 'oet-complex', source: JSON.stringify(complex) },
  ],
};

const document = {
  init: drawingInit([text], { textStyles: [style] }),
  block: MODEL,
  tol: toleranceForSize(1000),
};
const STYLE_DARK = { background: '#000000', foreground: '#ffffff', showLineweights: false };

function session(fonts?: FontSources) {
  const layers: Recorded[] = [];
  const s = new RenderSession({
    document,
    surface: surface('visible'),
    createLayer: () => {
      const l = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(l);
      return l;
    },
    style: STYLE_DARK,
    requestIdle: () => {},
    ...(fonts && { fonts }),
  });
  s.renderer.resize(200, 100, 1);
  s.renderer.setView({ center: { x: 20, y: 5 }, scale: 4 });
  s.renderer.frame();
  return { s, scene: layers[0]! };
}

describe('bundled fonts in a render session (M1-72)', () => {
  it('draws text from the font sources it is given, and nothing without them', () => {
    expect(session().scene.ctx.named('stroke')).toHaveLength(0);
    expect(session(FONTS).scene.ctx.named('lineTo').length).toBeGreaterThan(10);
  });

  it('bounds text by its glyphs in the spatial index', () => {
    const bounds = (s: RenderSession) => s.index.bounds(s.model.ids.idOf('20')!);
    expect(bounds(session().s)).toEqual({ kind: 'unknown' });
    const b = bounds(session(FONTS).s);
    expect(b?.kind).toBe('box');
    if (b?.kind !== 'box') return;
    // HELLO at height 10: about five cap-height-wide letters, from the insertion point up.
    expect(b.box.minX).toBeCloseTo(0, 0);
    expect(b.box.maxX).toBeGreaterThan(30);
    expect(b.box.maxY).toBeCloseTo(10, 0);
  });

  it('reports which bundled font stood in for each font the drawing names', () => {
    expect([...session(FONTS).s.fonts!.substitutions]).toEqual([['romans.shx', 'oet-simplex']]);
  });
});

/** A render worker running in-process: messages are cloned and delivered asynchronously. */
function inProcessWorker(made: Recorded[]): RenderWorker {
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
      surfaceOf: (canvas) => canvas as Recorded,
      createLayer: () => {
        const s = surface('layer');
        made.push(s);
        return s;
      },
      requestIdle: () => undefined,
    },
  );
  return {
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
}

describe('bundled fonts through RendererHost (M1-72)', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands the font sources to the worker as to the main thread', async () => {
    const canvas = (visible: Recorded): HostCanvas => ({
      width: 0,
      height: 0,
      getContext: () => visible.ctx,
      transferControlToOffscreen: () => visible,
    });
    const mainSurfaces: Recorded[] = [surface('visible')];
    const workerSurfaces: Recorded[] = [surface('visible')];
    const main = new RendererHost({
      canvas: canvas(mainSurfaces[0]!),
      document,
      mode: 'main',
      style: STYLE_DARK,
      fonts: FONTS,
      createLayer: () => {
        const s = surface('layer');
        mainSurfaces.push(s);
        return s;
      },
    });
    const off = new RendererHost({
      canvas: canvas(workerSurfaces[0]!),
      document,
      createWorker: () => inProcessWorker(workerSurfaces),
      style: STYLE_DARK,
      fonts: FONTS,
    });
    for (const h of [main, off]) {
      h.resize(200, 100, 1);
      h.setView({ center: { x: 20, y: 5 }, scale: 4 });
      h.frame();
    }
    // Fonts that change while the drawing is open reach the worker too (M1-38).
    for (const h of [main, off]) {
      h.setFonts({ shx: [] });
      h.frame();
    }
    await off.flush();
    const calls = (surfaces: Recorded[]) => surfaces.map((s) => s.ctx.calls);
    expect(
      workerSurfaces.flatMap((s) => s.ctx.calls).filter((c) => c[0] === 'lineTo').length,
    ).toBeGreaterThan(10);
    expect(calls(workerSurfaces)).toEqual(calls(mainSurfaces));
  });
});
