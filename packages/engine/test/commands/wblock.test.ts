// M5-01 part 4: WBLOCK and a drawing file as a block, on the PromptBus, as AutoCAD 2024's (AutoCAD
// Help, "WBLOCK (Command)", "Write Block Dialog Box", "-WBLOCK (Command)", "-INSERT (Command)",
// "Insert Dialog Box", "About Inserting Blocks"):
//   - WBLOCK writes objects, a block or the whole drawing to a new drawing file: the objects (a
//     block's contents) with the base point at the new drawing's origin, its Insert units its
//     $INSUNITS; Retain, Convert to block or Delete from drawing; -WBLOCK asks the file, then
//     "Enter name of existing block or [= (block=output file)/* (whole drawing)] <define new
//     drawing>", and a new drawing's objects are erased (OOPS brings them back);
//   - -INSERT `name=file` (and a name no block has) makes block `name` of the drawing file's
//     model space, based at its $INSBASE, in its units, asking before redefining a block; the
//     Insert dialog's Browse... does the same with the file picked.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  PromptBus,
  blockFromClipboard,
  builtinCommands,
  clipboardHoldsBlock,
  drawingContent,
  fileBlockName,
  wblockFileName,
  type BusEvent,
  type Clipboard,
  type DialogRequest,
  type DocumentModel,
  type EntityGeometry,
  type InsertDialogSettings,
  type InsertGeometry,
  type PromptAnswer,
  type ViewReply,
  type ViewRequest,
  type WriteBlockSettings,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { host, setup } from './edit-harness';

type WriteBlock = Extract<ViewRequest, { op: 'writeBlock' }>;

const line = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

function setHeader(model: DocumentModel, name: string, value: unknown): void {
  const b = new ChangeSetBuilder(model);
  b.setHeader(name, value as never);
  model.apply(b.build());
}

/** Another drawing: two lines in model space, $INSBASE (5,5), inches (INSUNITS 1). */
function otherDrawing(): Clipboard {
  const o = setup([line(5, 5, 15, 5), line(5, 5, 5, 15)]);
  for (const h of ['30', '31']) {
    const b = new ChangeSetBuilder(o.model);
    b.removeEntity(o.model.ids.idOf(h)!);
    o.model.apply(b.build());
  }
  setHeader(o.model, '$INSBASE', { x: 5, y: 5, z: 0 });
  setHeader(o.model, '$INSUNITS', 1);
  return drawingContent(o.model).clipboard;
}

/**
 * The harness drawing on a bus whose app answers `drawingFile` with `files` (by name, the
 * extension optional) and records `writeBlock`.
 */
