// M4-10 part 2: FIELD and the Field dialog (AutoCAD 2024 Help, "FIELD (Command)": "Creates a
// multiline text object with a field that can be updated automatically as field values
// change"), and Insert Field in the MTEXT editor: the editor answers its text with
// `%<FIELD_INSERT>%` where the field goes, the dialog opens, and the editor opens again with
// the field in place. A text with fields keeps them as its FIELD and shows their values;
// TEXTEDIT opens it on its codes.
//
// M4-10 part 4: Edit Field (AutoCAD 2024 Help, "To Edit a Field": "In the In-Place Text Editor,
// double-click the field to display the Field dialog box"): the editor answers with
// `%<FIELD_EDIT code>%` in the field's place, the dialog opens on the field's choices, and the
// editor opens again with the field as the dialog left it. TEXT's line editor holds fields too.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FIELD_EDIT,
  FIELD_INSERT,
  PromptBus,
  builtinCommands,
  type DialogPrompt,
  type DrawingField,
  type Entity,
  type FieldDialogRequest,
  type MTextGeometry,
  type StringPrompt,
  type TextGeometry,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, circleGeom, entityInit, sampleInit } from '../model/fixtures';

const NOW = new Date(2026, 10, 16, 9, 30);

const standard: TextStyleRecord = {
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

const text = (value: string, field?: DrawingField): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: '30',
  position: { x: 0, y: 40 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  ...(field && { field }),
});

const yearField = (code: string, value: string): DrawingField => ({
  evaluator: '_text',
  code,
  children: [
    { evaluator: 'AcVar', code: '\\AcVar Date \\f "yyyy"', children: [], objects: [], value },
  ],
  objects: [],
  value: code.replace('%<\\_FldIdx 0>%', value),
});

function setup() {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...init.header!, ['$TEXTSTYLE', 'Standard'], ['$TEXTSIZE', 2.5]]),
    tables: { ...init.tables, textStyles: [standard] },
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [
      ...init.entities!,
      entityInit('60', circleGeom(100, 0, 10)),
      entityInit('61', text('Rev 2020', yearField('Rev %<\\_FldIdx 0>%', '2020'))),
      entityInit('62', {
        kind: 'MTEXT',
        contents: 'Issued 2020',
        field: yearField('Issued %<\\_FldIdx 0>%', '2020'),
        style: '30',
        position: { x: 0, y: 80 },
        height: 2.5,
        width: 0,
        rotation: 0,
        attachment: 1,
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      } satisfies MTextGeometry),
    ],
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
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
    clock: { now: () => NOW },
  });
  const id = (h: string) => [...model.entities()].find((e) => e.handle === h)!.id;
  const dialog = () => (bus.prompt as DialogPrompt).dialog as FieldDialogRequest;
  const editor = () => (bus.prompt as StringPrompt).editor!;
  return { model, bus, added, id, dialog, editor };
}

