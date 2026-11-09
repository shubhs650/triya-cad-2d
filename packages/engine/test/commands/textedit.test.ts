// M2-07 part 2: TEXTEDIT (DDEDIT, ED) and double-click editing of TEXT and MTEXT, and TEXT's
// click elsewhere to start the next line there, on the PromptBus with AutoCAD 2024's prompts
// ("TEXTEDIT (Command)", "DBLCLKEDIT (System Variable)", "TEXT (Command)", AutoCAD 2024 Help).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type MTextGeometry,
  type StringPrompt,
  type TextGeometry,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const STANDARD = '30';

const standard: TextStyleRecord = {
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

function setup() {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...init.header!, ['$TEXTSTYLE', 'Standard']]),
    tables: { ...init.tables, textStyles: [standard] },
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const asked: ViewRequest[] = [];
  // The test canvas: a pick finds the texts whose insertion point is within 1 of it.
  const answer = (r: ViewRequest): ViewReply => {
    asked.push(r);
    if (r.op !== 'pick') return { ok: false, message: 'not drawn' };
    const ids = added()
      .filter((e) => {
        const g = e.geom as TextGeometry | MTextGeometry;
        return Math.hypot(g.position.x - r.point.x, g.position.y - r.point.y) <= 1;
      })
      .map((e) => e.id);
    return { ok: true, ids };
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: (r) => Promise.resolve(answer(r)) },
  });
  return { model, bus, added, asked };
}

/** A TEXT at (0,0) reading `value`, and an MTEXT at (50,0) holding `contents`. */
async function placeBoth(bus: PromptBus, value = 'Old note', contents = 'Old {\\Lmtext}') {
  await bus.script(['TEXT', '0,0', '2.5', '0', value, '']);
  await bus.script(['MTEXT', '50,0', '90,-20']);
  await bus.answer({ kind: 'string', value: contents, editor: true });
  expect(bus.command).toBeUndefined();
}

const geom = <T>(e: Entity | undefined) => e?.geom as T;

