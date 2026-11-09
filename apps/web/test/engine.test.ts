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
    postMessage(m: EngineRequest) {
      const data = structuredClone(m);
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
