// A save writes the view each layout shows into its paper-space viewport (M2-47 part 1,
// `paperViewsChange`): on every readable public corpus file, every layout is given a view (half
// its sheet about the sheet's centre, or a window about the origin for a layout without a sheet),
// saved as AC1032 DXF (DEC-047) and read back: each layout's viewport with id 1 holds the view as
// its frame and its view, whether the drawing had one (updated) or the layout was never shown
// (added on layer 0). A layout that holds floating viewports but none with id 1 (another
// program's) is left as read. With TRIYA_DXF_AUDIT_DIR set the save goes to the ezdxf audit as
// the file's `views` save.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  layoutSheet,
  paperViewsChange,
  type PaperView,
  type ViewportGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

const PER_FILE_BUDGET_MS = 30_000;

/** The layout's viewports, and the one with id 1. */
function viewportsOf(model: DocumentModel, block: string) {
  const all = model
    .blockEntities(block)
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'VIEWPORT');
  return { all, sheet: all.find((e) => (e.geom as ViewportGeometry).id === 1) };
}

const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

describe('each layout’s view saves into its paper-space viewport and reads back', () => {
  let updated = 0;
  let added = 0;
  let left = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      await withPinnedClock(async () => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const views: PaperView[] = [];
        const kept = new Set<string>();
        for (const l of model.layouts) {
          const name = model.blocks.get(l.blockRecord)?.name.toUpperCase();
          if (name === undefined || name === '*MODEL_SPACE') continue;
          const paper = layoutSheet(l)?.paper;
          const view = paper
            ? {
                center: { x: (paper.minX + paper.maxX) / 2, y: (paper.minY + paper.maxY) / 2 },
                width: (paper.maxX - paper.minX) / 2,
                height: (paper.maxY - paper.minY) / 2,
              }
            : { center: { x: 3, y: 2 }, width: 12, height: 8 };
          views.push({ block: l.blockRecord, view });
          const { all, sheet } = viewportsOf(model, l.blockRecord);
          if (sheet) updated++;
          else if (all.length === 0) added++;
          else {
            left++;
            kept.add(l.blockRecord);
          }
        }
        model.apply(paperViewsChange(model, views));

        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        writeAuditSave(f.path, 'views', save);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        const wrong: string[] = [];
        for (const { block, view } of views) {
          const { all, sheet } = viewportsOf(back, block);
          if (kept.has(block)) {
            if (sheet) wrong.push(`${block}: a viewport with id 1 was added`);
            continue;
          }
          if (!sheet) {
            wrong.push(`${block}: no viewport with id 1 (${all.length} others)`);
            continue;
          }
          const g = sheet.geom as ViewportGeometry;
          const got = [
            g.viewCenter.x,
            g.viewCenter.y,
            g.viewHeight,
            g.center.x,
            g.center.y,
            g.width,
            g.height,
          ];
          const want = [
            view.center.x,
            view.center.y,
            view.height,
            view.center.x,
            view.center.y,
            view.width,
            view.height,
          ];
          if (!got.every((v, i) => close(v, want[i]!))) {
            wrong.push(`${block}: ${JSON.stringify(got)} for ${JSON.stringify(want)}`);
          }
        }
        expect(wrong, f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('covered layouts with a paper-space viewport and layouts never shown', () => {
    // Floors at the time of writing (M2-47 part 1): a corpus file added later only raises them.
    // No corpus file has a layout with floating viewports but none with id 1 (the engine's unit
    // test covers it), so `left` stays 0.
    expect(updated).toBeGreaterThanOrEqual(76);
    expect(added).toBeGreaterThanOrEqual(116);
    expect(left).toBe(0);
  });
});
