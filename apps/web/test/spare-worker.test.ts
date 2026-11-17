// M4-22: a drawing's engine worker starts while its file is still being read, so the modules it
// loads are loaded by the time the drawing opens rather than after.
import { describe, expect, it, vi } from 'vitest';
import { SpareWorker } from '../src/spare-worker';

const worker = (n: number) => ({ n, terminate: vi.fn() });

describe('SpareWorker', () => {
  it('hands out the worker started ahead, then starts the next one only when asked', () => {
    let made = 0;
    const create = vi.fn(() => worker(++made));
    const spare = new SpareWorker(create);
    expect(create).not.toHaveBeenCalled();
    spare.start();
    spare.start();
    expect(create).toHaveBeenCalledTimes(1);
    expect(spare.take().n).toBe(1);
    // None waiting: a new one.
    expect(spare.take().n).toBe(2);
    spare.start();
    expect(spare.take().n).toBe(3);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('ends a spare nobody took', () => {
    const w = worker(1);
    const spare = new SpareWorker(() => w);
    spare.start();
    spare.discard();
    expect(w.terminate).toHaveBeenCalledTimes(1);
    spare.discard();
    expect(w.terminate).toHaveBeenCalledTimes(1);
    expect(spare.take()).toBe(w);
  });
});
