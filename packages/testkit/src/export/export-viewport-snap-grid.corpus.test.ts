// Each layout viewport's own snap and grid settings (M6-02 part 17) read and saved, on every
// readable public corpus file from R2000 on. AutoCAD writes them on every VIEWPORT (DXF 13 snap
// base, 14 snap spacing, 15 grid spacing, 50 snap angle, 61 major lines, GRIDDISPLAY in the 90
// bits 262144–2097152), so each is read; then every viewport of every layout, paper space's own
// (id 1) too, is given other settings as SNAP, GRID and SETVAR set them through it, the drawing
// saved as AC1032 DXF (DEC-047) and read again: every viewport reads back as the engine has it.
// M6-02 part 19 adds SNAPMODE, GRIDMODE and UCSICON, the VIEWPORT 90 bits 256, 512, 32 and 64,
// and the model-space `*Active` VPORT's DXF 75, 76 and 74, turned and saved the same way.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  currentVport,
  viewportSnapGrid,
  withViewportSnapGrid,
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

/** Every viewport of the drawing, as a save keeps it: without the model's id and its source. */
const viewports = (model: DocumentModel) =>
  [...model.layouts]
    .flatMap((l) => model.blockEntities(l.blockRecord).map((id) => model.entity(id)!))
    .filter((e) => e.geom.kind === 'VIEWPORT')
    .map(({ id: _id, raw: _raw, ...rest }: Entity) => JSON.parse(JSON.stringify(rest)) as unknown);

const SETTINGS = {
  snapBase: { x: 1.5, y: -2 },
  snapSpacing: { x: 2.5, y: 5 },
  gridSpacing: { x: 0, y: 7.5 },
  snapRotation: Math.PI / 12,
  gridMajor: 4,
  // Adaptive with subdivision, within the limits.
  gridFlags: 6,
  // Snap and grid on, the UCS icon off but at the origin (M6-02 part 19).
  snapOn: true,
  gridOn: true,
  ucsIcon: 2,
};

let read = 0;
let edited = 0;
let files = 0;

describe('layout viewports’ own snap and grid settings saved on the public corpus', () => {
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
          for (const id of model.blockEntities(layout.blockRecord)) {
            const e = model.entity(id)!;
            if (e.geom.kind !== 'VIEWPORT') continue;
            // Read as the file states them.
            expect(e.geom.snapGrid?.snapSpacing.x, `${path}: ${e.handle}`).toBeGreaterThan(0);
            read++;
            b.updateEntity(id, { geom: withViewportSnapGrid(e.geom, SETTINGS) });
            handles.push(e.handle);
          }
        }
        if (handles.length === 0) return;
        // Model space's switches turned from what the file has.
        const active = currentVport(model);
        if (active) {
          b.updateTableRecord('vports', active.handle, {
            snapOn: !active.snapOn,
            gridOn: !active.gridOn,
            ucsIcon: active.ucsIcon ^ 1,
          });
        }
        model.apply(b.build());
        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        expect(viewports(back), path).toEqual(viewports(model));
        for (const h of handles) {
          const g = back.entityByHandle(h)!.geom;
          if (g.kind !== 'VIEWPORT') throw new Error(`${path}: ${h} is not a viewport`);
          expect(viewportSnapGrid(g), `${path}: ${h}`).toEqual(SETTINGS);
        }
        if (active) {
          const v = currentVport(model)!;
          expect(currentVport(back), path).toMatchObject({
            snapOn: v.snapOn,
            gridOn: v.gridOn,
            ucsIcon: v.ucsIcon,
          });
        }
        edited += handles.length;
        files++;
      });
    },
    () => {
      expect(read).toBe(edited);
      expect(edited).toBeGreaterThanOrEqual(100);
      expect(files).toBeGreaterThanOrEqual(30);
    },
  );
});
