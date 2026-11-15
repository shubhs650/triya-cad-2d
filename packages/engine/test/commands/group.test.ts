// M3-08: groups, as AutoCAD 2024 makes and selects them (AutoCAD Help, "About Groups", "GROUP
// (Command)", "-GROUP (Command)", "UNGROUP (Command)", "GROUPEDIT (Command)", "PICKSTYLE
// (System Variable)", "Object Grouping Dialog Box"):
//   - GROUP makes a named or unnamed (`*A` and a number) group filed in ACAD_GROUP, each member
//     listing it in its reactors; UNGROUP explodes one (the objects stay); GROUPEDIT and -GROUP
//     add, remove, rename, reorder and make selectable; CLASSICGROUP's dialog does it all;
//   - with group selection on (PICKSTYLE bit 1, initially 1) a pick or window that takes a
//     member of a selectable group takes its other members too, not those on frozen or locked
//     layers; Shift takes the group out again.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  PromptBus,
  addToGroup,
  createGroup,
  explodeGroup,
  removeFromGroup,
  selectableMembers,
  builtinCommands,
  copyObjects,
  moveBy,
  GROUPDISPLAYMODE,
  PICKSTYLE,
  type BusEvent,
  type DialogRequest,
  type EntityGeometry,
  type Group,
  type GroupingAction,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { LAYER_0 } from '../model/fixtures';
import { host, setup } from './edit-harness';

const line = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

const DICT = 'A0';
const DOORS = 'A1';
const PAIR = 'A2';

/**
 * Lines 40 (y 0), 41 (y 5), 42 (y 10) and 43 (y 20), x 20 to 30. Group DOORS (A1, "front
 * doors") holds 40 and 41; the unnamed group *A2 (A2) holds 41 and 42 unless `pair` is false.
 */
function drawing(o: { vars?: Record<string, number>; pair?: boolean; dictionary?: boolean } = {}) {
  const vars = o.vars ?? {};
  const pair = o.pair !== false;
  const groups: Group[] = [
    {
      handle: DOORS,
      type: 'GROUP',
      owner: DICT,
      reactors: [DICT],
      name: 'DOORS',
      description: 'front doors',
      selectable: true,
      entities: ['40', '41'],
    },
    ...(pair
      ? [
          {
            handle: PAIR,
            type: 'GROUP' as const,
            owner: DICT,
            reactors: [DICT],
            name: '*A2',
            description: '',
            selectable: true,
            entities: ['41', '42'],
          },
        ]
      : []),
  ];
  const t = setup(
    [
      [line(20, 0, 30, 0), { reactors: [DOORS] }],
      [line(20, 5, 30, 5), { reactors: pair ? [DOORS, PAIR] : [DOORS] }],
      [line(20, 10, 30, 10), pair ? { reactors: [PAIR] } : {}],
      line(20, 20, 30, 20),
    ],
    {
      objects: [{ handle: DICT, type: 'DICTIONARY', owner: 'C' }, ...groups],
      ...(o.dictionary !== false && { meta: { groupDictionary: DICT } }),
    },
  );
  const canvas = host(() => t.model);
  const asked: ViewRequest[] = [];
  const bus = new PromptBus({
    model: t.model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        asked.push(r);
        // The canvas's extents of objects (M3-13: a group's grip sits at their centre).
        if (r.op === 'bounds') {
          if (vars['NO_BOUNDS']) return Promise.resolve({ ok: false, message: 'none' });
          const pts = r.ids.flatMap((id) => {
            const g = t.model.entity(id)?.geom;
            return g?.kind === 'LINE' ? [g.start, g.end] : [];
          });
          if (pts.length === 0) return Promise.resolve({ ok: false, message: 'none' });
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          const box = {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
          };
          return Promise.resolve({ ok: true, box });
        }
        if (r.op === 'sysvar') {
          const value = vars[r.name];
          return Promise.resolve(
            value === undefined ? { ok: false, message: 'no' } : { ok: true, value },
          );
        }
        return canvas.request(r);
      },
    },
  });
  const log: string[] = [];
  const grips: Extract<BusEvent, { type: 'grips' }>[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
    if (e.type === 'grips') grips.push(e);
  });
  const handles = () => bus.selection.map((id) => String(t.model.ids.handleOf(id))).sort();
  const groups_ = () => [...t.model.objects.values()].filter((g): g is Group => g.type === 'GROUP');
  const group = (name: string) => groups_().find((g) => g.name === name);
  const reactors = (h: string) => t.byHandle(h)?.reactors ?? [];
  const dialog = () => {
    const p = bus.prompt;
    return p?.kind === 'dialog'
      ? (p.dialog as Extract<DialogRequest, { type: 'objectgrouping' }>)
      : undefined;
  };
  const press = (grouping: GroupingAction, includeUnnamed?: boolean) =>
    bus.answer({
      kind: 'dialog',
      action: 'apply',
      grouping,
      ...(includeUnnamed !== undefined && { includeUnnamed }),
    });
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  return {
    ...t,
    bus,
    log,
    vars,
    asked,
    handles,
    groups: groups_,
    group,
    reactors,
    dialog,
    press,
    flush,
    grips,
  };
}

