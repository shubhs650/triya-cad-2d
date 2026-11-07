// AcadToTriya and TriyaToAcad for annotative entities (M1-75 part 37): a TEXT's representation
// at each annotation scale (ACDB_TEXTOBJECTCONTEXTDATA_CLASS) is mapped and saved by handle, as
// MOVE (every scale) and a grip edit (the current scale only) change them, and what would leave
// a representation stale or make a new one (annotative creation, DEC-013) is refused. The drawing
// is authored in memory with acad-ts, laid out as AutoCAD lays out an annotative object (the
// context data in the ACDB_ANNOTATIONSCALES dictionary of the entity's AcDbContextDataManager,
// listing that dictionary as its reactor), and saved once, so "the file" is real bytes. The
// corpus edits are in packages/testkit/src/export/export-annotation.corpus.test.ts.
import type { AnnotScaleObjectContextData } from '@node-projects/acad-ts';
import {
  ACadVersion,
  BlockRecord,
  BlockReferenceObjectContextData,
  CadDictionary,
  CadDocument,
  Insert,
  Line,
  Scale,
  TextEntity,
  TextHorizontalAlignment,
  TextObjectContextData,
  XY,
  XYZ,
  type CadObject,
  type Entity as AcadEntity,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type AnnotationRepresentation,
  type Entity,
  type TextGeometry,
  type TextRepresentation,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/** Gives `e` one context data object per scale, as AutoCAD's ANNOTATIVE property does. */
function annotate(e: AcadEntity, data: AnnotScaleObjectContextData[]): void {
  const manager = new CadDictionary('AcDbContextDataManager');
  const scales = new CadDictionary('ACDB_ANNOTATIONSCALES');
  e.createExtendedDictionary().add(manager);
  manager.add(scales);
  data.forEach((d, i) => {
    scales.addByKey(`*A${i + 1}`, d);
    d.addReactor(scales);
  });
}

function textData(
  scale: Scale,
  isDefault: boolean,
  at: XY,
  align: XY,
  rotation: number,
  halign: number,
): TextObjectContextData {
  const c = new TextObjectContextData();
  c.version = 4;
  c.default = isDefault;
  c.scale = scale;
  c.insertionPoint = at;
  c.alignmentPoint = align;
  c.rotation = rotation;
  c.horizontalMode = halign;
  return c;
}

/**
 * Annotative TEXT L (left baseline) at 1:1 and 1:2, its 1:2 representation moved apart with
 * grips; annotative TEXT C (centred) on a −Z plane at 1:1; annotative INSERT I at 1:1 (block
 * context data, which Triya does not map); and a plain LINE.
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const list = new CadDictionary('ACAD_SCALELIST');
  doc.rootDictionary!.add(list);
  const scale = (name: string, drawingUnits: number): Scale => {
    const s = new Scale();
    s.name = name;
    s.paperUnits = 1;
    s.drawingUnits = drawingUnits;
    s.isUnitScale = drawingUnits === 1;
    list.addByKey(`A${list.entryNames.length}`, s);
    return s;
  };
  const one = scale('1:1', 1);
  const two = scale('1:2', 2);
  const add = <T extends CadObject>(e: T): T => {
    doc.entities!.add(e as never);
    return e;
  };
  const left = add(new TextEntity());
  left.value = 'LEFT';
  left.insertPoint = new XYZ(10, 5, 0);
  left.height = 2.5;
  annotate(left, [
    textData(one, true, new XY(10, 5), new XY(0, 0), 0, 0),
    textData(two, false, new XY(14, 9), new XY(0, 0), 0.25, 0),
  ]);
  const centred = add(new TextEntity());
  centred.value = 'MID';
  centred.normal = new XYZ(0, 0, -1);
  centred.horizontalAlignment = TextHorizontalAlignment.Center;
  centred.insertPoint = new XYZ(-30, 20, 0);
  centred.alignmentPoint = new XYZ(-32, 20, 0);
  centred.rotation = 0.5;
  centred.height = 2.5;
  annotate(centred, [textData(one, true, new XY(-30, 20), new XY(-32, 20), 0.5, 1)]);
  const block = new BlockRecord('B');
  block.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(1, 1, 0)));
  doc.blockRecords!.add(block);
  const insert = add(new Insert(block));
  insert.insertPoint = new XYZ(50, 50, 0);
  const ref = new BlockReferenceObjectContextData();
  ref.default = true;
  ref.scale = one;
  ref.insertionPoint = new XYZ(50, 50, 0);
  annotate(insert, [ref]);
  add(new Line(new XYZ(0, 0, 0), new XYZ(100, 0, 0)));
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const byType = (model: DocumentModel, type: string): Entity[] =>
  [...model.entities()].filter((e) => e.type === type);
/** L, C, I and the line as `drawing` adds them. */
function named(model: DocumentModel) {
  const [l, c] = byType(model, 'TEXT');
  return { l: l!, c: c!, i: byType(model, 'INSERT')[0]!, line: byType(model, 'LINE')[0]! };
}
const repsOf = (e: Entity): readonly AnnotationRepresentation[] =>
  e.annotative?.representations ?? [];

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

/** Saves `model` over a fresh read of `bytes`. */
const save = (bytes: Uint8Array, model: DocumentModel, format: CadFormat) =>
  readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

const D = { x: 3, y: -2 };
const moved = (p: { x: number; y: number }) => ({ x: p.x + D.x, y: p.y + D.y });
const movedRep = (t: TextRepresentation, aligned: boolean): TextRepresentation => ({
  ...t,
  position: moved(t.position),
  ...(aligned ? { alignmentPoint: moved(t.alignmentPoint) } : {}),
});
/** MOVE of a text: the text and every representation (a left-baseline one has no 11). */
function move(b: ChangeSetBuilder, e: Entity): void {
  const g = e.geom as TextGeometry;
  const aligned = g.alignmentPoint !== undefined;
  b.updateEntity(e.id, {
    geom: {
      ...g,
      position: moved(g.position),
      ...(g.alignmentPoint ? { alignmentPoint: moved(g.alignmentPoint) } : {}),
    },
    annotative: {
      representations: repsOf(e).map((r) =>
        r.text ? { ...r, text: movedRep(r.text, aligned) } : r,
      ),
    },
  });
}

const hex = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1021, 'dxf'],
  [ACadVersion.AC1021, 'dwg'],
  [ACadVersion.AC1024, 'dxf'],
  [ACadVersion.AC1024, 'dwg'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

describe('annotative entities', () => {
  it.each(SAVES)('maps the representations of each scale (%s %s)', (v, f) => {
    const model = open(drawing(v, f));
    const { l, c, i, line } = named(model);
    const scales = [...model.objects.values()];
    expect(scales).toBeDefined();
    const [one, two] = repsOf(l);
    expect(repsOf(l)).toHaveLength(2);
    expect(one).toMatchObject({
      isDefault: true,
      text: { position: { x: 10, y: 5 }, alignmentPoint: { x: 0, y: 0 }, rotation: 0, halign: 0 },
    });
    expect(two).toMatchObject({
      isDefault: false,
      text: { position: { x: 14, y: 9 }, rotation: 0.25, halign: 0 },
    });
    expect(one!.scale).toBeDefined();
    expect(two!.scale).not.toBe(one!.scale);
    // −Z: OCS (x, y) is plan (−x, y), and the baseline turns to π − θ, as the text's own.
    const g = c.geom as TextGeometry;
    const [rep] = repsOf(c);
    expect(rep!.text).toEqual({
      position: g.position,
      alignmentPoint: g.alignmentPoint,
      rotation: g.rotation,
      halign: 1,
    });
    expect(g.position).toEqual({ x: 30, y: 20 });
    // Block context data is kept as read: its scale, but no values of its own.
    expect(repsOf(i)).toEqual([
      { handle: repsOf(i)[0]!.handle, scale: one!.scale, isDefault: true },
    ]);
    expect(line.annotative).toBeUndefined();
  });

  it.each(SAVES)('saves MOVE of annotative texts with every representation (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { l, c } = named(model);
    edit(model, (b) => {
      move(b, l);
      move(b, c);
    });
    const back = DocumentModel.create(documentInit(save(bytes, model, f)));
    const after = named(model);
    const reopened = named(back);
    expect(reopened.l.annotative).toEqual(after.l.annotative);
    expect(reopened.c.annotative).toEqual(after.c.annotative);
    expect(reopened.c.geom).toEqual(after.c.geom);
    expect(repsOf(reopened.l)[1]!.text!.position).toEqual({ x: 17, y: 7 });
    // The left-baseline text's 11 stays as read.
    expect(repsOf(reopened.l)[0]!.text!.alignmentPoint).toEqual({ x: 0, y: 0 });
  });

  it('writes a −Z text representation in its OCS', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    edit(model, (b) => move(b, named(model).c));
    const doc = save(bytes, model, 'dwg');
    const rep = repsOf(named(model).c)[0]!;
    const c = doc.getCadObject(Number.parseInt(rep.handle, 16)) as TextObjectContextData;
    expect(c).toBeInstanceOf(TextObjectContextData);
    expect([c.insertionPoint.x, c.insertionPoint.y]).toEqual([-33, 18]);
    expect([c.alignmentPoint.x, c.alignmentPoint.y]).toEqual([-35, 18]);
    expect(c.rotation).toBeCloseTo(0.5, 12);
    expect([c.horizontalMode, c.default, c.scale.name]).toEqual([1, true, '1:1']);
  });

  it.each(SAVES)('saves a grip edit of one scale, and the other alone (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { l } = named(model);
    const g = l.geom as TextGeometry;
    // Grips move the current scale's representation (1:1) with the text; 1:2 stays.
    edit(model, (b) =>
      b.updateEntity(l.id, {
        geom: { ...g, position: moved(g.position) },
        annotative: {
          representations: repsOf(l).map((r, i) =>
            i === 0 ? { ...r, text: movedRep(r.text!, false) } : r,
          ),
        },
      }),
    );
    let back = named(DocumentModel.create(documentInit(save(bytes, model, f))));
    expect(back.l.annotative).toEqual(named(model).l.annotative);
    expect(back.l.geom).toEqual(named(model).l.geom);
    // ANNORESET-like: the 1:2 representation alone, put back at the text.
    const bytes2 = exportDocument(readCadDocument(bytes), model, { format: f });
    const model2 = open(bytes2);
    const l2 = named(model2).l;
    const g2 = l2.geom as TextGeometry;
    edit(model2, (b) =>
      b.updateEntity(l2.id, {
        annotative: {
          representations: repsOf(l2).map((r, i) =>
            i === 1 ? { ...r, text: { ...r.text!, position: g2.position, rotation: 0 } } : r,
          ),
        },
      }),
    );
    back = named(DocumentModel.create(documentInit(save(bytes2, model2, f))));
    expect(repsOf(back.l)[1]!.text).toMatchObject({ position: g2.position, rotation: 0 });
  });

  it('saves property and value edits of annotative entities without touching their representations', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { l, i } = named(model);
    edit(model, (b) => {
      b.updateEntity(l.id, { geom: { ...(l.geom as TextGeometry), value: 'EDITED', height: 5 } });
      b.updateEntity(i.id, { color: { kind: 'aci', index: 3 } });
    });
    const back = named(DocumentModel.create(documentInit(save(bytes, model, 'dxf'))));
    expect((back.l.geom as TextGeometry).value).toBe('EDITED');
    expect(back.l.annotative).toEqual(l.annotative);
    expect(back.i.color).toEqual({ kind: 'aci', index: 3 });
    expect(back.i.annotative).toEqual(i.annotative);
  });

  it('refuses a text moved away from every representation', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { l } = named(model);
    const g = l.geom as TextGeometry;
    edit(model, (b) => b.updateEntity(l.id, { geom: { ...g, position: moved(g.position) } }));
    expect(refusal(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' }))).toEqual(
      [
        `TEXT ${l.handle}: the text is placed where none of its annotation scale representations is (AutoCAD keeps a text at the one it draws)`,
      ],
    );
  });

  it('accepts a text moved onto another of its representations', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { l } = named(model);
    const t = repsOf(l)[1]!.text!;
    edit(model, (b) =>
      b.updateEntity(l.id, {
        geom: { ...(l.geom as TextGeometry), position: t.position, rotation: t.rotation },
      }),
    );
    const back = named(DocumentModel.create(documentInit(save(bytes, model, 'dxf'))));
    expect((back.l.geom as TextGeometry).position).toEqual(t.position);
  });

  it('refuses representations added, removed or given another scale (annotative creation)', () => {
    const bytes = drawing();
    const cases: ((e: Entity) => readonly AnnotationRepresentation[])[] = [
      (e) => repsOf(e).slice(0, 1),
      (e) => [...repsOf(e), { ...repsOf(e)[0]!, handle: 'FFFF' }],
      (e) => repsOf(e).map((r, i) => (i === 0 ? { ...r, scale: repsOf(e)[1]!.scale! } : r)),
      (e) => repsOf(e).map((r, i) => (i === 1 ? { ...r, isDefault: true } : r)),
      (e) => [...repsOf(e)].reverse(),
    ];
    for (const change of cases) {
      const model = open(bytes);
      const { l } = named(model);
      edit(model, (b) => b.updateEntity(l.id, { annotative: { representations: change(l) } }));
      expect(
        refusal(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })),
      ).toEqual([
        `TEXT ${l.handle}: annotation scale representations added, removed, reordered or given another scale or default flag (OBJECTSCALE: annotative creation, DEC-013)`,
      ]);
    }
    // Taking the annotative property off a text removes its representations too.
    const model = open(bytes);
    const { c } = named(model);
    edit(model, (b) => b.updateEntity(c.id, { annotative: undefined }));
    expect(
      refusal(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })),
    ).toHaveLength(1);
  });

  it('refuses a new entity with representations (COPY of an annotative text)', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { l } = named(model);
    edit(model, (b) =>
      b.addEntity({ owner: l.owner, layer: l.layer, geom: l.geom, annotative: l.annotative! }),
    );
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/a new annotative object .* DEC-013/);
  });

  it('refuses a shape change of an entity whose representations Triya does not write', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { i } = named(model);
    const g = i.geom as Extract<Entity['geom'], { kind: 'INSERT' }>;
    edit(model, (b) => b.updateEntity(i.id, { geom: { ...g, position: moved(g.position) } }));
    expect(refusal(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' }))).toEqual(
      [
        `INSERT ${i.handle}: an annotative object whose representations at other scales Triya does not write changes shape (they would keep the old one)`,
      ],
    );
  });

  it('refuses a representation that is not a placement, and a text that changes plane', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { l, c } = named(model);
    edit(model, (b) => {
      b.updateEntity(l.id, {
        annotative: {
          representations: repsOf(l).map((r, i) =>
            i === 1 ? { ...r, text: { ...r.text!, halign: 7 } } : r,
          ),
        },
      });
      const { normal: _normal, ...up } = c.geom as TextGeometry;
      b.updateEntity(c.id, { geom: up });
    });
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    expect(problems).toContain(
      `TEXT ${l.handle}: representation ${repsOf(l)[1]!.handle}: horizontal alignment 7 is not 0 to 5`,
    );
    expect(problems).toContain(
      `TEXT ${c.handle}: an annotative text's plane changes (its representations are in its OCS)`,
    );
  });

  it('keeps the drawing as AutoCAD lays it out', () => {
    // The context data stays in its dictionary, listing it as its reactor, after a save.
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    edit(model, (b) => move(b, named(model).l));
    const doc = save(bytes, model, 'dwg');
    const rep = repsOf(named(model).l)[1]!;
    const c = doc.getCadObject(Number.parseInt(rep.handle, 16)) as TextObjectContextData;
    const owner = c.owner as CadDictionary;
    expect(owner.name).toBe('ACDB_ANNOTATIONSCALES');
    expect(c.reactors.map(hex)).toEqual([hex(owner)]);
  });
});
