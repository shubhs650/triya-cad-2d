// M1-67: the engine host. The app talks to each drawing's engine session through it, in the
// engine worker or (where no worker is given) on the main thread; both answer alike, and a
// change set that crossed the worker boundary still applies to a render replica.
import { DocumentModel, type CommandOutput, type DocumentInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Engines } from '../src/engine/engines';
import { EngineHost, type EngineWorker } from '../src/engine/host';
import type { EngineReply, EngineRequest } from '../src/engine/protocol';
import { serveEngine } from '../src/engine/serve';

const init: DocumentInit = {
  meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
  handSeed: '40',
  header: [['$CLAYER', 'WALLS']],
  tables: {
    layers: ['0', 'WALLS'].map((name, i) => ({
      handle: String(10 + i),
      name,
      color: { kind: 'aci', index: 7 },
      linetype: '14',
      lineweight: 'Default',
      transparency: { alpha: 255 },
      plot: true,
      on: true,
      frozen: false,
      locked: false,
    })),
    blockRecords: [
      { handle: '1F', name: '*Model_Space', units: 0, explodable: true, scalable: true },
    ],
  },
  blocks: [{ handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
};

/** Resolves once the host has said `n` things about commands. */
function outputs(host: { onCommand(l: (o: CommandOutput) => void): () => void }, n: number) {
  const got: CommandOutput[] = [];
  return {
    got,
    done: new Promise<CommandOutput[]>((resolve) => {
      host.onCommand((o) => {
        got.push(o);
        if (got.length === n) resolve(got);
      });
    }),
  };
}

/** An engine worker running in-process: messages are cloned and delivered asynchronously. */
function inProcessWorker(): EngineWorker & { terminated: boolean } {
  const toWorker: ((e: { data: EngineRequest }) => void)[] = [];
  const toHost: ((e: { data: EngineReply }) => void)[] = [];
  serveEngine({
    postMessage: (m) => {
      const data = structuredClone(m);
      queueMicrotask(() => toHost.forEach((l) => l({ data })));
    },
    addEventListener: (_type, l) => toWorker.push(l),
  });
  const w = {
    terminated: false,
    postMessage(m: EngineRequest, transfer: Transferable[] = []) {
      // A renderer's change port (M2-62) is transferred, as the browser does.
      const data = structuredClone(m, { transfer });
      queueMicrotask(() => toWorker.forEach((l) => l({ data })));
    },
    addEventListener(_type: 'message', l: (e: { data: EngineReply }) => void) {
      toHost.push(l);
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

describe('EngineHost', () => {
  it('runs the session in the worker or on the main thread, answering alike', async () => {
    const worker = inProcessWorker();
    const off = new EngineHost(init, () => worker);
    const main = new EngineHost(init);
    expect([off.mode, main.mode]).toEqual(['worker', 'main']);
    const edit = { kind: 'layer', layer: '10', on: false } as const;
    const [a, b] = await Promise.all([off.edit(edit), main.edit(edit)]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });

  it('returns change sets a render replica applies', async () => {
    const host = new EngineHost(init, inProcessWorker);
    const replica = DocumentModel.create(init);
    const r = await host.edit({ kind: 'layer', layer: '10', locked: true });
    if (!r.ok) throw new Error(r.message);
    // As RenderSession does: swap the cloned `before` for the replica's own record.
    const own = replica.tables.layers.get('10')!;
    const updated = r.change.tables!.layers!.updated!.map((u) => ({ ...u, before: own }));
    replica.apply({ tables: { layers: { updated } } });
    expect(replica.tables.layers.get('10')?.locked).toBe(true);
  });

  it('passes refusals back', async () => {
    const host = new EngineHost(init, inProcessWorker);
    expect(await host.edit({ kind: 'layer', layer: '11', frozen: true })).toEqual({
      ok: false,
      message: 'Cannot freeze the current layer.',
    });
  });

  it('runs commands in the worker or on the main thread, reporting alike (M2-02)', async () => {
    const off = new EngineHost(init, inProcessWorker);
    const main = new EngineHost(init);
    const script = ['L', '0,0', '@100<45', ''];
    const results = await Promise.all(
      [off, main].map((host) => {
        // L: start, prompt; each point: log, (change,) prompt; Enter: log, end, commit, idle.
        const o = outputs(host, 12);
        for (const text of script) host.command({ kind: 'submit', text });
        return o.done;
      }),
    );
    expect(results[0]).toEqual(results[1]);
    const change = results[0]!.find((o) => o.type === 'change');
    expect(change?.type === 'change' && change.change.entities?.added?.[0]?.entity.type).toBe(
      'LINE',
    );
  });

  it('ignores command input once disposed', async () => {
    const main = new EngineHost(init);
    const heard: CommandOutput[] = [];
    main.onCommand((o) => heard.push(o));
    main.dispose();
    main.command({ kind: 'submit', text: 'L' });
    await new Promise((r) => setTimeout(r, 0));
    expect(heard).toEqual([]);
  });

  it('answers in order and rejects what is pending when disposed', async () => {
    const worker = inProcessWorker();
    const host = new EngineHost(init, () => worker);
    const first = host.edit({ kind: 'layer', layer: '10', on: false });
    const second = host.edit({ kind: 'layer', layer: '10', on: true });
    expect((await first).ok && (await second).ok).toBe(true);
    const pending = host.edit({ kind: 'layer', layer: '10', on: false });
    host.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(worker.terminated).toBe(true);
  });
});

describe('Engines', () => {
  const setup = () => {
    const applied: { doc: number; change: unknown }[] = [];
    const engines = new Engines(
      (i, changes) => new EngineHost(i, undefined, changes),
      (doc) => [{ apply: (change) => applied.push({ doc, change }) }],
    );
    return { engines, applied };
  };

  it('sends each applied change to every canvas of the drawing and logs it', async () => {
    const { engines, applied } = setup();
    engines.start(1, init);
    engines.start(2, init);
    const r = await engines.edit(1, { kind: 'layer', layer: '10', on: false });
    expect(r.ok).toBe(true);
    expect(applied.map((a) => a.doc)).toEqual([1]);
    expect(engines.changesOf(1)).toHaveLength(1);
    expect(engines.changesOf(2)).toEqual([]);
  });

  it('neither logs nor sends refusals and no-op edits', async () => {
    const { engines, applied } = setup();
    engines.start(1, init);
    await engines.edit(1, { kind: 'layer', layer: '11', frozen: true });
    await engines.edit(1, { kind: 'layer', layer: '10', on: true });
    expect(applied).toEqual([]);
    expect(engines.changesOf(1)).toEqual([]);
  });

  it("logs a command's edits and sends them to the drawing's canvases first", async () => {
    const { engines, applied } = setup();
    engines.start(1, init);
    const heard: { doc: number; type: string; logged: number }[] = [];
    const stop = engines.onCommand((doc, o) =>
      heard.push({ doc, type: o.type, logged: engines.changesOf(doc).length }),
    );
    engines.command(1, { kind: 'submit', text: 'L' });
    engines.command(1, { kind: 'submit', text: '0,0' });
    engines.command(1, { kind: 'submit', text: '10,0' });
    engines.command(2, { kind: 'submit', text: 'L' });
    await new Promise((r) => setTimeout(r, 0));
    const change = heard.find((h) => h.type === 'change');
    expect(change).toEqual({ doc: 1, type: 'change', logged: 1 });
    expect(applied.map((a) => a.doc)).toEqual([1]);
    stop();
    engines.stop(1);
  });

  it('holds input back behind a click still waiting for its point (M2-04)', async () => {
    const { engines } = setup();
    engines.start(1, init);
    const lines: string[] = [];
    const stop = engines.onCommand((_, o) => {
      if (o.type === 'log') lines.push(o.line);
    });
    let resolve!: (p: { x: number; y: number }) => void;
    const point = new Promise<{ x: number; y: number }>((r) => (resolve = r));
    engines.command(1, { kind: 'submit', text: 'L' });
    engines.command(1, { kind: 'submit', text: '0,0' });
    // The click's object snap is still being worked out when Enter is typed.
    engines.command(
      1,
      point.then((p) => ({ kind: 'pick', point: p })),
    );
    engines.command(1, { kind: 'submit', text: '' });
    // An input worked out to nothing is dropped.
    engines.command(1, Promise.resolve(undefined));
    await new Promise((r) => setTimeout(r, 0));
    expect(engines.changesOf(1)).toEqual([]);
    resolve({ x: 10, y: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(engines.changesOf(1)).toHaveLength(1);
    expect(lines.at(-1)).toBe('Specify next point or [Undo]:');
    stop();
    engines.stop(1);
  });

  it('forgets a closed drawing', async () => {
    const { engines } = setup();
    engines.start(1, init);
    await engines.edit(1, { kind: 'layer', layer: '10', on: false });
    engines.stop(1);
    expect(engines.changesOf(1)).toEqual([]);
    expect(await engines.edit(1, { kind: 'layer', layer: '10', on: true })).toEqual({
      ok: false,
      message: 'The drawing is not open.',
    });
  });

  it('starts a recovered drawing from its change log (M2-14)', async () => {
    const live = setup();
    live.engines.start(1, init);
    await live.engines.edit(1, { kind: 'layer', layer: '10', on: false });
    const log = structuredClone([...live.engines.changesOf(1)]);
    const { engines, applied } = setup();
    engines.start(7, init, log);
    // Canvases made later replay the log; the engine already holds it, so a second edit
    // to the same layer is a no-op and turning it back on is not.
    expect(engines.changesOf(7)).toEqual(log);
    await engines.edit(7, { kind: 'layer', layer: '10', on: false });
    expect(applied).toEqual([]);
    expect((await engines.edit(7, { kind: 'layer', layer: '10', on: true })).ok).toBe(true);
    expect(engines.changesOf(7)).toHaveLength(2);
  });
});

describe('EngineHost restoring a drawing (M2-14)', () => {
  it('replays the change log in the worker and on the main thread alike', async () => {
    const first = new EngineHost(init);
    const r = await first.edit({ kind: 'layer', layer: '10', locked: true });
    expect(r.ok).toBe(true);
    const log = r.ok ? [structuredClone(r.change)] : [];
    for (const host of [
      new EngineHost(init, inProcessWorker, log),
      new EngineHost(init, undefined, log),
    ]) {
      // Locked already: locking again changes nothing.
      const again = await host.edit({ kind: 'layer', layer: '10', locked: true });
      expect(again).toEqual({ ok: true, change: {} });
      host.dispose();
    }
  });
});

describe('EngineHost blocklessDimensionBlocks (M2-30 part 2)', () => {
  /** The drawing with a DIMSTYLE and a linear dimension whose block is missing. */
  const withDimension: DocumentInit = {
    ...init,
    tables: {
      ...init.tables,
      dimStyles: [{ handle: '27', name: 'Standard', vars: {} }],
    },
    entities: [
      {
        handle: '30',
        owner: '1F',
        type: 'DIMENSION',
        layer: '10',
        color: { kind: 'byLayer' },
        linetype: 'ByLayer',
        lineweight: 'ByLayer',
        ltScale: 1,
        visible: true,
        transparency: 'ByLayer',
        geom: {
          kind: 'DIMENSION',
          dimType: 'linear',
          style: '27',
          first: { x: 0, y: 0 },
          second: { x: 10, y: 0 },
          definitionPoint: { x: 10, y: 5 },
          textPosition: { x: 5, y: 5 },
          textUserPositioned: false,
          text: '',
          textRotation: 0,
          horizontalDirection: 0,
          attachment: 5,
          lineSpacingStyle: 1,
          lineSpacing: 1,
          rotation: 0,
        },
      } as never,
    ],
  };

  it('draws the blocks with the canvas’s widths, in the worker or on the main thread', async () => {
    for (const host of [
      new EngineHost(withDimension, inProcessWorker),
      new EngineHost(withDimension),
    ]) {
      // The canvas measures each character 0.1 wide.
      host.onCommand((o) => {
        if (o.type !== 'view' || o.request.op !== 'textWidths') return;
        const widths = o.request.texts.map((t) => t.contents.length * 0.1);
        host.command({ kind: 'view', id: o.id, reply: { ok: true, widths } });
      });
      const change = await host.blocklessDimensionBlocks();
      expect(change?.blocks?.added?.map((b) => b.name)).toEqual(['*D1']);
      const dim = change?.entities?.updated?.[0]?.after;
      expect(dim?.handle).toBe('30');
      expect(change?.entities?.added?.some((p) => p.entity.geom.kind === 'MTEXT')).toBe(true);
      // The drawing itself keeps the dimension without a block: a second save draws it again.
      expect((await host.blocklessDimensionBlocks())?.blocks?.added).toHaveLength(1);
      host.dispose();
    }
  });

  it('is undefined for a drawing whose dimensions all have blocks', async () => {
    const host = new EngineHost(init, inProcessWorker);
    expect(await host.blocklessDimensionBlocks()).toBeUndefined();
    host.dispose();
  });
});

describe('EngineHost paperViews (M2-47 part 1)', () => {
  /** The drawing with a layout never shown, so without a paper-space viewport. */
  const withLayout: DocumentInit = {
    ...init,
    tables: {
      ...init.tables,
      blockRecords: [
        ...(init.tables?.blockRecords ?? []),
        { handle: '1B', name: '*Paper_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [
      ...(init.blocks ?? []),
      { handle: '1B', name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' },
      { handle: '1E', name: 'Layout1', tabOrder: 1, blockRecord: '1B' },
    ],
  };
  const view = { center: { x: 100, y: 80 }, height: 50, width: 75 };

  it('gives the layout its viewport for the saved file only, in the worker or on the main thread', async () => {
    for (const host of [new EngineHost(withLayout, inProcessWorker), new EngineHost(withLayout)]) {
      const change = await host.paperViews([{ block: '1B', view }]);
      const added = change?.entities?.added?.map((p) => p.entity);
      expect(added?.map((e) => [e.owner, e.geom.kind])).toEqual([['1B', 'VIEWPORT']]);
      expect(added?.[0]?.geom).toMatchObject({ id: 1, viewCenter: view.center, viewHeight: 50 });
      // Not applied to the drawing: a second save makes it again, under a handle of its own.
      const again = await host.paperViews([{ block: '1B', view }]);
      expect(again?.entities?.added?.[0]?.entity.handle).not.toBe(added?.[0]?.handle);
      host.dispose();
    }
  });

  it('is undefined with no layout shown', async () => {
    const host = new EngineHost(withLayout, inProcessWorker);
    expect(await host.paperViews([])).toBeUndefined();
    host.dispose();
  });
});

describe('EngineHost purgeHealth (M5-09 part 3)', () => {
  /** The sample with an unused layer and a zero-length line. */
  const withUnused: DocumentInit = {
    ...init,
    tables: {
      ...init.tables,
      layers: [
        ...(init.tables?.layers ?? []),
        { ...init.tables!.layers![0]!, handle: '12', name: 'OLD' },
      ],
    },
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    entities: [
      {
        handle: '30',
        owner: '1F',
        type: 'LINE',
        layer: '11',
        color: { kind: 'byLayer' },
        linetype: 'ByLayer',
        lineweight: 'ByLayer',
        transparency: 'ByLayer',
        ltScale: 1,
        visible: true,
        geom: { kind: 'LINE', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } },
      },
    ],
  };

  it('counts what PURGE would take, in the worker or on the main thread, and follows the fixes', async () => {
    for (const host of [new EngineHost(withUnused, inProcessWorker), new EngineHost(withUnused)]) {
      expect(await host.purgeHealth()).toEqual({
        unused: [{ category: 'layers', title: 'Layers', count: 1 }],
        nested: 0,
        zeroLength: 1,
        emptyText: 0,
        orphaned: 0,
      });
      expect((await host.edit({ kind: 'purge', what: 'unused' })).ok).toBe(true);
      expect((await host.edit({ kind: 'purge', what: 'zero-length' })).ok).toBe(true);
      expect(await host.purgeHealth()).toMatchObject({ unused: [], zeroLength: 0 });
      host.dispose();
    }
  });

  it('is undefined for a drawing not open', async () => {
    const engines = new Engines(
      (i) => new EngineHost(i),
      () => [],
    );
    expect(await engines.purgeHealth(7)).toBeUndefined();
    engines.start(7, withUnused);
    expect((await engines.purgeHealth(7))?.zeroLength).toBe(1);
  });
});

describe('EngineHost healthChecks (M8-07)', () => {
  /** The sample, unitless, with line 30 drawn twice. */
  const line = (handle: string) => ({
    handle,
    owner: '1F',
    type: 'LINE' as const,
    layer: '11',
    color: { kind: 'byLayer' as const },
    linetype: 'ByLayer',
    lineweight: 'ByLayer' as const,
    transparency: 'ByLayer' as const,
    ltScale: 1,
    visible: true,
    geom: { kind: 'LINE' as const, start: { x: 1, y: 1 }, end: { x: 5, y: 1 } },
  });
  const twice: DocumentInit = {
    ...init,
    header: new Map([...(init.header ?? []), ['$INSUNITS', 0]]),
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    entities: [line('30'), line('31')],
  };

  it('finds duplicates and units problems, in the worker or on the main thread, and follows the fixes', async () => {
    for (const host of [new EngineHost(twice, inProcessWorker), new EngineHost(twice)]) {
      expect(await host.healthChecks()).toMatchObject({
        duplicates: { duplicates: 1, overlaps: 0 },
        units: {
          insUnits: 0,
          measurement: 'metric',
          problems: [{ kind: 'unitless', suggested: 4 }],
        },
        dynamicBlocks: { references: 0 },
        constraints: { geometric: 0, dimensional: 0, userParameters: 0 },
      });
      expect((await host.edit({ kind: 'health-fix', what: 'duplicates' })).ok).toBe(true);
      expect((await host.edit({ kind: 'health-fix', what: 'units', insUnits: 4 })).ok).toBe(true);
      expect(await host.healthChecks()).toMatchObject({
        duplicates: { duplicates: 0, overlaps: 0 },
        units: { insUnits: 4, problems: [] },
      });
      host.dispose();
    }
  });

  it('is undefined for a drawing not open', async () => {
    const engines = new Engines(
      (i) => new EngineHost(i),
      () => [],
    );
    expect(await engines.healthChecks(7)).toBeUndefined();
    engines.start(7, twice);
    expect((await engines.healthChecks(7))?.duplicates.duplicates).toBe(1);
  });
});

describe('EngineHost layersInUse (M5-07 part 5)', () => {
  it('names the layers objects are on, in the worker or on the main thread, after edits', async () => {
    const withSpare: DocumentInit = {
      ...init,
      tables: {
        ...init.tables,
        layers: [
          ...(init.tables?.layers ?? []),
          { ...init.tables!.layers![0]!, handle: '12', name: 'SPARE' },
        ],
      },
    };
    const line = {
      handle: '30',
      owner: '1F',
      type: 'LINE',
      layer: '12',
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
      geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
    } as const;
    const drawn: DocumentInit = {
      ...withSpare,
      layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
      entities: [line],
    };
    for (const host of [new EngineHost(drawn, inProcessWorker), new EngineHost(drawn)]) {
      expect(await host.layersInUse()).toEqual(['12']);
      // SPARE merged into WALLS: the answer follows the drawing.
      expect((await host.edit({ kind: 'layer-merge', layers: ['12'], target: '11' })).ok).toBe(
        true,
      );
      expect(await host.layersInUse()).toEqual(['11']);
      host.dispose();
    }
  });

  it('is undefined for a drawing not open', async () => {
    const engines = new Engines(
      (i) => new EngineHost(i),
      () => [],
    );
    expect(await engines.layersInUse(7)).toBeUndefined();
    engines.start(7, init);
    expect(await engines.layersInUse(7)).toBeInstanceOf(Array);
  });
});

describe('EngineHost library (M8-03)', () => {
  it("gives the drawing's context and an item's block, in the worker or on the main thread", async () => {
    const item = {
      kind: 'flange',
      spec: { flangeClass: 150, nps: 2, type: 'BL' },
      view: 'front',
    } as const;
    for (const host of [new EngineHost(init, inProcessWorker), new EngineHost(init)]) {
      expect(await host.library()).toEqual({
        context: { scale: 25.4, units: { name: 'MILLIMETRES', metric: true } },
      });
      const { block } = await host.library(item);
      expect(block?.name).toBe('ASME_B16.5_BL_CL150_NPS2_FRONT');
      expect(block?.content?.blocks.map((b) => b.name)).toEqual([block?.name]);
      host.dispose();
    }
  });

  it('is undefined for a drawing not open', async () => {
    const engines = new Engines(
      (i) => new EngineHost(i),
      () => [],
    );
    expect(await engines.library(7)).toBeUndefined();
  });
});

describe('change sets straight to the render workers (M2-62)', () => {
  type Numbered = { seq: number; change: unknown };
  /** What a linked renderer hears on its port. */
  function listen(port: unknown) {
    const heard: Numbered[] = [];
    const p = port as MessagePort;
    p.addEventListener('message', (e) => heard.push((e as MessageEvent<Numbered>).data));
    p.start();
    return { heard, close: () => p.close() };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  /** A drawing's change log after turning layer 10 off: what a recovered drawing starts from. */
  const recoveredLog = async () => {
    const live = new Engines(
      (i, changes) => new EngineHost(i, undefined, changes),
      () => [],
    );
    live.start(1, init);
    await live.edit(1, { kind: 'layer', layer: '10', on: false });
    return structuredClone([...live.changesOf(1)]);
  };

  it("posts every change it applies on each linked renderer's port, numbered as the change log", async () => {
    const recovered = await recoveredLog();

    const host = new EngineHost(init, inProcessWorker, recovered);
    const link = host.connect()!;
    const port = listen(link.port);
    // An edit, a refusal (no change) and a no-op edit (an empty change), then a command's line.
    const on = await host.edit({ kind: 'layer', layer: '10', on: true });
    await host.edit({ kind: 'layer', layer: '11', frozen: true });
    await host.edit({ kind: 'layer', layer: '10', on: true });
    const o = outputs(host, 6);
    for (const text of ['L', '0,0', '10,0']) host.command({ kind: 'submit', text });
    const said = await o.done;
    await settle();
    if (!on.ok) throw new Error(on.message);
    const line = said.find((x) => x.type === 'change');
    if (line?.type !== 'change') throw new Error('no change');
    // Numbered after the recovered log the engine replayed: as the app's change log numbers them.
    expect(port.heard).toEqual([
      { seq: 2, change: on.change },
      { seq: 3, change: line.change },
    ]);

    link.close();
    await settle();
    await host.edit({ kind: 'layer', layer: '10', on: false });
    await settle();
    expect(port.heard).toHaveLength(2);
    port.close();
    host.dispose();
  });

  it('links nothing when the engine runs on the main thread', () => {
    expect(new EngineHost(init).connect()).toBeUndefined();
  });

  it("numbers each change for the drawing's canvases by its place in the change log", async () => {
    const applied: { change: unknown; seq: number }[] = [];
    const engines = new Engines(
      (i, changes) => new EngineHost(i, inProcessWorker, changes),
      () => [{ apply: (change, seq) => applied.push({ change, seq }) }],
    );
    engines.start(4, init, await recoveredLog());
    const link = engines.connect(4)!;
    const port = listen(link.port);
    await engines.edit(4, { kind: 'layer', layer: '10', on: true });
    await settle();
    expect(applied.map((a) => a.seq)).toEqual([2]);
    expect(port.heard).toEqual([{ seq: 2, change: applied[0]!.change }]);
    expect(engines.connect(9)).toBeUndefined();
    port.close();
    engines.stop(4);
  });
});
