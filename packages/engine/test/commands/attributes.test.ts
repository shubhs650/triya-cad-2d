// M2-12: attribute editing on the PromptBus with AutoCAD 2024's prompts and dialogs ("EATTEDIT
// (Command)", "ATTEDIT (Command)", "-ATTEDIT (Command)", "TEXTEDIT (Command)" on an attribute
// definition, "DBLCLKEDIT (System Variable)", AutoCAD 2024 Help). The dialogs are prompts the app
// answers with what changed; here the tests answer them as the app does.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  doubleClickCommand,
  patchAttribute,
  wcmatch,
  type AttdefGeometry,
  type DialogPrompt,
  type Entity,
  type InsertAttribute,
  type InsertGeometry,
  type MTextGeometry,
  type StringPrompt,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { blockRecord, entityInit, layer, sampleInit } from '../model/fixtures';

const STANDARD = '30';
const NOTES_STYLE = '31';
const TB = '50';
const EMPTY = '51';
const LAYER_TITLE = '12';

const style = (handle: string, name: string): TextStyleRecord => ({
  handle,
  name,
  font: 'arial.ttf',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

const text = (tag: string, value: string, at: { x: number; y: number }) => ({
  value,
  style: STANDARD,
  position: at,
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  tag,
  flags: 0,
});

const mtext = (contents: string, at: { x: number; y: number }): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: STANDARD,
  position: at,
  height: 2.5,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

const attdef = (h: string, tag: string, prompt: string, extra: Partial<AttdefGeometry> = {}) =>
  entityInit(
    h,
    { kind: 'ATTDEF', ...text(tag, '', { x: 0, y: 0 }), prompt, ...extra },
    { owner: TB },
  );

const attrib = (
  h: string,
  tag: string,
  value: string,
  at: { x: number; y: number },
  extra: Partial<InsertAttribute> = {},
): InsertAttribute => ({
  handle: h,
  layer: '10',
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  ...text(tag, value, at),
  ...extra,
});

const insert = (block: string, at: { x: number; y: number }, attributes: InsertAttribute[]) => ({
  kind: 'INSERT' as const,
  block,
  position: at,
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes,
});

/**
 * A title block TB (title, revision, multiline notes, an invisible attribute and a constant
 * logo) inserted twice, at (100, 0) and (300, 0), and a block without attributes at (500, 0).
 */
function setup() {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    handSeed: '100',
    header: new Map([...init.header!, ['$TEXTSTYLE', 'Standard']]),
    tables: {
      ...init.tables,
      layers: [...init.tables!.layers!, layer(LAYER_TITLE, 'TITLE')],
      textStyles: [style(STANDARD, 'Standard'), style(NOTES_STYLE, 'Notes')],
      blockRecords: [
        ...init.tables!.blockRecords!,
        blockRecord(TB, 'TB'),
        blockRecord(EMPTY, 'EMPTY'),
      ],
    },
    blocks: [
      ...init.blocks!,
      { handle: TB, name: 'TB', basePoint: { x: 0, y: 0 } },
      { handle: EMPTY, name: 'EMPTY', basePoint: { x: 0, y: 0 } },
    ],
    entities: [
      ...init.entities!,
      attdef('52', 'TITLE', 'Drawing title'),
      attdef('53', 'REV', 'Revision'),
      attdef('54', 'NOTES', 'Notes', { mtext: mtext('', { x: 0, y: -10 }) }),
      attdef('55', 'SECRET', 'Secret', { flags: 1 }),
      attdef('56', 'LOGO', 'Logo', { flags: 2, value: 'ACME' }),
      entityInit(
        '60',
        insert(TB, { x: 100, y: 0 }, [
          attrib('61', 'TITLE', 'Pump house', { x: 100, y: 10 }),
          attrib('62', 'REV', 'A', { x: 100, y: 5 }),
          attrib(
            '63',
            'NOTES',
            '',
            { x: 100, y: -10 },
            {
              mtext: mtext('Line one\\PLine two', { x: 100, y: -10 }),
            },
          ),
          attrib('64', 'SECRET', 'hidden', { x: 100, y: -20 }, { flags: 1 }),
        ]),
      ),
      entityInit(
        '70',
        insert(TB, { x: 300, y: 0 }, [
          attrib('71', 'TITLE', 'Valve pit', { x: 300, y: 10 }),
          attrib('72', 'REV', 'A', { x: 300, y: 5 }),
        ]),
      ),
      entityInit('80', insert(EMPTY, { x: 500, y: 0 }, [])),
      entityInit('90', {
        kind: 'ATTDEF',
        ...text('PART', 'P-1', { x: 700, y: 0 }),
        prompt: 'Part number',
      }),
    ],
  });
  // The test canvas: a pick finds the objects whose insertion point is within 5 of it.
  const answer = (r: ViewRequest): ViewReply => {
    if (r.op !== 'pick') return { ok: false, message: 'not drawn' };
    const ids = [...model.entities()]
      .filter((e) => {
        const g = e.geom as { position?: { x: number; y: number } };
        return g.position && Math.hypot(g.position.x - r.point.x, g.position.y - r.point.y) <= 5;
      })
      .map((e) => e.id);
    return { ok: true, ids };
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: (r) => Promise.resolve(answer(r)) },
  });
  const byHandle = (h: string): Entity => [...model.entities()].find((e) => e.handle === h)!;
  const attr = (insertHandle: string, h: string): InsertAttribute =>
    (byHandle(insertHandle).geom as InsertGeometry).attributes.find((a) => a.handle === h)!;
  return { model, bus, byHandle, attr };
}

