// M5-09 part 1: PURGE's rules (edit/purge.ts) and -PURGE's prompts (AutoCAD Help, "-PURGE
// (Command)", "Purge Dialog Box"): only what nothing uses goes, one level per -PURGE run,
// nested with purgeClosure; what AutoCAD never purges stays; zero-length geometry and empty text
// go from model space and the layouts, not from blocks or locked layers; one undo step.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  purgeClosure,
  purgeState,
  zeroLengthObjects,
  emptyTextObjects,
  type BusEvent,
  type EntityGeometry,
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

function setup(o: { pinned?: string[] } = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
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
  });
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => model, new Map()),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const layers = () => [...model.tables.layers.values()].map((l) => l.name);
  const blocks = () => [...model.blocks.values()].map((b) => b.name);
  const has = (h: string) => model.entityByHandle(h) !== undefined;
  return { model, bus, log, layers, blocks, has };
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
