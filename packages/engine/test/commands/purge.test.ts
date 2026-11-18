// M5-09 part 1: PURGE's rules (edit/purge.ts) and -PURGE's prompts (AutoCAD Help, "-PURGE
// (Command)", "Purge Dialog Box"): only what nothing uses goes, one level per -PURGE run,
// nested with purgeClosure; what AutoCAD never purges stays; zero-length geometry and empty text
// go from model space and the layouts, not from blocks or locked layers; one undo step.
// M5-09 part 2: PURGE's Purge dialog ("Purge Dialog Box"): Purgeable Items and Find
// Non-Purgeable Items, Purge Checked Items and Purge All, Confirm Purge for each item, nested
// items, unnamed objects, Possible Reasons, Details and Select Objects.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  purgeClosure,
  purgeHealth,
  purgeState,
  zeroLengthObjects,
  emptyTextObjects,
  type BusEvent,
  type DialogRequest,
  type DocumentInit,
  type EntityGeometry,
  type PromptAnswer,
  type PurgeAnswer,
  type ViewRequest,
  type NonGraphicalObject,
} from '../../src/index';
import {
  PAPER_SPACE,
  blockRecord,
  entityInit,
  layer,
  linetype,
  lineGeom,
  record,
  sampleInit,
} from '../model/fixtures';
import { host } from './edit-harness';

// Layers.
const L0 = '10';
const WALLS = '11';
const OLD = '12';
const INBLOCK = '13';
const FROZEN = '15';
const PINNED = '29';
const LOCKED = '2D';
// Linetypes.
const CONTINUOUS = '14';
const HIDDEN = '18';
const DASHED = '3B';
// Blocks.
const UNUSED = '17';
const NESTED = '19';
const USED = '1A';
// Text styles, applications, groups.
const STANDARD = '1C';
const NOTE = '1D';
const ACAD = '40';
const MYAPP = '25';
const USEDAPP = '26';
const EMPTY_GROUP = '27';
const FULL_GROUP = '28';
const SORTENTS = '2A';
const STATE = '2B';

const text = (value: string, extra: object = {}) =>
  ({
    kind: 'TEXT',
    value,
    style: STANDARD,
    position: { x: 0, y: 0 },
    height: 1,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    ...extra,
  }) as unknown as EntityGeometry;

const mtext = (contents: string) =>
  ({
    kind: 'MTEXT',
    contents,
    style: STANDARD,
    position: { x: 0, y: 0 },
    height: 1,
    width: 0,
    rotation: 0,
    attachment: 1,
  }) as unknown as EntityGeometry;