describe('group selection (PICKSTYLE)', () => {
  it('a pick on a member takes the whole group, saying how many groups', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('SELECT');
    await t.bus.pick({ x: 25, y: 0 });
    expect(t.handles()).toEqual(['40', '41']);
    expect(t.log.at(-1)).toBe('Select objects: 2 found, 1 group');
    // PICKSTYLE is asked for only when a member is taken.
    await t.bus.pick({ x: 25, y: 20 });
    expect(t.log.at(-1)).toBe('Select objects: 1 found, 3 total');
    expect(t.asked.filter((r) => r.op === 'sysvar').length).toBe(1);
  });

  it('an object in two groups takes both; Shift takes them out again', async () => {
    const t = drawing();
    await t.bus.submit('SELECT');
    await t.bus.pick({ x: 25, y: 5 });
    expect(t.handles()).toEqual(['40', '41', '42']);
    expect(t.log.at(-1)).toBe('Select objects: 3 found, 2 groups');
    await t.bus.pick({ x: 25, y: 0 }, { shift: true });
    expect(t.handles()).toEqual(['42']);
  });

  it('a window holding one member takes the rest, at Command: too', async () => {
    const t = drawing({ pair: false });
    await t.bus.pick({ x: 19, y: -1 });
    await t.bus.pick({ x: 31, y: 1 });
    expect(t.handles()).toEqual(['40', '41']);
  });

  it('PICKSTYLE 0 or 2 takes the member alone, as does an unselectable group', async () => {
    for (const style of [0, 2]) {
      const t = drawing({ pair: false, vars: { PICKSTYLE: style } });
      await t.bus.submit('SELECT');
      await t.bus.pick({ x: 25, y: 0 });
      expect(t.handles()).toEqual(['40']);
    }
    const t = drawing({ pair: false });
    t.model.apply(
      (() => {
        const b = new ChangeSetBuilder(t.model);
        b.updateObject(DOORS, { selectable: false } as Partial<Group>);
        return b.build();
      })(),
    );
    await t.bus.submit('SELECT');
    await t.bus.pick({ x: 25, y: 0 });
    expect(t.handles()).toEqual(['40']);
  });

  it('members on locked or frozen layers are not taken', async () => {
    const t = drawing({ pair: false });
    const b = new ChangeSetBuilder(t.model);
    b.updateEntity(t.byHandle('41')!.id, { layer: LAYER_0 });
    t.model.apply(b.build());
    const lock = new ChangeSetBuilder(t.model);
    lock.updateTableRecord('layers', LAYER_0, { locked: true });
    t.model.apply(lock.build());
    await t.bus.submit('SELECT');
    await t.bus.pick({ x: 25, y: 0 });
    expect(t.handles()).toEqual(['40']);
  });

  it('Last takes the group of the newest object', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('SELECT');
    await t.bus.submit('L');
    expect(t.handles()).toEqual(['43']);
    await t.bus.submit('');
    await t.bus.submit('GROUP');
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    await t.bus.submit('SELECT');
    await t.bus.submit('L');
    expect(t.handles()).toEqual(['40', '41', '43']);
  });
});

describe('GROUP', () => {
  it('groups the objects selected as an unnamed group, linked both ways', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('G');
    expect(t.bus.promptText).toBe('Select objects or [Name/Description]:');
    await t.bus.pick({ x: 25, y: 10 });
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.bus.command).toBeUndefined();
    const g = t.group('*A1')!;
    expect(g).toMatchObject({
      owner: DICT,
      reactors: [DICT],
      description: '',
      selectable: true,
      entities: ['42', '43'],
    });
    expect(t.reactors('42')).toEqual([g.handle]);
    expect(t.reactors('43')).toEqual([g.handle]);
    expect(t.log.at(-1)).toBe('Unnamed group has been created.');
    // One undo step takes it away again, links and all.
    await t.bus.submit('U');
    expect(t.group('*A1')).toBeUndefined();
    expect(t.reactors('42')).toEqual([]);
  });

  it('the next unnamed group is numbered past the highest *A', async () => {
    const t = drawing();
    await t.bus.submit('GROUP');
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('*A3')?.entities).toEqual(['43']);
  });

  it('Name and Description, upper-casing the name; names in use or invalid are refused', async () => {
    const t = drawing();
    await t.bus.submit('GROUP');
    await t.bus.submit('N');
    expect(t.bus.promptText).toBe('Enter a group name or [?]:');
    await t.bus.submit('doors');
    expect(t.log.at(-1)).toBe('A group with this name already exists.');
    await t.bus.submit('two words');
    expect(t.log.at(-1)).toBe('Invalid group name.');
    await t.bus.submit('?');
    expect(t.bus.promptText).toBe('Enter group name(s) to list <*>:');
    await t.bus.submit('');
    expect(t.log.slice(-3)).toEqual(['Defined groups.', '  *A2', '  DOORS  front doors']);
    await t.bus.submit('Windows');
    await t.bus.submit('D');
    expect(t.bus.promptText).toBe('Enter group description:');
    await t.bus.submit('  west side ');
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('WINDOWS')).toMatchObject({ description: 'west side', entities: ['43'] });
    expect(t.log.at(-1)).toBe('Group "WINDOWS" has been created.');
  });

  it('objects selected first are grouped at once', async () => {
    const t = drawing({ pair: false });
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('GROUP');
    expect(t.bus.command).toBeUndefined();
    expect(t.group('*A1')?.entities).toEqual(['43']);
  });

  it('Esc or Enter without objects makes no group', async () => {
    const t = drawing();
    await t.bus.submit('GROUP');
    await t.bus.submit('');
    await t.bus.submit('GROUP');
    await t.bus.submit('N');
    t.bus.cancel();
    await t.flush();
    await t.bus.submit('GROUP');
    await t.bus.submit('D');
    t.bus.cancel();
    await t.flush();
    expect(t.groups()).toHaveLength(2);
  });

  it('a drawing without ACAD_GROUP cannot hold groups', async () => {
    const t = drawing({ dictionary: false });
    for (const c of ['GROUP', '-GROUP', 'CLASSICGROUP']) {
      await t.bus.submit(c);
      expect(t.log.at(-1)).toBe('This drawing cannot hold groups.');
    }
  });
});

