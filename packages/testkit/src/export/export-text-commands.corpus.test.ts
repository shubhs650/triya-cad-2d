// TEXT and MTEXT made in Triya save and read back (M2-07, the roadmap's acceptance: "editor
// produces MTEXT codes that round-trip through acad-ts"). On every readable public corpus file
// the real commands run on the PromptBus, as the command line and the in-place editor drive
// them: a TEXT line and an MTEXT whose contents the editor wrote from formatted spans (every
// format, stacks of each kind, a field, paragraphs). Each drawing saves as AC1032 DXF
// (DEC-047) and reopens with the new objects' contents exactly as written. One drawing also
// takes a few hundred random editor contents.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type MTextGeometry,
  type StringPrompt,
  type TextGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import {
  normalizeSpans,
  parseMText,
  spansOf,
  styleFont,
  writeMText,
  type MTextBase,
  type MTextSpan,
} from '@triya/text';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Everything the editor's toolbar can do, once. */
const EDITOR_SPANS: readonly MTextSpan[] = [
  { type: 'text', text: 'Plain {braces} \\ back^slash\ttab ', format: {} },
  { type: 'text', text: 'bold', format: { bold: true } },
  { type: 'text', text: ' italic', format: { italic: true } },
  { type: 'text', text: ' under', format: { underline: true } },
  { type: 'text', text: ' over', format: { overline: true } },
  { type: 'text', text: ' strike', format: { strike: true } },
  { type: 'break' },
  { type: 'text', text: 'Tall red ', format: { height: 7.5, color: { kind: 'aci', index: 1 } } },
  { type: 'text', text: 'teal', format: { color: { kind: 'rgb', r: 0, g: 128, b: 128 } } },
  { type: 'text', text: ' Romans', format: { font: { name: 'romans.shx', kind: 'shx' } } },
  { type: 'break' },
  { type: 'stack', upper: '1', lower: '2', kind: 'fraction', format: {} },
  { type: 'stack', upper: '3', lower: '4', kind: 'diagonal', format: { underline: true } },
  { type: 'stack', upper: '+0.1', lower: '-0.05', kind: 'tolerance', format: {} },
  { type: 'text', text: ' Ø25 ±0.1 é', format: {} },
  { type: 'break' },
  { type: 'field', code: '\\AcVar Filename \\f "%fn2"', format: {} },
];

/**
 * Places a TEXT line, then an MTEXT for each of `contents`, which the editor writes on the
 * MTEXT's style (the drawing's current one).
 */
async function place(
  model: DocumentModel,
  contents: (font: MTextBase['font']) => readonly string[],
): Promise<void> {
  const bus = new PromptBus({ model, registry: builtinCommands() });
  await bus.script(['TEXT', '1000000,1000000']);
  // A style with a fixed height does not ask it.
  if (bus.promptText.startsWith('Specify height')) await bus.submit('2.5');
  await bus.script(['0', 'Triya note %%d', '']);
  await bus.script(['MTEXT', '1000000,1000100', '1000080,1000050']);
  const editor = (bus.prompt as StringPrompt).editor!;
  await bus.cancel();
  for (const c of contents(styleFont(model.tables.textStyles.get(editor.style)!))) {
    await bus.script(['MTEXT', '1000000,1000100', '1000080,1000050']);
    await bus.answer({ kind: 'string', value: c, editor: true });
  }
  expect(bus.command).toBeUndefined();
}

/** The base format of the MTEXT's style, as the renderer and editor see it. */
function baseOf(model: DocumentModel, g: MTextGeometry): MTextBase {
  const style = model.tables.textStyles.get(g.style)!;
  return { font: styleFont(style), height: g.height, widthFactor: 1, oblique: 0 };
}

function reopen(bytes: Uint8Array, model: DocumentModel): Map<string, Entity> {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  return new Map(
    (documentInit(readCadDocument(saved)).entities ?? []).map((e) => [e.handle, e as Entity]),
  );
}

describe('TEXT and MTEXT made in Triya save as DXF and read back', () => {
  let placed = 0;

  it.each(readable.map((f) => [f.path, f] as const))('%s', async (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      if (model.tables.textStyles.size === 0) return;
      const before = new Set([...model.entities()].map((e) => e.handle));
      await place(model, (font) => [writeMText(EDITOR_SPANS, font)]);
      const made = [...model.entities()].filter((e) => !before.has(e.handle));
      expect(made.map((e) => e.type)).toEqual(['TEXT', 'MTEXT']);
      placed++;

      const back = reopen(bytes, model);
      const [text, mtext] = made.map((e) => back.get(e.handle));
      expect((text?.geom as TextGeometry | undefined)?.value, f.path).toBe('Triya note %%d');
      const g = mtext?.geom as MTextGeometry | undefined;
      const mine = made[1]!.geom as MTextGeometry;
      expect(g?.contents, f.path).toBe(mine.contents);
      const base = baseOf(model, mine);
      expect(spansOf(parseMText(g!.contents, base), base)).toEqual(
        normalizeSpans(EDITOR_SPANS, base.font),
      );
    });
  });

  it('placed text in most drawings', () => {
    expect(placed).toBeGreaterThanOrEqual(90);
  });

  it('reads back random editor contents', async () => {
    const f = readable.find((r) => r.path.endsWith('.dxf'))!;
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    const word = fc
      .string({ unit: fc.constantFrom('a', 'Z', ' ', '7', '\\', '{', '}', '^', '/', ';', 'é') })
      .filter((s) => s.length > 0);
    const spans = fc.sample(
      fc.array(
        fc.oneof(
          fc
            .tuple(word, fc.boolean(), fc.boolean(), fc.constantFrom(undefined, 1, 4))
            .map(([text, underline, bold, height]): MTextSpan => ({
              type: 'text',
              text,
              format: { underline, bold, ...(height !== undefined && { height }) },
            })),
          fc.constant<MTextSpan>({ type: 'break' }),
          fc
            .tuple(word, word, fc.constantFrom('fraction', 'diagonal', 'tolerance' as const))
            .map(([upper, lower, kind]): MTextSpan => ({
              type: 'stack',
              upper: upper.trimStart() || 'u',
              lower: lower.trimStart() || 'l',
              kind,
              format: {},
            })),
        ),
        { minLength: 1, maxLength: 8 },
      ),
      { numRuns: 200, seed: 2007 },
    );
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      let contents: string[] = [];
      const before = new Set([...model.entities()].map((e) => e.handle));
      await place(model, (font) => {
        contents = spans.map((s) => writeMText(s, font)).filter((c) => c !== '');
        return contents;
      });
      const made = [...model.entities()].filter((e) => !before.has(e.handle) && e.type === 'MTEXT');
      expect(made).toHaveLength(contents.length);
      const back = reopen(bytes, model);
      const wrong = made.filter(
        (e) =>
          (back.get(e.handle)?.geom as MTextGeometry | undefined)?.contents !==
          (e.geom as MTextGeometry).contents,
      );
      expect(wrong.map((e) => (e.geom as MTextGeometry).contents).slice(0, 5)).toEqual([]);
    });
  });
});
