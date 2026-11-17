// M4-23 part 2: fields in table cells. A text cell holds fields as an MTEXT does (AutoCAD keeps
// a cell's fields in the FIELD its content names: DXF 344 in the cell's ACAD_TABLE codes, the
// field content of its TABLECONTENT): the cell editor (TABLEDIT, a double click, a new table's
// first cell) offers Insert Field (Ctrl+F), Edit Field and Update Field, the cell shows each
// field's value in the table's `*T` block, and UPDATEFIELD, FIELDEVAL's events (open, save,
// plot, REGEN) evaluate them again, drawing the block again with the new values.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  FIELD_EDIT,
  FIELD_INSERT,
  FIELD_UPDATE,
  PromptBus,
  builtinCommands,
  fieldEventChange,
  fieldEventMayUpdate,
  standardTableStyle,
  type DialogPrompt,
  type DrawingField,
  type Entity,
  type FieldDialogRequest,
  type MTextGeometry,
  type StringPrompt,
  type TableGeometry,
  type TableStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const NOW = new Date(2026, 10, 16, 9, 30);
const LATER = new Date(2027, 0, 2, 8, 0);
const YEAR = '\\AcVar Date \\f "yyyy"';
const FILE = '\\AcVar Filename \\f "%tc1%fn2"';

