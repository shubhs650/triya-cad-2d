// M4-10 part 2: fields made in Triya save as AutoCAD keeps them. FIELD places an MTEXT holding a
// field (a date; an object's area, of a circle drawn in the same session), a COPY of a text
// with fields takes fields of its own, and TEXTEDIT changes or deletes an MTEXT's fields. Each
// save is AC1032 DXF; reopened, every text has the fields it was saved with (codes, objects,
// values), each in its own FIELD objects under its extension dictionary's ACAD_FIELD, listed in
// the drawing's FIELDLIST when it has one, and a text whose fields are gone has none left.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CadDictionary,
  Field,
  FieldList,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  editableFieldText,
  type DrawingField,
  type EntityGeometry,
  type MTextGeometry,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/', import.meta.url));
const NOW = new Date(2026, 10, 16, 9, 30, 0);
const UNCOMMON = 'third-party/ezdxf/examples_dxf/uncommon.dxf';
const COMPLEX = 'third-party/ezdxf/examples_dxf/mtext_complex_inline_codes.dxf';
const CIRCLES = 'third-party/ezdxf/examples_dxf/circle_radius_le_0.dxf';

const bytesOf = (path: string) => new Uint8Array(readFileSync(`${corpusDir}${path}`));
const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function session(model: DocumentModel) {
  const view: ViewHost = {
    request: (r): Promise<ViewReply> =>
      Promise.resolve(
        r.op === 'sysvar' && r.name === 'DWGNAME' ? { ok: true, value: 'Plan.dxf' } : { ok: true },
      ),
  };
  return new PromptBus({ model, registry: builtinCommands(), view, clock: { now: () => NOW } });
}

const fieldOf = (g: EntityGeometry): DrawingField | undefined =>
  g.kind === 'TEXT' || g.kind === 'ATTDEF' || g.kind === 'MTEXT' ? g.field : undefined;

/** Each text with fields, by handle: its text and its fields' codes, objects and values. */
function fields(model: DocumentModel): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of model.entities()) {
    const f = fieldOf(e.geom);
    if (!f) continue;
    const g = e.geom as { value?: string; contents?: string };
    out[e.handle] = {
      text: g.contents ?? g.value,
      code: editableFieldText(f),
      values: f.children.map((c) => c.value),
    };
  }
  return out;
}

/** The FIELDs the drawing's FIELDLIST lists, by handle. */
function listed(doc: CadDocument): Set<number> {
  const list = doc.rootDictionary?.getEntry(CadDictionary.acadFieldList);
  return new Set(list instanceof FieldList ? list.fields.map((f) => f.handle) : []);
}

/** The root FIELD of a text in a read drawing, through its ACAD_FIELD dictionary. */
function rootOf(doc: CadDocument, handle: string): Field | undefined {
  const o = doc.getCadObject(Number.parseInt(handle, 16)) as CadObject | null;
  const dict = o?.xDictionary?.getEntry<CadDictionary>('ACAD_FIELD');
  const f = dict instanceof CadDictionary ? dict.getEntry<Field>('TEXT') : undefined;
  return f instanceof Field ? f : undefined;
}

const tree = (f: Field): Field[] => [f, ...f.children.flatMap(tree)];

async function placeField(bus: PromptBus, field: object, at: string): Promise<void> {
  await bus.submit('FIELD');
  await bus.answer({ kind: 'dialog', action: 'ok', field: field as never });
  await bus.script([at]);
  expect(bus.command).toBeUndefined();
}

function save(path: string, model: DocumentModel): Uint8Array {
  return withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytesOf(path)), model));
}

