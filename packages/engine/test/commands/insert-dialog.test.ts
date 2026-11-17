// M5-01 part 3: INSERT's Insert dialog on the PromptBus, as AutoCAD 2024's (AutoCAD Help,
// "INSERT (Command)", "CLASSICINSERT (Command)", "Insert Dialog Box", "Blocks Palette",
// "ATTDIA (System Variable)"):
//   - Name (the drawing's blocks), Insertion point (Specify On-screen, X, Y), Scale (Specify
//     On-screen, X, Y, Z, Uniform Scale), Rotation (Specify On-screen, Angle), Block Unit (Unit,
//     Factor), Explode, and the Blocks palette's Repeat Placement;
//   - OK places the block: what is not Specify On-screen is taken from the dialog, the rest asked
//     with -INSERT's prompts; Explode places the contents, scaled uniformly; Repeat Placement asks
//     for another insertion point until Esc;
//   - ATTDIA 1 asks the attribute values in the Edit Attributes dialog (INSERT, -INSERT and
//     BLOCK's Convert to block alike), ATTDIA 0 at the command line;
//   - the dialog opens on the settings it was last closed with, on the block inserted last.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  stylePreviewModel,
  type AttdefGeometry,
  type DialogRequest,
  type DocumentModel,
  type EntityGeometry,
  type InsertDialogSettings,
  type InsertGeometry,
  type PromptAnswer,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { setup } from './edit-harness';

type Request = Extract<DialogRequest, { type: 'insert' }>;
type Attedit = Extract<DialogRequest, { type: 'attedit' }>;

function setHeader(model: DocumentModel, name: string, value: number): void {
  const b = new ChangeSetBuilder(model);
  b.setHeader(name, value);
  model.apply(b.build());
}

const line = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

const attdef = (tag: string, prompt: string, value: string, x: number, y: number, flags = 0) =>
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

/** The harness drawing (line 30, circle 31, block B: a line and a circle) with `extra`. */
function drawing(extra: EntityGeometry[] = []) {
  const t = setup(extra);
  const space = () => t.model.blockEntities(MODEL_SPACE).map((id) => t.model.entity(id)!);
  const inserts = () =>
    space()
      .filter((e) => e.geom.kind === 'INSERT')
      .map((e) => e.geom as InsertGeometry);
  const dialog = <T extends DialogRequest['type']>(type: T) => {
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe(type);
    return p!.dialog as Extract<DialogRequest, { type: T }>;
  };
  const request = () => dialog('insert') as Request;
  /** OK (or Cancel) with the dialog's settings changed by `patch`. */
  const answer = (patch: Partial<InsertDialogSettings>) =>
    t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      insert: { settings: { ...request().settings, ...patch } },
    } as PromptAnswer);
  return { ...t, space, inserts, dialog, request, answer };
}

/** The drawing with block TITLE (NO, REV preset, FIRM constant, CHK verify) made by -BLOCK. */
async function withTitle() {
  const t = drawing([
    line(0, 0, 40, 0),
    attdef('NO', 'Drawing number', 'A-1', 2, 2),
    attdef('REV', 'Revision', '0', 20, 2, 8),
    attdef('FIRM', '', 'OET', 30, 2, 2),
    attdef('CHK', '', 'XX', 2, 6, 4),
  ]);
  const ids = ['40', '41', '42', '43', '44'].map((h) => t.model.ids.idOf(h)!);
  await t.bus.script(['-BLOCK', 'TITLE', '0,0']);
  await t.bus.answer({ kind: 'selection', ids });
  return t;
}

