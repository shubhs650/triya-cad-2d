// M3-04 part 5: when the pickbox previews what a click would select (AutoCAD 2024 Help,
// "SELECTIONPREVIEW (System Variable)": 1 on when no commands are active, 2 on when a command
// prompts for object selection; initially 3).
import { describe, expect, it } from 'vitest';
import type { Prompt } from '@triya/engine';
import {
  areaPreviewed,
  leftOf,
  pathArea,
  previewsSelection,
  windowArea,
  windowCorners,
} from '../src/selection-preview';

const select: Prompt = { kind: 'selection', message: 'Select objects' };
const trim: Prompt = { kind: 'point', message: 'Select object to trim', pickbox: true };
const corner: Prompt = { kind: 'point', message: 'Specify opposite corner' };
const quick: Prompt = {
  kind: 'point',
  message: 'Move cursor',
  pickbox: true,
  quick: { loops: [] },
};
const keyword: Prompt = { kind: 'keyword', message: 'Enter an option', options: [] } as Prompt;

describe('previewsSelection', () => {
  it('bit 1: at Command: only, not while a command waits without a prompt', () => {
    expect(previewsSelection(1, undefined, true)).toBe(true);
    expect(previewsSelection(2, undefined, true)).toBe(false);
    expect(previewsSelection(1, undefined, false)).toBe(false);
    expect(previewsSelection(1, select, false)).toBe(false);
  });

  it('bit 2: at "Select objects" and object picks with the pickbox', () => {
    expect(previewsSelection(2, select, false)).toBe(true);
    expect(previewsSelection(2, trim, false)).toBe(true);
    expect(previewsSelection(3, select, false)).toBe(true);
    expect(previewsSelection(1, trim, false)).toBe(false);
  });

  it('never at a point, a window corner, MEASUREGEOM Quick or a keyword prompt', () => {
    for (const p of [corner, quick, keyword]) expect(previewsSelection(3, p, false)).toBe(false);
  });

  it('0 turns it off everywhere', () => {
    expect(previewsSelection(0, undefined, true)).toBe(false);
    expect(previewsSelection(0, select, false)).toBe(false);
  });
});

// M3-04 part 6: a window, polygon, fence or lasso being dragged previews what it would take, the
// implied window at `Command:` with bit 1, one at "Select objects" with bit 2.
describe('areaPreviewed', () => {
  const band = (atCommand?: true): Prompt => ({
    kind: 'point',
    message: 'Specify opposite corner',
    rubberBand: {
      from: { x: 0, y: 0 },
      box: true,
      selection: 'auto',
      ...(atCommand && { atCommand }),
    },
  });

  it('bit 1 for the implied window at Command:, bit 2 for a window at "Select objects"', () => {
    expect(areaPreviewed(1, band(true))).toBe(true);
    expect(areaPreviewed(2, band(true))).toBe(false);
    expect(areaPreviewed(2, band())).toBe(true);
    expect(areaPreviewed(1, band())).toBe(false);
    expect(areaPreviewed(0, band(true))).toBe(false);
  });

  it('not at a point prompt without a selection band', () => {
    expect(areaPreviewed(3, corner)).toBe(false);
    expect(areaPreviewed(3, select)).toBe(false);
    expect(areaPreviewed(3, undefined)).toBe(false);
  });
});

describe('a window on a turned screen (a twisted layout viewport, M6-02 part 15)', () => {
  const quarter = Math.PI / 2;
  const close = (ps: { x: number; y: number }[], want: [number, number][]) => {
    expect(ps).toHaveLength(want.length);
    ps.forEach((p, i) => {
      expect(p.x).toBeCloseTo(want[i]![0], 12);
      expect(p.y).toBeCloseTo(want[i]![1], 12);
    });
  };

  it('is square to the screen: its sides along the screen’s axes in the world', () => {
    // A quarter turn shows world +X up the screen: the screen's X is world −Y.
    close(windowCorners({ x: 0, y: 0 }, { x: 4, y: -2 }, quarter), [
      [0, 0],
      [0, -2],
      [4, -2],
      [4, 0],
    ]);
    const r = Math.PI / 6;
    const a = { x: 1, y: 1 };
    const b = { x: 5, y: 3 };
    const [p0, p1, p2, p3] = windowCorners(a, b, r);
    // Opposite sides parallel, adjacent sides square.
    const side = (p: { x: number; y: number }, q: { x: number; y: number }) => ({
      x: q.x - p.x,
      y: q.y - p.y,
    });
    const s1 = side(p0!, p1!);
    const s2 = side(p1!, p2!);
    expect(s1.x * s2.x + s1.y * s2.y).toBeCloseTo(0, 12);
    // The first side runs along the screen's X: world (cos r, −sin r).
    expect(s1.x * Math.sin(r) + s1.y * Math.cos(r)).toBeCloseTo(0, 12);
    expect(p3!.x - p0!.x).toBeCloseTo(p2!.x - p1!.x, 12);
  });

  it('selects through the polygon of its corners', () => {
    const q = windowArea({ x: 0, y: 0 }, { x: 4, y: -2 }, false, quarter);
    expect(q.kind).toBe('window');
    close(q.polygon as { x: number; y: number }[], [
      [0, 0],
      [0, -2],
      [4, -2],
      [4, 0],
    ]);
    expect(q.box.minY).toBeCloseTo(-2, 12);
    expect(q.box.maxX).toBeCloseTo(4, 12);
    expect(windowArea({ x: 0, y: 0 }, { x: 4, y: -2 }, true)).toEqual({
      kind: 'crossing',
      box: { minX: 0, minY: -2, maxX: 4, maxY: 0 },
    });
  });

  it('is dragged leftward as the screen shows it', () => {
    // World +Y shows leftward on a quarter-turned screen.
    expect(leftOf({ x: 0, y: 0 }, { x: 0, y: 2 }, quarter)).toBe(true);
    expect(leftOf({ x: 0, y: 0 }, { x: 0, y: -2 }, quarter)).toBe(false);
    expect(leftOf({ x: 0, y: 0 }, { x: -1, y: 0 })).toBe(true);
  });
});

describe('windowArea and pathArea', () => {
  it('a rectangle between two corners, a polygon or fence through its points', () => {
    expect(windowArea({ x: 4, y: 1 }, { x: 0, y: 3 }, true)).toEqual({
      kind: 'crossing',
      box: { minX: 0, minY: 1, maxX: 4, maxY: 3 },
    });
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 1 },
      { x: 2, y: 5 },
    ];
    expect(pathArea(points, 'window')).toEqual({
      kind: 'window',
      box: { minX: 0, minY: 0, maxX: 4, maxY: 5 },
      polygon: points,
    });
    expect(pathArea(points, 'fence')).toMatchObject({ kind: 'fence', polygon: points });
  });
});
