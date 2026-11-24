// M9-03 part 6: user parameters (the Parameters Manager's New User Parameter, TRIYA_USERPARAMETER
// objects) are saved as XRECORDs of their own in the `TRIYA_CONSTRAINTS` dictionary (DEC-083),
// beside the constraints (DEC-081, DEC-082), and read back into the drawing.
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
  isUserParameter,
  type DimensionalConstraintObject,
  type UserParameterObject,
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

function drawing(): { bytes: Uint8Array; a: string } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const a = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  doc.entities!.add(a);
  return { bytes: writeCadDocument(doc, { format: 'dxf' }), a: hex(a.handle) };
}

const source = drawing();

type User = Omit<UserParameterObject, 'handle' | 'type' | 'owner'>;
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
  const user = (u: User) => add({ type: 'TRIYA_USERPARAMETER', ...u });
  const dimension = (d: Dim) => add({ type: 'TRIYA_DIMCONSTRAINT', ...d });
  const update = (h: string, patch: Partial<User>) => {
    const b = new ChangeSetBuilder(model);
    b.updateObject(h, patch as never);
    model.apply(b.build());
  };
  const remove = (h: string) => {
    const b = new ChangeSetBuilder(model);
    b.removeObject(h);
    model.apply(b.build());
  };
  const objects = () => [...model.objects.values()];
  const users = () => objects().filter(isUserParameter);
  const dims = () => objects().filter(isDimensionalConstraint);
  const save = () => exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
  return { model, user, dimension, update, remove, users, dims, save };
}

function dictionaryOf(bytes: Uint8Array): CadDictionary | undefined {
  const d = readCadDocument(bytes).rootDictionary?.get(TRIYA_CONSTRAINTS);
  return d instanceof CadDictionary ? d : undefined;
}

const groups = (x: unknown) => (x as XRecord).entries.map((e) => [e.code, e.value]);

const d1: Dim = {
  dimension: 'horizontal',
  refs: [
    { entity: source.a, point: 'start' },
    { entity: source.a, point: 'end' },
  ],
  parameter: 'd1',
  expression: 'pitch*2',
  location: { x: 5, y: -3 },
  form: 'dynamic',
};

describe('saving user parameters (TRIYA_CONSTRAINTS, DEC-083)', () => {
  it('writes each as an XRECORD of its own beside the constraints and reads it back', () => {
    const s = open(source.bytes);
    const hp = s.user({ parameter: 'pitch', expression: '5', description: 'Bolt pitch' });
    const hd = s.dimension(d1);
    const hu = s.user({ parameter: 'user2', expression: 'd1/4' });
    const saved = s.save();

    const dict = dictionaryOf(saved)!;
    expect(dict.entryNames).toEqual([hp, hd, hu]);
    expect(groups(dict.getEntry(hp))).toEqual([
      [70, 1],
      [1, 'parameter'],
      [300, 'pitch'],
      [301, '5'],
      [302, 'Bolt pitch'],
    ]);
    expect(groups(dict.getEntry(hu))).toEqual([
      [70, 1],
      [1, 'parameter'],
      [300, 'user2'],
      [301, 'd1/4'],
    ]);

    const back = open(saved);
    const owner = hex(dict.handle);
    expect(back.users()).toEqual([
      expect.objectContaining({
        handle: hp,
        type: 'TRIYA_USERPARAMETER',
        owner,
        parameter: 'pitch',
        expression: '5',
        description: 'Bolt pitch',
      }),
      expect.objectContaining({
        handle: hu,
        type: 'TRIYA_USERPARAMETER',
        owner,
        parameter: 'user2',
        expression: 'd1/4',
      }),
    ]);
    expect(back.users()[1]!.description).toBeUndefined();
    expect(back.dims().map((d) => d.handle)).toEqual([hd]);
  });

  it('saves a drawing whose only parameters are user parameters', () => {
    const s = open(source.bytes);
    const h = s.user({ parameter: 'user1', expression: '1' });
    const back = open(s.save());
    expect(back.users().map((u) => [u.handle, u.parameter, u.expression])).toEqual([
      [h, 'user1', '1'],
    ]);
  });

  it('rewrites a renamed or changed one and leaves out a deleted one', () => {
    const first = open(source.bytes);
    const h1 = first.user({ parameter: 'user1', expression: '1' });
    const h2 = first.user({ parameter: 'user2', expression: '2' });
    const s = open(first.save());
    s.update(h1, { parameter: 'gap', expression: '3.5', description: 'Gap' });
    s.remove(h2);
    const again = s.save();
    const dict = dictionaryOf(again)!;
    expect(dict.entryNames).toEqual([h1]);
    expect(groups(dict.getEntry(h1)).slice(2)).toEqual([
      [300, 'gap'],
      [301, '3.5'],
      [302, 'Gap'],
    ]);
    expect(open(again).users()[0]).toMatchObject({ parameter: 'gap', expression: '3.5' });
  });

  it("refuses a name a constraint's parameter has too, an empty or multi-line one", () => {
    const s = open(source.bytes);
    s.dimension(d1);
    s.user({ parameter: 'd1', expression: '1' });
    expect(() => s.save()).toThrow(UnsupportedChangeError);
    expect(() => s.save()).toThrow(/parameter d1 is another constraint's too/);

    const t = open(source.bytes);
    t.user({ parameter: 'user1', expression: '' });
    expect(() => t.save()).toThrow(/an empty parameter or expression/);

    const u = open(source.bytes);
    u.user({ parameter: 'user1', expression: '1', description: 'a\nb' });
    expect(() => u.save()).toThrow(/the description does not fit one string group/);
  });

  it('keeps a parameter record it cannot read as read, unmapped', () => {
    const s = open(source.bytes);
    const h = s.user({ parameter: 'user1', expression: '1' });
    const doc = readCadDocument(s.save());
    const dict = doc.rootDictionary!.get(TRIYA_CONSTRAINTS) as CadDictionary;
    const good = dict.getEntry(h) as XRecord;
    const copy = (key: string, mutate: (entries: { code: number; value: unknown }[]) => void) => {
      const x = new XRecord();
      for (const e of good.entries) x.createEntry(e.code, e.value as never);
      mutate(x.entries as unknown as { code: number; value: unknown }[]);
      dict.addByKey(key, x);
    };
    copy('NONAME', (e) => {
      e.splice(2, 1);
    });
    copy('EXTRA', (e) => {
      e.push({ code: 331, value: 1 });
    });
    copy('V2', (e) => {
      e[0]!.value = 2;
    });
    const back = open(writeCadDocument(doc, { format: 'dxf' }));
    expect(back.users().map((u) => u.handle)).toEqual([h]);
    back.user({ parameter: 'user2', expression: '2' });
    const out = dictionaryOf(back.save())!;
    expect(out.entryNames).toEqual(expect.arrayContaining(['NONAME', 'EXTRA', 'V2', h]));
    expect(groups(out.getEntry('NONAME'))).toHaveLength(3);
  });
});