describe('FIELD', () => {
  it('opens the Field dialog, then places an MTEXT holding the field', async () => {
    const s = setup();
    await s.bus.submit('FIELD');
    const d = s.dialog();
    expect(d.type).toBe('field');
    expect(d.snapshot.fileName).toBe('Plan.dxf');
    expect(d.snapshot.layout?.name).toBe('Model');
    expect(d.snapshot.variables['TEXTSIZE']).toBe(2.5);
    expect(d.snapshot.now).toBe(NOW.getTime());
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      field: { name: 'Filename', parts: 'name', extension: false, textCase: 1 },
    });
    expect(s.bus.prompt?.message).toBe('Specify start point or');
    expect(s.bus.prompt?.options).toEqual(['Height', 'Justify']);
    await s.bus.script(['H', '5', 'J', 'MC', '10,20']);
    expect(s.bus.command).toBeUndefined();
    const [e] = s.added();
    const g = e!.geom as MTextGeometry;
    expect(g.kind).toBe('MTEXT');
    expect(g.contents).toBe('PLAN');
    expect(g.height).toBe(5);
    expect(g.attachment).toBe(5);
    expect(g.position).toEqual({ x: 10, y: 20 });
    expect(g.field).toEqual({
      evaluator: '_text',
      code: '%<\\_FldIdx 0>%',
      children: [
        {
          evaluator: 'AcVar',
          code: '\\AcVar Filename \\f "%tc1%fn2"',
          children: [],
          objects: [],
          value: 'PLAN',
        },
      ],
      objects: [],
      value: 'PLAN',
    });
    expect(s.model.header.get('$TEXTSIZE')).toBe(5);
  });

  it('needs a text style, and ends at the start point with Esc', async () => {
    const s = setup();
    await s.bus.submit('FIELD');
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date' } });
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.added()).toEqual([]);
    const init = sampleInit();
    const bare = new PromptBus({
      model: DocumentModel.create({ ...init, tables: { ...init.tables, textStyles: [] } }),
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: 'none' }) },
    });
    const log: string[] = [];
    bare.on((e) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bare.submit('FIELD');
    expect(log).toContain('The drawing has no text style.');
    expect(bare.command).toBeUndefined();
  });

  it('ends on a height that is not positive, or Esc at the justification', async () => {
    const s = setup();
    await s.bus.submit('FIELD');
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date' } });
    await s.bus.script(['H', '0']);
    expect(s.bus.command).toBeUndefined();
    await s.bus.submit('FIELD');
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date' } });
    await s.bus.script(['J']);
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.added()).toEqual([]);
  });

  it('ends with nothing placed when the dialog is cancelled or makes no field', async () => {
    const s = setup();
    await s.bus.submit('FIELD');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    await s.bus.submit('FIELD');
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Object' } });
    expect(s.bus.command).toBeUndefined();
    expect(s.added()).toEqual([]);
  });

  it("closes the dialog for Select object, then opens it on the object's properties", async () => {
    const s = setup();
    await s.bus.submit('FIELD');
    await s.bus.answer({
      kind: 'dialog',
      action: 'select',
      field: { name: 'Object', property: 'Length', precision: 1 },
    });
    expect(s.bus.prompt?.kind).toBe('selection');
    expect(s.bus.prompt?.message).toBe('Select object');
    await s.bus.answer({ kind: 'selection', ids: [s.id('60')] });
    const d = s.dialog();
    // A circle has no Length: its first property is taken.
    expect(d.spec).toEqual({ name: 'Object', object: '60', property: 'Area', precision: 1 });
    expect(d.objectType).toBe('Circle');
    expect(Object.keys(d.snapshot.objects['60']!)).toContain('Diameter');
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      field: { ...d.spec!, property: 'Diameter' },
    });
    await s.bus.script(['0,0']);
    const g = s.added()[0]!.geom as MTextGeometry;
    expect(g.contents).toBe('20.0');
    expect(g.field!.children[0]!.objects).toEqual(['60']);
    expect(g.field!.children[0]!.code).toBe(
      '\\AcObjProp Object(%<\\_ObjIdx 0>%).Diameter \\f "%pr1"',
    );
  });

  it('keeps the property chosen when the object picked has it; nothing picked keeps the dialog', async () => {
    const s = setup();
    await s.bus.submit('FIELD');
    await s.bus.answer({
      kind: 'dialog',
      action: 'select',
      field: { name: 'Object', property: 'Radius' },
    });
    await s.bus.answer({ kind: 'selection', ids: [] });
    expect(s.dialog().spec).toEqual({ name: 'Object', property: 'Radius' });
    await s.bus.answer({ kind: 'dialog', action: 'select', field: s.dialog().spec! });
    await s.bus.answer({ kind: 'selection', ids: [s.id('60')] });
    expect(s.dialog().spec?.property).toBe('Radius');
    await s.bus.answer({ kind: 'dialog', action: 'select', field: s.dialog().spec! });
    // Enter with nothing picked opens the dialog again as it was.
    await s.bus.answer({ kind: 'enter' });
    expect(s.dialog().spec?.object).toBe('60');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
  });
});

