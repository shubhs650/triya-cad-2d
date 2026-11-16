// M4-09 part 2: FIND's Find and Replace scenarios on the PromptBus, as the dialog drives them
// (AutoCAD 2024 Help, "FIND (Command)", "Find and Replace Dialog Box"): Find / Find Next steps
// through the matches zooming to each, Replace replaces the one shown and goes on, Replace All
// replaces every match as one undo step; the Text Types, Find where and the search options
// choose what is searched; text on locked layers is found, not replaced.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIND_SETTINGS,
  DocumentModel,
  FINISHED,
  NOT_FOUND,
  PromptBus,
  builtinCommands,
  type DialogRequest,
  type DimensionGeometry,
  type EntityId,
  type FindAction,
  type FindSettings,
  type InsertAttribute,
  type InsertGeometry,
  type MTextGeometry,
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
const DOORTAG = '32';
const FROZEN = '33';
const LOCKED = '34';
const PE_URL = '35';
const ANON = '36';
const DYNAMIC = '37';
const STATE = '38';
const XREF = '39';

const insert = (block: string): InsertGeometry => ({
  kind: 'INSERT',
  block,
  position: { x: 200, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

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

const attrib = (h: string, tag: string, value: string, flags = 0): InsertAttribute => ({
  handle: h,
  layer: LAYER_0,
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  ...text(value, { x: 100, y: 0 }),
  tag,
  flags,
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
  rowHeights: [1, 1],
  columnWidths: [10, 10],
  cells: [
    [cell('DOOR SCHEDULE'), cell('')],
    [cell('D1'), cell('{\\C1;DOOR} 900')],
  ],
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
  text: '<> DOOR',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
} as DimensionGeometry;

function setup(o: { measure?: boolean; references?: boolean } = {}) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    handSeed: '100',
    tables: {
      ...base.tables,
      layers: [
        ...base.tables!.layers!,
        { ...layer(FROZEN, 'FROZEN'), frozen: true },
        { ...layer(LOCKED, 'LOCKED'), locked: true },
      ],
      textStyles: [style],
      appIds: [{ handle: PE_URL, name: 'PE_URL', flags: 0 }],
      blockRecords: [
        ...base.tables!.blockRecords!,
        blockRecord(DOORTAG, 'DOORTAG'),
        blockRecord(ANON, '*U9'),
        ...(o.references
          ? [
              blockRecord(DYNAMIC, 'DOOR_DYN'),
              blockRecord(STATE, '*U12'),
              { ...blockRecord(XREF, 'PLAN'), flags: 4 },
            ]
          : []),
      ],
    },
    blocks: [
      ...base.blocks!,
      { handle: DOORTAG, name: 'DOORTAG', basePoint: { x: 0, y: 0 } },
      { handle: ANON, name: '*U9', basePoint: { x: 0, y: 0 } },
      // M4-09 part 4: a dynamic block's state and a loaded xref.
      ...(o.references
        ? [
            {
              handle: DYNAMIC,
              name: 'DOOR_DYN',
              basePoint: { x: 0, y: 0 },
              dynamic: { name: 'Door' },
            },
            { handle: STATE, name: '*U12', basePoint: { x: 0, y: 0 }, dynamicOf: DYNAMIC },
            {
              handle: XREF,
              name: 'PLAN',
              basePoint: { x: 0, y: 0 },
              flags: 4,
              xrefPath: 'plan.dxf',
              xrefLoaded: ['70'],
            },
          ]
        : []),
    ],
    entities: [
      ...base.entities!,
      entityInit('50', text('DOOR', { x: 0, y: 0 })),
      entityInit('51', mtext('{\\fArial|b1;Door} and door\\PBACK DOOR', { x: 0, y: 20 })),
      entityInit('52', {
        kind: 'INSERT',
        block: DOORTAG,
        position: { x: 100, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [attrib('53', 'TYPE', 'DOOR-A'), attrib('54', 'HIDDEN', 'DOOR', 1)],
      } satisfies InsertGeometry),
      entityInit('55', dimension),
      entityInit('56', table),
      entityInit('57', text('LINK', { x: 0, y: 40 }), {
        xdata: [
          {
            appId: PE_URL,
            values: [
              { code: 1000, value: 'https://example.com/door' },
              { code: 1002, value: '{' },
              { code: 1000, value: 'Door catalogue' },
              { code: 1002, value: '}' },
            ],
          },
        ],
      }),
      entityInit('58', text('DOOR FROZEN', { x: 0, y: 60 }), { layer: FROZEN }),
      entityInit('59', text('DOOR LOCKED', { x: 0, y: 80 }), { layer: LOCKED }),
      entityInit('5A', text('SHEET DOOR', { x: 0, y: 0 }), { owner: PAPER_SPACE }),
      entityInit('5B', text('DOOR IN BLOCK', { x: 0, y: 0 }), { owner: DOORTAG }),
      // A second reference to DOORTAG, whose text is listed once, and an anonymous block.
      entityInit('5C', { ...insert(DOORTAG), position: { x: 300, y: 0 } }),
      entityInit('5D', text('DOOR ANONYMOUS', { x: 0, y: 0 }), { owner: ANON }),
      entityInit('5E', insert(ANON)),
      ...(o.references
        ? [
            entityInit('62', text('DOOR STATE', { x: 0, y: 0 }), { owner: STATE }),
            entityInit('63', { ...insert(STATE), position: { x: 400, y: 0 } }),
            entityInit('70', text('DOOR IN XREF', { x: 0, y: 0 }), { owner: XREF }),
            entityInit('64', { ...insert(XREF), position: { x: 500, y: 0 } }),
          ]
        : []),
    ],
  });
  const asked: ViewRequest[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      asked.push(r);
      // A table cell's text is one line high.
      if (r.op === 'textBox' && o.measure !== false) {
        return Promise.resolve({
          ok: true,
          box: { minX: 0, minY: 0, maxX: 1, maxY: r.text.height },
        });
      }
      // A pick takes the model space text at the point.
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
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string): EntityId => [...model.entities()].find((e) => e.handle === h)!.id;
  const geom = <T>(h: string) => model.entity(id(h))!.geom as T;
  const dialog = () => {
    const p = bus.prompt;
    return p?.kind === 'dialog'
      ? (p.dialog as Extract<DialogRequest, { type: 'find' }>)
      : undefined;
  };
  let settings: FindSettings = DEFAULT_FIND_SETTINGS;
  /** Sets the dialog's fields and presses a button. */
  const press = async (action: FindAction | 'done', change: Partial<FindSettings> = {}) => {
    settings = { ...(dialog()?.settings ?? settings), ...change };
    await bus.answer(
      action === 'done'
        ? { kind: 'dialog', action: 'ok', find: { settings } }
        : { kind: 'dialog', action: 'apply', find: { settings, action } },
    );
  };
  const zoomed = () =>
    asked.flatMap((r) => (r.op === 'objects' ? [String(model.ids.handleOf(r.ids[0]!))] : []));
  const selected = () => bus.selection.map((i) => String(model.ids.handleOf(i)));
  return { model, bus, log, id, geom, dialog, press, zoomed, selected, asked };
}

const handles = (rows: readonly { location: string; objectType: string; text: string }[]) =>
  rows.map((r) => `${r.location}|${r.objectType}|${r.text}`);

describe('FIND', () => {
  it('opens the Find and Replace dialog on the current space', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    expect(s.dialog()).toEqual({ type: 'find', settings: DEFAULT_FIND_SETTINGS, selected: 0 });
    await s.press('done');
    expect(s.bus.command).toBeUndefined();
  });

  it('lists every match in the current space, hidden items left out', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'find' }, { find: 'door', listResults: true });
    expect(handles(s.dialog()!.results!)).toEqual([
      'Model|Text|DOOR',
      'Model|MText|Door and door BACK DOOR',
      'Model|MText|Door and door BACK DOOR',
      'Model|MText|Door and door BACK DOOR',
      'Model|Attribute|DOOR-A',
      'Model (block DOORTAG)|Text|DOOR IN BLOCK',
      'Model|Dimension|<> DOOR',
      'Model|Table|DOOR SCHEDULE',
      'Model|Table|DOOR 900',
      'Model|Text|Door catalogue',
      'Model|Text|https://example.com/door',
      'Model|Text|DOOR LOCKED',
    ]);
    expect(s.dialog()!.results![2]).toMatchObject({ start: 9, end: 13 });
    // The first is shown: zoomed to and highlighted.
    expect(s.dialog()!.current).toBe(0);
    expect(s.zoomed()).toEqual(['50']);
    expect(s.selected()).toEqual(['50']);
  });

  it('Find Next steps through the matches and says when it has finished', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'find' }, { find: 'back door' });
    expect(s.dialog()).toMatchObject({ current: 0 });
    expect(s.dialog()!.results).toBeUndefined();
    expect(s.zoomed()).toEqual(['51']);
    await s.press({ op: 'find' });
    expect(s.dialog()).toMatchObject({ note: FINISHED });
    expect(s.dialog()!.current).toBeUndefined();
    await s.press({ op: 'find' }, { find: 'window' });
    expect(s.dialog()).toMatchObject({ note: NOT_FOUND });
  });

  it('the text types, whole words and match case narrow the search', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    const count = async (change: Partial<FindSettings>) => {
      await s.press({ op: 'find' }, { listResults: true, ...change });
      return s.dialog()!.results!.length;
    };
    expect(await count({ find: 'door' })).toBe(12);
    const types = (...t: FindSettings['options']['types']) => ({
      options: { ...s.dialog()!.settings.options, types: t },
    });
    expect(await count(types('attribute'))).toBe(1);
    expect(await count(types('dimension', 'table'))).toBe(3);
    expect(await count(types('hyperlinkDescription'))).toBe(1);
    expect(await count(types('hyperlink'))).toBe(1);
    expect(await count(types('text'))).toBe(6);
    const all = s.dialog()!.settings.options;
    const only = { ...all, types: ['text' as const], matchCase: true };
    expect(await count({ find: 'door', options: only })).toBe(1);
    expect(await count({ find: 'DOOR', options: { ...only, searchBlocks: false } })).toBe(3);
    expect(await count({ find: 'DOOR', options: only })).toBe(4);
    // DOOR-A is a whole word; DOORS is not.
    expect(
      await count({ find: 'DOOR', options: { ...all, types: ['attribute'], wholeWords: true } }),
    ).toBe(1);
    expect(await count({ find: 'DOO', options: { ...all, wholeWords: true } })).toBe(0);
  });

  it('Ignore hidden items off finds invisible attributes and text on frozen layers', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    const options = {
      ...DEFAULT_FIND_SETTINGS.options,
      ignoreHidden: false,
      types: ['attribute', 'text'] as const,
    };
    await s.press(
      { op: 'find' },
      { find: 'door', listResults: true, options: { ...options, types: [...options.types] } },
    );
    const rows = handles(s.dialog()!.results!);
    expect(rows).toContain('Model|Attribute|DOOR');
    expect(rows).toContain('Model|Text|DOOR FROZEN');
  });

  it('Entire drawing searches every layout; a match in another is shown on its tab', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'find' }, { find: 'sheet', where: 'drawing', listResults: true });
    expect(handles(s.dialog()!.results!)).toEqual(['Layout1|Text|SHEET DOOR']);
    expect(s.asked).toContainEqual({ op: 'tab', name: 'Layout1' });
  });

  it('opens on the objects selected; Select objects chooses others', async () => {
    const s = setup();
    await s.bus.pick({ x: 0, y: 0 });
    await s.bus.pick({ x: 0, y: 80 });
    await s.bus.submit('FIND');
    expect(s.dialog()).toMatchObject({ selected: 2, settings: { where: 'selection' } });
    await s.press({ op: 'find' }, { find: 'door', listResults: true });
    expect(handles(s.dialog()!.results!)).toEqual(['Model|Text|DOOR', 'Model|Text|DOOR LOCKED']);
    await s.press({ op: 'select' });
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.answer({ kind: 'selection', ids: [s.id('51')] });
    expect(s.dialog()).toMatchObject({ selected: 1 });
    await s.press({ op: 'find' });
    expect(s.dialog()!.results).toHaveLength(3);
  });

  it('Replace replaces the match shown and goes on to the next', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'find' }, { find: 'door', replace: 'GATE', listResults: true });
    await s.press({ op: 'zoom', index: 1 });
    expect(s.dialog()!.current).toBe(1);
    await s.press({ op: 'replace' });
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\fArial|b1;GATE} and door\\PBACK DOOR');
    // The next is the second door of the same MTEXT, now listed first of its own.
    expect(s.dialog()!.current).toBe(1);
    expect(s.dialog()!.results![1]).toMatchObject({ text: 'GATE and door BACK DOOR', start: 9 });
    await s.press({ op: 'replace' });
    await s.press({ op: 'replace' });
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\fArial|b1;GATE} and GATE\\PBACK GATE');
    expect(s.dialog()!.results![s.dialog()!.current!]).toMatchObject({ objectType: 'Attribute' });
  });

  it('replacing the last match finishes the search', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'find' }, { find: 'back door', replace: 'REAR GATE' });
    await s.press({ op: 'replace' });
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\fArial|b1;Door} and door\\PREAR GATE');
    expect(s.dialog()).toMatchObject({ note: FINISHED });
    expect(s.selected()).toEqual([]);
  });

  it('Replace with nothing shown finds the first; a locked match is skipped', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'replace' }, { find: 'locked', replace: 'X' });
    expect(s.dialog()!.current).toBe(0);
    await s.press({ op: 'replace' });
    expect(s.geom<TextGeometry>('59').value).toBe('DOOR LOCKED');
    expect(s.dialog()).toMatchObject({ note: 'The object is on a locked layer.' });
  });

  it('Replace All replaces every match as one undo step, tables and dimensions with it', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'replaceAll' }, { find: 'door', replace: 'Gate' });
    expect(s.dialog()!.note).toBe('11 matches were replaced. 1 match on a locked layer was not.');
    expect(s.geom<TextGeometry>('50').value).toBe('Gate');
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\fArial|b1;Gate} and Gate\\PBACK Gate');
    const ins = s.geom<InsertGeometry>('52');
    expect(ins.attributes.map((a) => a.value)).toEqual(['Gate-A', 'DOOR']);
    expect(s.geom<DimensionGeometry>('55').text).toBe('<> Gate');
    expect(s.geom<TableGeometry>('56').cells.map((r) => r.map((c) => c.text))).toEqual([
      ['Gate SCHEDULE', ''],
      ['D1', '{\\C1;Gate} 900'],
    ]);
    expect(s.geom<TextGeometry>('5B').value).toBe('Gate IN BLOCK');
    const link = s.model.entity(s.id('57'))!.xdata![0]!.values;
    expect(link.filter((v) => v.code === 1000).map((v) => v.value)).toEqual([
      'https://example.com/Gate',
      'Gate catalogue',
    ]);
    expect(s.geom<TextGeometry>('5A').value).toBe('SHEET DOOR');
    expect(s.log).toContain('11 matches were replaced. 1 match on a locked layer was not.');
    await s.press('done');
    await s.bus.submit('U');
    expect(s.geom<TextGeometry>('50').value).toBe('DOOR');
    expect(s.geom<TableGeometry>('56').cells[0]![0]!.text).toBe('DOOR SCHEDULE');
    expect(s.geom<TextGeometry>('5B').value).toBe('DOOR IN BLOCK');
  });

  it('remembers its settings; Create selection set ends with the objects selected', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.press({ op: 'find' }, { find: 'door', listResults: true });
    await s.press({ op: 'selectionSet', indexes: [0, 1, 2] });
    expect(s.bus.command).toBeUndefined();
    expect(s.selected()).toEqual(['50', '51']);
    expect(s.log).toContain('2 item(s) selected.');
    await s.bus.clearSelection();
    await s.bus.submit('FIND');
    expect(s.dialog()!.settings).toMatchObject({ find: 'door', listResults: true });
    await s.press({ op: 'find' });
    await s.press('done');
    // Done leaves nothing highlighted.
    expect(s.selected()).toEqual([]);
  });

  it('answers what the dialog asks at its edges', async () => {
    const s = setup();
    await s.bus.submit('FIND');
    // Nothing to find.
    await s.press({ op: 'find' });
    expect(s.dialog()).toMatchObject({ note: NOT_FOUND });
    // Selected objects with none selected.
    await s.press({ op: 'find' }, { find: 'door', where: 'selection' });
    expect(s.dialog()).toMatchObject({ note: 'Select objects to search first.' });
    // Select objects ended with nothing selected leaves Find where as it was.
    await s.press({ op: 'select' });
    await s.bus.answer({ kind: 'enter' });
    expect(s.dialog()).toMatchObject({ selected: 0, settings: { where: 'selection' } });
    // Zoom to a result searches first; one not listed changes nothing.
    await s.press({ op: 'zoom', index: 3 }, { where: 'space' });
    expect(s.dialog()!.current).toBe(3);
    await s.press({ op: 'zoom', index: 99 });
    expect(s.dialog()!.current).toBe(3);
    // After the last match, Find and Replace start again from the first.
    await s.press({ op: 'find' }, { find: 'back' });
    await s.press({ op: 'find' });
    expect(s.dialog()).toMatchObject({ note: FINISHED });
    await s.press({ op: 'find' });
    expect(s.dialog()!.current).toBe(0);
    await s.press({ op: 'find' });
    await s.press({ op: 'replace' });
    expect(s.dialog()!.current).toBe(0);
    // Replace All with nothing to replace, then with nothing locked.
    await s.press({ op: 'replaceAll' }, { find: 'window' });
    expect(s.dialog()).toMatchObject({ note: NOT_FOUND });
    await s.press({ op: 'replaceAll' }, { find: 'back', replace: 'REAR' });
    expect(s.dialog()).toMatchObject({ note: '1 match was replaced.' });
    // Create selection set (all) searches first.
    await s.press({ op: 'selectionSet' }, { find: 'rear' });
    expect(s.selected()).toEqual(['51']);
  });

  it("Done without the dialog's fields keeps the settings", async () => {
    const s = setup();
    await s.bus.submit('FIND');
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.command).toBeUndefined();
  });

  it("a table's text replaced where it cannot be measured keeps its rows", async () => {
    const s = setup({ measure: false });
    await s.bus.submit('FIND');
    const options = { ...DEFAULT_FIND_SETTINGS.options, types: ['table' as const] };
    await s.press({ op: 'replaceAll' }, { find: 'schedule', replace: 'LIST', options });
    const t = s.geom<TableGeometry>('56');
    expect(t.cells[0]![0]!.text).toBe('DOOR LIST');
    expect(t.rowHeights).toEqual(table.rowHeights);
  });

  it("Search blocks finds text in a dynamic block's state, listed by the block's name", async () => {
    const s = setup({ references: true });
    await s.bus.submit('FIND');
    const only = { ...DEFAULT_FIND_SETTINGS.options, types: ['text' as const] };
    await s.press({ op: 'find' }, { find: 'state', listResults: true, options: only });
    expect(handles(s.dialog()!.results!)).toEqual(['Model (block Door)|Text|DOOR STATE']);
    // Shown through the reference that draws it.
    expect(s.zoomed()).toEqual(['63']);
    await s.press({ op: 'replaceAll' }, { replace: 'OPEN' });
    expect(s.geom<TextGeometry>('62').value).toBe('DOOR OPEN');
    await s.press({ op: 'find' }, { find: 'door', options: { ...only, searchBlocks: false } });
    expect(handles(s.dialog()!.results!)).not.toContain('Model (block Door)|Text|DOOR OPEN');
    // Other anonymous blocks stay out.
    expect(handles(s.dialog()!.results!).some((r) => r.includes('ANONYMOUS'))).toBe(false);
  });

  it('Search xrefs finds the text of a loaded xref but never replaces it', async () => {
    const s = setup({ references: true });
    await s.bus.submit('FIND');
    const only = { ...DEFAULT_FIND_SETTINGS.options, types: ['text' as const] };
    expect(DEFAULT_FIND_SETTINGS.options.searchXrefs).toBe(false);
    await s.press({ op: 'find' }, { find: 'xref', listResults: true, options: only });
    expect(s.dialog()).toMatchObject({ note: NOT_FOUND });
    await s.press(
      { op: 'find' },
      { find: 'xref', replace: 'X', options: { ...only, searchXrefs: true } },
    );
    expect(handles(s.dialog()!.results!)).toEqual(['Model (xref PLAN)|Text|DOOR IN XREF']);
    expect(s.zoomed()).toEqual(['64']);
    await s.press({ op: 'replace' });
    expect(s.geom<TextGeometry>('70').value).toBe('DOOR IN XREF');
    expect(s.dialog()).toMatchObject({ note: 'The text is in an xref and cannot be replaced.' });
    await s.press({ op: 'replaceAll' }, { find: 'door' });
    expect(s.geom<TextGeometry>('70').value).toBe('DOOR IN XREF');
    expect(s.dialog()!.note).toMatch(/1 match in an xref was not\.$/);
  });
});