describe('INSERT: the Insert dialog', () => {
  it('opens on the first block, insertion point on screen, scale 1 and rotation 0, listing the blocks', async () => {
    const t = drawing();
    setHeader(t.model, '$INSUNITS', 4);
    await t.bus.submit('I');
    const r = t.request();
    expect(r.settings).toEqual({
      name: 'B',
      pointOnScreen: true,
      point: { x: 0, y: 0 },
      scaleOnScreen: false,
      scale: { x: 1, y: 1, z: 1 },
      uniformScale: false,
      rotationOnScreen: false,
      rotation: 0,
      explode: false,
      repeat: false,
    });
    // B is unitless: no conversion into the millimetre drawing.
    expect(r.blocks).toEqual([
      {
        name: 'B',
        handle: '50',
        units: 0,
        factor: 1,
        scaleUniformly: false,
        allowExploding: true,
      },
    ]);
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
    expect(t.inserts()).toEqual([]);
  });

  it('asks the insertion point with the presets, taking the scale and rotation from the dialog', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    await t.answer({ scale: { x: 2, y: 3, z: 1 }, rotation: Math.PI / 6 });
    expect(t.bus.promptText).toBe('Specify insertion point or [Basepoint/Scale/X/Y/Z/Rotate]:');
    await t.bus.submit('10,5');
    expect(t.bus.promptText).toBe('Command:');
    const ref = t.inserts().at(-1)!;
    expect(ref.position).toEqual({ x: 10, y: 5 });
    expect(ref.scale).toEqual({ x: 2, y: 3, z: 1 });
    expect(ref.rotation).toBeCloseTo(Math.PI / 6, 12);
    expect(ref.block).toBe('50');
  });

  it('takes the insertion point from the dialog and asks the scale and rotation on screen', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    await t.answer({
      pointOnScreen: false,
      point: { x: 4, y: 6 },
      scaleOnScreen: true,
      rotationOnScreen: true,
    });
    expect(t.bus.promptText).toBe(
      'Enter X scale factor, specify opposite corner, or [Corner/XYZ] <1>:',
    );
    await t.bus.submit('2');
    expect(t.bus.promptText).toBe('Enter Y scale factor <use X scale factor>:');
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Specify rotation angle <0>:');
    await t.bus.submit('90');
    const ref = t.inserts().at(-1)!;
    expect(ref.position).toEqual({ x: 4, y: 6 });
    expect(ref.scale).toEqual({ x: 2, y: 2, z: 2 });
    expect(ref.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it('asks one scale factor with Uniform Scale on screen, and takes one from the dialog', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    await t.answer({ pointOnScreen: false, scaleOnScreen: true, uniformScale: true });
    expect(t.bus.promptText).toBe('Specify scale factor for XYZ axes <1>:');
    await t.bus.submit('3');
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 3, y: 3, z: 3 });
    // Uniform Scale off the screen: the X field is the scale.
    await t.bus.submit('INSERT');
    await t.answer({
      scaleOnScreen: false,
      uniformScale: true,
      scale: { x: 4, y: 9, z: 9 },
    });
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 4, y: 4, z: 4 });
  });

  it('places the contents exploded and uniformly scaled with Explode', async () => {
    const t = drawing();
    const before = t.space().length;
    await t.bus.submit('INSERT');
    await t.answer({ explode: true, scale: { x: 2, y: 5, z: 1 } });
    expect(t.bus.promptText).toBe('Specify insertion point or [Basepoint/Scale/Rotate]:');
    await t.bus.submit('10,0');
    const added = t.space().slice(before);
    expect(added.map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    expect(added[1]!.geom).toMatchObject({ center: { x: 12, y: 0 }, radius: 1 });
  });

  it('asks for insertion points until Esc with Repeat Placement, one undo step', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    await t.answer({ repeat: true, rotationOnScreen: true });
    await t.bus.script(['0,0', '0', '20,0', '90', '40,0', '180']);
    expect(t.bus.promptText).toBe('Specify insertion point or [Basepoint/Scale/X/Y/Z/Rotate]:');
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
    expect(t.inserts().map((r) => r.position.x)).toEqual([0, 20, 40]);
    await t.bus.submit('U');
    expect(t.inserts()).toEqual([]);
  });

  it('opens again with the settings it closed with, on the block inserted last', async () => {
    const t = await withTitle();
    setHeader(t.model, '$ATTREQ', 0);
    await t.bus.submit('INSERT');
    expect(t.request().settings.name).toBe('B');
    await t.answer({ name: 'TITLE', rotationOnScreen: true, scale: { x: 2, y: 2, z: 2 } });
    await t.bus.script(['0,0', '0']);
    await t.bus.submit('INSERT');
    expect(t.request().settings).toMatchObject({
      name: 'TITLE',
      rotationOnScreen: true,
      scale: { x: 2, y: 2, z: 2 },
    });
    expect(t.request().blocks.map((b) => b.name)).toEqual(['B', 'TITLE']);
  });

  it('opens again saying why for a block not found, an external reference or a zero scale', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    await t.answer({ name: 'NOPE' });
    expect(t.request().note).toBe('Block "NOPE" not found.');
    expect(t.request().settings.name).toBe('NOPE');
    await t.answer({ name: 'B', scale: { x: 0, y: 1, z: 1 } });
    expect(t.request().note).toBe('Value must be nonzero.');
    await t.answer({ scale: { x: 1, y: 1, z: 1 }, pointOnScreen: false, point: { x: 1, y: 2 } });
    expect(t.bus.promptText).toBe('Command:');
    expect(t.inserts().at(-1)!.position).toEqual({ x: 1, y: 2 });
  });

  it('scales a block that scales uniformly by its X factor whatever the dialog says', async () => {
    const t = drawing();
    const b = new ChangeSetBuilder(t.model);
    b.updateTableRecord('blockRecords', '50', { scalable: false });
    t.model.apply(b.build());
    await t.bus.submit('INSERT');
    expect(t.request().blocks[0]!.scaleUniformly).toBe(true);
    await t.answer({ pointOnScreen: false, scale: { x: 2, y: 7, z: 1 } });
    expect(t.inserts().at(-1)!.scale).toEqual({ x: 2, y: 2, z: 2 });
  });

  it('turns the rotation from the current UCS', async () => {
    const t = drawing();
    await t.bus.script(['UCS', 'Z', '90']);
    await t.bus.submit('INSERT');
    await t.answer({ pointOnScreen: false, point: { x: 10, y: 0 }, rotation: Math.PI / 2 });
    const ref = t.inserts().at(-1)!;
    // UCS X runs along world Y: (10,0) in the UCS is (0,10).
    expect(ref.position.x).toBeCloseTo(0, 9);
    expect(ref.position.y).toBeCloseTo(10, 9);
    expect(ref.rotation).toBeCloseTo(Math.PI, 12);
  });
});

