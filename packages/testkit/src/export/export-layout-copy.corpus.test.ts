// LAYOUT Copy saved (M6-01 part 2) on every readable public corpus file from R2000 on: each paper
// layout is copied (`copyLayout`, as LAYOUT Copy and the Move or Copy dialog copy one), the copies
// inserted before their layouts, and the drawing saved as AC1032 DXF (DEC-047) and read again.
// The layouts read back as the engine has them, and each copy's sheet holds what the engine
// copied: the source sheet's objects (less what COPY refuses, said so), in the same order, the
// same apart from their handles and the handles they name. ACadSharp's AC1032 sample (AutoCAD's
// own layouts and viewports) and ezdxf's text_in_viewports.dxf (AutoCAD-saved, a clipped viewport) are also saved for
// the ezdxf audit (audit.py `FIXTURE_SAVES`, `layout-copy`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  copyLayout,
  copyLayoutName,
  paperLayouts,
  type Entity,
  type Layout,
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
]);

const comparable = ({ raw: _raw, ...rest }: Layout): unknown => JSON.parse(JSON.stringify(rest));

/** Keys whose values are handles (or ids) of other objects: a copy names its own. */
const LINKS = new Set([
  'handle',
  'id',
  'owner',
  'raw',
  'reactors',
  'extDict',
  'block',
  'clipBoundary',
  'annotation',
  'sources',
  'xdata',
]);

/** An object as its copy repeats it: without the handles it has or names. */
function shape(e: Entity): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (typeof v === 'bigint') return v.toString();
    if (v === null || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !LINKS.has(k))
        .map(([k, x]) => [k, strip(x)]),
    );
  };
  const { id: _id, ...rest } = e;
  const g = e.geom as unknown as Record<string, unknown>;
  // A viewport's own id (DXF 69) is copied: keep it.
  return { ...(strip(rest) as object), ...(e.geom.kind === 'VIEWPORT' && { vp: g['id'] }) };
}

const sheet = (model: DocumentModel, l: Layout) =>
  model.blockEntities(l.blockRecord).map((id) => model.entity(id)!);

/** The paper viewport first, as copyLayout puts it, then the rest in their order. */
const paperFirst = (es: Entity[]) => [
  ...es.filter((e) => e.geom.kind === 'VIEWPORT' && e.geom.id === 1),
  ...es.filter((e) => !(e.geom.kind === 'VIEWPORT' && e.geom.id === 1)),
];

let copied = 0;
let objects = 0;
let viewports = 0;
let clipped = 0;
let refusals = 0;

describe('LAYOUT Copy saved on the public corpus', () => {
  eachCorpusFile(
    readableFiles(manifest).filter((f) => f.version >= 'AC1015'),
    (f) => {
      const path = f.path;
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const sources = paperLayouts(model);
        if (sources.length === 0) return;
        const made = new Map<string, string>();
        const refused = new Map<string, number>();
        for (const source of sources) {
          const b = new ChangeSetBuilder(model);
          const copy = copyLayout(b, model, source, copyLayoutName(model, source));
          model.apply(b.build());
          made.set(source.handle, copy.layout.handle);
          refused.set(
            source.handle,
            [...copy.refused.values()].reduce((a, n) => a + n, 0),
          );
        }
        // Each copy is before its layout.
        const order = paperLayouts(model).map((l) => l.handle);
        for (const [source, copy] of made)
          expect(order.indexOf(copy), path).toBe(order.indexOf(source) - 1);

        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        if (AUDITED.has(path)) writeAuditSave(path.replace(/^public\//, ''), 'layout-copy', save);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        expect(back.layouts.map(comparable), path).toEqual(model.layouts.map(comparable));
        for (const [source, copy] of made) {
          const was = sheet(
            back,
            back.layouts.find((l) => l.handle === source)!,
          );
          const now = sheet(
            back,
            back.layouts.find((l) => l.handle === copy)!,
          );
          expect(now.map(shape), `${path}: ${copy}`).toEqual(
            sheet(
              model,
              model.layouts.find((l) => l.handle === copy)!,
            ).map(shape),
          );
          if (refused.get(source) === 0)
            expect(now.map(shape), `${path}: ${copy}`).toEqual(paperFirst(was).map(shape));
          objects += now.length;
          for (const e of now) {
            if (e.geom.kind !== 'VIEWPORT') continue;
            viewports++;
            if (e.geom.clipBoundary !== undefined) clipped++;
          }
          refusals += refused.get(source)!;
        }
        copied += made.size;
      });
    },
    () => {
      // Every multi-layout drawing of the corpus has its layouts copied, with what is on them:
      // 197 layouts, 210 objects, 172 viewports (6 clipped), none refused at the time of writing.
      expect(copied).toBeGreaterThanOrEqual(197);
      expect(objects).toBeGreaterThanOrEqual(210);
      expect(viewports).toBeGreaterThanOrEqual(172);
      expect(clipped).toBeGreaterThanOrEqual(6);
      expect(refusals).toBe(0);
    },
  );
});
