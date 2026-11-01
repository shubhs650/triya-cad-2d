/// <reference lib="dom" />
// Test page for tests/e2e/io: spawns the real @triya/io worker the way the app will (a module
// worker built by Vite) and exposes one function for Playwright to call.
import type { IoRequest, IoResponse } from '@triya/io';

const worker = new Worker(
  new URL('../../../../packages/io/src/worker/io.worker.ts', import.meta.url),
  {
    type: 'module',
  },
);

let nextId = 1;
const pending = new Map<number, (res: IoResponse) => void>();
worker.onmessage = (ev: MessageEvent<IoResponse>) => {
  pending.get(ev.data.id)?.(ev.data);
  pending.delete(ev.data.id);
};

declare global {
  interface Window {
    readInWorker(bytes: number[]): Promise<IoResponse & { mainThreadHasAcadTs: boolean }>;
  }
}

window.readInWorker = (bytes) =>
  new Promise((resolve) => {
    const req: IoRequest = { id: nextId++, kind: 'read', bytes: Uint8Array.from(bytes) };
    pending.set(req.id, (res) =>
      // The page itself never imports acad-ts: parsing must have happened in the worker.
      resolve({ ...res, mainThreadHasAcadTs: 'DwgReader' in globalThis }),
    );
    worker.postMessage(req, [req.bytes.buffer]);
  });

document.title = 'ready';
