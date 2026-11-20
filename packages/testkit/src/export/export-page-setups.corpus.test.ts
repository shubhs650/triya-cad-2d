// Named page setups saved (M6-01 part 3, the acceptance "round-trip of page setups") on every
// readable public corpus file from R2000 on. The Page Setup Manager's edits, as the engine session
// makes them: New adds a page setup for layouts (from the first layout's own settings, on ISO A3,
// "Plot transparency" on) and one for model space (Extents, fitted), Set Current applies them to
// that layout and to Model; the drawing is saved as AC1032 DXF (DEC-047) and read again, and the
// page setups and layouts read back as the engine has them. Then Modify (another plot style
// table, transparency off), Rename and Delete go through the same round trip, and so would a
// drawing's own page setups, which no public corpus file has (ezdxf's images.dxf has a PLOTSETTINGS
// outside ACAD_PLOTSETTINGS, kept as read). The page setups test drawing (M2-17 part 6) has three
// of AutoCAD's kind: they are modified, renamed, deleted and set current, keeping the plotter
// they name (DXF 2, which Triya does not map), and imported into ezdxf's colors.dxf. ACadSharp's
// AC1032 sample and the test drawing are saved for the ezdxf audit (audit.py `FIXTURE_SAVES`,
// `page-setups`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PlotSettings } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  addPageSetup,
  changePageSetup,
  currentPageSetupPatch,
  deletePageSetup,
  isModelLayout,
  namedPageSetups,
  pageSetupInitOf,
  pageSetupNamed,
  paperLayouts,
  plotTransparencyOf,
  type LayoutPlot,
  type NamedPageSetup,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const AUDITED = new Set(['public/third-party/acadsharp/sample_AC1032_ascii.dxf']);
const FIXTURE = fileURLToPath(
  new URL('../../fixtures/page-setups/page-setups.dxf', import.meta.url),
);
const COLORS = `${corpusDir}public/third-party/ezdxf/examples_dxf/colors.dxf`;

const A3: Pick<LayoutPlot, 'paperSize' | 'paperWidth' | 'paperHeight' | 'margins'> = {
  paperSize: 'ISO_full_bleed_A3_(420.00_x_297.00_MM)',
  paperWidth: 420,
  paperHeight: 297,
  margins: { left: 0, bottom: 0, right: 0, top: 0 },
};

/** A setup or layout as it reads back: JSON's view, without what the reader keeps of the file. */
const comparable = <T extends { raw?: unknown }>({ raw: _raw, ...rest }: T): unknown =>
  JSON.parse(JSON.stringify(rest));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

function made(r: NamedPageSetup | string): NamedPageSetup {
  if (typeof r === 'string') throw new Error(r);
  return r;
}

function reopen(bytes: Uint8Array, model: DocumentModel, audit?: string) {
  const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
  if (audit) writeAuditSave(audit, 'page-setups', save);
  const saved = save();
  return { bytes: saved, model: DocumentModel.create(documentInit(readCadDocument(saved))) };
}

function expectSame(back: DocumentModel, model: DocumentModel, path: string): void {
  expect(namedPageSetups(back).map(comparable), path).toEqual(
    namedPageSetups(model).map(comparable),
  );
  expect(back.layouts.map(comparable), path).toEqual(model.layouts.map(comparable));
}

let files = 0;
let added = 0;
let changed = 0;
let kept = 0;

