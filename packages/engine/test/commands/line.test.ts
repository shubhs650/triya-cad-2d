// M2-02: LINE, the first real command, driven on the PromptBus as the command line drives it.
// The roadmap's acceptance script is `L ↵ 0,0 ↵ @100<45 ↵ ↵`; the rest are AutoCAD's LINE
// options (Undo, Close, Enter continuing from the last line) and Esc keeping the segments.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  NO_LINE,
  OSNAP,
  builtinCommands,
  currentLayer,
  sketchGeometry,
  type Sketch,
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

  it("gives the last segment's direction with the rubber band, for POLARMODE 1", async () => {
    const { bus } = setup();
    await bus.script(['LINE', '0,0']);
    // No segment drawn yet: the polar angles stay absolute.
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: 0, y: 0 } } });
    expect(bus.prompt?.kind === 'point' && bus.prompt.rubberBand?.direction).toBeUndefined();
    await bus.submit('10,10');
    const d = bus.prompt?.kind === 'point' ? bus.prompt.rubberBand?.direction : undefined;
    expect(d?.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(d?.y).toBeCloseTo(Math.SQRT1_2, 12);
    await bus.script(['20,10', 'U']);
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: 10, y: 10 } } });
    expect(bus.prompt?.kind === 'point' && bus.prompt.rubberBand?.direction?.x).toBeCloseTo(
      Math.SQRT1_2,
      12,
    );
    await bus.script(['', 'LINE', '']);
    // Enter continues from the last line's end, which is the last segment's too.
    expect(bus.prompt).toMatchObject({
      rubberBand: { from: { x: 10, y: 10 }, direction: { x: expect.any(Number) } },
    });
    await bus.cancel();
    await bus.script(['LINE', '3,3']);
    // A line started elsewhere has no last segment.
    expect(bus.prompt?.kind === 'point' && bus.prompt.rubberBand?.direction).toBeUndefined();
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

describe('LINE with deferred TANgent and PERpendicular (M3-01 part 2)', () => {
  const circleA = { kind: 'circle', center: { x: 0, y: 0 }, radius: 2 } as const;
  const circleB = { kind: 'circle', center: { x: 10, y: 0 }, radius: 2 } as const;
  const tan = (target: typeof circleA | typeof circleB, x: number, y: number) => ({
    deferred: { mode: 'TAN' as const, target, pick: { x, y } },
  });

  it('asks the first point with TAN and PER deferred, and the next one too after one', async () => {
    const { bus } = setup();
    await bus.submit('LINE');
    expect(bus.prompt).toMatchObject({
      message: 'Specify first point',
      deferred: { modes: OSNAP.TAN | OSNAP.PER },
    });
    await bus.pick({ x: 0, y: 2.1 }, tan(circleA, 0, 2.1));
    // No rubber band from a tangent not yet solved: the line itself is dragged instead.
    expect(bus.prompt).toMatchObject({
      message: 'Specify next point or',
      options: ['Undo'],
      deferred: { modes: OSNAP.TAN | OSNAP.PER },
      drag: { kind: 'sketch', sketch: { shape: 'line' }, layer: LAYER_WALLS },
    });
    expect(bus.prompt).not.toHaveProperty('rubberBand');
    expect(
      sketchGeometry((bus.prompt!.drag as { sketch: Sketch }).sketch, { x: 0, y: 10 }),
    ).toEqual({
      kind: 'LINE',
      start: { x: expect.closeTo(-1.959592, 6), y: 0.4 },
      end: { x: 0, y: 10 },
    });
  });

  it('draws a line tangent to two circles, picked TAN then TAN, and goes on from its end', async () => {
    const { bus, ends } = setup();
    await bus.submit('LINE');
    await bus.pick({ x: 0, y: 2.1 }, tan(circleA, 0, 2.1));
    await bus.pick({ x: 10, y: 2.1 }, tan(circleB, 10, 2.1));
    expect(ends()).toEqual([[0, 2, 10, 2]]);
    // From the tangent line's end LINE goes on as usual, its rubber band from that end.
    expect(bus.prompt).toMatchObject({
      message: 'Specify next point or',
      options: ['Undo'],
      rubberBand: { from: { x: 10, y: 2 } },
    });
    expect(bus.prompt).not.toHaveProperty('deferred');
    await bus.script(['10,10', '']);
    expect(ends()).toEqual([
      [0, 2, 10, 2],
      [10, 2, 10, 10],
    ]);
  });

  it('starts tangent from a typed TAN override ("to") and ends at a typed point', async () => {
    const { bus, ends } = setup();
    await bus.script(['LINE', 'tan']);
    expect(bus.promptText).toBe('to');
    expect(bus.prompt).toMatchObject({
      osnap: OSNAP.TAN,
      deferred: { modes: OSNAP.TAN | OSNAP.PER },
    });
    const big = { kind: 'circle', center: { x: 0, y: 0 }, radius: 5 } as const;
    await bus.pick(
      { x: 2, y: 5 },
      { deferred: { mode: 'TAN', target: big, pick: { x: 2, y: 5 } } },
    );
    await bus.script(['10,0', '']);
    expect(ends()).toEqual([[2.5, 4.330127, 10, 0]]);
  });

  it('draws perpendicular from a line to a point', async () => {
    const { bus, ends } = setup();
    await bus.submit('LINE');
    const target = { kind: 'line', point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } } as const;
    await bus.pick({ x: 1, y: 0 }, { deferred: { mode: 'PER', target, pick: { x: 1, y: 0 } } });
    await bus.script(['3,4', '']);
    expect(ends()).toEqual([[3, 0, 3, 4]]);
  });

  it('says "Line does not exist." and asks again where none does; Undo takes the start back', async () => {
    const { bus, ends } = setup();
    await bus.submit('LINE');
    await bus.pick({ x: 0, y: 2 }, tan(circleA, 0, 2));
    // From inside the circle no tangent touches it.
    await bus.submit('0.5,0');
    expect(bus.history.at(-1)).toBe(NO_LINE);
    expect(bus.prompt).toMatchObject({ message: 'Specify next point or', deferred: {} });
    await bus.submit('U');
    expect(bus.promptText).toBe('Specify first point:');
    await bus.script(['0,0', '5,0', '']);
    expect(ends()).toEqual([[0, 0, 5, 0]]);
  });

  it('takes a deferred pick as its point where the prompt does not solve it', async () => {
    const { bus, ends } = setup();
    await bus.script(['LINE', '0,0']);
    // The second point after a plain first point: TAN is drawn from that point, not deferred.
    await bus.pick({ x: 0, y: 2 }, tan(circleA, 0, 2));
    await bus.submit('');
    expect(ends()).toEqual([[0, 0, 0, 2]]);
  });
});
