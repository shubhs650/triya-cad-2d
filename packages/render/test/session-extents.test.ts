// M1-35 part 2: ZOOM Extents in the app counts text. The extents the app opened with come from
// the I/O worker, which has no fonts, so text was left out of them (or, in a drawing of text
// alone, the header's $EXTMIN/$EXTMAX stood in). The render session bounds text by its glyphs
// in its spatial index, so it measures the space it draws: text included once its font
// loads, edits and font changes followed, the same through the worker as on the main thread.
import {
  toleranceForSize,
  type EntityInit,
  type MTextGeometry,
  type TextStyleRecord,
} from '@triya/engine';
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
import simplex from '../../../assets/fonts/oet-simplex.json';
import { change, drawing, drawingInit, entity, line, MODEL, surface } from './fixtures';

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

const entities: EntityInit[] = [
  entity('20', line(0, 0, 10, 0)),
  // Text well right of and above the line: only its glyphs reach x = 100 … 140, y = 50 … 60.
  entity('21', {
    kind: 'TEXT',
    value: 'HELLO',
    style: STYLE,
    position: { x: 100, y: 50 },
    height: 10,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
  }),
];

const FONTS: FontSources = { shx: [{ name: 'oet-simplex', source: JSON.stringify(simplex) }] };
const document = {
  init: drawingInit(entities, { textStyles: [style] }),
  block: MODEL,
  tol: toleranceForSize(1000),
};
const STYLE_DARK = { background: '#000000', foreground: '#ffffff', showLineweights: false };

function session(fonts?: FontSources): RenderSession {
  return new RenderSession({
    document,
    surface: surface('visible'),
    createLayer: () => surface('layer'),
    style: STYLE_DARK,
    requestIdle: () => {},
    ...(fonts && { fonts }),
  });
}

/** The text's glyphs: from its insertion point, about five cap-height-wide letters, 10 tall. */
function expectTextIncluded(box: { minX: number; minY: number; maxX: number; maxY: number }) {
  expect(box.minX).toBeCloseTo(0, 6);
  expect(box.minY).toBeCloseTo(0, 6);
  expect(box.maxX).toBeGreaterThan(130);
  expect(box.maxX).toBeLessThan(160);
  expect(box.maxY).toBeCloseTo(60, 0);
}

describe('the render session measures its space (M1-35 part 2)', () => {
  it('counts text by its glyphs once a font serves it, and leaves it out before', () => {
    expect(session().extents()).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
    expectTextIncluded(session(FONTS).extents()!);
  });

  it('follows font changes and edits', () => {
    const s = session(FONTS);
    s.setFonts({ shx: [] });
    expect(s.extents()).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
    const engine = drawing(entities, { textStyles: [style] });
    s.apply(
      change(engine, (b) => b.addEntity({ owner: MODEL, layer: '10', geom: line(-20, -5, 0, 0) })),
    );
    expect(s.extents()).toEqual({ minX: -20, minY: -5, maxX: 10, maxY: 0 });
  });

  it('takes in an unclipped PDF underlay page once the app supplies it (M1-20)', () => {
    const s = new RenderSession({
      document: {
        init: drawingInit([
          entity('20', line(0, 0, 10, 0)),
          entity('22', {
            kind: 'PDFUNDERLAY',
            definition: '9A',
            position: { x: 20, y: 0 },
            scale: { x: 2, y: 2, z: 1 },
            rotation: 0,
            flags: 2, // on, not clipped
            contrast: 100,
            fade: 0,
            clip: [],
          }),
        ]),
        block: MODEL,
        tol: toleranceForSize(1000),
      },
      surface: surface('visible'),
      createLayer: () => surface('layer'),
      requestIdle: () => {},
    });
    // The page's size is only in its PDF: until the app has read it the underlay has no extent.
    expect(s.extents()).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    const region = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    s.setUnderlay('9A', { page: { width: 8.5, height: 11 }, region, pixels });
    expect(s.extents()).toEqual({ minX: 0, minY: 0, maxX: 37, maxY: 22 });
    // Another raster of the same page (a zoom) changes nothing; forgetting the PDF does.
    s.setUnderlay('9A', {
      page: { width: 8.5, height: 11 },
      region: { ...region, maxX: 0.5 },
      pixels,
    });
    expect(s.extents()).toEqual({ minX: 0, minY: 0, maxX: 37, maxY: 22 });
    s.setUnderlay('9A', undefined);
    expect(s.extents()).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
  });

  it('has no extents for a space with nothing of known extent', () => {
    const empty = new RenderSession({
      document: { init: drawingInit([]), block: MODEL, tol: toleranceForSize(1000) },
      surface: surface('visible'),
      createLayer: () => surface('layer'),
      requestIdle: () => {},
    });
    expect(empty.extents()).toBeUndefined();
  });
});