describe('Insert Field in the MTEXT editor', () => {
  it('opens the dialog and puts the field where the editor left its place', async () => {
    const s = setup();
    await s.bus.script(['MTEXT', '0,0', '60,-20']);
    expect(s.editor().fields).toEqual({});
    await s.bus.answer({
      kind: 'string',
      value: `Drawn %<${FIELD_INSERT}>% by me`,
      editor: true,
    });
    expect(s.dialog().type).toBe('field');
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      field: { name: 'Date', date: 'dd/MM/yyyy' },
    });
    // The editor opens again holding the field, shown by its value.
    const code = '\\AcVar Date \\f "dd/MM/yyyy"';
    expect(s.editor().value).toBe(`Drawn %<${code}>% by me`);
    expect(s.editor().fields).toEqual({ [code]: '16/11/2026' });
    await s.bus.answer({ kind: 'string', value: `Drawn %<${code}>% by me`, editor: true });
    expect(s.bus.command).toBeUndefined();
    const g = s.added()[0]!.geom as MTextGeometry;
    expect(g.contents).toBe('Drawn 16/11/2026 by me');
    expect(g.field?.code).toBe('Drawn %<\\_FldIdx 0>% by me');
    expect(g.field?.children[0]?.value).toBe('16/11/2026');
  });

  it("does not echo the field's place on the command line", async () => {
    const s = setup();
    const log: string[] = [];
    s.bus.on((e) => {
      if (e.type === 'log') log.push(e.line);
    });
    await s.bus.script(['MTEXT', '0,0', '60,-20']);
    await s.bus.answer({ kind: 'string', value: `A %<${FIELD_INSERT}>%`, editor: true });
    expect(log.at(-1)).toBe('Enter text: A');
    await s.bus.cancel();
    await s.bus.answer({
      kind: 'string',
      value: `A %<${FIELD_EDIT}\\AcVar Date>%`,
      editor: true,
    });
    expect(log.at(-1)).toBe('Enter text: A %<\\AcVar Date>%');
  });

  it('leaves the text as it was when the dialog is cancelled', async () => {
    const s = setup();
    await s.bus.script(['MTEXT', '0,0', '60,-20']);
    await s.bus.answer({
      kind: 'string',
      value: `Note %<${FIELD_INSERT}>%`,
      editor: true,
      columns: null,
    });
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'SystemVariable' } });
    expect(s.editor().value).toBe('Note ');
    expect(s.editor().columns).toBeUndefined();
    await s.bus.answer({ kind: 'string', value: 'Note', editor: true });
    const g = s.added()[0]!.geom as MTextGeometry;
    expect(g.contents).toBe('Note');
    expect(g.field).toBeUndefined();
  });

  it("goes back to the editor on the dialog's Cancel (Esc), the text as it was", async () => {
    const s = setup();
    await s.bus.script(['MTEXT', '0,0', '60,-20']);
    await s.bus.answer({ kind: 'string', value: `Note %<${FIELD_INSERT}>%`, editor: true });
    await s.bus.cancel();
    expect(s.bus.command).toBe('MTEXT');
    expect(s.editor().value).toBe('Note ');
  });

  it('keeps the columns the editor closed with', async () => {
    const s = setup();
    await s.bus.script(['MTEXT', '0,0', '60,-20']);
    const columns = { type: 1 as const, count: 2, width: 25, gutter: 5, height: 20, flow: 0 };
    await s.bus.answer({
      kind: 'string',
      value: `%<${FIELD_INSERT}>%`,
      editor: true,
      columns,
    });
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date' } });
    expect(s.editor().columns).toEqual(columns);
  });
});

describe('TEXTEDIT on text with fields', () => {
  it('opens an MTEXT on its codes, each shown by its value, and keeps them', async () => {
    const s = setup();
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('62')] });
    const code = '\\AcVar Date \\f "yyyy"';
    expect(s.editor().value).toBe(`Issued %<${code}>%`);
    expect(s.editor().fields).toEqual({ [code]: '2020' });
    await s.bus.answer({ kind: 'string', value: `Issued on %<${code}>%`, editor: true });
    const g = s.model.entity(s.id('62'))!.geom as MTextGeometry;
    // Edited, the text's fields are evaluated again.
    expect(g.contents).toBe('Issued on 2026');
    expect(g.field?.code).toBe('Issued on %<\\_FldIdx 0>%');
  });

  it('drops the fields of an MTEXT whose fields were deleted', async () => {
    const s = setup();
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('62')] });
    await s.bus.answer({ kind: 'string', value: 'Issued today', editor: true });
    const g = s.model.entity(s.id('62'))!.geom as MTextGeometry;
    expect(g.contents).toBe('Issued today');
    expect(g.field).toBeUndefined();
  });

  it('opens a TEXT on its codes, each shown by its value, and keeps them', async () => {
    const s = setup();
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('61')] });
    const code = '\\AcVar Date \\f "yyyy"';
    expect(s.editor().kind).toBe('text');
    expect(s.editor().value).toBe(`Rev %<${code}>%`);
    expect(s.editor().fields).toEqual({ [code]: '2020' });
    await s.bus.answer({ kind: 'string', value: `Rev. %<${code}>%`, editor: true });
    const g = s.model.entity(s.id('61'))!.geom as TextGeometry;
    expect(g.value).toBe('Rev. 2026');
    expect(g.field?.code).toBe('Rev. %<\\_FldIdx 0>%');
  });

  it('drops the fields of a TEXT whose fields were deleted', async () => {
    const s = setup();
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('61')] });
    await s.bus.answer({ kind: 'string', value: 'Rev B', editor: true });
    const g = s.model.entity(s.id('61'))!.geom as TextGeometry;
    expect(g.value).toBe('Rev B');
    expect(g.field).toBeUndefined();
  });
});

