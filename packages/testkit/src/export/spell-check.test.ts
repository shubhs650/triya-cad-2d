// SPELL's Change All (M4-09 part 4) with the bundled dictionary, saved and read back. The
// title-block drawing (attributes/fixture.ts, authored here per DEC-047) with a TEXT and a
// formatted MTEXT added in model space, "NOTES" misspelled in both: Check Spelling finds the
// word with the en_US dictionary, suggests the right spelling, and Change All corrects it with
// the MTEXT's formatting kept. The drawing saves as AC1032 DXF and reopens corrected.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MText, TextEntity, XYZ } from '@node-projects/acad-ts';
import {
  DEFAULT_SPELL_SETTINGS,
  DocumentModel,
  PromptBus,
  SPELL_COMPLETE,
  builtinCommands,
  type DialogRequest,
  type SpellAction,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument, writeCadDocument } from '@triya/io';
import { hunspellChecker } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { titleBlockDxf } from '../attributes/fixture.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const asset = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../assets/dictionaries/en-US/${name}`, import.meta.url)),
    'utf8',
  );

function authored(): Uint8Array {
  const doc = readCadDocument(titleBlockDxf());
  const t = new TextEntity();
  t.value = 'GENERAL NOTSE';
  t.insertPoint = new XYZ(20, 250, 0);
  t.height = 5;
  const m = new MText();
  m.insertPoint = new XYZ(20, 230, 0);
  m.height = 3.5;
  m.rectangleWidth = 100;
  m.value = '{\\fArial|b1;SITE} NOTSE\\PSEE NOTSE %%c25';
  doc.entities!.add(t);
  doc.entities!.add(m);
  return writeCadDocument(doc, { format: 'dxf' });
}

function texts(model: DocumentModel): string[] {
  const out: string[] = [];
  for (const e of model.entities()) {
    const g = e.geom;
    if (g.kind === 'TEXT') out.push(g.value);
    if (g.kind === 'MTEXT') out.push(g.contents);
  }
  return out.sort();
}

const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

describe('SPELL Change All saves as DXF and reads back', () => {
  it('corrects every instance of the word, with its formatting', async () => {
    const bytes = authored();
    const model = modelOf(bytes);
    const space = [...model.blocks.values()].find((b) => /^\*model_space$/i.test(b.name))!.handle;
    const checker = hunspellChecker({
      name: 'American English',
      aff: asset('en_US.aff'),
      dic: asset('en_US.dic'),
    });
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: (): Promise<ViewReply> => Promise.resolve({ ok: true }) },
      space: () => space,
      spelling: () => Promise.resolve(checker),
    });
    const dialog = () => {
      const p = bus.prompt;
      return p?.kind === 'dialog'
        ? (p.dialog as Extract<DialogRequest, { type: 'spell' }>)
        : undefined;
    };
    const press = (action: SpellAction) =>
      bus.answer({
        kind: 'dialog',
        action: 'apply',
        spell: { settings: DEFAULT_SPELL_SETTINGS, custom: [], action },
      });
    const before = texts(model);
    await bus.submit('SPELL');
    await press({ op: 'start' });
    const found: string[] = [];
    for (let n = 0; n < 100 && dialog()?.word; n++) {
      const w = dialog()!.word!;
      found.push(w.word);
      if (w.word === 'NOTSE') {
        expect(w.suggestions).toContain('NOTES');
        await press({ op: 'changeAll', to: 'NOTES' });
      } else await press({ op: 'ignore' });
    }
    expect(dialog()?.note).toBe(SPELL_COMPLETE);
    // Found once: Change All corrected the others.
    expect(found.filter((w) => w === 'NOTSE')).toHaveLength(1);
    await bus.answer({ kind: 'dialog', action: 'ok' });
    expect(bus.command).toBeUndefined();

    const after = texts(model);
    expect(after).toContain('GENERAL NOTES');
    expect(after).toContain('{\\fArial|b1;SITE} NOTES\\PSEE NOTES %%c25');
    expect(after.filter((t) => !before.includes(t))).toHaveLength(2);

    const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    expect(texts(modelOf(saved))).toEqual(after);
  });
});
