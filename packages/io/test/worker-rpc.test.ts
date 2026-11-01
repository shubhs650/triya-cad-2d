// The I/O worker's RPC (M1-06): `readInWorker` on the main thread, `ioApi` in the worker, joined
// by Comlink. Here a MessageChannel stands in for the Worker, so the contract (transfer,
// progress, errors, cancellation, one worker per job) is tested in Node; tests/e2e/io runs the
// real module Worker in Chromium and measures main-thread responsiveness.
import { ACadVersion } from '@node-projects/acad-ts';
import * as Comlink from 'comlink';
import { describe, expect, it, vi } from 'vitest';
import { ioApi, readInWorker, type IoProgress, type IoWorker } from '../src/index';
import { ascii, sampleDwg } from './fixtures';

// io compiles without DOM or Node types; Node provides MessageChannel at runtime.
interface Port extends Comlink.Endpoint {
  close(): void;
}
declare const MessageChannel: new () => { port1: Port; port2: Port };

/** A "worker" whose other end runs `api` on this thread. */
function fakeWorker(api: object = ioApi): IoWorker & { terminate: ReturnType<typeof vi.fn> } {
  const { port1, port2 } = new MessageChannel();
  Comlink.expose(api, port1);
  const terminate = vi.fn(() => {
    port1.close();
    port2.close();
  });
  return Object.assign(port2, { terminate });
}

describe('readInWorker', () => {
  it('reads a drawing in the worker and terminates the worker after the job', async () => {
    const w = fakeWorker();
    const summary = await readInWorker(sampleDwg(ACadVersion.AC1018), { createWorker: () => w });
    expect(summary).toMatchObject({
      format: 'dwg',
      version: 'AC1018',
      modelSpaceEntities: { LINE: 1 },
    });
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it('moves the bytes to the worker instead of copying them', async () => {
    const bytes = sampleDwg(ACadVersion.AC1032);
    await readInWorker(bytes, { createWorker: () => fakeWorker() });
    expect(bytes.byteLength).toBe(0);
  });

  it('copies a view into a larger buffer, so the rest of that buffer stays with the caller', async () => {
    const dwg = sampleDwg(ACadVersion.AC1032);
    const big = new Uint8Array(dwg.length + 16);
    big.set(dwg, 8);
    const view = big.subarray(8, 8 + dwg.length);
    await readInWorker(view, { createWorker: () => fakeWorker() });
    expect(big.byteLength).toBe(dwg.length + 16);
  });

  it('reports each stage of the job, in order', async () => {
    const stages: IoProgress[] = [];
    await readInWorker(sampleDwg(ACadVersion.AC1018), {
      createWorker: () => fakeWorker(),
      onProgress: (p) => void stages.push(p),
    });
    expect(stages.map((p) => p.stage)).toEqual(['parse', 'summarize', 'done']);
    expect(stages.map((p) => p.fraction)).toEqual([0, 0.9, 1]);
  });

  it('rejects with the reader’s error and still terminates the worker', async () => {
    const w = fakeWorker();
    await expect(
      readInWorker(ascii('AC1032 this is not a drawing'), { createWorker: () => w, format: 'dwg' }),
    ).rejects.toThrow(/./);
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it('cancels a running job: rejects with AbortError and terminates the worker', async () => {
    const w = fakeWorker({ read: () => new Promise(() => {}) });
    const ctl = new AbortController();
    const job = readInWorker(new Uint8Array(8), { createWorker: () => w, signal: ctl.signal });
    ctl.abort();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it('starts no worker for a job cancelled before it starts', async () => {
    const createWorker = vi.fn(() => fakeWorker());
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      readInWorker(new Uint8Array(8), { createWorker, signal: ctl.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createWorker).not.toHaveBeenCalled();
  });
});

// io has no DOM types: the AbortController Node provides is declared for the test only.
declare const AbortController: new () => {
  signal: NonNullable<Parameters<typeof readInWorker>[1]['signal']>;
  abort(): void;
};
