// The Properties palette's General rows Plot style, Hyperlink and Thickness and the 3D
// Visualization group's Material (M2-35 part 6), set on every readable public corpus file as the
// palette sets them (`applyPropertyEdit`, one change set per row, as the PromptBus's
// `setProperty` makes it for the objects picked at `Command:`), save as AC1032 DXF
// (DEC-047) and read back. Up to eight objects that have a thickness, on unlocked layers, take a
// hyperlink (a new one, or a changed URL with the description kept), a thickness, the drawing's
// Global material when it has materials (not a DWG's: see below), and its first plot style name in a named-plot-style
// drawing. A drawing without PE_URL gains the APPID. With TRIYA_DXF_AUDIT_DIR set the save goes
// to the ezdxf audit as the file's `properties` save.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  HYPERLINK_APP,
  applyPropertyEdit,
  hasThickness,
  hyperlinkOf,
  propertySheet,
  type Entity,
  type PropertyEdit,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Objects edited per drawing, to keep the suite quick. */
const PER_FILE = 8;
const PER_FILE_BUDGET_MS = 30_000;
const LINK = 'https://openengtools.com/triya/m2-35';
const THICKNESS = 1.5;

interface Want {
  readonly hyperlink: string;
  readonly thickness: number;
  readonly material?: string;
  readonly plotStyle?: string;
}

const thicknessOf = (e: Entity) => (e.geom as { thickness?: number }).thickness ?? 0;
const handleOf = (model: DocumentModel, e: Entity) => model.ids.handleOf(e.id)!;

describe('General’s rows and Material set in the Properties palette save and read back', () => {
  let edited = 0;
  let linked = 0;
  let materials = 0;
  let plotStyles = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      await withPinnedClock(async () => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const objects = [...model.entities()]
          .filter((e) => hasThickness(e) && model.tables.layers.get(e.layer)?.locked !== true)
          .slice(0, PER_FILE);
        const want = new Map<string, Want>();
        if (objects.length > 0) {
          const ids = objects.map((e) => e.id);
          const set = (edit: PropertyEdit) => {
            const b = new ChangeSetBuilder(model);
            const now = ids.map((id) => model.entity(id)!);
            const report = applyPropertyEdit(b, model, now, edit);
            expect(report.invalid, `${f.path} ${edit.key}`).toBeUndefined();
            model.apply(b.build());
          };
          const sheet = propertySheet(model, ids);
          const row = (key: string) =>
            sheet.sections.flatMap((s) => s.rows).find((r) => r.key === key);
          // A DWG's MATERIALs are not written to DXF (FILE_FIDELITY.md, VISUALSTYLE / MATERIAL:
          // "MATERIAL is still skipped"), so a DWG's DXF save cannot keep one (DEC-047 item 4).
          const material = f.path.endsWith('.dwg')
            ? undefined
            : row('material')?.options?.find((o) => o.label === 'Global')?.value;
          const plotStyle = row('plotStyle')?.options?.find((o) => o.value !== 'ByLayer')?.value;
          // The first object keeps its hyperlink's description: only the URL is the palette's.
          const kept = hyperlinkOf(model, objects[0]!);
          set({ key: 'hyperlink', value: LINK });
          set({ key: 'thickness', value: String(THICKNESS) });
          if (material) set({ key: 'material', value: material });
          if (plotStyle) set({ key: 'plotStyle', value: plotStyle });
          for (const e of objects) {
            want.set(handleOf(model, e), {
              hyperlink: LINK,
              thickness: THICKNESS,
              ...(material && { material }),
              ...(plotStyle && { plotStyle }),
            });
          }
          edited += objects.length;
          if (kept === '') linked++;
          if (material) materials++;
          if (plotStyle) plotStyles++;
        }

        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        writeAuditSave(f.path, 'properties', save);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        if (want.size > 0) {
          expect(
            [...back.tables.appIds.values()].some((a) => a.name.toUpperCase() === HYPERLINK_APP),
            f.path,
          ).toBe(true);
        }
        const wrong: string[] = [];
        for (const [handle, w] of want) {
          const e = back.entityByHandle(handle);
          if (!e) {
            wrong.push(`${handle}: gone`);
            continue;
          }
          const got = {
            hyperlink: hyperlinkOf(back, e),
            thickness: thicknessOf(e),
            ...(w.material && { material: e.material }),
            ...(w.plotStyle && { plotStyle: e.plotStyle }),
          };
          if (JSON.stringify(got) !== JSON.stringify(w)) {
            wrong.push(`${handle}: ${JSON.stringify(got)} for ${JSON.stringify(w)}`);
          }
        }
        expect(wrong, f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('covered hyperlinks, thickness, materials and plot style names', () => {
    // Numbers at the time of writing (M2-35 part 6): a floor, so a corpus file added later
    // only raises them.
    expect(edited).toBeGreaterThan(500);
    expect(linked).toBeGreaterThan(50);
    expect(materials).toBeGreaterThan(20);
    expect(plotStyles).toBeGreaterThan(0);
  });
});