describe('UNGROUP', () => {
  it('explodes the group of the object picked; the objects stay', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('UNG');
    expect(t.bus.promptText).toBe('Select group or [Name]:');
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.log.at(-1)).toBe('Object is not a member of any group.');
    // The member is taken alone, whatever PICKSTYLE says.
    await t.bus.pick({ x: 25, y: 0 });
    expect(t.handles()).toEqual(['40']);
    await t.bus.submit('');
    expect(t.bus.command).toBeUndefined();
    expect(t.group('DOORS')).toBeUndefined();
    expect(t.reactors('40')).toEqual([]);
    expect(t.byHandle('40')).toBeDefined();
    expect(t.log.at(-1)).toBe('Group "DOORS" has been exploded.');
  });

  it('an object in two groups: Next shows the other, Accept explodes it', async () => {
    const t = drawing();
    await t.bus.submit('UNGROUP');
    await t.bus.pick({ x: 25, y: 5 });
    await t.bus.submit('');
    expect(t.log.at(-1)).toBe('Object is a member of more than one group.');
    expect(t.bus.promptText).toBe('Group "*A2" [Accept/Next] <Accept>:');
    await t.bus.submit('N');
    expect(t.bus.promptText).toBe('Group "DOORS" [Accept/Next] <Accept>:');
    await t.bus.submit('N');
    await t.bus.submit('');
    expect(t.groups().map((g) => g.name)).toEqual(['DOORS']);
    expect(t.reactors('41')).toEqual([DOORS]);
  });

  it('by Name, and every group of a window or of the objects selected first', async () => {
    let t = drawing();
    await t.bus.submit('UNGROUP');
    await t.bus.submit('N');
    await t.bus.submit('nope');
    expect(t.log.at(-1)).toBe('Group "NOPE" has not been defined.');
    await t.bus.submit('doors');
    expect(t.groups().map((g) => g.name)).toEqual(['*A2']);

    t = drawing();
    await t.bus.submit('UNGROUP');
    await t.bus.submit('ALL');
    await t.bus.submit('');
    expect(t.groups()).toEqual([]);

    t = drawing({ pair: false });
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.submit('UNGROUP');
    expect(t.groups()).toEqual([]);
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('UNGROUP');
    expect(t.log.at(-1)).toBe('Object is not a member of any group.');
  });
});

describe('GROUPEDIT', () => {
  it('Add objects and Remove objects, by a member picked', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('GROUPEDIT');
    await t.bus.pick({ x: 25, y: 20 });
    expect(t.log.at(-1)).toBe('Object is not a member of any group.');
    await t.bus.pick({ x: 25, y: 0 });
    expect(t.bus.promptText).toBe('Enter an option [Add objects/Remove objects/REName]:');
    await t.bus.submit('A');
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('DOORS')?.entities).toEqual(['40', '41', '43']);
    expect(t.reactors('43')).toEqual([DOORS]);

    await t.bus.submit('GROUPEDIT');
    await t.bus.submit('N');
    await t.bus.submit('doors');
    await t.bus.submit('R');
    expect(t.bus.promptText).toBe('Remove objects:');
    await t.bus.pick({ x: 25, y: 5 });
    await t.bus.submit('');
    // Removing every member leaves the group defined.
    expect(t.group('DOORS')?.entities).toEqual(['40', '43']);
    expect(t.reactors('41')).toEqual([]);
  });

  it('REName, refusing a name in use; a group selected first is the one edited', async () => {
    const t = drawing();
    await t.bus.submit('SELECT');
    await t.bus.submit('');
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.submit('GROUPEDIT');
    await t.bus.submit('REN');
    expect(t.bus.promptText).toBe('Enter new name for group or [?] <DOORS>:');
    await t.bus.submit('*a2');
    expect(t.log.at(-1)).toBe('Invalid group name.');
    await t.bus.submit('entry');
    expect(t.group('ENTRY')?.handle).toBe(DOORS);
    // Enter keeps the name.
    await t.bus.submit('GROUPEDIT');
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.submit('REN');
    await t.bus.submit('');
    expect(t.group('ENTRY')).toBeDefined();
  });
});

