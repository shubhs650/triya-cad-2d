// M2-14: a drawing recovered after a crash. The autosave keeps the file as opened and the
// change log its engine applied (copies, as IndexedDB stores structured clones); the recovered
// engine session starts from the file and replays the log, then goes on drawing above every
// handle the log used, as AutoCAD never reuses a handle.
import { describe, expect, it } from 'vitest';
import { EngineSession, type ChangeSet, type CommandOutput } from '../../src/index';
import { LAYER_0, sampleInit, snapshot } from '../model/fixtures';

/** As the change log comes back from the store: a copy (engine tests have no structuredClone). */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function drawLines(s: EngineSession, points: string[][]): Promise<ChangeSet[]> {
  const changes: ChangeSet[] = [];
  const stop = s.onCommand((o: CommandOutput) => {
    if (o.type === 'change') changes.push(o.change);
  });
  for (const line of points) {
    for (const text of ['L', ...line, '']) await s.command({ kind: 'submit', text });
  }
  stop();
  return changes;
}

describe('EngineSession restored from a change log', () => {
  it('replays the log onto the drawing as opened', async () => {
    const live = new EngineSession(sampleInit());
    const changes: ChangeSet[] = [];
    live.onCommand((o) => {
      if (o.type === 'change') changes.push(o.change);
    });
    for (const text of ['L', '0,0', '10,0', '10,10', '', 'L', '5,5', '20,5', '', 'U']) {
      await live.command({ kind: 'submit', text });
    }
    const layer = live.edit({ kind: 'layer', layer: LAYER_0, locked: true });
    if (layer.ok) changes.push(layer.change);
    // An undo's change set removes the second line again.
    expect(changes.length).toBeGreaterThanOrEqual(4);

    const restored = new EngineSession(sampleInit(), {}, clone(changes));
    expect(snapshot(restored.model)).toEqual(snapshot(live.model));
  });

  it('allocates new handles above every handle the log used', async () => {
    const live = new EngineSession(sampleInit());
    const changes = await drawLines(live, [
      ['0,0', '10,0'],
      ['5,5', '20,5'],
    ]);
    const used = changes.flatMap((c) => c.entities?.added?.map((a) => a.entity.handle) ?? []);
    const restored = new EngineSession(sampleInit(), {}, clone(changes));
    const after = await drawLines(restored, [['1,1', '2,2']]);
    const added = after.flatMap((c) => c.entities?.added?.map((a) => a.entity.handle) ?? []);
    expect(added).toHaveLength(1);
    const big = (h: string) => BigInt(`0x${h}`);
    for (const h of used) expect(big(added[0]!) > big(h)).toBe(true);
    // The live session would have handed out the same handle next.
    const next = await drawLines(live, [['1,1', '2,2']]);
    expect(next.flatMap((c) => c.entities?.added?.map((a) => a.entity.handle) ?? [])).toEqual(
      added,
    );
  });

  it('refuses a log that does not fit the drawing', () => {
    const bad: ChangeSet = {
      tables: { layers: { updated: [{ before: { handle: 'FFFF' }, after: { handle: 'FFFF' } }] } },
    } as unknown as ChangeSet;
    expect(() => new EngineSession(sampleInit(), {}, [bad])).toThrow();
  });
});
