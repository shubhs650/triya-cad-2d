// View categories (M2-70): the View Manager's Category row and New View's View category, kept as
// AutoCAD keeps them, in DXF 300 of the `ADSK_XREC_VTRVIEWINFO` XRECORD in a VIEW's extension
// dictionary. sample_AC1032_ascii.dxf's `view_custom` has the record, saying `<None>`.
//
// On every readable public corpus file: each named view is given a category, as the Category row
// gives it (`view-category`, a table record update), every second one in the drawing's order
// being taken back to none, and a new view is saved with one, as New View saves it
// (`saveNamedView`); the drawing is saved as AC1032 DXF (DEC-047) and read back. A view that had
// the record and was taken back to none says `<None>` again; one that never had it stays without.
// With TRIYA_DXF_AUDIT_DIR set the save goes to the ezdxf audit as the file's `categories` save,
// beside the categories ezdxf must read from it (audit.py, `<save>.categories.json`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { XRecord, type CadDocument } from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, saveNamedView, type ViewRecord } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditExpectation, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const PER_FILE_BUDGET_MS = 30_000;
const INFO = 'ADSK_XREC_VTRVIEWINFO';
const NEW_VIEW = 'Triya section A';

/** What a view's `ADSK_XREC_VTRVIEWINFO` says as DXF 300, as acad-ts reads it, if it has one. */
function rawCategories(doc: CadDocument): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const v of doc.views ?? []) {
    const x = v.xDictionary?.getEntry(INFO);
    if (x instanceof XRecord) {
      out.set(v.name, x.entries.find((e) => e.code === 300)?.value as string | undefined);
    }
  }
  return out;
}

const viewsOf = (model: DocumentModel): ViewRecord[] => [...model.tables.views.values()];

describe('sample_AC1032_ascii.dxf', () => {
  it('reads view_custom’s category, <None>, as none', () => {
    const path = `${corpusDir}public/third-party/acadsharp/sample_AC1032_ascii.dxf`;
    const doc = readCadDocument(new Uint8Array(readFileSync(path)));
    expect(rawCategories(doc).get('view_custom')).toBe('<None>');
    const view = viewsOf(DocumentModel.create(documentInit(doc))).find(
      (v) => v.name === 'view_custom',
    );
    expect(view).toBeDefined();
    expect(view!.category).toBeUndefined();
  });
});

describe('view categories set in the View Manager save and read back', () => {
  let given = 0;
  let cleared = 0;
  let records = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      await withPinnedClock(async () => {
        const original = readCadDocument(bytes);
        const hadRecord = new Set(rawCategories(original).keys());
        records += hadRecord.size;
        const model = DocumentModel.create(documentInit(original));
        const b = new ChangeSetBuilder(model);
        const want = new Map<string, string | undefined>();
        viewsOf(model).forEach((v, i) => {
          // Every view first gets one, then every second across the corpus (most drawings have
          // one view) goes back to none: a view that had the record must say <None> again, and
          // one that had none must not gain one.
          b.updateTableRecord('views', v.handle, { category: `Elevations ${i}` });
          const category = (given + cleared) % 2 === 0 ? `Elevations ${i}` : undefined;
          if (category === undefined) b.updateTableRecord('views', v.handle, { category });
          want.set(v.name, category);
          if (category === undefined) cleared++;
          else given++;
        });
        const extent = { center: { x: 10, y: 5 }, width: 40, height: 20, paper: false };
        saveNamedView(b, model, NEW_VIEW, extent, 'Sections');
        want.set(NEW_VIEW, 'Sections');
        model.apply(b.build());

        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        writeAuditSave(f.path, 'categories', save);
        writeAuditExpectation(f.path, 'categories', 'categories', Object.fromEntries(want));
        const saved = readCadDocument(save());
        const back = new Map(
          viewsOf(DocumentModel.create(documentInit(saved))).map((v) => [v.name, v.category]),
        );
        expect(back, f.path).toEqual(want);
        // What the file says: <None> where the view keeps its record without a category.
        const raw = rawCategories(saved);
        const wrong: string[] = [];
        for (const [name, category] of want) {
          const said = raw.get(name);
          const expected =
            category ?? (hadRecord.has(name) && name !== NEW_VIEW ? '<None>' : undefined);
          if (said !== expected) wrong.push(`${name}: ${String(said)} for ${String(expected)}`);
        }
        expect(wrong, f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('covered views with and without the record', () => {
    // Floors at the time of writing (M2-70): a corpus file added later only raises them.
    expect(given).toBeGreaterThanOrEqual(11);
    expect(cleared).toBeGreaterThanOrEqual(11);
    expect(records).toBeGreaterThanOrEqual(20);
  });
});
