// M4-09 part 4: SPELL's Check Spelling scenarios on the PromptBus, as the dialog drives them
// (AutoCAD 2024 Help, "SPELL (Command)", "Check Spelling Dialog Box", "Check Spelling Settings
// Dialog Box"): Start finds the first word not in the dictionaries and zooms to it; Ignore,
// Ignore All, Add to Dictionary, Change and Change All go on to the next; Undo reverses the
// last of them; the settings say which text is checked.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPELL_SETTINGS,
  DocumentModel,
  PromptBus,
  SPELL_COMPLETE,
  builtinCommands,
  type DialogRequest,
  type DimensionGeometry,
  type EntityId,
  type InsertAttribute,
  type InsertGeometry,
  type MTextGeometry,
  type SpellAction,
  type SpellChecker,
  type SpellSettings,
  type TableGeometry,
  type TextGeometry,
  type TextStyleRecord,
  type Vec2,
  type ViewHost,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import {
  LAYER_0,
  PAPER_SPACE,
  blockRecord,
  entityInit,
  layer,
  sampleInit,
} from '../model/fixtures';

const STANDARD = '30';
const TAG = '32';
const LOCKED = '34';
const XREF = '39';

const style: TextStyleRecord = {
  handle: STANDARD,
  name: 'Standard',
  font: 'arial.ttf',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

const text = (value: string, at: Vec2): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: STANDARD,
  position: at,
  height: 2,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

const mtext = (contents: string, at: Vec2): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: STANDARD,
  position: at,
  height: 2,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

const attrib = (h: string, value: string): InsertAttribute => ({
  handle: h,
  layer: LAYER_0,
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  ...text(value, { x: 100, y: 0 }),
  tag: 'TYPE',
  flags: 0,
});

const insert = (block: string, at: Vec2, attributes: InsertAttribute[] = []): InsertGeometry => ({
  kind: 'INSERT',
  block,
  position: at,
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes,
});

const cell = (t: string) => ({
  type: 'text' as const,
  text: t,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
});

const table: TableGeometry = {
  kind: 'ACAD_TABLE',
  position: { x: 0, y: 200 },
  direction: { x: 1, y: 0 },
  rowHeights: [1],
  columnWidths: [10],
  cells: [[cell('dore scedule')]],
};

const dimension = {
  kind: 'DIMENSION',
  dimType: 'linear',
  style: '0',
  first: { x: 0, y: 0 },
  second: { x: 10, y: 0 },
  rotation: 0,
  definitionPoint: { x: 10, y: 5 },
  textPosition: { x: 5, y: 6 },
  textUserPositioned: false,
  text: '<> typ dimm',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
} as DimensionGeometry;

/** A small dictionary: the words it knows, and what it suggests for a few it does not. */
const DICTIONARY = new Set(
  'door fire frame schedule see note the a typ and of plan sheet steel'.split(' '),
);
const SUGGESTIONS: Record<string, string[]> = {
  dore: ['door', 'dose'],
  frmae: ['frame'],
  scedule: ['schedule'],
};
const checker: SpellChecker = {
  name: 'Test English',
  correct: (w) => DICTIONARY.has(w.toLowerCase()),
  suggest: (w) => SUGGESTIONS[w.toLowerCase()] ?? [],
};

function setup(o: { spelling?: boolean; long?: string; noLayouts?: boolean } = {}) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    handSeed: '100',
    ...(o.noLayouts && { layouts: [] }),
    tables: {
      ...base.tables,
      layers: [...base.tables!.layers!, { ...layer(LOCKED, 'LOCKED'), locked: true }],
      textStyles: [style],
      blockRecords: [
        ...base.tables!.blockRecords!,
        blockRecord(TAG, 'TAG'),
        { ...blockRecord(XREF, 'PLAN'), flags: 4 },
      ],
    },
    blocks: [
      ...base.blocks!,
      { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
      {
        handle: XREF,
        name: 'PLAN',
        basePoint: { x: 0, y: 0 },
        flags: 4,
        xrefPath: 'plan.dxf',
        xrefLoaded: ['70'],
      },
    ],
    entities: [
      ...base.entities!,
      entityInit('50', text(o.long ?? 'fire dore', { x: 0, y: 0 })),
      entityInit('51', mtext('{\\fArial|b1;dore} frmae\\Psee dore', { x: 0, y: 20 })),
      entityInit('52', insert(TAG, { x: 100, y: 0 }, [attrib('53', 'steel dore')])),
      entityInit('55', dimension),
      entityInit('56', table),
      entityInit('59', text('locked dore', { x: 0, y: 80 }), { layer: LOCKED }),
      entityInit('5A', text('sheet nott', { x: 0, y: 0 }), { owner: PAPER_SPACE }),
      entityInit('5B', text('blok text', { x: 0, y: 0 }), { owner: TAG }),
      entityInit('70', text('plan xreff', { x: 0, y: 0 }), { owner: XREF }),
      entityInit('64', insert(XREF, { x: 500, y: 0 })),
    ],
  });
  const asked: ViewRequest[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      asked.push(r);
      if (r.op === 'textBox') {
        return Promise.resolve({
          ok: true,
          box: { minX: 0, minY: 0, maxX: 1, maxY: r.text.height },
        });
      }
      if (r.op === 'pick') {
        const ids = [...model.entities()].flatMap((e) => {
          const g = e.geom;
          if (e.owner !== '1F' || g.kind !== 'TEXT') return [];
          return Math.hypot(g.position.x - r.point.x, g.position.y - r.point.y) < 1 ? [e.id] : [];
        });
        return Promise.resolve({ ok: true, ids });
      }
      return Promise.resolve({ ok: true });
    },
  };
  const loads: number[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    ...(o.spelling !== false && {
      spelling: () => {
        loads.push(1);
        return Promise.resolve(checker);
      },
    }),
  });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string): EntityId => [...model.entities()].find((e) => e.handle === h)!.id;
  const geom = <T>(h: string) => model.entity(id(h))!.geom as T;
  const dialog = () => {
    const p = bus.prompt;
    return p?.kind === 'dialog'
      ? (p.dialog as Extract<DialogRequest, { type: 'spell' }>)
      : undefined;
  };
  let custom: readonly string[] = [];
  /** Changes the dialog's settings (and custom dictionary) and presses a button. */
  const press = async (
    action: SpellAction | 'close',
    change: Partial<SpellSettings> = {},
    words?: readonly string[],
  ) => {
    const settings = { ...dialog()!.settings, ...change };
    custom = words ?? dialog()!.custom ?? custom;
    await bus.answer(
      action === 'close'
        ? { kind: 'dialog', action: 'ok', spell: { settings, custom } }
        : { kind: 'dialog', action: 'apply', spell: { settings, custom, action } },
    );
  };
  const word = () => dialog()?.word?.word;
  /** The words found, pressing `action` at each, until the check is complete. */
  const all = async (action: SpellAction = { op: 'ignore' }) => {
    const out: string[] = [];
    for (let n = 0; n < 50 && dialog()?.word; n++) {
      out.push(`${dialog()!.word!.location}|${dialog()!.word!.objectType}|${word()}`);
      await press(action);
    }
    return out;
  };
  const zoomed = () =>
    asked.flatMap((r) => (r.op === 'objects' ? [String(model.ids.handleOf(r.ids[0]!))] : []));
  const selected = () => bus.selection.map((i) => String(model.ids.handleOf(i)));
  return { model, bus, log, id, geom, dialog, press, word, all, zoomed, selected, asked, loads };
}

