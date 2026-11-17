// M4-23: fields in multileaders. A multileader's MTEXT content holds fields as MTEXT does
// (AutoCAD keeps them in the FIELD tree of the multileader's ACAD_FIELD dictionary): MLEADER's
// In-Place Text Editor and TEXTEDIT on a multileader offer Insert Field (Ctrl+F) and Edit Field,
// the multileader shows each field's value, and UPDATEFIELD, FIELDEVAL's events (open, save,
// plot, REGEN) evaluate them again. EXPLODE leaves an MTEXT that keeps the fields.
//
// The In-Place Text Editor's Update Field (AutoCAD 2024 Help, "To Update a Field Manually":
// "In the In-Place Text Editor, select the field you want to update, right-click, and click
// Update Field"): the editor answers with `%<FIELD_UPDATE code>%` in the field's place, and opens
// again with the field's value evaluated now.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  FIELD_EDIT,
  FIELD_INSERT,
  FIELD_UPDATE,
  PromptBus,
  builtinCommands,
  doubleClickCommand,
  fieldEventChange,
  fieldEventMayUpdate,
  multiLeaderParts,
  standardMLeaderStyle,
  type DialogPrompt,
  type DrawingField,
  type Entity,
  type FieldDialogRequest,
  type MLeaderStyleRecord,
  type MTextGeometry,
  type MultiLeaderGeometry,
  type StringPrompt,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, sampleInit } from '../model/fixtures';

const NOW = new Date(2026, 10, 16, 9, 30);
const LATER = new Date(2027, 0, 2, 8, 0);
const YEAR = '\\AcVar Date \\f "yyyy"';
const FILE = '\\AcVar Filename \\f "%tc1%fn2"';

