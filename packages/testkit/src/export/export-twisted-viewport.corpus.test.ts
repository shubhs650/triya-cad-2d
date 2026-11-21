// Twisted layout viewports (M6-02 part 15) saved, on every readable public corpus file from
// R2000 on: each floating viewport one can work in whose display is not locked is twisted 30°
// about the model point at its frame's middle (DXF 51; the view centre, DXF 12, is in the twisted
// display coordinates, so it changes too), then zoomed in and panned along the screen as ZOOM and
// PAN in it do now that a twisted viewport can be made current (the session's `viewport-view`
// edit), and the drawing saved as AC1032 DXF (DEC-047) and read again. Every viewport reads back
// as the engine has it: the twist, view centre and view height changed, the rest as the file had
// it. The corpus holds no twisted viewport of its own, so this is what exercises 51 on save.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  floatingViewports,
  paperPointOf,
  viewportLocked,
  viewportViewOf,
  withViewportView,
  type Entity,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const TWIST = Math.PI / 6;

/** Every viewport of the drawing, as a save keeps it: without the model's id and its source. */
const viewports = (model: DocumentModel) =>
  [...model.layouts]
    .flatMap((l) => model.blockEntities(l.blockRecord).map((id) => model.entity(id)!))
    .filter((e) => e.geom.kind === 'VIEWPORT')
    .map(({ id: _id, raw: _raw, ...rest }: Entity) => JSON.parse(JSON.stringify(rest)) as unknown);

let twisted = 0;
let files = 0;

describe('twisted layout viewports saved on the public corpus', () => {
  eachCorpusFile(
    readableFiles(manifest).filter((f) => f.version >= 'AC1015'),
    (f) => {
      const path = f.path;
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
      withPinnedClock(() => {
        const s = new EngineSession(documentInit(readCadDocument(bytes)));
        const model = s.model;
        const b = new ChangeSetBuilder(model);
        const handles: string[] = [];
        for (const layout of model.layouts) {
          for (const vp of floatingViewports(model, layout.blockRecord)) {
            if (viewportLocked(vp.geom)) continue;
            const turned = withViewportView({ ...vp.geom, twist: TWIST }, viewportViewOf(vp.geom));
            b.updateEntity(vp.id, { geom: turned });
            handles.push(vp.handle);
          }
        }
        if (handles.length === 0) return;
        model.apply(b.build());
        for (const h of handles) {
          const g = model.entityByHandle(h)!.geom;
          if (g.kind !== 'VIEWPORT') throw new Error(`${path}: ${h} is not a viewport`);
          const v = viewportViewOf(g);
          // The frame's middle still shows the model point it showed.
          const mid = paperPointOf(g, v.center);
          expect(mid.x, `${path}: ${h}`).toBeCloseTo(g.center.x, 6);
          // A pan to the right on the screen moves the view along the turned X axis.
          const right = { x: Math.cos(TWIST), y: -Math.sin(TWIST) };
          const zoom = s.edit({
            kind: 'viewport-view',
            viewport: h,
            view: { center: v.center, height: v.height / 2 },
            label: 'ZOOM',
          });
          const pan = s.edit({
            kind: 'viewport-view',
            viewport: h,
            view: {
              center: {
                x: v.center.x + (right.x * v.height) / 4,
                y: v.center.y + (right.y * v.height) / 4,
              },
              height: v.height / 2,
            },
            label: 'PAN',
          });
          expect([zoom.ok, pan.ok], `${path}: ${h}`).toEqual([true, true]);
        }
        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        expect(viewports(back), path).toEqual(viewports(model));
        for (const h of handles) {
          const g = back.entityByHandle(h)!.geom;
          expect(g.kind === 'VIEWPORT' && g.twist, `${path}: ${h}`).toBeCloseTo(TWIST, 12);
        }
        twisted += handles.length;
        files++;
      });
    },
    () => {
      // As export-viewport-view's: 100 viewports in 30 drawings at the time of writing.
      expect(twisted).toBeGreaterThanOrEqual(100);
      expect(files).toBeGreaterThanOrEqual(30);
    },
  );
});