describe('-GROUP', () => {
  it('Create, then Add, Remove, Selectable and Explode by name', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('-GROUP');
    expect(t.bus.promptText).toBe(
      'Enter a group option [?/Order/Add/Remove/Explode/REName/Selectable/Create] <Create>:',
    );
    await t.bus.submit('');
    await t.bus.submit('steps');
    expect(t.bus.promptText).toBe('Enter a group description:');
    await t.bus.submit('stair');
    await t.bus.pick({ x: 25, y: 10 });
    await t.bus.submit('');
    expect(t.group('STEPS')).toMatchObject({ description: 'stair', entities: ['42'] });

    await t.bus.submit('-GROUP');
    await t.bus.submit('A');
    await t.bus.submit('steps');
    expect(t.log.at(-1)).toBe('Select objects to add to group...');
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('STEPS')?.entities).toEqual(['42', '43']);

    await t.bus.submit('-GROUP');
    await t.bus.submit('R');
    await t.bus.submit('steps');
    expect(t.log.at(-1)).toBe('Select objects to remove from group...');
    await t.bus.pick({ x: 25, y: 10 });
    await t.bus.submit('');
    expect(t.group('STEPS')?.entities).toEqual(['43']);

    await t.bus.submit('-GROUP');
    await t.bus.submit('S');
    await t.bus.submit('steps');
    expect(t.bus.promptText).toBe(
      'This group is selectable. Do you want to make it unselectable? [Yes/No] <Yes>:',
    );
    await t.bus.submit('');
    expect(t.group('STEPS')?.selectable).toBe(false);
    await t.bus.submit('-GROUP');
    await t.bus.submit('S');
    await t.bus.submit('steps');
    await t.bus.submit('N');
    expect(t.group('STEPS')?.selectable).toBe(false);

    await t.bus.submit('-GROUP');
    await t.bus.submit('E');
    await t.bus.submit('steps');
    expect(t.group('STEPS')).toBeUndefined();
    expect(t.reactors('43')).toEqual([]);
  });

  it('Create with no name makes an unnamed group; ? lists by pattern', async () => {
    const t = drawing();
    await t.bus.submit('-GROUP');
    await t.bus.submit('C');
    await t.bus.submit('');
    await t.bus.submit('');
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('*A3')?.entities).toEqual(['43']);
    await t.bus.submit('-GROUP');
    await t.bus.submit('?');
    await t.bus.submit('d*');
    expect(t.log.slice(-2)).toEqual(['Defined groups.', '  DOORS  front doors']);
    await t.bus.submit('-GROUP');
    await t.bus.submit('?');
    await t.bus.submit('x*');
    expect(t.log.at(-1)).toBe('No matching groups found.');
  });

  it('REName and Order (a range moved, or the whole order reversed)', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('-GROUP');
    await t.bus.submit('REN');
    await t.bus.submit('doors');
    await t.bus.submit('gates');
    expect(t.group('GATES')).toBeDefined();
    await t.bus.submit('GROUPEDIT');
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.submit('A');
    await t.bus.pick({ x: 25, y: 10 });
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('GATES')?.entities).toEqual(['40', '41', '42', '43']);

    await t.bus.submit('-GROUP');
    await t.bus.submit('O');
    await t.bus.submit('gates');
    expect(t.bus.promptText).toBe(
      'Enter position number of the object to reorder (0-3) or [Reverse order]:',
    );
    await t.bus.submit('7');
    expect(t.log.at(-1)).toBe('Value must be between 0 and 3.');
    await t.bus.submit('2');
    expect(t.bus.promptText).toBe('Replace at position <0-3>:');
    await t.bus.submit('0');
    expect(t.bus.promptText).toBe('Number of objects to reorder <1>:');
    await t.bus.submit('2');
    expect(t.group('GATES')?.entities).toEqual(['42', '43', '40', '41']);

    await t.bus.submit('-GROUP');
    await t.bus.submit('O');
    await t.bus.submit('gates');
    await t.bus.submit('R');
    expect(t.group('GATES')?.entities).toEqual(['41', '40', '43', '42']);
  });

  it('a group of one has nothing to reorder', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('GROUPEDIT');
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.submit('R');
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.submit('');
    await t.bus.submit('-GROUP');
    await t.bus.submit('O');
    await t.bus.submit('doors');
    expect(t.log.at(-1)).toBe('There is nothing to reorder.');
  });
});

