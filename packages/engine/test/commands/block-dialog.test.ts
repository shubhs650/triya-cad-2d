// M5-01 part 2: BLOCK's Block Definition dialog on the PromptBus, as AutoCAD 2024's (AutoCAD Help,
// "BLOCK (Command)", "Block Definition Dialog Box"):
//   - Name, Base point (Specify On-screen, Pick point, X and Y), Objects (Specify On-screen,
//     Select objects, Retain / Convert to block / Delete, "n objects selected"), Behavior (Scale
//     uniformly, Allow exploding), Settings (Block unit) and Description;
//   - Pick point and Select objects close the dialog for the pick and open it again;
//   - OK makes the block (or redefines the one of the name, which the dialog has confirmed), with
//     the settings; Convert to block puts a reference to it where the objects were, Delete erases
//     them (OOPS brings them back), Retain leaves them; Specify On-screen asks for the base point
//     or the objects at the command line once the dialog closes;
//   - objects selected when BLOCK starts are the dialog's objects (PICKFIRST).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  type AttdefGeometry,
  type BlockDefinitionSettings,
  type DialogRequest,
  type DocumentModel,
  type Entity,
  type EntityGeometry,
  type InsertGeometry,
  type PromptAnswer,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { r6, setup } from './edit-harness';

type Request = Extract<DialogRequest, { type: 'block' }>;

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

