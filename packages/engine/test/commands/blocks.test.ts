// M5-01 part 1: blocks made and inserted at the command line, as AutoCAD 2024 does (AutoCAD Help,
// "-BLOCK (Command)", "-INSERT (Command)", "BASE (Command)", "ATTREQ (System Variable)",
// "INSUNITS (System Variable)", "About Defining Blocks", "About Inserting Blocks"):
//   - -BLOCK names the block, takes its base point and the objects, copies them into the
//     definition in the current UCS's coordinates and erases them (OOPS brings them back);
//     a name in use asks whether to redefine it, every reference following at once; a block may
//     not hold a reference to itself;
//   - -INSERT names the block, says its units and the conversion, takes the insertion point
//     (with the Basepoint, Scale, X, Y, Z and Rotate presets), X and Y scale (or a corner) and the
//     rotation, then asks each attribute's value (ATTREQ 1) or takes the defaults (ATTREQ 0);
//     `*NAME` inserts the block's contents exploded;
//   - BASE sets the drawing's insertion base point (INSBASE).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  PromptBus,
  builtinCommands,
  type AttdefGeometry,
  type DocumentModel,
  type Entity,
  type EntityGeometry,
  type InsertGeometry,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE } from '../model/fixtures';
import { r6, setup } from './edit-harness';

const B = '50';

/** A header variable set as the drawing would hold it (the harness drawing has few). */
function setHeader(model: DocumentModel, name: string, value: number): void {
  const b = new ChangeSetBuilder(model);
  b.setHeader(name, value);
  model.apply(b.build());
}

