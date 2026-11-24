// M9-04: geometric constraints (M9-05's TRIYA_GEOMCONSTRAINT objects) are saved as XRECORDs of
// the `TRIYA_CONSTRAINTS` dictionary in the named object dictionary (PRD FR-X5, DEC-081), each
// keyed by its handle, and read back into the drawing.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Ellipse,
  Line,
  LwPolyline,
  LwPolylineVertex,
  XRecord,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  isGeometricConstraint,
  type ConstraintRef,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  TRIYA_CONSTRAINTS,
  documentInit,
  exportDocument,
  readCadDocument,
  writeCadDocument,
} from '../src/index';

const hex = (n: number) => n.toString(16).toUpperCase();

/** Two lines, a polyline with an arc segment and an ellipse. */
function drawing(): { bytes: Uint8Array; a: string; b: string; pl: string; el: string } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const a = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  const b = new Line(new XYZ(0, 5, 0), new XYZ(10, 8, 0));
  const v = (x: number, y: number, bulge = 0) => {
    const o = new LwPolylineVertex(new XY(x, y));
    o.bulge = bulge;
    return o;
  };
  const pl = new LwPolyline([v(0, 20), v(10, 20, 1), v(10, 30), v(0, 30)]);
  const el = new Ellipse();
  el.center = new XYZ(30, 0, 0);
  el.majorAxisEndPoint = new XYZ(4, 0, 0);
  el.radiusRatio = 0.5;
  el.startParameter = 0;
  el.endParameter = 2 * Math.PI;
  for (const e of [a, b, pl, el]) doc.entities!.add(e);
  return {
    bytes: writeCadDocument(doc, { format: 'dxf' }),
    a: hex(a.handle),
    b: hex(b.handle),
    pl: hex(pl.handle),
    el: hex(el.handle),
  };
}

const source = drawing();

function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const constrain = (kind: GeometricConstraintKind, refs: ConstraintRef[]) => {
    const builder = new ChangeSetBuilder(model);
    const made = builder.addObject({
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: model.meta.rootDictionary ?? '0',
      kind,
      refs,
    } as Omit<GeometricConstraintObject, 'handle'>);
    model.apply(builder.build());
    return made.handle;
  };
  const constraints = () => [...model.objects.values()].filter(isGeometricConstraint);
  const save = () => exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
  return { model, constrain, constraints, save };
}

function dictionaryOf(bytes: Uint8Array): CadDictionary | undefined {
  const d = readCadDocument(bytes).rootDictionary?.get(TRIYA_CONSTRAINTS);
  return d instanceof CadDictionary ? d : undefined;
}

const groups = (x: unknown) =>
  (x as XRecord).entries.map((e) => [
    e.code,
    typeof e.value === 'object' && e.value !== null && 'handle' in e.value
      ? hex((e.value as { handle: number }).handle)
      : typeof e.value === 'number' && e.code === 331
        ? hex(e.value)
        : e.value,
  ]);