describe('fields made in Triya save as DXF and read back', () => {
  it.each([UNCOMMON, CIRCLES])('FIELD texts in %s get their own FIELD trees', async (path) => {
    const model = modelOf(bytesOf(path));
    const bus = session(model);
    await bus.script(['CIRCLE', '500,500', '10']);
    const circle = [...model.entities()].at(-1)!;
    await placeField(bus, { name: 'Date', date: 'yyyy-MM-dd' }, '500,400');
    await placeField(
      bus,
      { name: 'Object', object: circle.handle, property: 'Area', precision: 2 },
      '500,380',
    );
    const before = fields(model);
    const made = [...model.entities()].slice(-2).map((e) => e.handle);
    expect(made.map((h) => (before[h] as { text: string }).text)).toEqual(['2026-11-16', '314.16']);
    const saved = save(path, model);
    const doc = readCadDocument(saved);
    // Every text keeps its fields: the codes (the object by its handle), values and text.
    expect(fields(DocumentModel.create(documentInit(doc)))).toEqual(before);
    const roots = made.map((h) => rootOf(doc, h)!);
    expect(roots.map((r) => r.evaluatorId)).toEqual(['_text', '_text']);
    // M4-10 part 3: when each may be evaluated (DXF 91): the Date field on demand only, as
    // AutoCAD makes it, the Object field and the roots on every event.
    expect(
      roots.map((r) => [r.evaluationOptionFlags, r.children[0]!.evaluationOptionFlags]),
    ).toEqual([
      [63, 32],
      [63, 63],
    ]);
    expect(
      roots[1]!.children[0]!.cadObjects.map((o) => o.handle.toString(16).toUpperCase()),
    ).toEqual([circle.handle]);
    // FIELDs of their own, numbered apart, listed when the drawing keeps a FIELDLIST.
    const handles = roots.flatMap(tree).map((f) => f.handle);
    expect(new Set(handles).size).toBe(4);
    const list = listed(doc);
    const keepsList = list.size > 0;
    expect(keepsList).toBe(path === UNCOMMON);
    if (keepsList) for (const h of handles) expect(list.has(h)).toBe(true);
    // Above every handle the engine handed out, under $HANDSEED.
    const seed = doc.header!.handleSeed;
    for (const h of handles) expect(h).toBeLessThan(seed);
  });

  it('gives a copy of a text with fields fields of its own', async () => {
    const model = modelOf(bytesOf(UNCOMMON));
    const bus = session(model);
    const attdef = [...model.entities()].find((e) => e.handle === '5F5')!;
    await bus.script(['COPY']);
    await bus.answer({ kind: 'selection', ids: [attdef.id] });
    await bus.script(['0,0', '0,-5', '']);
    expect(bus.command).toBeUndefined();
    const copy = [...model.entities()].at(-1)!;
    expect(copy.handle).not.toBe('5F5');
    const before = fields(model);
    expect(before[copy.handle]).toEqual(before['5F5']);
    const doc = readCadDocument(save(UNCOMMON, model));
    expect(fields(DocumentModel.create(documentInit(doc)))).toEqual(before);
    const [a, b] = ['5F5', copy.handle].map((h) => tree(rootOf(doc, h)!).map((f) => f.handle));
    expect(a!.filter((h) => b!.includes(h))).toEqual([]);
  });

  it("rebuilds an MTEXT's tree when its fields change, and drops it when they are gone", async () => {
    const model = modelOf(bytesOf(COMPLEX));
    const bus = session(model);
    const texts = [...model.entities()].filter((e) => e.geom.kind === 'MTEXT' && e.geom.field);
    expect(texts.length).toBeGreaterThan(1);
    const [changed, cleared] = texts as [(typeof texts)[0], (typeof texts)[0]];
    const code = (e: typeof changed) => editableFieldText((e.geom as MTextGeometry).field!);
    const original = readCadDocument(bytesOf(COMPLEX));
    const oldTrees = [changed, cleared].map((e) => tree(rootOf(original, e.handle)!));
    // A Date field in the Filename field's place, and the second text's field deleted.
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [changed.id] });
    await bus.answer({
      kind: 'string',
      value: code(changed).replace('\\AcVar Filename \\f "%fn6"', '\\AcVar Date \\f "yyyy"'),
      editor: true,
    });
    await bus.answer({ kind: 'enter' });
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [cleared.id] });
    await bus.answer({
      kind: 'string',
      value: code(cleared).replace('%<\\AcVar Filename \\f "%fn6">%', 'none'),
      editor: true,
    });
    await bus.answer({ kind: 'enter' });
    expect(bus.command).toBeUndefined();
    const before = fields(model);
    expect((before[changed.handle] as { values: string[] }).values).toEqual(['2026']);
    expect(before[cleared.handle]).toBeUndefined();
    const doc = readCadDocument(save(COMPLEX, model));
    expect(fields(DocumentModel.create(documentInit(doc)))).toEqual(before);
    expect(rootOf(doc, cleared.handle)).toBeUndefined();
    const list = listed(doc);
    const newTree = tree(rootOf(doc, changed.handle)!);
    for (const f of newTree) expect(list.has(f.handle)).toBe(true);
    // The old FIELDs are gone from the drawing and its FIELDLIST.
    for (const f of oldTrees.flat()) {
      expect(list.has(f.handle)).toBe(false);
      expect(doc.getCadObject(f.handle)).toBeNull();
    }
    // The other texts keep theirs as read.
    for (const e of texts.slice(2)) {
      expect(tree(rootOf(doc, e.handle)!).map((f) => f.handle)).toEqual(
        tree(rootOf(original, e.handle)!).map((f) => f.handle),
      );
    }
  });
});
