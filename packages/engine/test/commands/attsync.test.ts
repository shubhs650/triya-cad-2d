// M5-02 part 2: ATTSYNC, as AutoCAD 2024 has it (AutoCAD Help, "ATTSYNC (Command)"):
//   - "Enter an option [?/Name/Select] <Select>:"; ? lists the blocks with attributes, Name takes
//     a block by name, Select a reference then "ATTSYNC block NAME? [Yes/No] <Yes>:";
//   - every reference to the block, wherever it is, is given the attributes its definition has
//     now: the values of tags still defined kept (and the attributes' handles), the definitions'
//     properties placed as each reference places the block, new definitions added at their
//     defaults, attributes no longer defined removed; one undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  type AttdefGeometry,
  type DocumentModel,
  type Entity,
  type EntityGeometry,
  type InsertGeometry,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE } from '../model/fixtures';
import { setup } from './edit-harness';

const attdef = (tag: string, value: string, x: number, y: number, flags = 0): EntityGeometry =>
  ({
    kind: 'ATTDEF',
    tag,
    prompt: tag,
    value,
    flags,
    style: '16',
    position: { x, y },
    height: 2.5,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
  }) as AttdefGeometry;

function setHeader(model: DocumentModel, name: string, value: number): void {
  const b = new ChangeSetBuilder(model);
  b.setHeader(name, value);
  model.apply(b.build());
}

/**
 * Block TAG (base 0,0) made by -BLOCK from a line and attribute definitions NO ("A-1" at 2,2) and
 * REV ("0" at 20,2); references at (100,0) holding "M-101"/"3" and at (0,50) turned 90°, scale 2,
 * holding the defaults; a third in paper space.
 */