const textStyle: TextStyleRecord = {
  handle: '30',
  name: 'Standard',
  font: 'arial.ttf',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

const standard: MLeaderStyleRecord = { handle: '35', ...standardMLeaderStyle(false, '30') };

/** A field tree as a file holds one: `Rev %<year>%`, the year last evaluated as `value`. */
const yearField = (value: string, options?: number): DrawingField => ({
  evaluator: '_text',
  code: 'Rev %<\\_FldIdx 0>%',
  children: [
    {
      evaluator: 'AcVar',
      code: YEAR,
      children: [],
      objects: [],
      value,
      ...(options !== undefined && { options }),
    },
  ],
  objects: [],
  value: `Rev ${value}`,
});

function setup(o: { header?: [string, number][] } = {}) {
  const init = sampleInit();
  let now = NOW;
  const model = DocumentModel.create({
    ...init,
    header: new Map([...init.header!, ['$TEXTSTYLE', 'Standard'], ...(o.header ?? [])]),
    tables: { ...init.tables, textStyles: [textStyle], mleaderStyles: [standard] },
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [...init.entities!],
  });
  const view = {
    request: (r: ViewRequest): Promise<ViewReply> => {
      if (r.op === 'sysvar' && r.name === 'DWGNAME')
        return Promise.resolve({ ok: true, value: 'Plan.dxf' });
      if (r.op === 'sysvar' && r.name === 'DWGPREFIX')
        return Promise.resolve({ ok: true, value: '' });
      return Promise.resolve({ ok: false, message: 'not drawn' });
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    clock: { now: () => now },
  });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const leader = (): MultiLeaderGeometry =>
    added().find((e) => e.geom.kind === 'MULTILEADER')!.geom as MultiLeaderGeometry;
  const dialog = () => (bus.prompt as DialogPrompt).dialog as FieldDialogRequest;
  const editor = () => (bus.prompt as StringPrompt).editor!;
  const setNow = (d: Date) => {
    now = d;
  };
  return { model, bus, log, added, leader, dialog, editor, setNow };
}

/** MLEADER arrowhead first to the editor; `answers` then go to the editor. */
async function placeLeader(s: ReturnType<typeof setup>, value: string) {
  await s.bus.script(['MLEADER', '0,0', '10,5']);
  expect(s.editor().fields).toEqual({});
  await s.bus.answer({ kind: 'string', value, editor: true });
}

describe('MLEADER with fields', () => {
  it("offers Insert Field in the editor and keeps the field in the multileader's text", async () => {
    const s = setup();
    await s.bus.script(['MLEADER', '0,0', '10,5']);
    // `fields` shows the editor's Insert Field (the toolbar's Field button, Ctrl+F).
    expect(s.editor()).toMatchObject({ kind: 'mtext', fields: {} });
    await s.bus.answer({ kind: 'string', value: `Rev %<${FIELD_INSERT}>%`, editor: true });
    expect(s.log.at(-1)).toBe('Enter text: Rev');
    const d = s.dialog();
    expect(d.type).toBe('field');
    expect(d.snapshot.fileName).toBe('Plan.dxf');
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      field: { name: 'Date', date: 'yyyy' },
    });
    // The editor opens again where it was, with the field in place, shown by its value.
    expect(s.editor().value).toBe(`Rev %<${YEAR}>%`);
    expect(s.editor().fields).toEqual({ [YEAR]: '2026' });
    expect(s.editor().attachment).toBe(1);
    await s.bus.answer({ kind: 'string', value: `Rev %<${YEAR}>%`, editor: true });
    expect(s.bus.command).toBeUndefined();
    const g = s.leader();
    expect(g.text?.content).toBe('Rev 2026');
    expect(g.text?.field).toEqual({
      evaluator: '_text',
      code: 'Rev %<\\_FldIdx 0>%',
      // A Date field is evaluated on demand only (DXF 91 = 32), as AutoCAD makes it.
      children: [
        {
          evaluator: 'AcVar',
          code: YEAR,
          children: [],
          objects: [],
          value: '2026',
          options: 32,
          time: NOW.getTime(),
        },
      ],
      objects: [],
      value: 'Rev 2026',
    });
  });

  it('makes the field of a code typed into the text, as MTEXT does', async () => {
    const s = setup();
    await placeLeader(s, `See %<${FILE}>%`);
    const g = s.leader();
    expect(g.text?.content).toBe('See PLAN');
    expect(g.text?.field?.children.map((c) => [c.code, c.value])).toEqual([[FILE, 'PLAN']]);
  });

  it('keeps plain text free of fields, and the content first text too', async () => {
    const s = setup();
    await placeLeader(s, 'NOTE');
    expect(s.leader().text).not.toHaveProperty('field');
    const t = setup();
    await t.bus.script(['MLEADER', 'C', '20,20', '30,10']);
    expect(t.editor().fields).toEqual({});
    await t.bus.answer({ kind: 'string', value: `%<${FILE}>%`, editor: true });
    await t.bus.script(['0,0']);
    expect(t.bus.command).toBeUndefined();
    const g = t.leader();
    expect(g.text?.content).toBe('PLAN');
    expect(g.text?.field?.children[0]?.code).toBe(FILE);
  });

  it('places nothing in the field when the dialog is cancelled, and goes on', async () => {
    const s = setup();
    await s.bus.script(['MLEADER', '0,0', '10,5']);
    await s.bus.answer({ kind: 'string', value: `A %<${FIELD_INSERT}>%`, editor: true });
    await s.bus.cancel();
    expect(s.editor().value).toBe('A ');
    await s.bus.answer({ kind: 'string', value: 'A', editor: true });
    expect(s.leader().text?.content).toBe('A');
    expect(s.leader().text).not.toHaveProperty('field');
  });
});

