// M4-23 part 2: fields in table cells save as AutoCAD keeps them. A text cell's fields are a
// FIELD tree owned by the table, its root named by the cell (DXF 344 in the ACAD_TABLE codes) and
// by the cell's field content in the table's TABLECONTENT (its 340, and the content's 360 field
// references), listed in the drawing's FIELDLIST when it has one. Each save is AC1032 DXF;
// reopened, every cell has the fields it was saved with, the TABLECONTENT agrees with the legacy
// codes, a later UPDATEFIELD writes onto the same FIELDs, and a cell typed over loses its tree.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TableEntity } from '@node-projects/acad-ts';
import {
  CadDictionary,
  Field,
  FieldList,
  TableCellContentType,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  editableFieldText,
  textWithFields,
  withCellText,
  withRowsInserted,
  type Entity,
  type TableGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument, roundTripTableContent } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { contentMismatches } from '../tables/table-records.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/', import.meta.url));
const NOW = new Date(2026, 10, 16, 9, 30, 0);
const LATER = new Date(2027, 0, 2, 8, 0, 0);
const SAMPLE = 'third-party/acadsharp/sample_AC1032_ascii.dxf';
const UNCOMMON = 'third-party/ezdxf/examples_dxf/uncommon.dxf';
const YEAR = '\\AcVar Date \\f "yyyy"';

type Table = Entity & { geom: TableGeometry };

const bytesOf = (path: string) => new Uint8Array(readFileSync(`${corpusDir}${path}`));
const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));
const tables = (model: DocumentModel) =>
  [...model.entities()].filter((e): e is Table => e.geom.kind === 'ACAD_TABLE');

function session(model: DocumentModel, now = NOW) {
  return new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
    clock: { now: () => now },
  });
}

function save(path: string, model: DocumentModel): Uint8Array {
  return withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytesOf(path)), model));
}

/** The FIELDs the drawing's FIELDLIST lists, by handle; null when it has none. */
function listed(doc: CadDocument): Set<number> | null {
  const list = doc.rootDictionary?.getEntry(CadDictionary.acadFieldList);
  return list instanceof FieldList ? new Set(list.fields.map((f) => f.handle)) : null;
}

const tree = (f: Field): Field[] => [f, ...f.children.flatMap(tree)];

/** A cell's text and fields as the model holds them. */
function cellOf(model: DocumentModel, handle: string, i: number, j: number) {
  const c = (model.entityByHandle(handle) as Table).geom.cells[i]![j]!;
  return {
    text: c.text,
    code: c.field && editableFieldText(c.field),
    values: c.field?.children.map((k) => k.value),
  };
}

/** The root FIELD a read table's cell names in its ACAD_TABLE codes (344), and in its TABLECONTENT. */
function roots(doc: CadDocument, handle: string, i: number, j: number) {
  const t = doc.getCadObject(Number.parseInt(handle, 16)) as TableEntity;
  const legacy = t.rows[i]!.cells[j]!.contents[0]?.field ?? null;
  const rt = roundTripTableContent(t, (h) => doc.getCadObject(h));
  const k = rt?.content?.rows[i]?.cells[j]?.contents[0];
  return {
    legacy,
    content: k?.contentType === TableCellContentType.Field ? (k.field as Field | null) : null,
    contentType: k?.contentType,
    references: (rt?.content?.fieldReferences ?? []).map((f) => f.handle),
  };
}

describe('fields in a new table save as DXF and read back', () => {
  it.each([SAMPLE, UNCOMMON])('-TABLE with a field in its title in %s', async (path) => {
    const model = modelOf(bytesOf(path));
    const before = new Set(tables(model).map((e) => e.id));
    const bus = session(model);
    await bus.script(['-TABLE', '2', '2', '0,-500']);
    await bus.answer({ kind: 'string', value: `Rev %<${YEAR}>%`, editor: true });
    expect(bus.command).toBeUndefined();
    const made = tables(model).find((e) => !before.has(e.id))!;
    const want = cellOf(model, made.handle, 0, 0);
    expect(want).toEqual({ text: 'Rev 2026', code: `Rev %<${YEAR}>%`, values: ['2026'] });

    const bytes = save(path, model);
    const doc = readCadDocument(bytes);
    const back = DocumentModel.create(documentInit(doc));
    expect(cellOf(back, made.handle, 0, 0)).toEqual(want);
    const r = roots(doc, made.handle, 0, 0);
    expect(r.legacy).toBeInstanceOf(Field);
    const root = r.legacy!;
    expect(root.evaluatorId).toBe('_text');
    // Owned by the table (330), which no dictionary lists.
    const hex = root.handle.toString(16).toUpperCase();
    expect(new TextDecoder().decode(bytes)).toMatch(
      new RegExp(
        `\\n *0\\r?\\nFIELD\\r?\\n *5\\r?\\n${hex}\\r?\\n *330\\r?\\n${made.handle}\\r?\\n`,
      ),
    );
    // The TABLECONTENT names the same FIELD, as a field content and among its references.
    expect(r.content?.handle).toBe(root.handle);
    expect(r.references).toEqual([root.handle]);
    expect(contentMismatches(doc, made.handle, (model.entity(made.id) as Table).geom)).toEqual([]);
    const list = listed(doc);
    for (const f of tree(root)) {
      if (list) expect(list.has(f.handle)).toBe(true);
      expect(f.handle).toBeLessThan(doc.header!.handleSeed);
    }
  });
});

