// M8-03: the library palette's state. Favourites and recent items are kept with the scale they
// were made at, so a favourite is drawn the same size in a drawing of other units; the
// preferences keep only what is one; a block makes the preview and Insert's drop.
import { describe, expect, it } from 'vitest';
import type { Clipboard } from '@triya/engine';
import type { LibraryItem } from '@triya/library';
import {
  DEFAULT_LIBRARY,
  LIBRARY_LIMITS,
  isKept,
  keptFor,
  libraryDrop,
  libraryPreview,
  normalizeLibrary,
  rememberInserted,
  toggleFavorite,
  type KeptLibraryItem,
} from '../src/library';
import { normalizePreferences } from '../src/preferences';

const flange = (nps: number): KeptLibraryItem => ({
  entry: 'flange-WN',
  item: { kind: 'flange', spec: { flangeClass: 300, nps, type: 'WN' }, view: 'front' },
  scale: 25.4,
  name: `ASME_B16.5_WN_CL300_NPS${nps}_FRONT`,
});

const weld: KeptLibraryItem = {
  entry: 'weld-aws',
  item: {
    kind: 'weld',
    spec: {
      standard: 'AWS',
      arrowSide: { type: 'fillet', size: '1/4' },
      height: 3.175,
      referenceLength: 25.4,
      leaderLength: 9.525,
      leaderAngle: 45,
    },
  },
  scale: 25.4,
  name: 'TRIYA_WELD_AWS_FILLET_0_ABC',
};

describe('the library palette’s favourites and recent items', () => {
  it('adds a favourite once and takes it off again', () => {
    const one = toggleFavorite([], flange(4));
    expect(one).toEqual([flange(4)]);
    expect(isKept(one, { ...flange(4), name: 'other name' })).toBe(true);
    expect(isKept(one, flange(6))).toBe(false);
    expect(toggleFavorite(one, flange(6))).toEqual([flange(4), flange(6)]);
    expect(toggleFavorite(one, flange(4))).toEqual([]);
  });

  it('keeps the items inserted newest first, each once, at most ten', () => {
    let recent: KeptLibraryItem[] = [];
    for (let nps = 1; nps <= 12; nps++) recent = rememberInserted(recent, flange(nps));
    expect(recent).toHaveLength(LIBRARY_LIMITS.recent);
    expect(recent[0]).toEqual(flange(12));
    recent = rememberInserted(recent, flange(5));
    expect(recent.map((k) => (k.item as { spec: { nps: number } }).spec.nps)).toEqual([
      5, 12, 11, 10, 9, 8, 7, 6, 4, 3,
    ]);
  });

  it('draws a kept item in the units of the drawing it is used in', () => {
    // Made in millimetres, used in inches: a 25.4 drawing scale against 1.
    const inches = keptFor(weld, 1) as Extract<LibraryItem, { kind: 'weld' }>;
    expect(inches.spec.height).toBeCloseTo(0.125, 12);
    expect(inches.spec.referenceLength).toBeCloseTo(1, 12);
    expect(inches.spec.arrowSide).toEqual({ type: 'fillet', size: '1/4' });
    expect(keptFor(weld, 25.4)).toBe(weld.item);
    // A flange is its standard's size in any drawing.
    const four = flange(4);
    expect(keptFor(four, 1)).toBe(four.item);
  });

  it('keeps only what is a kept item in the preferences', () => {
    expect(normalizeLibrary(undefined)).toEqual(DEFAULT_LIBRARY);
    expect(
      normalizeLibrary({
        favorites: [flange(4), { ...flange(2), entry: 'nope' }, { ...weld, scale: 0 }, 'x', weld],
        recent: [null, { ...flange(3), item: { kind: 'other', spec: {} } }, flange(3)],
      }),
    ).toEqual({ favorites: [flange(4), weld], recent: [flange(3)] });
    expect(normalizePreferences({ library: { favorites: [weld] } }).library).toEqual({
      favorites: [weld],
      recent: [],
    });
    expect(normalizePreferences({}).library).toEqual(DEFAULT_LIBRARY);
  });
});

describe('a library block in the palette', () => {
  const content = {
    blocks: [],
    blockEntities: [],
    entities: [],
    tables: {},
  } as unknown as Clipboard;

  it('previews the drawing’s own block, or the one copied out, and nothing for an error', () => {
    expect(libraryPreview({ name: 'A', existing: '2A' })).toEqual({ kind: 'block', block: '2A' });
    expect(libraryPreview({ name: 'A', content })).toEqual({
      kind: 'library',
      block: 'A',
      content,
    });
    expect(libraryPreview({ name: '', error: 'no' })).toBeUndefined();
    expect(libraryPreview(undefined)).toBeUndefined();
  });

  it('inserts on screen, adding the block copied out, as one INSERT step', () => {
    expect(libraryDrop({ name: 'A', content })).toEqual({
      items: [{ category: 'blocks', name: 'A', content }],
      insert: { block: 'A', onScreen: true },
      library: true,
    });
    expect(libraryDrop({ name: 'A', existing: '2A' })).toEqual({
      items: [],
      insert: { block: 'A', onScreen: true },
      library: true,
    });
    expect(libraryDrop({ name: '', error: 'no' })).toBeUndefined();
  });
});
