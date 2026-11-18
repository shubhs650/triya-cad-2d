// M5-03 part 4: Insert Field for an attribute's value, as AutoCAD 2024's (AutoCAD Help,
// "Attribute Definition Dialog Box": "Default ... Insert Field button: Displays the Field dialog
// box. You can insert a field as all or part of the value for an attribute"; "Edit Attribute
// Dialog Box (BATTMAN)"; "Enhanced Attribute Editor"):
//   - ATTDEF's Default, BATTMAN Edit Attribute's Default and EATTEDIT's Value answer with the
//     field's place marked (`%<FIELD_INSERT>%`, or `%<FIELD_EDIT code>%` on a field to edit), as
//     the text editors do; the Field dialog opens, and the dialog comes back with the field
//     there, shown by its value; Cancel inserts none;
//   - the definition or attribute then holds the field (its FIELD tree) and shows its value;
//   - a reference takes a default's fields with the default, not with a value typed instead;
//   - a value typed over its fields holds the text alone, and ATTSYNC keeps a reference's own.
import { describe, expect, it } from 'vitest';
import {
  FIELD_EDIT,
  FIELD_INSERT,
  PromptBus,
  builtinCommands,
  type AttdefGeometry,
  type AttdefSettings,
  type BattmanResume,
  type DialogRequest,
  type Entity,
  type FieldDialogRequest,
  type InsertGeometry,
  type PromptAnswer,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { host, setup } from './edit-harness';

/** 2026-11-16 12:00 UTC: every Date field below shows its year, 2026, in any time zone. */
const NOW = new Date(Date.UTC(2026, 10, 16, 12));
const YEAR = '\\AcVar Date \\f "yyyy"';
const DAY = '\\AcVar Date \\f "dd/MM/yyyy"';

type Dialog<T extends string> = Extract<DialogRequest, { type: T }>;

function drawing() {
  const t = setup();
  const bus = new PromptBus({
    model: t.model,
    registry: builtinCommands(),
    view: host(() => t.model),
    clock: { now: () => NOW },
  });
  const dialog = <T extends string>(type: T): Dialog<T> => {
    const p = bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe(type);
    return p!.dialog as Dialog<T>;
  };
  /** The Field dialog closed by OK on a Date field shown as `date`. */
  const fieldOk = async (date: string) => {
    dialog('field');
    await bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date', date } });
  };
  /** ATTDEF's dialog closed with its settings changed by `patch`. */
  const attdef = (patch: Partial<AttdefSettings>, pick?: string) =>
    bus.answer({
      kind: 'dialog',
      action: 'ok',
      attdefine: { settings: { ...dialog('attdefine').settings, ...patch }, ...(pick && { pick }) },
    } as PromptAnswer);
  const space = () => t.model.blockEntities(MODEL_SPACE).map((id) => t.model.entity(id)!);
  const last = (kind: string) =>
    space()
      .filter((e) => e.geom.kind === kind)
      .at(-1)!;
  return { ...t, bus, dialog, fieldOk, attdef, space, last };
}

/** A drawing with block TB: ATTDEF REV, its default "Rev <year field>", at 0,0. */
async function withBlock() {
  const t = drawing();
  await t.bus.submit('ATTDEF');
  await t.attdef({ tag: 'REV', prompt: 'Revision', value: `Rev %<${FIELD_INSERT}>%` }, 'field');
  await t.fieldOk('yyyy');
  await t.attdef({ pointOnScreen: false, point: { x: 0, y: 0 } });
  const def = t.last('ATTDEF');
  await t.bus.script(['-BLOCK', 'TB', '0,0']);
  await t.bus.answer({ kind: 'selection', ids: [def.id] });
  const block = [...t.model.tables.blockRecords.values()].find((r) => r.name === 'TB')!.handle;
  const definition = () =>
    t.model
      .blockEntities(block)
      .map((id) => t.model.entity(id)!)
      .find((e) => e.geom.kind === 'ATTDEF')!;
  const attribute = (e: Entity) => (e.geom as InsertGeometry).attributes[0]!;
  return { ...t, block, definition, attribute };
}

describe('ATTDEF: Insert Field on the Default', () => {
  it('puts the field where the Default marked its place, shown by its value', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    // The Default offers Insert Field: what each of its fields shows, none yet.
    expect(t.dialog('attdefine').fields).toEqual({});
    await t.attdef({ tag: 'DATE', value: `Issued %<${FIELD_INSERT}>% (A)` }, 'field');
    const f = t.dialog('field') as FieldDialogRequest;
    expect(f.spec).toBeUndefined();
    await t.fieldOk('yyyy');
    const r = t.dialog('attdefine');
    expect(r.settings.tag).toBe('DATE');
    expect(r.settings.value).toBe(`Issued %<${YEAR}>% (A)`);
    expect(r.fields).toEqual({ [YEAR]: '2026' });
    await t.attdef({ pointOnScreen: false, point: { x: 5, y: 5 } });
    expect(t.bus.command).toBeUndefined();
    const g = t.last('ATTDEF').geom as AttdefGeometry;
    expect(g.value).toBe('Issued 2026 (A)');
    expect(g.field?.code).toBe('Issued %<\\_FldIdx 0>% (A)');
    expect(g.field?.children.map((c) => [c.code, c.value])).toEqual([[YEAR, '2026']]);
  });

  it('edits a field (Edit Field) and inserts none on Cancel', async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.attdef({ tag: 'D', value: `%<${FIELD_INSERT}>%` }, 'field');
    await t.fieldOk('yyyy');
    // Edit Field opens the dialog on the field's choices.
    await t.attdef({ value: `%<${FIELD_EDIT}${YEAR}>%!` }, 'field');
    expect((t.dialog('field') as FieldDialogRequest).spec).toEqual({ name: 'Date', date: 'yyyy' });
    await t.fieldOk('dd/MM/yyyy');
    expect(t.dialog('attdefine').settings.value).toBe(`%<${DAY}>%!`);
    expect(t.dialog('attdefine').fields).toEqual({ [DAY]: '16/11/2026' });
    // Cancel (Esc): the field edited stays, an inserted one is not made.
    await t.attdef({ value: `%<${FIELD_EDIT}${DAY}>%!` }, 'field');
    await t.bus.cancel();
    expect(t.dialog('attdefine').settings.value).toBe(`%<${DAY}>%!`);
    await t.attdef({ value: `%<${DAY}>%! %<${FIELD_INSERT}>%` }, 'field');
    await t.bus.cancel();
    expect(t.dialog('attdefine').settings.value).toBe(`%<${DAY}>%! `);
    await t.attdef({ value: 'plain', pointOnScreen: false });
    const g = t.last('ATTDEF').geom as AttdefGeometry;
    expect(g.value).toBe('plain');
    expect(g.field).toBeUndefined();
  });

  it("puts the field in a multiline default from the editor's Insert Field", async () => {
    const t = drawing();
    await t.bus.submit('ATTDEF');
    await t.attdef({ tag: 'NOTE', multiline: true, value: 'One' }, 'value');
    const p = t.bus.prompt as { editor?: { value?: string; fields?: object } };
    expect(p.editor?.value).toBe('One');
    expect(p.editor?.fields).toEqual({});
    await t.bus.answer({ kind: 'string', value: `One\\P%<${FIELD_INSERT}>%`, editor: true });
    await t.fieldOk('yyyy');
    await t.bus.answer({ kind: 'string', value: `One\\P%<${YEAR}>%`, editor: true });
    expect(t.dialog('attdefine').settings.value).toBe(`One\\P%<${YEAR}>%`);
    await t.attdef({ pointOnScreen: false });
    const g = t.last('ATTDEF').geom as AttdefGeometry;
    expect(g.mtext?.contents).toBe('One\\P2026');
    expect(g.field?.code).toBe('One\\P%<\\_FldIdx 0>%');
  });
});