const ACADISO: TableStyleRecord = { handle: '90', ...standardTableStyle(true, '16') };

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
    meta: { ...init.meta, measurement: 'metric' },
    header: new Map([...init.header!, ...(o.header ?? [])]),
    tables: {
      ...init.tables,
      textStyles: [
        {
          handle: '16',
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      tableStyles: [ACADISO],
    },
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
  const tableEntity = (): Entity & { geom: TableGeometry } =>
    [...model.entities()].find(
      (e) => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    ) as Entity & {
      geom: TableGeometry;
    };
  const table = () => tableEntity().geom;
  /** The texts the table's `*T` block draws. */
  const blockTexts = (): string[] =>
    [...model.entities()]
      .filter((e) => e.owner === table().block && e.geom.kind === 'MTEXT')
      .map((e) => (e.geom as MTextGeometry).contents);
  const dialog = () => (bus.prompt as DialogPrompt).dialog as FieldDialogRequest;
  const editor = () => (bus.prompt as StringPrompt).editor!;
  const type = (value: string, cell?: 'next' | 'down') =>
    bus.answer({ kind: 'string', value, editor: true, ...(cell && { cell }) });
  const setNow = (d: Date) => {
    now = d;
  };
  return { model, bus, log, tableEntity, table, blockTexts, dialog, editor, type, setNow };
}

/** -TABLE: two columns, two data rows at 0,0; the editor opens in the title cell. */
async function newTable(s: ReturnType<typeof setup>) {
  await s.bus.script(['-TABLE', '2', '2', '0,0']);
}

/** TABLEDIT on the first data cell (row 2, column 0). */
async function editFirstDataCell(s: ReturnType<typeof setup>) {
  await s.bus.script(['TABLEDIT', '10,-22']);
}

describe('the cell editor with fields', () => {
  it('offers Insert Field and keeps the field in the cell, the block showing its value', async () => {
    const s = setup();
    await newTable(s);
    // `fields` shows the editor's Insert Field (the toolbar's Field button, Ctrl+F).
    expect(s.editor()).toMatchObject({ kind: 'mtext', cell: true, fields: {} });
    await s.type(`Rev %<${FIELD_INSERT}>%`);
    expect(s.dialog().type).toBe('field');
    expect(s.dialog().snapshot.fileName).toBe('Plan.dxf');
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date', date: 'yyyy' } });
    // The editor opens again in the same cell, with the field in place, shown by its value.
    expect(s.editor()).toMatchObject({ cell: true, value: `Rev %<${YEAR}>%` });
    expect(s.editor().fields).toEqual({ [YEAR]: '2026' });
    await s.type(`Rev %<${YEAR}>%`);
    expect(s.bus.command).toBeUndefined();
    const cell = s.table().cells[0]![0]!;
    expect(cell.text).toBe('Rev 2026');
    expect(cell.field).toEqual({
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
    expect(s.blockTexts()).toContain('Rev 2026');
  });

  it('makes the field of a code typed into a cell, and moves on with Tab', async () => {
    const s = setup();
    await newTable(s);
    await s.type(`%<${FILE}>%`, 'next');
    expect(s.bus.prompt?.kind).toBe('string');
    await s.type('Mark');
    const [title, header] = s.table().cells;
    expect(title![0]).toMatchObject({ text: 'PLAN' });
    expect(title![0]!.field?.children.map((c) => [c.code, c.value])).toEqual([[FILE, 'PLAN']]);
    expect(header![0]).toMatchObject({ text: 'Mark' });
    expect(header![0]).not.toHaveProperty('field');
  });

  it('keeps a field as text in a cell whose data format reads typed text', async () => {
    const s = setup();
    await newTable(s);
    await s.bus.cancel();
    // The field's value stays the field's text, not a value read from what it shows.
    await editFirstDataCell(s);
    await s.type(`%<${YEAR}>%`);
    const cell = s.table().cells[2]![0]!;
    expect(cell).toMatchObject({ type: 'text', text: '2026' });
    expect(cell).not.toHaveProperty('value');
    expect(cell.field?.children[0]?.code).toBe(YEAR);
  });

  it('places nothing when the Field dialog is cancelled, and the cell stays plain text', async () => {
    const s = setup();
    await newTable(s);
    await s.type(`A %<${FIELD_INSERT}>%`);
    await s.bus.cancel();
    expect(s.editor()).toMatchObject({ cell: true, value: 'A ' });
    await s.type('A');
    expect(s.table().cells[0]![0]).toMatchObject({ text: 'A' });
    expect(s.table().cells[0]![0]).not.toHaveProperty('field');
  });
});

describe('TABLEDIT on a cell with fields', () => {
  async function withField(s: ReturnType<typeof setup>) {
    await newTable(s);
    await s.bus.cancel();
    await editFirstDataCell(s);
    await s.type(`Rev %<${YEAR}>%`);
  }

  it('opens on the codes, each shown by its value, and keeps the fields an edit leaves', async () => {
    const s = setup();
    await withField(s);
    await editFirstDataCell(s);
    expect(s.editor().value).toBe(`Rev %<${YEAR}>%`);
    expect(s.editor().fields).toEqual({ [YEAR]: '2026' });
    await s.type(`Rev %<${YEAR}>% B`);
    const cell = s.table().cells[2]![0]!;
    expect(cell.text).toBe('Rev 2026 B');
    expect(cell.field?.code).toBe('Rev %<\\_FldIdx 0>% B');
    expect(s.blockTexts()).toContain('Rev 2026 B');
  });

  it("edits a field through the Field dialog (Edit Field), and drops the cell's fields when gone", async () => {
    const s = setup();
    await withField(s);
    await editFirstDataCell(s);
    await s.type(`Rev %<${FIELD_EDIT}${YEAR}>%`);
    expect(s.dialog().spec).toMatchObject({ name: 'Date', date: 'yyyy' });
    await s.bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date', date: 'yy' } });
    const yy = '\\AcVar Date \\f "yy"';
    expect(s.editor()).toMatchObject({ cell: true, value: `Rev %<${yy}>%` });
    expect(s.editor().fields?.[yy]).toBe('26');
    await s.type(`Rev %<${yy}>%`);
    expect(s.table().cells[2]![0]!.text).toBe('Rev 26');
    expect(s.table().cells[2]![0]!.field?.children[0]?.code).toBe(yy);
    // The field deleted: the cell keeps what was typed, with no fields.
    await editFirstDataCell(s);
    await s.type('Rev 26');
    expect(s.table().cells[2]![0]).toMatchObject({ text: 'Rev 26' });
    expect(s.table().cells[2]![0]).not.toHaveProperty('field');
  });

  it("Update Field opens the editor again with the field's value evaluated now", async () => {
    const s = setup();
    await withField(s);
    s.setNow(LATER);
    await editFirstDataCell(s);
    await s.type(`Rev %<${FIELD_UPDATE}${YEAR}>%`);
    expect(s.editor()).toMatchObject({ cell: true, value: `Rev %<${YEAR}>%` });
    expect(s.editor().fields).toEqual({ [YEAR]: '2027' });
    // Closing on the same codes keeps the update.
    await s.type(`Rev %<${YEAR}>%`);
    expect(s.table().cells[2]![0]!.text).toBe('Rev 2027');
  });

  it('is not changed when the editor closes on the codes it opened on', async () => {
    const s = setup();
    await withField(s);
    const before = s.table();
    s.setNow(LATER);
    await editFirstDataCell(s);
    await s.type(`Rev %<${YEAR}>%`);
    expect(s.table()).toBe(before);
  });
});

describe('evaluating the fields of a table', () => {
  /** A table read with a field in its first data cell last evaluated as 2020. */
  async function readTable(s: ReturnType<typeof setup>, options?: number) {
    await newTable(s);
    await s.bus.cancel();
    await editFirstDataCell(s);
    await s.type('Rev 2020');
    const e = s.tableEntity();
    const cells = e.geom.cells.map((row, i) =>
      row.map((c, j) => (i === 2 && j === 0 ? { ...c, field: yearField('2020', options) } : c)),
    );
    const b = new ChangeSetBuilder(s.model);
    b.updateEntity(e.id, { geom: { ...e.geom, cells } });
    s.model.apply(b.build());
    return e;
  }

  it('UPDATEFIELD evaluates them, reports them and draws the new value', async () => {
    const s = setup();
    const e = await readTable(s);
    expect(s.blockTexts()).toContain('Rev 2020');
    await s.bus.submit('UPDATEFIELD');
    await s.bus.answer({ kind: 'selection', ids: [e.id] });
    expect(s.log.slice(-2)).toEqual(['1 field(s) found.', '1 field(s) updated.']);
    const cell = s.table().cells[2]![0]!;
    expect(cell.text).toBe('Rev 2026');
    expect(cell.field?.children[0]?.value).toBe('2026');
    expect(s.blockTexts()).toContain('Rev 2026');
    expect(s.blockTexts()).not.toContain('Rev 2020');
    // One undo step.
    await s.bus.submit('U');
    expect(s.table().cells[2]![0]!.text).toBe('Rev 2020');
    expect(s.blockTexts()).toContain('Rev 2020');
  });

  it('FIELDEVAL events and REGEN update them as their options allow', async () => {
    const s = setup();
    await readTable(s);
    const base = { model: s.model, now: NOW, fileName: 'Plan.dxf', folder: '' };
    expect(fieldEventMayUpdate(s.model, 'save')).toBe(true);
    s.model.apply(fieldEventChange(base, 'save')!);
    expect(s.table().cells[2]![0]!.text).toBe('Rev 2026');
    expect(s.blockTexts()).toContain('Rev 2026');
    // REGEN.
    const r = setup();
    await readTable(r);
    await r.bus.submit('REGEN');
    expect(r.table().cells[2]![0]!.text).toBe('Rev 2026');
    expect(r.blockTexts()).toContain('Rev 2026');
    // A field evaluated on demand only (DXF 91 = 32) waits for UPDATEFIELD.
    const t = setup();
    await readTable(t, 32);
    expect(fieldEventChange({ ...base, model: t.model }, 'open')).toBeUndefined();
    // A drawing whose FIELDEVAL leaves regeneration out.
    const u = setup({ header: [['FIELDEVAL', 0]] });
    await readTable(u);
    expect(fieldEventMayUpdate(u.model, 'regen')).toBe(false);
  });

  it('a table without fields has none to update', async () => {
    const s = setup();
    await newTable(s);
    await s.type('Title');
    expect(fieldEventMayUpdate(s.model, 'regen')).toBe(false);
  });
});
