// M9-03 part 12: the Parameters Manager's group filters (TRIYA_PARAMETERGROUP objects) are saved
// as XRECORDs of their own in the `TRIYA_CONSTRAINTS` dictionary (DEC-086), naming the records of
// the parameters in them, and read back into the drawing.
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
  isParameterGroup,
  isUserParameter,
  type DimensionalConstraintObject,
  type ParameterGroupObject,
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
type Group = Omit<ParameterGroupObject, 'handle' | 'type' | 'owner'>;

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
  const group = (g: Group) => add({ type: 'TRIYA_PARAMETERGROUP', ...g });
  const update = (h: string, patch: Partial<User & Group>) => {
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
  const groupsOf = () => objects().filter(isParameterGroup);
  const save = () => exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
  return { model, user, dimension, group, update, remove, users, dims, groupsOf, save };
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

describe('saving parameter group filters (TRIYA_CONSTRAINTS, DEC-086)', () => {
  it("writes each as an XRECORD naming its parameters' records and reads it back", () => {
    const s = open(source.bytes);
    const hp = s.user({ parameter: 'pitch', expression: '5' });
    const hd = s.dimension(d1);
    const hg = s.group({ name: 'Bolts', members: [hd, hp] });
    const he = s.group({ name: 'Empty', members: [] });
    const saved = s.save();

    const dict = dictionaryOf(saved)!;
    expect(dict.entryNames).toEqual([hp, hd, hg, he]);
    const bolts = groups(dict.getEntry(hg));
    expect(bolts.slice(0, 3)).toEqual([
      [70, 1],
      [1, 'group'],
      [300, 'Bolts'],
    ]);
    // 331: soft pointers to the parameters' records, in the order added.
    expect(bolts.slice(3).map(([c]) => c)).toEqual([331, 331]);
    const pointed = (dict.getEntry(hg) as XRecord).entries
      .slice(3)
      .map((e) =>
        typeof e.value === 'object' ? hex((e.value as XRecord).handle) : hex(Number(e.value)),
      );
    expect(pointed).toEqual([hd, hp]);
    expect(groups(dict.getEntry(he))).toEqual([
      [70, 1],
      [1, 'group'],
      [300, 'Empty'],
    ]);

    const back = open(saved);
    expect(back.groupsOf()).toEqual([
      expect.objectContaining({
        handle: hg,
        type: 'TRIYA_PARAMETERGROUP',
        owner: hex(dict.handle),
        name: 'Bolts',
        members: [hd, hp],
      }),
      expect.objectContaining({ handle: he, name: 'Empty', members: [] }),
    ]);
  });

  it('rewrites a renamed group and leaves out the parameters that are gone', () => {
    const first = open(source.bytes);
    const h1 = first.user({ parameter: 'user1', expression: '1' });
    const h2 = first.user({ parameter: 'user2', expression: '2' });
    const hg = first.group({ name: 'Mine', members: [h1, h2] });
    const s = open(first.save());
    s.remove(h2);
    const kept = open(s.save());
    expect(kept.groupsOf()[0]!.members).toEqual([h1]);
    kept.update(hg, { name: 'Ours' });
    const again = open(kept.save());
    expect(again.groupsOf()[0]).toMatchObject({ name: 'Ours', members: [h1] });
    // A group the save leaves as it was keeps its record untouched.
    expect(open(again.save()).groupsOf()[0]).toMatchObject({ name: 'Ours', members: [h1] });
  });

  it('refuses two groups of one name, any case, and an empty or multi-line name', () => {
    const s = open(source.bytes);
    s.group({ name: 'Mine', members: [] });
    s.group({ name: 'MINE', members: [] });
    expect(() => s.save()).toThrow(UnsupportedChangeError);
    expect(() => s.save()).toThrow(/group filter MINE is another group's too/);
    const t = open(source.bytes);
    t.group({ name: '', members: [] });
    expect(() => t.save()).toThrow(/an empty group filter name/);
    const u = open(source.bytes);
    u.group({ name: 'a\nb', members: [] });
    expect(() => u.save()).toThrow(/the group filter name does not fit one string group/);
  });

  it('keeps a group record it cannot read as read, unmapped', () => {
    const s = open(source.bytes);
    const hp = s.user({ parameter: 'user1', expression: '1' });
    const hg = s.group({ name: 'Mine', members: [hp] });
    const doc = readCadDocument(s.save());
    const dict = doc.rootDictionary!.get(TRIYA_CONSTRAINTS) as CadDictionary;
    const good = dict.getEntry(hg) as XRecord;
    const copy = (key: string, mutate: (entries: { code: number; value: unknown }[]) => void) => {
      const x = new XRecord();
      for (const e of good.entries) x.createEntry(e.code, e.value as never);
      mutate(x.entries as unknown as { code: number; value: unknown }[]);
      dict.addByKey(key, x);
    };
    // No name; a member that is no parameter's record (the drawing's line); another version.
    copy('NONAME', (e) => {
      e.splice(2, 1);
    });
    copy('LINE', (e) => {
      e[3]!.value = Number.parseInt(source.a, 16);
    });
    copy('V2', (e) => {
      e[0]!.value = 2;
    });
    const back = open(writeCadDocument(doc, { format: 'dxf' }));
    expect(back.groupsOf().map((g) => g.handle)).toEqual([hg]);
    back.group({ name: 'Other', members: [] });
    const out = dictionaryOf(back.save())!;
    expect(out.entryNames).toEqual(expect.arrayContaining(['NONAME', 'LINE', 'V2', hg]));
  });
});