describe('CLASSICGROUP (Object Grouping)', () => {
  it('lists the groups alphabetically, unnamed ones flagged', async () => {
    const t = drawing();
    await t.bus.submit('CLASSICGROUP');
    expect(t.bus.promptText).toBe('Object Grouping:');
    expect(t.dialog()).toEqual({
      type: 'objectgrouping',
      includeUnnamed: false,
      groups: [
        { name: '*A2', description: '', selectable: true, unnamed: true, members: 2 },
        { name: 'DOORS', description: 'front doors', selectable: true, unnamed: false, members: 2 },
      ],
    });
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(t.bus.command).toBeUndefined();
  });

  it('New picks the objects and comes back with the group selected; refusals are noted', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('CLASSICGROUP');
    const make = { op: 'new' as const, description: ' hall ', selectable: true, unnamed: false };
    await t.press({ ...make, name: '' });
    expect(t.dialog()?.note).toBe('A group needs a name, or check Unnamed.');
    await t.press({ ...make, name: 'Doors' });
    expect(t.dialog()?.note).toBe('A group with this name already exists.');
    await t.press({ ...make, name: 'a b' });
    expect(t.dialog()?.note).toBe('Invalid group name.');
    await t.press({ ...make, name: 'Hall' });
    expect(t.bus.promptText).toBe('Select objects for grouping:');
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('HALL')).toMatchObject({ description: 'hall', entities: ['43'] });
    expect(t.dialog()?.selected).toBe('HALL');
    expect(t.dialog()?.note).toBeUndefined();
    // Unnamed, not selectable; Include Unnamed turns on to show it. No objects: no group.
    await t.press({ ...make, name: '', unnamed: true, selectable: false });
    await t.bus.submit('');
    expect(t.groups()).toHaveLength(2);
    await t.press({ ...make, name: '', unnamed: true, selectable: false });
    await t.bus.pick({ x: 25, y: 10 });
    await t.bus.submit('');
    expect(t.group('*A1')).toMatchObject({ selectable: false, entities: ['42'] });
    expect(t.dialog()).toMatchObject({ selected: '*A1', includeUnnamed: true });
  });

  it('Add, Remove, Rename, Description, Selectable, Re-Order and Explode', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('CLASSICGROUP');
    await t.press({ op: 'add', group: 'DOORS' }, true);
    await t.bus.pick({ x: 25, y: 20 });
    await t.bus.submit('');
    expect(t.group('DOORS')?.entities).toEqual(['40', '41', '43']);
    expect(t.dialog()).toMatchObject({ selected: 'DOORS', includeUnnamed: true });
    await t.press({ op: 'remove', group: 'DOORS' });
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.submit('');
    expect(t.group('DOORS')?.entities).toEqual(['41', '43']);
    await t.press({ op: 'reverse', group: 'DOORS' });
    expect(t.group('DOORS')?.entities).toEqual(['43', '41']);
    await t.press({ op: 'reorder', group: 'DOORS', from: 1, to: 0, count: 1 });
    expect(t.group('DOORS')?.entities).toEqual(['41', '43']);
    await t.press({ op: 'description', group: 'DOORS', description: 'back' });
    await t.press({ op: 'selectable', group: 'DOORS', selectable: false });
    expect(t.group('DOORS')).toMatchObject({ description: 'back', selectable: false });
    await t.press({ op: 'rename', group: 'DOORS', name: 'bad name' });
    expect(t.dialog()?.note).toBe('Invalid group name.');
    await t.press({ op: 'rename', group: 'DOORS', name: 'exits' });
    expect(t.dialog()?.selected).toBe('EXITS');
    await t.press({ op: 'explode', group: 'nope' });
    expect(t.dialog()?.note).toBe('Group "NOPE" has not been defined.');
    await t.press({ op: 'explode', group: 'exits' });
    expect(t.groups()).toEqual([]);
    expect(t.dialog()?.selected).toBeUndefined();
    expect(t.reactors('41')).toEqual([]);
  });

  it('Highlight shows the members until Enter; Find Name lists the groups of an object', async () => {
    const t = drawing();
    await t.bus.submit('CLASSICGROUP');
    await t.press({ op: 'highlight', group: 'doors' });
    expect(t.bus.promptText).toBe('Press ENTER to continue:');
    expect(t.handles()).toEqual(['40', '41']);
    await t.bus.submit('');
    expect(t.handles()).toEqual([]);
    await t.press({ op: 'find' });
    expect(t.bus.promptText).toBe('Pick a member of a group:');
    await t.bus.pick({ x: 25, y: 5 });
    expect(t.dialog()?.memberOf).toEqual(['*A2', 'DOORS']);
    await t.press({ op: 'find' });
    await t.bus.pick({ x: 25, y: 20 });
    expect(t.dialog()?.memberOf).toEqual([]);
    t.bus.cancel();
    await t.flush();
    expect(t.bus.command).toBeUndefined();
  });
});