describe('Insert Field in the TEXT line editor', () => {
  it('opens the dialog and places the line with the field', async () => {
    const s = setup();
    await s.bus.script(['TEXT', '0,0', '2.5', '0']);
    expect(s.editor().kind).toBe('text');
    expect(s.editor().fields).toEqual({});
    await s.bus.answer({ kind: 'string', value: `File %<${FIELD_INSERT}>%`, editor: true });
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      field: { name: 'Filename', parts: 'name', extension: false },
    });
    const code = '\\AcVar Filename \\f "%fn2"';
    expect(s.editor().kind).toBe('text');
    expect(s.editor().value).toBe(`File %<${code}>%`);
    expect(s.editor().fields).toEqual({ [code]: 'Plan' });
    await s.bus.answer({ kind: 'string', value: `File %<${code}>%`, editor: true });
    const g = s.added()[0]!.geom as TextGeometry;
    expect(g.value).toBe('File Plan');
    expect(g.field?.code).toBe('File %<\\_FldIdx 0>%');
    // The next line opens empty below, as after any line.
    expect(s.editor().value).toBeUndefined();
    expect(s.editor().position.y).toBeLessThan(0);
    await s.bus.answer({ kind: 'enter' });
    expect(s.bus.command).toBeUndefined();
  });

  it('keeps a line typed on the command line as typed', async () => {
    const s = setup();
    await s.bus.script(['TEXT', '0,0', '2.5', '0']);
    await s.bus.answer({ kind: 'string', value: 'A %<\\AcVar Filename \\f "%fn2">%' });
    const g = s.added()[0]!.geom as TextGeometry;
    expect(g.value).toBe('A Plan');
    expect(g.field?.children[0]?.value).toBe('Plan');
  });
});

describe('Edit Field in the editors', () => {
  it('opens the dialog on the field and puts the edited field in its place', async () => {
    const s = setup();
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('62')] });
    const code = '\\AcVar Date \\f "yyyy"';
    await s.bus.answer({
      kind: 'string',
      value: `Issued on %<${FIELD_EDIT}${code}>%`,
      editor: true,
    });
    const d = s.dialog();
    expect(d.type).toBe('field');
    expect(d.spec).toEqual({ name: 'Date', date: 'yyyy' });
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date', date: 'MM/yyyy' } });
    const edited = '\\AcVar Date \\f "MM/yyyy"';
    expect(s.editor().value).toBe(`Issued on %<${edited}>%`);
    expect(s.editor().fields).toEqual({ [code]: '2020', [edited]: '11/2026' });
    await s.bus.answer({ kind: 'string', value: `Issued on %<${edited}>%`, editor: true });
    const g = s.model.entity(s.id('62'))!.geom as MTextGeometry;
    expect(g.contents).toBe('Issued on 11/2026');
  });

  it('keeps the field as it was when the dialog is cancelled', async () => {
    const s = setup();
    await s.bus.submit('TEXTEDIT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('61')] });
    const code = '\\AcVar Date \\f "yyyy"';
    await s.bus.answer({ kind: 'string', value: `Rev %<${FIELD_EDIT}${code}>%`, editor: true });
    await s.bus.cancel();
    expect(s.editor().value).toBe(`Rev %<${code}>%`);
    expect(s.editor().kind).toBe('text');
  });

  it("opens an object's field on its object, and one the dialog cannot show as Insert Field does", async () => {
    const s = setup();
    await s.bus.script(['MTEXT', '0,0', '60,-20']);
    const area = '\\AcObjProp Object(%<\\_ObjId 60>%).Area \\f "%lu2%pr1"';
    await s.bus.answer({ kind: 'string', value: `A %<${FIELD_EDIT}${area}>%`, editor: true });
    expect(s.dialog().spec).toEqual({
      name: 'Object',
      object: '60',
      property: 'Area',
      units: 2,
      precision: 1,
    });
    expect(s.dialog().objectType).toBe('Circle');
    expect(Object.keys(s.dialog().snapshot.objects['60']!)).toContain('Area');
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      field: { ...s.dialog().spec!, property: 'Radius' },
    });
    const radius = '\\AcObjProp Object(%<\\_ObjId 60>%).Radius \\f "%lu2%pr1"';
    expect(s.editor().value).toBe(`A %<${radius}>%`);
    expect(s.editor().fields?.[radius]).toBe('10.0');
    const author = '\\AcVar Author';
    await s.bus.answer({ kind: 'string', value: `%<${FIELD_EDIT}${author}>%`, editor: true });
    expect(s.dialog().spec).toBeUndefined();
    await s.bus.cancel();
    expect(s.editor().value).toBe(`%<${author}>%`);
  });
});