/** The drawing every test purges (see the handles above). */
function purgeInit(o: { pinned?: string[] } = {}): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    handSeed: '100',
    header: new Map([...init.header!, ['$DIMBLK', 'USED'], ['$TEXTSTYLE', 'Standard']]),
    tables: {
      ...init.tables,
      layers: [
        layer(L0, '0'),
        layer(WALLS, 'WALLS'),
        { ...layer(OLD, 'OLD'), linetype: HIDDEN },
        layer(INBLOCK, 'INBLOCK'),
        layer(FROZEN, 'FROZEN'),
        layer(PINNED, 'PINNED'),
        { ...layer(LOCKED, 'LOCKED'), locked: true },
        { ...layer('2C', 'Site|Walls'), flags: 16 | 32 },
      ],
      linetypes: [
        linetype(CONTINUOUS, 'Continuous'),
        linetype(HIDDEN, 'HIDDEN'),
        linetype(DASHED, 'DASHED'),
      ],
      textStyles: [
        { ...record(STANDARD, 'Standard') } as never,
        { ...record(NOTE, 'NOTE') } as never,
      ],
      appIds: [record(ACAD, 'ACAD'), record(MYAPP, 'MYAPP'), record(USEDAPP, 'USEDAPP')],
      blockRecords: [
        ...init.tables!.blockRecords!,
        blockRecord(UNUSED, 'UNUSED'),
        blockRecord(NESTED, 'NESTED'),
        blockRecord(USED, 'USED'),
        blockRecord('2F', '*D1'),
      ],
    },
    blocks: [
      ...init.blocks!,
      { handle: UNUSED, name: 'UNUSED', basePoint: { x: 0, y: 0 } },
      { handle: NESTED, name: 'NESTED', basePoint: { x: 0, y: 0 } },
      { handle: USED, name: 'USED', basePoint: { x: 0, y: 0 } },
      { handle: '2F', name: '*D1', basePoint: { x: 0, y: 0 } },
    ],
    objects: [
      ...init.objects!,
      {
        handle: EMPTY_GROUP,
        type: 'GROUP',
        owner: 'C',
        name: 'EMPTY',
        description: '',
        selectable: true,
        entities: [],
      } as NonGraphicalObject,
      {
        handle: FULL_GROUP,
        type: 'GROUP',
        owner: 'C',
        name: 'FULL',
        description: '',
        selectable: true,
        entities: ['20'],
      } as NonGraphicalObject,
      {
        handle: SORTENTS,
        type: 'SORTENTSTABLE',
        owner: 'C',
        block: UNUSED,
        entries: [],
      } as NonGraphicalObject,
      {
        handle: STATE,
        type: 'LAYER_STATE',
        owner: 'C',
        name: 'S1',
        description: '',
        mask: 0,
        paperSpace: false,
        currentLayer: '0',
        layers: [{ layer: FROZEN, name: 'FROZEN', linetype: DASHED }],
      } as unknown as NonGraphicalObject,
    ],
    ...(o.pinned && { purgePinned: o.pinned }),
    entities: [
      entityInit('20', lineGeom(0, 0, 10, 0), {
        xdata: [{ appId: USEDAPP, values: [{ code: 1000, value: 'x' }] }],
      }),
      entityInit('21', lineGeom(0, 1, 10, 1), { layer: WALLS }),
      entityInit('41', lineGeom(5, 5, 5, 5)),
      entityInit('42', lineGeom(6, 6, 6, 6), { layer: LOCKED }),
      entityInit(
        '43',
        { kind: 'CIRCLE', center: { x: 1, y: 1 }, radius: 0 },
        { owner: PAPER_SPACE },
      ),
      entityInit('2E', text('   ')),
      entityInit('30', mtext('{\\fArial|b0|i0;  }\\P ')),
      entityInit('31', text('A')),
      entityInit('32', text(' ', { field: { code: '%<\\AcVar Date>%' } })),
      entityInit('33', text('', {}), { layer: LOCKED }),
      entityInit('34', lineGeom(0, 0, 1, 0), { owner: UNUSED, layer: INBLOCK }),
      entityInit(
        '35',
        {
          kind: 'INSERT',
          block: NESTED,
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          attributes: [],
        } as unknown as EntityGeometry,
        { owner: UNUSED },
      ),
      entityInit('36', lineGeom(1, 1, 1, 1), { owner: UNUSED }),
      entityInit('37', lineGeom(0, 0, 0, 1), { owner: NESTED }),
      entityInit('38', {
        kind: 'INSERT',
        block: USED,
        position: { x: 50, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      } as unknown as EntityGeometry),
      entityInit('39', lineGeom(0, 0, 2, 0), { owner: '2F', layer: PINNED }),
      entityInit(
        '3A',
        {
          kind: 'VIEWPORT',
          center: { x: 5, y: 5 },
          width: 10,
          height: 10,
          id: 2,
          status: 2,
          flags: 0,
          viewCenter: { x: 0, y: 0 },
          viewHeight: 10,
          frozenLayers: [FROZEN],
        } as unknown as EntityGeometry,
        { owner: PAPER_SPACE },
      ),
    ],
    passthrough: ['3F'],
  };
}