const attdef = (tag: string, prompt: string, value: string, x: number, y: number) =>
  ({
    kind: 'ATTDEF',
    tag,
    prompt,
    value,
    flags: 0,
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

/** The harness drawing (line 30, circle 31, block B) with `extra` from handle 40 on. */
function drawing(extra: EntityGeometry[] = []) {
  const t = setup(extra);
  const request = () => {
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('block');
    return p!.dialog as Request;
  };
  /** Answers the dialog with its settings changed by `patch`. */
  const answer = (
    patch: Partial<BlockDefinitionSettings>,
    action: 'ok' | 'select' = 'ok',
    pick?: 'point' | 'objects',
  ) =>
    t.bus.answer({
      kind: 'dialog',
      action,
      block: { settings: { ...request().settings, ...patch }, ...(pick && { pick }) },
    } as PromptAnswer);
  const id = (h: string) => t.model.ids.idOf(h)!;
  const recordNamed = (name: string) =>
    [...t.model.tables.blockRecords.values()].find((r) => r.name === name);
  const contents = (name: string): Entity[] =>
    t.model.blockEntities(recordNamed(name)!.handle).map((i) => t.model.entity(i)!);
  const inserts = () =>
    t
      .space()
      .filter((e) => e.geom.kind === 'INSERT')
      .map((e) => e.geom as InsertGeometry);
  return { ...t, request, answer, id, recordNamed, contents, inserts };
}

/** Opens the dialog, picks the base point and selects `ids`, ready for OK. */
async function ready(t: ReturnType<typeof drawing>, name: string, base: string, ids: string[]) {
  await t.bus.submit('BLOCK');
  await t.answer({ name }, 'select', 'point');
  expect(t.bus.promptText).toBe('Specify insertion base point:');
  await t.bus.submit(base);
  await t.answer({}, 'select', 'objects');
  expect(t.bus.promptText).toBe('Select objects:');
  await t.bus.answer({ kind: 'selection', ids: ids.map(t.id) });
}

describe('BLOCK: the Block Definition dialog', () => {
  it('opens on a blank name, base 0,0, Convert to block and the drawing units, listing the blocks', async () => {
    const t = drawing();
    setHeader(t.model, '$INSUNITS', 4);
    await t.bus.submit('B');
    const r = t.request();
    expect(r.settings).toEqual({
      name: '',
      base: { x: 0, y: 0 },
      baseOnScreen: false,
      objectsOnScreen: false,
      objects: 'convert',
      scaleUniformly: false,
      allowExploding: true,
      units: 4,
      description: '',
    });
    expect(r.selected).toBe(0);
    expect(r.blocks).toEqual([
      { name: 'B', scaleUniformly: false, allowExploding: true, units: 0, description: '' },
    ]);
    // Cancel makes nothing.
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
    expect(t.recordNamed('')).toBeUndefined();
  });

  it('Pick point and Select objects close the dialog and open it again with what was picked', async () => {
    const t = drawing();
    await ready(t, 'door', '5,2', ['30', '31']);
    const r = t.request();
    expect(r.settings.name).toBe('door');
    expect(r.settings.base).toEqual({ x: 5, y: 2 });
    expect(r.selected).toBe(2);
    // Esc at the pick opens the dialog again as it was.
    await t.answer({}, 'select', 'point');
    await t.bus.cancel();
    expect(t.request().settings.base).toEqual({ x: 5, y: 2 });
  });

  it('Convert to block makes the block and puts a reference where the objects were, one undo step', async () => {
    const t = drawing();
    await ready(t, 'door', '5,0', ['30']);
    await t.answer({});
    expect(t.bus.promptText).toBe('Command:');
    const r = t.recordNamed('door')!;
    expect(t.model.blocks.get(r.handle)!.basePoint).toEqual({ x: 5, y: 0 });
    expect(t.contents('door').map((e) => e.geom)).toEqual([line(0, 0, 10, 0)]);
    expect(t.byHandle('30')).toBeUndefined();
    expect(t.inserts()).toEqual([
      expect.objectContaining({
        block: r.handle,
        position: { x: 5, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      }),
    ]);
    await t.bus.submit('U');
    expect(t.recordNamed('door')).toBeUndefined();
    expect(t.byHandle('30')).toBeDefined();
    expect(t.inserts()).toEqual([]);
  });

  it('Retain leaves the objects; Delete erases them and OOPS brings them back', async () => {
    const t = drawing();
    await ready(t, 'kept', '0,0', ['30']);
    await t.answer({ objects: 'retain' });
    expect(t.byHandle('30')).toBeDefined();
    expect(t.contents('kept')).toHaveLength(1);
    expect(t.inserts()).toEqual([]);
    await ready(t, 'gone', '0,0', ['31']);
    await t.answer({ objects: 'delete' });
    expect(t.byHandle('31')).toBeUndefined();
    expect(t.inserts()).toEqual([]);
    await t.bus.submit('OOPS');
    expect(t.byHandle('31')).toBeDefined();
    // The dialog opens next on the last choice made.
    await t.bus.submit('BLOCK');
    expect(t.request().settings.objects).toBe('delete');
  });

  it('saves Scale uniformly, Allow exploding, the block unit and the description', async () => {
    const t = drawing();
    await ready(t, 'valve', '0,0', ['30']);
    await t.answer({
      scaleUniformly: true,
      allowExploding: false,
      units: 6,
      description: 'Gate valve',
    });
    const r = t.recordNamed('valve')!;
    expect(r).toMatchObject({ scalable: false, explodable: false, units: 6 });
    expect(t.model.blocks.get(r.handle)!.description).toBe('Gate valve');
    // The Name list now offers it with its settings.
    await t.bus.submit('BLOCK');
    expect(t.request().blocks).toContainEqual({
      name: 'valve',
      scaleUniformly: true,
      allowExploding: false,
      units: 6,
      description: 'Gate valve',
    });
  });

  it('redefines a block of the name with the new objects, base point and settings', async () => {
    const t = drawing([
      {
        kind: 'INSERT',
        block: '50',
        position: { x: 100, y: 100 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      },
    ]);
    await ready(t, 'b', '10,0', ['30']);
    await t.answer({ description: 'Redone', objects: 'retain' });
    expect(t.model.blocks.get('50')).toMatchObject({ name: 'B', basePoint: { x: 10, y: 0 } });
    expect(t.model.blocks.get('50')!.description).toBe('Redone');
    expect(t.contents('B').map((e) => e.geom)).toEqual([line(0, 0, 10, 0)]);
    // The reference draws the new contents: it is the same reference.
    expect(t.inserts()).toHaveLength(1);
  });

  it('Specify On-screen asks for the base point, then the objects, once the dialog closes', async () => {
    const t = drawing();
    await t.bus.submit('BLOCK');
    await t.answer({ name: 'later', baseOnScreen: true, objectsOnScreen: true });
    expect(t.bus.promptText).toBe('Specify insertion base point:');
    await t.bus.submit('1,1');
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.answer({ kind: 'selection', ids: [t.id('31')] });
    expect(t.bus.promptText).toBe('Command:');
    expect(t.model.blocks.get(t.recordNamed('later')!.handle)!.basePoint).toEqual({ x: 1, y: 1 });
    expect(t.inserts()).toHaveLength(1);
    // Nothing selected on screen makes no block.
    await t.bus.submit('BLOCK');
    await t.answer({ name: 'none', baseOnScreen: false, objectsOnScreen: true });
    await t.bus.answer({ kind: 'selection', ids: [] });
    expect(t.log).toContain('No objects selected.');
    expect(t.recordNamed('none')).toBeUndefined();
  });

  it('makes an empty block when OK is pressed with no objects (the dialog has asked)', async () => {
    const t = drawing();
    await t.bus.submit('BLOCK');
    await t.answer({ name: 'EMPTY' });
    expect(t.recordNamed('EMPTY')).toBeDefined();
    expect(t.contents('EMPTY')).toEqual([]);
    expect(t.inserts()).toEqual([]);
  });

  it('opens again saying why on an invalid name, an xref or a block holding itself', async () => {
    const t = drawing([
      {
        kind: 'INSERT',
        block: '50',
        position: { x: 100, y: 100 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      },
    ]);
    await t.bus.submit('BLOCK');
    await t.answer({ name: 'a<b' });
    expect(t.request().note).toBe('Invalid block name.');
    await t.answer({ name: '' });
    expect(t.request().note).toBe('Invalid block name.');
    await t.answer({ name: 'B' }, 'select', 'objects');
    await t.bus.answer({ kind: 'selection', ids: [t.id('40')] });
    await t.answer({});
    expect(t.request().note).toBe('Block "B" references itself.');
    await t.bus.cancel();
    expect(t.contents('B')).toHaveLength(2);
  });

  it('takes the objects selected when it starts (PICKFIRST)', async () => {
    const t = drawing();
    await t.bus.pick({ x: 5, y: 0 });
    await t.bus.submit('BLOCK');
    expect(t.request().selected).toBe(1);
    await t.answer({ name: 'pre' });
    expect(t.contents('pre').map((e) => e.geom)).toEqual([line(0, 0, 10, 0)]);
    expect(t.byHandle('30')).toBeUndefined();
  });

  it("asks the attribute values of a converted block's reference (ATTREQ 1), taking defaults at 0", async () => {
    const t = drawing([attdef('NO', 'Drawing number', 'A-1', 2, 2), line(0, 0, 40, 0)]);
    await ready(t, 'TITLE', '0,0', ['40', '41']);
    await t.answer({});
    expect(t.bus.promptText).toBe('Drawing number <A-1>:');
    await t.bus.submit('B-7');
    expect(t.bus.promptText).toBe('Command:');
    const [ref] = t.inserts();
    expect(ref!.attributes.map((a) => [a.tag, a.value, a.position])).toEqual([
      ['NO', 'B-7', { x: 2, y: 2 }],
    ]);
    const u = drawing([attdef('NO', 'Drawing number', 'A-1', 2, 2)]);
    setHeader(u.model, '$ATTREQ', 0);
    await ready(u, 'T2', '0,0', ['40']);
    await u.answer({});
    expect(u.inserts()[0]!.attributes.map((a) => a.value)).toEqual(['A-1']);
  });

  it('in a UCS: X and Y are in the UCS, and the reference is turned with it over the objects', async () => {
    const t = drawing();
    // A UCS at (10,0) turned 90°.
    await t.bus.script(['UCS', '10,0', '10,1', '9,0']);
    await t.bus.submit('BLOCK');
    await t.answer({ name: 'turned' }, 'select', 'point');
    await t.bus.submit('0,0');
    expect(t.request().settings.base).toEqual({ x: 0, y: 0 });
    await t.answer({}, 'select', 'objects');
    await t.bus.answer({ kind: 'selection', ids: [t.id('30')] });
    await t.answer({});
    const [ref] = t.inserts();
    expect(ref!.position).toEqual({ x: 10, y: 0 });
    expect(r6(ref!.rotation)).toBe(r6(Math.PI / 2));
    const g = t.contents('turned')[0]!.geom as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    expect([g.start.x, g.start.y, g.end.x, g.end.y].map(r6)).toEqual([0, 10, 0, 0]);
  });

  it('-BLOCK still asks at the command line', async () => {
    const t = drawing();
    await t.bus.submit('-B');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    expect(t.model.blockEntities(MODEL_SPACE)).toHaveLength(2);
  });
});
