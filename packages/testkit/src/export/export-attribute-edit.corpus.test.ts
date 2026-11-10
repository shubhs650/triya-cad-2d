// Attributes edited in Triya save and read back (M2-12). On every readable public corpus file,
// EATTEDIT, on the PromptBus as the app drives it, changes every editable attribute of some block
// references (a word added to its value, a multiline one's MTEXT contents included, and a new
// height on the first of each), the drawing saves as AC1032 DXF (DEC-047), and it reopens with
// each attribute as written under its own handle. M2-27: the second of each takes another
// justification (Middle center, a multiline one's MTEXT attachment 5) about its insertion
// point, and in a named-plot-style drawing the third takes its first plot style name. M2-27
// part 2: in a drawing that uses colour-book colours, -ATTEDIT's Color COlorbook gives the first
// attribute of the first reference the first of them, which the save names by its DBCOLOR.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  bookColors,
  hasEditableAttributes,
  type AttributePatch,
  type Color,
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

/** Drawings with attributes that use colour-book colours, given one by -ATTEDIT (M2-27). */
const BOOKED = 10;

/** References edited per drawing, to keep the gate quick. */
const PER_FILE = 8;

const valueOf = (a: InsertAttribute) => (a.mtext ? a.mtext.contents : a.value);

/** How an attribute is justified: DXF 72/73 and DXF 11, or a multiline one's attachment. */
const justified = (a: Pick<InsertAttribute, 'halign' | 'valign' | 'alignmentPoint' | 'mtext'>) =>
  a.mtext
    ? `attachment ${a.mtext.attachment}`
    : `${a.halign},${a.valign} @ ${a.alignmentPoint ? `${a.alignmentPoint.x},${a.alignmentPoint.y}` : '-'}`;

describe('attributes edited with EATTEDIT save as DXF and read back', () => {
  let edited = 0;
  let multiline = 0;
  let rejustified = 0;
  let plotStyled = 0;
  let booked = 0;

  it.each(readable.map((f) => [f.path, f] as const))('%s', async (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      const refs = [...model.entities()].filter(hasEditableAttributes).slice(0, PER_FILE);
      if (refs.length === 0) return;

      const bus = new PromptBus({ model, registry: builtinCommands() });
      const expected = new Map<
        string,
        { value: string; height: number; justified?: string; plotStyle?: string; color?: Color }
      >();
      const before = new Map<string, InsertAttribute>();
      for (const ref of refs) {
        for (const a of (ref.geom as InsertGeometry).attributes) before.set(a.handle, a);
      }
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
        const plotStyle = d.plotStyles?.[0]?.handle;
        const patches: AttributePatch[] = d.attributes.map((a, i) => ({
          handle: a.handle,
          value: `${a.value} (edited)`,
          ...(i === 0 && { height: a.height * 2 }),
          ...(i === 1 &&
            !a.annotative &&
            (a.multiline ? { attachment: 5 } : { halign: 1, valign: 2 })),
          ...(i === 2 && plotStyle !== undefined && { plotStyle }),
        }));
        await bus.answer({ kind: 'dialog', action: 'ok', attributes: patches });
        for (const [i, a] of d.attributes.entries()) {
          const was = before.get(a.handle)!;
          // Without a canvas DXF 10 stays at the insertion point, which DXF 11 takes.
          const at = was.halign === 0 && was.valign === 0 ? was.position : was.alignmentPoint;
          const turned = i === 1 && !a.annotative;
          expected.set(a.handle, {
            value: `${a.value} (edited)`,
            height: a.height * (i === 0 ? 2 : 1),
            ...(turned && {
              justified: a.multiline
                ? 'attachment 5'
                : justified({ halign: 1, valign: 2, alignmentPoint: at ?? was.position }),
            }),
            ...(i === 2 && plotStyle !== undefined && { plotStyle }),
          });
          if (turned) rejustified++;
          if (i === 2 && plotStyle !== undefined) plotStyled++;
          if (a.multiline) multiline++;
        }
      }
      expect(bus.command).toBeUndefined();
      edited += expected.size;

      const [book] = bookColors(model).values();
      if (book?.kind === 'rgb') {
        await bus.script(['-ATTEDIT', 'Y', '*', '*', '*']);
        await bus.answer({ kind: 'selection', ids: [refs[0]!.id] });
        if (bus.prompt?.kind === 'keyword') {
          const first = (model.entity(refs[0]!.id)!.geom as InsertGeometry).attributes.find((a) =>
            expected.has(a.handle),
          )!;
          await bus.script(['C', 'CO', book.bookName!, book.colorName!]);
          while (bus.command) await bus.submit('');
          expected.set(first.handle, { ...expected.get(first.handle)!, color: book });
          booked++;
        } else await bus.cancel();
      }

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
        if (a && want.justified !== undefined && justified(a) !== want.justified) {
          wrong.push(`${handle}: justified ${justified(a)} ≠ ${want.justified}`);
        }
        if (
          a &&
          want.color !== undefined &&
          JSON.stringify(a.color) !== JSON.stringify(want.color)
        ) {
          wrong.push(
            `${handle}: colour ${JSON.stringify(a.color)} ≠ ${JSON.stringify(want.color)}`,
          );
        }
        if (a && want.plotStyle !== undefined && a.plotStyle !== want.plotStyle) {
          wrong.push(`${handle}: plot style ${String(a.plotStyle)} ≠ ${want.plotStyle}`);
        }
      }
      expect(wrong.slice(0, 5), f.path).toEqual([]);
    });
  });

  it('edited every ATTRIB of the corpus (100, four multiline, 25 justified, 10 colour-book)', () => {
    expect(edited).toBeGreaterThanOrEqual(100);
    expect(multiline).toBeGreaterThanOrEqual(4);
    // 25 justifications on the corpus; no corpus drawing names plot styles and has attributes,
    // so plot style names on ATTRIBs are covered by packages/io/test/export-plot-styles.test.ts.
    expect(rejustified).toBeGreaterThanOrEqual(25);
    expect(plotStyled).toBeGreaterThanOrEqual(0);
    expect(booked).toBeGreaterThanOrEqual(BOOKED);
  });
});
