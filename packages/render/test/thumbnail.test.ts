// M1-22 part 5: the document tab hover preview pictures each space by a scaled copy of its
// canvas, aspect kept and never enlarged.
import { describe, expect, it } from 'vitest';
import { thumbnailOf, thumbnailSize } from '../src/index';
import { surface } from './fixtures';

describe('thumbnailSize', () => {
  it('fits the canvas inside the box, keeping its aspect', () => {
    expect(thumbnailSize({ width: 1600, height: 900 }, { width: 160, height: 120 })).toEqual({
      width: 160,
      height: 90,
    });
    expect(thumbnailSize({ width: 600, height: 900 }, { width: 160, height: 120 })).toEqual({
      width: 80,
      height: 120,
    });
  });

  it('never enlarges and keeps at least a pixel each way', () => {
    expect(thumbnailSize({ width: 100, height: 50 }, { width: 160, height: 120 })).toEqual({
      width: 100,
      height: 50,
    });
    expect(thumbnailSize({ width: 10000, height: 1 }, { width: 160, height: 120 })).toEqual({
      width: 160,
      height: 1,
    });
  });

  it('has nothing to fit for a canvas never sized', () => {
    expect(thumbnailSize({ width: 0, height: 0 }, { width: 160, height: 120 })).toBeUndefined();
    expect(thumbnailSize({ width: 10, height: 10 }, { width: 0, height: 120 })).toBeUndefined();
  });
});

describe('thumbnailOf', () => {
  it('is undefined where createImageBitmap does not exist (Node)', async () => {
    const s = surface('visible');
    s.canvas.width = 10;
    s.canvas.height = 10;
    expect(await thumbnailOf(s, { width: 5, height: 5 })).toBeUndefined();
  });
});
