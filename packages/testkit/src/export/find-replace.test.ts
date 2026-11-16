// FIND's Replace All (M4-09 part 2) saves and reads back. The title-block drawing
// (attributes/fixture.ts, authored here per DEC-047) with a TEXT and a formatted MTEXT added in
// model space: Replace All changes them, the title block's multiline NOTES attribute and, with
// Search blocks, a heading inside the block's definition. The drawing saves as AC1032 DXF and
// reopens with each text as replaced, its formatting codes kept.
import { MText, TextEntity, XYZ } from '@node-projects/acad-ts';
import {
  DEFAULT_FIND_SETTINGS,
  DocumentModel,
  PromptBus,
  builtinCommands,
  type DialogRequest,
  type FindSettings,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument, writeCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { titleBlockDxf } from '../attributes/fixture.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

function authored(): Uint8Array {
  const doc = readCadDocument(titleBlockDxf());
  const t = new TextEntity();
  t.value = 'GENERAL NOTES';
  t.insertPoint = new XYZ(20, 250, 0);
  t.height = 5;
  const m = new MText();
  m.insertPoint = new XYZ(20, 230, 0);
  m.height = 3.5;
  m.rectangleWidth = 100;
  m.value = '{\\fArial|b1;SITE} NOTES\\PSEE NOTES %%c25';
  doc.entities!.add(t);
  doc.entities!.add(m);
  return writeCadDocument(doc, { format: 'dxf' });
}

/** Every text in the drawing: model space's, the title block's attributes and its headings. */
function texts(model: DocumentModel): string[] {
  const out: string[] = [];
  for (const e of model.entities()) {
    const g = e.geom;
    if (g.kind === 'TEXT') out.push(g.value);
    if (g.kind === 'MTEXT') out.push(g.contents);
    if (g.kind === 'INSERT') {
      for (const a of g.attributes) out.push(`${a.tag}=${a.mtext ? a.mtext.contents : a.value}`);
    }
  }
  return out.sort();
}

const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

describe('FIND Replace All saves as DXF and reads back', () => {
  it('keeps each text as replaced, with its formatting', async () => {
    const bytes = authored();
    const model = modelOf(bytes);
    const space = [...model.blocks.values()].find((b) => /^\*model_space$/i.test(b.name))!.handle;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: (): Promise<ViewReply> => Promise.resolve({ ok: true }) },
      space: () => space,
    });
    let settings: FindSettings = DEFAULT_FIND_SETTINGS;
    const replaceAll = async (find: string, replace: string) => {
      settings = { ...settings, find, replace };
      await bus.answer({
        kind: 'dialog',
        action: 'apply',
        find: { settings, action: { op: 'replaceAll' } },
      });
      const p = bus.prompt;
      return p?.kind === 'dialog'
        ? (p.dialog as Extract<DialogRequest, { type: 'find' }>)
        : undefined;
    };
    const before = texts(model);
    await bus.submit('FIND');
    expect((await replaceAll('notes', 'REMARKS'))?.note).toBe('3 matches were replaced.');
    expect((await replaceAll('scale', 'MEASURE'))?.note).toBe('1 match was replaced.');
    expect((await replaceAll('description', 'CHANGE'))?.note).toBe('1 match was replaced.');
    await bus.answer({ kind: 'dialog', action: 'ok', find: { settings } });
    expect(bus.command).toBeUndefined();

    const after = texts(model);
    expect(after).toContain('GENERAL REMARKS');
    expect(after).toContain('{\\fArial|b1;SITE} REMARKS\\PSEE REMARKS %%c25');
    expect(after).toContain('NOTES=ALL DIMENSIONS IN MM\\PDO NOT MEASURE');
    expect(after).toContain('CHANGE');
    expect(after).not.toContain('DESCRIPTION');
    // Nothing else changed.
    expect(after.length).toBe(before.length);
    expect(after.filter((t) => !before.includes(t))).toHaveLength(4);

    const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    expect(texts(modelOf(saved))).toEqual(after);
  });
});
