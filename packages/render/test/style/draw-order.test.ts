// Draw order from a block's SORTENTSTABLE (M1-13 part 2).
import { describe, expect, it } from 'vitest';
import { drawOrder } from '../../src/index';

describe('drawOrder', () => {
  it('keeps the block order when the block has no SORTENTSTABLE', () => {
    expect(drawOrder(['30', '1F', '2A'])).toEqual(['30', '1F', '2A']);
  });

  it('sorts by sort handle, using an entity’s own handle when the table has no entry', () => {
    // HATCH 35A sent behind LWPOLYLINE 353 (sample_AC1015 table 355): 35A sorts as 354.
    const entries = [
      { entity: '353', sort: '35A' },
      { entity: '35A', sort: '354' },
    ];
    expect(drawOrder(['353', '358', '35A'], entries)).toEqual(['35A', '358', '353']);
  });

  it('compares handles as numbers, not strings', () => {
    expect(drawOrder(['A', '9', '10'], [{ entity: '10', sort: '10' }])).toEqual(['9', 'A', '10']);
  });

  it('keeps the block order between equal sort handles, and ignores entries for other entities', () => {
    const entries = [
      { entity: '40', sort: '20' },
      { entity: '41', sort: '20' },
      { entity: 'FF', sort: '1' },
    ];
    expect(drawOrder(['41', '40', '30'], entries)).toEqual(['41', '40', '30']);
  });
});
