// M5-03 part 2: BATTMAN, the Block Attribute Manager, as AutoCAD 2024's (AutoCAD Help, "BATTMAN
// (Command)", "Block Attribute Manager", "Edit Attribute Dialog Box (BATTMAN)", "Block Attribute
// Settings Dialog Box"):
//   - the dialog lists the drawing's blocks with attribute definitions, the selected block's
//     definitions in block order (constant ones too), and how many references there are in the
//     drawing and in the current space; a drawing without any says so and opens nothing;
//   - Apply (and OK) puts the Edit Attribute changes, Move Up/Down and Remove on the definitions,
//     each ATTDEF keeping its handle; with "Apply changes to existing references" every
//     reference then takes them as ATTSYNC gives them, a renamed tag keeping its value;
//   - Sync gives the references the definitions whatever the setting; Select block picks a
//     reference whose block the dialog then shows; the session is one undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  PromptBus,
  builtinCommands,
  type AttdefGeometry,
  type AttributeDefinitionPatch,
  type BattmanAnswer,
  type DialogRequest,
  type DocumentModel,
  type Entity,
  type EntityGeometry,
  type InsertGeometry,
  type PromptAnswer,
  type ViewHost,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE } from '../model/fixtures';
import { host, setup } from './edit-harness';

type Request = Extract<DialogRequest, { type: 'battman' }>;