/** A render worker running in-process: messages are cloned and delivered asynchronously. */
function inProcessWorker(): RenderWorker {
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
      createLayer: () => surface('layer'),
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

describe('RendererHost.extents (M1-35 part 2)', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const canvas = (): HostCanvas => {
    const visible = surface('visible');
    return {
      width: 0,
      height: 0,
      getContext: () => visible.ctx,
      transferControlToOffscreen: () => visible,
    };
  };

  it('answers alike from the worker and the main thread, after everything sent before', async () => {
    const main = new RendererHost({
      canvas: canvas(),
      document,
      mode: 'main',
      fonts: FONTS,
      createLayer: () => surface('layer'),
    });
    const off = new RendererHost({
      canvas: canvas(),
      document,
      createWorker: inProcessWorker,
      fonts: FONTS,
    });
    expect(off.mode).toBe('worker');
    for (const h of [main, off]) expectTextIncluded((await h.extents())!);

    // A font change and an edit sent just before are measured: messages are handled in order.
    const engine = drawing(entities, { textStyles: [style] });
    const cs = change(engine, (b) =>
      b.addEntity({ owner: MODEL, layer: '10', geom: line(0, 0, 0, -30) }),
    );
    const answers = [main, off].map((h) => {
      h.setFonts({ shx: [] });
      h.apply(cs);
      return h.extents();
    });
    for (const a of await Promise.all(answers))
      expect(a).toEqual({ minX: 0, minY: -30, maxX: 10, maxY: 0 });
  });

  it('answers undefined from the worker for a space with nothing of known extent', async () => {
    const off = new RendererHost({
      canvas: canvas(),
      document: { init: drawingInit([]), block: MODEL, tol: toleranceForSize(1000) },
      createWorker: inProcessWorker,
    });
    expect(await off.extents()).toBeUndefined();
  });
});

describe('RendererHost.textBox (M2-09)', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const canvas = (): HostCanvas => {
    const visible = surface('visible');
    return {
      width: 0,
      height: 0,
      getContext: () => visible.ctx,
      transferControlToOffscreen: () => visible,
    };
  };
  // MLEADEREDIT asks how far a multileader's text reaches before it is in the drawing.
  const text: MTextGeometry = {
    kind: 'MTEXT',
    contents: 'HELLO',
    style: STYLE,
    position: { x: 100, y: 60 },
    height: 10,
    width: 0,
    rotation: 0,
    attachment: 1,
    direction: 1,
    lineSpacingStyle: 1,
    lineSpacing: 1,
  };

  it('measures an MTEXT by its glyphs, alike from the worker and the main thread', async () => {
    const main = new RendererHost({
      canvas: canvas(),
      document,
      mode: 'main',
      fonts: FONTS,
      createLayer: () => surface('layer'),
    });
    const off = new RendererHost({
      canvas: canvas(),
      document,
      createWorker: inProcessWorker,
      fonts: FONTS,
    });
    for (const h of [main, off]) {
      const box = (await h.textBox(text))!;
      expect(box.minX).toBeCloseTo(100, 0);
      expect(box.maxY).toBeCloseTo(60, 0);
      expect(box.minY).toBeCloseTo(50, 0);
      expect(box.maxX).toBeGreaterThan(130);
      expect(box.maxX).toBeLessThan(160);
    }
  });

  it('answers undefined while no font draws the text', async () => {
    const off = new RendererHost({ canvas: canvas(), document, createWorker: inProcessWorker });
    expect(await off.textBox(text)).toBeUndefined();
    expect(session().textBox(text)).toBeUndefined();
  });
});
