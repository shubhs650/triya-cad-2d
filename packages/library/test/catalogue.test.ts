// M8-03: the library palette's catalogue. Every entry makes a block from its defaults at the
// drawing's units, search finds entries by their words, and `libraryBlock` hands the palette a
// block to preview and insert: copied out for a drawing without it, or the drawing's own.
import { describe, expect, it } from 'vitest';
import { ChangeSetBuilder, type CircleGeometry } from '@triya/engine';
import {
  LIBRARY_ENTRIES,
  addLibraryBlock,
  b165Flange,
  checkLibraryItem,
  libraryBlock,
  libraryContext,
  libraryEntry,
  libraryItemDescription,
  libraryItemName,
  rescaleLibraryItem,
  searchLibrary,
  type LibraryItem,
} from '../src/index';
import { drawing } from './fixtures';

const ids = (q: string) => searchLibrary(q).map((e) => e.id);

const weldNeck = (nps = 4): LibraryItem => ({
  kind: 'flange',
  spec: { flangeClass: 150, nps, type: 'WN' },
  view: 'front',
});

describe('the library catalogue (M8-03)', () => {
  it('has one entry per generator, each with a unique id', () => {
    expect(LIBRARY_ENTRIES.map((e) => e.id)).toEqual([
      'flange-WN',
      'flange-SO',
      'flange-BL',
      'flange-LJ',
      'flange-SW',
      'flange-TH',
      'nozzle-set-in',
      'nozzle-set-on',
      'saddle',
      'leg',
      'bracket',
      'skirt',
      'anchor-chair',
      'weld-aws',
      'weld-iso',
      'surface-asme',
      'surface-iso',
      'notes',
    ]);
    expect(libraryEntry('saddle')?.title).toBe('Saddle support');
    expect(libraryEntry('nope')).toBeUndefined();
  });

  it.each([
    ['millimetres', 4, 25.4],
    ['inches', 1, 1],
  ])("makes every entry's defaults as a block in %s", (_, insUnits, scale) => {
    const model = drawing({ insUnits, measurement: insUnits === 4 ? 'metric' : 'imperial' });
    const context = libraryContext(model);
    expect(context.scale).toBe(scale);
    for (const entry of LIBRARY_ENTRIES) {
      const item = entry.defaults(context);
      expect(checkLibraryItem(item), entry.id).toBeUndefined();
      const b = new ChangeSetBuilder(model);
      const handle = addLibraryBlock(b, model, item);
      expect(handle, entry.id).toBeDefined();
      const change = b.build();
      const block = change.blocks?.added?.find((d) => d.handle === handle);
      expect(block?.name, entry.id).toBe(libraryItemName(model, item));
      expect(libraryItemDescription(model, item).length, entry.id).toBeGreaterThan(0);
    }
  });

  it('finds entries by every word of the search, in any order, ignoring case', () => {
    expect(ids('')).toHaveLength(LIBRARY_ENTRIES.length);
    expect(ids('weld neck')).toEqual(['flange-WN']);
    expect(ids('NECK weld')).toEqual(['flange-WN']);
    expect(ids('blind b16.5')).toEqual(['flange-BL']);
    expect(ids('saddle')).toEqual(['saddle']);
    expect(ids('nozzle')).toEqual(['nozzle-set-in', 'nozzle-set-on']);
    expect(ids('iso')).toEqual(['weld-iso', 'surface-iso']);
    expect(ids('2553')).toEqual(['weld-iso']);
    expect(ids('finish')).toEqual(['surface-asme', 'surface-iso']);
    expect(ids('notes')).toEqual(['notes']);
    expect(ids('support')).toEqual(['saddle', 'leg', 'bracket', 'skirt', 'anchor-chair']);
    expect(ids('flange')).toHaveLength(6);
    expect(ids('zzz')).toEqual([]);
  });

  it("draws a flange to the drawing's units", () => {
    const outside = b165Flange({ flangeClass: 150, nps: 4, type: 'WN' })!.outsideDiameter;
    for (const [insUnits, scale] of [
      [4, 25.4],
      [1, 1],
      [6, 0.0254],
    ] as const) {
      const block = libraryBlock(drawing({ insUnits }), weldNeck());
      expect(block.error).toBeUndefined();
      expect(block.name).toBe('ASME_B16.5_WN_CL150_NPS4_FRONT');
      expect(block.existing).toBeUndefined();
      const content = block.content!;
      // The block's units are the drawing's, so it is inserted at scale 1.
      expect(content.blocks.find((d) => d.name === block.name)).toBeDefined();
      const radii = content.blockEntities
        .filter((e) => e.geom.kind === 'CIRCLE')
        .map((e) => (e.geom as CircleGeometry).radius);
      expect(Math.max(...radii)).toBeCloseTo((outside / 2) * scale, 9);
      expect(content.insUnits).toBe(insUnits);
    }
  });

  it('draws an item kept from a drawing in one unit the same size in another', () => {
    const inches = libraryContext(drawing({ insUnits: 1, measurement: 'imperial' }));
    const mm = libraryContext(drawing({ insUnits: 4 }));
    const k = mm.scale / inches.scale;
    for (const entry of LIBRARY_ENTRIES) {
      const kept = entry.defaults(inches);
      expect(rescaleLibraryItem(kept, k), entry.id).toEqual(entry.defaults(mm));
      expect(rescaleLibraryItem(kept, 1)).toBe(kept);
    }
  });

  it("names the drawing's own block when it has it, copying nothing", () => {
    const model = drawing();
    const b = new ChangeSetBuilder(model);
    const handle = addLibraryBlock(b, model, weldNeck())!;
    model.apply(b.build());
    const block = libraryBlock(model, weldNeck());
    expect(block).toEqual({ name: 'ASME_B16.5_WN_CL150_NPS4_FRONT', existing: handle });
    // Another size is another block.
    expect(libraryBlock(model, weldNeck(6)).content).toBeDefined();
  });

  it('says why an item makes no block', () => {
    const model = drawing();
    const none: LibraryItem = {
      kind: 'flange',
      spec: { flangeClass: 150, nps: 3, type: 'SW' },
      view: 'front',
    };
    // B16.5 has Class 150 socket welding flanges up to NPS 3 only.
    expect(checkLibraryItem({ ...none, spec: { ...none.spec, nps: 4 } })).toBe(
      'ASME B16.5 has no Class 150 NPS 4 socket welding flange',
    );
    expect(checkLibraryItem(none)).toBeUndefined();
    const saddle = libraryEntry('saddle')!.defaults(libraryContext(model));
    const broken = {
      ...saddle,
      spec: { ...(saddle as { spec: object }).spec, vesselOD: 0 },
    } as LibraryItem;
    expect(checkLibraryItem(broken)).toBe('vessel OD must be more than 0');
    expect(libraryBlock(model, broken)).toEqual({
      name: '',
      error: 'vessel OD must be more than 0',
    });
    expect(checkLibraryItem({ kind: 'detail', generator: 'X', spec: {} })).toBe(
      'X is not a library detail',
    );
  });
});
