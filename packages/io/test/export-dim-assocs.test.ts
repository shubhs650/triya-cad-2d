// AcadToTriya and TriyaToAcad for DIMASSOC objects (M1-75 part 35): what keeps an associative
// dimension on its geometry, as DIMASSOC = 2, DIMREASSOCIATE, DIMDISASSOCIATE, ERASE and grip
// edits of the geometry change it. The drawing is authored in memory with acad-ts, linked as
// AutoCAD links one (the DIMASSOC in the dimension's ACAD_DIMASSOC extension dictionary entry,
// listing that dictionary as its reactor; the dimension and the geometry listing the DIMASSOC),
// and saved once, so "the file" is real bytes. The corpus edits are in
// packages/testkit/src/export/export-dim-assocs.corpus.test.ts.
import {
  ACadVersion,
  AssociativityFlags,
  type CadDictionary,
  CadDocument,
  Circle,
  DimensionAligned,
  DimensionAssociationObject,
  DimensionRadius,
  Line,
  ObjectOsnapType,
  OsnapPointRef,
  SubentType,
  XYZ,
  type CadObject,
  type Dimension,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type DimAssoc,
  type DimAssocPoint,
  type Entity,
  type Handle,
  type NonGraphicalObject,
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

function snap(
  osnap: ObjectOsnapType,
  geometry: CadObject,
  point: XYZ,
  parameter = 0,
): OsnapPointRef {
  const p = new OsnapPointRef();
  p.objectOsnapType = osnap;
  p.geometry = geometry;
  p.subentType = SubentType.Edge;
  p.geometryParameter = parameter;
  p.osnapPoint = point;
  return p;
}

/** Associates `dim` as AutoCAD does: its ACAD_DIMASSOC entry, and reactors both ways. */
function associate(dim: Dimension, refs: (OsnapPointRef | null)[]): DimensionAssociationObject {
  const a = new DimensionAssociationObject();
  a.dimension = dim;
  const keys = ['firstPointRef', 'secondPointRef', 'thirdPointRef', 'fourthPointRef'] as const;
  let flags = 0;
  refs.forEach((p, i) => {
    if (!p) return;
    flags |= 1 << i;
    a[keys[i]!] = p;
  });
  a.associativityFlags = flags as AssociativityFlags;
  const dict = dim.createExtendedDictionary();
  dict.addByKey('ACAD_DIMASSOC', a);
  a.addReactor(dict);
  dim.addReactor(a);
  for (const p of refs) if (p && !p.geometry!.reactors.includes(a)) p.geometry!.addReactor(a);
  return a;
}

/**
 * Circle C with an associative radius dimension R (its centre), lines A, B and E, an aligned
 * dimension D from A's end to B's start, and a non-associative aligned dimension N on E.
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const add = <T extends CadObject>(e: T): T => {
    doc.entities!.add(e as never);
    return e;
  };
  const circle = add(new Circle(new XYZ(0, 0, 0), 5));
  const a = add(new Line(new XYZ(10, 0, 0), new XYZ(20, 0, 0)));
  const b = add(new Line(new XYZ(30, 0, 0), new XYZ(30, 10, 0)));
  add(new Line(new XYZ(40, 0, 0), new XYZ(50, 0, 0)));
  const radius = add(new DimensionRadius());
  radius.definitionPoint = new XYZ(0, 0, 0);
  radius.angleVertex = new XYZ(5, 0, 0);
  radius.textMiddlePoint = new XYZ(3, 1, 0);
  const aligned = add(new DimensionAligned());
  aligned.firstPoint = new XYZ(20, 0, 0);
  aligned.secondPoint = new XYZ(30, 0, 0);
  aligned.definitionPoint = new XYZ(30, -5, 0);
  aligned.textMiddlePoint = new XYZ(25, -5, 0);
  const loose = add(new DimensionAligned());
  loose.firstPoint = new XYZ(40, 0, 0);
  loose.secondPoint = new XYZ(50, 0, 0);
  loose.definitionPoint = new XYZ(50, -5, 0);
  loose.textMiddlePoint = new XYZ(45, -5, 0);
  associate(radius, [null, snap(ObjectOsnapType.Center, circle, new XYZ(0, 0, 0))]);
  associate(aligned, [
    snap(ObjectOsnapType.Endpoint, a, new XYZ(20, 0, 0), 1),
    snap(ObjectOsnapType.StartPoint, b, new XYZ(30, 0, 0)),
  ]);
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const assocs = (model: DocumentModel): DimAssoc[] =>
  [...model.objects.values()].filter((o): o is DimAssoc => o.type === 'DIMASSOC');
const byType = (model: DocumentModel, type: string): Entity[] =>
  [...model.entities()].filter((e) => e.type === type);
/** C, A, B, E, R, D, N as `drawing` adds them. */
function named(model: DocumentModel) {
  const [c] = byType(model, 'CIRCLE');
  const [a, b, e] = byType(model, 'LINE');
  const [r, d, n] = byType(model, 'DIMENSION');
  return { c: c!, a: a!, b: b!, e: e!, r: r!, d: d!, n: n! };
}
const assocOf = (model: DocumentModel, dim: Entity): DimAssoc | undefined =>
  assocs(model).find((x) => x.dimension === dim.handle);

/** An object patch with a DIMASSOC's fields. */
const patch = (fields: Partial<DimAssoc>) => fields as Partial<NonGraphicalObject>;

function reactors(b: ChangeSetBuilder, e: Entity, f: (rs: Handle[]) => Handle[]): void {
  const cur = b.entity(e.id)!;
  b.updateEntity(e.id, { reactors: f([...(cur.reactors ?? [])]) });
}
const join = (h: Handle) => (rs: Handle[]) => [...rs, h];
const leave = (h: Handle) => (rs: Handle[]) => rs.filter((x) => x !== h);

/** Saves `model` over a fresh read of `bytes`. */
const save = (bytes: Uint8Array, model: DocumentModel, format: CadFormat) =>
  readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));