function setup(o: { pinned?: string[] } = {}) {
  const model = DocumentModel.create(purgeInit(o));
  // The canvas measures objects as one box (the Purge dialog's Details) and zooms to them.
  const canvas = host(() => model, new Map());
  const requests: ViewRequest[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        requests.push(r);
        if (r.op === 'bounds')
          return Promise.resolve({ ok: true, box: { minX: 0, minY: 1, maxX: 10, maxY: 1 } });
        if (r.op === 'objects') return Promise.resolve({ ok: true });
        return canvas.request(r);
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const layers = () => [...model.tables.layers.values()].map((l) => l.name);
  const blocks = () => [...model.blocks.values()].map((b) => b.name);
  const has = (h: string) => model.entityByHandle(h) !== undefined;
  return { model, bus, log, layers, blocks, has, requests };
}

const names = (items: readonly { name: string }[]) => items.map((i) => i.name);

describe('purgeState', () => {
  it('lists what nothing uses, and what is in use with why', () => {
    const { model } = setup({ pinned: [PINNED] });
    const s = purgeState(model);
    expect(names(s.purgeable.filter((i) => i.category === 'layers'))).toEqual(['FROZEN', 'OLD']);
    expect(names(s.purgeable.filter((i) => i.category === 'blocks'))).toEqual(['UNUSED']);
    expect(names(s.purgeable.filter((i) => i.category === 'textStyles'))).toEqual(['NOTE']);
    expect(names(s.purgeable.filter((i) => i.category === 'appIds'))).toEqual(['MYAPP']);
    expect(names(s.purgeable.filter((i) => i.category === 'groups'))).toEqual(['EMPTY']);
    expect(s.purgeable.some((i) => i.category === 'linetypes')).toBe(false);
    const why = (name: string) => s.inUse.find((i) => i.name === name)?.reasons;
    expect(why('0')).toEqual(['0 is a default layer and cannot be purged.']);
    expect(why('WALLS')).toEqual(['1 object in the drawing uses it.', 'It is the current layer.']);
    expect(why('INBLOCK')).toEqual(['It is used in block "UNUSED".']);
    expect(why('NESTED')).toEqual(['It is used in block "UNUSED".']);
    expect(why('HIDDEN')).toEqual(['The layer "OLD" uses it.']);
    expect(why('USED')).toEqual([
      '1 object in the drawing uses it.',
      'The DIMBLK setting names it.',
    ]);
    expect(why('DASHED')).toEqual(['A layer state "S1" uses it.']);
    expect(why('PINNED')).toEqual([
      'It is used in block "*D1".',
      'Objects Triya keeps without editing them use it, or the file needs it.',
    ]);
    expect(why('Site|Walls')).toEqual(['It is xref-dependent: it goes when its xref is detached.']);
    expect(why('FULL')).toEqual(['It holds 1 object.']);
    expect(why('USEDAPP')).toEqual(['1 object in the drawing uses it.']);
    expect(why('Standard')).toEqual(['Standard is a default text style and cannot be purged.']);
    // Layout, anonymous and model space blocks are not listed.
    expect([...s.purgeable, ...s.inUse].some((i) => /^\*/.test(i.name))).toBe(false);
  });

  it('purgeClosure takes what only the purged items use, with nested', () => {
    const { model } = setup();
    const all = purgeState(model).purgeable.map((i) => i.handle);
    // One level: exactly what is purgeable now.
    expect(names(purgeClosure(model, all, false)).sort()).toEqual(
      names(purgeState(model).purgeable).sort(),
    );
    const nested = purgeClosure(model, all, true);
    expect(names(nested)).toEqual(
      expect.arrayContaining(['UNUSED', 'NESTED', 'INBLOCK', 'OLD', 'HIDDEN', 'FROZEN']),
    );
    // Blocks go first, so their objects go before the layers they are on.
    expect(nested[0]!.category).toBe('blocks');
    // Something used by a kept object never goes, nested or not.
    expect(names(nested)).not.toContain('WALLS');
    expect(names(nested)).not.toContain('USED');
    // Only purgeable items start a closure.
    expect(purgeClosure(model, [INBLOCK], true)).toEqual([]);
    // Nested items are what the chosen ones use: other unused items stay unless chosen.
    expect(names(purgeClosure(model, [UNUSED], true)).sort()).toEqual([
      'INBLOCK',
      'NESTED',
      'UNUSED',
    ]);
  });
});

describe('-PURGE', () => {
  it('purges unreferenced layers by name, from viewports and layer states too, one undo step', async () => {
    const t = setup();
    await t.bus.script(['-PURGE']);
    expect(t.bus.promptText).toBe(
      'Enter type of unused objects to purge [Blocks/DEtailviewstyles/Dimstyles/Groups/LAyers/LTypes/MAterials/MUltileaderstyles/Plotstyles/SHapes/textSTyles/Mlinestyles/SEctionviewstyles/Tablestyles/Visualstyles/Regapps/Zero-length geometry/Empty text objects/Orphaned data/All]:',
    );
    await t.bus.script(['LA']);
    expect(t.bus.promptText).toBe('Enter name(s) to purge <*>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Verify each name to be purged? [Yes/No] <Yes>:');
    await t.bus.script(['N']);
    expect(t.log).toContain('Deleting layer "FROZEN".');
    expect(t.log).toContain('Deleting layer "OLD".');
    expect(t.log).toContain('2 layers deleted.');
    expect(t.layers()).not.toContain('OLD');
    expect(t.layers()).not.toContain('FROZEN');
    const vp = t.model.entityByHandle('3A')!.geom;
    expect(vp.kind === 'VIEWPORT' && vp.frozenLayers).toEqual([]);
    const state = t.model.objects.get(STATE) as unknown as { layers: unknown[] };
    expect(state.layers).toEqual([]);
    // HIDDEN, which only OLD used, is purgeable on the next run.
    expect(names(purgeState(t.model).purgeable)).toContain('HIDDEN');
    await t.bus.script(['U']);
    expect(t.layers()).toContain('OLD');
    expect(t.layers()).toContain('FROZEN');
  });

  it('asks for each name when verifying, and takes names by wildcard', async () => {
    const t = setup();
    await t.bus.script(['-PURGE', 'LA', '*O*', 'Y']);
    expect(t.bus.promptText).toBe('Purge layer "FROZEN"? [Yes/No] <No>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Purge layer "OLD"? [Yes/No] <No>:');
    await t.bus.script(['Y']);
    expect(t.log).toContain('1 layer deleted.');
    expect(t.layers()).toContain('FROZEN');
    expect(t.layers()).not.toContain('OLD');
    await t.bus.script(['-PURGE', 'LA', 'X*', 'N']);
    expect(t.log).toContain('No unreferenced layers found.');
  });

  it('purges one level of blocks per run, with their objects and draw order', async () => {
    const t = setup();
    await t.bus.script(['-PURGE', 'B', '', 'N']);
    expect(t.log).toContain('Deleting block "UNUSED".');
    expect(t.log).toContain('1 block deleted.');
    expect(t.blocks()).not.toContain('UNUSED');
    expect(t.has('34') || t.has('35') || t.has('36')).toBe(false);
    expect(t.model.objects.has(SORTENTS)).toBe(false);
    await t.bus.script(['-PURGE', 'B', '', 'N']);
    expect(t.log).toContain('Deleting block "NESTED".');
    expect(t.blocks()).toContain('USED');
    await t.bus.script(['-PURGE', 'LA', '', 'N']);
    expect(t.log).toContain('Deleting layer "INBLOCK".');
  });

  it('All goes through every category, and says which have nothing', async () => {
    const t = setup();
    await t.bus.script(['-PURGE', 'A', '', 'N']);
    expect(t.log).toContain('1 block deleted.');
    expect(t.log).toContain('No unreferenced dimension styles found.');
    expect(t.log).toContain('Deleting group "EMPTY".');
    expect(t.log).toContain('Deleting text style "NOTE".');
    expect(t.log).toContain('Deleting registered application "MYAPP".');
    expect(t.log).toContain('No unreferenced linetypes found.');
    expect(t.model.objects.has(EMPTY_GROUP)).toBe(false);
    expect(t.model.objects.has(FULL_GROUP)).toBe(true);
    expect(t.model.tables.textStyles.has(NOTE)).toBe(false);
    expect(t.model.tables.appIds.has(MYAPP)).toBe(false);
    expect(t.model.tables.appIds.has(USEDAPP)).toBe(true);
    // One undo step for the whole run.
    await t.bus.script(['U']);
    expect(t.blocks()).toContain('UNUSED');
    expect(t.model.tables.appIds.has(MYAPP)).toBe(true);
  });

  it('deletes zero-length geometry and empty text, not in blocks or on locked layers', async () => {
    const t = setup();
    expect(zeroLengthObjects(t.model).length).toBe(2);
    expect(emptyTextObjects(t.model).length).toBe(2);
    await t.bus.script(['-PURGE', 'Z']);
    expect(t.log).toContain('2 zero-length geometry objects deleted.');
    expect(t.has('41') || t.has('43')).toBe(false);
    expect(t.has('42') && t.has('36')).toBe(true);
    await t.bus.script(['-PURGE', 'Z']);
    expect(t.log).toContain('No zero-length geometry found.');
    await t.bus.script(['-PURGE', 'E']);
    expect(t.log).toContain('2 empty text objects deleted.');
    expect(t.has('2E') || t.has('30')).toBe(false);
    // Text with something to show, a field, or on a locked layer stays.
    expect(t.has('31') && t.has('32') && t.has('33')).toBe(true);
    await t.bus.script(['-PURGE', 'E']);
    expect(t.log).toContain('No empty text objects found.');
  });

  it('ends at Esc, changing nothing', async () => {
    const t = setup();
    await t.bus.script(['-PURGE']);
    await t.bus.cancel();
    await t.bus.script(['-PURGE', 'LA']);
    await t.bus.cancel();
    await t.bus.script(['-PURGE', 'LA', '']);
    await t.bus.cancel();
    expect(t.layers()).toContain('OLD');
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('says what it does not purge', async () => {
    const t = setup();
    await t.bus.script(['-PURGE', 'SH']);
    expect(t.log).toContain('Shape files are kept as read: Triya does not purge them.');
    await t.bus.script(['-PURGE', 'O']);
    expect(t.log).toContain('Orphaned data is kept as read: Triya does not purge it.');
    await t.bus.script(['-PURGE', 'DE']);
    expect(t.log).toContain('No unreferenced detail view styles found.');
    await t.bus.script(['-PURGE', 'SE']);
    expect(t.log).toContain('No unreferenced section view styles found.');
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('leaves the pinned and passthrough records alone', async () => {
    const t = setup({ pinned: [NOTE] });
    await t.bus.script(['-PURGE', 'ST', '', 'N']);
    expect(t.log).toContain('No unreferenced text styles found.');
    expect(t.model.tables.textStyles.has(NOTE)).toBe(true);
  });
});

describe('The Purge dialog', () => {
  type Purge = Extract<DialogRequest, { type: 'purge' }>;
  const dialog = (bus: PromptBus): Purge => {
    const p = bus.prompt;
    if (p?.kind !== 'dialog' || p.dialog.type !== 'purge') throw new Error('no Purge dialog');
    return p.dialog;
  };
  const confirmShown = (bus: PromptBus) => {
    const p = bus.prompt;
    return p?.kind === 'dialog' && p.dialog.type === 'purgeconfirm' ? p.dialog : undefined;
  };
  /** The dialog's answer: its settings as shown, with `patch` and `action`. */
  const answer = (
    bus: PromptBus,
    patch: PurgeAnswer,
    action: 'apply' | 'ok' | 'select' = 'apply',
  ) =>
    bus.answer({
      kind: 'dialog',
      action,
      purge: { settings: dialog(bus).settings, view: dialog(bus).view, ...patch },
    } as PromptAnswer);
  const confirm = (bus: PromptBus, said: 'this' | 'all' | 'skip') =>
    bus.answer({ kind: 'dialog', action: 'ok', purge: { confirm: said } });
  const noConfirm = {
    confirm: false,
    nested: false,
    zeroLength: false,
    emptyText: false,
    orphaned: false,
  };

  it('opens on the purgeable items, the items in use with why, and its options', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    const d = dialog(t.bus);
    expect(d.view).toBe('purgeable');
    expect(names(d.purgeable)).toEqual(['UNUSED', 'EMPTY', 'FROZEN', 'OLD', 'NOTE']);
    // Registered applications are -PURGE's alone, as the help's note says.
    expect(d.purgeable.some((i) => i.category === 'appIds')).toBe(false);
    expect(d.inUse.some((i) => i.category === 'appIds')).toBe(false);
    expect(d.inUse.find((i) => i.name === 'WALLS')?.reasons).toEqual([
      '1 object in the drawing uses it.',
      'It is the current layer.',
    ]);
    expect(d.zeroLength).toBe(2);
    expect(d.emptyText).toBe(2);
    expect(d.settings).toEqual({
      confirm: true,
      nested: false,
      zeroLength: false,
      emptyText: false,
      orphaned: false,
    });
    await answer(t.bus, {}, 'ok');
    expect(t.bus.prompt).toBeUndefined();
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('Purge Checked Items purges what is checked and stays open, one undo step', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    await answer(t.bus, { settings: noConfirm, run: 'checked', checked: [OLD, NOTE, WALLS] });
    // WALLS is in use: only what is purgeable goes.
    expect(t.layers()).not.toContain('OLD');
    expect(t.layers()).toContain('WALLS');
    expect(t.model.tables.textStyles.has(NOTE)).toBe(false);
    expect(t.log).toContain('Deleting layer "OLD".');
    expect(dialog(t.bus).note).toBe('2 items purged.');
    // The lists are the drawing's now: HIDDEN, which only OLD used, can go.
    expect(names(dialog(t.bus).purgeable)).toContain('HIDDEN');
    expect(names(dialog(t.bus).purgeable)).not.toContain('OLD');
    await answer(t.bus, { run: 'checked', checked: [HIDDEN] });
    expect(t.model.tables.linetypes.has(HIDDEN)).toBe(false);
    await answer(t.bus, {}, 'ok');
    await t.bus.script(['U']);
    expect(t.layers()).toContain('OLD');
    expect(t.model.tables.linetypes.has(HIDDEN)).toBe(true);
    expect(t.model.tables.textStyles.has(NOTE)).toBe(true);
  });

  it('Purge All with nested items takes what only the purged items use, and unnamed objects', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    await answer(t.bus, {
      settings: { ...noConfirm, nested: true, zeroLength: true, emptyText: true },
      run: 'all',
    });
    expect(t.blocks()).not.toContain('UNUSED');
    expect(t.blocks()).not.toContain('NESTED');
    expect(t.layers()).not.toContain('INBLOCK');
    expect(t.model.tables.linetypes.has(HIDDEN)).toBe(false);
    // Registered applications stay (-PURGE Regapps purges them).
    expect(t.model.tables.appIds.has(MYAPP)).toBe(true);
    expect(t.has('41') || t.has('2E')).toBe(false);
    expect(dialog(t.bus).note).toMatch(
      /^\d+ items purged\. 2 zero-length geometry objects deleted\. 2 empty text objects deleted\.$/,
    );
    expect(dialog(t.bus).zeroLength).toBe(0);
    // Without nested items, one level goes.
    const u = setup();
    await u.bus.script(['PURGE']);
    await answer(u.bus, { settings: noConfirm, run: 'all' });
    expect(u.blocks()).not.toContain('UNUSED');
    expect(u.blocks()).toContain('NESTED');
    expect(u.has('41')).toBe(true);
    // Nothing left: the dialog says so.
    const v = setup();
    await v.bus.script(['PURGE']);
    await answer(v.bus, { settings: noConfirm, run: 'checked', checked: [] });
    expect(dialog(v.bus).note).toBe('Nothing was purged.');
    // A view change alone purges nothing; unnamed objects checked with none left say nothing.
    await answer(v.bus, { view: 'inUse' });
    expect(dialog(v.bus).view).toBe('inUse');
    expect(dialog(v.bus).note).toBeUndefined();
    await answer(t.bus, { run: 'checked', checked: [] });
    expect(dialog(t.bus).note).toBe('Nothing was purged.');
  });

  it('confirms each item: Purge this item, Skip this item, Purge all items', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    await answer(t.bus, { run: 'checked', checked: [UNUSED, OLD, FROZEN, NOTE] });
    expect(confirmShown(t.bus)).toEqual({ type: 'purgeconfirm', one: 'block', name: 'UNUSED' });
    await confirm(t.bus, 'skip');
    expect(confirmShown(t.bus)).toMatchObject({ one: 'layer', name: 'FROZEN' });
    await confirm(t.bus, 'this');
    expect(confirmShown(t.bus)).toMatchObject({ one: 'layer', name: 'OLD' });
    await confirm(t.bus, 'all');
    // Purge all items takes the rest without asking.
    expect(confirmShown(t.bus)).toBeUndefined();
    expect(t.blocks()).toContain('UNUSED');
    expect(t.layers()).not.toContain('FROZEN');
    expect(t.layers()).not.toContain('OLD');
    expect(t.model.tables.textStyles.has(NOTE)).toBe(false);
    expect(dialog(t.bus).note).toBe('3 items purged.');
  });

  it('confirms nested items too; what a skipped item uses stays; Esc skips', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    await answer(t.bus, {
      settings: { ...dialog(t.bus).settings, nested: true },
      run: 'checked',
      checked: [UNUSED, OLD],
    });
    expect(confirmShown(t.bus)).toMatchObject({ name: 'UNUSED' });
    await confirm(t.bus, 'this');
    expect(confirmShown(t.bus)).toMatchObject({ name: 'OLD' });
    await t.bus.cancel();
    // OLD skipped: HIDDEN, which only it uses, is never asked for. UNUSED's nested items are.
    const asked: string[] = [];
    for (let c = confirmShown(t.bus); c; c = confirmShown(t.bus)) {
      asked.push(c.name);
      await confirm(t.bus, 'this');
    }
    expect(asked.sort()).toEqual(['INBLOCK', 'NESTED']);
    expect(t.blocks()).not.toContain('UNUSED');
    expect(t.blocks()).not.toContain('NESTED');
    expect(t.layers()).not.toContain('INBLOCK');
    expect(t.layers()).toContain('OLD');
    expect(t.model.tables.linetypes.has(HIDDEN)).toBe(true);
  });

  it('Find Non-Purgeable Items: Details of the objects using an item', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    await answer(t.bus, { view: 'inUse', details: WALLS });
    const d = dialog(t.bus);
    expect(d.view).toBe('inUse');
    expect(d.details).toEqual({
      handle: WALLS,
      objects: 1,
      spaces: [{ name: 'Model', objects: 1 }],
      here: 1,
      extents: { minX: 0, minY: 1, maxX: 10, maxY: 1 },
    });
    // Through a block: layer 0's objects in USED reach model space by the insert, besides the
    // objects on it; a group's members are its objects.
    await answer(t.bus, { details: FULL_GROUP });
    expect(dialog(t.bus).details).toMatchObject({ objects: 1, here: 1 });
    await answer(t.bus, { details: USED });
    expect(dialog(t.bus).details).toMatchObject({ objects: 1 });
    // An item only a layer state uses has no objects, so nothing to measure.
    await answer(t.bus, { details: DASHED });
    expect(dialog(t.bus).details).toMatchObject({ objects: 0, here: 0, spaces: [] });
    expect(dialog(t.bus).details?.extents).toBeUndefined();
  });

  it('Select Objects closes the dialog, selects the objects using the item and zooms to them', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    await answer(t.bus, { view: 'inUse', details: WALLS }, 'select');
    expect(t.bus.prompt).toBeUndefined();
    const walls = t.model.entityByHandle('21')!.id;
    expect(t.bus.selection).toEqual([walls]);
    expect(t.requests).toContainEqual({ op: 'objects', ids: [walls] });
    // An item no object uses selects nothing, and the view stays.
    const asked = t.requests.length;
    await t.bus.script(['PURGE']);
    await answer(t.bus, { view: 'inUse', details: DASHED }, 'select');
    expect(t.bus.selection).toEqual([]);
    expect(t.log.at(-1)).toBe('0 found.');
    expect(t.requests.slice(asked).some((r) => r.op === 'objects')).toBe(false);
    // The next PURGE opens on Purgeable Items, with the options it closed with.
    await t.bus.script(['PURGE']);
    expect(dialog(t.bus).view).toBe('purgeable');
    await answer(t.bus, { settings: { ...noConfirm, nested: true } }, 'ok');
    await t.bus.script(['PURGE']);
    expect(dialog(t.bus).settings).toEqual({ ...noConfirm, nested: true });
  });

  it('Esc closes it, changing nothing', async () => {
    const t = setup();
    await t.bus.script(['PURGE']);
    await t.bus.cancel();
    expect(t.bus.prompt).toBeUndefined();
    expect(t.layers()).toContain('OLD');
    expect(t.bus.undo.state.undoable).toBe(0);
  });
});

