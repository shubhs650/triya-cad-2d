// Attributes edited in Triya save and read back (M2-12). On every readable public corpus file,
// EATTEDIT, on the PromptBus as the app drives it, changes every editable attribute of some block
// references (a word added to its value, a multiline one's MTEXT contents included, and a new
// height on the first of each), the drawing saves as AC1032 DXF (DEC-047), and it reopens with
// each attribute as written under its own handle.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  hasEditableAttributes,
  type AttributePatch,
  type DialogPrompt,
  type InsertAttribute,
  type InsertGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** References edited per drawing, to keep the gate quick. */
const PER_FILE = 8;

const valueOf = (a: InsertAttribute) => (a.mtext ? a.mtext.contents : a.value);

describe('attributes edited with EATTEDIT save as DXF and read back', () => {
  let edited = 0;
  let multiline = 0;

  it.each(readable.map((f) => [f.path, f] as const))('%s', async (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      const refs = [...model.entities()].filter(hasEditableAttributes).slice(0, PER_FILE);
      if (refs.length === 0) return;

      const bus = new PromptBus({ model, registry: builtinCommands() });
      const expected = new Map<string, { value: string; height: number }>();
      for (const ref of refs) {
        await bus.submit('EATTEDIT');
        await bus.answer({ kind: 'selection', ids: [ref.id] });
        // EATTEDIT takes references on unlocked layers only; skip any it refuses.
        if (bus.prompt?.kind !== 'dialog') {
          await bus.cancel();
          continue;
        }
        const d = (bus.prompt as DialogPrompt).dialog;
        if (d.type !== 'eattedit') throw new Error('not the Enhanced Attribute Editor');
        const patches: AttributePatch[] = d.attributes.map((a, i) => ({
          handle: a.handle,
          value: `${a.value} (edited)`,
          ...(i === 0 && { height: a.height * 2 }),
        }));
        await bus.answer({ kind: 'dialog', action: 'ok', attributes: patches });
        for (const [i, a] of d.attributes.entries()) {
          expected.set(a.handle, {
            value: `${a.value} (edited)`,
            height: a.height * (i === 0 ? 2 : 1),
          });
          if (a.multiline) multiline++;
        }
      }
      expect(bus.command).toBeUndefined();
      edited += expected.size;

      const saved = saveAc1032Dxf(readCadDocument(bytes), model);
      const back = DocumentModel.create(documentInit(readCadDocument(saved)));
      const got = new Map<string, InsertAttribute>();
      for (const e of back.entities()) {
        if (e.geom.kind !== 'INSERT') continue;
        for (const a of (e.geom as InsertGeometry).attributes) got.set(a.handle, a);
      }
      const wrong: string[] = [];
      for (const [handle, want] of expected) {
        const a = got.get(handle);
        const value = a && valueOf(a);
        if (value !== want.value || Math.abs((a?.height ?? 0) - want.height) > 1e-9) {
          wrong.push(`${handle}: ${String(value)} @ ${a?.height} ≠ ${want.value} @ ${want.height}`);
        }
      }
      expect(wrong.slice(0, 5), f.path).toEqual([]);
    });
  });

  it('edited every ATTRIB of the corpus (100, four multiline)', () => {
    expect(edited).toBeGreaterThanOrEqual(100);
    expect(multiline).toBeGreaterThanOrEqual(4);
  });
});