const comparable = (o: NonGraphicalObject | undefined) => {
  if (!o) return o;
  const { raw: _raw, ...rest } = o;
  return rest;
};

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

const hex = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1024, 'dxf'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

describe('DIMASSOC objects', () => {
  it.each(SAVES)('maps an associative dimension and its geometry (%s %s)', (v, f) => {
    const model = open(drawing(v, f));
    const { c, a, b, r, d, n } = named(model);
    const radius = assocOf(model, r)!;
    expect(radius.owner).toBe(r.extDict);
    expect(radius.reactors).toEqual([r.extDict]);
    expect(radius.points[0]).toBeNull();
    expect(radius.points[1]).toMatchObject({ osnap: 3, geometry: [c.handle], point: { x: 0 } });
    expect(r.reactors).toEqual([radius.handle]);
    expect(c.reactors).toEqual([radius.handle]);
    const aligned = assocOf(model, d)!;
    expect(aligned.points.map((p) => p?.geometry ?? null)).toEqual([
      [a.handle],
      [b.handle],
      null,
      null,
    ]);
    expect(aligned.points[0]).toMatchObject({ osnap: 1, parameter: 1, point: { x: 20, y: 0 } });
    expect(a.reactors).toEqual([aligned.handle]);
    expect(assocOf(model, n)).toBeUndefined();
  });

  it.each(SAVES)('saves geometry moved with its dimension (%s %s)', (v, f) => {
    // A grip edit of B: its start moves, the aligned dimension and its snapped point follow.
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { b: line, d } = named(model);
    const was = assocOf(model, d)!;
    const moved: DimAssocPoint = { ...was.points[1]!, point: { x: 32, y: 1, z: 0 } };
    edit(model, (b) => {
      const g = line.geom as { start: { x: number; y: number } };
      b.updateEntity(line.id, {
        geom: { ...line.geom, start: { ...g.start, x: 32, y: 1 } } as never,
      });
      b.updateObject(was.handle, patch({ points: [was.points[0], moved, null, null] }));
    });
    const back = DocumentModel.create(documentInit(save(bytes, model, f)));
    expect(comparable(assocOf(back, named(back).d))).toEqual(comparable(assocOf(model, d)));
  });

  it.each(SAVES)('saves DIMDISASSOCIATE (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { c, r } = named(model);
    const h = assocOf(model, r)!.handle;
    edit(model, (b) => {
      b.removeObject(h);
      reactors(b, r, leave(h));
      reactors(b, c, leave(h));
    });
    const doc = save(bytes, model, f);
    expect(doc.getCadObject(Number.parseInt(h, 16))).toBeNull();
    const back = DocumentModel.create(documentInit(doc));
    const after = named(back);
    expect(assocOf(back, after.r)).toBeUndefined();
    expect([after.r.reactors, after.c.reactors]).toEqual([undefined, undefined]);
    // The dimension keeps its (now empty) extension dictionary.
    const dict = doc.getCadObject(Number.parseInt(after.r.extDict!, 16)) as CadDictionary;
    expect(dict.entryNames).toEqual([]);
    expect(assocs(back)).toHaveLength(1);
  });

  it.each(SAVES)('saves an erased associative dimension (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { c, r } = named(model);
    const h = assocOf(model, r)!.handle;
    edit(model, (b) => {
      b.removeEntity(r.id);
      b.removeObject(h);
      reactors(b, c, leave(h));
    });
    const doc = save(bytes, model, f);
    expect(doc.getCadObject(Number.parseInt(h, 16))).toBeNull();
    expect(named(DocumentModel.create(documentInit(doc))).c.reactors).toBeUndefined();
  });

  it.each(SAVES)('saves erased geometry, its point no longer associative (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { a, d } = named(model);
    const was = assocOf(model, d)!;
    edit(model, (b) => {
      b.removeEntity(a.id);
      b.updateObject(was.handle, patch({ points: [null, was.points[1], null, null] }));
    });
    const doc = save(bytes, model, f);
    const acad = doc.getCadObject(Number.parseInt(was.handle, 16)) as DimensionAssociationObject;
    expect(acad.associativityFlags).toBe(AssociativityFlags.SecondPointReference);
    const back = DocumentModel.create(documentInit(doc));
    expect(comparable(assocOf(back, d))).toEqual(comparable(assocOf(model, d)));
  });

  it.each(SAVES)('saves DIMREASSOCIATE of a point onto other geometry (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { b: old, e, d } = named(model);
    const was = assocOf(model, d)!;
    const onE: DimAssocPoint = {
      ...was.points[1]!,
      osnap: 1,
      geometry: [e.handle],
      parameter: 1,
      point: { x: 50, y: 0, z: 0 },
    };
    edit(model, (b) => {
      b.updateObject(was.handle, patch({ points: [was.points[0], onE, null, null] }));
      reactors(b, old, leave(was.handle));
      reactors(b, e, join(was.handle));
    });
    const back = DocumentModel.create(documentInit(save(bytes, model, f)));
    expect(comparable(assocOf(back, d))).toEqual(comparable(assocOf(model, d)));
    const after = named(back);
    expect([after.b.reactors, after.e.reactors]).toEqual([undefined, [was.handle]]);
  });

  it.each(SAVES)('saves a new association with its extension dictionary (%s %s)', (v, f) => {
    // DIMREASSOCIATE of the non-associative N onto E's two ends.
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { e, n } = named(model);
    const end = (osnap: number, x: number, parameter: number): DimAssocPoint => ({
      osnap,
      geometry: [e.handle],
      subentType: 1,
      gsMarker: 0,
      xrefPaths: [],
      parameter,
      point: { x, y: 0, z: 0 },
    });
    let h = '';
    edit(model, (b) => {
      const dict = model.handles.allocate();
      const o = b.addObject({
        type: 'DIMASSOC',
        owner: dict,
        reactors: [dict],
        dimension: n.handle,
        transSpace: false,
        rotatedType: 0,
        points: [end(13, 40, 0), end(1, 50, 1), null, null],
      } as Omit<DimAssoc, 'handle'>);
      h = o.handle;
      b.updateEntity(n.id, { extDict: dict, reactors: [h] });
      reactors(b, e, join(h));
    });
    const doc = save(bytes, model, f);
    const back = DocumentModel.create(documentInit(doc));
    expect(comparable(assocOf(back, named(back).n))).toEqual(comparable(assocOf(model, n)));
    const dim = doc.getCadObject(Number.parseInt(n.handle, 16)) as Dimension;
    expect(hex(dim.xDictionary!)).toBe(assocOf(model, n)!.owner);
    expect(dim.xDictionary!.entryNames).toEqual(['ACAD_DIMASSOC']);
    expect(named(back).e.reactors).toEqual([h]);
  });

  it('refuses links that do not point both ways', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { c, a, b: line, e, r, d } = named(model);
    const radius = assocOf(model, r)!;
    const aligned = assocOf(model, d)!;
    edit(model, (b) => {
      // E is named without listing the DIMASSOC, and B still lists it after it is let go.
      const onE = { ...aligned.points[1]!, geometry: [e.handle] };
      b.updateObject(aligned.handle, patch({ points: [aligned.points[0], onE, null, null] }));
      // DIMDISASSOCIATE without the circle letting go.
      b.removeObject(radius.handle);
      reactors(b, r, leave(radius.handle));
    });
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        `DIMASSOC ${aligned.handle}: point 2: geometry ${e.handle} does not point back at it (reactors)`,
        `DIMASSOC ${aligned.handle}: its old geometry ${line.handle} still points at it (reactors)`,
        `DIMASSOC ${radius.handle}: ${c.handle} still points at it (reactors)`,
      ]),
    );
    expect(problems.some((p) => p.includes(a.handle))).toBe(false);
  });

  it('refuses a DIMASSOC naming erased geometry, an erased dimension, or nothing', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { c, a, r, d } = named(model);
    const radius = assocOf(model, r)!;
    const aligned = assocOf(model, d)!;
    edit(model, (b) => {
      b.removeEntity(a.id);
      b.removeEntity(c.id);
      b.updateObject(aligned.handle, patch({ transSpace: 'no' as never }));
      b.updateObject(radius.handle, patch({ points: [null, null, null, null] }));
    });
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        `DIMASSOC ${aligned.handle}: transSpace: "no" is not true or false`,
        `DIMASSOC ${radius.handle}: no associative point (DIMDISASSOCIATE removes the DIMASSOC)`,
      ]),
    );
    // A's point is unchanged, but A is gone.
    const model2 = open(bytes);
    edit(model2, (b) => b.removeEntity(named(model2).a.id));
    expect(
      refusal(() => exportDocument(readCadDocument(bytes), model2, { format: 'dxf' })),
    ).toEqual(expect.arrayContaining([expect.stringContaining(`still names the erased entity`)]));
  });

  it('refuses a new DIMASSOC outside its dimension, in R14, or on nested geometry', () => {
    const bytes = drawing(ACadVersion.AC1014, 'dwg');
    const model = open(bytes);
    const { e, n } = named(model);
    const p: DimAssocPoint = {
      osnap: 1,
      geometry: [e.handle, e.handle],
      subentType: 1,
      gsMarker: 0,
      xrefPaths: [],
      parameter: 0,
      point: { x: 40, y: 0, z: 0 },
    };
    let h = '';
    edit(model, (b) => {
      const o = b.addObject({
        type: 'DIMASSOC',
        owner: '0',
        reactors: ['0'],
        dimension: n.handle,
        transSpace: false,
        rotatedType: 0,
        points: [p, null, null, null],
      } as Omit<DimAssoc, 'handle'>);
      h = o.handle;
      b.updateEntity(n.id, { reactors: [h] });
      reactors(b, e, join(h));
    });
    const problems = refusal(() =>
      exportDocument(readCadDocument(bytes), model, { format: 'dwg' }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        `DIMASSOC ${h}: AC1014 has no associative dimensions (DIMASSOC came with R2000)`,
        `DIMASSOC ${h}: it must sit in its dimension's extension dictionary`,
        `DIMASSOC ${h}: point 1: geometry is not one entity (a path into a block reference is not written yet)`,
      ]),
    );
  });
});