const attdef = (tag: string, value: string, x: number, y: number, flags = 0): EntityGeometry =>
  ({
    kind: 'ATTDEF',
    tag,
    prompt: `${tag} prompt`,
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
 * Block TAG (base 0,0): a line, NO ("A-1" at 2,2), REV ("0" at 20,2), a circle, and constant
 * KIND ("PLATE"); references at (100,0) holding "M-101"/"3" and at (0,50) holding the defaults.
 * Block DOOR: definition W ("900"), referenced once in paper space-free model space at (0,-50).
 * Block B (the sample's) has no attributes.
 */
async function drawing(view?: (base: ViewHost) => ViewHost, o: { namedPlotStyles?: boolean } = {}) {
  const t = setup(
    [
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
      attdef('NO', 'A-1', 2, 2),
      attdef('REV', '0', 20, 2),
      { kind: 'CIRCLE', center: { x: 30, y: 5 }, radius: 1 },
      attdef('KIND', 'PLATE', 2, 8, 2),
      attdef('W', '900', 0, 0),
    ],
    o,
  );
  let bus = t.bus;
  if (view) {
    bus = new PromptBus({
      model: t.model,
      registry: builtinCommands(),
      view: view(host(() => t.model)),
    });
    bus.on((e) => {
      if (e.type === 'log') t.log.push(e.line);
    });
  }
  const idsOf = (...hs: string[]) => hs.map((h) => t.model.ids.idOf(h)!);
  await bus.script(['-BLOCK', 'TAG', '0,0']);
  await bus.answer({ kind: 'selection', ids: idsOf('40', '41', '42', '43', '44') });
  await bus.script(['-BLOCK', 'DOOR', '0,0']);
  await bus.answer({ kind: 'selection', ids: idsOf('45') });
  await bus.script(['-INSERT', 'TAG', '100,0', '1', '', '0', 'M-101', '3']);
  setHeader(t.model, '$ATTREQ', 0);
  await bus.script(['-INSERT', 'TAG', '0,50', '1', '', '0']);
  await bus.script(['-INSERT', 'DOOR', '0,-50', '1', '', '0']);
  const blockNamed = (name: string) =>
    [...t.model.tables.blockRecords.values()].find((r) => r.name === name)!.handle;
  const tag = blockNamed('TAG');
  const door = blockNamed('DOOR');
  const refs = (block = tag) =>
    t.model
      .blockEntities(MODEL_SPACE)
      .map((id) => t.model.entity(id)!)
      .filter((e) => e.geom.kind === 'INSERT' && (e.geom as InsertGeometry).block === block);
  const values = (e: Entity) =>
    (e.geom as InsertGeometry).attributes.map((a) => [a.tag, a.mtext?.contents ?? a.value]);
  const contents = (block = tag) =>
    t.model.blockEntities(block).map((id) => {
      const e = t.model.entity(id)!;
      return e.geom.kind === 'ATTDEF' ? (e.geom as AttdefGeometry).tag : e.geom.kind;
    });
  const definition = (name: string, block = tag) =>
    t.model
      .blockEntities(block)
      .map((id) => t.model.entity(id)!)
      .find((e) => e.geom.kind === 'ATTDEF' && (e.geom as AttdefGeometry).tag === name)!;
  const request = () => {
    const p = bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('battman');
    return p!.dialog as Request;
  };
  const handleOf = (name: string) => request().attributes.find((a) => a.tag === name)!.handle;
  /** The dialog closed by `action` with `m` over the request as it stands. */
  const close = (action: string, m: Partial<BattmanAnswer> = {}) => {
    const r = request();
    return bus.answer({
      kind: 'dialog',
      action,
      battman: {
        block: r.block,
        order: r.attributes.map((a) => a.handle),
        removed: [],
        attributes: [],
        applyToExisting: true,
        ...m,
      },
    } as PromptAnswer);
  };
  const patch = (name: string, p: Omit<AttributeDefinitionPatch, 'handle'>) => ({
    handle: handleOf(name),
    ...p,
  });
  return {
    ...t,
    bus,
    tag,
    door,
    refs,
    values,
    contents,
    definition,
    request,
    handleOf,
    close,
    patch,
  };
}

describe('BATTMAN', () => {
  it('says so in a drawing without attributed blocks', async () => {
    const t = setup();
    await t.bus.submit('BATTMAN');
    expect(t.log).toContain('This drawing contains no attributed blocks.');
    expect(t.bus.prompt?.kind).not.toBe('dialog');
  });

  it("lists the attributed blocks, the first one's definitions and its references", async () => {
    const t = await drawing();
    await t.bus.submit('BATTMAN');
    const r = t.request();
    expect(r.blocks.map((b) => b.name)).toEqual(['DOOR', 'TAG']);
    expect(r.block).toBe(t.door);
    expect(r.attributes.map((a) => [a.tag, a.prompt, a.value])).toEqual([['W', 'W prompt', '900']]);
    expect([r.inDrawing, r.inSpace, r.space]).toEqual([1, 1, 'model space']);
    await t.close('apply', { next: t.tag });
    const r2 = t.request();
    expect(r2.block).toBe(t.tag);
    // Constant definitions are listed too, in block order.
    expect(r2.attributes.map((a) => [a.tag, a.flags, a.lockPosition])).toEqual([
      ['NO', 0, false],
      ['REV', 0, false],
      ['KIND', 2, false],
    ]);
    expect([r2.inDrawing, r2.inSpace]).toEqual([2, 2]);
    // Cancel ends it without a change.
    await t.bus.cancel();
    expect(t.bus.prompt).toBeUndefined();
  });

  it('opens on the block of the first pre-selected reference with attributes', async () => {
    const t = await drawing();
    // Everything selected: the first reference with attributes (TAG's) names the block.
    await t.bus.selectAll();
    await t.bus.submit('BATTMAN');
    expect(t.request().block).toBe(t.tag);
  });

  it('edits a definition and its references, keeping values under a renamed tag', async () => {
    const t = await drawing();
    await t.bus.submit('BATTMAN');
    await t.close('apply', { next: t.tag });
    const no = t.definition('NO');
    await t.close('apply', {
      attributes: [
        t.patch('NO', {
          tag: 'part no',
          prompt: 'Part number',
          value: 'X-1',
          flags: 1 | 4,
          height: 5,
          layer: '0',
        }),
        t.patch('REV', { tag: 'RE V', color: { kind: 'aci', index: 1 } }),
      ],
      selected: no.handle,
    });
    // A tag with a space is refused: NO keeps its tag, the rest of its patch is taken.
    const d = t.definition('NO');
    expect(d.handle).toBe(no.handle);
    const g = d.geom as AttdefGeometry;
    expect([g.prompt, g.value, g.flags, g.height, d.layer]).toEqual([
      'Part number',
      'X-1',
      5,
      5,
      '0',
    ]);
    expect(t.definition('REV').color).toEqual({ kind: 'aci', index: 1 });
    // The dialog reopens on the same block with the same definition selected.
    expect(t.request().selected).toBe(no.handle);
    // The references take the definitions' properties, their values kept.
    const [a, b] = t.refs();
    expect(t.values(a!)).toEqual([
      ['NO', 'M-101'],
      ['REV', '3'],
    ]);
    expect(t.values(b!)).toEqual([
      ['NO', 'A-1'],
      ['REV', '0'],
    ]);
    const att = (a!.geom as InsertGeometry).attributes[0]!;
    expect([att.height, att.flags, att.layer]).toEqual([5, 5, '0']);
    // A tag renamed: the references keep the value under the new tag.
    await t.close('ok', { attributes: [t.patch('NO', { tag: 'part_no' })] });
    expect(t.bus.prompt).toBeUndefined();
    expect((t.definition('PART_NO').geom as AttdefGeometry).tag).toBe('PART_NO');
    expect(t.values(t.refs()[0]!)).toEqual([
      ['PART_NO', 'M-101'],
      ['REV', '3'],
    ]);
    // One undo step for the whole session.
    await t.bus.submit('U');
    expect(t.definition('NO')).toBeDefined();
    expect((t.definition('NO').geom as AttdefGeometry).height).toBe(2.5);
    expect(t.values(t.refs()[0]!)).toEqual([
      ['NO', 'M-101'],
      ['REV', '3'],
    ]);
  });

  it('leaves the references alone without "Apply changes to existing references"', async () => {
    const t = await drawing();
    await t.bus.submit('BATTMAN');
    await t.close('apply', { next: t.tag });
    await t.close('apply', {
      applyToExisting: false,
      attributes: [t.patch('NO', { tag: 'NUMBER', height: 4 })],
    });
    expect((t.definition('NUMBER').geom as AttdefGeometry).height).toBe(4);
    expect(t.values(t.refs()[0]!)).toEqual([
      ['NO', 'M-101'],
      ['REV', '3'],
    ]);
    expect((t.refs()[0]!.geom as InsertGeometry).attributes[0]!.height).toBe(2.5);
    // Sync gives them the definitions whatever the setting: NUMBER is new to them.
    await t.close('apply', { applyToExisting: false, sync: true });
    expect(t.values(t.refs()[0]!)).toEqual([
      ['NUMBER', 'A-1'],
      ['REV', '3'],
    ]);
  });

  it("moves definitions up and down, the block's other entities in place", async () => {
    const t = await drawing();
    await t.bus.submit('BATTMAN');
    await t.close('apply', { next: t.tag });
    expect(t.contents()).toEqual(['LINE', 'NO', 'REV', 'CIRCLE', 'KIND']);
    const handles = t.model.blockEntities(t.tag).map((id) => t.model.entity(id)!.handle);
    const [no, rev, kind] = ['NO', 'REV', 'KIND'].map(t.handleOf);
    // REV moved up, KIND moved up twice.
    await t.close('apply', { order: [kind!, rev!, no!] });
    expect(t.contents()).toEqual(['LINE', 'KIND', 'REV', 'CIRCLE', 'NO']);
    // Every entity keeps its handle.
    const now = t.model.blockEntities(t.tag).map((id) => t.model.entity(id)!.handle);
    expect([...now].sort()).toEqual([...handles].sort());
    expect(t.request().attributes.map((a) => a.tag)).toEqual(['KIND', 'REV', 'NO']);
    // The references follow the new order (constant KIND carries no attribute).
    expect(t.values(t.refs()[0]!)).toEqual([
      ['REV', '3'],
      ['NO', 'M-101'],
    ]);
    await t.bus.cancel();
    await t.bus.submit('U');
    expect(t.contents()).toEqual(['LINE', 'NO', 'REV', 'CIRCLE', 'KIND']);
  });

  it('removes a definition, never the last one', async () => {
    const t = await drawing();
    await t.bus.submit('BATTMAN');
    // DOOR has one definition: its removal is refused.
    await t.close('apply', { removed: [t.handleOf('W')], order: [] });
    expect(t.log).toContain('A block keeps at least one attribute definition.');
    expect(t.contents(t.door)).toEqual(['W']);
    await t.close('apply', { next: t.tag });
    const rev = t.handleOf('REV');
    await t.close('apply', {
      removed: [rev],
      order: t
        .request()
        .attributes.map((a) => a.handle)
        .filter((h) => h !== rev),
    });
    expect(t.contents()).toEqual(['LINE', 'NO', 'CIRCLE', 'KIND']);
    expect(t.values(t.refs()[0]!)).toEqual([['NO', 'M-101']]);
  });

  it("keeps constant and multiline kinds; a constant definition's prompt is not changed", async () => {
    const t = await drawing();
    await t.bus.submit('BATTMAN');
    await t.close('apply', { next: t.tag });
    await t.close('apply', {
      attributes: [
        t.patch('KIND', { flags: 1 | 8, prompt: 'Kind?', value: 'SHELF' }),
        t.patch('REV', { flags: 2 | 8, boundaryWidth: 20 }),
      ],
    });
    const kind = t.definition('KIND').geom as AttdefGeometry;
    expect([kind.flags, kind.prompt, kind.value]).toEqual([3, 'KIND prompt', 'SHELF']);
    const rev = t.definition('REV').geom as AttdefGeometry;
    // Preset taken, constant not; a single-line definition has no boundary width.
    expect([rev.flags, rev.mtext]).toEqual([8, undefined]);
  });

  it('edits a multiline default and boundary width', async () => {
    const t = await drawing();
    // A multiline definition made by -ATTDEF in a new block NOTE.
    await t.bus.script(['-ATTDEF', 'M', '', 'NOTE', 'Note', 'a\\Pb', '200,200', '2.5', '0', '10']);
    const id = t.model
      .blockEntities(MODEL_SPACE)
      .find((x) => t.model.entity(x)!.geom.kind === 'ATTDEF')!;
    await t.bus.script(['-BLOCK', 'NOTE', '200,200']);
    await t.bus.answer({ kind: 'selection', ids: [id] });
    await t.bus.submit('BATTMAN');
    await t.close('apply', {
      next: [...t.model.tables.blockRecords.values()].find((r) => r.name === 'NOTE')!.handle,
    });
    const r = t.request();
    expect(r.attributes.map((a) => [a.tag, a.value, a.multiline, a.boundaryWidth])).toEqual([
      ['NOTE', 'a\\Pb', true, 10],
    ]);
    await t.close('ok', {
      attributes: [{ handle: r.attributes[0]!.handle, value: 'c\\Pd', boundaryWidth: 30 }],
    });
    const g = t.model.entityByHandle(r.attributes[0]!.handle)!.geom as AttdefGeometry;
    expect([g.value, g.mtext?.contents, g.mtext?.width]).toEqual(['c\\Pd', 'c\\Pd', 30]);
  });

  it('keeps the insertion point when a definition is given another justification', async () => {
    const t = await drawing((base) => ({
      request: (r) =>
        r.op === 'textOutlines'
          ? Promise.resolve({
              ok: true,
              outlines: r.texts.map(() => ({ corners: [], width: 10, below: 0 })),
            })
          : base.request(r),
    }));
    await t.bus.submit('BATTMAN');
    await t.close('apply', { next: t.tag });
    await t.close('apply', { attributes: [t.patch('NO', { halign: 2, valign: 0 })] });
    const g = t.definition('NO').geom as AttdefGeometry;
    expect([g.halign, g.position, g.alignmentPoint]).toEqual([2, { x: -8, y: 2 }, { x: 2, y: 2 }]);
  });

  it('makes no change when nothing was changed', async () => {
    const t = await drawing();
    const undoable = t.model.handles.handSeed;
    await t.bus.submit('BATTMAN');
    await t.close('ok');
    expect(t.model.handles.handSeed).toBe(undoable);
    await t.bus.submit('U');
    // U undoes the last -INSERT, not an empty BATTMAN step.
    expect(t.refs(t.door)).toHaveLength(0);
  });

  it('shows the block of a reference picked with Select block', async () => {
    const t = await drawing();
    await t.bus.script(['-INSERT', 'B', '500,500', '1', '', '0']);
    const b = t.model
      .blockEntities(MODEL_SPACE)
      .map((x) => t.model.entity(x)!)
      .find(
        (e) =>
          e.geom.kind === 'INSERT' &&
          t.model.tables.blockRecords.get((e.geom as InsertGeometry).block)?.name === 'B',
      )!;
    await t.bus.submit('BATTMAN');
    expect(t.request().block).toBe(t.door);
    await t.close('select');
    expect(t.bus.promptText).toBe('Select a block:');
    // A line is not a block; block B has no attribute definitions.
    const line = t.model
      .blockEntities(MODEL_SPACE)
      .find((x) => t.model.entity(x)!.geom.kind === 'LINE')!;
    await t.bus.answer({ kind: 'selection', ids: [line] });
    expect(t.log).toContain('That object is not a block.');
    await t.bus.answer({ kind: 'selection', ids: [b.id] });
    expect(t.log).toContain('That block has no attribute definitions.');
    await t.bus.answer({ kind: 'selection', ids: [t.refs()[1]!.id] });
    expect(t.request().block).toBe(t.tag);
    // Enter at the prompt goes back on the block shown.
    await t.close('select');
    await t.bus.answer({ kind: 'selection', ids: [] });
    expect(t.request().block).toBe(t.tag);
  });

  it('counts the references in the layout shown, and offers named plot styles', async () => {
    const t = await drawing(undefined, { namedPlotStyles: true });
    const ref = t.refs()[0]!;
    t.model.apply(
      (() => {
        const b = new ChangeSetBuilder(t.model);
        b.addEntity({ owner: PAPER_SPACE, layer: '10', geom: { ...ref.geom } as EntityGeometry });
        return b.build();
      })(),
    );
    const paper = new PromptBus({
      model: t.model,
      registry: builtinCommands(),
      view: host(() => t.model),
      space: () => PAPER_SPACE,
    });
    await paper.submit('BATTMAN');
    const r = (paper.prompt as { dialog: Request }).dialog;
    expect([r.block, r.inDrawing, r.inSpace, r.space]).toEqual([t.door, 1, 0, 'Layout1']);
    await paper.answer({
      kind: 'dialog',
      action: 'apply',
      battman: {
        block: r.block,
        order: [],
        removed: [],
        attributes: [],
        applyToExisting: true,
        next: t.tag,
      },
    });
    const r2 = (paper.prompt as { dialog: Request }).dialog;
    expect([r2.inDrawing, r2.inSpace]).toEqual([3, 1]);
    expect(r2.plotStyles?.map((p) => p.name)).toEqual(['NORMAL', 'HEAVY']);
    // A plot style given, then taken back to ByLayer.
    const no = r2.attributes[0]!.handle;
    const close = (plotStyle: string | null) =>
      paper.answer({
        kind: 'dialog',
        action: 'apply',
        battman: {
          block: t.tag,
          order: r2.attributes.map((a) => a.handle),
          removed: [],
          attributes: [{ handle: no, plotStyle }],
          applyToExisting: false,
        },
      });
    await close('80');
    expect(t.model.entityByHandle(no)!.plotStyle).toBe('80');
    await close(null);
    expect(t.model.entityByHandle(no)!.plotStyle).toBeUndefined();
  });

  it('reopens on the block shown when the dialog answers without its state', async () => {
    const t = await drawing();
    await t.bus.submit('BATTMAN');
    await t.bus.answer({ kind: 'dialog', action: 'apply' });
    expect(t.request().block).toBe(t.door);
    // A block erased meanwhile (PURGE from elsewhere) leaves the first block shown.
    await t.close('apply', { next: t.door, block: 'FFFF' });
    expect(t.request().block).toBe(t.door);
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(t.bus.prompt).toBeUndefined();
  });

  it('measures only the single-line definitions whose justification changes', async () => {
    const asked: number[] = [];
    const t = await drawing((base) => ({
      request: (r) => {
        if (r.op !== 'textOutlines') return base.request(r);
        asked.push(r.texts.length);
        return Promise.resolve({ ok: false, message: 'no fonts' });
      },
    }));
    await t.bus.submit('BATTMAN');
    await t.close('apply', { next: t.tag });
    await t.close('apply', {
      attributes: [
        t.patch('NO', { halign: 4, valign: 0 }),
        t.patch('REV', { height: 3 }),
        { handle: 'FFFF', height: 9 },
      ],
    });
    expect(asked).toEqual([1]);
    // Without an outline the insertion point stays where it was.
    const g = t.definition('NO').geom as AttdefGeometry;
    expect([g.halign, g.alignmentPoint]).toEqual([4, { x: 2, y: 2 }]);
  });
});
