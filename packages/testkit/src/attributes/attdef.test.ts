// M5-03 part 1: attribute definitions made by -ATTDEF and ATTDEF's dialog on the PromptBus, saved
// as AC1032 DXF and read back: their tags, prompts, defaults and modes (DXF 70, 280), a Fit
// one's two points, a multiline one's embedded MTEXT, and a block made of them with a reference
// carrying their values. CI's ezdxf audit reads the save (audit.py `FIXTURE_SAVES`, kind
// `attdef`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type AttdefGeometry,
  type AttdefSettings,
  type DialogRequest,
  type DocumentModel,
  type InsertGeometry,
  type PromptAnswer,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

const PATH = 'third-party/ezdxf/examples_dxf/colors.dxf';
const bytes = () =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${PATH}`, import.meta.url))),
  );

const attdefs = (model: DocumentModel, owner: string) =>
  model
    .blockEntities(owner)
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'ATTDEF')
    .map((e) => e.geom as AttdefGeometry);

describe('ATTDEF saves (M5-03 part 1)', () => {
  it('writes new attribute definitions, a block of them and a reference, which read back', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: '' }) },
    });
    // -ATTDEF: a plain one, a constant invisible one fitted between two points, a multiline one.
    await bus.script(['-ATTDEF', '', 'PART', 'Part number', 'P-1', '0,0', '2.5', '0']);
    await bus.script(['-ATTDEF', 'I', 'C', '', 'MAT', 'Steel', 'J', 'Fit', '0,-5', '30,-5', '2']);
    await bus.script(['-ATTDEF', 'I', 'C', 'M', '', 'NOTE', 'Notes', 'one\\Ptwo', 'J', 'TL']);
    await bus.script(['0,-10', '2', '0', '40']);
    // The dialog: a verified, preset one below the last.
    await bus.submit('ATTDEF');
    const request = (bus.prompt as { dialog: DialogRequest }).dialog as Extract<
      DialogRequest,
      { type: 'attdefine' }
    >;
    const settings: AttdefSettings = {
      ...request.settings,
      multiline: false,
      tag: 'rev',
      prompt: 'Revision',
      value: 'A',
      verify: true,
      preset: true,
      pointOnScreen: false,
      point: { x: 0, y: -20 },
      justify: 'MC',
      rotation: Math.PI / 2,
    };
    await bus.answer({ kind: 'dialog', action: 'ok', attdefine: { settings } } as PromptAnswer);
    expect(bus.command).toBeUndefined();
    const made = attdefs(model, modelSpaceOf(model));
    expect(made.map((g) => g.tag)).toEqual(['PART', 'MAT', 'NOTE', 'REV']);

    // A block of them, and a reference: its values asked (REV is preset, MAT constant).
    const ids = model
      .blockEntities(modelSpaceOf(model))
      .filter((id) => model.entity(id)!.geom.kind === 'ATTDEF');
    await bus.script(['-BLOCK', 'TAGS', '0,0']);
    await bus.answer({ kind: 'selection', ids });
    await bus.script(['-INSERT', 'TAGS', '100,0', '', '', '', 'P-207', 'first\\Psecond']);
    expect(bus.command).toBeUndefined();

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(PATH, 'attdef', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
    const block = [...back.tables.blockRecords.values()].find((r) => r.name === 'TAGS')!;
    const defs = attdefs(back, block.handle);
    const was = attdefs(
      model,
      [...model.tables.blockRecords.values()].find((r) => r.name === 'TAGS')!.handle,
    );
    expect(defs.map((g) => [g.tag, g.prompt, g.value, g.flags, g.lockPosition ?? false])).toEqual([
      ['PART', 'Part number', 'P-1', 0, true],
      ['MAT', '', 'Steel', 3, true],
      ['NOTE', 'Notes', 'one\\Ptwo', 0, true],
      ['REV', 'Revision', 'A', 12, true],
    ]);
    defs.forEach((g, i) => {
      const w = was[i]!;
      expect(g.position.x).toBeCloseTo(w.position.x, 9);
      expect(g.position.y).toBeCloseTo(w.position.y, 9);
      expect(g.height).toBeCloseTo(w.height, 9);
      expect(g.rotation).toBeCloseTo(w.rotation, 9);
      expect([g.halign, g.valign]).toEqual([w.halign, w.valign]);
    });
    expect(defs[1]!.alignmentPoint!.x).toBeCloseTo(30, 9);
    expect(defs[2]!.mtext).toMatchObject({ contents: 'one\\Ptwo', width: 40, attachment: 1 });

    const ref = back
      .blockEntities(modelSpaceOf(back))
      .map((id) => back.entity(id)!.geom)
      .find((g): g is InsertGeometry => g.kind === 'INSERT' && g.block === block.handle)!;
    expect(ref.attributes.map((a) => [a.tag, a.value, a.flags])).toEqual([
      ['PART', 'P-207', 0],
      ['NOTE', 'first\\Psecond', 0],
      ['REV', 'A', 12],
    ]);
    expect(ref.attributes[1]!.mtext?.contents).toBe('first\\Psecond');
  });
});