const dialog = (bus: PromptBus) => (bus.prompt as DialogPrompt).dialog;

describe('EATTEDIT', () => {
  it('opens the Enhanced Attribute Editor on the block picked, with prompts from its ATTDEFs', async () => {
    const { bus } = setup();
    await bus.submit('EATTEDIT');
    expect(bus.promptText).toBe('Select a block:');
    await bus.pick({ x: 100, y: 0 });
    expect(bus.prompt?.kind).toBe('dialog');
    const d = dialog(bus);
    expect(d.type).toBe('eattedit');
    if (d.type !== 'eattedit') return;
    expect(d.block).toBe('TB');
    // Constant attributes are not ATTRIBs; the invisible one is listed, as AutoCAD lists it.
    expect(d.attributes.map((a) => [a.tag, a.prompt, a.value, a.multiline])).toEqual([
      ['TITLE', 'Drawing title', 'Pump house', false],
      ['REV', 'Revision', 'A', false],
      ['NOTES', 'Notes', 'Line one\\PLine two', true],
      ['SECRET', 'Secret', 'hidden', false],
    ]);
    expect(d.styles.map((s) => s.name)).toEqual(['Standard', 'Notes']);
    expect(d.layers.map((l) => l.name)).toContain('TITLE');
  });

  it('OK writes the values, text options and properties changed, as one undo step', async () => {
    const { bus, attr } = setup();
    const commits: unknown[] = [];
    bus.on((e) => (e.type === 'commit' ? commits.push(e.record) : undefined));
    await bus.submit('EATTEDIT');
    await bus.pick({ x: 100, y: 0 });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [
        { handle: '61', value: 'Pump house No. 2' },
        {
          handle: '62',
          value: 'B',
          height: 3.5,
          rotation: Math.PI / 2,
          widthFactor: 0.8,
          oblique: Math.PI / 12,
          backward: true,
          style: NOTES_STYLE,
          layer: LAYER_TITLE,
          color: { kind: 'aci', index: 1 },
          lineweight: 35,
        },
      ],
    });
    expect(bus.command).toBeUndefined();
    expect(attr('60', '61').value).toBe('Pump house No. 2');
    expect(attr('60', '62')).toMatchObject({
      value: 'B',
      height: 3.5,
      widthFactor: 0.8,
      backward: true,
      upsideDown: false,
      style: NOTES_STYLE,
      layer: LAYER_TITLE,
      color: { kind: 'aci', index: 1 },
      lineweight: 35,
      // Untouched: the handle, the tag, the place.
      handle: '62',
      tag: 'REV',
      position: { x: 100, y: 5 },
    });
    // One command record: one undo step for every change the dialog made.
    expect(commits).toHaveLength(1);
  });

  it('a multiline value changes the embedded MTEXT, which follows the style, height and rotation', async () => {
    const { bus, attr } = setup();
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 100, y: 0 });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [{ handle: '63', value: 'New\\Pnotes', height: 2, style: NOTES_STYLE }],
    });
    const a = attr('60', '63');
    expect(a.value).toBe('');
    expect(a.mtext).toMatchObject({ contents: 'New\\Pnotes', height: 2, style: NOTES_STYLE });
    expect(a).toMatchObject({ height: 2, style: NOTES_STYLE });
  });

  it("the value's ... opens the MTEXT editor on a multiline attribute, then the dialog again", async () => {
    const { bus, attr } = setup();
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 100, y: 0 });
    await bus.answer({
      kind: 'dialog',
      action: 'mtext',
      target: '63',
      attributes: [{ handle: '61', value: 'Typed first' }],
    });
    // What was typed in the dialog is kept before the editor opens.
    expect(attr('60', '61').value).toBe('Typed first');
    expect((bus.prompt as StringPrompt).editor).toMatchObject({
      kind: 'mtext',
      value: 'Line one\\PLine two',
      position: { x: 100, y: -10 },
      height: 2.5,
    });
    await bus.answer({ kind: 'string', value: '{\\LLine one}\\PLine three', editor: true });
    expect(attr('60', '63').mtext?.contents).toBe('{\\LLine one}\\PLine three');
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.selected).toBe('63');
    expect(d.type === 'eattedit' && d.attributes[2]!.value).toBe('{\\LLine one}\\PLine three');
    await bus.answer({ kind: 'dialog', action: 'ok' });
    expect(bus.command).toBeUndefined();
  });

  it('Apply keeps the dialog open; Cancel after it keeps what was applied', async () => {
    const { bus, attr } = setup();
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 100, y: 0 });
    await bus.answer({
      kind: 'dialog',
      action: 'apply',
      target: '62',
      attributes: [{ handle: '62', value: 'C' }],
    });
    expect(bus.prompt?.kind).toBe('dialog');
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.selected).toBe('62');
    expect(d.type === 'eattedit' && d.attributes[1]!.value).toBe('C');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(attr('60', '62').value).toBe('C');
  });

  it('Select block picks another reference, without the pre-selection', async () => {
    const { bus, attr } = setup();
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 100, y: 0 });
    await bus.answer({
      kind: 'dialog',
      action: 'select',
      attributes: [{ handle: '61', value: 'X' }],
    });
    expect(attr('60', '61').value).toBe('X');
    expect(bus.promptText).toBe('Select a block:');
    await bus.pick({ x: 300, y: 0 });
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.attributes[0]!.value).toBe('Valve pit');
  });

  it('refuses objects that are not blocks, and blocks without attributes, and asks again', async () => {
    const { bus, byHandle } = setup();
    await bus.script(['EATTEDIT']);
    await bus.answer({ kind: 'selection', ids: [byHandle('20').id] });
    expect(bus.history.at(-1)).toBe('That object is not a block.');
    await bus.pick({ x: 500, y: 0 });
    expect(bus.history.at(-1)).toBe('That block has no editable attributes.');
    expect(bus.promptText).toBe('Select a block:');
  });

  it('a dialog closed without changes edits nothing', async () => {
    const { bus } = setup();
    const commits: unknown[] = [];
    bus.on((e) => (e.type === 'commit' ? commits.push(e) : undefined));
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 100, y: 0 });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [{ handle: '61', value: 'Pump house' }],
    });
    expect(commits).toEqual([]);
  });
});

