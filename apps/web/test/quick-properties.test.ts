// M2-35 part 16: where the Quick Properties palette shows and when (AutoCAD 2024 Help, "Quick
// Properties Tab (Drafting Settings Dialog Box)": by the cursor, above and to its right, or at a
// static place the drafter drags it to; "QPMODE": 1 for all objects, 2 only for objects with
// quick properties of their own).
import { describe, expect, it } from 'vitest';
import type { PropertySheet } from '@triya/engine';
import { QP_DISTANCE, quickPlacement, quickShown } from '../src/quick-properties';

const area = { width: 1000, height: 600 };
const size = { width: 240, height: 120 };

describe('quickPlacement', () => {
  it('puts it above and to the right of the cursor, 50 pixels away', () => {
    expect(QP_DISTANCE).toBe(50);
    expect(quickPlacement({ location: 0, pointer: { x: 300, y: 400 }, size, area })).toEqual({
      left: 350,
      top: 230,
    });
  });

  it('keeps it on the canvas near an edge', () => {
    expect(quickPlacement({ location: 0, pointer: { x: 900, y: 60 }, size, area })).toEqual({
      left: 760,
      top: 0,
    });
  });

  it('keeps a static palette where it was dragged, else top left', () => {
    expect(quickPlacement({ location: 1, pointer: { x: 300, y: 400 }, size, area })).toEqual({
      left: 8,
      top: 8,
    });
    expect(
      quickPlacement({
        location: 1,
        pointer: undefined,
        size,
        area,
        dragged: { left: 500, top: 900 },
      }),
    ).toEqual({ left: 500, top: 480 });
  });

  it('falls back to the static place when the selection came without a pointer', () => {
    expect(quickPlacement({ location: 0, pointer: undefined, size, area })).toEqual({
      left: 8,
      top: 8,
    });
  });
});

const sheet = (
  types: PropertySheet['types'],
  over: Partial<PropertySheet> = {},
): PropertySheet => ({
  count: types.reduce((n, t) => n + t.count, 0),
  types,
  sections: [{ title: 'Quick Properties', rows: [] }],
  units: { lunits: 2, luprec: 4, aunits: 0, auprec: 0 },
  ...over,
});

describe('quickShown', () => {
  const line = { type: 'LINE' as const, label: 'Line', count: 1 };
  const xline = { type: 'XLINE' as const, label: 'Construction Line', count: 1 };

  it('shows for a selection while QPMODE is on', () => {
    expect(quickShown(sheet([line]), 1)).toBe(true);
    expect(quickShown(sheet([line]), -1)).toBe(false);
    expect(quickShown(sheet([line]), 0)).toBe(false);
    expect(quickShown(sheet([]), 1)).toBe(false);
    expect(quickShown(undefined, 1)).toBe(false);
  });

  it('QPMODE 2 shows only where a type has quick properties of its own', () => {
    expect(quickShown(sheet([xline]), 1)).toBe(true);
    expect(quickShown(sheet([xline]), 2)).toBe(false);
    expect(quickShown(sheet([xline, line]), 2)).toBe(true);
  });
});
