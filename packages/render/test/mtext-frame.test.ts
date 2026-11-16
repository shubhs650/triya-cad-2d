// M4-09: the frame an MTEXT is laid out in, which JUSTIFYTEXT and SCALETEXT read its attachment
// points off (the engine worker has no fonts).
import type { MTextGeometry, TextStyleRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mtextFrameSize, textBounds, type TextContext } from '../src/index';
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

const mtext = (extra: Partial<MTextGeometry> = {}): MTextGeometry => ({
  kind: 'MTEXT',
  contents: 'WIDE LINE\\Pshort',
  style: 'S1',
  position: { x: 0, y: 0 },
  height: 10,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  ...extra,
});

describe('mtextFrameSize', () => {
  const frame = mtextFrameSize(ctx);

  it('is the widest line wide, from the top to the last baseline', () => {
    const f = frame(mtext())!;
    const box = textBounds(ctx)(mtext())!;
    // The glyphs of the widest line fill the frame's width; two lines 10 high, 5/3 apart.
    expect(f.width).toBeCloseTo(box.maxX - box.minX, 0);
    expect(f.height).toBeCloseTo(10 + 50 / 3, 6);
  });

  it('is the reference rectangle wide when the text has one', () => {
    expect(frame(mtext({ width: 300 }))!.width).toBe(300);
  });

  it('places the text by its attachment: the frame stays the same size', () => {
    expect(frame(mtext({ attachment: 9 }))).toEqual(frame(mtext()));
  });

  it('is unknown without the font', () => {
    expect(frame(mtext({ style: 'NONE' }))).toBeUndefined();
  });

  it('an empty text has no height', () => {
    expect(frame(mtext({ contents: '', width: 5 }))).toEqual({ width: 5, height: 0 });
  });
});