describe('ATTEDIT', () => {
  it('opens Edit Attributes on the reference picked and writes its values only', async () => {
    const { bus, attr } = setup();
    await bus.submit('ATE');
    expect(bus.command).toBe('ATTEDIT');
    expect(bus.promptText).toBe('Select block reference:');
    await bus.pick({ x: 300, y: 0 });
    const d = dialog(bus);
    expect(d.type).toBe('attedit');
    expect(d.type === 'attedit' && d.attributes.map((a) => a.prompt)).toEqual([
      'Drawing title',
      'Revision',
    ]);
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [{ handle: '72', value: 'B', height: 9 }],
    });
    expect(bus.command).toBeUndefined();
    expect(attr('70', '72')).toMatchObject({ value: 'B', height: 2.5 });
  });

  it('Esc closes the dialog without changes', async () => {
    const { bus, attr } = setup();
    await bus.script(['ATTEDIT']);
    await bus.pick({ x: 300, y: 0 });
    await bus.cancel();
    expect(attr('70', '72').value).toBe('A');
  });
});

describe('-ATTEDIT', () => {
  it('edits one attribute at a time: Value Replace and Change, Height, Angle, Layer, Color', async () => {
    const { bus, attr } = setup();
    await bus.submit('-ATTEDIT');
    expect(bus.promptText).toBe('Edit attributes one at a time? [Yes/No] <Yes>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter block name specification <*>:');
    await bus.script(['TB', 'REV,TITLE', '*']);
    expect(bus.promptText).toBe('Select Attributes:');
    await bus.pick({ x: 100, y: 0 });
    await bus.submit('');
    expect(bus.history).toContain('2 attributes selected.');
    const OPTIONS = 'Enter an option [Value/Position/Height/Angle/Style/Layer/Color/Next] <Next>:';
    expect(bus.promptText).toBe(OPTIONS);
    // The first: TITLE.
    await bus.script(['V', 'C', 'house', 'shed']);
    expect(attr('60', '61').value).toBe('Pump shed');
    await bus.script(['N']);
    // The second: REV.
    await bus.script(['V', '', 'Rev B']);
    await bus.script(['H', '5', 'A', '90', 'L', 'title', 'C', 'red']);
    expect(attr('60', '62')).toMatchObject({
      value: 'Rev B',
      height: 5,
      layer: LAYER_TITLE,
      color: { kind: 'aci', index: 1 },
    });
    expect(attr('60', '62').rotation).toBeCloseTo(Math.PI / 2);
    await bus.script(['P', '120,40']);
    expect(attr('60', '62').position).toEqual({ x: 120, y: 40 });
    await bus.submit('');
    expect(bus.command).toBeUndefined();
  });

  it('runs as -ATE too, and refuses an unknown style or layer', async () => {
    const { bus, attr } = setup();
    await bus.script(['-ATE', 'Y', '*', 'REV', '*']);
    await bus.pick({ x: 300, y: 0 });
    await bus.submit('');
    await bus.script(['S', 'Nope']);
    expect(bus.history.at(-1)).toBe('Cannot find text style "Nope".');
    await bus.script(['S', 'notes', 'L', 'Nope']);
    expect(bus.history.at(-1)).toBe('Cannot find layer "Nope".');
    expect(attr('70', '72').style).toBe(NOTES_STYLE);
  });

  it('skips invisible attributes unless ATTMODE is 2, and filters by value', async () => {
    const { bus } = setup();
    await bus.script(['-ATTEDIT', 'Y', '*', '*', 'Pump*']);
    await bus.pick({ x: 100, y: 0 });
    await bus.pick({ x: 300, y: 0 });
    await bus.submit('');
    expect(bus.history).toContain('1 attributes selected.');
    await bus.cancel();
    await bus.script(['-ATTEDIT', 'Y', '*', 'SECRET', '*']);
    await bus.pick({ x: 100, y: 0 });
    await bus.submit('');
    expect(bus.history).toContain('0 attributes selected.');
    expect(bus.command).toBeUndefined();
  });

  it('global editing replaces a string in every matching value of the whole drawing', async () => {
    const { bus, attr } = setup();
    await bus.script(['-ATTEDIT', 'N']);
    expect(bus.history).toContain('Performing global editing of attribute values.');
    expect(bus.promptText).toBe('Edit only attributes visible on screen? [Yes/No] <Yes>:');
    await bus.script(['N', '*', 'REV', '*']);
    expect(bus.history).toContain('Drawing must be regenerated afterwards.');
    expect(bus.history).toContain('2 attributes selected.');
    await bus.script(['A', 'B']);
    expect(bus.command).toBeUndefined();
    expect([attr('60', '62').value, attr('70', '72').value]).toEqual(['B', 'B']);
  });

  it('global editing on the attributes selected', async () => {
    const { bus, attr } = setup();
    await bus.script(['-ATTEDIT', 'N', 'Y', '*', 'TITLE', '*']);
    await bus.pick({ x: 300, y: 0 });
    await bus.submit('');
    await bus.script(['pit', 'chamber']);
    expect(attr('70', '71').value).toBe('Valve chamber');
    expect(attr('60', '61').value).toBe('Pump house');
  });
});

