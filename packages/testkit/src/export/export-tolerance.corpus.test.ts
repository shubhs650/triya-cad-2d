// A feature control frame made with TOLERANCE's Geometric Tolerance dialog saves and reads back
// (M4-11). On every readable public corpus file with a dimension style the real command runs on
// the PromptBus, answered as the dialog answers it: two rows with symbols, diameters, material
// conditions and datums, a projected tolerance zone and a datum identifier. Each drawing saves
// as AC1032 DXF (DEC-047) and reopens with the frame's text, style, position and direction as
// made, and the dialog reads the same fields back from it. The frame then draws with the
// bundled fonts: one compartment per field filled, its GD&T symbols in the GD&T font.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  annotationParts,
  builtinCommands,
  toleranceFrame,
  type Entity,
  type GdtFrame,
  type ToleranceGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { textMeasure } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { bundledFontBook } from '../render/bundled-fonts.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const NONE = { diameter: false, value: '', material: '' } as const;

/** Every field the dialog has, filled. */
const FRAME: GdtFrame = {
  rows: [
    {
      symbol: 'j',
      tolerance1: { diameter: true, value: '0.1', material: 'm' },
      tolerance2: { diameter: false, value: '0.05', material: 'l' },
      datum1: { value: 'A', material: '' },
      datum2: { value: 'B', material: 'm' },
      datum3: { value: 'C', material: 's' },
    },
    {
      symbol: 'c',
      tolerance1: { ...NONE, value: '0.02' },
      tolerance2: NONE,
      datum1: { value: '', material: '' },
      datum2: { value: '', material: '' },
      datum3: { value: '', material: '' },
    },
  ],
  height: '12',
  projectedZone: true,
  datumIdentifier: 'D',
};

function reopen(bytes: Uint8Array, model: DocumentModel): Map<string, Entity> {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  return new Map(
    (documentInit(readCadDocument(saved)).entities ?? []).map((e) => [e.handle, e as Entity]),
  );
}

describe('a feature control frame made with TOLERANCE saves as DXF and reads back', () => {
  let placed = 0;
  const fonts = bundledFontBook();

  it.each(readable.map((f) => [f.path, f] as const))('%s', async (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      if (model.tables.dimStyles.size === 0) return;
      const before = new Set([...model.entities()].map((e) => e.handle));
      const bus = new PromptBus({ model, registry: builtinCommands() });
      await bus.submit('TOLERANCE');
      await bus.answer({ kind: 'dialog', action: 'ok', tolerance: FRAME });
      await bus.submit('1000000,1000000');
      expect(bus.command).toBeUndefined();
      const made = [...model.entities()].filter((e) => !before.has(e.handle));
      expect(made.map((e) => e.type)).toEqual(['TOLERANCE']);
      placed++;
      const mine = made[0]!.geom as ToleranceGeometry;

      const back = reopen(bytes, model).get(made[0]!.handle);
      const g = back?.geom as ToleranceGeometry | undefined;
      expect(g, f.path).toEqual(mine);
      expect(toleranceFrame(g!.text)).toEqual(FRAME);

      // Drawn: symbol, two tolerances and three datums in row 1, symbol and tolerance in row 2,
      // the zone and the identifier, each a frame and its text.
      const measure = textMeasure({ fonts, style: (h) => model.tables.textStyles.get(h) });
      const parts = annotationParts(g!, model, back?.xdata, measure);
      expect(
        parts?.filter((p) => p.geom.kind === 'LWPOLYLINE'),
        f.path,
      ).toHaveLength(10);
    });
  });

  it('placed a frame in most drawings', () => {
    expect(placed).toBeGreaterThanOrEqual(90);
  });
});