describe('Enter with no answer, and other edges', () => {
  /** Runs `steps` (typed text, or ENTER: Enter with no answer) and says whether it ended. */
  const ENTER = { enter: true } as const;
  async function run(
    t: ReturnType<typeof drawing>,
    steps: (string | typeof ENTER | [number, number])[],
  ) {
    for (const s of steps) {
      if (typeof s === 'string') await t.bus.submit(s);
      else if (Array.isArray(s)) await t.bus.pick({ x: s[0], y: s[1] });
      else await t.bus.answer({ kind: 'enter' });
    }
    await t.flush();
    return t.bus.command;
  }

  it('ends every prompt without a change', async () => {
    const cases: (string | typeof ENTER | [number, number])[][] = [
      ['-GROUP', '?', ENTER],
      ['-GROUP', 'E', ENTER],
      ['-GROUP', 'E', '?', '', ENTER],
      ['-GROUP', 'C', 'x1', ENTER, ''],
      ['-GROUP', 'C', 'x1', 'd', ''],
      ['-GROUP', 'REN', ENTER],
      ['-GROUP', 'REN', 'doors', ENTER],
      ['-GROUP', 'A', 'doors', ''],
      ['-GROUP', 'O', 'doors', ENTER],
      ['GROUP', 'N', ENTER, ''],
      ['GROUP', 'D', ENTER, ''],
      ['UNGROUP', ENTER],
      ['UNGROUP', 'N', ENTER],
      ['GROUPEDIT', ENTER],
      ['GROUPEDIT', [25, 0], ENTER],
      ['GROUPEDIT', [25, 0], 'A', ''],
      ['CLASSICGROUP', ENTER],
    ];
    for (const steps of cases) {
      const t = drawing();
      const before = JSON.stringify(t.groups());
      expect(await run(t, steps), JSON.stringify(steps)).toBeUndefined();
      expect(JSON.stringify(t.groups()), JSON.stringify(steps)).toBe(before);
    }
  });

  it('-GROUP Order ends on Enter at its position prompts', async () => {
    for (const later of [[ENTER], ['0', ENTER]] as const) {
      const t = drawing();
      expect(await run(t, ['-GROUP', 'O', 'doors', ...later])).toBeUndefined();
      expect(t.group('DOORS')?.entities).toEqual(['40', '41']);
    }
  });

  it('GROUP: Name answered by Enter keeps the group unnamed; ? lists every group', async () => {
    const t = drawing();
    await run(t, ['GROUP', 'N', '', [25, 20], '']);
    expect(t.group('*A3')?.entities).toEqual(['43']);
    await t.bus.submit('-GROUP');
    await t.bus.submit('?');
    await t.bus.answer({ kind: 'string', value: '' });
    expect(t.log.slice(-4)).toEqual(['Defined groups.', '  *A2', '  *A3', '  DOORS  front doors']);
  });

  it('Object Grouping: Find with nothing picked, Add with nothing, a rename to its own name', async () => {
    const t = drawing({ pair: false });
    await t.bus.submit('CLASSICGROUP');
    await t.press({ op: 'find' });
    await t.bus.answer({ kind: 'enter' });
    expect(t.dialog()?.memberOf).toBeUndefined();
    await t.press({ op: 'add', group: 'DOORS' });
    await t.bus.submit('');
    expect(t.group('DOORS')?.entities).toEqual(['40', '41']);
    await t.press({ op: 'rename', group: 'DOORS', name: 'doors' });
    expect(t.dialog()).toMatchObject({ selected: 'DOORS' });
    expect(t.dialog()?.note).toBeUndefined();
  });
});

describe('group edits', () => {
  it('skip objects that are gone or in another space, and do nothing twice', () => {
    const t = drawing({ pair: false });
    const doors = t.group('DOORS')!;
    const b = new ChangeSetBuilder(t.model);
    b.updateObject(DOORS, { entities: ['40', '41', '99', '31'] } as Partial<Group>);
    const paper = t.model.ids.idOf('31')!;
    b.moveEntity(paper, '1B');
    t.model.apply(b.build());
    const now = t.group('DOORS')!;
    expect(selectableMembers(t.model, now, '1F').map((id) => t.model.ids.handleOf(id))).toEqual([
      '40',
      '41',
    ]);

    const e = new ChangeSetBuilder(t.model);
    const id40 = t.byHandle('40')!.id;
    // Already a member, or not one: nothing to add or remove.
    expect(addToGroup(e, t.model, doors, [id40])).toBe(0);
    expect(removeFromGroup(e, t.model, doors, [t.byHandle('43')!.id])).toBe(0);
    explodeGroup(e, t.model, now);
    explodeGroup(e, t.model, now);
    expect(e.object(DOORS)).toBeUndefined();
    // A drawing without ACAD_GROUP makes no group.
    const bare = drawing({ dictionary: false });
    const n = new ChangeSetBuilder(bare.model);
    expect(createGroup(n, bare.model, { ids: [bare.byHandle('43')!.id] })).toBeUndefined();
  });
});