describe('SPELL', () => {
  it('opens the Check Spelling dialog on the entire drawing; Start finds the first word', async () => {
    const s = setup();
    await s.bus.submit('SP');
    expect(s.dialog()).toEqual({
      type: 'spell',
      settings: DEFAULT_SPELL_SETTINGS,
      selected: 0,
      dictionary: 'Test English',
      undo: false,
    });
    await s.press({ op: 'start' });
    expect(s.dialog()!.word).toEqual({
      word: 'dore',
      suggestions: ['door', 'dose'],
      context: { text: 'fire dore', start: 5, end: 9 },
      location: 'Model',
      objectType: 'Text',
    });
    // Zoomed to and highlighted.
    expect(s.zoomed()).toEqual(['50']);
    expect(s.selected()).toEqual(['50']);
    await s.press('close');
    expect(s.bus.command).toBeUndefined();
    expect(s.selected()).toEqual([]);
  });

  it('Ignore steps through every word not in the dictionary, and says when it is complete', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    await s.press({ op: 'start' });
    expect(await s.all()).toEqual([
      'Model|Text|dore',
      'Model|MText|dore',
      'Model|MText|frmae',
      'Model|MText|dore',
      'Model|Attribute|dore',
      'Model|Dimension|dimm',
      'Model|Table|dore',
      'Model|Table|scedule',
      'Model|Text|locked',
      'Model|Text|dore',
      'Layout1|Text|nott',
    ]);
    expect(s.dialog()).toMatchObject({ note: SPELL_COMPLETE });
    expect(s.dialog()!.word).toBeUndefined();
    expect(s.log).toContain(SPELL_COMPLETE);
    expect(s.asked).toContainEqual({ op: 'tab', name: 'Layout1' });
    // The dictionary was loaded once.
    expect(s.loads).toHaveLength(1);
  });

  it('the settings say which text is checked; Current space and selected objects narrow it', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    await s.press(
      { op: 'start' },
      { where: 'space', dimensions: false, attributes: false, xrefs: true },
    );
    const found = await s.all();
    expect(found).not.toContain('Model|Attribute|dore');
    expect(found).not.toContain('Model|Dimension|dimm');
    expect(found).not.toContain('Layout1|Text|nott');
    expect(found).toContain('Model (xref PLAN)|Text|xreff');
    // Text in a block's definition is not checked.
    expect(found.some((f) => f.includes('blok'))).toBe(false);
    await s.press(
      { op: 'start' },
      { where: 'drawing', ignoreCapitalized: true, ignoreUppercase: false },
    );
    expect(s.word()).toBe('dore');
  });

  it('opens on the objects selected; Select text objects chooses others', async () => {
    const s = setup();
    await s.bus.pick({ x: 0, y: 0 });
    await s.bus.submit('SPELL');
    expect(s.dialog()).toMatchObject({ selected: 1, settings: { where: 'selection' } });
    await s.press({ op: 'start' });
    expect(await s.all()).toEqual(['Model|Text|dore']);
    await s.press({ op: 'select' });
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.answer({ kind: 'selection', ids: [s.id('51')] });
    expect(s.dialog()).toMatchObject({ selected: 1, settings: { where: 'selection' } });
    await s.press({ op: 'start' });
    expect(await s.all()).toHaveLength(3);
    await s.press('close');
    // Selected objects with none selected.
    await s.bus.submit('SPELL');
    expect(s.dialog()!.settings.where).toBe('drawing');
  });

  it('Change replaces the word with the one given, keeping the formatting', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    await s.press({ op: 'start' });
    await s.press({ op: 'change', to: 'door' });
    expect(s.geom<TextGeometry>('50').value).toBe('fire door');
    expect(s.word()).toBe('dore');
    await s.press({ op: 'change', to: 'DOOR' });
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\fArial|b1;DOOR} frmae\\Psee dore');
    expect(s.word()).toBe('frmae');
    expect(s.dialog()!.word!.context).toEqual({ text: 'DOOR frmae see dore', start: 5, end: 10 });
  });

  it('Change All replaces the word everywhere checked; locked and xref text is left', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    await s.press({ op: 'start' }, { xrefs: true });
    await s.press({ op: 'changeAll', to: 'door' });
    expect(s.geom<TextGeometry>('50').value).toBe('fire door');
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\fArial|b1;door} frmae\\Psee door');
    expect(s.geom<InsertGeometry>('52').attributes[0]!.value).toBe('steel door');
    expect(s.geom<TableGeometry>('56').cells[0]![0]!.text).toBe('door scedule');
    expect(s.geom<TextGeometry>('59').value).toBe('locked dore');
    expect(s.word()).toBe('frmae');
    // One undo step for all SPELL changed.
    await s.press('close');
    await s.bus.submit('U');
    expect(s.geom<TextGeometry>('50').value).toBe('fire dore');
    expect(s.geom<TableGeometry>('56').cells[0]![0]!.text).toBe('dore scedule');
  });

  it('a word on a locked layer or in an xref is not changed', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    await s.press(
      { op: 'start' },
      { where: 'space', dimensions: false, attributes: false, xrefs: true },
    );
    while (s.word() !== 'locked') await s.press({ op: 'ignore' });
    await s.press({ op: 'change', to: 'open' });
    expect(s.geom<TextGeometry>('59').value).toBe('locked dore');
    expect(s.dialog()).toMatchObject({ note: 'The object is on a locked layer.' });
    expect(s.word()).toBe('locked');
    while (s.word() !== 'xreff') await s.press({ op: 'ignore' });
    expect(s.dialog()!.word!.readOnly).toBe(true);
    await s.press({ op: 'changeAll', to: 'xref' });
    expect(s.geom<TextGeometry>('70').value).toBe('plan xreff');
    expect(s.dialog()).toMatchObject({ note: 'The text is in an xref and cannot be changed.' });
  });

  it('Ignore All and Add to Dictionary pass the word from then on', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    await s.press({ op: 'start' }, { where: 'space', dimensions: false });
    await s.press({ op: 'ignoreAll' });
    expect(s.word()).toBe('frmae');
    await s.press({ op: 'add' });
    expect(s.dialog()!.custom).toEqual(['frmae']);
    expect(await s.all()).toEqual(['Model|Table|scedule', 'Model|Text|locked']);
    // The custom dictionary the dialog sends is checked with.
    await s.press({ op: 'start' }, {}, ['frmae', 'Scedule', 'locked']);
    expect(await s.all()).toEqual([
      'Model|Text|dore',
      'Model|MText|dore',
      'Model|MText|dore',
      'Model|Attribute|dore',
      'Model|Table|dore',
      'Model|Text|dore',
    ]);
  });

  it('a word longer than 63 characters is not added', async () => {
    const long = 'x'.repeat(64);
    const s = setup({ long });
    await s.bus.submit('SPELL');
    await s.press({ op: 'select' });
    await s.bus.answer({ kind: 'selection', ids: [] });
    expect(s.dialog()!.settings.where).toBe('drawing');
    await s.press({ op: 'start' });
    expect(s.word()).toBe(long);
    await s.press({ op: 'add' });
    expect(s.dialog()).toMatchObject({
      note: 'A custom dictionary word can have up to 63 characters.',
    });
    expect(s.word()).toBe(long);
  });

  it('Undo reverses Ignore, Ignore All, Add to Dictionary, Change and Change All', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    await s.press({ op: 'start' });
    expect(s.dialog()!.undo).toBe(false);
    await s.press({ op: 'ignore' });
    expect(s.dialog()!.undo).toBe(true);
    await s.press({ op: 'undo' });
    expect(s.dialog()!.word!.context.text).toBe('fire dore');
    await s.press({ op: 'changeAll', to: 'door' });
    expect(s.geom<TableGeometry>('56').cells[0]![0]!.text).toBe('door scedule');
    await s.press({ op: 'add' });
    expect(s.dialog()!.custom).toEqual(['frmae']);
    await s.press({ op: 'undo' });
    expect(s.dialog()!.custom).toEqual([]);
    expect(s.word()).toBe('frmae');
    await s.press({ op: 'undo' });
    expect(s.geom<TextGeometry>('50').value).toBe('fire dore');
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\fArial|b1;dore} frmae\\Psee dore');
    expect(s.geom<TableGeometry>('56').cells[0]![0]!.text).toBe('dore scedule');
    expect(s.word()).toBe('dore');
    expect(s.dialog()!.word!.context.text).toBe('fire dore');
    await s.press({ op: 'ignoreAll' });
    expect(s.word()).toBe('frmae');
    await s.press({ op: 'undo' });
    expect(s.word()).toBe('dore');
    await s.press({ op: 'change', to: 'door' });
    expect(s.geom<TextGeometry>('50').value).toBe('fire door');
    await s.press({ op: 'undo' });
    expect(s.geom<TextGeometry>('50').value).toBe('fire dore');
    // Nothing left to undo.
    await s.press({ op: 'undo' });
    expect(s.word()).toBe('dore');
  });

  it('a dimension changed is drawn again; the buttons need a word shown', async () => {
    const s = setup();
    await s.bus.submit('SPELL');
    // Before Start, the word buttons do nothing.
    await s.press({ op: 'ignore' });
    await s.press({ op: 'change', to: 'x' });
    expect(s.dialog()!.word).toBeUndefined();
    await s.press({ op: 'start' }, { where: 'space', attributes: false });
    while (s.word() !== 'dimm') await s.press({ op: 'ignore' });
    await s.press({ op: 'change', to: 'dim' });
    expect(s.geom<DimensionGeometry>('55').text).toBe('<> typ dim');
  });

  it('a drawing with no layouts listed checks its current space', async () => {
    const s = setup({ noLayouts: true });
    await s.bus.submit('SPELL');
    await s.press({ op: 'start' });
    expect(await s.all()).toContain('Model|Text|dore');
  });

  it('says when no dictionary is available', async () => {
    const s = setup({ spelling: false });
    await s.bus.submit('SPELL');
    expect(s.log).toContain('No spelling dictionary is available.');
    expect(s.bus.command).toBeUndefined();
  });
});
