// M3-04 part 5: when the pickbox previews what a click would select (AutoCAD 2024 Help,
// "SELECTIONPREVIEW (System Variable)": 1 on when no commands are active, 2 on when a command
// prompts for object selection; initially 3).
import { describe, expect, it } from 'vitest';
import type { Prompt } from '@triya/engine';
import { areaPreviewed, pathArea, previewsSelection, windowArea } from '../src/selection-preview';

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
