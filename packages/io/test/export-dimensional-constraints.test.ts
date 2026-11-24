// M9-03 part 3: dimensional constraints (DIMCONSTRAINT's TRIYA_DIMCONSTRAINT objects) are saved
// as XRECORDs of their own in the `TRIYA_CONSTRAINTS` dictionary (DEC-082), beside the geometric
// ones (DEC-081), and read back into the drawing.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Line,
  XRecord,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  isDimensionalConstraint,
  isGeometricConstraint,
  type DimensionalConstraintObject,
  type GeometricConstraintObject,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  TRIYA_CONSTRAINTS,
  UnsupportedChangeError,
  documentInit,
  exportDocument,
  readCadDocument,
  writeCadDocument,
} from '../src/index';

const hex = (n: number) => n.toString(16).toUpperCase();

/** Two lines. */
function drawing(): { bytes: Uint8Array; a: string; b: string } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const a = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  const b = new Line(new XYZ(0, 5, 0), new XYZ(10, 8, 0));
  for (const e of [a, b]) doc.entities!.add(e);
  return { bytes: writeCadDocument(doc, { format: 'dxf' }), a: hex(a.handle), b: hex(b.handle) };
}

const source = drawing();

type Dim = Omit<DimensionalConstraintObject, 'handle' | 'type' | 'owner'>;

function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const owner = model.meta.rootDictionary ?? '0';
  const add = (o: object) => {
    const builder = new ChangeSetBuilder(model);
    const made = builder.addObject({ owner, ...o } as never);
    model.apply(builder.build());
    return made.handle;
  };
  const dimension = (d: Dim) => add({ type: 'TRIYA_DIMCONSTRAINT', ...d });
  const geometric = (o: Pick<GeometricConstraintObject, 'kind' | 'refs'>) =>
    add({ type: 'TRIYA_GEOMCONSTRAINT', ...o });
  const update = (h: string, patch: Partial<Dim>) => {
    const b = new ChangeSetBuilder(model);
    b.updateObject(h, patch as never);
    model.apply(b.build());
  };
  const objects = () => [...model.objects.values()];
  const dims = () => objects().filter(isDimensionalConstraint);
  const save = () => exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
  return { model, dimension, geometric, update, dims, objects, save };
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
      : typeof e.value === 'object' && e.value !== null && 'x' in e.value
        ? [(e.value as XYZ).x, (e.value as XYZ).y]
        : typeof e.value === 'number' && e.code === 331
          ? hex(e.value)
          : e.value,
  ]);

const width: Dim = {
  dimension: 'aligned',
  refs: [{ entity: source.b }],
  parameter: 'width',
  expression: '2*d1',
  description: 'Overall width',
  location: { x: 4, y: 10 },
  form: 'dynamic',
};
const d1: Dim = {
  dimension: 'horizontal',
  refs: [
    { entity: source.a, point: 'start' },
    { entity: source.a, point: 'end' },
  ],
  parameter: 'd1',
  expression: '10',
  location: { x: 5, y: -3 },
  form: 'annotational',
};
const ang: Dim = {
  dimension: 'angular',
  refs: [{ entity: source.a }, { entity: source.b }],
  parameter: 'ang1',
  expression: '16.6992442',
  reference: true,
  location: { x: 12, y: 2 },
  form: 'dynamic',
};