function drawing(files: Record<string, Clipboard> = {}, extra: EntityGeometry[] = []) {
  const t = setup(extra);
  const requests: ViewRequest[] = [];
  const canvas = host(() => t.model);
  const bus = new PromptBus({
    model: t.model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        requests.push(r);
        if (r.op === 'drawingFile') {
          const key = Object.keys(files).find(
            (k) => k.toUpperCase() === fileBlockName(r.file).toUpperCase(),
          );
          return Promise.resolve(
            key
              ? { ok: true, drawing: { name: `${key}.dxf`, content: files[key]! } }
              : { ok: true },
          );
        }
        if (r.op === 'writeBlock') return Promise.resolve({ ok: true, file: r.file });
        return canvas.request(r);
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const space = () => t.model.blockEntities(MODEL_SPACE).map((id) => t.model.entity(id)!);
  const inserts = () =>
    space()
      .filter((e) => e.geom.kind === 'INSERT')
      .map((e) => e.geom as InsertGeometry);
  const blockNamed = (name: string) =>
    [...t.model.tables.blockRecords.values()].find((r) => r.name === name);
  const contents = (name: string) =>
    t.model.blockEntities(blockNamed(name)!.handle).map((id) => t.model.entity(id)!.geom);
  const written = () => requests.filter((r): r is WriteBlock => r.op === 'writeBlock');
  const dialog = <T extends DialogRequest['type']>(type: T) => {
    const p = bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe(type);
    return p!.dialog as Extract<DialogRequest, { type: T }>;
  };
  return { ...t, bus, log, requests, space, inserts, blockNamed, contents, written, dialog };
}

const id = (t: { model: DocumentModel }, h: string) => t.model.ids.idOf(h)!;

describe('fileBlockName and wblockFileName', () => {
  it('names a block after its file, and writes DXF whatever was typed', () => {
    expect(fileBlockName('C:\\parts\\Door.dwg')).toBe('Door');
    expect(fileBlockName('sub/frame.DXF')).toBe('frame');
    expect(fileBlockName('plain')).toBe('plain');
    expect(wblockFileName('door.dwg')).toBe('door.dxf');
    expect(wblockFileName(' frame ')).toBe('frame.dxf');
    expect(wblockFileName('')).toBe('new block.dxf');
  });
});

describe('drawingContent and blockFromClipboard', () => {
  it('takes a drawing’s model space based at its $INSBASE, in its units', () => {
    const clip = otherDrawing();
    expect(clip.base).toEqual({ x: 5, y: 5 });
    expect(clip.insUnits).toBe(1);
    expect(clip.entities.map((e) => e.geom)).toEqual([line(5, 5, 15, 5), line(5, 5, 5, 15)]);
    expect(clipboardHoldsBlock(clip, 'b')).toBe(false);
  });

  it('makes the block as the drawing lies, or redefines one of the name', () => {
    const t = setup();
    const clip = otherDrawing();
    const b = new ChangeSetBuilder(t.model);
    const made = blockFromClipboard(b, t.model, clip, 'frame');
    t.model.apply(b.build());
    expect(made.redefined).toBe(false);
    const r = t.model.tables.blockRecords.get(made.block)!;
    expect(r.name).toBe('frame');
    expect(r.units).toBe(1);
    expect(t.model.blocks.get(made.block)!.basePoint).toEqual({ x: 5, y: 5 });
    expect(t.model.blockEntities(made.block).map((i) => t.model.entity(i)!.geom)).toEqual([
      line(5, 5, 15, 5),
      line(5, 5, 5, 15),
    ]);
    // B (a line and a circle) redefined: its contents replaced, its units the file's.
    const again = new ChangeSetBuilder(t.model);
    const redone = blockFromClipboard(again, t.model, clip, 'B');
    t.model.apply(again.build());
    expect(redone.redefined).toBe(true);
    expect(t.model.blockEntities(redone.block)).toHaveLength(2);
    expect(t.model.tables.blockRecords.get(redone.block)!.units).toBe(1);
  });
});

describe('-INSERT of a drawing file', () => {
  it('name=file makes the block of the file and inserts it, scaled into the drawing’s units', async () => {
    const t = drawing({ frame: otherDrawing() });
    await t.bus.script(['-INSERT', 'door=frame.dxf']);
    expect(t.requests).toContainEqual({ op: 'drawingFile', file: 'frame.dxf' });
    expect(t.contents('door')).toEqual([line(5, 5, 15, 5), line(5, 5, 5, 15)]);
    // Inches into the millimetre drawing.
    expect(t.log).toContain('Units: Inches   Conversion:  25.4000');
    await t.bus.script(['100,100', '1', '', '0']);
    expect(t.bus.promptText).toBe('Command:');
    expect(t.inserts()).toHaveLength(1);
    expect(t.inserts()[0]).toMatchObject({
      block: t.blockNamed('door')!.handle,
      position: { x: 100, y: 100 },
      scale: { x: 25.4, y: 25.4, z: 25.4 },
    });
  });

  it('a name no block has is the file of that name; none found is a block not found', async () => {
    const t = drawing({ frame: otherDrawing() });
    await t.bus.script(['-INSERT', 'frame', '0,0', '', '', '']);
    expect(t.inserts()[0]!.block).toBe(t.blockNamed('frame')!.handle);
    await t.bus.script(['-INSERT', 'nope']);
    expect(t.log.at(-1)).toBe('Block "nope" not found.');
    await t.bus.script(['-INSERT', 'x=nope.dxf']);
    expect(t.log.at(-1)).toBe('File "nope.dxf" not found.');
    expect(t.bus.promptText).toBe('Command:');
  });

  it('asks before redefining a block of the name: No inserts it as it is, Yes redefines it', async () => {
    const t = drawing({ frame: otherDrawing() });
    await t.bus.script(['-INSERT', 'B=frame']);
    expect(t.bus.promptText).toBe('Block "B" already exists. Redefine it? [Yes/No] <No>:');
    await t.bus.submit('');
    expect(t.requests.some((r) => r.op === 'drawingFile')).toBe(false);
    expect(t.contents('B').map((g) => g.kind)).toEqual(['LINE', 'CIRCLE']);
    await t.bus.script(['0,0', '', '', '']);
    await t.bus.script(['-INSERT', 'B=', 'Y']);
    // `B=` is the file named as the block.
    expect(t.requests).toContainEqual({ op: 'drawingFile', file: 'B' });
    expect(t.log).toContain('File "B" not found.');
    await t.bus.script(['-INSERT', 'B=frame', 'Y']);
    expect(t.log).toContain('Block "B" redefined.');
    expect(t.contents('B')).toEqual([line(5, 5, 15, 5), line(5, 5, 5, 15)]);
  });

  it('refuses a file that holds a block of the name, an invalid name and an xref', async () => {
    // A drawing holding block B, inserted as B, would hold itself.
    const o = setup([
      {
        kind: 'INSERT',
        block: '50',
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      } as EntityGeometry,
    ]);
    const t = drawing({ holder: drawingContent(o.model).clipboard });
    await t.bus.script(['-INSERT', 'B=holder', 'Y']);
    expect(t.log.at(-1)).toBe('Block "B" references itself.');
    await t.bus.script(['-INSERT', 'a<b=holder']);
    expect(t.log.at(-1)).toBe('Invalid block name.');
    expect(t.bus.promptText).toBe('Command:');
  });
});

describe('INSERT: a drawing file picked with Browse...', () => {
  const ok = (
    t: ReturnType<typeof drawing>,
    patch: Partial<InsertDialogSettings>,
    drawingFile?: { file: string; content?: Clipboard; redefine: boolean },
  ) =>
    t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      insert: {
        settings: { ...t.dialog('insert').settings, ...patch },
        ...(drawingFile && { drawing: drawingFile }),
      },
    } as PromptAnswer);

  it('makes the block of the file and places it as the dialog says', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    expect(t.dialog('insert').units).toBe(4);
    await ok(
      t,
      { name: 'frame', pointOnScreen: false, point: { x: 10, y: 0 } },
      { file: 'frame.dxf', content: otherDrawing(), redefine: false },
    );
    expect(t.bus.promptText).toBe('Command:');
    expect(t.contents('frame')).toEqual([line(5, 5, 15, 5), line(5, 5, 5, 15)]);
    expect(t.inserts()[0]).toMatchObject({
      block: t.blockNamed('frame')!.handle,
      position: { x: 10, y: 0 },
      scale: { x: 25.4, y: 25.4, z: 25.4 },
    });
  });

  it('keeps the block of the name as it is unless the dialog redefines it', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    await ok(
      t,
      { name: 'B', pointOnScreen: false },
      { file: 'B.dxf', content: otherDrawing(), redefine: false },
    );
    expect(t.contents('B').map((g) => g.kind)).toEqual(['LINE', 'CIRCLE']);
    await t.bus.submit('INSERT');
    await ok(
      t,
      { name: 'B', pointOnScreen: false },
      { file: 'B.dxf', content: otherDrawing(), redefine: true },
    );
    expect(t.contents('B')).toEqual([line(5, 5, 15, 5), line(5, 5, 5, 15)]);
    expect(t.inserts()).toHaveLength(2);
  });

  it('opens again saying why, keeping the file picked, for a name it refuses', async () => {
    const t = drawing();
    await t.bus.submit('INSERT');
    await ok(
      t,
      { name: 'a<b', pointOnScreen: false },
      { file: 'frame.dxf', content: otherDrawing(), redefine: false },
    );
    const again = t.dialog('insert');
    expect(again.note).toBe('Invalid block name.');
    expect(again.file).toBe('frame.dxf');
    // The file picked is still the one OK takes, without its contents sent again.
    await ok(t, { name: 'frame', pointOnScreen: false }, { file: 'frame.dxf', redefine: false });
    expect(t.contents('frame')).toHaveLength(2);
    expect(t.inserts()).toHaveLength(1);
  });
});