describe("fields in a drawing's own table save as DXF and read back", () => {
  /** The first text cell of A35's last row, which the edits give fields. */
  function own(model: DocumentModel): { t: Table; i: number; j: number } {
    const t = tables(model)[0]!;
    const i = t.geom.cells.length - 1;
    const j = t.geom.cells[i]!.findIndex((c) => !c.merged && c.type === 'text' && !c.value);
    return { t, i, j };
  }

  function typeInto(model: DocumentModel, typed: string, now = NOW) {
    const { t, i, j } = own(model);
    const r = textWithFields(typed, { model, now, folder: '', space: t.owner });
    let g = withCellText(t.geom, i, j, r.text);
    const field = r.field;
    if (field) {
      const cells = g.cells.map((row, k) =>
        k !== i ? row : row.map((c, l) => (l === j ? { ...c, text: r.text, field } : c)),
      );
      g = { ...g, cells };
    }
    const b = new ChangeSetBuilder(model);
    b.updateEntity(t.id, { geom: g });
    model.apply(b.build());
  }

  it('keeps its AutoCAD 2008 data with the field, updates it in place and drops it', async () => {
    const model = modelOf(bytesOf(SAMPLE));
    const { t, i, j } = own(model);
    expect(j).toBeGreaterThanOrEqual(0);
    typeInto(model, `Rev %<${YEAR}>%`);
    const want = cellOf(model, t.handle, i, j);
    expect(want).toEqual({ text: 'Rev 2026', code: `Rev %<${YEAR}>%`, values: ['2026'] });

    const first = readCadDocument(save(SAMPLE, model));
    const reread = DocumentModel.create(documentInit(first));
    expect(cellOf(reread, t.handle, i, j)).toEqual(want);
    const r = roots(first, t.handle, i, j);
    const root = r.legacy!;
    expect(root).toBeInstanceOf(Field);
    expect(r.content?.handle).toBe(root.handle);
    expect(r.references).toContain(root.handle);
    expect(contentMismatches(first, t.handle, (model.entity(t.id) as Table).geom)).toEqual([]);
    const firstTree = tree(root).map((f) => f.handle);

    // Reopened, a later UPDATEFIELD writes the new value onto the same FIELDs.
    const later = session(reread, LATER);
    await later.submit('UPDATEFIELD');
    await later.answer({ kind: 'selection', ids: [reread.entityByHandle(t.handle)!.id] });
    expect(cellOf(reread, t.handle, i, j).text).toBe('Rev 2027');
    const updated = readCadDocument(
      withPinnedClock(() => saveAc1032Dxf(readCadDocument(save(SAMPLE, model)), reread)),
    );
    expect(tree(roots(updated, t.handle, i, j).legacy!).map((f) => f.handle)).toEqual(firstTree);
    expect(cellOf(DocumentModel.create(documentInit(updated)), t.handle, i, j)).toEqual({
      text: 'Rev 2027',
      code: `Rev %<${YEAR}>%`,
      values: ['2027'],
    });
    expect(
      contentMismatches(updated, t.handle, (reread.entityByHandle(t.handle) as Table).geom),
    ).toEqual([]);

    // Typed over: no field in the codes or the content, none listed.
    typeInto(model, 'Rev 26');
    const cleared = readCadDocument(save(SAMPLE, model));
    const c = roots(cleared, t.handle, i, j);
    expect(c.legacy).toBeNull();
    expect(c.content).toBeNull();
    expect(c.contentType).toBe(TableCellContentType.Value);
    expect(c.references).not.toContain(root.handle);
    expect(cellOf(DocumentModel.create(documentInit(cleared)), t.handle, i, j)).toEqual({
      text: 'Rev 26',
      code: undefined,
      values: undefined,
    });
    const list = listed(cleared);
    if (list) for (const h of firstTree) expect(list.has(h)).toBe(false);
  });

  it('keeps a cell field through rows inserted above it (it names no cells)', () => {
    const model = modelOf(bytesOf(SAMPLE));
    const { t, i, j } = own(model);
    typeInto(model, `Rev %<${YEAR}>%`);
    const want = cellOf(model, t.handle, i, j);
    const g = (model.entity(t.id) as Table).geom;
    const b = new ChangeSetBuilder(model);
    b.updateEntity(t.id, { geom: withRowsInserted(g, i, 1, i - 1) });
    model.apply(b.build());
    const doc = readCadDocument(save(SAMPLE, model));
    expect(cellOf(DocumentModel.create(documentInit(doc)), t.handle, i + 1, j)).toEqual(want);
    expect(roots(doc, t.handle, i + 1, j).legacy).toBeInstanceOf(Field);
    const edited = (model.entity(t.id) as Table).geom;
    const { rowOrigins: _r, ...geom } = edited;
    expect(contentMismatches(doc, t.handle, geom as TableGeometry)).toEqual([]);
  });
});