describe('named page setups saved on the public corpus', () => {
  eachCorpusFile(
    readableFiles(manifest).filter((f) => f.version >= 'AC1015'),
    (f) => {
      const path = f.path;
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const layout = paperLayouts(model)[0];
        const modelLayout = model.layouts.find((l) => isModelLayout(model, l));
        if (!layout?.plot || !modelLayout?.plot) return;
        const had = namedPageSetups(model);

        // New, twice, and Set Current for a layout and for Model.
        edit(model, (b) => {
          const sheet = made(
            addPageSetup(b, model, {
              name: 'Triya A3',
              model: false,
              plot: { ...layout.plot!, ...A3 },
              plotTransparency: true,
            }),
          );
          const fit = made(
            addPageSetup(b, model, {
              name: 'Triya Model Fit',
              model: true,
              plot: {
                ...modelLayout.plot!,
                // ISO A1: some drawings' own model page setups are 0 x 0 (ezdxf's).
                paperSize: 'ISO_full_bleed_A1_(841.00_x_594.00_MM)',
                paperWidth: 841,
                paperHeight: 594,
                margins: A3.margins,
                plotType: 1,
                flags: modelLayout.plot!.flags | 16,
                standardScaleType: 0,
              },
            }),
          );
          // Set Current reads the page setups as the builder made them.
          b.updateLayout(layout.handle, currentPageSetupPatch(b, model, layout, sheet));
          b.updateLayout(modelLayout.handle, currentPageSetupPatch(b, model, modelLayout, fit));
        });
        added += 2;
        const audit = AUDITED.has(path) ? path.replace(/^public\//, '') : undefined;
        const first = reopen(bytes, model);
        expectSame(first.model, model, path);
        const back = first.model;
        expect(plotTransparencyOf(back, pageSetupNamed(back, 'Triya A3')!), path).toBe(true);
        expect(
          back.layouts.find((l) => l.handle === layout.handle)?.plot?.pageSetupName,
          path,
        ).toBe('Triya A3');

        // Modify, Rename and Delete, saved from the drawing as first saved.
        edit(back, (b) => {
          const sheet = pageSetupNamed(back, 'Triya A3')!;
          made(
            changePageSetup(b, back, sheet, {
              name: 'Triya A3 Mono',
              plot: { ...sheet.plot, styleSheet: 'monochrome.ctb' },
              plotTransparency: false,
            }),
          );
          deletePageSetup(b, pageSetupNamed(back, 'Triya Model Fit')!);
          // The drawing's own page setups: modified and renamed, keeping what Triya does not map.
          for (const p of had)
            made(
              changePageSetup(b, back, pageSetupNamed(back, p.name)!, {
                name: `${p.name} (Triya)`,
                plot: { ...p.plot, rotation: p.plot.rotation === 1 ? 0 : 1 },
              }),
            );
        });
        changed += 2 + had.length;
        const second = reopen(first.bytes, back, audit);
        expectSame(second.model, back, path);
        expect(
          namedPageSetups(second.model).map((p) => p.name),
          path,
        ).toEqual(
          [...had.map((p) => `${p.name} (Triya)`), 'Triya A3 Mono'].sort((a, b) =>
            a.localeCompare(b),
          ),
        );
        // What Triya does not map of the drawing's own page setups stays as read.
        const doc = readCadDocument(second.bytes);
        for (const p of had) {
          const o = doc.getCadObject(Number.parseInt(p.handle, 16));
          expect(o, path).toBeInstanceOf(PlotSettings);
          const s = o as PlotSettings;
          expect(s.pageName, path).toBe(`${p.name} (Triya)`);
          expect(pageSetupNamed(second.model, s.pageName)?.extDict, path).toBe(p.extDict);
          expect(pageSetupNamed(second.model, s.pageName)?.reactors, path).toEqual(p.reactors);
          kept++;
        }
        files++;
      });
    },
    () => {
      // Every R2000+ drawing of the corpus with a layout and Model page setups: 106 files at the
      // time of writing.
      expect(files).toBeGreaterThanOrEqual(106);
      expect(added).toBe(files * 2);
      expect(changed).toBe(files * 2 + kept);
    },
  );
});

describe("the page setups test drawing's own page setups", () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const open = (b: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(b)));

  it('are modified, renamed, deleted and set current, keeping their plotter', () => {
    withPinnedClock(() => {
      const model = open(bytes);
      const layout = paperLayouts(model)[0]!;
      const modelLayout = model.layouts.find((l) => isModelLayout(model, l))!;
      expect(namedPageSetups(model).map((p) => p.name)).toEqual([
        'A3 Monochrome',
        'Model A1 Fit',
        'Model ANSI B 1:2',
      ]);
      edit(model, (b) => {
        const a3 = pageSetupNamed(model, 'A3 Monochrome')!;
        const renamed = made(
          changePageSetup(b, model, a3, {
            name: 'A3 Colour',
            plot: { ...a3.plot, styleSheet: 'acad.ctb', rotation: 1 },
            plotTransparency: true,
          }),
        );
        b.updateLayout(layout.handle, currentPageSetupPatch(b, model, layout, renamed));
        const fit = pageSetupNamed(model, 'Model A1 Fit')!;
        b.updateLayout(modelLayout.handle, currentPageSetupPatch(b, model, modelLayout, fit));
        deletePageSetup(b, pageSetupNamed(model, 'Model ANSI B 1:2')!);
      });
      const saved = reopen(bytes, model, 'fixtures/page-setups/page-setups.dxf');
      expectSame(saved.model, model, FIXTURE);
      expect(namedPageSetups(saved.model).map((p) => p.name)).toEqual([
        'A3 Colour',
        'Model A1 Fit',
      ]);
      const doc = readCadDocument(saved.bytes);
      for (const p of namedPageSetups(saved.model)) {
        const s = doc.getCadObject(Number.parseInt(p.handle, 16)) as PlotSettings;
        expect(s.pageName).toBe(p.name);
        expect(s.systemPrinterName).toBe('DWG To PDF.pc3');
      }
    });
  });

  it('are imported into another drawing', () => {
    withPinnedClock(() => {
      const source = open(bytes);
      const colors = new Uint8Array(readFileSync(COLORS));
      const model = open(colors);
      edit(model, (b) => {
        for (const p of namedPageSetups(source))
          made(addPageSetup(b, model, pageSetupInitOf(source, p)));
      });
      const saved = reopen(colors, model);
      expectSame(saved.model, model, COLORS);
      expect(
        namedPageSetups(saved.model).map(({ name, model: m, plot }) => ({ name, m, plot })),
      ).toEqual(namedPageSetups(source).map(({ name, model: m, plot }) => ({ name, m, plot })));
    });
  });
});
