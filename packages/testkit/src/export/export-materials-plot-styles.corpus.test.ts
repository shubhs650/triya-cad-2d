// Materials renamed and plot style names added on every readable public corpus file (M1-75 part
// 33): every material AutoCAD lets RENAME take (all but Global, ByLayer and ByBlock) gets a new
// name, and a named-plot-style drawing ($PSTYLEMODE 0) gains a plot style name that layer 0 is
// given, as the Layer Properties Manager's Select Plot Style does. The reopened file maps the
// edits back, and everything else is exactly as read. A colour-dependent drawing, or one before
// R2000, refuses the new plot style name.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion } from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel } from '@triya/engine';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Generous for the largest corpus files read three times and written twice under load. */
const PER_FILE_BUDGET_MS = 15_000;

const FIXED_MATERIALS = new Set(['GLOBAL', 'BYLAYER', 'BYBLOCK']);

let renamed = 0;
let added = 0;
let refused = 0;
let refusedMaterials = 0;

describe('TriyaToAcad materials and plot style names on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'renames the materials of %s and gives it a plot style name',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const open = (): DocumentModel =>
          DocumentModel.create(documentInit(readCadDocument(bytes)));
        const handles = (hs: Iterable<string>): number[] =>
          [...hs].map((h) => Number.parseInt(h, 16));
        /** The differences besides `ignored` objects and $HANDSEED. */
        const others = (reopened: typeof original, ignored: number[]) =>
          structuralDiff(original, reopened, { ignoreHandles: new Set(ignored) })
            .differences.filter((d) => !(d.handle === '0' && d.path === '$HANDSEED'))
            .slice(0, 5);

        // RENAME of every material that may be renamed.
        const model = open();
        const materials = [...model.tables.materials.values()].filter(
          (m) => !FIXED_MATERIALS.has(m.name.toUpperCase()),
        );
        const version = original.header?.version ?? ACadVersion.AC1032;
        const newName = (m: { name: string }): string => `${m.name.slice(0, 24)} Triya`;
        if (materials.length > 0) {
          const b = new ChangeSetBuilder(model);
          for (const m of materials)
            b.updateTableRecord('materials', m.handle, { name: newName(m) });
          model.apply(b.build());
          // ACadSharp's samples saved down to R14 and R2000 still hold the materials.
          if (version < ACadVersion.AC1021) {
            expect(() => exportDocument(readCadDocument(bytes), model, options), f.path).toThrow(
              /has no materials \(R2007 added them\)/,
            );
            refusedMaterials++;
          } else {
            const reopened = readCadDocument(
              exportDocument(readCadDocument(bytes), model, options),
            );
            const back = new Map(
              documentInit(reopened).tables?.materials?.map((m) => [m.handle, m]),
            );
            expect(
              materials.map((m) => back.get(m.handle)?.name),
              f.path,
            ).toEqual(materials.map(newName));
            // The MATERIAL's own name (DXF 1) as well as its dictionary entry.
            expect(
              materials.map(
                (m) =>
                  (reopened.getCadObject(Number.parseInt(m.handle, 16)) as { name?: string } | null)
                    ?.name,
              ),
              f.path,
            ).toEqual(materials.map(newName));
            const dictionary = reopened.rootDictionary?.get('ACAD_MATERIAL');
            expect(
              others(reopened, [
                ...handles(materials.map((m) => m.handle)),
                ...(dictionary ? [dictionary.handle] : []),
              ]),
              f.path,
            ).toEqual([]);
            renamed += materials.length;
          }
        }

        // A plot style name layer 0 is given.
        const plot = open();
        const layer0 = [...plot.tables.layers.values()].find((l) => l.name === '0');
        if (!layer0) return;
        const b = new ChangeSetBuilder(plot);
        const pen = b.addTableRecord('plotStyles', { name: 'Triya pen' }).handle;
        b.updateTableRecord('layers', layer0.handle, { plotStyle: pen });
        plot.apply(b.build());
        const named =
          version >= ACadVersion.AC1015 &&
          original.header?.plotStyleMode === 0 &&
          original.rootDictionary?.get('ACAD_PLOTSTYLENAME') !== undefined;
        if (!named) {
          let problems: readonly string[] = [];
          try {
            exportDocument(readCadDocument(bytes), plot, options);
          } catch (e) {
            if (!(e instanceof UnsupportedChangeError)) throw e;
            problems = e.problems;
          }
          expect(problems.join('\n'), f.path).toMatch(
            /^plot style Triya pen \([0-9A-F]+\): (.*colour-dependent drawing|.*has no plot style names|the drawing has no ACAD_PLOTSTYLENAME)/m,
          );
          refused++;
          return;
        }
        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), plot, options));
        const init = documentInit(reopened);
        expect(
          [
            init.tables?.plotStyles?.find((s) => s.handle === pen)?.name,
            init.tables?.layers?.find((l) => l.handle === layer0.handle)?.plotStyle,
          ],
          f.path,
        ).toEqual(['Triya pen', pen]);
        const dictionary = reopened.rootDictionary!.get('ACAD_PLOTSTYLENAME')!;
        expect(
          others(reopened, [dictionary.handle, ...handles([pen, layer0.handle])]),
          f.path,
        ).toEqual([]);
        added++;
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('renamed materials and added plot style names across the corpus', () => {
    // The ACadSharp samples from R2007 hold eight materials of their own each.
    expect(renamed).toBeGreaterThanOrEqual(40);
    expect(refusedMaterials).toBeGreaterThan(0);
    // ezdxf's 3dface.dxf is the only named-plot-style drawing.
    expect(added).toBeGreaterThanOrEqual(1);
    expect(refused).toBeGreaterThan(50);
  });
});
