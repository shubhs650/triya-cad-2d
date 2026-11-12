// M2-35 part 9: an MTEXT's Contents row in the Properties palette, as AutoCAD 2024's "Properties
// Palette — Text" shows it: the contents, with a `...` button that opens the In-Place Text
// Editor on the object (`PropertyRow.editor`, the session's `property-editor`,
// `PromptBus.editContents`). The edit is one undo step and the object stays selected.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  propertySheet,
  type BusEvent,
  type CommandOutput,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type PropertyRow,
  type PropertySheet,
  type StringPrompt,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

type MText = Extract<EntityGeometry, { kind: 'MTEXT' }>;
type Text = Extract<EntityGeometry, { kind: 'TEXT' }>;

const mtextGeom = (over: Partial<MText> = {}): MText =>
  ({
    kind: 'MTEXT',
    contents: 'GENERAL {\\LNOTES}',
    style: '30',
    position: { x: 2, y: 8 },
    height: 2.5,
    width: 40,
    rotation: 0,
    attachment: 1,
    lineSpacing: 1,
    ...over,
  }) as MText;

const textGeom: Text = {
  kind: 'TEXT',
  value: 'NOTE',
  style: '30',
  position: { x: 1, y: 1 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
};

const LINE: EntityGeometry = { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } };

const style = { handle: '30', name: 'Standard', height: 0, widthFactor: 1, obliqueAngle: 0 };

function init(entities: NonNullable<DocumentInit['entities']>): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: { ...base.tables, textStyles: [{ ...style, font: 'txt' } as never] },
    entities,
  };
}

function setup(i: DocumentInit) {
  const model = DocumentModel.create(i);
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: true }) },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  return { model, bus, log, byHandle, ids };
}

const rows = (sheet: PropertySheet): PropertyRow[] => sheet.sections.flatMap((s) => s.rows);
const rowOf = (sheet: PropertySheet, label: string): PropertyRow => {
  const r = rows(sheet).find((x) => x.label === label);
  if (!r) throw new Error(`no row ${label}`);
  return r;
};