// M5-09 part 3: the Health palette's purge card (PRD FR-Z4 "unused layers/blocks/styles, empty
// text, zero-length ... one-click fixes"): what PURGE would take, counted, and its fixes as engine
// edits, each one PURGE undo step.
describe('The Health palette purge fixes', () => {
  it('counts the unused named items by category, zero-length geometry and empty text', () => {
    const { model } = setup({ pinned: [PINNED] });
    const h = purgeHealth(model);
    expect(h.unused).toEqual([
      { category: 'blocks', title: 'Blocks', count: 1 },
      { category: 'groups', title: 'Groups', count: 1 },
      { category: 'layers', title: 'Layers', count: 2 },
      { category: 'textStyles', title: 'Text Styles', count: 1 },
    ]);
    // Registered applications are -PURGE's (as in the Purge dialog), not counted.
    expect(h.unused.some((c) => c.category === 'appIds')).toBe(false);
    // Nested: what only the unused items use goes with them.
    expect(h.nested).toBe(3);
    expect(h.zeroLength).toBe(zeroLengthObjects(model).length);
    expect(h.emptyText).toBe(emptyTextObjects(model).length);
    expect(h.zeroLength).toBe(2);
    expect(h.emptyText).toBe(2);
  });

  it('Purge all takes every unused item and what only they use, one PURGE undo step', () => {
    const s = new EngineSession(purgeInit());
    expect(s.purgeHealth().unused.length).toBeGreaterThan(0);
    const r = s.edit({ kind: 'purge', what: 'unused' });
    expect(r.ok).toBe(true);
    const names = [...s.model.tables.layers.values()].map((l) => l.name);
    expect(names).not.toContain('OLD');
    expect(names).not.toContain('INBLOCK');
    expect(names).toContain('WALLS');
    expect([...s.model.blocks.values()].map((b) => b.name)).not.toContain('NESTED');
    // As the Purge dialog's Purge All: what the purge itself freed (DASHED, which layer state S1
    // named only for the purged layer FROZEN) shows after it, for the next click.
    expect(s.purgeHealth().unused).toEqual([
      { category: 'linetypes', title: 'Linetypes', count: 1 },
    ]);
    expect(s.edit({ kind: 'purge', what: 'unused' }).ok).toBe(true);
    expect(s.purgeHealth().unused).toEqual([]);
    // Unnamed objects stay: they have their own fixes.
    expect(s.purgeHealth().zeroLength).toBe(2);
    // Registered applications stay too.
    expect([...s.model.tables.appIds.values()].map((a) => a.name)).toContain('MYAPP');
    expect(s.undoState.undoList).toEqual(['PURGE', 'PURGE']);
  });

  it('deletes zero-length geometry and empty text, each one PURGE undo step', () => {
    const s = new EngineSession(purgeInit());
    expect(s.edit({ kind: 'purge', what: 'zero-length' }).ok).toBe(true);
    expect(s.model.entityByHandle('41')).toBeUndefined();
    expect(s.model.entityByHandle('43')).toBeUndefined();
    // Locked layers keep theirs.
    expect(s.model.entityByHandle('42')).toBeDefined();
    expect(s.purgeHealth().zeroLength).toBe(0);
    expect(s.purgeHealth().emptyText).toBe(2);
    expect(s.edit({ kind: 'purge', what: 'empty-text' }).ok).toBe(true);
    expect(s.model.entityByHandle('2E')).toBeUndefined();
    expect(s.model.entityByHandle('30')).toBeUndefined();
    expect(s.model.entityByHandle('31')).toBeDefined();
    expect(s.purgeHealth().emptyText).toBe(0);
    expect(s.undoState.undoList).toEqual(['PURGE', 'PURGE']);
  });

  it('refuses when there is nothing to purge, changing nothing', () => {
    const s = new EngineSession(purgeInit());
    s.edit({ kind: 'purge', what: 'zero-length' });
    const r = s.edit({ kind: 'purge', what: 'zero-length' });
    expect(r).toEqual({ ok: false, message: 'No zero-length geometry found.' });
    s.edit({ kind: 'purge', what: 'unused' });
    s.edit({ kind: 'purge', what: 'unused' });
    expect(s.edit({ kind: 'purge', what: 'unused' })).toEqual({
      ok: false,
      message: 'No unused named items found.',
    });
    expect(s.undoState.undoable).toBe(3);
  });
});