const attdef = (
  tag: string,
  prompt: string,
  value: string,
  x: number,
  y: number,
  flags = 0,
): EntityGeometry =>
  ({
    kind: 'ATTDEF',
    tag,
    prompt,
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

const line = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

/**
 * The harness drawing (line 30 (0,0)-(10,0), circle 31 at (50,0) r 5, block B, record 50) with
 * a reference to B at (100,100) (handle 40).
 */
function drawing(o: { vars?: Map<string, number> } = {}) {
  const extra: (EntityGeometry | [EntityGeometry, Partial<Entity>])[] = [
    [
      {
        kind: 'INSERT',
        block: B,
        position: { x: 100, y: 100 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      },
      {},
    ],
  ];
  const t = setup(extra, { ...(o.vars && { variables: o.vars }) });
  const space = () => t.model.blockEntities(MODEL_SPACE).map((id) => t.model.entity(id)!);
  const inserts = () =>
    space()
      .filter((e) => e.geom.kind === 'INSERT')
      .map((e) => e.geom as InsertGeometry);
  const blockNamed = (name: string) =>
    [...t.model.tables.blockRecords.values()].find((r) => r.name === name);
  const contents = (name: string) =>
    t.model.blockEntities(blockNamed(name)!.handle).map((id) => t.model.entity(id)!);
  return { ...t, space, inserts, blockNamed, contents };
}

/**
 * The harness drawing with block TITLE made through -BLOCK, based at (0,0), from a frame line and
 * four attribute definitions: NO ("Drawing number", "A-1"), REV (preset, "0"), FIRM (constant,
 * "OET") and CHK (verify, no prompt, "XX").
 */
async function withTitle(vars?: Map<string, number>) {
  const t = setup(
    [
      line(0, 0, 40, 0),
      attdef('NO', 'Drawing number', 'A-1', 2, 2),
      attdef('REV', 'Revision', '0', 20, 2, 8),
      attdef('FIRM', '', 'OET', 30, 2, 2),
      attdef('CHK', '', 'XX', 2, 6, 4),
    ],
    { ...(vars && { variables: vars }) },
  );
  const ids = ['40', '41', '42', '43', '44'].map((h) => t.model.ids.idOf(h)!);
  await t.bus.script(['-BLOCK', 'TITLE', '0,0']);
  await t.bus.answer({ kind: 'selection', ids });
  const space = () => t.model.blockEntities(MODEL_SPACE).map((id) => t.model.entity(id)!);
  const inserts = () =>
    space()
      .filter((e) => e.geom.kind === 'INSERT')
      .map((e) => e.geom as InsertGeometry);
  return { ...t, space, inserts };
}

describe('-BLOCK', () => {
  it('makes a block of the objects at the base point and erases them; OOPS restores them', async () => {
    const t = drawing();
    await t.bus.submit('-BLOCK');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    await t.bus.submit('door');
    expect(t.bus.promptText).toBe('Specify insertion base point:');
    await t.bus.submit('5,0');
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('30')!] });
    expect(t.bus.promptText).toBe('Command:');
    const r = t.blockNamed('door')!;
    expect(t.model.blocks.get(r.handle)!.basePoint).toEqual({ x: 5, y: 0 });
    expect(t.contents('door').map((e) => e.geom)).toEqual([line(0, 0, 10, 0)]);
    expect(t.byHandle('30')).toBeUndefined();
    await t.bus.submit('OOPS');
    expect(t.byHandle('30')).toBeDefined();
    // One undo step each: U takes OOPS back, then the block.
    await t.bus.script(['U', 'U']);
    expect(t.blockNamed('door')).toBeUndefined();
    expect(t.byHandle('30')).toBeDefined();
  });

  it('refuses an invalid name and asks again; Enter or Esc at the name ends it', async () => {
    const t = drawing();
    await t.bus.script(['-BLOCK', 'A<B']);
    expect(t.log).toContain('Invalid block name.');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    await t.bus.submit('*X');
    expect(t.log.filter((l) => l === 'Invalid block name.')).toHaveLength(2);
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Command:');
  });

  it('asks before redefining a block of the name; No leaves it, Yes redefines it', async () => {
    const t = drawing();
    await t.bus.script(['-BLOCK', 'b']);
    expect(t.bus.promptText).toBe('Block "B" already exists. Redefine it? [Yes/No] <No>:');
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Command:');
    expect(t.contents('B')).toHaveLength(2);

    await t.bus.script(['-BLOCK', 'B', 'Y', '50,0']);
    await t.bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('31')!] });
    expect(t.contents('B').map((e) => e.geom.kind)).toEqual(['CIRCLE']);
    expect(t.model.blocks.get(B)!.basePoint).toEqual({ x: 50, y: 0 });
    // The reference at (100,100) now draws the circle.
    expect(t.inserts()[0]!.block).toBe(B);
    await t.bus.submit('U');
    expect(t.contents('B').map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    expect(t.model.blocks.get(B)!.basePoint).toEqual({ x: 0, y: 0 });
  });

  it('refuses to redefine a block with a reference to itself', async () => {
    const t = drawing();
    await t.bus.script(['-BLOCK', 'B', 'Y', '0,0']);
    await t.bus.answer({
      kind: 'selection',
      ids: [t.model.ids.idOf('30')!, t.model.ids.idOf('40')!],
    });
    expect(t.log).toContain('Block "B" references itself.');
    expect(t.contents('B')).toHaveLength(2);
    expect(t.byHandle('30')).toBeDefined();
  });

  it('refuses a reference to a block that holds the block being redefined', async () => {
    const t = drawing();
    await t.bus.script(['-BLOCK', 'OUTER', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('40')!] });
    await t.bus.script(['-INSERT', 'OUTER', '0,0', '', '', '0']);
    const outer = t.space().find((e) => e.geom.kind === 'INSERT')!;
    await t.bus.script(['-BLOCK', 'B', 'Y', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [outer.id, t.model.ids.idOf('31')!] });
    expect(t.log.at(-1)).toBe('Block "B" references itself.');
    // A circle alone is fine.
    await t.bus.script(['-BLOCK', 'B', 'Y', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('31')!] });
    expect(t.contents('B').map((e) => e.geom.kind)).toEqual(['CIRCLE']);
  });

  it('makes nothing when no objects are selected', async () => {
    const t = drawing();
    await t.bus.script(['-BLOCK', 'EMPTY', '0,0', '']);
    expect(t.log).toContain('No objects selected.');
    expect(t.blockNamed('EMPTY')).toBeUndefined();
  });

  it('nests a reference to another block', async () => {
    const t = drawing();
    await t.bus.script(['-BLOCK', 'OUTER', '100,100']);
    await t.bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('40')!] });
    const [inner] = t.contents('OUTER');
    expect(inner!.geom).toMatchObject({ kind: 'INSERT', block: B, position: { x: 100, y: 100 } });
    expect(t.inserts()).toHaveLength(0);
  });

  it('holds the objects in the coordinates of the current UCS', async () => {
    const t = drawing();
    // A UCS at (10,0) turned 90°.
    await t.bus.script(['UCS', '10,0', '10,1', '9,0']);
    await t.bus.script(['-BLOCK', 'TURNED', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('30')!] });
    const def = t.model.blocks.get(t.blockNamed('TURNED')!.handle)!;
    expect(def.basePoint.x).toBeCloseTo(0, 9);
    expect(def.basePoint.y).toBeCloseTo(0, 9);
    const g = t.contents('TURNED')[0]!.geom as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    expect([g.start.x, g.start.y, g.end.x, g.end.y].map(r6)).toEqual([0, 10, 0, 0]);
  });

  it('? lists the blocks matching the pattern, with the counts', async () => {
    const t = drawing();
    await t.bus.script(['-BLOCK', '?', '']);
    expect(t.log).toContain('Defined blocks.');
    expect(t.log).toContain('  "B"');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
  });
});

