// M1-67: the engine host. The app talks to each drawing's engine session through it, in the
// engine worker or (where no worker is given) on the main thread; both answer alike, and a
// change set that crossed the worker boundary still applies to a render replica.
import { DocumentModel, type DocumentInit } from '@triya/engine';
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
  },
};

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
      (i) => new EngineHost(i),
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
});
