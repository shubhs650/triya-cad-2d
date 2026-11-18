// M5-03 part 3: ATTREDEF, as AutoCAD 2024 has it (AutoCAD Help, "ATTREDEF (Command)"):
//   Enter the name of the block you wish to redefine:
//   Select objects for new Block...
//   Select objects:
//   Specify insertion base point of new Block:
// The block is redefined from the objects (erased, as -BLOCK erases them) and every reference
// takes the new definition's attributes: "New attributes assigned to existing block references
// use their default values. Old attributes in the new block definition retain their old values.
// Old attributes not included in the new block definition are deleted", and "ATTREDEF removes
// any format or property changes made with the ATTEDIT or EATTEDIT commands". One undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  type AttdefGeometry,
  type DocumentModel,
  type Entity,
  type EntityGeometry,
  type InsertGeometry,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
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
 * Block TAG (base 0,0) made by -BLOCK from a line and definitions NO ("A-1") and REV ("0"),
 * references at (100,0) holding "M-101"/"3" and at (0,50) holding the defaults; and, left in
 * model space for the new definition, a circle, NO ("N-0" at 5,5), DATE ("today" at 30,5) and a
 * constant KIND ("PLATE").
 */
async function drawing() {
  const t = setup([
    { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
    attdef('NO', 'A-1', 2, 2),
    attdef('REV', '0', 20, 2),
    { kind: 'CIRCLE', center: { x: 15, y: 5 }, radius: 2 },
    attdef('NO', 'N-0', 5, 5),
    attdef('DATE', 'today', 30, 5),
    attdef('KIND', 'PLATE', 5, 10, 2),
  ]);
  const idsOf = (...hs: string[]) => hs.map((h) => t.model.ids.idOf(h)!);
  await t.bus.script(['-BLOCK', 'TAG', '0,0']);
  await t.bus.answer({ kind: 'selection', ids: idsOf('40', '41', '42') });
  await t.bus.script(['-INSERT', 'TAG', '100,0', '1', '', '0', 'M-101', '3']);
  setHeader(t.model, '$ATTREQ', 0);
  await t.bus.script(['-INSERT', 'TAG', '0,50', '1', '', '0']);
  const block = [...t.model.tables.blockRecords.values()].find((r) => r.name === 'TAG')!.handle;
  const refs = () =>
    t.model
      .blockEntities(MODEL_SPACE)
      .map((id) => t.model.entity(id)!)
      .filter((e) => e.geom.kind === 'INSERT');
  const attributes = (e: Entity) => (e.geom as InsertGeometry).attributes;
  const values = (e: Entity) => attributes(e).map((a) => [a.tag, a.value]);
  const contents = () =>
    t.model.blockEntities(block).map((id) => {
      const g = t.model.entity(id)!.geom;
      return g.kind === 'ATTDEF' ? (g as AttdefGeometry).tag : g.kind;
    });
  const objects = idsOf('43', '44', '45', '46');
  return { ...t, block, refs, attributes, values, contents, objects };
}

describe('ATTREDEF', () => {
  it('redefines the block from the objects and gives every reference its attributes', async () => {
    const t = await drawing();
    const [a] = t.refs();
    const noHandle = t.attributes(a!)[0]!.handle;
    await t.bus.submit('ATTREDEF');
    expect(t.bus.promptText).toBe('Enter the name of the block you wish to redefine:');
    await t.bus.submit('tag');
    expect(t.log.at(-1)).toBe('Select objects for new Block...');
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.answer({ kind: 'selection', ids: t.objects });
    expect(t.bus.promptText).toBe('Specify insertion base point of new Block:');
    await t.bus.submit('10,0');
    expect(t.bus.promptText).toBe('Command:');

    // The definition is the objects, based at the point; they leave model space.
    expect(t.contents()).toEqual(['CIRCLE', 'NO', 'DATE', 'KIND']);
    expect(t.model.blocks.get(t.block)!.basePoint).toEqual({ x: 10, y: 0 });
    for (const id of t.objects) expect(t.model.entity(id)).toBeUndefined();

    // Old values kept (and the ATTRIB), new ones at their defaults, REV gone, no constant one.
    const [a2, b2] = t.refs();
    expect(t.values(a2!)).toEqual([
      ['NO', 'M-101'],
      ['DATE', 'today'],
    ]);
    expect(t.attributes(a2!)[0]!.handle).toBe(noHandle);
    expect(t.values(b2!)).toEqual([
      ['NO', 'A-1'],
      ['DATE', 'today'],
    ]);
    // Placed as the new definition places them: NO 5,5 from a base at 10,0.
    expect(t.attributes(a2!)[0]!.position).toEqual({ x: 95, y: 5 });

    // One undo step brings the old definition, the references and the objects back.
    await t.bus.submit('U');
    expect(t.contents()).toEqual(['LINE', 'NO', 'REV']);
    expect(t.values(t.refs()[0]!)).toEqual([
      ['NO', 'M-101'],
      ['REV', '3'],
    ]);
    for (const id of t.objects) expect(t.model.entity(id)).toBeDefined();
  });

  it('takes back the changes EATTEDIT made to an attribute', async () => {
    const t = await drawing();
    const [a] = t.refs();
    const b = new ChangeSetBuilder(t.model);
    const g = a!.geom as InsertGeometry;
    b.updateEntity(a!.id, {
      geom: {
        ...g,
        attributes: g.attributes.map((x) => ({ ...x, height: 9, position: { x: 0, y: 0 } })),
      },
    });
    t.model.apply(b.build());
    await t.bus.script(['ATTREDEF', 'TAG']);
    await t.bus.answer({ kind: 'selection', ids: t.objects });
    await t.bus.submit('0,0');
    const no = t.attributes(t.refs()[0]!)[0]!;
    expect([no.value, no.height, no.position]).toEqual(['M-101', 2.5, { x: 105, y: 5 }]);
  });

  it('refuses a block it cannot redefine and ends with nothing selected', async () => {
    const t = await drawing();
    await t.bus.script(['ATTREDEF', 'NOPE']);
    expect(t.log.at(-1)).toBe('Block "NOPE" not found.');
    expect(t.bus.promptText).toBe('Command:');
    // A layout's block is no block to redefine.
    await t.bus.script(['ATTREDEF', '*Model_Space']);
    expect(t.log.at(-1)).toBe('Block "*Model_Space" not found.');

    await t.bus.script(['ATTREDEF', 'TAG']);
    await t.bus.answer({ kind: 'selection', ids: [] });
    expect(t.log.at(-1)).toBe('No objects selected.');
    expect(t.bus.promptText).toBe('Command:');

    // A reference to the block cannot go into it.
    const [a] = t.refs();
    await t.bus.script(['ATTREDEF', 'TAG']);
    await t.bus.answer({ kind: 'selection', ids: [a!.id, ...t.objects] });
    expect(t.log.at(-1)).toBe('Block "TAG" references itself.');
    expect(t.bus.promptText).toBe('Command:');
    expect(t.contents()).toEqual(['LINE', 'NO', 'REV']);
  });
});
