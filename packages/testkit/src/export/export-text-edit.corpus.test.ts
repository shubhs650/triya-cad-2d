// Existing TEXT and MTEXT edited in Triya save and read back (M2-07 part 2). The in-place MTEXT
// editor holds contents as spans (`contentOf`) and writes them back with `writeMText`; the
// roadmap asks that the codes it has no control for (`\p`, `\W`, `\T`, `\Q`, `\A`, column
// breaks, font flags) are kept. Here:
//   - every MTEXT of every readable public corpus file, read into the editor and written back
//     unchanged, parses to the same paragraphs (properties, `\p` values, breaks) and the same
//     runs in the same character formats, so it draws as it did;
//   - on each drawing TEXTEDIT, on the PromptBus as the app drives it, edits some TEXTs and
//     MTEXTs (a word typed at the end of each), the drawing saves as AC1032 DXF (DEC-047), and
//     reopens with each edited object's contents exactly as written.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type MTextGeometry,
  type TextGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import {
  contentOf,
  mtextBase,
  parseMText,
  writeMText,
  type MTextBase,
  type MTextDocument,
  type MTextSpan,
} from '@triya/text';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Objects edited per drawing and type, to keep the gate quick. */
const PER_FILE = 8;

function baseOf(model: DocumentModel, g: MTextGeometry): MTextBase | undefined {
  const style = model.tables.textStyles.get(g.style);
  return style ? mtextBase(style, g.height) : undefined;
}

/**
 * What a parse draws: each paragraph's properties, `\p` values and end, and its runs with their
 * character formats, neighbouring text of one format joined (how the contents group runs is
 * not drawn).
 */
function drawn(doc: MTextDocument) {
  return doc.paragraphs.map((p) => {
    const items: unknown[] = [];
    for (const item of p.items) {
      const last = items.at(-1) as { type: string; text: string; style: unknown } | undefined;
      if (
        item.type === 'text' &&
        last?.type === 'text' &&
        JSON.stringify(last.style) === JSON.stringify(item.style)
      ) {
        last.text += item.text;
        continue;
      }
      items.push(JSON.parse(JSON.stringify(item)));
    }
    return { style: p.style, codes: p.codes ?? [], end: p.end, items };
  });
}

/** Contents the editor cannot hold as written: a double-byte `\M+` character (see contentOf). */
const unheld = (contents: string) => /\\M\+/.test(contents);

function reopen(bytes: Uint8Array, model: DocumentModel): Map<string, Entity> {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  return new Map(
    (documentInit(readCadDocument(saved)).entities ?? []).map((e) => [e.handle, e as Entity]),
  );
}

describe('MTEXT read into the editor and written back unchanged draws the same', () => {
  let checked = 0;

  it.each(readable.map((f) => [f.path, f] as const))('%s', (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    const differ: string[] = [];
    for (const e of model.entities()) {
      if (e.geom.kind !== 'MTEXT' || unheld(e.geom.contents)) continue;
      const base = baseOf(model, e.geom);
      if (!base) continue;
      const before = parseMText(e.geom.contents, base);
      const c = contentOf(before, base);
      const again = writeMText(c.spans, base.font, c.paragraph);
      checked++;
      if (JSON.stringify(drawn(parseMText(again, base))) !== JSON.stringify(drawn(before))) {
        differ.push(`${e.handle}: ${e.geom.contents.slice(0, 80)} → ${again.slice(0, 80)}`);
      }
    }
    expect(differ, f.path).toEqual([]);
  });

  it('checked the MTEXTs of the corpus', () => {
    expect(checked).toBeGreaterThanOrEqual(1000);
  });
});

describe('TEXT and MTEXT edited with TEXTEDIT save as DXF and read back', () => {
  let edited = 0;

  it.each(readable.map((f) => [f.path, f] as const))('%s', async (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      const texts = [...model.entities()].filter((e) => e.geom.kind === 'TEXT').slice(0, PER_FILE);
      const mtexts = [...model.entities()]
        .filter((e) => e.geom.kind === 'MTEXT' && !unheld(e.geom.contents))
        .filter((e) => baseOf(model, e.geom as MTextGeometry))
        .slice(0, PER_FILE);
      if (texts.length + mtexts.length === 0) return;

      const bus = new PromptBus({ model, registry: builtinCommands() });
      const expected = new Map<string, string>();
      await bus.submit('TEXTEDIT');
      for (const e of [...texts, ...mtexts]) {
        // TEXTEDIT takes objects on unlocked layers only; skip any it refuses.
        await bus.answer({ kind: 'selection', ids: [e.id] });
        if (bus.prompt?.kind !== 'string') continue;
        let value: string;
        if (e.geom.kind === 'TEXT') value = `${(e.geom as TextGeometry).value} (edited)`;
        else {
          const g = e.geom as MTextGeometry;
          const base = baseOf(model, g)!;
          const c = contentOf(parseMText(g.contents, base), base);
          const typed: MTextSpan = { type: 'text', text: ' (edited)', format: {} };
          value = writeMText([...c.spans, typed], base.font, c.paragraph);
        }
        await bus.answer({ kind: 'string', value, editor: true });
        expected.set(e.handle, value);
      }
      await bus.submit('');
      expect(bus.command).toBeUndefined();
      edited += expected.size;

      const back = reopen(bytes, model);
      const wrong: string[] = [];
      for (const [handle, value] of expected) {
        const g = back.get(handle)?.geom as TextGeometry | MTextGeometry | undefined;
        const got = g?.kind === 'TEXT' ? g.value : g?.kind === 'MTEXT' ? g.contents : undefined;
        if (got !== value) wrong.push(`${handle}: ${String(got)} ≠ ${value}`);
      }
      expect(wrong.slice(0, 5), f.path).toEqual([]);
    });
  });

  it('edited text in many drawings', () => {
    expect(edited).toBeGreaterThanOrEqual(300);
  });
});