describe('TEXTEDIT on a multileader with fields', () => {
  async function withField(s: ReturnType<typeof setup>) {
    await placeLeader(s, `Rev %<${YEAR}>%`);
    return s.added().find((e) => e.geom.kind === 'MULTILEADER')!;
  }

  it('opens on the codes, each shown by its value, and keeps the fields an edit leaves', async () => {
    const s = setup();
    const e = await withField(s);
    expect(doubleClickCommand(s.model.entity(e.id)!)).toBe('TEXTEDIT');
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    expect(s.editor().value).toBe(`Rev %<${YEAR}>%`);
    expect(s.editor().fields).toEqual({ [YEAR]: '2026' });
    await s.bus.answer({ kind: 'string', value: `Rev %<${YEAR}>% B`, editor: true });
    await s.bus.answer({ kind: 'enter' });
    expect(s.bus.command).toBeUndefined();
    const g = s.leader();
    expect(g.text?.content).toBe('Rev 2026 B');
    expect(g.text?.field?.code).toBe('Rev %<\\_FldIdx 0>% B');
  });

  it("edits a field through the Field dialog (Edit Field), and drops the text's fields when gone", async () => {
    const s = setup();
    const e = await withField(s);
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    await s.bus.answer({ kind: 'string', value: `Rev %<${FIELD_EDIT}${YEAR}>%`, editor: true });
    // The dialog opens on the field's choices.
    expect(s.dialog().spec).toMatchObject({ name: 'Date', date: 'yyyy' });
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date', date: 'yy' } });
    const yy = '\\AcVar Date \\f "yy"';
    expect(s.editor().value).toBe(`Rev %<${yy}>%`);
    expect(s.editor().fields?.[yy]).toBe('26');
    await s.bus.answer({ kind: 'string', value: `Rev %<${yy}>%`, editor: true });
    await s.bus.answer({ kind: 'enter' });
    expect(s.leader().text?.content).toBe('Rev 26');
    expect(s.leader().text?.field?.children[0]?.code).toBe(yy);
    // The field deleted: the text keeps what was typed, with no fields.
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    await s.bus.answer({ kind: 'string', value: 'Rev 26', editor: true });
    await s.bus.answer({ kind: 'enter' });
    expect(s.leader().text?.content).toBe('Rev 26');
    expect(s.leader().text).not.toHaveProperty('field');
  });

  it('is not changed when the editor closes on the codes it opened on', async () => {
    const s = setup();
    const e = await withField(s);
    const before = s.model.entity(e.id)!.geom;
    s.setNow(LATER);
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    await s.bus.answer({ kind: 'string', value: `Rev %<${YEAR}>%`, editor: true });
    await s.bus.answer({ kind: 'enter' });
    expect(s.model.entity(e.id)!.geom).toBe(before);
  });
});

describe('Update Field in the In-Place Text Editor', () => {
  it("opens the editor again with the field's value evaluated now", async () => {
    const s = setup();
    await placeLeader(s, `Rev %<${YEAR}>%`);
    const e = s.added()[0]!;
    s.setNow(LATER);
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    expect(s.editor().fields).toEqual({ [YEAR]: '2026' });
    await s.bus.answer({ kind: 'string', value: `Rev %<${FIELD_UPDATE}${YEAR}>%`, editor: true });
    // No dialog: the editor opens again on the same text, the field showing its new value.
    expect(s.bus.prompt?.kind).toBe('string');
    expect(s.editor().value).toBe(`Rev %<${YEAR}>%`);
    expect(s.editor().fields).toEqual({ [YEAR]: '2027' });
    expect(s.log.at(-1)).toBe(`Enter text: Rev %<${YEAR}>%`);
    await s.bus.answer({ kind: 'string', value: `Rev %<${YEAR}>%`, editor: true });
    await s.bus.answer({ kind: 'enter' });
    expect(s.leader().text?.content).toBe('Rev 2027');
  });

  it("updates an MTEXT's field too, the other fields as they were shown", async () => {
    const s = setup();
    await s.bus.script(['MTEXT', '0,0', '60,-20']);
    await s.bus.answer({ kind: 'string', value: `%<${YEAR}>% %<${FILE}>%`, editor: true });
    const m = s.added()[0]!;
    expect((m.geom as MTextGeometry).contents).toBe('2026 PLAN');
    s.setNow(LATER);
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [m.id] });
    await s.bus.answer({
      kind: 'string',
      value: `%<${FIELD_UPDATE}${YEAR}>% %<${FILE}>%`,
      editor: true,
    });
    expect(s.editor().fields).toEqual({ [YEAR]: '2027', [FILE]: 'PLAN' });
    expect(s.editor().value).toBe(`%<${YEAR}>% %<${FILE}>%`);
    await s.bus.answer({ kind: 'string', value: `%<${YEAR}>% %<${FILE}>%`, editor: true });
    await s.bus.answer({ kind: 'enter' });
    expect((s.model.entity(m.id)!.geom as MTextGeometry).contents).toBe('2027 PLAN');
  });
});