describe('a reference to a block whose default holds a field', () => {
  it('takes the field with the default, and not with a value typed instead', async () => {
    const t = await withBlock();
    await t.bus.script(['-INSERT', 'TB', '100,0', '1', '', '0', '']);
    const a = t.attribute(t.last('INSERT'));
    expect(a.value).toBe('Rev 2026');
    expect(a.field?.children[0]?.code).toBe(YEAR);
    await t.bus.script(['-INSERT', 'TB', '200,0', '1', '', '0', 'Rev B']);
    const b = t.attribute(t.last('INSERT'));
    expect(b.value).toBe('Rev B');
    expect(b.field).toBeUndefined();
  });
});

describe('EATTEDIT: Insert Field on the Value', () => {
  it('shows the fields as codes, inserts one and drops them when typed over', async () => {
    const t = await withBlock();
    await t.bus.script(['-INSERT', 'TB', '100,0', '1', '', '0', 'Sheet']);
    const ref = t.last('INSERT');
    const h = t.attribute(ref).handle;
    await t.bus.selectAll();
    await t.bus.submit('EATTEDIT');
    let d = t.dialog('eattedit');
    expect(d.attributes.map((a) => [a.value, a.fields])).toEqual([['Sheet', {}]]);
    await t.bus.answer({
      kind: 'dialog',
      action: 'field',
      target: h,
      attributes: [{ handle: h, value: `Sheet %<${FIELD_INSERT}>%` }],
    });
    await t.fieldOk('yyyy');
    // The field made is applied, as the value's other changes are; the dialog opens on it.
    d = t.dialog('eattedit');
    expect(d.selected).toBe(h);
    expect(d.attributes.map((a) => [a.value, a.fields])).toEqual([
      [`Sheet %<${YEAR}>%`, { [YEAR]: '2026' }],
    ]);
    let a = t.attribute(t.model.entity(ref.id)!);
    expect(a.value).toBe('Sheet 2026');
    expect(a.field?.code).toBe('Sheet %<\\_FldIdx 0>%');
    // The value left as it was keeps its field; typed over, it holds the text alone.
    await t.bus.answer({
      kind: 'dialog',
      action: 'apply',
      attributes: [{ handle: h, value: `Sheet %<${YEAR}>%` }],
    });
    expect(t.attribute(t.model.entity(ref.id)!)).toBe(a);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [{ handle: h, value: 'Sheet 7' }],
    });
    a = t.attribute(t.model.entity(ref.id)!);
    expect(a.value).toBe('Sheet 7');
    expect(a.field).toBeUndefined();
  });
});