describe('TEXTEDIT', () => {
  it('edits a TEXT in place: the editor opens on it with its value', async () => {
    const { bus, added } = setup();
    await placeBoth(bus);
    await bus.submit('TEXTEDIT');
    expect(bus.history.at(-1)).toBe('Current settings: Edit mode = Multiple');
    expect(bus.promptText).toBe('Select an annotation object or [Undo/Mode]:');
    await bus.pick({ x: 0, y: 0 });
    expect(bus.prompt).toMatchObject({
      kind: 'string',
      editor: { kind: 'text', value: 'Old note', position: { x: 0, y: 0 }, height: 2.5 },
    });
    await bus.answer({ kind: 'string', value: 'New note', editor: true });
    expect(geom<TextGeometry>(added()[0]).value).toBe('New note');
    // Multiple mode (TEXTEDITMODE 0, AutoCAD's default) asks for the next object.
    expect(bus.promptText).toBe('Select an annotation object or [Undo/Mode]:');
    await bus.submit('');
    expect(bus.command).toBeUndefined();
  });

  it('runs as DDEDIT and ED too', async () => {
    const { bus } = setup();
    await bus.submit('DDEDIT');
    expect(bus.command).toBe('TEXTEDIT');
    await bus.cancel();
    await bus.submit('ED');
    expect(bus.command).toBe('TEXTEDIT');
  });

  it("edits an MTEXT in its editor, which opens with the contents and the box's place", async () => {
    const { bus, added } = setup();
    await placeBoth(bus);
    const mtext = geom<MTextGeometry>(added()[1]);
    await bus.script(['TEXTEDIT']);
    await bus.pick({ x: 50, y: 0 });
    expect((bus.prompt as StringPrompt).editor).toMatchObject({
      kind: 'mtext',
      value: 'Old {\\Lmtext}',
      position: mtext.position,
      width: mtext.width,
      attachment: mtext.attachment,
      style: STANDARD,
    });
    await bus.answer({ kind: 'string', value: '\\pxqc;New {\\Lmtext}', editor: true });
    expect(geom<MTextGeometry>(added()[1]).contents).toBe('\\pxqc;New {\\Lmtext}');
    // The rest of the MTEXT stays as it was.
    expect({ ...geom<MTextGeometry>(added()[1]), contents: '' }).toEqual({
      ...mtext,
      contents: '',
    });
  });

  it('makes no change when the text comes back as it was', async () => {
    const { bus } = setup();
    await placeBoth(bus);
    const changes: unknown[] = [];
    bus.on((e) => (e.type === 'commit' ? changes.push(e.record.changes) : undefined));
    await bus.script(['TEXTEDIT']);
    await bus.pick({ x: 50, y: 0 });
    await bus.answer({ kind: 'string', value: 'Old {\\Lmtext}', editor: true });
    await bus.submit('');
    expect(changes).toEqual([]);
  });

  it('erases a text left empty, as AutoCAD does with an emptied MTEXT', async () => {
    const { bus, added } = setup();
    await placeBoth(bus);
    await bus.script(['TEXTEDIT']);
    await bus.pick({ x: 0, y: 0 });
    await bus.answer({ kind: 'string', value: '', editor: true });
    expect(added().map((e) => e.type)).toEqual(['MTEXT']);
  });

  it('Undo takes back the last edit of the command; Mode Single ends after one', async () => {
    const { bus, added } = setup();
    await placeBoth(bus);
    await bus.script(['TEXTEDIT']);
    await bus.pick({ x: 0, y: 0 });
    await bus.answer({ kind: 'string', value: 'One', editor: true });
    await bus.pick({ x: 0, y: 0 });
    await bus.answer({ kind: 'string', value: '', editor: true });
    expect(added().map((e) => e.type)).toEqual(['MTEXT']);
    await bus.submit('U');
    const text = () => added().find((e) => e.type === 'TEXT');
    expect(geom<TextGeometry>(text()).value).toBe('One');
    await bus.submit('U');
    expect(geom<TextGeometry>(text()).value).toBe('Old note');
    await bus.submit('U');
    expect(bus.history.at(-1)).toBe('Everything has been undone.');

    await bus.submit('M');
    expect(bus.promptText).toBe('Enter a text edit mode option [Single/Multiple] <Multiple>:');
    await bus.submit('S');
    await bus.pick({ x: 0, y: 0 });
    await bus.answer({ kind: 'string', value: 'Two', editor: true });
    expect(bus.command).toBeUndefined();
    expect(geom<TextGeometry>(text()).value).toBe('Two');
    // The mode is remembered, as TEXTEDITMODE is.
    await bus.submit('TEXTEDIT');
    expect(bus.history.at(-1)).toBe('Current settings: Edit mode = Single');
  });

  it('refuses an object that is not text and asks again', async () => {
    const { bus, model } = setup();
    await placeBoth(bus);
    const line = [...model.entities()].find((e) => e.type === 'LINE')!;
    await bus.script(['TEXTEDIT']);
    await bus.answer({ kind: 'selection', ids: [line.id] });
    expect(bus.history).toContain('The object selected is not text, multiline text or a dimension.');
    expect(bus.promptText).toBe('Select an annotation object or [Undo/Mode]:');
  });

  it('takes a text selected beforehand (PICKFIRST)', async () => {
    const { bus, added } = setup();
    await placeBoth(bus);
    await bus.pick({ x: 50, y: 0 });
    await bus.submit('ED');
    expect((bus.prompt as StringPrompt).editor?.kind).toBe('mtext');
    expect(added()[1]).toBeDefined();
  });
});

