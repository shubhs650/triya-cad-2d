// AcadToTriya and TriyaToAcad for GROUP objects (M1-75 part 23): what GROUP, UNGROUP, GROUPEDIT
// and the Object Grouping dialog do. The drawing is authored in memory with acad-ts and saved
// once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export-groups.corpus.test.ts.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Group as AcadGroup,
  Line,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type Group,
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

/**
 * Lines L0–L4 in model space; L0 and L1 in the named group DOORS ("front doors"), L2 in the
 * unnamed group *A1, which cannot be picked as one.
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  doc.updateCollections(true, false);
  const lines = [0, 1, 2, 3, 4].map((i) => {
    const l = new Line();
    l.startPoint = new XYZ(i, 0, 0);
    l.endPoint = new XYZ(i, 1, 0);
    doc.entities!.add(l);
    return l;
  });
  const doors = doc.groups!.createGroup([lines[0]!, lines[1]!], 'DOORS');
  doors.description = 'front doors';
  const unnamed = doc.groups!.createGroup([lines[2]!], '*A1');
  unnamed.selectable = false;
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const groups = (model: DocumentModel): Group[] =>
  [...model.objects.values()].filter((o): o is Group => o.type === 'GROUP');
const group = (model: DocumentModel, name: string): Group =>
  groups(model).find((g) => g.name === name)!;
const lines = (model: DocumentModel): Entity[] =>
  [...model.entities()].filter((e) => e.type === 'LINE');

/** An object patch with a group's fields. */
const patch = (fields: Partial<Group>) => fields as Partial<NonGraphicalObject>;

