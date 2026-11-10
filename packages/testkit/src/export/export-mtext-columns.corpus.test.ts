// MTEXT columns and the editor's ruler save and read back (M2-07 part 3). On every readable
// public corpus file the MTEXT command places static columns and dynamic columns (the Columns
// option, as the command line and the editor drive it), with contents holding a column break,
// ruler values (indents and tab stops, `withRuler`) and a double-byte character. A third MTEXT's
// dynamic columns come back from the editor with manual heights, one per column, and set right
// to left (M2-26). Each drawing saves as AC1032 DXF (DEC-047) and reopens with the columns,
// their heights and flow and the contents as written.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type MTextGeometry,
  type StringPrompt,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { rulerOf, styleFont, withRuler, writeMText, type MTextSpan } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

const RULER = { indentFirst: -1, indentLeft: 2, tabs: [{ at: 6, kind: 'center' as const }] };

/** A first paragraph with the ruler, a column break, a paragraph with its own tabs. */
const SPANS: readonly MTextSpan[] = [
  { type: 'text', text: 'Item\tone', format: {} },
  {
    type: 'break',
    end: 'column',
    paragraph: withRuler(withRuler([], RULER), { ...RULER, tabs: [] }),
  },
  { type: 'text', text: 'Next ', format: {} },
  { type: 'mbcs', codepage: 932, code: 0x8140, format: {} },
];

/** The third MTEXT's columns as the editor answers them: dragged heights, reversed flow. */
const MANUAL = { heights: [30, 12.5, 20], flowReversed: true } as const;

/** Columns of each type, placed with MTEXT's Columns option. */
async function place(model: DocumentModel): Promise<void> {
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const scripts = [
    ['MTEXT', '1000000,1000100', 'C', 'S', '90', '3', '6', '40'],
    ['MTEXT', '1000000,1000300', 'C', 'D', '25', '5', '30'],
    ['MTEXT', '1000000,1000500', 'C', 'D', '25', '5', '30'],
  ];
  for (const [i, s] of scripts.entries()) {
    await bus.script(s);
    // A style with a fixed height asks the same; the editor request names the style.
    const editor = (bus.prompt as StringPrompt).editor!;
    const font = styleFont(model.tables.textStyles.get(editor.style)!);
    await bus.answer({
      kind: 'string',
      value: writeMText(SPANS, font, withRuler([], RULER)),
      editor: true,
      ...(i === 1 && { columns: { ...editor.columns!, count: 4 } }),
      ...(i === 2 && { columns: { ...editor.columns!, count: 3, ...MANUAL } }),
    });
  }
  expect(bus.command).toBeUndefined();
}

function reopen(bytes: Uint8Array, model: DocumentModel): Map<string, Entity> {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  return new Map(
    (documentInit(readCadDocument(saved)).entities ?? []).map((e) => [e.handle, e as Entity]),
  );
}

describe('MTEXT columns and ruler values save as DXF and read back', () => {
  let placed = 0;

  it.each(readable.map((f) => [f.path, f] as const))('%s', async (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      if (model.tables.textStyles.size === 0) return;
      const before = new Set([...model.entities()].map((e) => e.handle));
      await place(model);
      const made = [...model.entities()].filter((e) => !before.has(e.handle));
      expect(made.map((e) => e.type)).toEqual(['MTEXT', 'MTEXT', 'MTEXT']);
      const [st, dyn, manual] = made.map((e) => e.geom as MTextGeometry);
      expect(st).toMatchObject({ width: 26, definedHeight: 40, columns: { type: 1, count: 3 } });
      expect(dyn).toMatchObject({ width: 25, definedHeight: 30, columns: { type: 2, count: 4 } });
      expect(manual).toMatchObject({
        width: 25,
        definedHeight: 30,
        columns: { type: 2, count: 3, autoHeight: false, ...MANUAL },
      });
      placed++;

      const back = reopen(bytes, model);
      for (const e of made) {
        const g = back.get(e.handle)?.geom as MTextGeometry | undefined;
        const mine = e.geom as MTextGeometry;
        expect(g?.contents, f.path).toBe(mine.contents);
        expect(
          { width: g?.width, definedHeight: g?.definedHeight, columns: g?.columns },
          f.path,
        ).toEqual({ width: mine.width, definedHeight: mine.definedHeight, columns: mine.columns });
      }
    });
  });

  it('placed columns in most drawings', () => {
    expect(placed).toBeGreaterThanOrEqual(90);
  });

  it('writes the ruler as one paragraph value', () => {
    expect(withRuler([], RULER)).toEqual(['i-1,l2,tc6']);
    expect(rulerOf(withRuler([], RULER))).toEqual(RULER);
  });
});