describe('saving dimensional constraints (TRIYA_CONSTRAINTS, DEC-082)', () => {
  it('writes each as an XRECORD of its own beside the geometric ones and reads it back', () => {
    const s = open(source.bytes);
    const p = s.geometric({ kind: 'parallel', refs: [{ entity: source.a }, { entity: source.b }] });
    const hd1 = s.dimension(d1);
    const hw = s.dimension(width);
    const ha = s.dimension(ang);
    const saved = s.save();

    const dict = dictionaryOf(saved)!;
    expect(dict.entryNames).toEqual([p, hd1, hw, ha]);
    expect(groups(dict.getEntry(hd1))).toEqual([
      [70, 1],
      [1, 'dimensional'],
      [2, 'horizontal'],
      [300, 'd1'],
      [301, '10'],
      [280, 0],
      [281, 1],
      [10, [5, -3]],
      [331, source.a],
      [71, 1],
      [90, -1],
      [331, source.a],
      [71, 2],
      [90, -1],
    ]);
    expect(groups(dict.getEntry(hw)).slice(0, 9)).toEqual([
      [70, 1],
      [1, 'dimensional'],
      [2, 'aligned'],
      [300, 'width'],
      [301, '2*d1'],
      [302, 'Overall width'],
      [280, 0],
      [281, 0],
      [10, [4, 10]],
    ]);
    expect(groups(dict.getEntry(ha)).slice(5, 7)).toEqual([
      [280, 1],
      [281, 0],
    ]);

    const back = open(saved);
    expect(
      back
        .objects()
        .filter(isGeometricConstraint)
        .map((c) => c.handle),
    ).toEqual([p]);
    const owner = hex(dict.handle);
    expect(back.dims()).toEqual([
      expect.objectContaining({ handle: hd1, type: 'TRIYA_DIMCONSTRAINT', owner, ...d1 }),
      expect.objectContaining({ handle: hw, type: 'TRIYA_DIMCONSTRAINT', owner, ...width }),
      expect.objectContaining({ handle: ha, type: 'TRIYA_DIMCONSTRAINT', owner, ...ang }),
    ]);
    // Nothing more than what was saved: no reference flag on a driving constraint.
    expect(back.dims()[0]!.reference).toBeUndefined();
    expect(back.dims()[0]!.description).toBeUndefined();
  });

  it("writes a dynamic constraint's DCDISPLAY Hide as 282 1 and reads it back (DEC-084)", () => {
    const s = open(source.bytes);
    const hw = s.dimension({ ...width, hidden: true });
    const ha = s.dimension(ang);
    const saved = s.save();
    const dict = dictionaryOf(saved)!;
    expect(groups(dict.getEntry(hw)).slice(5, 10)).toEqual([
      [302, 'Overall width'],
      [280, 0],
      [281, 0],
      [282, 1],
      [10, [4, 10]],
    ]);
    // A constraint shown has no 282: its record is DEC-082's as it was.
    expect(groups(dict.getEntry(ha)).slice(5, 8)).toEqual([
      [280, 1],
      [281, 0],
      [10, [12, 2]],
    ]);
    const back = open(saved);
    expect(back.dims()[0]).toEqual(expect.objectContaining({ handle: hw, hidden: true }));
    expect(back.dims()[1]!.hidden).toBeUndefined();

    // Shown again, the 282 goes.
    back.update(hw, { hidden: undefined } as never);
    const again = dictionaryOf(back.save())!;
    expect(groups(again.getEntry(hw)).map(([code]) => code)).not.toContain(282);
  });

  it('rewrites a changed expression and leaves out a removed constraint', () => {
    const first = open(source.bytes);
    const hd1 = first.dimension(d1);
    const hw = first.dimension(width);
    const saved = first.save();

    const s = open(saved);
    s.update(hd1, { expression: '12.5' });
    const b = new ChangeSetBuilder(s.model);
    b.removeObject(hw);
    s.model.apply(b.build());
    const again = s.save();
    const dict = dictionaryOf(again)!;
    expect(dict.entryNames).toEqual([hd1]);
    expect(groups(dict.getEntry(hd1))[4]).toEqual([301, '12.5']);
    expect(open(again).dims()[0]!.expression).toBe('12.5');
  });

  it('refuses two constraints with one parameter name, and text that is not one line', () => {
    const s = open(source.bytes);
    s.dimension(d1);
    s.dimension({ ...width, parameter: 'd1' });
    expect(() => s.save()).toThrow(UnsupportedChangeError);
    expect(() => s.save()).toThrow(/parameter d1 is another constraint's too/);

    const t = open(source.bytes);
    t.dimension({ ...width, description: 'two\nlines' });
    expect(() => t.save()).toThrow(/the description does not fit one string group/);
  });

  it('keeps a dimensional record it cannot read as read, unmapped', () => {
    const s = open(source.bytes);
    const h = s.dimension(d1);
    const doc = readCadDocument(s.save());
    const dict = doc.rootDictionary!.get(TRIYA_CONSTRAINTS) as CadDictionary;
    const good = dict.getEntry(h) as XRecord;
    const copy = (key: string, mutate: (entries: { code: number; value: unknown }[]) => void) => {
      const x = new XRecord();
      for (const e of good.entries) x.createEntry(e.code, e.value as never);
      mutate(x.entries as unknown as { code: number; value: unknown }[]);
      dict.addByKey(key, x);
    };
    copy('FORM', (e) => {
      e[6]!.value = 7;
    });
    copy('KIND', (e) => {
      e[2]!.value = 'arclength';
    });
    copy('NOLOC', (e) => {
      e.splice(7, 1);
    });
    // DEC-084: 282 is 1 or absent.
    copy('HIDDEN2', (e) => {
      const x = new XRecord();
      x.createEntry(282, 2);
      e.splice(7, 0, x.entries[0] as never);
    });
    const back = open(writeCadDocument(doc, { format: 'dxf' }));
    expect(back.dims().map((d) => d.handle)).toEqual([h]);
    back.dimension({ ...width, parameter: 'w' });
    const out = dictionaryOf(back.save())!;
    expect(out.entryNames).toEqual(expect.arrayContaining(['FORM', 'KIND', 'NOLOC', 'HIDDEN2', h]));
    expect(groups(out.getEntry('KIND'))[2]).toEqual([2, 'arclength']);
  });
});
