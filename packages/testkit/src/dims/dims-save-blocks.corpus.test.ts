// A dimension without a block gets one when saved (M2-30 part 2), over the public corpus: in
// every file, the dimensions whose `*D` block is missing (drawn from the engine on
// screen since M2-10) are given one by `blocklessDimensionBlocks`, with the real dimension
// engine and the renderer's text measuring over the bundled fonts, as the app's save does. The
// AC1032 DXF save (DEC-047) reads back with each of them pointing at a block that holds what
// the engine draws (the health check passes), and the drawing the change was built on is left
// as it was (the screen keeps drawing them from the engine).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dimensionHealth, regenerateDimension } from '@triya/dims';
import {
  DocumentModel,
  PromptBus,
  applyToReplica,
  builtinCommands,
  type Color,
  type DimensionGeometry,
  type Entity,
  type ViewReply,
} from '@triya/engine';
import { aciOfTrueColor, documentInit, readCadDocument } from '@triya/io';
import { textMeasure } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { bundledFontBook } from '../render/bundled-fonts.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
// Every corpus file, the malformed ezdxf recover inputs too when acad-ts reads them.
const files = manifest.files;
const PER_FILE_BUDGET_MS = 30_000;

/** As the health gate: a DXF DIMSTYLE's ACI stands for its block's true colour. */
const colors = (g: Color, s: Color): boolean =>
  g.kind === 'aci' && s.kind === 'rgb' && aciOfTrueColor(s.r, s.g, s.b) === g.index;

const blockless = (model: DocumentModel) =>
  [...model.entities()].filter((e: Entity) => {
    if (!('dimType' in e.geom)) return false;
    const block = (e.geom as DimensionGeometry).block;
    return block === undefined || !model.hasBlock(block);
  });

const given: string[] = [];
const unreadable: string[] = [];

describe('dimensions without a block saved with one (M2-30 part 2)', () => {
  it.each(files.map((f) => [f.path, f] as const))(
    '%s saves its blockless dimensions with the blocks the engine draws',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const read = () =>
        withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));
      let model: DocumentModel;
      try {
        model = read();
      } catch (err) {
        expect(f.tags, `${f.path}: ${String(err)}`).toContain('malformed');
        unreadable.push(f.path);
        return;
      }
      const missing = blockless(model);
      if (missing.length === 0) return;
      const fonts = bundledFontBook();
      const measure = textMeasure({ fonts, style: (h) => model.tables.textStyles.get(h) });
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: {
          request: (r): Promise<ViewReply> =>
            Promise.resolve(
              r.op === 'textWidths'
                ? { ok: true, widths: r.texts.map((t) => measure(t) ?? null) }
                : { ok: false, message: 'no view' },
            ),
        },
        dimensions: regenerateDimension,
      });
      const change = await bus.blocklessDimensionBlocks();
      expect(change, f.path).toBeDefined();
      // The drawing keeps them without a block.
      expect(blockless(model).map((e) => e.handle)).toEqual(missing.map((e) => e.handle));

      // The save: the change on the drawing as opened, as the app's save applies its log.
      const saving = read();
      applyToReplica(saving, change!);
      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), saving));
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      const again = textMeasure({ fonts, style: (h) => back.tables.textStyles.get(h) });
      for (const e of missing) {
        const r = back.entityByHandle(e.handle);
        expect(r, `${f.path} ${e.handle}`).toBeDefined();
        const block = (r!.geom as DimensionGeometry).block;
        expect(block !== undefined && back.hasBlock(block), `${f.path} ${e.handle}`).toBe(true);
        expect(back.blockEntities(block!).length, `${f.path} ${e.handle}`).toBeGreaterThan(0);
        // A kind the engine does not draw (ordinate in an R12 file…) keeps no block: none here.
        const health = dimensionHealth(r!, back, again, colors);
        expect(health?.problems ?? ['no health'], `${f.path} ${e.handle}`).toEqual([]);
        given.push(`${f.path} ${e.handle}`);
      }
    },
    PER_FILE_BUDGET_MS,
  );

  it('gave blocks to the corpus dimensions that had none', () => {
    // Filled in by the cases above (vitest runs a file's tests in order).
    // The seven blockless dimensions of ezdxf's duplicate_handles.dxf (R13), the only corpus
    // file with any; a corpus file added with some raises it.
    expect(given).toHaveLength(7);
    expect(new Set(given.map((g) => g.split(' ')[0]))).toEqual(
      new Set(['public/third-party/ezdxf/integration_tests/duplicate_handles.dxf']),
    );
    expect(unreadable).toEqual(['public/third-party/ezdxf/integration_tests/recover02.dxf']);
  });
});
