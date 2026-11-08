// RendererHost (M1-12): the worker path and the main-thread fallback run the same RenderSession,
// so the same calls must reach the canvas in the same order. Checked here on a recording context
// with an in-process worker; tests/e2e/fidelity/renderer-host.spec.ts checks real pixels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  toleranceForSize,
  toleranceFromExtents,
  type ChangeSet,
  type EntityGeometry,
} from '@triya/engine';
import {
  RenderSession,
  RendererHost,
  documentTolerance,
  serveRenderer,
  type BitmapFactory,
  type HostCanvas,
  type HostMessage,
  type RenderWorker,
  type UnderlayRaster,
  type UnderlayRequest,
  type WorkerMessage,
} from '../src/index';
import {
  change,
  drawing,
  drawingInit,
  entity,
  LAYER_RED,
  line,
  MODEL,
  PAPER,
  surface,
} from './fixtures';

type Recorded = ReturnType<typeof surface>;

/** A render worker running in-process: messages are cloned and delivered asynchronously. */
function inProcessWorker(
  made: Recorded[],
  createBitmap: BitmapFactory = fakeBitmap,
): RenderWorker & { terminated: boolean } {
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
      createLayer: () => record(made, 'layer'),
      requestIdle: () => undefined,
      createBitmap,
    },
  );
  const w = {
    terminated: false,
    postMessage(m: HostMessage) {
      // The transferred canvas moves as is; everything else is structured-cloned.
      const data: HostMessage =
        m.type === 'init'
          ? { ...structuredClone({ ...m, canvas: undefined }), canvas: m.canvas }
          : structuredClone(m);
      queueMicrotask(() => toWorker.forEach((l) => l({ data })));
    },
    addEventListener(_type: 'message', l: (e: { data: WorkerMessage }) => void) {
      toHost.push(l);
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

/** createImageBitmap stand-in: a clonable record of what was copied, at what size. */
const fakeBitmap = (source: CanvasImageSource, o: ImageBitmapOptions) =>
  Promise.resolve({
    source: (source as unknown as { name: string }).name,
    width: o.resizeWidth,
    height: o.resizeHeight,
  } as unknown as ImageBitmap);

function record(list: Recorded[], name: string): Recorded {
  const s = surface(name);
  list.push(s);
  return s;
}

/** A canvas element stand-in. `transferable` gives it transferControlToOffscreen. */
function canvas(visible: Recorded, transferable: boolean): HostCanvas {
  const c: HostCanvas & { name: string } = {
    name: 'element',
    width: 0,
    height: 0,
    getContext: () => visible.ctx,
  };
  if (transferable) c.transferControlToOffscreen = () => visible;
  return c;
}

const STYLE = { background: '#000000', foreground: '#ffffff', showLineweights: false };

function hosts(entities = [entity('20', line(0, 0, 10, 0))], patterns?: readonly string[]) {
  const asked: { main: UnderlayRequest[]; off: UnderlayRequest[] } = { main: [], off: [] };
  const engine = drawing(entities);
  const document = { init: drawingInit(entities), block: MODEL, tol: toleranceForSize(1000) };
  const mainSurfaces: Recorded[] = [];
  const workerSurfaces: Recorded[] = [];
  const mainVisible = record(mainSurfaces, 'visible');
  const workerVisible = record(workerSurfaces, 'visible');
  const worker = inProcessWorker(workerSurfaces);
  const main = new RendererHost({
    canvas: canvas(mainVisible, true),
    document,
    mode: 'main',
    style: STYLE,
    createLayer: () => record(mainSurfaces, 'layer'),
    createBitmap: fakeBitmap,
    onUnderlayRequest: (r) => asked.main.push(r),
    ...(patterns && { patterns }),
  });
  const errors: Error[] = [];
  const off = new RendererHost({
    canvas: canvas(workerVisible, true),
    document,
    createWorker: () => worker,
    style: STYLE,
    onError: (e) => errors.push(e),
    onUnderlayRequest: (r) => asked.off.push(r),
    ...(patterns && { patterns }),
  });
  return { engine, main, off, worker, mainSurfaces, workerSurfaces, errors, asked };
}

/** Every call each surface received, by surface. */
const log = (surfaces: Recorded[]) => surfaces.map((s) => s.ctx.calls);

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', class {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RendererHost', () => {
  it('picks the worker when it can transfer the canvas, the main thread otherwise', () => {
    const { main, off } = hosts();
    expect(main.mode).toBe('main');
    expect(off.mode).toBe('worker');
    const document = { init: drawingInit([]), block: MODEL };
    const plain = canvas(surface('v'), false);
    const layer = () => surface('l');
    expect(new RendererHost({ canvas: plain, document, createLayer: layer }).mode).toBe('main');
    expect(
      new RendererHost({
        canvas: plain,
        document,
        createLayer: layer,
        createWorker: () => inProcessWorker([]),
      }).mode,
    ).toBe('main');
    expect(() => new RendererHost({ canvas: plain, document, mode: 'worker' })).toThrow(
      /createWorker and OffscreenCanvas/,
    );
    vi.unstubAllGlobals();
    expect(RendererHost.canUseWorker(canvas(surface('v'), true), () => inProcessWorker([]))).toBe(
      false,
    );
  });

  it('draws the same calls on the worker as on the main thread', async () => {
    const { engine, main, off, mainSurfaces, workerSurfaces } = hosts();
    const circle = change(engine, (b) =>
      b.addEntity(entity('21', { kind: 'CIRCLE', center: { x: 5, y: 1 }, radius: 2 })),
    );
    const moved = change(engine, (b) =>
      b.updateEntity(engine.model.ids.idOf('20')!, { geom: line(0, 0, 10, 3) }),
    );
    const hidden = change(engine, (b) => b.updateTableRecord('layers', LAYER_RED, { on: false }));
    const gone = change(engine, (b) => b.removeEntity(engine.model.ids.idOf('20')!));
    for (const h of [main, off]) {
      h.resize(100, 50, 2);
      h.setView({ center: { x: 5, y: 0 }, scale: 10 });
      h.frame();
      h.apply(circle);
      h.apply(moved);
      h.setTransient([{ kind: 'point', x: 1, y: 1, color: '#ff0000' }]);
      h.setStyle({ ...STYLE, showLineweights: true });
      h.frame();
      h.apply(hidden);
      h.apply(gone);
      h.frame();
    }
    await off.flush();
    await main.flush();
    expect(log(workerSurfaces).flat().length).toBeGreaterThan(20);
    expect(log(workerSurfaces)).toEqual(log(mainSurfaces));
    expect(workerSurfaces[0]!.canvas).toEqual({ width: 200, height: 100 });
  });

  it('copies the last frame as a thumbnail on the worker as on the main thread (M1-22)', async () => {
    const { main, off } = hosts();
    // Never sized: nothing to copy.
    expect(await main.thumbnail({ width: 160, height: 120 })).toBeUndefined();
    expect(await off.thumbnail({ width: 160, height: 120 })).toBeUndefined();
    for (const h of [main, off]) {
      h.resize(400, 150, 2);
      h.setView({ center: { x: 5, y: 0 }, scale: 10 });
      h.frame();
    }
    // An 800 × 300 canvas fits 160 × 120 at 160 × 60. The worker copies the canvas it was
    // handed (the recorded 'visible' surface); the main thread copies the canvas element.
    const size = { width: 160, height: 60 };
    expect(await main.thumbnail({ width: 160, height: 120 })).toEqual({
      source: 'element',
      ...size,
    });
    expect(await off.thumbnail({ width: 160, height: 120 })).toEqual({
      source: 'visible',
      ...size,
    });
  });

  it('reports a thumbnail the worker could not take to its caller', async () => {
    const worker = inProcessWorker([], () => Promise.reject(new Error('no bitmap')));
    const off = new RendererHost({
      canvas: canvas(surface('visible'), true),
      document: { init: drawingInit([]), block: MODEL },
      createWorker: () => worker,
    });
    off.resize(10, 10, 1);
    await expect(off.thumbnail({ width: 5, height: 5 })).rejects.toThrow(/no bitmap/);
  });

  it('hands user hatch patterns to the worker as to the main thread (M1-50)', async () => {
    // A custom-pattern hatch stored without its lines: drawn only from a user .pat.
    const square = [
      { x: 0, y: 0, bulge: 0 },
      { x: 4, y: 0, bulge: 0 },
      { x: 4, y: 4, bulge: 0 },
      { x: 0, y: 4, bulge: 0 },
    ];
    const hatch = entity('20', {
      kind: 'HATCH',
      pattern: 'MY_LINES',
      solid: false,
      associative: false,
      style: 0,
      patternType: 2,
      patternAngle: 0,
      patternScale: 1,
      double: false,
      seedPoints: [],
      loops: [{ flags: 2, polyline: { closed: true, vertices: square } }],
      patternLines: [],
    });
    const { main, off, mainSurfaces, workerSurfaces } = hosts(
      [hatch],
      ['*MY_LINES\n0, 0,0, 0,1\n'],
    );
    for (const h of [main, off]) {
      h.resize(100, 100, 1);
      h.setView({ center: { x: 2, y: 2 }, scale: 20 });
      h.frame();
      h.setPatterns(['*MY_LINES\n90, 0,0, 0,1\n']);
      h.frame();
    }
    await off.flush();
    const strokes = (surfaces: Recorded[]) =>
      surfaces.flatMap((s) => s.ctx.calls).filter((c) => c[0] === 'stroke');
    expect(strokes(workerSurfaces)).toHaveLength(2);
    expect(log(workerSurfaces)).toEqual(log(mainSurfaces));
  });

  it('draws an image bitmap sent to either side alike, its buffer transferred to the worker', async () => {
    const photo: EntityGeometry = {
      kind: 'IMAGE',
      definition: '7F',
      position: { x: 0, y: 0 },
      u: { x: 1, y: 0 },
      v: { x: 0, y: 1 },
      size: { x: 2, y: 1 },
      displayFlags: 7,
      clipping: false,
      brightness: 50,
      contrast: 50,
      fade: 0,
      clip: { type: 'rectangle', vertices: [], inverted: false },
    };
    const { main, off, worker, mainSurfaces, workerSurfaces } = hosts([entity('20', photo)]);
    const transfers: unknown[][] = [];
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (m: HostMessage, transfer?: Transferable[]) => {
      if (m.type === 'image') transfers.push(transfer ?? []);
      post(m);
    };
    const pixels = () => ({ width: 2, height: 1, data: new Uint8ClampedArray(8).fill(200) });
    for (const h of [main, off]) {
      h.resize(100, 50, 1);
      h.setView({ center: { x: 1, y: 0.5 }, scale: 10 });
      h.frame();
      const sent = pixels();
      h.setImage('7F', sent);
      h.frame();
      h.setImage('7F', undefined);
      h.frame();
    }
    await off.flush();
    await main.flush();
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toHaveLength(1);
    expect(transfers[0]![0]).toBeInstanceOf(ArrayBuffer);
    expect(transfers[1]).toEqual([]);
    expect(log(workerSurfaces)).toEqual(log(mainSurfaces));
    // The bitmap's own layer is drawn once, in the frame after it arrived.
    const putImages = mainSurfaces.flatMap((sf) => sf.ctx.named('putImageData'));
    expect(putImages).toHaveLength(1);
    // The scene layer (after the visible surface) draws the bitmap in that frame only; once
    // forgotten the image is outlined instead.
    expect(mainSurfaces[1]!.ctx.named('drawImage')).toHaveLength(1);
  });

  it('asks for a PDF underlay page from either side alike and draws the page sent (M1-20)', async () => {
    const plan: EntityGeometry = {
      kind: 'PDFUNDERLAY',
      definition: '9A',
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      flags: 2,
      contrast: 100,
      fade: 0,
      clip: [],
    };
    const { main, off, mainSurfaces, workerSurfaces, asked } = hosts([entity('20', plan)]);
    const page = (): UnderlayRaster => ({
      page: { width: 2, height: 1 },
      region: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      pixels: { width: 40, height: 20, data: new Uint8ClampedArray(3200).fill(90) },
    });
    for (const h of [main, off]) {
      h.resize(100, 50, 1);
      h.setView({ center: { x: 1, y: 0.5 }, scale: 10 });
      h.frame();
      const sent = page();
      h.setUnderlay('9A', sent);
      h.frame();
      // The app keeps its pages cached: nothing it sent is detached.
      expect(sent.pixels.data.length).toBe(3200);
    }
    await off.flush();
    await main.flush();
    expect(asked.main).toHaveLength(1);
    expect(asked.off).toEqual(asked.main);
    expect(log(workerSurfaces)).toEqual(log(mainSurfaces));
    expect(mainSurfaces[1]!.ctx.named('drawImage')).toHaveLength(1);
  });

  it('answers hit tests from either side alike', async () => {
    const { main, off } = hosts([entity('20', line(0, 0, 10, 0)), entity('21', line(0, 1, 10, 1))]);
    for (const h of [main, off]) {
      h.resize(100, 50, 1);
      h.setView({ center: { x: 5, y: 0 }, scale: 10 });
    }
    const at = { x: 50, y: 22 };
    const fromMain = await main.hitTest(at, 8);
    expect(fromMain.length).toBe(2);
    expect(await off.hitTest(at, 8)).toEqual(fromMain);
  });

  it('names the entities in a screen rectangle from either side alike (M1-106)', async () => {
    const { main, off } = hosts([entity('20', line(0, 0, 10, 0)), entity('21', line(0, 1, 10, 1))]);
    for (const h of [main, off]) {
      h.resize(100, 50, 1);
      h.setView({ center: { x: 5, y: 0 }, scale: 10 });
    }
    const rect = { x: 0, y: 20, width: 100, height: 10 };
    const fromMain = await main.entitiesIn(rect);
    expect(fromMain).toEqual([{ handle: '20', type: 'LINE' }]);
    expect(await off.entitiesIn(rect)).toEqual(fromMain);
  });

  it('reports a replica that fell out of step', async () => {
    const { engine, main, off, errors } = hosts();
    const real = change(engine, (b) => b.addEntity(entity('21', line(0, 0, 1, 1))));
    const added = real.entities!.added![0]!;
    const wrong: ChangeSet = {
      entities: { added: [{ ...added, entity: { ...added.entity, id: 99 } }] },
    };
    expect(() => main.apply(wrong)).toThrow(
      /out of step: handle \w+ is id 2 here, 99 in the engine/,
    );
    off.apply(wrong);
    await off.flush();
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/^render worker: render replica out of step/),
    ]);
  });

  it('rejects pending requests when disposed', async () => {
    const { off, worker } = hosts();
    const pending = off.flush();
    off.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(worker.terminated).toBe(true);
  });
});