// M3-13 (AutoCAD 2024 Help, "GROUPDISPLAYMODE (System Variable)", "About Groups", "PICKSTYLE
// (System Variable)"): a whole group selected with group selection on shows one grip at its
// centre (GROUPDISPLAYMODE 1), with its bounding box (2, the initial value), or every member's
// grips (0); a copy of a whole group is a new unnamed group; PICKSTYLE 2 takes an associative
// hatch's boundary objects with it.
describe('group grips (GROUPDISPLAYMODE)', () => {
  const ids = (t: ReturnType<typeof drawing>, ...hs: string[]) => hs.map((h) => t.byHandle(h)!.id);

  it('a whole group selected at Command: shows its centre grip and box, not its members’', async () => {
    const t = drawing({ pair: false });
    await t.bus.pick({ x: 25, y: 0 });
    expect(t.handles()).toEqual(['40', '41']);
    expect(t.grips.at(-1)).toEqual({
      type: 'grips',
      ids: [],
      groups: [{ ids: ids(t, '40', '41'), box: true }],
    });
    // An object outside the group keeps its own grips.
    await t.bus.pick({ x: 25, y: 20 });
    expect(t.grips.at(-1)).toEqual({
      type: 'grips',
      ids: ids(t, '43'),
      groups: [{ ids: ids(t, '40', '41'), box: true }],
    });
  });

  it('GROUPDISPLAYMODE 1 shows the grip without the box; 0 every member’s grips', async () => {
    const t = drawing({ pair: false });
    t.bus.setPickVariable(GROUPDISPLAYMODE, 1);
    await t.bus.pick({ x: 25, y: 0 });
    expect(t.grips.at(-1)).toEqual({
      type: 'grips',
      ids: [],
      groups: [{ ids: ids(t, '40', '41') }],
    });
    t.bus.setPickVariable(GROUPDISPLAYMODE, 0);
    await t.bus.pick({ x: 25, y: 20 });
    expect(t.grips.at(-1)).toEqual({ type: 'grips', ids: ids(t, '40', '41', '43') });
  });

  it('group selection off, or part of a group selected, shows the objects’ own grips', async () => {
    const t = drawing({ pair: false, vars: { PICKSTYLE: 0 } });
    t.bus.setPickVariable(PICKSTYLE, 0);
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.pick({ x: 25, y: 5 });
    expect(t.grips.at(-1)).toEqual({ type: 'grips', ids: ids(t, '40', '41') });
    const part = drawing({ pair: false, vars: { PICKSTYLE: 0 } });
    await part.bus.pick({ x: 25, y: 0 });
    expect(part.grips.at(-1)).toEqual({ type: 'grips', ids: ids(part, '40') });
  });

  it('the centre grip moves the whole group, then cycles the grip modes', async () => {
    const t = drawing({ pair: false });
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.pick({ x: 30, y: 20 });
    // Not on the centre grip (25, 2.5) nor on 43's: a pick, which leaves the selection be.
    await t.bus.pick({ x: 25.2, y: 2.6 }, { grip: 0.5 });
    expect(t.bus.command).toBe('GRIP');
    expect(t.log).toContain('** STRETCH **');
    expect(t.grips.at(-1)).toMatchObject({ hot: { x: 25, y: 2.5 } });
    expect(t.bus.prompt).toMatchObject({ drag: { kind: 'move', from: { x: 25, y: 2.5 } } });
    await t.bus.pick({ x: 35, y: 2.5 });
    expect(t.bus.command).toBeUndefined();
    const at = (h: string) => t.byHandle(h)!.geom as { start: { x: number; y: number } };
    expect([at('40').start, at('41').start, at('43').start]).toEqual([
      { x: 30, y: 0 },
      { x: 30, y: 5 },
      { x: 30, y: 20 },
    ]);
    // Copy keeps the group and makes another, unnamed.
    await t.bus.pick({ x: 35, y: 2.5 }, { grip: 0.5 });
    await t.bus.submit('C');
    await t.bus.pick({ x: 35, y: 52.5 });
    await t.bus.pick({ x: 35, y: 102.5 });
    expect(
      t
        .groups()
        .map((g) => g.name)
        .sort(),
    ).toEqual(['*A1', '*A2', 'DOORS']);
    // Undo takes the last copy back with its group.
    await t.bus.submit('U');
    expect(
      t
        .groups()
        .map((g) => g.name)
        .sort(),
    ).toEqual(['*A1', 'DOORS']);
    await t.bus.submit('');
    // Enter goes on to MOVE from the group's grip.
    await t.bus.pick({ x: 35, y: 2.5 }, { grip: 0.5 });
    await t.bus.submit('');
    expect(t.log.at(-1)).toBe('** MOVE **');
  });

  it('a group the canvas finds no extents for shows no grip to click', async () => {
    const t = drawing({ pair: false, vars: { NO_BOUNDS: 1 } });
    await t.bus.pick({ x: 25, y: 0 });
    await t.bus.pick({ x: 25, y: 2.5 }, { grip: 0.5 });
    expect(t.bus.command).toBeUndefined();
  });
});