describe('evaluating the fields of a multileader', () => {
  /** A multileader read with a field last evaluated as 2020. */
  async function readLeader(s: ReturnType<typeof setup>, options?: number) {
    await placeLeader(s, 'Rev 2020');
    const e = s.added()[0]!;
    const g = e.geom as MultiLeaderGeometry;
    const geom: MultiLeaderGeometry = {
      ...g,
      text: { ...g.text!, field: yearField('2020', options) },
    };
    const b = new ChangeSetBuilder(s.model);
    b.updateEntity(e.id, { geom });
    s.model.apply(b.build());
    return e;
  }

  it('UPDATEFIELD evaluates them, reports them and draws the new value', async () => {
    const s = setup();
    const e = await readLeader(s);
    await s.bus.submit('UPDATEFIELD');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    expect(s.log.slice(-2)).toEqual(['1 field(s) found.', '1 field(s) updated.']);
    const g = s.model.entity(e.id)!.geom as MultiLeaderGeometry;
    expect(g.text?.content).toBe('Rev 2026');
    expect(g.text?.field?.children[0]?.value).toBe('2026');
    // One undo step.
    await s.bus.submit('U');
    expect((s.model.entity(e.id)!.geom as MultiLeaderGeometry).text?.content).toBe('Rev 2020');
  });

  it('FIELDEVAL events update them as their options allow', async () => {
    const s = setup();
    await readLeader(s);
    const base = { model: s.model, now: NOW, fileName: 'Plan.dxf', folder: '' };
    expect(fieldEventMayUpdate(s.model, 'regen')).toBe(true);
    const change = fieldEventChange(base, 'regen')!;
    s.model.apply(change);
    expect(s.leader().text?.content).toBe('Rev 2026');
    // A field evaluated on demand only (DXF 91 = 32) waits for UPDATEFIELD.
    const t = setup();
    await readLeader(t, 32);
    expect(fieldEventChange({ ...base, model: t.model }, 'open')).toBeUndefined();
    // A drawing whose FIELDEVAL leaves regeneration out.
    const u = setup({ header: [['FIELDEVAL', 0]] });
    await readLeader(u);
    expect(fieldEventMayUpdate(u.model, 'regen')).toBe(false);
  });

  it('a block multileader has no fields to update', async () => {
    const s = setup();
    expect(fieldEventMayUpdate(s.model, 'regen')).toBe(false);
  });

  it('draws and explodes the text with its fields: the MTEXT keeps them', async () => {
    const s = setup();
    await placeLeader(s, `Rev %<${YEAR}>%`);
    const parts = multiLeaderParts(s.leader(), s.model);
    const mtext = parts.find((p) => p.geom.kind === 'MTEXT')!.geom as MTextGeometry;
    expect(mtext.contents).toBe('Rev 2026');
    expect(mtext.field?.children[0]?.code).toBe(YEAR);
    const e = s.added()[0]!;
    await s.bus.submit('EXPLODE');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    const exploded = [...s.model.entities()].find((x) => x.geom.kind === 'MTEXT')!;
    expect((exploded.geom as MTextGeometry).field?.children[0]?.value).toBe('2026');
  });
});