describe('BATTMAN: Insert Field on Edit Attribute’s Default', () => {
  it('opens the Field dialog and the manager again as it stood, then applies the field', async () => {
    const t = await withBlock();
    await t.bus.script(['-INSERT', 'TB', '100,0', '1', '', '0', 'Mine']);
    const ref = t.last('INSERT');
    await t.bus.submit('BATTMAN');
    const r = t.dialog('battman');
    const [entry] = r.attributes;
    expect([entry!.value, entry!.fields]).toEqual([`Rev %<${YEAR}>%`, { [YEAR]: '2026' }]);
    const editing = { ...entry!, prompt: 'Rev?', value: `%<${FIELD_EDIT}${YEAR}>% / Rev` };
    const resume: BattmanResume = {
      rows: [{ ...entry!, prompt: 'Rev?' }],
      removed: [],
      selected: entry!.handle,
      editing,
    };
    const state = {
      block: t.block,
      order: [entry!.handle],
      removed: [],
      attributes: [],
      applyToExisting: true,
    };
    await t.bus.answer({ kind: 'dialog', action: 'field', battman: state, resume });
    expect((t.dialog('field') as FieldDialogRequest).spec).toEqual({ name: 'Date', date: 'yyyy' });
    await t.fieldOk('dd/MM/yyyy');
    const again = t.dialog('battman');
    // Nothing applied yet: the definition is as it was, the manager's state handed back.
    expect((t.definition().geom as AttdefGeometry).value).toBe('Rev 2026');
    expect(again.resume?.rows).toEqual(resume.rows);
    expect(again.resume?.editing.value).toBe(`%<${DAY}>% / Rev`);
    expect(again.resume?.editing.fields).toEqual({ [DAY]: '16/11/2026' });
    expect(again.resume?.editing.prompt).toBe('Rev?');
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      battman: {
        ...state,
        attributes: [{ handle: entry!.handle, prompt: 'Rev?', value: `%<${DAY}>% / Rev` }],
      },
    });
    expect(t.bus.command).toBeUndefined();
    const g = t.definition().geom as AttdefGeometry;
    expect([g.prompt, g.value]).toEqual(['Rev?', '16/11/2026 / Rev']);
    expect(g.field?.children.map((c) => c.code)).toEqual([DAY]);
    // The reference synced keeps its own value, without the default's field.
    const a = t.attribute(t.model.entity(ref.id)!);
    expect([a.value, a.field]).toEqual(['Mine', undefined]);
  });

  it('keeps a reference’s own field through ATTSYNC', async () => {
    const t = await withBlock();
    await t.bus.script(['-INSERT', 'TB', '100,0', '1', '', '0', '']);
    const ref = t.last('INSERT');
    const field = t.attribute(ref).field;
    expect(field).toBeDefined();
    await t.bus.submit('BATTMAN');
    const [entry] = t.dialog('battman').attributes;
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      battman: {
        block: t.block,
        order: [entry!.handle],
        removed: [],
        attributes: [{ handle: entry!.handle, value: 'Plain' }],
        applyToExisting: true,
      },
    });
    expect((t.definition().geom as AttdefGeometry).field).toBeUndefined();
    const a = t.attribute(t.model.entity(ref.id)!);
    expect(a.value).toBe('Rev 2026');
    expect(a.field).toEqual(field);
  });
});