describe('render worker loop', () => {
  it('answers a request sent before init with an error for that request', async () => {
    const sent: WorkerMessage[] = [];
    let deliver: (m: HostMessage) => void = () => undefined;
    serveRenderer(
      {
        postMessage: (m) => sent.push(m),
        addEventListener: (_t, l) => {
          deliver = (data) => l({ data });
        },
      },
      { surfaceOf: () => surface('v'), createLayer: () => surface('l') },
    );
    deliver({ type: 'frame' });
    deliver({ type: 'flush', id: 7 });
    expect(sent).toEqual([
      { type: 'error', message: "render worker got 'frame' before 'init'" },
      { type: 'error', message: "render worker got 'flush' before 'init'", id: 7 },
    ]);
  });
});

describe('RenderSession', () => {
  it('builds a replica whose ids match the engine, change for change', () => {
    const entities = [entity('20', line(0, 0, 10, 0))];
    const engine = drawing(entities);
    const s = new RenderSession({
      document: { init: drawingInit(entities), block: MODEL },
      surface: surface('v'),
      createLayer: () => surface('l'),
    });
    const handles: string[] = ['20'];
    const cs = change(engine, (b) => {
      handles.push(b.addEntity(entity('22', line(0, 0, 2, 2))).handle);
      handles.push(b.addEntity(entity('21', line(0, 0, 1, 1))).handle);
    });
    s.apply(cs);
    for (const h of handles) expect(s.model.ids.idOf(h)).toBe(engine.model.ids.idOf(h));
    const last = engine.model.ids.idOf(handles[2]!)!;
    expect(s.index.bounds(last)).toEqual(engine.index.bounds(last));
  });

  it('applies a layout change set that crossed a postMessage (M1-97)', () => {
    const engine = drawing([]);
    const s = new RenderSession({
      document: { init: drawingInit([]), block: PAPER },
      surface: surface('v'),
      createLayer: () => surface('l'),
    });
    const cs = change(engine, (b) => b.updateLayout('AB', { name: 'Plan', tabOrder: 1 }));
    s.apply(structuredClone(cs));
    expect(s.model.layouts.map((l) => l.name)).toEqual(['Model', 'Plan']);
  });

  it('applies a block definition change set that crossed a postMessage (M1-75)', () => {
    const engine = drawing([]);
    const s = new RenderSession({
      document: { init: drawingInit([]), block: MODEL },
      surface: surface('v'),
      createLayer: () => surface('l'),
    });
    let block = '';
    const cs = change(engine, (b) => {
      block = b.addBlock({ name: 'DOOR', basePoint: { x: 0, y: 0 } }).handle;
      b.updateBlock(MODEL, { basePoint: { x: 1, y: 1 } });
    });
    s.apply(structuredClone(cs));
    expect(s.model.blocks.get(block)?.name).toBe('DOOR');
    expect(s.model.blocks.get(MODEL)?.basePoint).toEqual({ x: 1, y: 1 });
  });

  it('takes its tolerance from the header extents', () => {
    const init = drawingInit([]);
    expect(documentTolerance(init)).toEqual(toleranceForSize(1));
    const header = new Map([
      ['$EXTMIN', { x: -5000, y: 0, z: 0 }],
      ['$EXTMAX', { x: 20, y: 30, z: 0 }],
    ]);
    expect(documentTolerance({ ...init, header })).toEqual(
      toleranceFromExtents({ x: -5000, y: 0 }, { x: 20, y: 30 }),
    );
  });
});