describe('copies of a whole group (M3-13)', () => {
  it('COPY makes each copy of a whole group a new unnamed group, in the group’s order', async () => {
    const t = drawing();
    await t.bus.script(['COPY', '25,5', '', '0,0', '0,100', '0,200', '']);
    // 40, 41, 42 (both groups whole) copied twice: four groups more.
    const made = t.groups().filter((g) => g.handle !== DOORS && g.handle !== PAIR);
    expect(made.map((g) => g.name).sort()).toEqual(['*A3', '*A4', '*A5', '*A6']);
    for (const g of made) {
      expect(g.entities).toHaveLength(2);
      for (const h of g.entities) expect(t.reactors(h)).toContain(g.handle);
    }
    const y = (h: string) => (t.byHandle(h)!.geom as { start: { y: number } }).start.y;
    // DOORS' copies are 40's and 41's, in that order.
    expect(made.map((g) => g.entities.map(y))).toContainEqual([100, 105]);
    expect(made.map((g) => g.entities.map(y))).toContainEqual([105, 110]);
    // COPY's Undo takes a copy back with its groups.
    await t.bus.script(['COPY', '25,20', '', '0,0', '0,100', 'U', '']);
    expect(t.groups()).toHaveLength(6);
  });

  it('part of a group copied makes no group; MIRROR and Array copies make them', async () => {
    const t = drawing({ pair: false, vars: { PICKSTYLE: 0 } });
    await t.bus.script(['COPY', '25,0', '', '0,0', '0,100', '']);
    expect(t.groups()).toHaveLength(1);
    const m = drawing({ pair: false });
    await m.bus.script(['MIRROR', '25,0', '', '0,-50', '10,-50', 'N']);
    expect(
      m
        .groups()
        .map((g) => g.name)
        .sort(),
    ).toEqual(['*A1', 'DOORS']);
    const a = drawing({ pair: false });
    await a.bus.script(['COPY', '25,0', '', '0,0', 'A', '3', '0,100']);
    expect(
      a
        .groups()
        .map((g) => g.name)
        .sort(),
    ).toEqual(['*A1', '*A2', 'DOORS']);
  });

  it('an array of a group makes each item a group; copies into a block make none', async () => {
    const t = drawing({ pair: false });
    const b = new ChangeSetBuilder(t.model);
    const r = copyObjects(
      b,
      t.model,
      [t.byHandle('40')!.id, t.byHandle('41')!.id],
      moveBy({ x: 0, y: 50 }),
    );
    t.model.apply(b.build());
    const copy = t.group('*A1')!;
    expect(copy.entities).toEqual(r.ids.map((id) => t.model.ids.handleOf(id)));
    const n = new ChangeSetBuilder(t.model);
    copyObjects(
      n,
      t.model,
      [t.byHandle('40')!.id, t.byHandle('41')!.id],
      moveBy({ x: 0, y: 50 }),
      {},
      '1F',
    );
    t.model.apply(n.build());
    expect(t.group('*A2')).toBeUndefined();
    // A drawing without ACAD_GROUP copies the objects alone.
    const bare = drawing({ pair: false, dictionary: false });
    const e = new ChangeSetBuilder(bare.model);
    expect(
      copyObjects(
        e,
        bare.model,
        [bare.byHandle('40')!.id, bare.byHandle('41')!.id],
        moveBy({ x: 0, y: 50 }),
      ).ids,
    ).toHaveLength(2);
  });
});

describe('associative hatch selection (PICKSTYLE 2)', () => {
  /** Lines 40 to 43 bound hatch 44 (associative unless told); line 45 stands apart. */
  function hatched(vars: Record<string, number>, associative = true) {
    const t = setup([
      [line(0, 0, 10, 0), { reactors: ['44'] }],
      [line(10, 0, 10, 10), { reactors: ['44'] }],
      [line(10, 10, 0, 10), { reactors: ['44'] }],
      [line(0, 10, 0, 0), { reactors: ['44'] }],
      {
        kind: 'HATCH',
        pattern: 'SOLID',
        solid: true,
        associative,
        style: 0,
        patternType: 1,
        patternAngle: 0,
        patternScale: 1,
        double: false,
        loops: [
          {
            flags: 1,
            edges: [],
            ...(associative && { sources: ['40', '41', '42', '43'] }),
          },
        ],
        patternLines: [],
        seedPoints: [],
      } as EntityGeometry,
    ]);
    const canvas = host(() => t.model);
    const asked: ViewRequest[] = [];
    const bus = new PromptBus({
      model: t.model,
      registry: builtinCommands(),
      view: {
        request: (r) => {
          asked.push(r);
          if (r.op === 'sysvar' && vars[r.name] !== undefined) {
            return Promise.resolve({ ok: true, value: vars[r.name]! });
          }
          return canvas.request(r);
        },
      },
    });
    const log: string[] = [];
    bus.on((e) => e.type === 'log' && log.push(e.line));
    const handles = () => bus.selection.map((id) => String(t.model.ids.handleOf(id))).sort();
    return { ...t, bus, asked, log, handles };
  }

  it('PICKSTYLE 2 or 3 takes the hatch with its boundary; 0 and 1 the hatch alone', async () => {
    for (const style of [2, 3]) {
      const t = hatched({ PICKSTYLE: style });
      await t.bus.script(['SELECT', 'L']);
      expect(t.handles()).toEqual(['40', '41', '42', '43', '44']);
      expect(t.log.at(-1)).toBe('Select objects: L 5 found');
    }
    for (const style of [0, 1]) {
      const t = hatched({ PICKSTYLE: style });
      await t.bus.script(['SELECT', 'L']);
      expect(t.handles()).toEqual(['44']);
    }
  });

  it('a hatch that is not associative asks nothing; boundaries on frozen layers stay out', async () => {
    const t = hatched({ PICKSTYLE: 2 }, false);
    await t.bus.script(['SELECT', 'L']);
    expect(t.handles()).toEqual(['44']);
    expect(t.asked.some((r) => r.op === 'sysvar' && r.name === PICKSTYLE)).toBe(false);
    const f = hatched({ PICKSTYLE: 2 });
    const b = new ChangeSetBuilder(f.model);
    b.updateEntity(f.byHandle('41')!.id, { layer: LAYER_0 });
    f.model.apply(b.build());
    const freeze = new ChangeSetBuilder(f.model);
    freeze.updateTableRecord('layers', LAYER_0, { frozen: true });
    f.model.apply(freeze.build());
    await f.bus.script(['SELECT', 'L']);
    expect(f.handles()).toEqual(['40', '42', '43', '44']);
  });
});