describe('TEXTEDIT on an attribute definition', () => {
  it('opens Edit Attribute Definition with its tag, prompt and default', async () => {
    const { bus, byHandle } = setup();
    await bus.submit('TEXTEDIT');
    await bus.pick({ x: 700, y: 0 });
    expect(dialog(bus)).toEqual({
      type: 'attdef',
      tag: 'PART',
      prompt: 'Part number',
      value: 'P-1',
      multiline: false,
    });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attdef: { tag: 'part no', prompt: 'Part', value: 'P-2' },
    });
    expect(bus.history.at(-1)).toMatch(/^Invalid attribute tag/);
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attdef: { tag: 'part_no', prompt: 'Part', value: 'P-2' },
    });
    expect(byHandle('90').geom).toMatchObject({ tag: 'PART_NO', prompt: 'Part', value: 'P-2' });
    // Multiple mode asks for the next object.
    expect(bus.promptText).toBe('Select an annotation object or [Undo/Mode]:');
    await bus.submit('U');
    expect(byHandle('90').geom).toMatchObject({ tag: 'PART', value: 'P-1' });
  });

  it("edits a multiline definition's default in the MTEXT editor", async () => {
    const { bus, model, byHandle } = setup();
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [byHandle('54').id] });
    expect(dialog(bus)).toMatchObject({ type: 'attdef', multiline: true, value: '' });
    await bus.answer({
      kind: 'dialog',
      action: 'mtext',
      attdef: { tag: 'NOTES', prompt: 'Notes', value: '' },
    });
    expect((bus.prompt as StringPrompt).editor?.kind).toBe('mtext');
    await bus.answer({ kind: 'string', value: 'See\\Psheet 2', editor: true });
    expect(dialog(bus)).toMatchObject({ value: 'See\\Psheet 2' });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attdef: { tag: 'NOTES', prompt: 'Notes', value: 'See\\Psheet 2' },
    });
    const g = model.entity(byHandle('54').id)!.geom as AttdefGeometry;
    expect(g.mtext?.contents).toBe('See\\Psheet 2');
  });
});

