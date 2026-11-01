// SHX containers (M1-08): shape files and normal fonts ("shapes 1.0/1.1"), Unicode fonts
// ("unifont") and Asian big fonts ("bigfont", minimal). All test files are built here.
import { describe, expect, it } from 'vitest';
import { parseShx } from '../../src/index';
import { buildBigfont, buildShapes, buildUnifont } from './builder';

const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const box = [0x14, 0x10, 0x1c, 0x18, 0]; // a 1×1 square drawn from the pen position

describe('shapes 1.0 / 1.1', () => {
  it('reads the font info shape and indexes every shape by number and name', () => {
    const font = parseShx(
      buildShapes(
        [
          { code: 65, name: 'UCA', bytes: box },
          { code: 66, name: 'UCB', bytes: box },
        ],
        { name: 'Test simplex', above: 21, below: 7, modes: 0 },
      ),
    );
    expect(font.kind).toBe('shapes');
    expect(font.name).toBe('Test simplex');
    expect(font.above).toBe(21);
    expect(font.below).toBe(7);
    expect(font.modes).toBe(0);
    expect(font.isFont).toBe(true);
    expect(font.codes()).toEqual([65, 66]);
    expect(font.hasShape(65)).toBe(true);
    expect(font.hasShape(67)).toBe(false);
    expect(font.shapeByName('UCB')).toBe(66);
    expect(font.shapeByName('nope')).toBeUndefined();
  });

  it('reads a shape file without font info (complex linetype shapes)', () => {
    const font = parseShx(
      buildShapes([{ code: 132, name: 'TRACK1', bytes: box }], undefined, '1.1'),
    );
    expect(font.isFont).toBe(false);
    expect(font.name).toBe('');
    expect(font.above).toBe(0);
    expect(font.shapeByName('TRACK1')).toBe(132);
    expect(font.glyph(132)?.paths.length).toBe(1);
  });
});

describe('unifont', () => {
  it('reads the font info and 16-bit Unicode shape numbers', () => {
    const font = parseShx(
      buildUnifont(
        [
          { code: 0x41, name: '', bytes: box },
          { code: 0x3a9, name: 'omega', bytes: box },
        ],
        { name: 'Test unicode', above: 30, below: 10, modes: 2, encoding: 0, type: 0 },
      ),
    );
    expect(font.kind).toBe('unifont');
    expect(font.name).toBe('Test unicode');
    expect([font.above, font.below, font.modes]).toEqual([30, 10, 2]);
    expect(font.codes()).toEqual([0x41, 0x3a9]);
    expect(font.glyph(0x3a9)?.name).toBe('omega');
  });
});

describe('bigfont', () => {
  const bytes = buildBigfont(
    [
      { code: 0x8140, name: '', bytes: box },
      { code: 0x9fa1, name: '', bytes: box },
    ],
    { name: 'Test big', above: 8, below: 0, width: 8 },
    [
      [0x81, 0x84],
      [0x9f, 0x9f],
    ],
    2,
  );

  it('reads escape ranges, double-byte codes and skips empty index slots', () => {
    const font = parseShx(bytes);
    expect(font.kind).toBe('bigfont');
    expect(font.name).toBe('Test big');
    expect(font.above).toBe(8);
    expect(font.codes()).toEqual([0x8140, 0x9fa1]);
    expect(font.escapeRanges).toEqual([
      [0x81, 0x84],
      [0x9f, 0x9f],
    ]);
    expect(font.isLeadByte(0x82)).toBe(true);
    expect(font.isLeadByte(0x85)).toBe(false);
    expect(font.glyph(0x8140)?.paths.length).toBe(1);
  });
});

describe('malformed files', () => {
  it('rejects anything that is not a compiled SHX', () => {
    expect(() => parseShx(latin1('*0,4,font\n21,7,0,0\n'))).toThrow(/not a compiled SHX/);
    expect(() => parseShx(latin1('AutoCAD-86 widgets 1.0\r\n\x1a'))).toThrow(
      /unsupported SHX type "widgets"/,
    );
  });

  it('reports truncation instead of reading past the end', () => {
    const good = buildShapes([{ code: 65, name: 'A', bytes: box }], {
      name: 'F',
      above: 1,
      below: 0,
    });
    expect(() => parseShx(good.slice(0, good.length - 3))).toThrow(/truncated/);
  });

  it('accepts a byte array that is a view into a larger buffer', () => {
    const good = buildShapes([{ code: 65, name: 'A', bytes: box }], {
      name: 'F',
      above: 1,
      below: 0,
    });
    const big = new Uint8Array(good.length + 10);
    big.set(good, 5);
    expect(parseShx(big.subarray(5, 5 + good.length)).codes()).toEqual([65]);
  });
});
