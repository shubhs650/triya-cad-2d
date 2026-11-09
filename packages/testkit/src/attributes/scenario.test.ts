// M2-12 acceptance: the title-block revision-table scenario. A drafter revises the sheet of
// title-block.dxf (fixture.ts) the way the app drives the engine: EATTEDIT fills revision row 2
// and adds a line to the multiline notes in the MTEXT editor, ATTEDIT retitles the sheet,
// -ATTEDIT's global edit moves the drawing number on, and TEXTEDIT renames a row's prompt in the
// block definition. The drawing saves as AC1032 DXF (DEC-047) and reopens with every edited
// attribute as written, every other one exactly as it was, under the same handles.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type AttdefGeometry,
  type DialogPrompt,
  type Entity,
  type InsertAttribute,
  type InsertGeometry,
  type StringPrompt,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { FIELDS, NOTES, TITLE_BLOCK, TITLE_BLOCK_DXF } from './fixture';

const FILE = fileURLToPath(
  new URL(`../../fixtures/attributes/${TITLE_BLOCK_DXF}`, import.meta.url),
);

const valueOf = (a: InsertAttribute) => (a.mtext ? a.mtext.contents : a.value);

function titleBlock(model: DocumentModel): Entity {
  const block = [...model.blocks.values()].find((b) => b.name === TITLE_BLOCK)!;
  return [...model.entities()].find(
    (e) => e.geom.kind === 'INSERT' && e.geom.block === block.handle,
  )!;
}

const values = (e: Entity) =>
  Object.fromEntries((e.geom as InsertGeometry).attributes.map((a) => [a.tag, valueOf(a)]));
const handleOf = (e: Entity, tag: string) =>
  (e.geom as InsertGeometry).attributes.find((a) => a.tag === tag)!.handle;

describe('title-block revision table (M2-12 scenario)', () => {
  it('revises the sheet with EATTEDIT, ATTEDIT, -ATTEDIT and TEXTEDIT, saves as DXF and reads back', async () => {
    const bytes = new Uint8Array(readFileSync(FILE));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      const bus = new PromptBus({ model, registry: builtinCommands() });
      const ref = titleBlock(model);
      const before = values(ref);

      // EATTEDIT: revision row 2, then the notes' third line in the MTEXT editor, then OK.
      await bus.submit('EATTEDIT');
      await bus.answer({ kind: 'selection', ids: [ref.id] });
      const d = (bus.prompt as DialogPrompt).dialog;
      expect(d.type === 'eattedit' && d.attributes.find((a) => a.tag === 'REV2_DESC')?.prompt).toBe(
        'Revision description 2',
      );
      await bus.answer({
        kind: 'dialog',
        action: 'mtext',
        target: handleOf(ref, 'NOTES'),
        attributes: [
          { handle: handleOf(ref, 'REV2_NO'), value: 'B' },
          { handle: handleOf(ref, 'REV2_DATE'), value: '2026-11-09' },
          { handle: handleOf(ref, 'REV2_DESC'), value: 'PUMP BASE REVISED' },
          { handle: handleOf(ref, 'REV2_BY'), value: 'SP' },
        ],
      });
      expect((bus.prompt as StringPrompt).editor?.value).toBe(NOTES.value);
      await bus.answer({
        kind: 'string',
        value: `${NOTES.value}\\PSEE ALSO OET-1002`,
        editor: true,
      });
      await bus.answer({ kind: 'dialog', action: 'ok' });
      expect(bus.command).toBeUndefined();

      // ATTEDIT: the title.
      await bus.submit('ATTEDIT');
      await bus.answer({ kind: 'selection', ids: [ref.id] });
      await bus.answer({
        kind: 'dialog',
        action: 'ok',
        attributes: [{ handle: handleOf(ref, 'TITLE'), value: 'PUMP HOUSE GA - REV B' }],
      });

      // -ATTEDIT global: the drawing number, everywhere in the drawing.
      await bus.script(['-ATTEDIT', 'N', 'N', TITLE_BLOCK, 'DWG_NO', '*', '1001', '1001B']);
      expect(bus.history).toContain('1 attributes selected.');
      expect(bus.command).toBeUndefined();

      // TEXTEDIT on the block's REV3_DESC definition: its prompt.
      const def = [...model.entities()].find(
        (e) => e.geom.kind === 'ATTDEF' && e.geom.tag === 'REV3_DESC',
      )!;
      await bus.submit('TEXTEDIT');
      await bus.answer({ kind: 'selection', ids: [def.id] });
      await bus.answer({
        kind: 'dialog',
        action: 'ok',
        attdef: { tag: 'REV3_DESC', prompt: 'Description of revision 3', value: '' },
      });
      await bus.submit('');
      expect(bus.command).toBeUndefined();

      const expected = {
        ...before,
        REV2_NO: 'B',
        REV2_DATE: '2026-11-09',
        REV2_DESC: 'PUMP BASE REVISED',
        REV2_BY: 'SP',
        NOTES: `${NOTES.value}\\PSEE ALSO OET-1002`,
        TITLE: 'PUMP HOUSE GA - REV B',
        DWG_NO: 'OET-1001B',
      };
      expect(values(titleBlock(model))).toEqual(expected);

      // Saved as AC1032 DXF and reopened.
      const saved = saveAc1032Dxf(readCadDocument(bytes), model);
      const back = DocumentModel.create(documentInit(readCadDocument(saved)));
      const reopened = titleBlock(back);
      expect(reopened.handle).toBe(ref.handle);
      expect(values(reopened)).toEqual(expected);
      // Every attribute keeps its handle, and the unedited ones everything else too.
      const was = new Map((ref.geom as InsertGeometry).attributes.map((a) => [a.handle, a]));
      const now = (reopened.geom as InsertGeometry).attributes;
      expect(now.map((a) => a.handle)).toEqual([...was.keys()]);
      const edited = new Set([
        'REV2_NO',
        'REV2_DATE',
        'REV2_DESC',
        'REV2_BY',
        'NOTES',
        'TITLE',
        'DWG_NO',
      ]);
      for (const a of now.filter((x) => !edited.has(x.tag))) expect(a).toEqual(was.get(a.handle));
      expect(FIELDS.length + 1).toBe(now.length);
      const defBack = [...back.entities()].find((e) => e.handle === def.handle)!;
      expect((defBack.geom as AttdefGeometry).prompt).toBe('Description of revision 3');
    });
  });
});