async function drawing() {
  const t = setup([
    { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
    attdef('NO', 'A-1', 2, 2),
    attdef('REV', '0', 20, 2),
  ]);
  const ids = ['40', '41', '42'].map((h) => t.model.ids.idOf(h)!);
  await t.bus.script(['-BLOCK', 'TAG', '0,0']);
  await t.bus.answer({ kind: 'selection', ids });
  await t.bus.script(['-INSERT', 'TAG', '100,0', '1', '', '0', 'M-101', '3']);
  setHeader(t.model, '$ATTREQ', 0);
  await t.bus.script(['-INSERT', 'TAG', '0,50', '2', '', '90']);
  const block = [...t.model.tables.blockRecords.values()].find((r) => r.name === 'TAG')!.handle;
  const refs = (owner = MODEL_SPACE) =>
    t.model
      .blockEntities(owner)
      .map((id) => t.model.entity(id)!)
      .filter((e) => e.geom.kind === 'INSERT');
  const geom = (e: Entity) => e.geom as InsertGeometry;
  /** The definition edited as the Block Editor would: `build` on a builder. */
  const redefine = (build: (b: ChangeSetBuilder) => void) => {
    const b = new ChangeSetBuilder(t.model);
    build(b);
    t.model.apply(b.build());
  };
  const definition = (tag: string) =>
    t.model
      .blockEntities(block)
      .map((id) => t.model.entity(id)!)
      .find((e) => e.geom.kind === 'ATTDEF' && (e.geom as AttdefGeometry).tag === tag)!;
  return { ...t, block, refs, geom, redefine, definition };
}

describe('ATTSYNC', () => {
  it('keeps values, adds new definitions at their defaults, removes the ones gone', async () => {
    const t = await drawing();
    const [a, b] = t.refs();
    const before = t.geom(a!).attributes.map((x) => x.handle);
    // REV taken out, DATE added, NO moved and made taller.
    t.redefine((b) => {
      b.removeEntity(t.definition('REV').id);
      b.addEntity({ owner: t.block, layer: '10', geom: attdef('DATE', 'today', 30, 5) });
      const no = t.definition('NO');
      b.updateEntity(no.id, {
        geom: { ...(no.geom as AttdefGeometry), position: { x: 4, y: -3 }, height: 5 },
      });
    });
    await t.bus.script(['ATTSYNC', 'Name', 'tag']);
    expect(t.log.at(-1)).toBe('ATTSYNC complete.');
    const [a2, b2] = t.refs();
    expect(t.geom(a2!).attributes.map((x) => [x.tag, x.value])).toEqual([
      ['NO', 'M-101'],
      ['DATE', 'today'],
    ]);
    // NO keeps its handle; DATE is new, above the others.
    expect(t.geom(a2!).attributes[0]!.handle).toBe(before[0]);
    expect(before).not.toContain(t.geom(a2!).attributes[1]!.handle);
    expect(t.geom(a2!).attributes[0]!.position).toEqual({ x: 104, y: -3 });
    expect(t.geom(a2!).attributes[0]!.height).toBe(5);
    // The turned, doubled reference places them as it places the block.
    const no = t.geom(b2!).attributes[0]!;
    expect([no.tag, no.value]).toEqual(['NO', 'A-1']);
    expect(no.position.x).toBeCloseTo(6, 9);
    expect(no.position.y).toBeCloseTo(58, 9);
    expect(no.height).toBeCloseTo(10, 9);
    expect(no.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(t.geom(b!).attributes).toHaveLength(2);
    // One undo step.
    await t.bus.submit('U');
    expect(t.geom(t.refs()[0]!).attributes.map((x) => [x.tag, x.value])).toEqual([
      ['NO', 'M-101'],
      ['REV', '3'],
    ]);
  });

  it('Select picks a reference and asks before synchronizing', async () => {
    const t = await drawing();
    t.redefine((b) => b.removeEntity(t.definition('REV').id));
    const [a] = t.refs();
    await t.bus.submit('ATTSYNC');
    expect(t.bus.promptText).toBe('Enter an option [?/Name/Select] <Select>:');
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Select a block:');
    // A circle is not a block.
    await t.bus.cancel();
    await t.bus.script(['CIRCLE', '500,500', '1', 'ATTSYNC', '']);
    const circle = t.model
      .blockEntities(MODEL_SPACE)
      .find((id) => t.model.entity(id)!.geom.kind === 'CIRCLE')!;
    await t.bus.answer({ kind: 'selection', ids: [circle] });
    expect(t.log.at(-1)).toBe('That object is not a block.');
    expect(t.bus.promptText).toBe('Select a block:');
    await t.bus.answer({ kind: 'selection', ids: [a!.id] });
    expect(t.bus.promptText).toBe('ATTSYNC block TAG? [Yes/No] <Yes>:');
    await t.bus.submit('No');
    expect(t.geom(t.refs()[0]!).attributes).toHaveLength(2);
    await t.bus.script(['ATTSYNC', 'Select']);
    await t.bus.answer({ kind: 'selection', ids: [a!.id] });
    await t.bus.submit('');
    expect(t.geom(t.refs()[0]!).attributes.map((x) => x.tag)).toEqual(['NO']);
    expect(t.geom(t.refs()[1]!).attributes.map((x) => x.tag)).toEqual(['NO']);
  });

  it('reaches references in paper space and inside other blocks', async () => {
    const t = await drawing();
    await t.bus.script(['-BLOCK', 'SHEET', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [t.refs()[1]!.id] });
    const sheet = [...t.model.tables.blockRecords.values()].find((r) => r.name === 'SHEET')!;
    const ref = t.refs()[0]!;
    t.redefine((b) =>
      b.addEntity({ owner: PAPER_SPACE, layer: '10', geom: { ...ref.geom } as EntityGeometry }),
    );
    t.redefine((b) => b.removeEntity(t.definition('NO').id));
    await t.bus.script(['ATTSYNC', 'N', 'TAG']);
    expect(t.geom(t.refs()[0]!).attributes.map((x) => x.tag)).toEqual(['REV']);
    expect(t.geom(t.refs(PAPER_SPACE)[0]!).attributes.map((x) => x.tag)).toEqual(['REV']);
    expect(t.geom(t.refs(sheet.handle)[0]!).attributes.map((x) => x.tag)).toEqual(['REV']);
  });

  it('constant definitions carry no attribute; the last definition gone strips them all', async () => {
    const t = await drawing();
    t.redefine((b) => {
      b.removeEntity(t.definition('NO').id);
      const rev = t.definition('REV');
      b.updateEntity(rev.id, { geom: { ...(rev.geom as AttdefGeometry), flags: 2 } });
    });
    await t.bus.script(['ATTSYNC', 'N', 'TAG']);
    expect(t.refs().map((e) => t.geom(e).attributes)).toEqual([[], []]);
    // Now neither the block nor a reference has attributes: refused, and not listed.
    t.redefine((b) => b.removeEntity(t.definition('REV').id));
    await t.bus.script(['ATTSYNC', 'N', 'TAG']);
    expect(t.log.at(-1)).toBe('Block "TAG" has no attributes.');
    await t.bus.script(['ATTSYNC', 'N', 'NOPE']);
    expect(t.log.at(-1)).toBe('Block "NOPE" not found.');
    await t.bus.script(['ATTSYNC', '?', '*']);
    expect(t.log.at(-1)).toBe('Blocks with attributes.');
    expect(t.bus.promptText).toBe('Enter an option [?/Name/Select] <Select>:');
  });

  it('refuses a reference to a block it does not offer; Enter at the name or Esc ends it', async () => {
    const t = await drawing();
    t.redefine((b) => {
      const x = b.addBlock({ name: 'SITE|TAG', basePoint: { x: 0, y: 0 } });
      b.addEntity({
        owner: MODEL_SPACE,
        layer: '10',
        geom: { ...(t.refs()[0]!.geom as InsertGeometry), block: x.handle },
      });
    });
    const dependent = t.refs().at(-1)!;
    await t.bus.script(['ATTSYNC', 'S']);
    await t.bus.answer({ kind: 'selection', ids: [dependent.id] });
    expect(t.log.at(-1)).toBe('Block "SITE|TAG" cannot be synchronized.');
    await t.bus.answer({ kind: 'selection', ids: [] });
    expect(t.bus.promptText).toBe('Command:');
    await t.bus.script(['ATTSYNC', 'N', '']);
    expect(t.bus.promptText).toBe('Command:');
    await t.bus.script(['ATTSYNC', 'N', 'SITE|TAG']);
    expect(t.log.at(-1)).toBe('Block "SITE|TAG" not found.');
    await t.bus.submit('ATTSYNC');
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
  });

  it('? lists the blocks with attributes', async () => {
    const t = await drawing();
    await t.bus.script(['ATTSYNC', '?', '']);
    expect(t.log.slice(-2)).toEqual(['Blocks with attributes.', '  "TAG"']);
    await t.bus.cancel();
  });
});