describe('-WBLOCK', () => {
  it('writes a new drawing of the objects, based at the point given, and erases them; OOPS restores them', async () => {
    const t = drawing();
    setHeader(t.model, '$LUNITS', 2);
    await t.bus.submit('-WBLOCK');
    expect(t.bus.promptText).toBe('Enter name of output file:');
    await t.bus.submit('door.dwg');
    expect(t.bus.promptText).toBe(
      'Enter name of existing block or [= (block=output file)/* (whole drawing)] <define new drawing>:',
    );
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Specify insertion base point:');
    await t.bus.submit('5,0');
    await t.bus.answer({ kind: 'selection', ids: [id(t, '30')] });
    expect(t.bus.promptText).toBe('Command:');
    const w = t.written();
    expect(w).toHaveLength(1);
    expect(w[0]!.file).toBe('door.dxf');
    expect(w[0]!.drawing!.content.base).toEqual({ x: 5, y: 0 });
    expect(w[0]!.drawing!.content.entities.map((e) => e.geom)).toEqual([line(0, 0, 10, 0)]);
    expect(w[0]!.drawing!.header).toMatchObject({
      $INSUNITS: 4,
      $INSBASE: { x: 0, y: 0, z: 0 },
      $LUNITS: 2,
      $LTSCALE: 1,
    });
    expect(t.log).toContain('Wrote door.dxf.');
    expect(t.byHandle('30')).toBeUndefined();
    await t.bus.submit('OOPS');
    expect(t.byHandle('30')).toBeDefined();
  });

  it('writes a block (= the one named as the file), or the whole drawing (*)', async () => {
    const t = drawing();
    await t.bus.script(['-WBLOCK', 'parts', 'B']);
    const block = t.written()[0]!.drawing!.content;
    expect(block.base).toEqual({ x: 0, y: 0 });
    expect(block.entities.map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    await t.bus.script(['-WBLOCK', 'B', '=']);
    expect(t.written()[1]!.file).toBe('B.dxf');
    expect(t.written()[1]!.drawing!.content.entities).toHaveLength(2);
    await t.bus.script(['-WBLOCK', 'all', '*']);
    expect(t.written()[2]).toEqual({ op: 'writeBlock', file: 'all.dxf' });
    await t.bus.script(['-WBLOCK', 'x', 'NOPE']);
    expect(t.log.at(-1)).toBe('Block "NOPE" not found.');
    expect(t.written()).toHaveLength(3);
    // Nothing erased.
    expect(t.byHandle('30')).toBeDefined();
  });

  it('writes nothing for Enter at the file name or no objects selected', async () => {
    const t = drawing();
    await t.bus.script(['-WBLOCK', '']);
    expect(t.bus.promptText).toBe('Command:');
    await t.bus.script(['-WBLOCK', 'f', '', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [] });
    expect(t.log.at(-1)).toBe('No objects selected.');
    expect(t.written()).toHaveLength(0);
  });

  it('leaves out a dimension without its block, saying so', async () => {
    const dim = {
      kind: 'DIMENSION',
      dimType: 'aligned',
      defPoint: { x: 0, y: 5 },
      xLine1: { x: 0, y: 0 },
      xLine2: { x: 10, y: 0 },
      textMidpoint: { x: 5, y: 5 },
      style: '0',
      measurement: 10,
    } as unknown as EntityGeometry;
    const t = drawing({}, [dim]);
    await t.bus.script(['-WBLOCK', 'f', '', '0,0']);
    await t.bus.answer({ kind: 'selection', ids: [id(t, '30'), id(t, '40')] });
    expect(t.written()[0]!.drawing!.content.entities.map((e) => e.geom.kind)).toEqual(['LINE']);
    expect(t.log).toContain('1 object was not written: a dimension without its block.');
  });
});

describe('WBLOCK: the Write Block dialog', () => {
  const answer = (
    t: ReturnType<typeof drawing>,
    patch: Partial<WriteBlockSettings>,
    pick?: 'point' | 'objects',
  ) =>
    t.bus.answer({
      kind: 'dialog',
      action: pick ? 'select' : 'ok',
      wblock: { settings: { ...t.dialog('wblock').settings, ...patch }, ...(pick && { pick }) },
    } as PromptAnswer);

  it('opens on Objects, Retain, the drawing’s units and "new block.dxf", listing the blocks', async () => {
    const t = drawing();
    await t.bus.submit('WBLOCK');
    const r = t.dialog('wblock');
    expect(r.settings).toEqual({
      source: 'objects',
      block: 'B',
      base: { x: 0, y: 0 },
      objects: 'retain',
      file: 'new block.dxf',
      units: 4,
    });
    expect(r.blocks).toEqual(['B']);
    expect(r.selected).toBe(0);
  });

  it('writes the objects picked, based at the point picked, in the Insert units, and keeps them', async () => {
    const t = drawing();
    await t.bus.submit('W');
    await answer(t, {}, 'point');
    expect(t.bus.promptText).toBe('Specify insertion base point:');
    await t.bus.submit('50,0');
    expect(t.dialog('wblock').settings.base).toEqual({ x: 50, y: 0 });
    await answer(t, {}, 'objects');
    await t.bus.answer({ kind: 'selection', ids: [id(t, '31')] });
    expect(t.dialog('wblock').selected).toBe(1);
    await answer(t, { file: 'hole', units: 1 });
    expect(t.bus.promptText).toBe('Command:');
    const w = t.written()[0]!;
    expect(w.file).toBe('hole.dxf');
    expect(w.drawing!.content.base).toEqual({ x: 50, y: 0 });
    expect(w.drawing!.header['$INSUNITS']).toBe(1);
    expect(t.byHandle('31')).toBeDefined();
    // The next WBLOCK opens on the Objects choice and units it closed with.
    await t.bus.submit('WBLOCK');
    expect(t.dialog('wblock').settings).toMatchObject({ objects: 'retain', units: 1 });
  });

  it('Delete from drawing erases the objects; Convert to block puts a block of the file’s name over them', async () => {
    const t = drawing();
    await t.bus.submit('WBLOCK');
    await answer(t, {}, 'objects');
    await t.bus.answer({ kind: 'selection', ids: [id(t, '30')] });
    await answer(t, { objects: 'delete' });
    expect(t.byHandle('30')).toBeUndefined();
    await t.bus.submit('OOPS');
    expect(t.byHandle('30')).toBeDefined();

    const u = drawing();
    await u.bus.submit('WBLOCK');
    await answer(u, {}, 'objects');
    await u.bus.answer({ kind: 'selection', ids: [id(u, '30')] });
    await answer(u, { objects: 'convert', file: 'beam.dxf', base: { x: 5, y: 0 } });
    expect(u.byHandle('30')).toBeUndefined();
    // The block holds the objects where they lie, based at the base point, as BLOCK makes one.
    expect(u.contents('beam')).toEqual([line(0, 0, 10, 0)]);
    expect(u.model.blocks.get(u.blockNamed('beam')!.handle)!.basePoint).toEqual({ x: 5, y: 0 });
    expect(u.inserts()).toEqual([
      expect.objectContaining({ block: u.blockNamed('beam')!.handle, position: { x: 5, y: 0 } }),
    ]);
    expect(u.written()).toHaveLength(1);
  });

  it('writes a block or the whole drawing', async () => {
    const t = drawing();
    await t.bus.submit('WBLOCK');
    await answer(t, { source: 'block', block: 'B', file: 'B.dxf' });
    expect(t.written()[0]!.drawing!.content.entities).toHaveLength(2);
    await t.bus.submit('WBLOCK');
    await answer(t, { source: 'drawing', file: 'everything' });
    expect(t.written()[1]).toEqual({ op: 'writeBlock', file: 'everything.dxf' });
  });

  it('opens again saying why: no objects, a block not found, a block of the file’s name to convert to', async () => {
    const t = drawing();
    await t.bus.submit('WBLOCK');
    await answer(t, {});
    expect(t.dialog('wblock').note).toBe('No objects selected.');
    await answer(t, { source: 'block', block: 'NOPE' });
    expect(t.dialog('wblock').note).toBe('Block "NOPE" not found.');
    await answer(t, { source: 'objects' }, 'objects');
    await t.bus.answer({ kind: 'selection', ids: [id(t, '30')] });
    await answer(t, { objects: 'convert', file: 'B' });
    expect(t.dialog('wblock').note).toBe('Block "B" already exists.');
    expect(t.written()).toHaveLength(0);
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
  });

  it('takes the objects selected before it as its objects', async () => {
    const t = drawing();
    await t.bus.pick({ x: 5, y: 0 });
    await t.bus.submit('WBLOCK');
    expect(t.dialog('wblock').selected).toBe(1);
    await answer(t, {});
    expect(t.written()[0]!.drawing!.content.entities.map((e) => e.geom)).toEqual([
      line(0, 0, 10, 0),
    ]);
  });

  it('says why the app could not write the file', async () => {
    const t = setup();
    const bus = new PromptBus({
      model: t.model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: 'Not written.' }) },
    });
    const log: string[] = [];
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['-WBLOCK', 'f', '', '0,0']);
    await bus.answer({ kind: 'selection', ids: [t.model.ids.idOf('30')!] });
    expect(log.at(-1)).toBe('Not written.');
    // Not erased: nothing was written.
    expect(t.model.ids.idOf('30')).toBeDefined();
    expect(t.model.entity(t.model.ids.idOf('30')!)).toBeDefined();
  });
});
