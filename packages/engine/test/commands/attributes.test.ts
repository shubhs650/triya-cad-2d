// M2-12: attribute editing on the PromptBus with AutoCAD 2024's prompts and dialogs ("EATTEDIT
// (Command)", "ATTEDIT (Command)", "-ATTEDIT (Command)", "TEXTEDIT (Command)" on an attribute
// definition, "DBLCLKEDIT (System Variable)", AutoCAD 2024 Help). The dialogs are prompts the app
// answers with what changed; here the tests answer them as the app does.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  attributeEntries,
  builtinCommands,
  doubleClickCommand,
  insertionPoint,
  patchAttribute,
  rejustified,
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
const DOOR = '57';
const DOOR_STATE = '58';

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
function setup(o: { fonts?: boolean; namedPlotStyles?: boolean; books?: boolean } = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    handSeed: '100',
    header: new Map([
      ...init.header!,
      ['$TEXTSTYLE', 'Standard'],
      ['$PSTYLEMODE', o.namedPlotStyles ? 0 : 1],
    ]),
    tables: {
      ...init.tables,
      plotStyles: [
        { handle: '40', name: 'Normal' },
        { handle: '41', name: 'Thick' },
      ],
      layers: [...init.tables!.layers!, layer(LAYER_TITLE, 'TITLE')],
      textStyles: [style(STANDARD, 'Standard'), style(NOTES_STYLE, 'Notes')],
      blockRecords: [
        ...init.tables!.blockRecords!,
        blockRecord(TB, 'TB'),
        blockRecord(EMPTY, 'EMPTY'),
        blockRecord(DOOR, 'DOOR'),
        blockRecord(DOOR_STATE, '*U5'),
      ],
    },
    blocks: [
      ...init.blocks!,
      { handle: TB, name: 'TB', basePoint: { x: 0, y: 0 } },
      { handle: EMPTY, name: 'EMPTY', basePoint: { x: 0, y: 0 } },
      { handle: DOOR, name: 'DOOR', basePoint: { x: 0, y: 0 }, dynamic: { name: 'Door' } },
      { handle: DOOR_STATE, name: '*U5', basePoint: { x: 0, y: 0 }, dynamicOf: DOOR },
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
          attrib('72', 'REV', 'A', { x: 300, y: 5 }, o.books ? { color: RAL_3020 } : {}),
        ]),
      ),
      entityInit('80', insert(EMPTY, { x: 500, y: 0 }, [])),
      entityInit(
        '59',
        { kind: 'ATTDEF', ...text('MARK', '', { x: 0, y: 0 }), prompt: 'Door mark' },
        { owner: DOOR },
      ),
      // A dynamic block's state: its prompts come from the dynamic block; EXTRA has no ATTDEF
      // and is centred (DXF 72 = 1) about its alignment point; SPEC is multiline.
      entityInit(
        '85',
        insert(DOOR_STATE, { x: 900, y: 0 }, [
          attrib('86', 'MARK', 'D1', { x: 900, y: 10 }),
          attrib(
            '87',
            'EXTRA',
            'x',
            { x: 895, y: 5 },
            { halign: 1, alignmentPoint: { x: 900, y: 5 } },
          ),
          attrib('88', 'SPEC', '', { x: 900, y: -5 }, { mtext: mtext('Oak', { x: 900, y: -5 }) }),
        ]),
      ),
      entityInit('90', {
        kind: 'ATTDEF',
        ...text('PART', 'P-1', { x: 700, y: 0 }),
        prompt: 'Part number',
      }),
    ],
  });
  // The test canvas: a pick finds the objects whose insertion point is within 5 of it; a
  // TEXT's characters are 2 wide with 0.5 below the baseline, an MTEXT is a 10 by 5 box below
  // its insertion point, and the pickbox is 0.25.
  const answer = (r: ViewRequest): ViewReply => {
    if (r.op === 'textOutlines') {
      // Without fonts the canvas measures nothing.
      if (o.fonts === false) return { ok: true, pickbox: 0.25, outlines: r.texts.map(() => null) };
      return {
        ok: true,
        pickbox: 0.25,
        outlines: r.texts.map((t) => {
          if (t.kind === 'MTEXT') {
            const { x, y } = t.position;
            const corners = [
              { x, y: y - 5 },
              { x: x + 10, y: y - 5 },
              { x: x + 10, y },
              { x, y },
            ];
            return { corners, width: 0, below: 0 };
          }
          const width = t.value.length * 2;
          const at = insertionPoint(t);
          const x0 = t.halign === 1 ? at.x - width / 2 : t.halign === 2 ? at.x - width : at.x;
          const y0 = t.valign === 3 ? at.y - t.height : at.y;
          const corners = [
            { x: x0, y: y0 - 0.5 },
            { x: x0 + width, y: y0 - 0.5 },
            { x: x0 + width, y: y0 + t.height },
            { x: x0, y: y0 + t.height },
          ];
          return { corners, width, below: 0.5 };
        }),
      };
    }
    if (r.op === 'select') {
      // A window takes the objects whose insertion point lies in it, crossing or not.
      const [lo, hi] = [
        { x: Math.min(r.a.x, r.b.x), y: Math.min(r.a.y, r.b.y) },
        { x: Math.max(r.a.x, r.b.x), y: Math.max(r.a.y, r.b.y) },
      ];
      const ids = [...model.entities()]
        .filter((e) => {
          const p = (e.geom as { position?: { x: number; y: number } }).position;
          return p && p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
        })
        .map((e) => e.id);
      return { ok: true, ids };
    }
    if (r.op !== 'pick') return { ok: false, message: 'not drawn' };
    const near = (p: { x: number; y: number } | undefined) =>
      p !== undefined && Math.hypot(p.x - r.point.x, p.y - r.point.y) <= 5;
    const ids = [...model.entities()]
      .filter((e) => {
        const g = e.geom as { position?: { x: number; y: number } };
        // A reference is picked by its attributes too.
        return (
          near(g.position) ||
          (e.geom.kind === 'INSERT' && e.geom.attributes.some((a) => near(a.position)))
        );
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

/** A colour-book colour, as a drawing that uses one maps it (DXF 420 and 430). */
const RAL_3020 = {
  kind: 'rgb',
  r: 204,
  g: 6,
  b: 5,
  bookName: 'RAL CLASSIC',
  colorName: 'RAL 3020',
} as const;

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
    // Each attribute picked on its text (M2-27), in the order picked.
    await bus.pick({ x: 101, y: 11 });
    await bus.pick({ x: 101, y: 6 });
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
    await bus.pick({ x: 301, y: 6 });
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
    await bus.pick({ x: 101, y: 11 });
    await bus.pick({ x: 301, y: 11 });
    await bus.submit('');
    expect(bus.history).toContain('1 attributes selected.');
    await bus.cancel();
    // An invisible attribute is not drawn, so a pick where it would be takes nothing.
    await bus.script(['-ATTEDIT', 'Y', '*', 'SECRET', '*']);
    await bus.pick({ x: 101, y: -19 });
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
    await bus.pick({ x: 301, y: 11 });
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

// M2-27: the Enhanced Attribute Editor's Justification, Plot style and Annotative, and the
// attribute a block was picked or double-clicked by opening selected.
describe('EATTEDIT: the attribute under the cursor', () => {
  it('opens on the attribute the block was picked by', async () => {
    const { bus } = setup();
    await bus.submit('EATTEDIT');
    // REV's text runs from (100, 4.5) to (102, 7.5); the reference is at (100, 0).
    await bus.pick({ x: 101, y: 4.8 });
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.selected).toBe('62');
  });

  it('takes a pick within the pickbox of the text, and none on the rest of the block', async () => {
    const { bus } = setup();
    await bus.submit('EATTEDIT');
    await bus.pick({ x: 102.1, y: 4.4 });
    const near = dialog(bus);
    expect(near.type === 'eattedit' && near.selected).toBe('62');
    await bus.answer({ kind: 'dialog', action: 'select' });
    await bus.pick({ x: 103, y: 2 });
    const off = dialog(bus);
    expect(off.type === 'eattedit' && off.selected).toBeUndefined();
  });

  it('a double click on an attribute opens EATTEDIT on it', async () => {
    const { bus } = setup();
    await bus.doubleClick({ x: 101, y: 4.8 });
    expect(bus.command).toBe('EATTEDIT');
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.selected).toBe('62');
  });

  it('a block picked at Command: then EATTEDIT opens on the attribute picked', async () => {
    const { bus } = setup();
    await bus.pick({ x: 101, y: 4.8 });
    await bus.submit('EATTEDIT');
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.selected).toBe('62');
  });

  it('a multiline attribute is picked by its box; an invisible one is not drawn to pick', async () => {
    const { bus } = setup();
    await bus.doubleClick({ x: 101, y: -11 });
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.selected).toBe('63');
    expect(d.type === 'eattedit' && d.attributes.find((a) => a.tag === 'NOTES')?.attachment).toBe(
      1,
    );
    await bus.cancel();
    // SECRET is invisible (ATTMODE 1): its text is not drawn, so a pick there selects nothing.
    await bus.doubleClick({ x: 101, y: -19 });
    const hidden = dialog(bus);
    expect(hidden.type === 'eattedit' && hidden.selected).toBeUndefined();
  });

  it('without a font to measure the text, the list opens on the first attribute', async () => {
    const { bus } = setup({ fonts: false });
    await bus.doubleClick({ x: 101, y: 4.8 });
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.selected).toBeUndefined();
  });
});