describe('an MTEXT’s Contents row (M2-35 part 9)', () => {
  it('shows the contents with the `...` button for one MTEXT', () => {
    const s = setup(init([entityInit('62', mtextGeom()), entityInit('63', mtextGeom())]));
    const one = rowOf(propertySheet(s.model, s.ids('62')), 'Contents');
    expect(one).toMatchObject({ value: 'GENERAL {\\LNOTES}', readOnly: true, editor: true });
    // The editor edits one object: several MTEXTs show their contents without it.
    const two = rowOf(propertySheet(s.model, s.ids('62', '63')), 'Contents');
    expect(two.editor).toBeUndefined();
    // A TEXT's Contents is typed in the field, as before.
    const t = setup(init([entityInit('61', textGeom)]));
    const text = rowOf(propertySheet(t.model, t.ids('61')), 'Contents');
    expect(text.editor).toBeUndefined();
    expect(text.readOnly).toBeUndefined();
  });

  it('opens the MTEXT editor on the selected MTEXT and keeps it selected', async () => {
    const s = setup(init([entityInit('62', mtextGeom())]));
    await s.bus.selectAll();
    const logged = s.log.length;
    await s.bus.editContents('MTEXT');
    expect(s.bus.command).toBe('PROPERTIES');
    expect((s.bus.prompt as StringPrompt).editor).toMatchObject({
      kind: 'mtext',
      value: 'GENERAL {\\LNOTES}',
      position: { x: 2, y: 8 },
      width: 40,
      style: '30',
    });
    await s.bus.answer({ kind: 'string', value: '\\pxqc;GENERAL NOTES', editor: true });
    expect(s.bus.command).toBeUndefined();
    expect((s.byHandle('62').geom as MText).contents).toBe('\\pxqc;GENERAL NOTES');
    expect(s.bus.selection).toEqual(s.ids('62'));
    // No command starts at the command line: the editor's answer is echoed as TEXTEDIT's is.
    expect(s.log.slice(logged)).toEqual(['Enter text: \\pxqc;GENERAL NOTES']);
    // One undo step.
    await s.bus.submit('U');
    expect((s.byHandle('62').geom as MText).contents).toBe('GENERAL {\\LNOTES}');
  });

  it('leaves the MTEXT as it was when the editor is closed unchanged or cancelled', async () => {
    const s = setup(init([entityInit('62', mtextGeom())]));
    await s.bus.selectAll();
    const version = s.model.version;
    await s.bus.editContents('MTEXT');
    await s.bus.answer({ kind: 'string', value: 'GENERAL {\\LNOTES}', editor: true });
    expect(s.model.version).toBe(version);
    await s.bus.editContents('MTEXT');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.model.version).toBe(version);
    expect(s.bus.selection).toEqual(s.ids('62'));
  });

  it('edits the MTEXT of a mixed selection the palette is narrowed to', async () => {
    const s = setup(init([entityInit('60', LINE), entityInit('62', mtextGeom())]));
    await s.bus.selectAll();
    await s.bus.editContents('MTEXT');
    expect((s.bus.prompt as StringPrompt).editor?.kind).toBe('mtext');
    await s.bus.answer({ kind: 'string', value: 'NEW', editor: true });
    expect((s.byHandle('62').geom as MText).contents).toBe('NEW');
    expect([...s.bus.selection].sort()).toEqual(s.ids('60', '62').sort());
  });

  it('cancels a running command first, as the palette’s other buttons do', async () => {
    const s = setup(init([entityInit('62', mtextGeom())]));
    await s.bus.selectAll();
    // ZOOM leaves the selection selected, as a view command does.
    await s.bus.submit('ZOOM');
    expect(s.bus.command).toBe('ZOOM');
    await s.bus.editContents('MTEXT');
    expect((s.bus.prompt as StringPrompt).editor?.kind).toBe('mtext');
  });

  it('does nothing without exactly one MTEXT shown', async () => {
    const s = setup(
      init([
        entityInit('60', LINE),
        entityInit('61', textGeom),
        entityInit('62', mtextGeom()),
        entityInit('63', mtextGeom()),
      ]),
    );
    await s.bus.editContents();
    expect(s.bus.command).toBeUndefined();
    await s.bus.selectAll();
    await s.bus.editContents('MTEXT');
    expect(s.bus.command).toBeUndefined();
    await s.bus.editContents('TEXT');
    expect(s.bus.command).toBeUndefined();
    await s.bus.editContents();
    expect(s.bus.command).toBeUndefined();
  });
});

describe('the session’s property-editor input (M2-35 part 9)', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('opens the editor on the palette’s MTEXT and sends the edited sheet', async () => {
    const out: CommandOutput[] = [];
    const se = new EngineSession(
      init([entityInit('60', LINE), entityInit('62', mtextGeom({ contents: 'OLD' }))]),
    );
    se.onCommand((o) => out.push(o));
    const last = () =>
      out
        .filter((o): o is Extract<CommandOutput, { type: 'properties' }> => o.type === 'properties')
        .at(-1)!.sheet;
    await se.command({ kind: 'properties', open: true });
    await se.command({ kind: 'select-all' });
    await flush();
    await se.command({ kind: 'properties', open: true, filter: 'MTEXT' });
    expect(rowOf(last(), 'Contents').editor).toBe(true);
    await se.command({ kind: 'property-editor', key: 'contents' });
    const prompt = out.filter((o) => o.type === 'prompt').at(-1);
    expect(prompt).toMatchObject({ prompt: { kind: 'string', editor: { kind: 'mtext' } } });
    await se.command({ kind: 'answer', answer: { kind: 'string', value: 'NEW', editor: true } });
    await flush();
    expect(rowOf(last(), 'Contents').value).toBe('NEW');
    expect(last().count).toBe(2);
  });
});