describe('-INSERT', () => {
  it('places a reference at the point, scale and rotation given, saying the units', async () => {
    const t = drawing();
    await t.bus.submit('-INSERT');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    await t.bus.submit('b');
    expect(t.log).toContain('Units: Unitless   Conversion:  1.0000');
    expect(t.bus.promptText).toBe('Specify insertion point or [Basepoint/Scale/X/Y/Z/Rotate]:');
    await t.bus.submit('10,20');
    expect(t.bus.promptText).toBe(
      'Enter X scale factor, specify opposite corner, or [Corner/XYZ] <1>:',
    );
    await t.bus.submit('2');
    expect(t.bus.promptText).toBe('Enter Y scale factor <use X scale factor>:');
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Specify rotation angle <0>:');
    await t.bus.submit('90');
    expect(t.bus.promptText).toBe('Command:');
    const ref = t.inserts().at(-1)!;
    expect(ref).toMatchObject({
      block: B,
      position: { x: 10, y: 20 },
      scale: { x: 2, y: 2, z: 2 },
    });
    expect(ref.rotation).toBeCloseTo(Math.PI / 2, 12);
    // The name is offered next time.
    await t.bus.submit('-INSERT');
    expect(t.bus.promptText).toBe('Enter block name or [?] <B>:');
  });

  it('takes a different Y scale, a corner, and the presets', async () => {
    const t = drawing();
    await t.bus.script(['-INSERT', 'B', '0,0', '2', '3', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 2, y: 3, z: 2 });

    await t.bus.script(['-INSERT', 'B', '0,0', 'C', '4,5', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 4, y: 5, z: 4 });

    await t.bus.script(['-INSERT', 'B', '0,0', 'XYZ', '2', '3', '4', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 2, y: 3, z: 4 });

    await t.bus.script(['-INSERT', 'B', 'S']);
    expect(t.bus.promptText).toBe('Specify scale factor for XYZ axes <1>:');
    await t.bus.script(['3', 'R']);
    expect(t.bus.promptText).toBe('Specify rotation angle <0>:');
    await t.bus.submit('45');
    expect(t.bus.promptText).toBe('Specify insertion point or [Basepoint/Scale/X/Y/Z/Rotate]:');
    await t.bus.submit('7,7');
    expect(t.bus.promptText).toBe('Command:');
    const ref = t.inserts().at(-1)!;
    expect(ref.scale).toEqual({ x: 3, y: 3, z: 3 });
    expect(ref.rotation).toBeCloseTo(Math.PI / 4, 12);

    await t.bus.script(['-INSERT', 'B', 'X', '2', 'Y', '-1', '1,1', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 2, y: -1, z: 1 });
  });

  it('Basepoint puts another point of the block at the insertion point', async () => {
    const t = drawing();
    await t.bus.script(['-INSERT', 'B', 'B']);
    expect(t.bus.promptText).toBe('Specify base point:');
    // The circle's centre (1,0) of block B goes to (10,10), the block scaled by 2.
    await t.bus.script(['1,0', '10,10', '2', '', '0']);
    const ref = t.inserts().at(-1)!;
    expect(ref.position).toEqual({ x: 8, y: 10 });
  });

  it('refuses a name with no block, and an xref', async () => {
    const t = drawing();
    await t.bus.script(['-INSERT', 'NOPE']);
    expect(t.log).toContain('Block "NOPE" not found.');
    expect(t.bus.promptText).toBe('Command:');
  });

  it("scales a block in other units into the drawing's", async () => {
    const t = drawing();
    // Drawing in millimetres; block made while the drawing was in inches.
    setHeader(t.model, '$INSUNITS', 1);
    await t.bus.script(['-BLOCK', 'INCH', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('30')!] });
    setHeader(t.model, '$INSUNITS', 4);
    await t.bus.script(['-INSERT', 'INCH']);
    expect(t.log).toContain('Units: Inches   Conversion:  25.4000');
    await t.bus.script(['0,0', '2', '', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 50.8, y: 50.8, z: 50.8 });
  });

  it("*NAME inserts the block's contents exploded", async () => {
    const t = drawing();
    const before = t.space().length;
    await t.bus.submit('-INSERT');
    await t.bus.submit('*B');
    expect(t.bus.promptText).toBe('Specify insertion point or [Basepoint/Scale/Rotate]:');
    await t.bus.submit('10,0');
    expect(t.bus.promptText).toBe('Specify scale factor for XYZ axes <1>:');
    await t.bus.submit('2');
    expect(t.bus.promptText).toBe('Specify rotation angle <0>:');
    await t.bus.submit('0');
    const added = t.space().slice(before);
    expect(added.map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    expect(added[1]!.geom).toMatchObject({ center: { x: 12, y: 0 }, radius: 1 });
  });

  it('asks each attribute value in order, taking presets, skipping constants, verifying', async () => {
    const t = await withTitle();
    expect(t.space().map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    await t.bus.script(['-INSERT', 'TITLE', '100,0', '2', '', '0']);
    expect(t.log.at(-1)).toBe('Enter attribute values');
    expect(t.bus.promptText).toBe('Drawing number <A-1>:');
    await t.bus.submit('M-101');
    expect(t.bus.promptText).toBe('CHK <XX>:');
    await t.bus.submit('JS');
    expect(t.log.at(-1)).toBe('Verify attribute values');
    expect(t.bus.promptText).toBe('CHK <JS>:');
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Command:');
    const ref = t.inserts().at(-1)!;
    expect(ref.attributes.map((a) => [a.tag, a.value])).toEqual([
      ['NO', 'M-101'],
      ['REV', '0'],
      ['CHK', 'JS'],
    ]);
    // Placed as the definitions are in the block, scaled by 2 about the insertion point.
    expect(ref.attributes[0]!.position).toEqual({ x: 104, y: 4 });
    expect(ref.attributes[0]!.height).toBe(5);
    expect(new Set(ref.attributes.map((a) => a.handle)).size).toBe(3);
    expect(ref.attributes.every((a) => a.handle !== '0')).toBe(true);
  });

  it('takes the default values with ATTREQ 0', async () => {
    const t = await withTitle();
    setHeader(t.model, '$ATTREQ', 0);
    await t.bus.script(['-INSERT', 'TITLE', '0,50', '1', '', '90']);
    expect(t.bus.promptText).toBe('Command:');
    const ref = t.inserts().at(-1)!;
    expect(ref.attributes.map((a) => a.value)).toEqual(['A-1', '0', 'XX']);
    // Turned with the block: NO at (2,2) goes to (-2,52).
    expect(ref.attributes[0]!.position.x).toBeCloseTo(-2, 9);
    expect(ref.attributes[0]!.position.y).toBeCloseTo(52, 9);
    expect(ref.attributes[0]!.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it('is one undo step, and Esc at a prompt adds nothing', async () => {
    const t = drawing();
    const n = t.space().length;
    await t.bus.script(['-INSERT', 'B', '0,0']);
    await t.bus.cancel();
    expect(t.space()).toHaveLength(n);
    await t.bus.script(['-INSERT', 'B', '0,0', '', '', '0', 'U']);
    expect(t.space()).toHaveLength(n);
  });

  it('runs as INSERT too until its dialog comes (BLOCK opens its dialog, M5-01 part 2)', async () => {
    const t = drawing();
    await t.bus.submit('I');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    await t.bus.cancel();
    await t.bus.submit('B');
    expect(t.bus.prompt?.kind).toBe('dialog');
  });
});

describe('BASE', () => {
  it('sets the insertion base point, offering the current one', async () => {
    const t = drawing();
    await t.bus.submit('BASE');
    expect(t.bus.promptText).toBe('Enter base point <0.0000,0.0000,0.0000>:');
    await t.bus.submit('10,20');
    expect(t.model.header.get('$INSBASE')).toEqual({ x: 10, y: 20, z: 0 });
    await t.bus.submit('BASE');
    expect(t.bus.promptText).toBe('Enter base point <10.0000,20.0000,0.0000>:');
  });
});

describe('-BLOCK, -INSERT and BASE: ends and refusals', () => {
  it('end without a change at Enter where nothing is offered', async () => {
    const t = drawing();
    const n = t.space().length;
    const ends = async (lines: string[]) => {
      await t.bus.script(lines);
      await t.bus.submit('');
      expect(t.bus.promptText).toBe('Command:');
    };
    await ends(['-BLOCK']);
    await ends(['-BLOCK', 'NEW']);
    await ends(['-INSERT']);
    await ends(['-INSERT', 'B']);
    await ends(['-INSERT', 'B', 'B']);
    await ends(['-INSERT', 'B', '0,0', 'C']);
    await ends(['BASE']);
    expect(t.space()).toHaveLength(n);
    expect(t.blockNamed('NEW')).toBeUndefined();
    expect(t.model.header.get('$INSBASE')).toBeUndefined();
  });

  it('lists the blocks matching a pattern, the name then asked again', async () => {
    const t = await withTitle();
    await t.bus.script(['-INSERT', '?', 'T*']);
    expect(t.log).toContain('  "TITLE"');
    expect(t.log).not.toContain('  "B"');
    expect(t.log.at(-1)).toBe('2         0            0            0');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Command:');
  });

  it('takes the X and Y scale from a corner picked at the scale prompt; refuses a zero scale', async () => {
    const t = drawing();
    await t.bus.script(['-INSERT', 'B', '1,1', '5,4']);
    expect(t.bus.promptText).toBe('Specify rotation angle <0>:');
    await t.bus.submit('0');
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 4, y: 3, z: 4 });
    await t.bus.script(['-INSERT', 'B', '1,1', 'C', '5,1']);
    expect(t.log.at(-1)).toBe('Value must be nonzero.');
    await t.bus.script(['0', '1']);
    expect(t.log.at(-1)).toBe('Value must be nonzero.');
    await t.bus.script(['2', '', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 2, y: 2, z: 2 });
  });

  it('presets Z alone, and XYZ takes X for Y and Z at Enter', async () => {
    const t = drawing();
    await t.bus.script(['-INSERT', 'B', 'Z', '3', '0,0', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 1, y: 1, z: 3 });
    await t.bus.script(['-INSERT', 'B', '0,0', 'XYZ', '', '', '', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('asks one scale for a block that scales uniformly', async () => {
    const t = drawing();
    const b = new ChangeSetBuilder(t.model);
    b.updateTableRecord('blockRecords', B, { scalable: false });
    t.model.apply(b.build());
    await t.bus.script(['-INSERT', 'B', '0,0']);
    expect(t.bus.promptText).toBe('Specify scale factor for XYZ axes <1>:');
    await t.bus.script(['2', '0']);
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 2, y: 2, z: 2 });
  });

  it('refuses an external reference, to redefine or to insert', async () => {
    const t = drawing();
    const b = new ChangeSetBuilder(t.model);
    b.addBlock({ name: 'XR', basePoint: { x: 0, y: 0 }, flags: 4 });
    t.model.apply(b.build());
    await t.bus.script(['-BLOCK', 'xr']);
    expect(t.log.at(-1)).toBe('Block "XR" is an external reference.');
    await t.bus.script(['-INSERT', 'XR']);
    expect(t.log.at(-1)).toBe('Block "XR" is an external reference.');
    await t.bus.script(['-INSERT', '**MODEL_SPACE']);
    expect(t.log.at(-1)).toBe('Block "*MODEL_SPACE" not found.');
    expect(t.bus.promptText).toBe('Command:');
  });

  it('BASE in a layout sets the paper space insertion base point', async () => {
    const t = drawing();
    const bus = new PromptBus({
      model: t.model,
      registry: builtinCommands(),
      space: () => PAPER_SPACE,
    });
    await bus.script(['BASE', '3,4']);
    expect(t.model.header.get('$PINSBASE')).toEqual({ x: 3, y: 4, z: 0 });
    expect(t.model.header.get('$INSBASE')).toBeUndefined();
  });
});
