// M5-03 part 4: Insert Field in the attribute dialogs on the title-block test drawing
// (fixture.ts), saved as AC1032 DXF and read back: ATTDEF's dialog makes a definition whose
// default holds a Date field, -BLOCK makes a block of it, -INSERT a reference taking the default
// (the ATTRIB holds the field too), and EATTEDIT's Insert Field puts a field in the title block's
// TITLE value. Each FIELD tree reads back where it was put, the objects added get handles above
// the file's $HANDSEED and none is renumbered. CI's ezdxf audit reads the save (audit.py
// `FIXTURE_SAVES`, kind `attfield`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  FIELD_INSERT,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type AttdefGeometry,
  type DialogRequest,
  type DocumentModel,
  type InsertGeometry,
  type PromptAnswer,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { TITLE_BLOCK, TITLE_BLOCK_DXF } from './fixture';

/** Where the audit gate finds the save (scripts/dxf-audit/audit.py `FIXTURE_SAVES`). */
const AUDIT_PATH = `fixtures/attributes/${TITLE_BLOCK_DXF}`;
const YEAR = '\\AcVar Date \\f "yyyy"';
const NOW = new Date(Date.UTC(2026, 10, 18, 12));

const bytes = () =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/attributes/${TITLE_BLOCK_DXF}`, import.meta.url)),
    ),
  );

const inserts = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'INSERT');

const handseed = (model: DocumentModel) => parseInt(String(model.header.get('$HANDSEED')), 16);

describe('Insert Field in the attribute dialogs saves (M5-03 part 4)', () => {
  it('writes the fields of a new definition, its reference and an edited attribute', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const seed = handseed(model);
    const handles = new Set([...model.entities()].map((e) => e.handle));
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: '' }) },
      clock: { now: () => NOW },
    });
    const dialog = () => (bus.prompt as { dialog: DialogRequest }).dialog;
    const fieldOk = () =>
      bus.answer({ kind: 'dialog', action: 'ok', field: { name: 'Date', date: 'yyyy' } });

    // ATTDEF: the Default "Issued <year>", the field from Insert Field.
    await bus.submit('ATTDEF');
    const settings = () => (dialog() as Extract<DialogRequest, { type: 'attdefine' }>).settings;
    const attdef = (patch: object, pick?: string) =>
      bus.answer({
        kind: 'dialog',
        action: 'ok',
        attdefine: { settings: { ...settings(), ...patch }, ...(pick && { pick }) },
      } as PromptAnswer);
    await attdef({ tag: 'ISSUED', prompt: 'Issued', value: `Issued %<${FIELD_INSERT}>%` }, 'field');
    await fieldOk();
    await attdef({ pointOnScreen: false, point: { x: 10, y: 300 } });
    const def = [...model.entities()].find((e) => !handles.has(e.handle))!;
    await bus.script(['-BLOCK', 'ISSUE', '10,300']);
    await bus.answer({ kind: 'selection', ids: [def.id] });
    await bus.script(['-INSERT', 'ISSUE', '10,300', '1', '', '0', '']);
    expect(bus.command).toBeUndefined();

    // EATTEDIT on the title block: "<year> rev" in TITLE's value, the field from Insert Field.
    const tb = inserts(model).find(
      (e) => model.blocks.get((e.geom as InsertGeometry).block)?.name === TITLE_BLOCK,
    )!;
    const title = (tb.geom as InsertGeometry).attributes.find((a) => a.tag === 'TITLE')!;
    await bus.submit('EATTEDIT');
    await bus.answer({ kind: 'selection', ids: [tb.id] });
    await bus.answer({
      kind: 'dialog',
      action: 'field',
      target: title.handle,
      attributes: [{ handle: title.handle, value: `%<${FIELD_INSERT}>% rev` }],
    });
    await fieldOk();
    await bus.answer({ kind: 'dialog', action: 'ok', attributes: [] });
    expect(bus.command).toBeUndefined();

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'attfield', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;

    const block = [...back.tables.blockRecords.values()].find((r) => r.name === 'ISSUE')!.handle;
    const d = back
      .blockEntities(block)
      .map((id) => back.entity(id)!.geom)
      .find((g): g is AttdefGeometry => g.kind === 'ATTDEF')!;
    expect(d.value).toBe('Issued 2026');
    expect(d.field?.code).toBe('Issued %<\\_FldIdx 0>%');
    expect(d.field?.children.map((c) => [c.code, c.value])).toEqual([[YEAR, '2026']]);

    const refs = inserts(back);
    const issue = refs.find((e) => (e.geom as InsertGeometry).block === block)!;
    const a = (issue.geom as InsertGeometry).attributes[0]!;
    expect(a.value).toBe('Issued 2026');
    expect(a.field?.children.map((c) => c.code)).toEqual([YEAR]);
    expect(parseInt(a.handle, 16)).toBeGreaterThanOrEqual(seed);

    const tbBack = refs.find((e) => e.handle === tb.handle)!;
    const t = (tbBack.geom as InsertGeometry).attributes.find((x) => x.tag === 'TITLE')!;
    // The ATTRIB keeps its handle; its value and its new FIELD tree read back.
    expect(t.handle).toBe(title.handle);
    expect(t.value).toBe('2026 rev');
    expect(t.field?.code).toBe('%<\\_FldIdx 0>% rev');
    expect(t.field?.children.map((c) => [c.code, c.value])).toEqual([[YEAR, '2026']]);

    // Nothing the file had is renumbered; everything new is above its $HANDSEED.
    for (const e of back.entities()) {
      if (!handles.has(e.handle)) expect(parseInt(e.handle, 16)).toBeGreaterThanOrEqual(seed);
    }
  });
});
