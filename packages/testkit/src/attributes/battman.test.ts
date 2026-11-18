// M5-03 part 2: BATTMAN on the title-block test drawing (fixture.ts), saved as AC1032 DXF and
// read back: a definition moved up, one edited and renamed, one removed, and the reference
// given them ("Apply changes to existing references"). The definitions the file had keep their
// handles; the block's other entities keep their order; the reference keeps its values, the
// renamed tag's too, in the definitions' new order.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type AttdefGeometry,
  type DialogRequest,
  type DocumentModel,
  type InsertGeometry,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves';
import { TITLE_BLOCK, TITLE_BLOCK_DXF } from './fixture';

const bytes = () =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/attributes/${TITLE_BLOCK_DXF}`, import.meta.url)),
    ),
  );

const blockOf = (model: DocumentModel) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === TITLE_BLOCK)!.handle;

/** The block's entities: an ATTDEF by its tag, anything else by its handle. */
const contents = (model: DocumentModel) =>
  model.blockEntities(blockOf(model)).map((id) => {
    const e = model.entity(id)!;
    return e.geom.kind === 'ATTDEF' ? (e.geom as AttdefGeometry).tag : e.handle;
  });

const reference = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!.geom)
    .find((g): g is InsertGeometry => g.kind === 'INSERT')!;

describe('BATTMAN saves (M5-03 part 2)', () => {
  it('writes the definitions moved, edited and removed, and the reference given them', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: '' }) },
    });
    const before = contents(model);
    const handles = new Map(
      model
        .blockEntities(blockOf(model))
        .map((id) => model.entity(id)!)
        .filter((e) => e.geom.kind === 'ATTDEF')
        .map((e) => [(e.geom as AttdefGeometry).tag, e.handle]),
    );
    const values = new Map(reference(model).attributes.map((a) => [a.tag, a.value]));
    await bus.submit('BATTMAN');
    const r = (bus.prompt as { dialog: DialogRequest }).dialog as Extract<
      DialogRequest,
      { type: 'battman' }
    >;
    expect(r.block).toBe(blockOf(model));
    const tags = r.attributes.map((a) => a.tag);
    expect(tags.slice(0, 3)).toEqual(['TITLE', 'DWG_NO', 'SCALE']);
    const h = (tag: string) => handles.get(tag)!;
    // SCALE moved above DWG_NO, REV3_BY removed, TITLE renamed DWG_TITLE and made taller.
    const order = tags.filter((t) => t !== 'REV3_BY').map(h);
    [order[1], order[2]] = [order[2]!, order[1]!];
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      battman: {
        block: r.block,
        order,
        removed: [h('REV3_BY')],
        attributes: [{ handle: h('TITLE'), tag: 'DWG_TITLE', height: 6 }],
        applyToExisting: true,
      },
    });
    expect(bus.command).toBeUndefined();

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
    const now = contents(back);
    const expected = before
      .filter((x) => x !== 'REV3_BY')
      .map((x) =>
        x === 'TITLE' ? 'DWG_TITLE' : x === 'DWG_NO' ? 'SCALE' : x === 'SCALE' ? 'DWG_NO' : x,
      );
    expect(now).toEqual(expected);
    // The definitions keep the handles the file gave them.
    for (const e of back.blockEntities(blockOf(back)).map((id) => back.entity(id)!)) {
      if (e.geom.kind !== 'ATTDEF') continue;
      const tag = (e.geom as AttdefGeometry).tag;
      expect(e.handle).toBe(h(tag === 'DWG_TITLE' ? 'TITLE' : tag));
      if (tag === 'DWG_TITLE') expect((e.geom as AttdefGeometry).height).toBe(6);
    }
    // The reference: values kept (TITLE's under its new tag), REV3_BY gone, the new order.
    const ref = reference(back);
    const got = ref.attributes.map((a) => [a.tag, a.value]);
    expect(got.slice(0, 3)).toEqual([
      ['DWG_TITLE', values.get('TITLE')],
      ['SCALE', values.get('SCALE')],
      ['DWG_NO', values.get('DWG_NO')],
    ]);
    expect(got.some(([t]) => t === 'REV3_BY')).toBe(false);
    expect(ref.attributes[0]!.height).toBeCloseTo(6, 9);
  });
});
