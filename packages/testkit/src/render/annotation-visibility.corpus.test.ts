// M6-03 on the public corpus: ANNOALLVISIBLE 0 on the Model tab. For every corpus drawing with
// annotative objects in model space (the ACadSharp samples' annotative texts, DWG, ASCII and
// binary DXF), the annotation scale is set to each scale its objects' representations name and
// to one they do not, as the status bar's Annotation Scale sets CANNOSCALE; a model-space canvas
// with ANNOALLVISIBLE 0 must then hide exactly the annotative objects none of whose
// representations names that scale (taken from the mapped representations, which
// annotation.corpus.test.ts checks against the files), take none of them in a crossing window
// over the whole drawing, and leave every other object as ANNOALLVISIBLE 1 draws it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  annotationScales,
  type DocumentModel,
  type Entity,
  type Handle,
} from '@triya/engine';
import { readCadDocument } from '@triya/io';
import { Canvas2DRenderer, type Canvas2D, type Surface } from '@triya/render';
import { expect } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
// DWGs from R2004 are compressed, so only a DXF can be passed over by its text.
const candidates = readableFiles(manifest).filter(
  (f) =>
    f.format === 'dwg' ||
    /OBJECTCONTEXTDATA_CLASS/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1')),
);

/** A canvas that draws nothing: what is hidden is read from picks and `hides`. */
function blank(): Surface {
  const ctx = new Proxy({}, { get: () => () => undefined }) as unknown as Canvas2D;
  return { canvas: { width: 0, height: 0 }, ctx } as unknown as Surface;
}

const modelSpace = (model: DocumentModel): Handle =>
  [...model.tables.blockRecords.values()].find((r) => r.name.toLowerCase() === '*model_space')!
    .handle;

const EVERYWHERE = { minX: -1e12, minY: -1e12, maxX: 1e12, maxY: 1e12 };

let files = 0;
let objects = 0;
let hiddenSeen = 0;

eachCorpusFile(
  candidates,
  (f) => {
    const d = corpusDrawing(readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`))));
    const { model } = d;
    const ms = modelSpace(model);
    const annotative = [...model.blockEntities(ms)]
      .map((id) => model.entity(id)!)
      .filter((e) => e.annotative !== undefined);
    if (annotative.length === 0) return;
    files++;
    objects += annotative.length;
    const scales = annotationScales(model);
    const named = new Set(
      annotative.flatMap((e) => e.annotative!.representations.map((r) => r.scale)),
    );
    // Each scale the representations name, and the first of the list none names.
    const tried = [
      ...scales.filter((s) => named.has(s.handle)),
      ...scales.filter((s) => !named.has(s.handle)).slice(0, 1),
    ];
    expect(tried.length, f.path).toBeGreaterThan(1);
    const renderer = (allVisible: boolean) =>
      new Canvas2DRenderer({
        now: () => 0,
        model: d.model,
        index: d.index,
        block: ms,
        surface: blank(),
        createLayer: blank,
        style: {
          background: '#000000',
          foreground: '#ffffff',
          showLineweights: false,
          annotationAllVisible: allVisible,
        },
        requestIdle: () => undefined,
      });
    const picked = (r: Canvas2DRenderer) =>
      new Set(
        r.select({ kind: 'crossing', box: EVERYWHERE }).map((id) => model.entity(id)!.handle),
      );
    const hidden = renderer(false);
    const all = picked(renderer(true));
    for (const s of tried) {
      const b = new ChangeSetBuilder(model);
      b.setHeader('CANNOSCALE', s.name);
      const cs = b.build();
      d.model.apply(cs);
      d.index.apply(cs);
      hidden.apply(cs);
      const want = annotative
        .filter((e: Entity) => !e.annotative!.representations.some((r) => r.scale === s.handle))
        .map((e) => e.handle)
        .sort();
      hiddenSeen += want.length;
      const hides = annotative.filter((e) => hidden.hides(e)).map((e) => e.handle);
      expect(hides.sort(), `${f.path} at ${s.name}`).toEqual(want);
      const shown = picked(hidden);
      expect(
        [...all].filter((h) => !shown.has(h)).sort(),
        `${f.path} at ${s.name}: picked under ANNOALLVISIBLE 1, not 0`,
      ).toEqual(want.filter((h) => all.has(h)));
      expect(
        [...shown].filter((h) => !all.has(h)),
        f.path,
      ).toEqual([]);
    }
  },
  () => {
    // The two annotative texts of each R2010, R2013 and R2018 ACadSharp sample, two of them in
    // model space (DWG, ASCII and binary DXF).
    expect(files).toBeGreaterThanOrEqual(9);
    expect(objects).toBeGreaterThanOrEqual(9);
    expect(hiddenSeen).toBeGreaterThan(0);
  },
);
