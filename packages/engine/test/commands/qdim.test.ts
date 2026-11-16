// M4-02 part 2: QDIM on the PromptBus with AutoCAD 2024's prompts, on the stand-in dimension
// engine of dimension-harness.ts. The sample drawing's polyline is a 20 × 10 rectangle from
// (100, 0); its arc is centred on (50, 0), radius 10, from 0° to 60°.
import { describe, expect, it } from 'vitest';
import type { DimensionGeometry } from '../../src/index';
import { entityInit, snapshot } from '../model/fixtures';
import { said, setup, standard } from './dimension-harness';

type Linear = DimensionGeometry & { dimType: 'linear' };

const RECT = { x: 100, y: 0 };

async function selectRect(s: ReturnType<typeof setup>) {
  await s.bus.script(['QDIM']);
  await s.bus.pick({ x: RECT.x + 5, y: 0 });
  await s.bus.submit('');
}

const spans = (s: ReturnType<typeof setup>) =>
  s.dims().map((e) => {
    const g = e.geom as Linear;
    return [g.first.x, g.second.x, g.definitionPoint.y];
  });

describe('QDIM', () => {
  it('asks AutoCAD 2024 prompts; Continuous chains the points along the position', async () => {
    const s = setup({
      entities: [
        entityInit('42', { kind: 'LINE', start: { x: 110, y: 0 }, end: { x: 110, y: 10 } }),
      ],
    });
    await s.bus.submit('QDIM');
    expect(s.bus.promptText).toBe('Select geometry to dimension:');
    await s.bus.pick({ x: RECT.x + 5, y: 0 });
    await s.bus.pick({ x: 110, y: 5 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe(
      'Specify dimension line position, or [Continuous/Staggered/Baseline/Ordinate/Radius/Diameter/datumPoint/Edit/seTtings] <Continuous>:',
    );
    await s.bus.submit('105,15');
    expect(s.bus.command).toBeUndefined();
    // Horizontal above the points: 100 → 110 → 120, each place once.
    expect(spans(s)).toEqual([
      [100, 110, 15],
      [110, 120, 15],
    ]);
    expect(s.dims().every((e) => (e.geom as Linear).rotation === 0)).toBe(true);
  });

  it('beside the points the series runs vertically; one undo step for the lot', async () => {
    const s = setup();
    const before = snapshot(s.model);
    await selectRect(s);
    await s.bus.submit('130,5');
    const g = s.dim<'linear'>();
    expect(g.rotation).toBe(Math.PI / 2);
    expect(g.definitionPoint.x).toBe(130);
    expect(s.dims()).toHaveLength(1);
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('Staggered nests the pairs from the outside in, DIMDLI apart', async () => {
    const s = setup({ styles: [standard({ DIMDLI: 2 })] });
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: RECT.x + 5, y: 0 });
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.submit('');
    // Points along X: 0, 10, 100, 120.
    await s.bus.script(['S', '50,30']);
    expect(spans(s)).toEqual([
      [0, 120, 32],
      [10, 100, 30],
    ]);
  });

  it('Baseline measures from the first point, or the datum point given', async () => {
    const s = setup({ styles: [standard({ DIMDLI: 1 })] });
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: RECT.x + 5, y: 0 });
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.submit('');
    await s.bus.script(['B', '50,-5']);
    expect(spans(s)).toEqual([
      [0, 10, -5],
      [0, 100, -6],
      [0, 120, -7],
    ]);
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: RECT.x + 5, y: 0 });
    await s.bus.submit('');
    await s.bus.script(['P']);
    expect(s.bus.promptText).toBe('Select new datum point:');
    await s.bus.script(['120,0', 'B', '110,-20']);
    expect(spans(s).slice(3)).toEqual([[120, 100, -20]]);
  });

  it('Ordinate gives each point an ordinate dimension, leaders ending on the position', async () => {
    const s = setup();
    await selectRect(s);
    await s.bus.script(['O', '110,20']);
    const ords = s.dims().map((e) => e.geom as DimensionGeometry & { dimType: 'ordinate' });
    expect(ords.map((g) => [g.axis, g.feature.x, g.leaderEnd.y])).toEqual([
      ['x', 100, 20],
      ['x', 120, 20],
    ]);
    expect(ords[0]!.definitionPoint).toEqual({ x: 0, y: 0 });
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: RECT.x + 5, y: 0 });
    await s.bus.script(['', 'P', '100,0', 'O', '130,5']);
    const ys = s
      .dims()
      .slice(2)
      .map((e) => e.geom as DimensionGeometry & { dimType: 'ordinate' });
    expect(ys.map((g) => [g.axis, g.feature.y, g.leaderEnd.x])).toEqual([
      ['y', 0, 130],
      ['y', 10, 130],
    ]);
    expect(ys[0]!.definitionPoint).toEqual({ x: 100, y: 0 });
  });

  it('Radius and Diameter dimension each arc and circle selected', async () => {
    const s = setup({
      entities: [entityInit('43', { kind: 'CIRCLE', center: { x: 0, y: -50 }, radius: 5 })],
    });
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.pick({ x: 5, y: -50 });
    await s.bus.script(['', 'R', '30,-20']);
    expect(s.dims().map((e) => (e.geom as DimensionGeometry).dimType)).toEqual([
      'radius',
      'radius',
    ]);
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: 5, y: -50 });
    await s.bus.script(['', 'D', '10,-50']);
    expect(s.dim<'diameter'>().chordPoint).toEqual({ x: 5, y: -50 });
    // Lines have no radius.
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.script(['', 'R', '30,-20']);
    expect(said(s.bus)).toContain('Nothing to dimension.');
  });

  it('Edit removes the points picked and adds others', async () => {
    const s = setup();
    await selectRect(s);
    await s.bus.submit('E');
    expect(s.bus.promptText).toBe('Indicate dimension point to remove, or [Add/eXit] <eXit>:');
    await s.bus.submit('119,1');
    await s.bus.submit('119,9');
    await s.bus.submit('A');
    expect(s.bus.promptText).toBe('Indicate dimension point to add, or [Remove/eXit] <eXit>:');
    await s.bus.script(['110,0', 'R', 'X', '105,15']);
    expect(spans(s)).toEqual([[100, 110, 15]]);
  });

  it('seTtings takes Endpoint or Intersection; Esc anywhere makes nothing', async () => {
    const s = setup();
    const before = snapshot(s.model);
    await selectRect(s);
    await s.bus.submit('T');
    expect(s.bus.promptText).toBe(
      'Associative dimension priority [Endpoint/Intersection] <Endpoint>:',
    );
    await s.bus.submit('I');
    await s.bus.cancel();
    for (const answers of [['T'], ['P'], ['E']]) {
      await selectRect(s);
      await s.bus.script(answers);
      await s.bus.cancel();
    }
    await selectRect(s);
    await s.bus.script(['E', '']);
    await s.bus.cancel();
    await s.bus.script(['QDIM', '']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('says so with nothing to dimension or no dimension style', async () => {
    const s = setup({ entities: [entityInit('44', { kind: 'TEXT' } as never)] });
    await s.bus.script(['QDIM']);
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.pick({ x: 0, y: 20 });
    await s.bus.submit('');
    expect(s.bus.command).toBe('QDIM');
    await s.bus.cancel();
    const none = setup({ styles: [] });
    await none.bus.script(['QDIM']);
    expect(said(none.bus)).toContain('The drawing has no dimension style.');
  });
});
