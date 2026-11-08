// M2-02: LINE, the first real command, driven on the PromptBus as the command line drives it.
// The roadmap's acceptance script is `L ↵ 0,0 ↵ @100<45 ↵ ↵`; the rest are AutoCAD's LINE
// options (Undo, Close, Enter continuing from the last line) and Esc keeping the segments.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  currentLayer,
  modelSpaceOf,
  type BusEvent,
  type Entity,
  type HeaderValue,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, MODEL_SPACE, PAPER_SPACE, sampleInit } from '../model/fixtures';

function setup(space?: string) {
  const model = DocumentModel.create(sampleInit());
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    ...(space && { space: () => space }),
  });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const ends = () =>
    added().map((e) => {
      const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
      return [g.start.x, g.start.y, g.end.x, g.end.y].map((v) => Math.round(v * 1e6) / 1e6);
    });
  return { model, bus, events, added, ends };
}

describe('LINE', () => {
  it('draws L ↵ 0,0 ↵ @100<45 ↵ ↵ on the current layer in model space', async () => {
    const { bus, added, ends, events } = setup();
    await bus.script(['L', '0,0', '@100<45', '']);
    const r = Math.SQRT1_2 * 100;
    expect(ends()).toEqual([[0, 0, Math.round(r * 1e6) / 1e6, Math.round(r * 1e6) / 1e6]]);
    const [line] = added();
    expect(line).toMatchObject({ type: 'LINE', owner: MODEL_SPACE, layer: LAYER_WALLS });
    expect(bus.command).toBeUndefined();
    expect(bus.history).toEqual([
      'Command: L',
      'Specify first point: 0,0',
      'Specify next point or [Undo]: @100<45',
      'Specify next point or [Undo]:',
    ]);
    const commits = events.filter((e) => e.type === 'commit');
    expect(commits).toHaveLength(1);
  });

  it('offers Close from the third point and closes back to the first', async () => {
    const { bus, ends } = setup();
    await bus.script(['LINE', '0,0', '10,0']);
    expect(bus.promptText).toBe('Specify next point or [Undo]:');
    await bus.submit('10,10');
    expect(bus.promptText).toBe('Specify next point or [Close/Undo]:');
    await bus.submit('c');
    expect(bus.command).toBeUndefined();
    expect(ends()).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 0],
    ]);
  });

  it('undoes segments one by one, and says so when none are left', async () => {
    const { bus, ends } = setup();
    await bus.script(['LINE', '0,0', '10,0', '10,10', 'U']);
    expect(ends()).toEqual([[0, 0, 10, 0]]);
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: 10, y: 0 } } });
    await bus.script(['U', 'U']);
    expect(ends()).toEqual([]);
    expect(bus.history.at(-1)).toBe('All segments already undone.');
    // Still drawing from the first point.
    await bus.script(['5,5', '']);
    expect(ends()).toEqual([[0, 0, 5, 5]]);
  });

  it('continues from the last line when Enter answers the first point', async () => {
    const { bus, ends } = setup();
    await bus.script(['LINE', '', '']);
    expect(bus.history).toContain('No line or arc to continue.');
    expect(bus.command).toBe('LINE');
    await bus.cancel();
    await bus.script(['LINE', '0,0', '10,0', '', 'LINE', '', '10,10', '']);
    expect(ends()).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
    ]);
  });

  it('keeps the segments drawn when Esc cancels it, in one undo record', async () => {
    const { bus, ends, events } = setup();
    await bus.script(['LINE', '0,0', '10,0', '10,10']);
    await bus.cancel();
    expect(ends()).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
    ]);
    const commits = events.flatMap((e) => (e.type === 'commit' ? [e.record] : []));
    expect(commits.map((r) => [r.command, r.changes.length])).toEqual([['LINE', 2]]);
  });

  it('takes picked points and a direct distance towards the cursor', async () => {
    const { bus, ends } = setup();
    await bus.submit('L');
    await bus.answer({ kind: 'point', point: { x: 1, y: 1 } });
    bus.pointer({ x: 1, y: 50 });
    await bus.submit('20');
    await bus.answer({ kind: 'enter' });
    expect(ends()).toEqual([[1, 1, 1, 21]]);
  });

  it('draws in the space shown', async () => {
    const { bus, added } = setup(PAPER_SPACE);
    await bus.script(['L', '0,0', '1,1', '']);
    expect(added()[0]?.owner).toBe(PAPER_SPACE);
  });

  it('refuses an option the first point does not offer', async () => {
    const { bus, added } = setup();
    await bus.submit('L');
    await bus.answer({ kind: 'keyword', keyword: 'X' });
    expect(bus.command).toBe('LINE');
    await bus.cancel();
    expect(added()).toEqual([]);
  });
});

describe('currentLayer and modelSpaceOf', () => {
  it('finds CLAYER by name, case-insensitively, else layer 0', () => {
    const init = sampleInit();
    const header = (v: HeaderValue | undefined) =>
      DocumentModel.create({
        ...init,
        header: new Map([...(init.header ?? [])].filter(([k]) => k !== '$CLAYER')).set(
          '$CLAYER',
          v ?? '',
        ),
      });
    expect(currentLayer(header('walls'))).toBe(LAYER_WALLS);
    expect(currentLayer(header('NOPE'))).toBe(LAYER_0);
    expect(currentLayer(header(undefined))).toBe(LAYER_0);
    expect(modelSpaceOf(DocumentModel.create(init))).toBe(MODEL_SPACE);
  });

  it('throws on a drawing without layer 0 or model space', () => {
    const init = sampleInit();
    const bare = DocumentModel.create({
      ...init,
      tables: { ...init.tables, layers: [], blockRecords: [] },
      blocks: [],
      layouts: [],
      entities: [],
    });
    expect(() => currentLayer(bare)).toThrow('layer 0');
    expect(() => modelSpaceOf(bare)).toThrow('*Model_Space');
  });
});
