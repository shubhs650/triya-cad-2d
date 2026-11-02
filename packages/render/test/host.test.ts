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
  type HostCanvas,
  type HostMessage,
  type RenderWorker,
  type WorkerMessage,
} from '../src/index';
import { change, drawing, drawingInit, entity, LAYER_RED, line, MODEL, surface } from './fixtures';

type Recorded = ReturnType<typeof surface>;

/** A render worker running in-process: messages are cloned and delivered asynchronously. */
function inProcessWorker(made: Recorded[]): RenderWorker & { terminated: boolean } {
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

function record(list: Recorded[], name: string): Recorded {
  const s = surface(name);
  list.push(s);
  return s;
}

/** A canvas element stand-in. `transferable` gives it transferControlToOffscreen. */
function canvas(visible: Recorded, transferable: boolean): HostCanvas {
  const c: HostCanvas = {
    width: 0,
    height: 0,
    getContext: () => visible.ctx,
  };
  if (transferable) c.transferControlToOffscreen = () => visible;
  return c;
}

const STYLE = { background: '#000000', foreground: '#ffffff', showLineweights: false };

function hosts(entities = [entity('20', line(0, 0, 10, 0))]) {
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
  });
  const errors: Error[] = [];
  const off = new RendererHost({
    canvas: canvas(workerVisible, true),
    document,
    createWorker: () => worker,
    style: STYLE,
    onError: (e) => errors.push(e),
  });
  return { engine, main, off, worker, mainSurfaces, workerSurfaces, errors };
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
