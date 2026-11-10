// M2-26 part 2: how many dynamic columns an MTEXT's text takes as the renderer lays it out, what
// a column grip recounts its columns by (the engine worker has no fonts).
import type { MTextGeometry, TextStyleRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { columnCounter, type TextContext } from '../src/index';
import { fontBook } from './text-fonts';

const style = (handle: string, font: string): TextStyleRecord => ({
  handle,
  name: handle,
  font,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});
const STYLES = new Map([
  ['S1', style('S1', 'romans.shx')],
  ['NONE', style('NONE', 'not-loaded.shx')],
]);
const ctx: TextContext = { fonts: fontBook(), style: (h) => STYLES.get(h) };

/** Four one-line paragraphs, 10 high, in dynamic columns 200 wide. */
const columned = (
  definedHeight: number,
  cols: Partial<NonNullable<MTextGeometry['columns']>> = {},
  extra: Partial<MTextGeometry> = {},
): MTextGeometry => ({
  kind: 'MTEXT',
  contents: 'A\\PB\\PC\\PD',
  style: 'S1',
  position: { x: 0, y: 0 },
  height: 10,
  width: 200,
  definedHeight,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  columns: {
    type: 2,
    count: 1,
    flowReversed: false,
    autoHeight: true,
    width: 200,
    gutter: 20,
    heights: [],
    ...cols,
  },
  ...extra,
});

describe('columnCounter', () => {
  const count = columnCounter(ctx);

  it('counts the columns the text flows into at the column height', () => {
    // Lines 10 high are spaced about 16.7: one line fits 15, two fit 30, all four fit 70.
    expect(count(columned(15))).toBe(4);
    expect(count(columned(30))).toBe(2);
    expect(count(columned(70))).toBe(1);
  });

  it('manual heights: each column its own, columns past the list the last one', () => {
    expect(count(columned(30, { autoHeight: false, count: 2, heights: [70, 15] }))).toBe(1);
    expect(count(columned(30, { autoHeight: false, count: 2, heights: [15, 30] }))).toBe(3);
  });

  it('static columns keep their count; no font, no count', () => {
    expect(count(columned(15, { type: 1, count: 2 }))).toBe(2);
    expect(count(columned(15, {}, { style: 'NONE' }))).toBeUndefined();
    const { columns: _c, ...plain } = columned(15);
    expect(count(plain)).toBeUndefined();
  });
});