describe('EATTEDIT: Justification', () => {
  const justify = async (o: Parameters<typeof setup>[0], patch: Record<string, unknown>) => {
    const s = setup(o);
    await s.bus.submit('EATTEDIT');
    await s.bus.pick({ x: 300, y: 0 });
    await s.bus.answer({ kind: 'dialog', action: 'ok', attributes: [{ handle: '72', ...patch }] });
    return { ...s, rev: s.attr('70', '72') };
  };

  it('keeps the insertion point and moves the text about it', async () => {
    // REV "A" is left-baseline at (300, 5), 2 wide: Center puts DXF 11 there, DXF 10 at 299.
    const centred = (await justify({}, { halign: 1 })).rev;
    expect([centred.halign, centred.valign]).toEqual([1, 0]);
    expect(centred.alignmentPoint).toEqual({ x: 300, y: 5 });
    expect(centred.position).toEqual({ x: 299, y: 5 });
    // Top right: the baseline start one width left and one height down.
    const topRight = (await justify({}, { halign: 2, valign: 3 })).rev;
    expect(topRight.alignmentPoint).toEqual({ x: 300, y: 5 });
    expect(topRight.position).toEqual({ x: 298, y: 2.5 });
    // Bottom left: the descender line on the point.
    const bottom = (await justify({}, { halign: 0, valign: 1 })).rev;
    expect(bottom.position).toEqual({ x: 300, y: 5.5 });
  });

  it('Aligned and Fit run from the insertion point for the text as drawn', async () => {
    const fit = (await justify({}, { halign: 5 })).rev;
    expect([fit.halign, fit.valign]).toEqual([5, 0]);
    expect(fit.position).toEqual({ x: 300, y: 5 });
    expect(fit.alignmentPoint).toEqual({ x: 302, y: 5 });
  });

  it('without a font, DXF 10 stays at the insertion point and Aligned is refused', async () => {
    const centred = (await justify({ fonts: false }, { halign: 1 })).rev;
    expect(centred.halign).toBe(1);
    expect(centred.position).toEqual({ x: 300, y: 5 });
    expect(centred.alignmentPoint).toEqual({ x: 300, y: 5 });
    const aligned = await justify({ fonts: false }, { halign: 3 });
    expect(aligned.rev.halign).toBe(0);
    expect(aligned.bus.history).toContain(
      'The REV attribute cannot be measured: its justification is unchanged.',
    );
  });

  it("a centred attribute made Left starts at its old alignment point; a multiline one's attachment changes in place", async () => {
    const { bus, attr } = setup();
    await bus.submit('EATTEDIT');
    await bus.pick({ x: 900, y: 0 });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [
        { handle: '87', halign: 0, valign: 0 },
        { handle: '88', attachment: 5, halign: 2 },
      ],
    });
    const extra = attr('85', '87');
    expect([extra.halign, extra.valign]).toEqual([0, 0]);
    expect(extra.position).toEqual({ x: 900, y: 5 });
    expect(extra.alignmentPoint).toEqual({ x: 900, y: 5 });
    const spec = attr('85', '88');
    expect(spec.mtext?.attachment).toBe(5);
    expect(spec.mtext?.position).toEqual({ x: 900, y: -5 });
    // A multiline attribute's DXF 72 is not its justification.
    expect(spec.halign).toBe(0);
  });

  it('rejustified turns the offsets with the text and mirrors them when backwards', () => {
    const t = {
      value: 'AB',
      style: '30',
      position: { x: 10, y: 10 },
      height: 2,
      rotation: Math.PI / 2,
      widthFactor: 1,
      oblique: 0,
      halign: 0,
      valign: 0,
      backward: false,
      upsideDown: false,
    };
    const outline = { corners: [], width: 4, below: 0.5 };
    const r = rejustified(t, 2, 0, outline)!;
    expect(r.alignmentPoint).toEqual({ x: 10, y: 10 });
    expect(r.position.x).toBeCloseTo(10);
    expect(r.position.y).toBeCloseTo(6);
    const back = rejustified({ ...t, rotation: 0, backward: true }, 2, 0, outline)!;
    expect(back.position).toEqual({ x: 14, y: 10 });
    // Middle (DXF 72 = 4): centred on the run between descender and height.
    const middle = rejustified({ ...t, rotation: 0 }, 4, 0, outline)!;
    expect(middle.position).toEqual({ x: 8, y: 10 - 0.75 });
    // Aligned to Fit keeps both points.
    const aligned = { ...t, halign: 3, alignmentPoint: { x: 10, y: 20 } };
    expect(rejustified(aligned, 5, 0)).toEqual({
      position: { x: 10, y: 10 },
      alignmentPoint: { x: 10, y: 20 },
      halign: 5,
      valign: 0,
    });
    expect(insertionPoint(aligned)).toEqual({ x: 10, y: 10 });
  });
});

