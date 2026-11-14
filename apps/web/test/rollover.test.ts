// M2-35 part 21: rollover tooltips (AutoCAD 2024 Help, "ROLLOVERTIPS (System Variable)":
// "Controls the display of rollover tooltips in the application"; the tooltip names the object
// under the resting cursor and its properties). When the cursor rests, what it shows, where.
import { describe, expect, it, vi } from 'vitest';
import type { EntityId, PropertySheet } from '@triya/engine';
import { RestWatch, REST_SLOP_PX } from '../src/canvas/rest';
import {
  ROLLOVER_DELAY_MS,
  ROLLOVER_OFFSET,
  Rollovers,
  hoverRollover,
  rolloverLines,
  rolloverPlacement,
} from '../src/rollover';

function watch() {
  vi.useFakeTimers();
  const rests: ({ x: number; y: number } | undefined)[] = [];
  const w = new RestWatch<{ x: number; y: number }>(ROLLOVER_DELAY_MS, (p) => rests.push(p));
  return { w, rests };
}

describe('RestWatch', () => {
  it('reports where the pointer rests once it has stayed the delay', () => {
    const { w, rests } = watch();
    w.move({ x: 10, y: 10 });
    vi.advanceTimersByTime(ROLLOVER_DELAY_MS - 1);
    w.move({ x: 40, y: 10 });
    vi.advanceTimersByTime(ROLLOVER_DELAY_MS - 1);
    expect(rests).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rests).toEqual([{ x: 40, y: 10 }]);
    vi.useRealTimers();
  });

  it('keeps a rest through a tremor, and ends it when the pointer moves on', () => {
    const { w, rests } = watch();
    w.move({ x: 10, y: 10 });
    vi.advanceTimersByTime(ROLLOVER_DELAY_MS);
    w.move({ x: 10 + REST_SLOP_PX, y: 10 });
    vi.advanceTimersByTime(ROLLOVER_DELAY_MS);
    expect(rests).toEqual([{ x: 10, y: 10 }]);
    w.move({ x: 30, y: 10 });
    expect(rests).toEqual([{ x: 10, y: 10 }, undefined]);
    vi.advanceTimersByTime(ROLLOVER_DELAY_MS);
    expect(rests.at(-1)).toEqual({ x: 30, y: 10 });
    vi.useRealTimers();
  });

  it('ends a rest, or one about to be, on a press, a wheel roll or leaving the canvas', () => {
    const { w, rests } = watch();
    w.move({ x: 10, y: 10 });
    w.cancel();
    vi.advanceTimersByTime(ROLLOVER_DELAY_MS * 2);
    expect(rests).toEqual([]);
    w.move({ x: 10, y: 10 });
    vi.advanceTimersByTime(ROLLOVER_DELAY_MS);
    w.cancel();
    w.cancel();
    expect(rests).toEqual([{ x: 10, y: 10 }, undefined]);
    vi.useRealTimers();
  });
});

describe('rolloverPlacement', () => {
  const size = { width: 160, height: 60 };
  const view = { width: 1000, height: 600 };

  it('puts the tooltip below and to the right of the cursor', () => {
    expect(rolloverPlacement({ x: 300, y: 200 }, size, view)).toEqual({
      left: 300 + ROLLOVER_OFFSET.x,
      top: 200 + ROLLOVER_OFFSET.y,
    });
  });

  it('turns it to the cursor’s other side at the window’s right and bottom edges', () => {
    expect(rolloverPlacement({ x: 950, y: 580 }, size, view)).toEqual({
      left: 950 - ROLLOVER_OFFSET.x - 160,
      top: 580 - ROLLOVER_OFFSET.y - 60,
    });
  });
});

const tip: PropertySheet = {
  count: 1,
  types: [{ type: 'CIRCLE', label: 'Circle', count: 1 }],
  sections: [
    {
      title: 'Circle',
      rows: [
        {
          key: 'color',
          label: 'Color',
          kind: 'choice',
          value: 'BYLAYER',
          options: [{ value: 'BYLAYER', label: 'ByLayer' }],
        },
        {
          key: 'layer',
          label: 'Layer',
          kind: 'choice',
          value: '11',
          options: [{ value: '11', label: 'WALLS' }],
        },
        { key: 'linetype', label: 'Linetype', kind: 'choice', varies: true },
      ],
    },
  ],
  units: { lunits: 2, luprec: 4, aunits: 0, auprec: 0 },
};

describe('rolloverLines', () => {
  it('names the object and lists each row as the Properties palette shows it', () => {
    expect(rolloverLines(tip)).toEqual({
      title: 'Circle',
      rows: [
        { label: 'Color', value: 'ByLayer' },
        { label: 'Layer', value: 'WALLS' },
        { label: 'Linetype', value: '*VARIES*' },
      ],
    });
  });
});

describe('hoverRollover', () => {
  const at = { world: { x: 1, y: 2 }, clientX: 300, clientY: 200 };
  function deps(o: { on?: boolean; idle?: boolean; ids?: EntityId[] } = {}) {
    const asked: EntityId[] = [];
    return {
      asked,
      d: {
        enabled: () => o.on ?? true,
        idle: () => o.idle ?? true,
        pick: () => Promise.resolve(o.ids ?? [7 as EntityId, 8 as EntityId]),
        ask: (id: EntityId) => asked.push(id),
      },
    };
  }

  it('asks the engine for the nearest object under a resting cursor, and shows its answer', async () => {
    const r = new Rollovers();
    const { d, asked } = deps();
    await hoverRollover(r, 1, at, d);
    expect(asked).toEqual([7]);
    expect(r.get(1)).toBeUndefined();
    // Another object's answer (an earlier rest's) is not this one's.
    r.answer(1, 8 as EntityId, tip);
    expect(r.get(1)).toBeUndefined();
    r.answer(1, 7 as EntityId, tip);
    expect(r.get(1)).toEqual({ sheet: tip, clientX: 300, clientY: 200 });
    // The cursor moves on: it goes.
    await hoverRollover(r, 1, undefined, d);
    expect(r.get(1)).toBeUndefined();
    r.answer(1, 7 as EntityId, tip);
    expect(r.get(1)).toBeUndefined();
  });

  it('shows nothing off objects, with ROLLOVERTIPS 0, or while a command runs', async () => {
    for (const o of [{ ids: [] }, { on: false }, { idle: false }]) {
      const r = new Rollovers();
      const { d, asked } = deps(o);
      await hoverRollover(r, 1, at, d);
      r.answer(1, 7 as EntityId, tip);
      expect(asked).toEqual([]);
      expect(r.get(1)).toBeUndefined();
    }
  });

  it('drops an answer for a rest that ended while the pick was in flight', async () => {
    const r = new Rollovers();
    const { d, asked } = deps();
    const pending = hoverRollover(r, 1, at, d);
    r.clear(1);
    await pending;
    expect(asked).toEqual([]);
  });

  it('drops an answer without a sheet (the object is gone)', async () => {
    const r = new Rollovers();
    const { d } = deps();
    await hoverRollover(r, 1, at, d);
    r.answer(1, 7 as EntityId, undefined);
    expect(r.get(1)).toBeUndefined();
  });
});
