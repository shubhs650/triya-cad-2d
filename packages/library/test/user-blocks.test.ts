// M8-03 part 2: the blocks of a drawing file kept in a user library folder. The palette lists a
// file's named blocks and hands one to the drawing as the catalogue's are handed (copied out with
// what it names, DesignCenter's way), in its own units: a block the file left unitless is taken
// to be in the file's units (DEC-096), so INSERT scales it into the drawing's.
import { describe, expect, it } from 'vitest';
import { ChangeSetBuilder, type DocumentModel } from '@triya/engine';
import { libraryDrawingBlock, libraryDrawingBlocks } from '../src/index';
import { drawing } from './fixtures';

/** `model` with block `name`: a circle of radius 10 and a line, in INSUNITS `units` (absent: unitless). */
function withBlock(model: DocumentModel, name: string, units?: number): DocumentModel {
  const b = new ChangeSetBuilder(model);
  const block = b.addBlock({
    name,
    basePoint: { x: 0, y: 0 },
    ...(units !== undefined && { units }),
  }).handle;
  b.addEntity({
    owner: block,
    layer: '10',
    geom: { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 10 },
  });
  b.addEntity({
    owner: block,
    layer: '13',
    geom: { kind: 'LINE', start: { x: -10, y: 0 }, end: { x: 10, y: 0 } },
  });
  model.apply(b.build());
  return model;
}

const recordUnits = (block: ReturnType<typeof libraryDrawingBlock>) =>
  block.content?.tables.blockRecords?.find((r) => r.name === block.name)?.units;

describe("a library folder drawing's blocks (M8-03 part 2)", () => {
  it('lists the named blocks the file offers, sorted', () => {
    const model = withBlock(withBlock(drawing(), 'VALVE'), 'Gate valve', 4);
    expect(libraryDrawingBlocks(model)).toEqual(['Gate valve', 'VALVE']);
    expect(libraryDrawingBlocks(drawing())).toEqual([]);
  });

  it('copies a block out with what it names, found by name whatever its case', () => {
    const model = withBlock(drawing(), 'VALVE');
    const block = libraryDrawingBlock(model, 'valve');
    expect(block.error).toBeUndefined();
    expect(block.name).toBe('VALVE');
    expect(block.content?.blockEntities.map((e) => e.geom.kind).sort()).toEqual(['CIRCLE', 'LINE']);
    // Layer NOTES, which the line is on, comes with it.
    expect(block.content?.tables.layers?.map((l) => l.name)).toContain('NOTES');
  });

  it("takes a unitless block to be in its file's units", () => {
    const mm = libraryDrawingBlock(withBlock(drawing({ insUnits: 4 }), 'VALVE'), 'VALVE');
    expect(recordUnits(mm)).toBe(4);
    const inches = libraryDrawingBlock(
      withBlock(drawing({ insUnits: 1, measurement: 'imperial' }), 'VALVE'),
      'VALVE',
    );
    expect(recordUnits(inches)).toBe(1);
  });

  it('keeps the units a block names, and a unitless file leaves its blocks unitless', () => {
    const feet = libraryDrawingBlock(withBlock(drawing({ insUnits: 4 }), 'VALVE', 2), 'VALVE');
    expect(recordUnits(feet)).toBe(2);
    const unitless = libraryDrawingBlock(withBlock(drawing({ insUnits: 0 }), 'VALVE'), 'VALVE');
    expect(recordUnits(unitless) ?? 0).toBe(0);
  });

  it('says so for a block the file does not have', () => {
    const block = libraryDrawingBlock(withBlock(drawing(), 'VALVE'), 'PUMP');
    expect(block).toEqual({ name: '', error: 'The drawing file has no block PUMP' });
  });
});
