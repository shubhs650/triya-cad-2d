// M4-10 part 2: fields made in Triya save as AutoCAD keeps them. FIELD places an MTEXT holding a
// field (a date; an object's area, of a circle drawn in the same session), a COPY of a text
// with fields takes fields of its own, and TEXTEDIT changes or deletes an MTEXT's fields. Each
// save is AC1032 DXF; reopened, every text has the fields it was saved with (codes, objects,
// values), each in its own FIELD objects under its extension dictionary's ACAD_FIELD, listed in
// the drawing's FIELDLIST when it has one, and a text whose fields are gone has none left.
// M4-10 part 4: a TEXT line placed with a field saves its FIELD tree too.
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
  type MultiLeaderGeometry,
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

  it.each([UNCOMMON, CIRCLES])('a TEXT placed with a field in %s gets its tree', async (path) => {
    const model = modelOf(bytesOf(path));
    const bus = session(model);
    await bus.script(['TEXT', '500,420', '2.5', '0']);
    await bus.answer({ kind: 'string', value: 'FILE %<\\AcVar Filename \\f "%tc1%fn2">%' });
    await bus.answer({ kind: 'enter' });
    expect(bus.command).toBeUndefined();
    const text = [...model.entities()].at(-1)!;
    expect(text.geom.kind).toBe('TEXT');
    const before = fields(model);
    expect(before[text.handle]).toEqual({
      text: 'FILE PLAN',
      code: 'FILE %<\\AcVar Filename \\f "%tc1%fn2">%',
      values: ['PLAN'],
    });
    const doc = readCadDocument(save(path, model));
    expect(fields(DocumentModel.create(documentInit(doc)))).toEqual(before);
    const root = rootOf(doc, text.handle)!;
    expect(root.evaluatorId).toBe('_text');
    expect(tree(root)).toHaveLength(2);
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

  it("drops an erased text's fields from the FIELDLIST (found by M5-01: BLOCK erases them)", async () => {
    const model = modelOf(bytesOf(COMPLEX));
    const bus = session(model);
    const texts = [...model.entities()].filter((e) => fieldOf(e.geom) !== undefined);
    expect(texts.length).toBeGreaterThan(0);
    const source = readCadDocument(bytesOf(COMPLEX));
    const gone = new Set(
      texts.flatMap((e) => tree(rootOf(source, e.handle)!).map((f) => f.handle)),
    );
    await bus.script(['ERASE']);
    await bus.answer({ kind: 'selection', ids: texts.map((e) => e.id) });
    const doc = readCadDocument(save(COMPLEX, model));
    expect([...listed(doc)].filter((h) => gone.has(h))).toEqual([]);
    // Nothing in the save is a FIELD without an owner.
    const orphans = [...doc.getCadObjects()].filter(
      (o) => o instanceof Field && (o.owner === null || o.owner === undefined),
    );
    expect(orphans).toEqual([]);
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

// M4-23: a multileader's fields save as AutoCAD keeps an object's text fields: the root `_text`
// FIELD under `TEXT` in the multileader's own ACAD_FIELD dictionary (AcDbObject::setField's
// "TEXT" property, as an MTEXT's), each child a FIELD of its own.
describe('multileader fields save as DXF and read back', () => {
  const SAMPLE = 'third-party/acadsharp/sample_AC1032_ascii.dxf';
  const YEAR = '\\AcVar Date \\f "yyyy"';

  const leaders = (model: DocumentModel) =>
    [...model.entities()].filter((e) => e.geom.kind === 'MULTILEADER');
  const textOf = (model: DocumentModel, handle: string) => {
    const g = model.entityByHandle(handle)!.geom as MultiLeaderGeometry;
    return {
      content: g.text?.content,
      code: g.text?.field && editableFieldText(g.text.field),
      values: g.text?.field?.children.map((c) => c.value),
    };
  };

  it.each([UNCOMMON, SAMPLE])('MLEADER with fields in %s gets its own FIELD tree', async (path) => {
    const model = modelOf(bytesOf(path));
    const bus = session(model);
    await bus.script(['CIRCLE', '500,500', '10']);
    const circle = [...model.entities()].at(-1)!;
    const area = `\\AcObjProp Object(%<\\_ObjId ${circle.handle}>%).Area \\f "%lu2%pr2"`;
    await bus.script(['MLEADER', '0,0', '100,50']);
    await bus.answer({
      kind: 'string',
      value: `Rev %<${YEAR}>%\\PArea %<${area}>%`,
      editor: true,
    });
    expect(bus.command).toBeUndefined();
    const made = leaders(model).at(-1)!;
    const before = textOf(model, made.handle);
    expect(before).toEqual({
      content: 'Rev 2026\\PArea 314.16',
      code: `Rev %<${YEAR}>%\\PArea %<${area}>%`,
      values: ['2026', '314.16'],
    });
    const doc = readCadDocument(save(path, model));
    const back = DocumentModel.create(documentInit(doc));
    expect(textOf(back, made.handle)).toEqual(before);
    const root = rootOf(doc, made.handle)!;
    expect(root.evaluatorId).toBe('_text');
    const fieldsOfIt = tree(root);
    expect(fieldsOfIt).toHaveLength(3);
    expect(root.children[1]!.cadObjects.map((o) => o.handle.toString(16).toUpperCase())).toEqual([
      circle.handle,
    ]);
    const list = listed(doc);
    if (list.size > 0) for (const f of fieldsOfIt) expect(list.has(f.handle)).toBe(true);
    for (const f of fieldsOfIt) expect(f.handle).toBeLessThan(doc.header!.handleSeed);
  });

  it('updates the values in place, rebuilds the tree for new fields, and drops it with them', async () => {
    const model = modelOf(bytesOf(UNCOMMON));
    const bus = session(model);
    await bus.script(['MLEADER', '0,0', '100,50']);
    await bus.answer({ kind: 'string', value: `Rev %<${YEAR}>%`, editor: true });
    const made = leaders(model).at(-1)!;
    const first = readCadDocument(save(UNCOMMON, model));
    const firstTree = tree(rootOf(first, made.handle)!).map((f) => f.handle);

    // Reopened, a later UPDATEFIELD writes the new value onto the same FIELDs.
    const reread = DocumentModel.create(documentInit(first));
    const later = new PromptBus({
      model: reread,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: true }) },
      clock: { now: () => new Date(2027, 0, 2) },
    });
    const leader = reread.entityByHandle(made.handle)!;
    await later.submit('UPDATEFIELD');
    await later.answer({ kind: 'selection', ids: [leader.id] });
    expect(textOf(reread, made.handle).content).toBe('Rev 2027');
    const bytes = withPinnedClock(() =>
      saveAc1032Dxf(readCadDocument(save(UNCOMMON, model)), reread),
    );
    const updated = readCadDocument(bytes);
    expect(tree(rootOf(updated, made.handle)!).map((f) => f.handle)).toEqual(firstTree);
    expect(textOf(DocumentModel.create(documentInit(updated)), made.handle).values).toEqual([
      '2027',
    ]);

    // TEXTEDIT: another field gets a new tree; no field leaves none.
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [made.id] });
    await bus.answer({
      kind: 'string',
      value: 'Rev %<\\AcVar Filename \\f "%tc1%fn2">%',
      editor: true,
    });
    await bus.answer({ kind: 'enter' });
    const rebuilt = readCadDocument(save(UNCOMMON, model));
    expect(textOf(DocumentModel.create(documentInit(rebuilt)), made.handle)).toMatchObject({
      content: 'Rev PLAN',
      values: ['PLAN'],
    });
    const newTree = tree(rootOf(rebuilt, made.handle)!).map((f) => f.handle);
    expect(newTree).toHaveLength(2);
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [made.id] });
    await bus.answer({ kind: 'string', value: 'Rev PLAN', editor: true });
    await bus.answer({ kind: 'enter' });
    const cleared = readCadDocument(save(UNCOMMON, model));
    expect(rootOf(cleared, made.handle)).toBeUndefined();
    expect(textOf(DocumentModel.create(documentInit(cleared)), made.handle)).toEqual({
      content: 'Rev PLAN',
      code: undefined,
      values: undefined,
    });
    const list = listed(cleared);
    for (const h of newTree) expect(list.has(h)).toBe(false);
  });
});
