// VPLAYER saved (M6-02 part 5), on every readable public corpus file from R2000 on with a layout
// viewport: every layer given a colour and a lineweight override in every floating viewport
// (VPLAYER Color and LWeight, All), the first layer a transparency override and frozen in them, its
// viewport visibility default made Frozen, and a new layer made by Newfrz, then the drawing saved
// as AC1032 DXF (DEC-047) and read again. The layers (their overrides, the ADSK_XREC_LAYER_*_OVR
// XRECORDs, and DXF 70) and the viewports' frozen layers (341) read back as the engine has them.
// ACadSharp's AC1032 sample, ezdxf's text_in_viewports.dxf and the self-authored
// viewport-overrides.dxf (overrides of its own, rewritten) are saved for the ezdxf audit
// (audit.py `FIXTURE_SAVES`, `vplayer`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  layoutViewports,
  modelSpaceOf,
  type Entity,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const AUDITED = new Set([
  'public/third-party/acadsharp/sample_AC1032_ascii.dxf',
  'public/third-party/ezdxf/examples_dxf/text_in_viewports.dxf',
  'public/self-authored/viewport-overrides.dxf',
]);

/** The layers as a save keeps them, by name: overrides and flags. */
const layers = (model: DocumentModel) =>
  [...model.tables.layers.values()]
    .map((l) => ({
      name: l.name,
      flags: l.flags ?? 0,
      overrides: JSON.parse(JSON.stringify(l.viewportOverrides ?? [])) as unknown,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
/** Every floating viewport's frozen layers, by handle. */
const frozen = (model: DocumentModel) =>
  layoutViewports(model).map((e: Entity) => [
    e.handle,
    e.geom.kind === 'VIEWPORT' ? [...e.geom.frozenLayers].sort() : [],
  ]);

let viewports = 0;
let files = 0;

describe('VPLAYER saved on the public corpus', () => {
  eachCorpusFile(
    readableFiles(manifest).filter((f) => f.version >= 'AC1015'),
    async (f) => {
      const path = f.path;
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      const here = layoutViewports(model).length;
      if (here === 0) return;
      const first = [...model.tables.layers.values()].find((l) => !l.name.includes('|'))!.name;
      const space = modelSpaceOf(model);
      const bus = new PromptBus({ model, registry: builtinCommands(), space: () => space });
      await bus.script(['VPLAYER', 'C', '1', '*', '', 'LW', '0.3', '*', '']);
      await bus.script(['TR', '40', first, '', 'F', first, '', 'V', first, 'F']);
      await bus.script(['N', 'TRIYA_VPLAYER_NEW', '', '']);
      expect(bus.command, path).toBeUndefined();
      withPinnedClock(() => {
        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        if (AUDITED.has(path)) writeAuditSave(path.replace(/^public\//, ''), 'vplayer', save);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        expect(layers(back), path).toEqual(layers(model));
        expect(frozen(back), path).toEqual(frozen(model));
      });
      viewports += here;
      files++;
    },
    () => {
      // At the time of writing: 101 viewports in 30 drawings.
      expect(viewports).toBeGreaterThanOrEqual(100);
      expect(files).toBeGreaterThanOrEqual(25);
    },
  );
});