describe('double-click', () => {
  it('on a reference with attributes runs EATTEDIT on it', async () => {
    const { bus } = setup();
    await bus.doubleClick({ x: 300, y: 0 });
    expect(bus.command).toBe('EATTEDIT');
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.attributes[0]!.value).toBe('Valve pit');
  });

  it('on an attribute definition runs TEXTEDIT, which opens Edit Attribute Definition', async () => {
    const { bus } = setup();
    await bus.doubleClick({ x: 700, y: 0 });
    expect(bus.command).toBe('TEXTEDIT');
    expect(dialog(bus).type).toBe('attdef');
  });

  it('on a block without attributes opens nothing', async () => {
    const { bus, byHandle } = setup();
    expect(doubleClickCommand(byHandle('80'))).toBeUndefined();
    await bus.doubleClick({ x: 500, y: 0 });
    expect(bus.command).toBeUndefined();
  });
});

describe('wcmatch', () => {
  it.each([
    ['REV1_DATE', 'REV#_*', true],
    ['REV1_DATE', 'rev?_date', true],
    ['REVA_DATE', 'REV#_*', false],
    ['TITLE', '~TITLE', false],
    ['NOTES', '~TITLE', true],
    ['B', '[ABC]', true],
    ['D', '[~ABC]', true],
    ['A,B', 'A`,B', true],
    ['X', 'TITLE,X', true],
    ['A1', '@#', true],
    ['A-', '@.', true],
  ])('%s matches %s: %s', (text, pattern, hit) => {
    expect(wcmatch(text, pattern)).toBe(hit);
  });

  it('matches values with case when asked', () => {
    expect(wcmatch('Pump', 'pump', false)).toBe(false);
    expect(wcmatch('Pump', 'P*', false)).toBe(true);
  });
});

describe('patchAttribute', () => {
  it('returns the same attribute when nothing changes', () => {
    const a = attrib('61', 'TITLE', 'X', { x: 0, y: 0 });
    expect(patchAttribute(a, { handle: '61', value: 'X', color: { kind: 'byLayer' } })).toEqual(a);
  });
});