describe('ATTDIA: the Edit Attributes dialog for new attribute values', () => {
  it('INSERT asks the values in the dialog with ATTDIA 1: prompts, defaults, no presets or constants', async () => {
    const t = await withTitle();
    setHeader(t.model, '$ATTDIA', 1);
    await t.bus.submit('INSERT');
    await t.answer({ name: 'TITLE', pointOnScreen: false, point: { x: 100, y: 0 } });
    const d: Attedit = t.dialog('attedit');
    expect(d.block).toBe('TITLE');
    expect(d.attributes.map((a) => [a.tag, a.prompt, a.value])).toEqual([
      ['NO', 'Drawing number', 'A-1'],
      ['CHK', 'CHK', 'XX'],
    ]);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [{ handle: d.attributes[0]!.handle, value: 'M-101' }],
    });
    expect(t.bus.promptText).toBe('Command:');
    const ref = t.inserts().at(-1)!;
    expect(ref.attributes.map((a) => [a.tag, a.value])).toEqual([
      ['NO', 'M-101'],
      ['REV', '0'],
      ['CHK', 'XX'],
    ]);
  });

  it('-INSERT asks them in the dialog too; Cancel there places nothing', async () => {
    const t = await withTitle();
    setHeader(t.model, '$ATTDIA', 1);
    const n = t.inserts().length;
    await t.bus.script(['-INSERT', 'TITLE', '0,0', '', '', '0']);
    t.dialog('attedit');
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
    expect(t.inserts()).toHaveLength(n);
  });

  it('asks nothing with ATTREQ 0, and at the command line with ATTDIA 0', async () => {
    const t = await withTitle();
    setHeader(t.model, '$ATTDIA', 1);
    setHeader(t.model, '$ATTREQ', 0);
    await t.bus.script(['-INSERT', 'TITLE', '0,0', '', '', '0']);
    expect(t.bus.promptText).toBe('Command:');
    expect(
      t
        .inserts()
        .at(-1)!
        .attributes.map((a) => a.value),
    ).toEqual(['A-1', '0', 'XX']);
    setHeader(t.model, '$ATTREQ', 1);
    setHeader(t.model, '$ATTDIA', 0);
    await t.bus.script(['-INSERT', 'TITLE', '0,0', '', '', '0']);
    expect(t.bus.promptText).toBe('Drawing number <A-1>:');
  });
});

describe('The Insert dialog preview', () => {
  it('is a drawing holding a reference to the block, with the blocks it nests', async () => {
    const t = drawing();
    await t.bus.script(['-INSERT', 'B', '0,0', '', '', '0']);
    await t.bus.script(['-BLOCK', 'OUTER', '0,0']);
    const ref = t.space().find((e) => e.geom.kind === 'INSERT')!;
    await t.bus.answer({ kind: 'selection', ids: [ref.id] });
    const outer = [...t.model.tables.blockRecords.values()].find((r) => r.name === 'OUTER')!;
    const pm = stylePreviewModel(t.model, { kind: 'block', block: outer.handle })!;
    const space = [...pm.tables.blockRecords.values()].find(
      (r) => r.name.toUpperCase() === '*MODEL_SPACE',
    )!;
    const drawn = pm.blockEntities(space.handle).map((id) => pm.entity(id)!.geom);
    expect(drawn).toEqual([expect.objectContaining({ kind: 'INSERT', block: outer.handle })]);
    expect(pm.blocks.has('50')).toBe(true);
    expect(pm.blockEntities('50')).toHaveLength(2);
  });
});
