// ULAYERS (M2-56 part 1) saves what it turned off: the PDF underlay test drawing with layers
// (fixture.ts `underlayLayersDxf`: one plain underlay, one turning Walls off) has its first
// underlay turn Notes and Draft off and its second turn every layer back on, saves as AC1032
// DXF (DEC-047) and reads back with the same layers off. The reopened drawing differs from the
// original only in those two underlays' AdeskUnderlayLayerOverrideData xdata.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  UNDERLAY_LAYERS_APP,
  setUnderlayLayersOff,
  underlayReferences,
  type UnderlayGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { LAYERS_DXF_NAME } from './fixture';

const DXF = fileURLToPath(new URL(`../../fixtures/underlay/${LAYERS_DXF_NAME}`, import.meta.url));

const layersOff = (model: DocumentModel) =>
  [...model.entities()]
    .filter((e) => e.geom.kind === 'PDFUNDERLAY')
    .map((e) => (e.geom as UnderlayGeometry).layersOff ?? []);

describe('ULAYERS saves the layers each underlay turns off', () => {
  it('writes them as AdeskUnderlayLayerOverrideData xdata a reopened drawing reads', async () => {
    const bytes = new Uint8Array(readFileSync(DXF));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      expect(layersOff(model)).toEqual([[], ['Walls']]);
      const [plain, walls] = underlayReferences(model);
      const b = new ChangeSetBuilder(model);
      expect(setUnderlayLayersOff(b, model, plain!.id, ['Notes', 'Draft'])).toBe(true);
      expect(setUnderlayLayersOff(b, model, walls!.id, [])).toBe(true);
      model.apply(b.build());

      const saved = saveAc1032Dxf(readCadDocument(bytes), model);
      const reopened = readCadDocument(saved);
      const again = DocumentModel.create(documentInit(reopened));
      expect(layersOff(again)).toEqual([['Notes', 'Draft'], []]);
      const text = new TextDecoder().decode(saved);
      // One registration of the application, its strings on the first underlay alone.
      expect(text.match(new RegExp(`^${UNDERLAY_LAYERS_APP}\\r?$`, 'gim'))).toHaveLength(2);
      expect(text).toMatch(/1000\r?\nNotes\r?\n *1000\r?\nDraft\r?\n/);
      expect(text).not.toMatch(/1000\r?\nWalls\r?\n/);

      // Turned back as they were, the drawing saves as it was read.
      const back = new ChangeSetBuilder(again);
      const [one, two] = underlayReferences(again);
      setUnderlayLayersOff(back, again, one!.id, []);
      setUnderlayLayersOff(back, again, two!.id, ['Walls']);
      again.apply(back.build());
      const restored = DocumentModel.create(
        documentInit(readCadDocument(saveAc1032Dxf(reopened, again))),
      );
      expect(layersOff(restored)).toEqual([[], ['Walls']]);
    });
  });
});