describe('EATTEDIT: Plot style and Annotative', () => {
  it('offers the named plot styles in a named-plot-style drawing; ByLayer takes the name off', async () => {
    const { bus, attr } = setup({ namedPlotStyles: true });
    await bus.submit('EATTEDIT');
    await bus.pick({ x: 300, y: 0 });
    const d = dialog(bus);
    if (d.type !== 'eattedit') throw new Error('no dialog');
    expect(d.plotStyles?.map((p) => p.name)).toEqual(['Normal', 'Thick']);
    expect(d.attributes[0]!.plotStyle).toBeNull();
    await bus.answer({
      kind: 'dialog',
      action: 'apply',
      attributes: [{ handle: '71', plotStyle: '41' }],
    });
    expect(attr('70', '71').plotStyle).toBe('41');
    const again = dialog(bus);
    expect(again.type === 'eattedit' && again.attributes[0]!.plotStyle).toBe('41');
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [{ handle: '71', plotStyle: null }],
    });
    expect('plotStyle' in attr('70', '71')).toBe(false);
  });

  it('a colour-dependent drawing offers none (the dialog shows ByColor)', async () => {
    const { bus } = setup();
    await bus.submit('EATTEDIT');
    await bus.pick({ x: 300, y: 0 });
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.plotStyles).toBeUndefined();
  });

  it('shows whether an attribute is annotative, whose justification stays', () => {
    const annotative: InsertAttribute = {
      ...attrib('99', 'NOTE', 'x', { x: 0, y: 0 }),
      annotative: { representations: [{ handle: '9A' }] },
    };
    const { model } = setup();
    const g = insert('50', { x: 0, y: 0 }, [annotative]);
    expect(attributeEntries(model, g)[0]!.annotative).toBe(true);
    expect(patchAttribute(annotative, { handle: '99', halign: 1 })).toBe(annotative);
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

describe("attribute editing: the rest of AutoCAD's behaviour", () => {
  it("names a dynamic block's state by its dynamic block, with its prompts; an attribute without an ATTDEF shows its tag", async () => {
    const { bus } = setup();
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 900, y: 0 });
    const d = dialog(bus);
    expect(d.type === 'eattedit' && d.block).toBe('Door');
    expect(d.type === 'eattedit' && d.attributes.map((a) => a.prompt)).toEqual([
      'Door mark',
      'EXTRA',
      'SPEC',
    ]);
  });

  it('Enter on the command line closes the dialogs unchanged; an empty pick ends EATTEDIT', async () => {
    const { bus, attr } = setup();
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 100, y: 0 });
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    await bus.script(['ATTEDIT']);
    await bus.pick({ x: 100, y: 0 });
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    await bus.script(['EATTEDIT']);
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    expect(attr('60', '61').value).toBe('Pump house');
  });

  it('the MTEXT editor closed with Enter keeps the value; one cancelled ends the command', async () => {
    const { bus, attr } = setup();
    await bus.script(['EATTEDIT']);
    await bus.pick({ x: 900, y: 0 });
    await bus.answer({ kind: 'dialog', action: 'mtext', target: '88' });
    await bus.submit('');
    expect(bus.prompt?.kind).toBe('dialog');
    // A target that is not multiline opens no editor.
    await bus.answer({ kind: 'dialog', action: 'mtext', target: '86' });
    expect(bus.prompt?.kind).toBe('dialog');
    await bus.answer({ kind: 'dialog', action: 'mtext', target: '88' });
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(attr('85', '88').mtext?.contents).toBe('Oak');
  });

  it('-ATTEDIT: Value Change not found, Replace with nothing, Position, Height, Angle and Style defaults', async () => {
    const { bus, attr } = setup();
    await bus.script(['-ATTEDIT', '', 'door', '*', '*']);
    // A window round the reference holds all three attributes.
    await bus.pick({ x: 880, y: 20 });
    await bus.pick({ x: 925, y: -15 });
    await bus.submit('');
    expect(bus.history).toContain('3 attributes selected.');
    // MARK.
    await bus.script(['V', 'C', 'zz', 'y']);
    expect(bus.history.at(-1)).toBe('String not found.');
    await bus.script(['V', 'R', '']);
    expect(attr('85', '86').value).toBe('');
    await bus.script(['P', '']);
    await bus.script(['H', '0']);
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.script(['H', '', 'A', '', 'S', '', 'L', '']);
    expect(attr('85', '86')).toMatchObject({
      height: 2.5,
      rotation: 0,
      style: STANDARD,
      position: { x: 900, y: 10 },
    });
    await bus.submit('N');
    // EXTRA: moved by its alignment point, both points with it.
    await bus.script(['P', '910,20']);
    expect(attr('85', '87')).toMatchObject({
      position: { x: 905, y: 20 },
      alignmentPoint: { x: 910, y: 20 },
    });
    await bus.submit('N');
    // SPEC: multiline, its MTEXT moves, turns and takes the new value.
    await bus.script(['P', '900,-15', 'A', '90', 'V', 'C', 'Oak', 'Ash']);
    const spec = attr('85', '88');
    expect(spec.mtext).toMatchObject({ contents: 'Ash', position: { x: 900, y: -15 } });
    expect(spec.mtext?.rotation).toBeCloseTo(Math.PI / 2);
    await bus.submit('');
    expect(bus.command).toBeUndefined();
  });

  it('-ATTEDIT Color: names, numbers, ByBlock, Truecolor; bad input is refused', async () => {
    const { bus, attr } = setup();
    await bus.script(['-ATTEDIT', 'Y', '*', 'TITLE', '*']);
    await bus.pick({ x: 301, y: 11 });
    await bus.submit('');
    const color = () => attr('70', '71').color;
    expect(bus.promptText).toMatch(/<Next>:$/);
    await bus.submit('C');
    expect(bus.promptText).toBe('Enter new color [Truecolor/COlorbook] <BYLAYER>:');
    await bus.submit('3');
    expect(color()).toEqual({ kind: 'aci', index: 3 });
    await bus.script(['C', '']);
    expect(color()).toEqual({ kind: 'aci', index: 3 });
    for (const [typed, want] of [
      ['0', { kind: 'byBlock' }],
      ['256', { kind: 'byLayer' }],
      ['byblock', { kind: 'byBlock' }],
      ['bylayer', { kind: 'byLayer' }],
      ['white', { kind: 'aci', index: 7 }],
      ['200', { kind: 'aci', index: 200 }],
    ] as const) {
      await bus.script(['C', typed]);
      expect(color()).toEqual(want);
    }
    await bus.script(['C', '']);
    expect(bus.history.some((l) => l.includes('<200>'))).toBe(true);
    for (const bad of ['300', 'mauve']) {
      await bus.script(['C', bad]);
      expect(bus.history.at(-1)).toBe('Invalid color.');
    }
    await bus.script(['C', 'T', '10,20,30']);
    expect(color()).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
    await bus.script(['C', '']);
    expect(bus.history.some((l) => l.includes('<10,20,30>'))).toBe(true);
    for (const bad of ['1,2', '1,2,300']) {
      await bus.script(['C', 'T', bad]);
      expect(bus.history.at(-1)).toBe('Invalid color.');
    }
    await bus.script(['C', 'red']);
    await bus.script(['C', '']);
    expect(bus.history.some((l) => l.includes('<RED>'))).toBe(true);
  });

  it('-ATTEDIT Color COlorbook: a colour of a book the drawing uses, by book and colour name', async () => {
    const { bus, attr } = setup({ books: true });
    await bus.script(['-ATTEDIT', 'Y', '*', 'TITLE', '*']);
    await bus.pick({ x: 101, y: 11 });
    await bus.submit('');
    const color = () => attr('60', '61').color;
    await bus.script(['C', 'CO']);
    expect(bus.promptText).toBe('Enter Color Book name:');
    await bus.submit('ral classic');
    expect(bus.promptText).toBe('Enter color name:');
    await bus.submit('ral 3020');
    expect(color()).toEqual(RAL_3020);
    // Shown as BOOK$COLOR, which Enter keeps and which may be typed too.
    await bus.script(['C', '']);
    expect(bus.history.some((l) => l.endsWith('<RAL CLASSIC$RAL 3020>:'))).toBe(true);
    expect(color()).toEqual(RAL_3020);
    await bus.script(['C', '1', 'C', 'Ral Classic$Ral 3020']);
    expect(color()).toEqual(RAL_3020);
    // Triya ships no colour books: only the drawing's own are offered.
    await bus.script(['C', 'CO', 'PANTONE+ Solid Coated']);
    expect(bus.history.at(-1)).toBe('Cannot find color book "PANTONE+ Solid Coated".');
    await bus.script(['C', 'CO', 'RAL CLASSIC', 'RAL 9999']);
    expect(bus.history.at(-1)).toBe('Cannot find color "RAL 9999" in color book "RAL CLASSIC".');
    await bus.script(['C', 'NOPE$RAL 3020']);
    expect(bus.history.at(-1)).toBe('Invalid color.');
    expect(color()).toEqual(RAL_3020);
  });

  it('-ATTEDIT takes the attribute picked, none for a pick off its attributes, and marks the current one with an X', async () => {
    const { bus } = setup();
    const previews: (readonly unknown[])[] = [];
    bus.on((e) => (e.type === 'preview' ? previews.push(e.geometry) : undefined));
    await bus.script(['-ATTEDIT', 'Y', '*', '*', '*']);
    await bus.pick({ x: 101, y: 6 });
    // On the reference's insertion point, clear of every attribute's text.
    await bus.pick({ x: 100, y: 0 });
    await bus.submit('');
    expect(bus.history).toContain('1 attributes selected.');
    // REV's X: twice the pickbox (0.25) each way from its insertion point (100, 5).
    expect(previews.at(-1)).toEqual([
      { kind: 'LINE', start: { x: 99.5, y: 4.5 }, end: { x: 100.5, y: 5.5 } },
      { kind: 'LINE', start: { x: 99.5, y: 5.5 }, end: { x: 100.5, y: 4.5 } },
    ]);
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    expect(previews.at(-1)).toEqual([]);
  });

  it('-ATTEDIT windows: a crossing takes the attributes it crosses, a window only those inside', async () => {
    const { bus } = setup();
    // Over the reference's insertion point and the lower half of REV's text.
    await bus.script(['-ATTEDIT', 'Y', '*', '*', '*', 'C']);
    await bus.pick({ x: 103, y: 6 });
    await bus.pick({ x: 95, y: -1 });
    await bus.submit('');
    expect(bus.history).toContain('1 attributes selected.');
    await bus.cancel();
    // The same corners as a window: REV is not wholly inside.
    await bus.script(['-ATTEDIT', 'Y', '*', '*', '*', 'W']);
    await bus.pick({ x: 95, y: -1 });
    await bus.pick({ x: 103, y: 6 });
    await bus.submit('');
    expect(bus.history.at(-1)).toBe('0 attributes selected.');
    // A window over all the text but the multiline NOTES' lower edge.
    await bus.script(['-ATTEDIT', 'Y', '*', '*', '*', 'W']);
    await bus.pick({ x: 95, y: 13 });
    await bus.pick({ x: 120, y: -12 });
    await bus.submit('');
    expect(bus.history).toContain('2 attributes selected.');
  });

  it('-ATTEDIT takes every attribute of a reference taken whole (ALL), or one the canvas cannot measure', async () => {
    const { bus } = setup();
    await bus.script(['-ATTEDIT', 'Y', 'TB', '*', '*', 'ALL', '']);
    expect(bus.history).toContain('5 attributes selected.');
    await bus.cancel();
    const t = setup({ fonts: false });
    await t.bus.script(['-ATTEDIT', 'Y', '*', '*', '*']);
    await t.bus.pick({ x: 101, y: 11 });
    await t.bus.submit('');
    expect(t.bus.history).toContain('3 attributes selected.');
    // Global editing on the attributes picked, too.
    await t.bus.cancel();
    const u = setup();
    await u.bus.script(['-ATTEDIT', 'N', 'Y', '*', '*', '*']);
    await u.bus.pick({ x: 101, y: 6 });
    await u.bus.submit('');
    expect(u.bus.history).toContain('1 attributes selected.');
  });

  it('-ATTEDIT lists invisible attributes under ATTMODE 2, skips other blocks and non-blocks', async () => {
    const { bus, model, byHandle } = setup();
    model.apply({
      header: [{ name: '$ATTMODE', before: undefined, after: 2 }],
    } as never);
    await bus.script(['-ATTEDIT', 'Y', 'TB', 'SECRET', '*']);
    await bus.answer({
      kind: 'selection',
      ids: [byHandle('60').id, byHandle('20').id, byHandle('85').id],
    });
    expect(bus.history).toContain('1 attributes selected.');
  });

  it('global editing: Enter for the string changes nothing; no attributes found ends', async () => {
    const { bus, attr } = setup();
    await bus.script(['-ATTEDIT', 'N', 'N', '*', 'REV', '*', '', '']);
    expect(bus.command).toBeUndefined();
    expect(attr('60', '62').value).toBe('A');
    await bus.script(['-ATTEDIT', 'N', 'N', 'NONE', '*', '*']);
    expect(bus.history).toContain('0 attributes selected.');
    expect(bus.command).toBeUndefined();
    // A string replaced by nothing.
    await bus.script(['-ATTEDIT', 'N', 'N', '*', 'TITLE', '*', 'Pump ', '']);
    expect(attr('60', '61').value).toBe('house');
  });

  it('TEXTEDIT on an ATTDEF: Enter closes unchanged, OK without fields keeps it, Enter in the editor keeps the default', async () => {
    const { bus, byHandle } = setup();
    const changes: unknown[] = [];
    bus.on((e) => (e.type === 'commit' ? changes.push(e) : undefined));
    await bus.submit('TEXTEDIT');
    await bus.pick({ x: 700, y: 0 });
    await bus.submit('');
    expect(bus.promptText).toBe('Select an annotation object or [Undo/Mode]:');
    await bus.pick({ x: 700, y: 0 });
    await bus.answer({ kind: 'dialog', action: 'ok' });
    await bus.answer({ kind: 'selection', ids: [byHandle('54').id] });
    await bus.answer({ kind: 'dialog', action: 'mtext' });
    await bus.submit('');
    expect(dialog(bus)).toMatchObject({ type: 'attdef', value: '' });
    await bus.answer({ kind: 'dialog', action: 'ok' });
    await bus.submit('');
    expect(changes).toEqual([]);
  });

  it('patchAttribute leaves a multiline attribute alone when its value is the same', () => {
    const a = attrib('9', 'N', '', { x: 0, y: 0 }, { mtext: mtext('Same', { x: 0, y: 0 }) });
    expect(patchAttribute(a, { handle: '9', value: 'Same' })).toBe(a);
    expect(patchAttribute(a, { handle: '9', layer: '11' }).mtext).toBe(a.mtext);
  });

  it('wcmatch takes an unclosed [ and an escaped wildcard as themselves', () => {
    expect(wcmatch('[A', '[A')).toBe(true);
    expect(wcmatch('A*', 'A`*')).toBe(true);
    expect(wcmatch('AB', 'A`*')).toBe(false);
    expect(wcmatch('~', '~')).toBe(true);
  });
});
