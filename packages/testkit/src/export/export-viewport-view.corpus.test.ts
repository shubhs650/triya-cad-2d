// A layout viewport's own view zoomed and panned (M6-02 part 4) saved, on every readable public
// corpus file from R2000 on: each floating viewport one can work in (MSPACE's, `floatingViewports`)
// and whose display is not locked is zoomed in twice and panned by a quarter of its view height,
// as ZOOM and PAN in it do (the session's `viewport-view` edit), and the drawing saved as AC1032
// DXF (DEC-047) and read again. Every viewport reads back as the engine has it: the view centre
// (DXF 12) and view height (45) changed, the rest as the file had it. ACadSharp's AC1032 sample
// (AutoCAD's own viewports) is also saved for the ezdxf audit (audit.py `FIXTURE_SAVES`,
// `viewport-view`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  EngineSession,
  floatingViewports,
  viewportLocked,
  viewportViewOf,
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
const AUDITED = 'public/third-party/acadsharp/sample_AC1032_ascii.dxf';

/** Every viewport of the drawing, as a save keeps it: without the model's id and its source. */
const viewports = (model: DocumentModel) =>
  [...model.layouts]
    .flatMap((l) => model.blockEntities(l.blockRecord).map((id) => model.entity(id)!))
    .filter((e) => e.geom.kind === 'VIEWPORT')
    .map(({ id: _id, raw: _raw, ...rest }: Entity) => JSON.parse(JSON.stringify(rest)) as unknown);

let zoomed = 0;
let files = 0;

describe("layout viewports' own views saved on the public corpus", () => {
  eachCorpusFile(
    readableFiles(manifest).filter((f) => f.version >= 'AC1015'),
    (f) => {
      const path = f.path;
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
      withPinnedClock(() => {
        const s = new EngineSession(documentInit(readCadDocument(bytes)));
        const model = s.model;
        let here = 0;
        for (const layout of model.layouts) {
          for (const vp of floatingViewports(model, layout.blockRecord)) {
            if (viewportLocked(vp.geom)) continue;
            const v = viewportViewOf(vp.geom);
            const zoom = s.edit({
              kind: 'viewport-view',
              viewport: vp.handle,
              view: { center: v.center, height: v.height / 2 },
              label: 'ZOOM',
            });
            const pan = s.edit({
              kind: 'viewport-view',
              viewport: vp.handle,
              view: {
                center: { x: v.center.x + v.height / 4, y: v.center.y },
                height: v.height / 2,
              },
              label: 'PAN',
            });
            expect([zoom.ok, pan.ok], `${path}: ${vp.handle}`).toEqual([true, true]);
            here++;
          }
        }
        if (here === 0) return;
        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        if (path === AUDITED) writeAuditSave(path.replace(/^public\//, ''), 'viewport-view', save);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        expect(viewports(back), path).toEqual(viewports(model));
        zoomed += here;
        files++;
      });
    },
    () => {
      // At the time of writing: 100 viewports in 30 drawings.
      expect(zoomed).toBeGreaterThanOrEqual(100);
      expect(files).toBeGreaterThanOrEqual(30);
    },
  );
});