describe('saving geometric constraints (TRIYA_CONSTRAINTS, DEC-081)', () => {
  it('writes each as an XRECORD keyed by its handle and reads it back', () => {
    const s = open(source.bytes);
    const parallel = s.constrain('parallel', [{ entity: source.a }, { entity: source.b }]);
    const coincident = s.constrain('coincident', [
      { entity: source.a, point: 'end' },
      { entity: source.pl, point: 'vertex', index: 2 },
    ]);
    const tangent = s.constrain('tangent', [
      { entity: source.b },
      { entity: source.pl, segment: 1 },
    ]);
    const saved = s.save();

    const dict = dictionaryOf(saved)!;
    expect(dict).toBeDefined();
    expect(dict.entryNames).toEqual([parallel, coincident, tangent]);
    expect(groups(dict.getEntry(parallel))).toEqual([
      [70, 1],
      [1, 'parallel'],
      [331, source.a],
      [71, 0],
      [90, -1],
      [331, source.b],
      [71, 0],
      [90, -1],
    ]);
    expect(groups(dict.getEntry(coincident))).toEqual([
      [70, 1],
      [1, 'coincident'],
      [331, source.a],
      [71, 2],
      [90, -1],
      [331, source.pl],
      [71, 6],
      [90, 2],
    ]);
    expect(groups(dict.getEntry(tangent)).slice(5)).toEqual([
      [331, source.pl],
      [71, 0],
      [90, 1],
    ]);
    // The XRECORDs keep Triya's handles; the dictionary is new, above them and in $HANDSEED.
    const doc = readCadDocument(saved);
    expect(hex(doc.getCadObject(Number.parseInt(parallel, 16))!.handle)).toBe(parallel);
    expect(doc.rootDictionary!.get(TRIYA_CONSTRAINTS)!.owner).toBe(doc.rootDictionary);
    expect(doc.header!.handleSeed).toBeGreaterThan(dict.handle);

    const back = open(saved).constraints();
    expect(back.map((c) => [c.handle, c.kind, c.refs, c.owner])).toEqual([
      [parallel, 'parallel', [{ entity: source.a }, { entity: source.b }], hex(dict.handle)],
      [
        coincident,
        'coincident',
        [
          { entity: source.a, point: 'end' },
          { entity: source.pl, point: 'vertex', index: 2 },
        ],
        hex(dict.handle),
      ],
      [
        tangent,
        'tangent',
        [{ entity: source.b }, { entity: source.pl, segment: 1 }],
        hex(dict.handle),
      ],
    ]);
  });

  it("writes an ellipse's axis end as point 7 with its quadrant (DEC-085) and reads it back", () => {
    const s = open(source.bytes);
    const refs: ConstraintRef[] = [
      { entity: source.el, point: 'quadrant', index: 3 },
      { entity: source.a, point: 'start' },
    ];
    const h = s.constrain('coincident', refs);
    const saved = s.save();
    expect(groups(dictionaryOf(saved)!.getEntry(h)).slice(2, 5)).toEqual([
      [331, source.el],
      [71, 7],
      [90, 3],
    ]);
    expect(
      open(saved)
        .constraints()
        .map((c) => c.refs),
    ).toEqual([refs]);
    // A quadrant past the fourth leaves the record unread.
    const doc = readCadDocument(saved);
    const x = (doc.rootDictionary!.get(TRIYA_CONSTRAINTS) as CadDictionary).getEntry(h) as XRecord;
    x.entries[4]!.value = 4;
    expect(open(writeCadDocument(doc, { format: 'dxf' })).constraints()).toEqual([]);
  });

  it('adds no dictionary to a drawing without constraints', () => {
    const s = open(source.bytes);
    expect(dictionaryOf(s.save())).toBeUndefined();
  });

  it('files new constraints in the dictionary a reopened drawing has, and rewrites changed ones', () => {
    const first = open(source.bytes);
    const h = first.constrain('horizontal', [{ entity: source.a }]);
    const saved = first.save();
    const dict = dictionaryOf(saved)!;

    const s = open(saved);
    const fix = s.constrain('fix', [{ entity: source.pl, point: 'vertex', index: 0 }]);
    const b = new ChangeSetBuilder(s.model);
    b.updateObject(h, { kind: 'vertical', refs: [{ entity: source.b }] } as never);
    s.model.apply(b.build());
    const again = s.save();

    const d = dictionaryOf(again)!;
    expect(d.handle).toBe(dict.handle);
    expect(
      readCadDocument(again).rootDictionary!.entryNames.filter((k) => k === TRIYA_CONSTRAINTS),
    ).toHaveLength(1);
    expect(d.entryNames).toEqual([h, fix]);
    expect(groups(d.getEntry(h))).toEqual([
      [70, 1],
      [1, 'vertical'],
      [331, source.b],
      [71, 0],
      [90, -1],
    ]);
  });

  it('saves a constraint on an erased object as none and keeps the dictionary', () => {
    const first = open(source.bytes);
    const kept = first.constrain('horizontal', [{ entity: source.a }]);
    const gone = first.constrain('equal', [{ entity: source.a }, { entity: source.b }]);
    const saved = first.save();

    const s = open(saved);
    const b = new ChangeSetBuilder(s.model);
    b.removeEntity(s.model.entityByHandle(source.b)!.id);
    s.model.apply(b.build());
    const again = s.save();
    expect(dictionaryOf(again)!.entryNames).toEqual([kept]);
    expect(readCadDocument(again).getCadObject(Number.parseInt(gone, 16))).toBeFalsy();

    // Erased in the session it was made in: never written.
    const t = open(source.bytes);
    t.constrain('vertical', [{ entity: source.b }]);
    const c = new ChangeSetBuilder(t.model);
    c.removeEntity(t.model.entityByHandle(source.b)!.id);
    t.model.apply(c.build());
    expect(dictionaryOf(t.save())).toBeUndefined();
  });

  it('keeps a record it cannot read as read, unmapped', () => {
    const s = open(source.bytes);
    const h = s.constrain('parallel', [{ entity: source.a }, { entity: source.b }]);
    const saved = s.save();
    const doc = readCadDocument(saved);
    const dict = doc.rootDictionary!.get(TRIYA_CONSTRAINTS) as CadDictionary;
    const bad = (mutate: (x: XRecord) => void, key: string) => {
      const x = new XRecord();
      x.createEntry(70, 1);
      x.createEntry(1, 'parallel');
      x.createEntry(331, Number.parseInt(source.a, 16));
      x.createEntry(71, 0);
      x.createEntry(90, -1);
      mutate(x);
      dict.addByKey(key, x);
      return x;
    };
    const later = bad((x) => {
      x.entries[0]!.value = 2;
    }, 'V2');
    const unknown = bad((x) => {
      x.entries[1]!.value = 'smoothest';
    }, 'KIND');
    const missing = bad((x) => {
      x.entries[2]!.value = 0xfffff;
    }, 'GONE');
    const short = bad((x) => {
      // No 90 after the reference's 71.
      x.clear();
      x.createEntry(70, 1);
      x.createEntry(1, 'parallel');
      x.createEntry(331, Number.parseInt(source.a, 16));
      x.createEntry(71, 0);
    }, 'SHORT');
    const bytes = writeCadDocument(doc, { format: 'dxf' });

    const back = open(bytes);
    expect(back.constraints().map((c) => c.handle)).toEqual([h]);
    // Unmapped records stay as read through a save that changes the drawing.
    back.constrain('horizontal', [{ entity: source.a }]);
    const out = dictionaryOf(back.save())!;
    expect(out.entryNames).toEqual(expect.arrayContaining(['V2', 'KIND', 'GONE', 'SHORT', h]));
    for (const x of [later, unknown, missing, short]) {
      const key = dict.entryNames.find((k) => dict.getEntry(k) === x)!;
      expect(groups(out.getEntry(key)).slice(0, 2)).toEqual(groups(x).slice(0, 2));
    }
  });
});