/** Gives `entity` the reactors `f` makes of its own. */
function reactors(b: ChangeSetBuilder, e: Entity, f: (rs: Handle[]) => Handle[]): void {
  const cur = b.entity(e.id)!;
  b.updateEntity(e.id, { reactors: f([...(cur.reactors ?? [])]) });
}
const join = (g: Handle) => (rs: Handle[]) => [...rs, g];
const leave = (g: Handle) => (rs: Handle[]) => rs.filter((h) => h !== g);

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

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1014, 'dwg'],
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1021, 'dxf'],
  [ACadVersion.AC1024, 'dwg'],
  [ACadVersion.AC1027, 'dxf'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

describe('GROUP objects', () => {
  it.each(formats)('maps a group with its members, which list it in their reactors (%s)', (f) => {
    const bytes = drawing(ACadVersion.AC1032, f);
    const doc = readCadDocument(bytes);
    const model = open(bytes);
    // acad-ts gives an authored group no reactors; AutoCAD's list the dictionary (the corpus).
    const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadGroup)!;
    const owner = dict.handle.toString(16).toUpperCase();
    const ls = lines(model);
    expect(groups(model).map(comparable)).toEqual([
      {
        handle: group(model, 'DOORS').handle,
        type: 'GROUP',
        owner,
        name: 'DOORS',
        description: 'front doors',
        selectable: true,
        entities: [ls[0]!.handle, ls[1]!.handle],
      },
      {
        handle: group(model, '*A1').handle,
        type: 'GROUP',
        owner,
        name: '*A1',
        description: '',
        selectable: false,
        entities: [ls[2]!.handle],
      },
    ]);
    expect(ls.map((l) => l.reactors ?? [])).toEqual([
      [group(model, 'DOORS').handle],
      [group(model, 'DOORS').handle],
      [group(model, '*A1').handle],
      [],
      [],
    ]);
  });

  it.each(SAVES)('writes every edit of a group (%s %s)', (version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const doors = group(model, 'DOORS');
    const unnamed = group(model, '*A1');
    const [l0, l1, l2, l3] = lines(model);
    edit(model, (b) => {
      // Object Grouping: Rename, Description, Selectable; GROUPEDIT Add and Remove; Reorder.
      b.updateObject(
        doors.handle,
        patch({
          name: 'Windows',
          description: 'rear windows',
          selectable: false,
          entities: [l3!.handle, l0!.handle],
        }),
      );
      reactors(b, l1!, leave(doors.handle));
      reactors(b, l3!, join(doors.handle));
      b.updateObject(
        unnamed.handle,
        patch({ selectable: true, entities: [l2!.handle, l1!.handle] }),
      );
      reactors(b, l1!, join(unnamed.handle));
    });

    const back = documentInit(save(bytes, model, format));
    for (const g of [doors, unnamed]) {
      expect(comparable(back.objects!.find((o) => o.handle === g.handle))).toEqual(
        comparable(model.objects.get(g.handle)),
      );
    }
    const backLines = back.entities!.filter((e) => e.type === 'LINE');
    expect(backLines.map((e) => e.reactors ?? [])).toEqual(
      lines(model).map((e) => e.reactors ?? []),
    );
  });

  it.each(formats)('adds a group and its member reactors in one save (GROUP, %s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const owner = group(model, 'DOORS').owner;
    const [, , , l3, l4] = lines(model);
    let added: Handle = '';
    let line: Handle = '';
    edit(model, (b) => {
      // A new line drawn and grouped with L3 and L4 in the same session.
      const e = b.addEntity({ owner: l3!.owner, layer: l3!.layer, geom: l3!.geom });
      line = e.handle;
      added = b.addObject({
        type: 'GROUP',
        owner,
        reactors: [owner],
        name: 'Stairs',
        description: 'east stair',
        selectable: true,
        entities: [l4!.handle, l3!.handle, e.handle],
      } as Omit<Group, 'handle'>).handle;
      for (const m of [l3!, l4!, e]) reactors(b, m, join(added));
    });

    const reread = save(bytes, model, format);
    const back = documentInit(reread);
    expect(comparable(back.objects!.find((o) => o.handle === added))).toEqual(
      comparable(model.objects.get(added)),
    );
    expect(back.entities!.find((e) => e.handle === line)!.reactors).toEqual([added]);
    const dict = reread.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadGroup)!;
    expect(dict.entryNames).toEqual(['DOORS', '*A1', 'Stairs']);
    expect(dict.getEntry('Stairs')).toBeInstanceOf(AcadGroup);
  });

  it.each(formats)('removes a group and its member reactors (UNGROUP, %s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const doors = group(model, 'DOORS');
    const [l0, l1] = lines(model);
    edit(model, (b) => {
      b.removeObject(doors.handle);
      reactors(b, l0!, leave(doors.handle));
      reactors(b, l1!, leave(doors.handle));
    });

    const reread = save(bytes, model, format);
    const back = documentInit(reread);
    expect(back.objects!.filter((o) => o.type === 'GROUP').map((g) => (g as Group).name)).toEqual([
      '*A1',
    ]);
    expect(reread.getCadObject(Number.parseInt(doors.handle, 16))).toBeNull();
    const dict = reread.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadGroup)!;
    expect(dict.entryNames).toEqual(['*A1']);
    expect(back.entities!.filter((e) => e.type === 'LINE').map((e) => e.reactors ?? [])).toEqual([
      [],
      [],
      [group(model, '*A1').handle],
      [],
      [],
    ]);
  });

  it('saves an erased member that its group lets go of (ERASE)', () => {
    const bytes = drawing();
    const model = open(bytes);
    const doors = group(model, 'DOORS');
    const [l0, l1] = lines(model);
    edit(model, (b) => {
      b.removeEntity(l0!.id);
      b.updateObject(doors.handle, patch({ entities: [l1!.handle] }));
    });
    const back = documentInit(save(bytes, model, 'dxf'));
    expect((back.objects!.find((o) => o.handle === doors.handle) as Group).entities).toEqual([
      l1!.handle,
    ]);
  });

  it('keeps everything else as it was', () => {
    const bytes = drawing();
    const model = open(bytes);
    const doors = group(model, 'DOORS');
    edit(model, (b) => b.updateObject(doors.handle, patch({ description: 'side doors' })));
    const was = documentInit(readCadDocument(bytes));
    const now = documentInit(save(bytes, model, 'dxf'));
    const others = (i: typeof was) => i.objects!.filter((o) => o.handle !== doors.handle);
    expect(others(now)).toEqual(others(was));
    expect(now.entities).toEqual(was.entities);
  });

  it('refuses what AutoCAD does not keep or a save cannot write', () => {
    const cases: [string, (m: DocumentModel, b: ChangeSetBuilder) => void, string][] = [
      [
        'a member that is not an entity of the drawing',
        (m, b) =>
          b.updateObject(
            group(m, 'DOORS').handle,
            patch({ entities: [...group(m, 'DOORS').entities, 'FFFF'] }),
          ),
        'FFFF is not an entity of the drawing',
      ],
      [
        'a member listed twice',
        (m, b) => {
          const d = group(m, 'DOORS');
          b.updateObject(d.handle, patch({ entities: [...d.entities, d.entities[0]!] }));
        },
        `${lines(open(drawing()))[0]!.handle} twice`,
      ],
      [
        'a member that does not point back',
        (m, b) => {
          const d = group(m, 'DOORS');
          b.updateObject(d.handle, patch({ entities: [...d.entities, lines(m)[3]!.handle] }));
        },
        'does not point back at it (reactors)',
      ],
      [
        'an old member that still points at it',
        (m, b) => {
          const d = group(m, 'DOORS');
          b.updateObject(d.handle, patch({ entities: [d.entities[0]!] }));
        },
        'still points at it (reactors)',
      ],
      [
        'a reactor naming a group that does not list the entity',
        (m, b) => reactors(b, lines(m)[3]!, join(group(m, 'DOORS').handle)),
        'is not a leader it annotates, a hatch it bounds, a viewport it clips or a group it is in',
      ],
      [
        'an erased member its group keeps',
        (m, b) => b.removeEntity(lines(m)[0]!.id),
        'still lists the erased',
      ],
      [
        'a name another group has (case aside)',
        (m, b) => b.updateObject(group(m, 'DOORS').handle, patch({ name: '*a1' })),
        'another group is named *a1',
      ],
      [
        'an invalid name',
        (m, b) => b.updateObject(group(m, 'DOORS').handle, patch({ name: 'A<B' })),
        'is not a valid group name',
      ],
      [
        'an unnamed group named otherwise than *A and a number',
        (m, b) => b.updateObject(group(m, '*A1').handle, patch({ name: '*U3' })),
        'an unnamed group is named *A and a number',
      ],
      [
        'a description that is not text',
        (m, b) => b.updateObject(group(m, 'DOORS').handle, patch({ description: 3 as never })),
        'description: 3 is not text',
      ],
      [
        'a selectable flag that is not true or false',
        (m, b) => b.updateObject(group(m, 'DOORS').handle, patch({ selectable: 1 as never })),
        'selectable: 1 is not true or false',
      ],
      [
        'a group moving to another dictionary',
        (m, b) => b.updateObject(group(m, 'DOORS').handle, patch({ owner: '1' })),
        'owner changes',
      ],
      [
        'xdata changes',
        (m, b) =>
          b.updateObject(
            group(m, 'DOORS').handle,
            patch({ xdata: [{ app: 'ACAD', values: [] }] as never }),
          ),
        'xdata changes',
      ],
      [
        'a new group outside ACAD_GROUP',
        (m, b) =>
          b.addObject({
            type: 'GROUP',
            owner: '1',
            name: 'G',
            description: '',
            selectable: true,
            entities: [],
          } as Omit<Group, 'handle'>),
        'a new group belongs in ACAD_GROUP',
      ],
    ];
    const bytes = drawing();
    const problems: string[] = [];
    for (const [what, change, message] of cases) {
      const model = open(bytes);
      edit(model, (b) => change(model, b));
      const got = refusal(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' }));
      if (!got.some((p) => p.includes(message))) problems.push(`${what}: ${JSON.stringify(got)}`);
    }
    expect(problems).toEqual([]);
  });

  it('refuses a new group before R13, which introduced groups', () => {
    const bytes = drawing(ACadVersion.AC1009, 'dxf');
    const model = open(bytes);
    expect(groups(model)).toEqual([]);
    const l3 = lines(model)[3]!;
    edit(model, (b) => {
      const g = b.addObject({
        type: 'GROUP',
        owner: 'A',
        name: 'G',
        description: '',
        selectable: true,
        entities: [l3.handle],
      } as Omit<Group, 'handle'>);
      reactors(b, l3, join(g.handle));
    });
    expect(
      refusal(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).join('\n'),
    ).toContain('AC1009 has no groups (R13 introduced them)');
  });
});
