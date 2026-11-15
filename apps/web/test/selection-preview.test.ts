// M3-04 part 5: when the pickbox previews what a click would select (AutoCAD 2024 Help,
// "SELECTIONPREVIEW (System Variable)": 1 on when no commands are active, 2 on when a command
// prompts for object selection; initially 3).
import { describe, expect, it } from 'vitest';
import type { Prompt } from '@triya/engine';
import { previewsSelection } from '../src/selection-preview';

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