describe('double-click', () => {
  it('opens the editor of the text under the cursor (DBLCLKEDIT)', async () => {
    const { bus, added } = setup();
    await placeBoth(bus);
    // The two clicks of a double click pick first, as at `Command:`.
    await bus.pick({ x: 0, y: 0 });
    await bus.pick({ x: 0, y: 0 });
    await bus.doubleClick({ x: 0, y: 0 });
    expect(bus.command).toBe('TEXTEDIT');
    expect((bus.prompt as StringPrompt).editor).toMatchObject({ kind: 'text', value: 'Old note' });
    await bus.answer({ kind: 'string', value: 'Edited', editor: true });
    expect(geom<TextGeometry>(added()[0]).value).toBe('Edited');
  });

  it('edits only the text double-clicked, whatever else was selected', async () => {
    const { bus } = setup();
    await placeBoth(bus);
    await bus.pick({ x: 0, y: 0 });
    await bus.doubleClick({ x: 50, y: 0 });
    expect((bus.prompt as StringPrompt).editor?.kind).toBe('mtext');
  });

  it('does nothing on empty canvas, on objects without an editor, or inside a command', async () => {
    const { bus } = setup();
    await placeBoth(bus);
    await bus.doubleClick({ x: 200, y: 200 });
    expect(bus.command).toBeUndefined();
    await bus.submit('LINE');
    await bus.doubleClick({ x: 0, y: 0 });
    expect(bus.command).toBe('LINE');
  });
});

describe('TEXT: a click elsewhere starts the next line there', () => {
  it('moves the next line to the point clicked, keeping height and rotation', async () => {
    const { bus, added } = setup();
    await bus.script(['TEXT', '0,0', '3', '30', 'First']);
    expect((bus.prompt as StringPrompt).pick).toBe(true);
    await bus.pick({ x: 100, y: 50 });
    expect((bus.prompt as StringPrompt).editor?.position).toEqual({ x: 100, y: 50 });
    await bus.script(['Second', 'Third', '']);
    const [a, b, c] = added().map((e) => geom<TextGeometry>(e));
    expect(a!.position).toEqual({ x: 0, y: 0 });
    expect(b).toMatchObject({ value: 'Second', position: { x: 100, y: 50 }, height: 3 });
    expect(b!.rotation).toBeCloseTo(Math.PI / 6);
    // The line after follows the moved one.
    expect(c!.position.x).toBeCloseTo(100 + 5 * Math.sin(Math.PI / 6));
    expect(c!.position.y).toBeCloseTo(50 - 5 * Math.cos(Math.PI / 6));
  });
});

describe('TEXTEDIT and MTEXT columns (M2-07 part 3)', () => {
  async function columned(bus: PromptBus) {
    await bus.script(['MTEXT', '50,0', 'C', 'S', '50', '2', '10', '30']);
    await bus.answer({ kind: 'string', value: 'a\\Nb', editor: true });
    await bus.submit('ED');
    await bus.pick({ x: 50, y: 0 });
    return bus.prompt as StringPrompt;
  }

  it('opens the editor with the columns, and keeps them as written when they come back unchanged', async () => {
    const { bus, model, added } = setup();
    const p = await columned(bus);
    expect(p.editor?.columns).toEqual({ type: 1, count: 2, width: 20, gutter: 10, height: 30 });
    const before = added()[0]!.geom;
    await bus.answer({ kind: 'string', value: 'a\\Nb', editor: true, columns: p.editor!.columns! });
    expect(model.entity(added()[0]!.id)!.geom).toBe(before);
  });

  it('applies columns the editor changed or dropped', async () => {
    const { bus, model, added } = setup();
    const p = await columned(bus);
    await bus.answer({
      kind: 'string',
      value: 'a\\Nb',
      editor: true,
      columns: { ...p.editor!.columns!, type: 2, count: 3 },
    });
    expect(geom<MTextGeometry>(model.entity(added()[0]!.id))).toMatchObject({
      contents: 'a\\Nb',
      columns: { type: 2, count: 3, autoHeight: true, width: 20 },
    });
    await bus.cancel();
    await bus.submit('ED');
    await bus.pick({ x: 50, y: 0 });
    await bus.answer({ kind: 'string', value: 'a\\Nb', editor: true, columns: null });
    expect(geom<MTextGeometry>(model.entity(added()[0]!.id)).columns).toBeUndefined();
  });
});
